import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, paypalSimulated } from "./config.js";
import { openDb } from "./db.js";
import { dollarsToCents } from "./money.js";
import { ASSUMPTIONS, catalog, loadNetwork, plantingWindow } from "./optimizer.js";
import { wikipediaSummary } from "./articles.js";
import { farmerDetail, farmerStats, listFarmers } from "./farmers.js";
import { listCommitments, markHarvestFailed, markHarvestReady } from "./harvest.js";
import { deliverRun, dispatchRun, listRuns, PART_LOAD, proposeRuns, TRUCK } from "./dispatch.js";
import { MOMBASA_PORT, roadNetwork, roadPath } from "./roads.js";
import { advanceFarmerOrder, captureFarmerOrder, createFarmerOrder, listFarmerOrders, refundFarmerOrder, shopCatalog } from "./shop.js";
import { cropBlurbs, cropGrowth } from "./seed/kenya.js";
import {
  captureDonation,
  createDonation,
  handlePayPalEvent,
  ledger,
  refreshPayoutBatch,
  refundDonation,
  retryPayoutBatch,
  runPayoutBatch,
  UserError,
} from "./payments.js";
import { PayPalError, verifyWebhook } from "./paypal.js";
import { refreshShipmentDescriptions, resumeStuckPlans } from "./plans.js";

const db = openDb();
resumeStuckPlans(db);
refreshShipmentDescriptions(db);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

// Simple per-IP limit on new donations, so the AI planner can't be spammed.
const hits = new Map<string, number[]>();
function rateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "?";
    const t = Date.now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) return res.status(429).json({ error: "Too many donations from this address. Try again later." });
    recent.push(t);
    hits.set(key, recent);
    next();
  };
}

function operatorOnly(req: Request, res: Response, next: NextFunction) {
  if (!config.operatorToken || req.get("x-operator-token") === config.operatorToken) return next();
  res.status(401).json({ error: "Operator token required" });
}

// ---------- Public ----------

app.get("/api/config", (_req, res) => {
  res.json({
    paypalClientId: paypalSimulated ? null : config.paypal.clientId,
    simulated: paypalSimulated,
    aiPlanner: config.planner.enabled,
    plannerModel: config.planner.enabled ? config.planner.model : null,
    operatorTokenRequired: !!config.operatorToken,
    plantingWindow: plantingWindow(),
    assumptions: ASSUMPTIONS,
  });
});

app.get("/api/destinations", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT ds.*,
              (SELECT COUNT(*) FROM donations d WHERE d.destination_id = ds.id AND d.status='captured') AS donations,
              (SELECT COALESCE(SUM(l.meals),0) FROM plan_lines l JOIN plans p ON p.id=l.plan_id AND p.status='ready'
                 JOIN donations d ON d.id=p.donation_id WHERE d.destination_id = ds.id AND l.mode='food_now') AS meals
         FROM destinations ds ORDER BY need_phase DESC, people_in_need DESC`,
    )
    .all();
  res.json(rows);
});

app.get("/api/catalog", (req, res) => {
  const destinationId = String(req.query.destinationId ?? "");
  const net = loadNetwork(db);
  if (!net.destinations.has(destinationId)) return res.status(400).json({ error: "Unknown destination" });
  const items = catalog(net, destinationId, cropBlurbs).map((i) => {
    // Which growers would supply this item, so the map can draw candidate routes.
    const suppliers = net.offers
      .filter((o) => o.cropId === i.cropId && o.stockKg >= 1)
      .map((o) => net.growers.get(o.growerId)!)
      .filter((g) =>
        i.form === "seed" ? g.kind === "seed_supplier" : i.form === "tool" ? g.kind === "tool_maker" : !["seed_supplier", "tool_maker", "importer"].includes(g.kind),
      )
      .map((g) => g.id);
    return { ...i, growth: cropGrowth[i.cropId] ?? null, suppliers: i.available ? suppliers : [] };
  });
  res.json(items);
});

// A short Wikipedia article for a catalog item.
app.get(
  "/api/articles/:cropId",
  h(async (req, res) => {
    const g = cropGrowth[String(req.params.cropId)];
    if (!g) return res.status(404).json({ error: "Unknown item" });
    try {
      res.set("Cache-Control", "public, max-age=3600").json(await wikipediaSummary(g.wiki));
    } catch {
      res.status(502).json({ error: "Wikipedia is unavailable", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.wiki)}` });
    }
  }),
);

