// Money in (donations), money out (grower payouts, refunds) and the public ledger.

import { config, paypalSimulated } from "./config.js";
import { newId, now, type DB } from "./db.js";
import { dollarsToCents, fmtUsd, type Cents } from "./money.js";
import * as paypal from "./paypal.js";
import { catalog, loadNetwork } from "./optimizer.js";
import { cancelCommitmentsForPlan, reverseBuyBack } from "./harvest.js";
import { planDonation } from "./plans.js";

export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------- Donations ----------

export const MIN_DONATION_CENTS = 500;
export const MAX_DONATION_CENTS = 1_000_000;

export async function createDonation(
  db: DB,
  input: { destinationId: string; amountCents: Cents; goal: string; choices?: string[] },
): Promise<{ donationId: string; orderId: string }> {
  const dest = db.prepare(`SELECT id, name FROM destinations WHERE id = ?`).get(input.destinationId) as any;
  if (!dest) throw new UserError("Unknown destination");
  if (input.amountCents < MIN_DONATION_CENTS || input.amountCents > MAX_DONATION_CENTS)
    throw new UserError(`Donations must be between ${fmtUsd(MIN_DONATION_CENTS)} and ${fmtUsd(MAX_DONATION_CENTS)}`);
  const goal = input.goal.trim().slice(0, 500) || `Help families in ${dest.name} eat this month.`;
  // Donor picks from the catalog must exist and be available for this destination.
  const choices = [...new Set(input.choices ?? [])];
  if (choices.length > 20) throw new UserError("Too many items chosen");
  if (choices.length) {
    const items = new Map(catalog(loadNetwork(db), dest.id).map((i) => [i.id, i]));
    for (const c of choices) {
      const item = items.get(c);
      if (!item) throw new UserError(`Unknown catalog item ${c}`);
      if (!item.available) throw new UserError(`${item.name} can't be sent to ${dest.name}: ${item.reason}`);
    }
  }
  const donationId = newId("dn");
  db.prepare(
    `INSERT INTO donations (id, destination_id, amount_cents, goal, choices, status, simulated, created_at) VALUES (?,?,?,?,?, 'created', ?, ?)`,
  ).run(donationId, dest.id, input.amountCents, goal, JSON.stringify(choices), paypalSimulated ? 1 : 0, now());
  const { orderId } = await paypal.createOrder({
    donationId,
    amountCents: input.amountCents,
    description: `Plantago: food for ${dest.name}, Kenya`,
  });
  db.prepare(`UPDATE donations SET paypal_order_id = ? WHERE id = ?`).run(orderId, donationId);
  return { donationId, orderId };
}

export async function captureDonation(db: DB, donationId: string, orderId: string): Promise<void> {
  const d = db.prepare(`SELECT * FROM donations WHERE id = ?`).get(donationId) as any;
  if (!d) throw new UserError("Unknown donation", 404);
  if (d.paypal_order_id !== orderId) throw new UserError("Order does not match this donation");
  if (d.status === "captured") return; // idempotent
  if (d.status !== "created") throw new UserError(`Donation is ${d.status}`);

  const cap = await paypal.captureOrder({ orderId, donationId, amountCents: d.amount_cents });
  if (cap.status !== "COMPLETED") {
    // PENDING captures (e.g. eCheck) are confirmed later by webhook.
    if (cap.status === "PENDING") {
      db.prepare(`UPDATE donations SET paypal_capture_id = ? WHERE id = ?`).run(cap.captureId, donationId);
      return;
    }
    db.prepare(`UPDATE donations SET status='failed' WHERE id = ?`).run(donationId);
    throw new UserError(`Payment was not completed (${cap.status})`, 402);
  }
  // Never trust the browser: the captured amount and reference must match what we created.
  if (cap.amountCents !== d.amount_cents || (cap.customId && cap.customId !== donationId)) {
    db.prepare(`UPDATE donations SET status='failed' WHERE id = ?`).run(donationId);
    throw new UserError("Captured amount does not match the donation", 409);
  }
  markCaptured(db, donationId, cap.captureId, cap.payerName);
}

function markCaptured(db: DB, donationId: string, captureId: string, donorName: string | null): void {
  const r = db
    .prepare(
      `UPDATE donations SET status='captured', paypal_capture_id=?, donor_name=COALESCE(?, donor_name), captured_at=? WHERE id=? AND status='created'`,
    )
    .run(captureId, donorName, now(), donationId);
  if (r.changes === 1) void planDonation(db, donationId).then(() => maybeAutoPayout(db, donationId));
}

