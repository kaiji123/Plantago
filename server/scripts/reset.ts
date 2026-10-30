export {};

// Reset the database to a curated demo state.
//
//   npm run seed:reset
//
// Wipes donations, plans, payouts, shipments, harvest promises and farmer orders,
// restores the plant network's stock, then plays a short story through the real
// code paths so every screen has something to show:
//
//   A. Marsabit: sorghum and cowpeas, delivered by truck three weeks ago
//   B. Lodwar: seed trucked in four months ago, harvest in ten days ago
//   C+D. Lodwar (buys the farmer group's harvest back first) and Kakuma (from Uganda),
//        consolidated onto one truck that's on the road now
//   E. Wajir: drip kit, storage bags and cowpea seed, paid and waiting for a truck
//   F. Lodwar Farmer Group spends its earnings on storage bags (farmer shop), waiting for a truck
//   G. Mandera: planned this morning, waiting for the next payout batch
//
// So the operator's Dispatch tab shows delivered runs, a truck on the road, and
// two runs ready to dispatch live.
//
// Payments are always simulated and the rule-based planner is used, so a reset never
// creates real sandbox orders or spends AI planner credits, and always gives the same result.
// Safe to run while the server is running (it deletes rows, not the database file).

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.PLANNER_API_KEY = "";
process.env.DEEPSEEK_API_KEY = "";
process.env.PAYOUT_THRESHOLD_USD = "1000000"; // payouts are run explicitly below

const { openDb, seedNetwork } = await import("../db.js");
const pay = await import("../payments.js");
const harvest = await import("../harvest.js");
const shop = await import("../shop.js");
const { refreshShipmentDescriptions } = await import("../plans.js");
const dispatch = await import("../dispatch.js");

const db = openDb();
const DAY = 86_400_000;
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const now = Date.now();

// ---------- 1. Wipe activity and restore the network ----------
db.transaction(() => {
  for (const t of [
    "dispatch_runs",
    "paypal_events",
    "farmer_orders",
    "harvest_commitments",
    "shipments",
    "plan_lines",
    "payouts",
    "payout_batches",
    "plans",
    "donations",
    "offers",
    "growers",
  ])
    db.prepare(`DELETE FROM ${t}`).run();
})();
seedNetwork(db);