// Road network (for drawing) and road-following paths.
app.get("/api/roads", (_req, res) => res.set("Cache-Control", "public, max-age=3600").json(roadNetwork()));

/** Polyline from a supplier to a point, along the road network (sea freight joins at Mombasa). */
function pathFor(from: { lat: number; lng: number; transport?: string }, to: { lat: number; lng: number }): [number, number][] {
  if (from.transport === "sea") return [[from.lat, from.lng], ...roadPath(MOMBASA_PORT, to).coords];
  return roadPath(from, to).coords;
}

// Network topology: every node, and every route money has been planned along.
app.get("/api/flows", (_req, res) => {
  const growers = db.prepare(`SELECT id, name, kind, town, county, country, transport, lat, lng FROM growers`).all();
  const destinations = db.prepare(`SELECT id, name, county, lat, lng, need_phase, people_in_need FROM destinations`).all();
  const edges = db
    .prepare(
      `SELECT l.grower_id, d.destination_id, l.mode,
              SUM(l.kg) AS kg, SUM(l.total_cents) AS cents, SUM(l.meals) AS meals, COUNT(DISTINCT p.id) AS plans,
              GROUP_CONCAT(DISTINCT c.name) AS crops,
              CASE
                WHEN SUM(CASE WHEN s.status = 'delivered' THEN 0 ELSE 1 END) = 0 THEN 'delivered'
                WHEN SUM(CASE WHEN s.status = 'shipped' THEN 1 ELSE 0 END) > 0 THEN 'shipped'
                WHEN SUM(CASE WHEN l.payout_id IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 'paid'
                ELSE 'queued'
              END AS status
         FROM plan_lines l
         JOIN plans p ON p.id = l.plan_id AND p.status = 'ready'
         JOIN donations d ON d.id = p.donation_id AND d.status = 'captured'
         JOIN crops c ON c.id = l.crop_id
         LEFT JOIN shipments s ON s.plan_id = l.plan_id AND s.grower_id = l.grower_id
        GROUP BY l.grower_id, d.destination_id, l.mode`,
    )
    .all();
  // Deliveries to farmers who bought tools or seed in the shop.
  const orderEdges = db
    .prepare(
      `SELECT supplier_id AS grower_id, buyer_id AS destination_id, 'farmer_order' AS mode, SUM(qty) AS kg, SUM(total_cents) AS cents, 0 AS meals,
              COUNT(*) AS plans, GROUP_CONCAT(DISTINCT c.name) AS crops,
              CASE WHEN SUM(CASE WHEN delivery_status='delivered' THEN 0 ELSE 1 END) = 0 THEN 'delivered'
                   WHEN SUM(CASE WHEN delivery_status='shipped' THEN 1 ELSE 0 END) > 0 THEN 'shipped'
                   WHEN SUM(CASE WHEN payout_id IS NOT NULL THEN 1 ELSE 0 END) > 0 THEN 'paid'
                   ELSE 'queued' END AS status
         FROM farmer_orders o JOIN crops c ON c.id = o.crop_id WHERE o.status = 'paid' GROUP BY supplier_id, buyer_id`,
    )
    .all();
  // Attach the road path for each route so maps can draw it along the highways.
  const gById = new Map((growers as any[]).map((g) => [g.id, g]));
  const dById = new Map((destinations as any[]).map((d) => [d.id, d]));
  const withPaths = [...(edges as any[]), ...(orderEdges as any[])].map((e) => {
    const from = gById.get(e.grower_id);
    const to = dById.get(e.destination_id) ?? gById.get(e.destination_id);
    return from && to ? { ...e, path: pathFor(from, to) } : e;
  });
  res.json({ growers, destinations, edges: withPaths });
});

app.get("/api/network", (_req, res) => {
  const growers = db.prepare(`SELECT id, name, kind, town, county, country, transport, lat, lng FROM growers`).all();
  const offers = db
    .prepare(`SELECT o.grower_id, o.crop_id, c.name AS crop, o.price_cents_per_kg, o.stock_kg FROM offers o JOIN crops c ON c.id=o.crop_id`)
    .all();
  const crops = db.prepare(`SELECT * FROM crops`).all();
  const paid = db.prepare(`SELECT grower_id, SUM(amount_cents) AS paid_cents FROM payouts GROUP BY grower_id`).all();
  res.json({ growers, offers, crops, paid });
});