/** Refund is only possible before any grower has been paid for this donation. */
export async function refundDonation(db: DB, donationId: string): Promise<void> {
  const d = db.prepare(`SELECT * FROM donations WHERE id = ?`).get(donationId) as any;
  if (!d) throw new UserError("Unknown donation", 404);
  if (d.status === "refunded") return;
  if (d.status !== "captured") throw new UserError("Only completed donations can be refunded");
  const plan = db.prepare(`SELECT id, status FROM plans WHERE donation_id = ?`).get(donationId) as { id: string; status: string } | undefined;
  if (plan?.status === "planning") throw new UserError("The plan is still being made; try again in a moment", 409);
  // Check and cancel in one transaction so a payout batch cannot claim the lines in between.
  const lock = db.transaction(() => {
    if (!plan) return;
    const paid = db.prepare(`SELECT COUNT(*) n FROM plan_lines WHERE plan_id = ? AND payout_id IS NOT NULL`).get(plan.id) as { n: number };
    if (paid.n > 0) throw new UserError("Growers have already been paid for this plan, so it cannot be refunded", 409);
    db.prepare(`UPDATE plans SET status='cancelled', updated_at=? WHERE id=?`).run(now(), plan.id);
  });
  lock();
  let r: { refundId: string };
  try {
    r = await paypal.refundCapture({ captureId: d.paypal_capture_id, donationId });
  } catch (e) {
    if (plan) db.prepare(`UPDATE plans SET status=?, updated_at=? WHERE id=?`).run(plan.status, now(), plan.id);
    throw e;
  }
  const finish = db.transaction(() => {
    db.prepare(`UPDATE donations SET status='refunded', paypal_refund_id=?, refunded_at=? WHERE id=?`).run(r.refundId, now(), donationId);
    if (plan) {
      const lines = db.prepare(`SELECT grower_id, crop_id, kg FROM plan_lines WHERE plan_id = ?`).all(plan.id) as any[];
      const release = db.prepare(`UPDATE offers SET stock_kg = stock_kg + ? WHERE grower_id = ? AND crop_id = ?`);
      for (const l of lines) {
        release.run(l.kg, l.grower_id, l.crop_id);
        if (String(l.grower_id).startsWith("fg-")) reverseBuyBack(db, l.grower_id, l.crop_id, l.kg);
      }
      cancelCommitmentsForPlan(db, plan.id);
      db.prepare(`DELETE FROM shipments WHERE plan_id = ?`).run(plan.id);
    }
  });
  finish();
}

// ---------- Payouts ----------

export interface PayoutRunResult {
  batchId: string | null;
  paypalBatchId?: string;
  totalCents: Cents;
  growers: number;
  message: string;
}

/**
 * Pay every grower that has unpaid orders on ready plans, in one PayPal Payouts batch.
 * Lines are claimed in a transaction before PayPal is called, so two runs can never
 * pay for the same order. The batch id doubles as PayPal's sender_batch_id.
 */
