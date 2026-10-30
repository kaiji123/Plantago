// End-to-end money flow in simulation mode (no PayPal or AI planner credentials).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.PLANNER_API_KEY = "";
process.env.DEEPSEEK_API_KEY = "";
process.env.PAYOUT_THRESHOLD_USD = "100000";

const { openDb } = await import("./db.js");
const DEMO_DELIVERY = { contactName: "Akai Lokwang", contactPhone: "+254 712 345 678", deliveryPoint: "Kalokol road, next to the borehole" };
const pay = await import("./payments.js");

async function waitForPlan(db: any, donationId: string) {
  for (let i = 0; i < 100; i++) {
    const p = db.prepare(`SELECT status FROM plans WHERE donation_id = ?`).get(donationId);
    if (p && p.status !== "planning") return p.status;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("plan never finished");
}

test("donate → plan → pay growers → ledger balances", async () => {
  const db = openDb(":memory:");
  const { donationId, orderId } = await pay.createDonation(db, { destinationId: "lodwar", amountCents: 5000, goal: "Feed families this month" });
  await pay.captureDonation(db, donationId, orderId);
  await pay.captureDonation(db, donationId, orderId); // retry is harmless
  assert.equal(await waitForPlan(db, donationId), "ready");

  const lines = db.prepare(`SELECT SUM(total_cents) t, COUNT(*) n FROM plan_lines`).get() as any;
  assert.ok(lines.n >= 2);
  assert.ok(lines.t <= 5000);

  const first = await pay.runPayoutBatch(db);
  assert.equal(first.totalCents, lines.t);
  const second = await pay.runPayoutBatch(db);
  assert.equal(second.batchId, null, "nothing is paid twice");

  const l = pay.ledger(db);
  assert.equal(l.totals.receivedCents, 5000);
  assert.equal(l.totals.paidToGrowersCents, lines.t);
  assert.equal(l.totals.heldCents, 5000 - lines.t);
  assert.equal(l.totals.committedCents, 0);

  const shipped = db.prepare(`SELECT COUNT(*) n FROM shipments WHERE status = 'sourced'`).get() as any;
  assert.ok(shipped.n >= 1);

  await assert.rejects(pay.refundDonation(db, donationId), /already been paid/);
});

test("refund before payout releases stock and pays nobody", async () => {
  const db = openDb(":memory:");
  const stockBefore = (db.prepare(`SELECT SUM(stock_kg) s FROM offers`).get() as any).s;
  const { donationId, orderId } = await pay.createDonation(db, { destinationId: "wajir", amountCents: 2500, goal: "" });
  await pay.captureDonation(db, donationId, orderId);
  await waitForPlan(db, donationId);
  await pay.refundDonation(db, donationId);
  const stockAfter = (db.prepare(`SELECT SUM(stock_kg) s FROM offers`).get() as any).s;
  assert.ok(Math.abs(stockAfter - stockBefore) < 0.01);
  const run = await pay.runPayoutBatch(db);
  assert.equal(run.batchId, null);
  const l = pay.ledger(db);
  assert.equal(l.totals.heldCents, 0);
});

test("captures for the wrong order are rejected", async () => {
  const db = openDb(":memory:");
  const { donationId } = await pay.createDonation(db, { destinationId: "garissa", amountCents: 1000, goal: "" });
  await assert.rejects(pay.captureDonation(db, donationId, "SOME-OTHER-ORDER"), /does not match/);
  await assert.rejects(pay.createDonation(db, { destinationId: "garissa", amountCents: 100, goal: "" }), /between/);
});

test("donor catalog choices are enforced", async () => {
  const db = openDb(":memory:");
  const food = await pay.createDonation(db, { destinationId: "marsabit", amountCents: 4000, goal: "", choices: ["sorghum:food", "cowpeas:food"] });
  await pay.captureDonation(db, food.donationId, food.orderId);
  await waitForPlan(db, food.donationId);
  const crops = (db.prepare(`SELECT DISTINCT l.crop_id, l.mode FROM plan_lines l JOIN plans p ON p.id=l.plan_id WHERE p.donation_id=?`).all(food.donationId) as any[]);
  assert.ok(crops.length > 0);
  assert.ok(crops.every((c) => ["sorghum", "cowpeas"].includes(c.crop_id) && c.mode === "food_now"), JSON.stringify(crops));

  const seed = await pay.createDonation(db, { destinationId: "lodwar", amountCents: 3000, goal: "", choices: ["sorghum:seed"] });
  await pay.captureDonation(db, seed.donationId, seed.orderId);
  await waitForPlan(db, seed.donationId);
  const seedLines = db.prepare(`SELECT l.crop_id, l.mode FROM plan_lines l JOIN plans p ON p.id=l.plan_id WHERE p.donation_id=?`).all(seed.donationId) as any[];
  assert.ok(seedLines.length > 0 && seedLines.every((l) => l.crop_id === "sorghum" && l.mode === "grow_there"), JSON.stringify(seedLines));

  await assert.rejects(pay.createDonation(db, { destinationId: "lodwar", amountCents: 1000, goal: "", choices: ["sweet_potato:food"] }), /can't be sent/);
  await assert.rejects(pay.createDonation(db, { destinationId: "lodwar", amountCents: 1000, goal: "", choices: ["maize:seed"] }), /can't be sent/);
  await assert.rejects(pay.createDonation(db, { destinationId: "lodwar", amountCents: 1000, goal: "", choices: ["gold:food"] }), /Unknown catalog item/);
});

test("seed becomes income: harvest buy-back promise, priority purchase, payout to the farmer group", async () => {
  const db = openDb(":memory:");
  const harvest = await import("./harvest.js");
  const { farmerDetail, farmerStats } = await import("./farmers.js");

  // 1. Seed to Lodwar creates a farmer group and a buy-back promise.
  const seed = await pay.createDonation(db, { destinationId: "lodwar", amountCents: 3000, goal: "", choices: ["sorghum:seed"] });
  await pay.captureDonation(db, seed.donationId, seed.orderId);
  await waitForPlan(db, seed.donationId);
  const [promise] = harvest.listCommitments(db) as any[];
  assert.ok(promise, "a commitment exists");
  assert.equal(promise.grower_id, "fg-lodwar");
  assert.equal(promise.status, "growing");
  assert.ok(promise.committed_kg > 0 && promise.committed_kg < promise.expected_kg);

  // 2. Harvest comes in; the next food donation to Lodwar buys it first.
  harvest.markHarvestReady(db, promise.id);
  const food = await pay.createDonation(db, { destinationId: "lodwar", amountCents: 20000, goal: "" });
  await pay.captureDonation(db, food.donationId, food.orderId);
  await waitForPlan(db, food.donationId);
  const fromGroup = db
    .prepare(`SELECT SUM(l.kg) kg FROM plan_lines l JOIN plans p ON p.id=l.plan_id WHERE p.donation_id=? AND l.grower_id='fg-lodwar'`)
    .get(food.donationId) as any;
  assert.ok(Math.abs(fromGroup.kg - promise.committed_kg) < 0.05, `bought ${fromGroup.kg} of ${promise.committed_kg}`);
  const after = (harvest.listCommitments(db) as any[]).find((c) => c.id === promise.id);
  assert.equal(after.status, "bought");

  // 3. Payouts reach the farmer group, with time-to-cash recorded.
  await pay.runPayoutBatch(db);
  const detail = farmerDetail(db, "fg-lodwar")!;
  assert.ok(detail.totals.paidCents > 0);
  assert.ok(detail.totals.medianHoursToCash !== null);
  assert.match(detail.cashOut.route, /M-Pesa/);
  assert.ok(farmerStats(db).toFarmerGroupsCents > 0);
});

test("farmer shop: farmer pays with PayPal, supplier is paid out, delivery tracked, ledger balances", async () => {
  const db = openDb(":memory:");
  const shop = await import("./shop.js");

  const catalog = shop.shopCatalog(db, "g-kitui-1");
  const bags = catalog.find((i) => i.cropId === "hermetic_bag")!;
  assert.ok(bags && bags.wholeUnits && bags.options.length >= 2);
  // Cheapest delivered first.
  assert.ok(bags.options[0].deliveredCentsPerUnit <= bags.options[1].deliveredCentsPerUnit);
  const best = bags.options[0];

  await assert.rejects(shop.createFarmerOrder(db, { buyerId: "g-kitui-1", supplierId: best.supplierId, cropId: "hermetic_bag", qty: 2.5, delivery: DEMO_DELIVERY }), /whole/);
  await assert.rejects(shop.createFarmerOrder(db, { buyerId: "s-katumani-1", supplierId: best.supplierId, cropId: "hermetic_bag", qty: 2, delivery: DEMO_DELIVERY }), /Only farmers/);

  const stockBefore = (db.prepare(`SELECT stock_kg s FROM offers WHERE grower_id=? AND crop_id='hermetic_bag'`).get(best.supplierId) as any).s;
  const o = await shop.createFarmerOrder(db, { buyerId: "g-kitui-1", supplierId: best.supplierId, cropId: "hermetic_bag", qty: 10, delivery: DEMO_DELIVERY });
  assert.equal(o.totalCents, Math.round(10 * best.unitCents) + Math.round(10 * best.deliveryCentsPerUnit));
  const cap = await shop.captureFarmerOrder(db, o.orderId, o.paypalOrderId);
  assert.equal(cap.status, "paid");
  await shop.captureFarmerOrder(db, o.orderId, o.paypalOrderId); // retry is harmless
  const stockAfter = (db.prepare(`SELECT stock_kg s FROM offers WHERE grower_id=? AND crop_id='hermetic_bag'`).get(best.supplierId) as any).s;
  assert.equal(stockBefore - stockAfter, 10);

  // Supplier is paid in the next batch; delivery moves along.
  const run = await pay.runPayoutBatch(db);
  assert.equal(run.totalCents, o.totalCents);
  assert.equal((await pay.runPayoutBatch(db)).batchId, null, "not paid twice");
  await assert.rejects(shop.refundFarmerOrder(db, o.orderId), /already been paid/);
  assert.equal(shop.advanceFarmerOrder(db, o.orderId), "shipped");
  assert.equal(shop.advanceFarmerOrder(db, o.orderId), "delivered");

  const l = pay.ledger(db);
  assert.equal(l.totals.farmerPurchasesCents, o.totalCents);
  assert.equal(l.totals.heldCents, 0);
  assert.equal(l.totals.receivedCents, 0, "farmer purchases are not counted as donations");

  // Refund before the supplier is paid puts stock back.
  const o2 = await shop.createFarmerOrder(db, { buyerId: "g-kitui-1", supplierId: best.supplierId, cropId: "hermetic_bag", qty: 3, delivery: DEMO_DELIVERY });
  await shop.captureFarmerOrder(db, o2.orderId, o2.paypalOrderId);
  await shop.refundFarmerOrder(db, o2.orderId);
  const stockFinal = (db.prepare(`SELECT stock_kg s FROM offers WHERE grower_id=? AND crop_id='hermetic_bag'`).get(best.supplierId) as any).s;
  assert.equal(stockFinal, stockAfter);
  assert.equal(pay.ledger(db).totals.heldCents, 0);
});

test("dispatch: big loads share a truck and save money; small loads go as part loads", async () => {
  const db = openDb(":memory:");
  const dispatch = await import("./dispatch.js");
  const give = async (dest: string, dollars: number) => {
    const d = await pay.createDonation(db, { destinationId: dest, amountCents: dollars * 100, goal: "" });
    await pay.captureDonation(db, d.donationId, d.orderId);
    await waitForPlan(db, d.donationId);
  };

  // Small: one $40 donation is far too little for its own truck.
  await give("garissa", 40);
  await pay.runPayoutBatch(db);
  const [small] = dispatch.proposeRuns(db);
  assert.equal(small.recommended, "part_loads");
  assert.ok(small.breakEvenKg === null || small.breakEvenKg > small.loadKg);
  const sentSmall = dispatch.dispatchRun(db, small.cargo.map((c) => c.key));
  assert.equal(sentSmall.mode, "part_loads");

  // Big: Lodwar and Kakuma together carry enough for a dedicated truck.
  await give("lodwar", 700);
  await give("kakuma", 500);
  await pay.runPayoutBatch(db);
  const runs = dispatch.proposeRuns(db);
  assert.ok(runs.every((r) => !r.stops.some((s) => /Uganda|Lira|Soroti|Moroto/.test(s.name))), "imports are collected at the Kenyan border");
  const run = runs.find((r) => r.recommended === "truck")!;
  assert.ok(run, "the heavy loads get a dedicated truck");
  assert.ok(run.stops[0].kind === "pickup" && run.stops.at(-1)!.kind === "drop", "pickups before drops");
  assert.ok(run.stops.some((s) => s.name === "Kakuma") && run.stops.some((s) => s.name === "Lodwar"));
  assert.ok(run.loadKg <= dispatch.TRUCK.capacityKg);
  assert.ok(run.savingsCents > 0 && run.costCents < run.separateCostCents);
  assert.ok(run.path.length > run.stops.length, "path follows the road network");

  const keys = run.cargo.map((c) => c.key);
  const sent = dispatch.dispatchRun(db, keys);
  assert.equal(sent.mode, "truck");
  const shipped = db.prepare(`SELECT COUNT(*) n FROM shipments WHERE run_id = ? AND status = 'shipped'`).get(sent.id) as any;
  assert.equal(shipped.n, keys.length);
  for (const r of dispatch.proposeRuns(db)) dispatch.dispatchRun(db, r.cargo.map((c) => c.key));
  assert.equal(dispatch.proposeRuns(db).length, 0, "nothing left to dispatch");
  assert.throws(() => dispatch.dispatchRun(db, keys), /no longer ready/);

  dispatch.deliverRun(db, sent.id);
  const delivered = db.prepare(`SELECT COUNT(*) n FROM shipments WHERE run_id = ? AND status = 'delivered'`).get(sent.id) as any;
  assert.equal(delivered.n, keys.length);
});

test("a refund made in the PayPal dashboard (verified webhook) undoes an unpaid plan, once", async () => {
  const db = openDb(":memory:");
  const stockBefore = (db.prepare(`SELECT SUM(stock_kg) s FROM offers`).get() as any).s;
  const { donationId, orderId } = await pay.createDonation(db, { destinationId: "marsabit", amountCents: 3000, goal: "" });
  await pay.captureDonation(db, donationId, orderId);
  await waitForPlan(db, donationId);
  const captureId = (db.prepare(`SELECT paypal_capture_id c FROM donations WHERE id = ?`).get(donationId) as any).c;
  const event = {
    id: "WH-REFUND-1",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { id: "REFUND-1", links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] },
  };
  await pay.handlePayPalEvent(db, event, false); // unverified: ignored
  assert.equal((db.prepare(`SELECT status FROM donations WHERE id = ?`).get(donationId) as any).status, "captured");
  await pay.handlePayPalEvent(db, event, true);
  await pay.handlePayPalEvent(db, event, true); // duplicate delivery is a no-op
  assert.equal((db.prepare(`SELECT status FROM donations WHERE id = ?`).get(donationId) as any).status, "refunded");
  assert.equal((db.prepare(`SELECT status FROM plans WHERE donation_id = ?`).get(donationId) as any).status, "cancelled");
  const stockAfter = (db.prepare(`SELECT SUM(stock_kg) s FROM offers`).get() as any).s;
  assert.ok(Math.abs(stockAfter - stockBefore) < 0.01, "stock released");
  assert.equal((await pay.runPayoutBatch(db)).batchId, null, "nothing paid for a refunded donation");
});

test("farmer shop: delivery details are required and stay off public pages; requests get shop suggestions", async () => {
  const db = openDb(":memory:");
  const shop = await import("./shop.js");
  const { farmerDetail } = await import("./farmers.js");
  const requests = await import("./requests.js");
  const bags = shop.shopCatalog(db, "g-kitui-1").find((i) => i.cropId === "hermetic_bag")!;
  const base = { buyerId: "g-kitui-1", supplierId: bags.options[0].supplierId, cropId: "hermetic_bag", qty: 2 };
  await assert.rejects(shop.createFarmerOrder(db, { ...base, delivery: { ...DEMO_DELIVERY, contactPhone: "call me" } }), /phone/);
  await assert.rejects(shop.createFarmerOrder(db, { ...base, delivery: { ...DEMO_DELIVERY, deliveryPoint: "" } }), /where to deliver/);
  const o = await shop.createFarmerOrder(db, { ...base, delivery: DEMO_DELIVERY });
  await shop.captureFarmerOrder(db, o.orderId, o.paypalOrderId);
  const pub = JSON.stringify(farmerDetail(db, "g-kitui-1"));
  assert.ok(!pub.includes("712 345 678") && !pub.includes("borehole"), "contact details not on the public farmer page");

  // No AI key in tests: keyword matching.
  const r = await requests.createRequest(db, "g-kitui-1", { need: "Weevils keep eating our stored grain", quantity: "20 sacks", budget: "60" });
  assert.equal(r.suggestions[0]?.cropId, "hermetic_bag");
  const r2 = await requests.createRequest(db, "g-kitui-1", { need: "A diesel water pump for the river plot" });
  assert.ok(r2.suggestions.some((s) => s.cropId === "drip_kit") || r2.note);
  await assert.rejects(requests.createRequest(db, "s-katumani-1", { need: "anything at all" }), /Only farmers/);
  requests.updateRequest(db, r2.id, "sourcing", "We're asking pump suppliers in Kitui.");
  const mine = requests.listRequests(db, { farmerId: "g-kitui-1" });
  assert.equal(mine.length, 2);
  assert.ok(!("contact_phone" in mine[0]));
});