app.post(
  "/api/donations",
  rateLimit(10, 60 * 60 * 1000),
  h(async (req, res) => {
    const { destinationId, amount, goal, choices } = req.body ?? {};
    if (typeof destinationId !== "string") throw new UserError("destinationId is required");
    let amountCents: number;
    try {
      amountCents = dollarsToCents(String(amount));
    } catch {
      throw new UserError("Enter an amount like 50 or 25.50");
    }
    const picked = Array.isArray(choices) ? choices.filter((c): c is string => typeof c === "string") : [];
    res.json(await createDonation(db, { destinationId, amountCents, goal: typeof goal === "string" ? goal : "", choices: picked }));
  }),
);

app.post(
  "/api/donations/:id/capture",
  h(async (req, res) => {
    const orderId = String(req.body?.orderId ?? "");
    await captureDonation(db, String(req.params.id), orderId);
    res.json({ ok: true });
  }),
);

app.get("/api/donations/:id", (req, res) => {
  const d = db
    .prepare(
      `SELECT d.id, d.destination_id, d.amount_cents, d.goal, d.choices, d.donor_name, d.status, d.paypal_order_id, d.paypal_capture_id,
              d.paypal_refund_id, d.simulated, d.created_at, d.captured_at
         FROM donations d WHERE d.id = ?`,
    )
    .get(req.params.id) as any;
  if (!d) return res.status(404).json({ error: "Not found" });
  const destination = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(d.destination_id);
  const plan = db.prepare(`SELECT * FROM plans WHERE donation_id = ?`).get(d.id) as any;
  let lines: any[] = [];
  let shipments: any[] = [];
  let payouts: any[] = [];
  if (plan) {
    lines = db
      .prepare(
        `SELECT l.*, g.name AS grower_name, g.town, g.country, g.transport, g.lat, g.lng, c.name AS crop_name, c.kind AS crop_kind, c.unit,
                po.status AS payout_status, po.paypal_item_id,
                pb.paypal_batch_id
           FROM plan_lines l JOIN growers g ON g.id=l.grower_id JOIN crops c ON c.id=l.crop_id
           LEFT JOIN payouts po ON po.id = l.payout_id LEFT JOIN payout_batches pb ON pb.id = po.batch_id
          WHERE l.plan_id = ? ORDER BY l.mode, l.total_cents DESC`,
      )
      .all(plan.id);
    shipments = db
      .prepare(`SELECT s.*, g.name AS grower_name, g.town FROM shipments s JOIN growers g ON g.id=s.grower_id WHERE s.plan_id = ?`)
      .all(plan.id)
      .map((s: any) => ({ ...s, history: JSON.parse(s.history) }));
    payouts = db
      .prepare(
        `SELECT DISTINCT po.id, po.status, po.amount_cents, po.paypal_item_id, pb.paypal_batch_id, g.name AS grower_name
           FROM plan_lines l JOIN payouts po ON po.id = l.payout_id JOIN payout_batches pb ON pb.id=po.batch_id JOIN growers g ON g.id=po.grower_id
          WHERE l.plan_id = ?`,
      )
      .all(plan.id);
  }
  res.json({
    donation: { ...d, choices: JSON.parse(d.choices ?? "[]") },
    destination,
    plan: plan ? { ...plan, summary: plan.summary ? JSON.parse(plan.summary) : null, trace: JSON.parse(plan.trace) } : null,
    lines: (lines as any[]).map((l) => ({ ...l, path: pathFor({ lat: l.lat, lng: l.lng, transport: l.transport }, destination as any) })),
    shipments,
    payouts,
    commitments: plan ? listCommitments(db, { planId: plan.id }) : [],
  });
});

app.get("/api/ledger", (_req, res) => res.json({ ...ledger(db), farmers: farmerStats(db) }));