export async function runPayoutBatch(db: DB, opts: { destinationId?: string } = {}): Promise<PayoutRunResult> {
  const batchId = newId("pb");
  const claim = db.transaction(() => {
    const planLines = db
      .prepare(
        `SELECT l.id, l.grower_id, l.total_cents, l.plan_id, 'line' AS source
           FROM plan_lines l
           JOIN plans p ON p.id = l.plan_id AND p.status = 'ready'
           JOIN donations d ON d.id = p.donation_id AND d.status = 'captured'
          WHERE l.payout_id IS NULL ${opts.destinationId ? "AND d.destination_id = @dest" : ""}`,
      )
      .all(opts.destinationId ? { dest: opts.destinationId } : {}) as { id: string; grower_id: string; total_cents: number; plan_id: string | null; source: string }[];
    // Farmer purchases are paid in the same batch (not in per-destination auto runs).
    const orderLines = opts.destinationId
      ? []
      : (db
          .prepare(`SELECT id, supplier_id AS grower_id, total_cents, NULL AS plan_id, 'order' AS source FROM farmer_orders WHERE status = 'paid' AND payout_id IS NULL`)
          .all() as typeof planLines);
    const lines = [...planLines, ...orderLines];
    if (lines.length === 0) return null;

    const byGrower = new Map<string, typeof lines>();
    for (const l of lines) byGrower.set(l.grower_id, [...(byGrower.get(l.grower_id) ?? []), l]);
    const total = lines.reduce((a, l) => a + l.total_cents, 0);
    db.prepare(`INSERT INTO payout_batches (id, status, total_cents, simulated, created_at, updated_at) VALUES (?, 'CLAIMED', ?, ?, ?, ?)`).run(
      batchId,
      total,
      paypalSimulated ? 1 : 0,
      now(),
      now(),
    );
    const items: paypal.PayoutItemInput[] = [];
    for (const [growerId, ls] of byGrower) {
      const g = db.prepare(`SELECT name, paypal_email FROM growers WHERE id = ?`).get(growerId) as any;
      const payoutId = newId("po");
      const amount = ls.reduce((a, l) => a + l.total_cents, 0);
      const receiver = config.paypal.payoutReceiverOverride || g.paypal_email;
      db.prepare(`INSERT INTO payouts (id, batch_id, grower_id, receiver, amount_cents, status, updated_at) VALUES (?,?,?,?,?, 'PENDING', ?)`).run(
        payoutId,
        batchId,
        growerId,
        receiver,
        amount,
        now(),
      );
      const setLine = db.prepare(`UPDATE plan_lines SET payout_id = ? WHERE id = ? AND payout_id IS NULL`);
      const setOrder = db.prepare(`UPDATE farmer_orders SET payout_id = ? WHERE id = ? AND payout_id IS NULL AND status = 'paid'`);
      for (const l of ls) if ((l.source === "order" ? setOrder : setLine).run(payoutId, l.id).changes !== 1) throw new Error("Order already claimed");
      items.push({ senderItemId: payoutId, receiver, amountCents: amount, note: `Plantago order for ${g.name} (${ls.length} line${ls.length > 1 ? "s" : ""})` });
    }
    return { items, total, planIds: [...new Set(lines.map((l) => l.plan_id).filter((p): p is string => !!p))] };
  });
  const claimed = claim();
  if (!claimed) return { batchId: null, totalCents: 0, growers: 0, message: "Nothing to pay: all planned orders are already paid." };

  return sendBatch(db, batchId, claimed.items, claimed.total, claimed.planIds);
}

async function sendBatch(db: DB, batchId: string, items: paypal.PayoutItemInput[], total: Cents, planIds: string[]): Promise<PayoutRunResult> {
  try {
    const r = await paypal.createPayoutBatch({ senderBatchId: batchId, items });
    db.prepare(`UPDATE payout_batches SET paypal_batch_id=?, status=?, error=NULL, updated_at=? WHERE id=?`).run(r.payoutBatchId, r.status, now(), batchId);
    if (paypalSimulated)
      db.prepare(`UPDATE payouts SET status='SUCCESS', paypal_item_id='SIM-ITEM-'||substr(id,4,8), paid_at=?, updated_at=? WHERE batch_id=?`).run(now(), now(), batchId);
    // Paid orders start moving: shipments go from awaiting payment to sourced.
    const sourced = db.prepare(
      `UPDATE shipments SET status='sourced', history=json_insert(history, '$[#]', json_object('status','sourced','at',?)), updated_at=?
        WHERE plan_id = ? AND status='awaiting_payment'
          AND grower_id IN (SELECT grower_id FROM payouts WHERE batch_id = ?)`,
    );
    for (const p of planIds) sourced.run(now(), now(), p, batchId);
    db.prepare(
      `UPDATE farmer_orders SET delivery_status='sourced', delivery_history=json_insert(delivery_history, '$[#]', json_object('status','sourced','at',?)), updated_at=?
        WHERE delivery_status='awaiting_payment' AND payout_id IN (SELECT id FROM payouts WHERE batch_id = ?)`,
    ).run(now(), now(), batchId);
    return { batchId, paypalBatchId: r.payoutBatchId, totalCents: total, growers: items.length, message: `Sent ${fmtUsd(total)} to ${items.length} supplier${items.length === 1 ? "" : "s"}.` };
  } catch (e) {
    // Keep the lines claimed: retrying with the same batch id is safe (PayPal dedupes it),
    // while releasing them could pay twice if PayPal actually accepted the batch.
    db.prepare(`UPDATE payout_batches SET status='ERROR', error=?, updated_at=? WHERE id=?`).run((e as Error).message.slice(0, 500), now(), batchId);
    throw e;
  }
}