// ---------- 2. Helpers that drive the real code paths ----------
async function waitForPlan(donationId: string) {
  for (let i = 0; i < 200; i++) {
    const p = db.prepare(`SELECT status FROM plans WHERE donation_id = ?`).get(donationId) as { status: string } | undefined;
    if (p && p.status !== "planning") return p.status;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Plan for ${donationId} never finished`);
}

async function donate(destinationId: string, dollars: number, goal: string, choices: string[] = []) {
  const { donationId, orderId } = await pay.createDonation(db, { destinationId, amountCents: dollars * 100, goal, choices });
  await pay.captureDonation(db, donationId, orderId);
  const status = await waitForPlan(donationId);
  if (status !== "ready") throw new Error(`Plan for ${destinationId} is ${status}`);
  const plan = db.prepare(`SELECT id FROM plans WHERE donation_id = ?`).get(donationId) as { id: string };
  return { donationId, planId: plan.id };
}

const payDestination = (destinationId: string) => pay.runPayoutBatch(db, { destinationId });

type Stage = "sourced" | "shipped" | "delivered";
const ORDER: Stage[] = ["sourced", "shipped", "delivered"];

/** Move a plan's shipments to `to`, with realistic timestamps starting at t0. */
function ship(planId: string, to: Stage, t0: number) {
  const rows = db.prepare(`SELECT id, eta_days FROM shipments WHERE plan_id = ?`).all(planId) as { id: string; eta_days: number }[];
  for (const s of rows) {
    const when: Record<string, number> = {
      awaiting_payment: t0 + 3 * MIN,
      sourced: t0 + 15 * MIN,
      shipped: t0 + 1 * DAY,
      delivered: t0 + (s.eta_days + 1) * DAY,
    };
    const stages = ["awaiting_payment", ...ORDER.slice(0, ORDER.indexOf(to) + 1)];
    const history = stages.map((st) => ({ status: st, at: iso(when[st]) }));
    db.prepare(`UPDATE shipments SET status = ?, history = ?, updated_at = ? WHERE id = ?`).run(to, JSON.stringify(history), history.at(-1)!.at, s.id);
  }
}

/** Put a donation, its plan, payouts and promises at time t0 (the story's timeline). */
function retime(donationId: string, planId: string, t0: number, paid: boolean) {
  db.prepare(`UPDATE donations SET created_at = ?, captured_at = ? WHERE id = ?`).run(iso(t0), iso(t0 + 2 * MIN), donationId);
  db.prepare(`UPDATE plans SET created_at = ?, updated_at = ? WHERE id = ?`).run(iso(t0 + 3 * MIN), iso(t0 + 3 * MIN), planId);
  if (paid) {
    const payoutIds = (db.prepare(`SELECT DISTINCT payout_id FROM plan_lines WHERE plan_id = ? AND payout_id IS NOT NULL`).all(planId) as { payout_id: string }[]).map(
      (r) => r.payout_id,
    );
    for (const id of payoutIds) {
      db.prepare(`UPDATE payouts SET paid_at = ?, updated_at = ? WHERE id = ?`).run(iso(t0 + 15 * MIN), iso(t0 + 15 * MIN), id);
      db.prepare(`UPDATE payout_batches SET created_at = ?, updated_at = ? WHERE id = (SELECT batch_id FROM payouts WHERE id = ?)`).run(
        iso(t0 + 14 * MIN),
        iso(t0 + 15 * MIN),
        id,
      );
    }
  }
  const promises = db.prepare(`SELECT h.id AS id, h.crop_id, c.days_to_harvest FROM harvest_commitments h JOIN crops c ON c.id = h.crop_id WHERE plan_id = ?`).all(planId) as {
    id: string;
    days_to_harvest: number;
  }[];
  for (const p of promises)
    db.prepare(`UPDATE harvest_commitments SET created_at = ?, updated_at = ?, due_at = ? WHERE id = ?`).run(
      iso(t0 + 3 * MIN),
      iso(t0 + 3 * MIN),
      iso(t0 + p.days_to_harvest * DAY),
      p.id,
    );
}

/** Put these plans' paid shipments on one truck (the real dispatch planner), optionally deliver it, and set its timeline. */
function truck(planIds: string[], t0: number, deliver: boolean) {
  const mine = new Set(
    (db.prepare(`SELECT id FROM shipments WHERE plan_id IN (${planIds.map(() => "?").join(",")})`).all(...planIds) as { id: string }[]).map((r) => `sh:${r.id}`),
  );
  // Dispatch every proposed run made of these plans' loads, as the planner recommends.
  const sent = dispatch
    .proposeRuns(db)
    .filter((r) => r.cargo.every((c) => mine.has(c.key)))
    .map((r) => dispatch.dispatchRun(db, r.cargo.map((c) => c.key)));
  for (const run of sent) {
    if (deliver) dispatch.deliverRun(db, run.id);
    db.prepare(`UPDATE dispatch_runs SET created_at = ?, updated_at = ?, delivered_at = ? WHERE id = ?`).run(
      iso(t0 + DAY),
      iso(deliver ? t0 + (run.days + 1) * DAY : t0 + DAY),
      deliver ? iso(t0 + (run.days + 1) * DAY) : null,
      run.id,
    );
  }
  for (const p of planIds) ship(p, deliver ? "delivered" : "shipped", t0);
  return [...sent].sort((a, b) => b.loadKg - a.loadKg)[0];
}

// ---------- 3. The story ----------
const log = (m: string) => console.log(`  ✓ ${m}`);
console.log("\nResetting the demo…");

// B. Seed to Lodwar, four months ago. Delivered and planted.
const tB = now - 120 * DAY;
const B = await donate("lodwar", 40, "Seed so families in Lodwar can grow their own sorghum and cowpeas.", ["sorghum:seed", "cowpeas:seed"]);
await payDestination("lodwar");
truck([B.planId], tB, true);
retime(B.donationId, B.planId, tB, true);
log("Lodwar: seed delivered four months ago");

// A. Marsabit, three weeks ago, delivered.
const tA = now - 21 * DAY;
const A = await donate("marsabit", 80, "Sorghum and cowpeas for families in Marsabit.", ["sorghum:food", "cowpeas:food"]);
await payDestination("marsabit");
truck([A.planId], tA, true);
retime(A.donationId, A.planId, tA, true);
log("Marsabit: delivered three weeks ago");

// Ten days ago the Lodwar harvest came in.
for (const c of harvest.listCommitments(db, { planId: B.planId }) as { id: string }[]) {
  harvest.markHarvestReady(db, c.id);
  db.prepare(`UPDATE harvest_commitments SET harvested_at = ?, updated_at = ? WHERE id = ?`).run(iso(now - 10 * DAY), iso(now - 10 * DAY), c.id);
}
log("Lodwar: harvest in ten days ago");

// C + D. Lodwar (buys the farmer group's harvest first) and Kakuma (from Uganda), three days ago,
// consolidated onto one truck that's on the road now.
const tC = now - 3 * DAY;
const C = await donate("lodwar", 100, "Help families in Lodwar eat this month.");
await payDestination("lodwar");
const D = await donate("kakuma", 60, "Sorghum and cowpeas for school meals in Kakuma.", ["sorghum:food", "cowpeas:food"]);
await payDestination("kakuma");
const cd = truck([C.planId, D.planId], tC, false);
retime(C.donationId, C.planId, tC, true);
retime(D.donationId, D.planId, tC + 40 * MIN, true);
log(`Lodwar + Kakuma: ${cd.mode === "truck" ? "truck" : "part loads on scheduled lorries"}, ${cd.stops.length} stops, ${cd.km} km, on the road`);

// A company's monthly gift to Lodwar: a short, heavy run from the Kitale area, where a dedicated truck wins.
const tM = now - 2 * DAY;
const M = await donate("lodwar", 1000, "Our team's monthly gift: please feed as many families in Turkana as you can.");
await payDestination("lodwar");
const m = truck([M.planId], tM, false);
retime(M.donationId, M.planId, tM, true);
log(`Lodwar company gift: ${m.mode === "truck" ? "dedicated 3-tonne truck" : "part loads"}, ${Math.round(m.loadKg)} kg, ${m.km} km, saves $${(m.savingsCents / 100).toFixed(0)}`);

// E. Wajir tools and seed, paid two days ago, being sourced; its harvest promise is growing.
const tE = now - 2 * DAY;
const E = await donate("wajir", 120, "Drip kits and storage bags so families can grow and keep food.", ["drip_kit:tool", "hermetic_bag:tool", "cowpeas:seed"]);
await payDestination("wajir");
ship(E.planId, "sourced", tE);
retime(E.donationId, E.planId, tE, true);
log("Wajir: tools and seed being sourced from India, Tanzania and Uganda");

// F. The Lodwar Farmer Group spends part of its earnings in the shop.
const tF = now - 1 * DAY;
const bags = shop.shopCatalog(db, "fg-lodwar").find((i) => i.cropId === "hermetic_bag")!;
const order = await shop.createFarmerOrder(db, { buyerId: "fg-lodwar", supplierId: bags.options[0].supplierId, cropId: "hermetic_bag", qty: 12 });
await shop.captureFarmerOrder(db, order.orderId, order.paypalOrderId);
await pay.runPayoutBatch(db); // pays the bag maker (nothing else is unpaid yet); the order waits for a truck
db.prepare(
  `UPDATE farmer_orders SET created_at = ?, paid_at = ?, updated_at = ?, delivery_history = ? WHERE id = ?`,
).run(
  iso(tF),
  iso(tF + 2 * MIN),
  iso(tF + 15 * MIN),
  JSON.stringify([
    { status: "awaiting_payment", at: iso(tF + 2 * MIN) },
    { status: "sourced", at: iso(tF + 15 * MIN) },
  ]),
  order.orderId,
);
db.prepare(`UPDATE payouts SET paid_at = ?, updated_at = ? WHERE id = (SELECT payout_id FROM farmer_orders WHERE id = ?)`).run(iso(tF + 15 * MIN), iso(tF + 15 * MIN), order.orderId);
log("Lodwar Farmer Group bought 12 storage bags with its earnings");

// G. Mandera, this morning: planned, not paid yet (shows the operator's payout button).
const tG = now - 3 * 60 * MIN;
const G = await donate("mandera", 50, "Help families along the Daua river eat this month.");
retime(G.donationId, G.planId, tG, false);
log("Mandera: planned this morning, waiting for the payout batch");

refreshShipmentDescriptions(db);

const l = pay.ledger(db).totals;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
console.log(
  `\nDone. ${usd(l.receivedCents)} donated, ${usd(l.paidToGrowersCents)} paid to suppliers, ${usd(l.heldCents)} held (Mandera's plan plus rounding).`,
);
console.log("All payments in this demo are simulated (IDs start with SIM-).\n");
db.close();