app.get("/api/farmers", (_req, res) => res.json({ farmers: listFarmers(db), stats: farmerStats(db) }));
// Farmer shop: farmers buy tools and seed with PayPal; Plantago delivers.
app.get("/api/farmers/:id/shop", (req, res) => res.json(shopCatalog(db, String(req.params.id))));
app.post(
  "/api/farmers/:id/orders",
  rateLimit(20, 60 * 60 * 1000),
  h(async (req, res) => {
    const { supplierId, cropId, qty } = req.body ?? {};
    res.json(await createFarmerOrder(db, { buyerId: String(req.params.id), supplierId: String(supplierId), cropId: String(cropId), qty: Number(qty) }));
  }),
);
app.post(
  "/api/farmer-orders/:id/capture",
  h(async (req, res) => res.json(await captureFarmerOrder(db, String(req.params.id), String(req.body?.paypalOrderId ?? "")))),
);

app.get("/api/farmers/:id", (req, res) => {
  const f = farmerDetail(db, String(req.params.id));
  if (!f) return res.status(404).json({ error: "Not found" });
  res.json(f);
});

// ---------- PayPal webhooks ----------

app.post(
  "/api/webhooks/paypal",
  h(async (req, res) => {
    const event = req.body;
    if (!event?.id || !event?.event_type) return res.status(400).json({ error: "Not a PayPal event" });
    let verified = false;
    try {
      verified = await verifyWebhook(req.headers as Record<string, string>, event);
    } catch (e) {
      console.error("[webhook] verification error:", e);
    }
    await handlePayPalEvent(db, event, verified);
    res.json({ received: true, verified });
  }),
);

// ---------- Operator ----------

const op = express.Router();
op.use(operatorOnly);

op.get("/overview", (_req, res) => {
  const donations = db
    .prepare(
      `SELECT d.id, d.amount_cents, d.status, d.goal, d.captured_at, d.created_at, d.paypal_capture_id, d.simulated, ds.name AS destination,
              p.status AS plan_status, p.planner, p.headline
         FROM donations d JOIN destinations ds ON ds.id=d.destination_id LEFT JOIN plans p ON p.donation_id=d.id
        WHERE d.status != 'created' OR d.created_at > datetime('now','-1 day')
        ORDER BY d.created_at DESC LIMIT 200`,
    )
    .all();
  const unpaid = db
    .prepare(
      `SELECT l.id, l.total_cents, l.kg, l.mode, g.name AS grower, c.name AS crop, ds.name AS destination
         FROM plan_lines l JOIN plans p ON p.id=l.plan_id AND p.status='ready' JOIN donations d ON d.id=p.donation_id
         JOIN growers g ON g.id=l.grower_id JOIN crops c ON c.id=l.crop_id JOIN destinations ds ON ds.id=d.destination_id
        WHERE l.payout_id IS NULL`,
    )
    .all();
  const batches = db.prepare(`SELECT * FROM payout_batches ORDER BY created_at DESC LIMIT 50`).all();
  const payouts = db
    .prepare(
      `SELECT po.*, g.name AS grower, g.town, pb.paypal_batch_id FROM payouts po JOIN growers g ON g.id=po.grower_id
         JOIN payout_batches pb ON pb.id=po.batch_id ORDER BY po.updated_at DESC LIMIT 300`,
    )
    .all();
  const shipments = db
    .prepare(
      `SELECT s.*, g.name AS grower, g.town, ds.name AS destination FROM shipments s JOIN growers g ON g.id=s.grower_id
         JOIN destinations ds ON ds.id=s.destination_id JOIN plans p ON p.id=s.plan_id AND p.status='ready' ORDER BY s.updated_at DESC LIMIT 300`,
    )
    .all();
  // Farmer purchases ride in the same delivery list, labelled as such.
  const farmerOrders = listFarmerOrders(db, { activeOnly: true });
  const allShipments = [
    ...shipments.map((s: any) => ({ ...s, kind: "donation" })),
    ...farmerOrders.map((o) => ({
      id: o.id,
      kind: "farmer_order",
      destination: `${o.buyer_name} (farmer order)`,
      grower: o.supplier_name,
      description: o.crop_kind === "tool" ? `${o.qty} × ${o.crop_name.toLowerCase()}` : `${o.qty} kg ${o.crop_name.toLowerCase()} seed`,
      status: o.delivery_status,
      eta_days: o.eta_days,
      updated_at: o.updated_at,
    })),
  ];
  const unpaidOrders = farmerOrders
    .filter((o) => !o.payout_id)
    .map((o) => ({ id: o.id, total_cents: o.total_cents, kg: o.qty, mode: "farmer_order", grower: o.supplier_name, crop: o.crop_name, destination: o.buyer_name }));
  res.json({
    donations,
    unpaid: [...unpaid, ...unpaidOrders],
    batches,
    payouts,
    shipments: allShipments,
    farmerOrders,
    thresholdCents: config.payoutThresholdCents,
  });
});