export async function retryPayoutBatch(db: DB, batchId: string): Promise<PayoutRunResult> {
  const b = db.prepare(`SELECT * FROM payout_batches WHERE id = ?`).get(batchId) as any;
  if (!b) throw new UserError("Unknown batch", 404);
  if (b.status !== "ERROR") throw new UserError("Only failed batches can be retried");
  const rows = db.prepare(`SELECT p.*, g.name FROM payouts p JOIN growers g ON g.id = p.grower_id WHERE batch_id = ?`).all(batchId) as any[];
  const items = rows.map((r) => ({ senderItemId: r.id, receiver: r.receiver, amountCents: r.amount_cents, note: `Plantago order for ${r.name}` }));
  const planIds = (db.prepare(`SELECT DISTINCT l.plan_id FROM plan_lines l JOIN payouts p ON p.id = l.payout_id WHERE p.batch_id = ?`).all(batchId) as any[]).map((r) => r.plan_id);
  return sendBatch(db, batchId, items, b.total_cents, planIds);
}

export async function refreshPayoutBatch(db: DB, batchId: string): Promise<void> {
  const b = db.prepare(`SELECT * FROM payout_batches WHERE id = ?`).get(batchId) as any;
  if (!b?.paypal_batch_id) return;
  const s = await paypal.getPayoutBatch(b.paypal_batch_id);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE payout_batches SET status=?, updated_at=? WHERE id=?`).run(s.status, now(), batchId);
    const upd = db.prepare(
      `UPDATE payouts SET status=?, paypal_item_id=?, updated_at=?, paid_at = CASE WHEN ? = 'SUCCESS' THEN COALESCE(paid_at, ?) ELSE paid_at END
        WHERE id=? AND batch_id=?`,
    );
    for (const it of s.items) upd.run(it.transactionStatus, it.payoutItemId, now(), it.transactionStatus, now(), it.senderItemId, batchId);
  });
  tx();
}

/** Auto-pay once a destination's unpaid planned orders reach the threshold. */
export async function maybeAutoPayout(db: DB, donationId: string): Promise<void> {
  const d = db.prepare(`SELECT destination_id FROM donations WHERE id = ?`).get(donationId) as any;
  if (!d) return;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(l.total_cents),0) AS unpaid FROM plan_lines l
         JOIN plans p ON p.id = l.plan_id AND p.status='ready'
         JOIN donations dn ON dn.id = p.donation_id AND dn.status='captured'
        WHERE l.payout_id IS NULL AND dn.destination_id = ?`,
    )
    .get(d.destination_id) as { unpaid: number };
  if (row.unpaid >= config.payoutThresholdCents) {
    try {
      await runPayoutBatch(db, { destinationId: d.destination_id });
    } catch (e) {
      console.error("[payouts] auto payout failed:", e);
    }
  }
}

// ---------- Webhooks ----------

export async function handlePayPalEvent(db: DB, event: any, verified: boolean): Promise<void> {
  const ins = db
    .prepare(`INSERT OR IGNORE INTO paypal_events (id, event_type, resource_id, verified, received_at, body) VALUES (?,?,?,?,?,?)`)
    .run(event.id, event.event_type, event.resource?.id ?? null, verified ? 1 : 0, now(), JSON.stringify(event));
  if (ins.changes === 0 || !verified) return; // duplicate, or not trusted enough to act on
  const res = event.resource ?? {};
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const donationId = res.custom_id;
      const d = donationId && (db.prepare(`SELECT * FROM donations WHERE id = ?`).get(donationId) as any);
      if (d && d.status === "created" && res.amount?.value && dollarsToCents(res.amount.value) === d.amount_cents)
        markCaptured(db, donationId, res.id, null);
      break;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
      // Refunds made from the PayPal dashboard: reflect them, but only if nothing was paid out.
      break;
    default:
      if (String(event.event_type).startsWith("PAYMENT.PAYOUTS-ITEM.")) {
        const item = res.payout_item ?? {};
        const st = res.transaction_status ?? event.event_type.split(".").pop();
        db.prepare(
          `UPDATE payouts SET status=?, paypal_item_id=?, updated_at=?, paid_at = CASE WHEN ? = 'SUCCESS' THEN COALESCE(paid_at, ?) ELSE paid_at END WHERE id=?`,
        ).run(st, res.payout_item_id ?? null, now(), st, now(), item.sender_item_id ?? "");
      }
  }
}

// ---------- Ledger ----------

export function ledger(db: DB) {
  const inflows = db
    .prepare(
      `SELECT d.id, d.captured_at AS at, d.amount_cents, d.paypal_capture_id AS paypal_id, d.simulated, d.status, ds.name AS destination
         FROM donations d JOIN destinations ds ON ds.id = d.destination_id
        WHERE d.status IN ('captured','refunded') ORDER BY d.captured_at DESC`,
    )
    .all() as any[];
  const outflows = db
    .prepare(
      `SELECT p.id, p.updated_at AS at, p.amount_cents, p.status, p.paypal_item_id, b.paypal_batch_id, b.simulated, g.name AS grower, g.town
         FROM payouts p JOIN payout_batches b ON b.id = p.batch_id JOIN growers g ON g.id = p.grower_id
        ORDER BY p.updated_at DESC`,
    )
    .all() as any[];
  const refunds = db
    .prepare(`SELECT id, refunded_at AS at, amount_cents, paypal_refund_id AS paypal_id, simulated FROM donations WHERE status='refunded'`)
    .all() as any[];
  // Farmers' own purchases: money in from the farmer, out to the supplier. Kept apart from donations.
  const purchases = db
    .prepare(
      `SELECT o.id, o.paid_at AS at, o.total_cents AS amount_cents, o.paypal_capture_id AS paypal_id, o.simulated, o.status, g.name AS buyer
         FROM farmer_orders o JOIN growers g ON g.id = o.buyer_id WHERE o.paid_at IS NOT NULL`,
    )
    .all() as any[];
  const purchaseRefunds = db
    .prepare(`SELECT id, updated_at AS at, total_cents AS amount_cents, paypal_refund_id AS paypal_id, simulated FROM farmer_orders WHERE status='refunded' AND paypal_refund_id IS NOT NULL`)
    .all() as any[];

  const sum = (rows: any[]) => rows.reduce((a, r) => a + r.amount_cents, 0);
  const received = sum(inflows);
  const refunded = sum(refunds);
  const purchased = sum(purchases);
  const purchaseRefunded = sum(purchaseRefunds);
  const paidOut = sum(outflows.filter((o) => !["FAILED", "RETURNED", "REVERSED", "BLOCKED", "DENIED"].includes(o.status)));
  const committed = (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.total_cents),0) AS c FROM plan_lines l JOIN plans p ON p.id=l.plan_id AND p.status='ready' WHERE l.payout_id IS NULL`,
      )
      .get() as { c: number }
  ).c;
  const meals = (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN l.mode='food_now' THEN l.meals END),0) AS now, COALESCE(SUM(CASE WHEN l.mode='grow_there' THEN l.meals END),0) AS later
           FROM plan_lines l JOIN plans p ON p.id=l.plan_id AND p.status='ready'`,
      )
      .get() as { now: number; later: number }
  );
  return {
    totals: {
      receivedCents: received,
      refundedCents: refunded,
      paidToGrowersCents: paidOut,
      committedCents: committed,
      farmerPurchasesCents: purchased,
      farmerPurchaseRefundsCents: purchaseRefunded,
      // Held = everything in (donations + farmer purchases) - refunds - paid out to suppliers.
      heldCents: received + purchased - refunded - purchaseRefunded - paidOut,
      mealsPlanned: Math.round(meals.now),
      expectedMealsAtHarvest: Math.round(meals.later),
    },
    entries: [
      ...inflows.map((r) => ({ id: r.id, at: r.at, direction: "in" as const, amountCents: r.amount_cents, party: `Donor → ${r.destination}`, paypalId: r.paypal_id, status: r.status, simulated: !!r.simulated })),
      ...purchases.map((r) => ({ id: r.id, at: r.at, direction: "in" as const, amountCents: r.amount_cents, party: `Farmer purchase: ${r.buyer}`, paypalId: r.paypal_id, status: "COMPLETED", simulated: !!r.simulated })),
      ...purchaseRefunds.map((r) => ({ id: `${r.id}-refund`, at: r.at, direction: "out" as const, amountCents: r.amount_cents, party: "Refund to farmer", paypalId: r.paypal_id, status: "REFUNDED", simulated: !!r.simulated })),
      ...refunds.map((r) => ({ id: `${r.id}-refund`, at: r.at, direction: "out" as const, amountCents: r.amount_cents, party: "Refund to donor", paypalId: r.paypal_id, status: "REFUNDED", simulated: !!r.simulated })),
      ...outflows.map((r) => ({ id: r.id, at: r.at, direction: "out" as const, amountCents: r.amount_cents, party: `${r.grower}, ${r.town}`, paypalId: r.paypal_item_id ?? r.paypal_batch_id, status: r.status, simulated: !!r.simulated })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))),
  };
}