op.post("/payouts/run", h(async (req, res) => res.json(await runPayoutBatch(db, { destinationId: req.body?.destinationId }))));
op.post("/payouts/:id/refresh", h(async (req, res) => { await refreshPayoutBatch(db, String(req.params.id)); res.json({ ok: true }); }));
op.post("/payouts/:id/retry", h(async (req, res) => res.json(await retryPayoutBatch(db, String(req.params.id)))));
op.post("/farmer-orders/:id/refund", h(async (req, res) => { await refundFarmerOrder(db, String(req.params.id)); res.json({ ok: true, message: "Refunded to the farmer through PayPal" }); }));
op.post("/donations/:id/refund", h(async (req, res) => { await refundDonation(db, String(req.params.id)); res.json({ ok: true }); }));

const NEXT_STATUS: Record<string, string> = { sourced: "shipped", shipped: "delivered" };
op.post("/shipments/:id/advance", (req, res) => {
  if (String(req.params.id).startsWith("fo_")) return res.json({ ok: true, status: advanceFarmerOrder(db, String(req.params.id)) });
  const s = db.prepare(`SELECT * FROM shipments WHERE id = ?`).get(req.params.id) as any;
  if (!s) return res.status(404).json({ error: "Not found" });
  const next = NEXT_STATUS[s.status];
  if (!next) return res.status(400).json({ error: s.status === "awaiting_payment" ? "Pay the grower first" : "Already delivered" });
  const history = JSON.parse(s.history);
  history.push({ status: next, at: new Date().toISOString() });
  db.prepare(`UPDATE shipments SET status=?, history=?, updated_at=? WHERE id=? AND status=?`).run(next, JSON.stringify(history), new Date().toISOString(), s.id, s.status);
  res.json({ ok: true, status: next });
});

// Dispatch: group paid shipments into truck runs on the road network.
op.get("/dispatch", (_req, res) => res.json({ truck: TRUCK, partLoad: PART_LOAD, proposals: proposeRuns(db), runs: listRuns(db) }));
op.post("/dispatch", (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter((k: unknown): k is string => typeof k === "string") : [];
  const mode = req.body?.mode === "truck" || req.body?.mode === "part_loads" ? req.body.mode : undefined;
  const run = dispatchRun(db, keys, mode);
  res.json({
    ok: true,
    message:
      run.mode === "truck"
        ? `Truck dispatched: ${run.stops.length} stops, ${run.km} km, about ${run.days} days.`
        : `Sent as part loads on scheduled lorries (${run.cargo.length} consignment${run.cargo.length === 1 ? "" : "s"}).`,
    run,
  });
});
op.post("/dispatch/:id/delivered", (req, res) => {
  deliverRun(db, String(req.params.id));
  res.json({ ok: true, message: "Run delivered: every load on it is marked delivered." });
});

op.get("/harvests", (_req, res) => res.json(listCommitments(db)));
op.post("/harvests/:id/ready", h(async (req, res) => {
  try {
    markHarvestReady(db, String(req.params.id));
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  res.json({ ok: true, message: "Harvest is in: it will be bought first by the next donations to this place." });
}));
op.post("/harvests/:id/failed", h(async (req, res) => {
  try {
    markHarvestFailed(db, String(req.params.id));
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  res.json({ ok: true, message: "Marked as a failed harvest." });
}));

app.use("/api/operator", op);

// ---------- Errors ----------

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
  if (err instanceof PayPalError) {
    console.error("[paypal]", err.message, JSON.stringify(err.details));
    return res.status(502).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

// ---------- Frontend ----------

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(config.port, () => {
  console.log(`Plantago API on http://localhost:${config.port}`);
  console.log(`  PayPal: ${paypalSimulated ? "SIMULATION (no credentials set)" : `sandbox (${config.paypal.apiBase})`}`);
  console.log(`  Planner: ${config.planner.enabled ? `AI (${config.planner.model})` : "rule-based (no PLANNER_API_KEY / DEEPSEEK_API_KEY)"}`);
  if (!config.operatorToken) console.log("  Operator pages are open (set OPERATOR_TOKEN before deploying).");
});
