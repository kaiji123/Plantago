// Harvest buy-back: seed turns into income.
//
// When a plan sends seed to a destination, the families who plant it join the
// network as a farmer group, and Plantago promises to buy part of their harvest
// at a fair price. When the harvest is in, it becomes stock that later donations
// to that place buy first. The farmers are paid through PayPal Payouts like any
// other grower, so a donation becomes seed, then income, then food grown locally.
//
// This is a purchase commitment, not a loan: nothing is paid until crops exist.

import { growerPayPalEmail } from "./seed/kenya.js";
import { newId, now, type DB } from "./db.js";
import { successChance } from "./optimizer.js";
import type { AllocationLine } from "./optimizer.js";

export const BUYBACK = {
  /** Share of the expected harvest Plantago promises to buy; families keep the rest to eat. */
  share: 0.3,
  /** Fair price: the network's median price for the crop, plus this premium. */
  premium: 0.1,
};

export type CommitmentStatus = "growing" | "ready" | "bought" | "failed" | "cancelled";

export function farmerGroupId(destinationId: string): string {
  return `fg-${destinationId}`;
}

/** The farmer group for a destination, created the first time seed goes there. */
export function ensureFarmerGroup(db: DB, destinationId: string): string {
  const id = farmerGroupId(destinationId);
  const exists = db.prepare(`SELECT 1 FROM growers WHERE id = ?`).get(id);
  if (exists) return id;
  const d = db.prepare(`SELECT * FROM destinations WHERE id = ?`).get(destinationId) as any;
  db.prepare(
    `INSERT INTO growers (id, name, kind, town, county, lat, lng, paypal_email, country, transport)
     VALUES (?, ?, 'farmer_group', ?, ?, ?, ?, ?, 'Kenya', 'road')`,
  ).run(id, `${d.name} Farmer Group`, d.name, d.county, d.lat + 0.12, d.lng + 0.12, growerPayPalEmail(id));
  return id;
}

/** Median price across the network's Kenyan farms and co-ops, plus the fair-price premium. */
export function fairPriceCents(db: DB, cropId: string): number {
  const prices = (
    db
      .prepare(
        `SELECT o.price_cents_per_kg AS p FROM offers o JOIN growers g ON g.id = o.grower_id
          WHERE o.crop_id = ? AND g.kind IN ('farm','coop') ORDER BY p`,
      )
      .all(cropId) as { p: number }[]
  ).map((r) => r.p);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 50;
  return Math.round(median * (1 + BUYBACK.premium));
}

/** Called inside the plan transaction: one buy-back promise per seed line. */
export function createCommitments(db: DB, planId: string, destinationId: string, lines: AllocationLine[]): void {
  const dest = db.prepare(`SELECT climate FROM destinations WHERE id = ?`).get(destinationId) as { climate: any };
  const ins = db.prepare(
    `INSERT INTO harvest_commitments (id, plan_id, destination_id, grower_id, crop_id, seed_kg, expected_kg, committed_kg,
       price_cents_per_kg, status, due_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'growing',?,?,?)`,
  );
  for (const l of lines) {
    if (l.mode !== "grow_there") continue;
    const c = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(l.cropId) as any;
    if (!c || c.kind === "tool" || !c.harvest_per_seed_kg) continue;
    const groupId = ensureFarmerGroup(db, destinationId);
    const expected = l.kg * c.harvest_per_seed_kg * successChance(dest.climate, c.drought_tolerance);
    const committed = Math.round(expected * BUYBACK.share * 10) / 10;
    if (committed < 1) continue;
    const due = new Date(Date.now() + c.days_to_harvest * 86_400_000).toISOString();
    ins.run(newId("hc"), planId, destinationId, groupId, l.cropId, l.kg, Math.round(expected * 10) / 10, committed, fairPriceCents(db, l.cropId), due, now(), now());
  }
}

/** Harvest is in: the committed amount becomes stock that donations to this place buy first. */
export function markHarvestReady(db: DB, commitmentId: string): void {
  db.transaction(() => {
    const c = db.prepare(`SELECT * FROM harvest_commitments WHERE id = ?`).get(commitmentId) as any;
    if (!c) throw new Error("Unknown commitment");
    if (c.status !== "growing") throw new Error(`Commitment is already ${c.status}`);
    db.prepare(
      `INSERT INTO offers (grower_id, crop_id, price_cents_per_kg, stock_kg) VALUES (?,?,?,?)
       ON CONFLICT(grower_id, crop_id) DO UPDATE SET stock_kg = stock_kg + excluded.stock_kg, price_cents_per_kg = excluded.price_cents_per_kg`,
    ).run(c.grower_id, c.crop_id, c.price_cents_per_kg, c.committed_kg);
    db.prepare(`UPDATE harvest_commitments SET status='ready', harvested_at=?, updated_at=? WHERE id=?`).run(now(), now(), commitmentId);
  })();
}

export function markHarvestFailed(db: DB, commitmentId: string): void {
  const r = db.prepare(`UPDATE harvest_commitments SET status='failed', updated_at=? WHERE id=? AND status='growing'`).run(now(), commitmentId);
  if (r.changes !== 1) throw new Error("Only a growing harvest can be marked failed");
}

/** A plan bought from a farmer group: count it against their oldest open promises. */
export function recordBuyBack(db: DB, growerId: string, cropId: string, kg: number): void {
  let left = kg;
  const open = db
    .prepare(`SELECT * FROM harvest_commitments WHERE grower_id = ? AND crop_id = ? AND status = 'ready' ORDER BY harvested_at`)
    .all(growerId, cropId) as any[];
  for (const c of open) {
    if (left <= 0.001) break;
    const take = Math.min(left, c.committed_kg - c.bought_kg);
    const bought = Math.round((c.bought_kg + take) * 100) / 100;
    db.prepare(`UPDATE harvest_commitments SET bought_kg=?, status=?, updated_at=? WHERE id=?`).run(
      bought,
      // Orders are sized in whole cents, so the last few grams may be left over: treat that as done.
      bought >= c.committed_kg - Math.max(0.1, c.committed_kg * 0.005) ? "bought" : "ready",
      now(),
      c.id,
    );
    left -= take;
  }
}

/** Undo `recordBuyBack` when the buying donation is refunded. */
export function reverseBuyBack(db: DB, growerId: string, cropId: string, kg: number): void {
  let left = kg;
  const done = db
    .prepare(`SELECT * FROM harvest_commitments WHERE grower_id = ? AND crop_id = ? AND bought_kg > 0 ORDER BY updated_at DESC`)
    .all(growerId, cropId) as any[];
  for (const c of done) {
    if (left <= 0.001) break;
    const back = Math.min(left, c.bought_kg);
    db.prepare(`UPDATE harvest_commitments SET bought_kg=?, status='ready', updated_at=? WHERE id=?`).run(Math.round((c.bought_kg - back) * 100) / 100, now(), c.id);
    left -= back;
  }
}

/** A refunded seed plan never reached the farmers, so its promises lapse. */
export function cancelCommitmentsForPlan(db: DB, planId: string): void {
  db.prepare(`UPDATE harvest_commitments SET status='cancelled', updated_at=? WHERE plan_id=? AND status='growing'`).run(now(), planId);
}

export function listCommitments(db: DB, where: { planId?: string; growerId?: string } = {}) {
  const conds: string[] = [];
  const args: string[] = [];
  if (where.planId) (conds.push("h.plan_id = ?"), args.push(where.planId));
  if (where.growerId) (conds.push("h.grower_id = ?"), args.push(where.growerId));
  return db
    .prepare(
      `SELECT h.*, c.name AS crop_name, g.name AS grower_name, d.name AS destination
         FROM harvest_commitments h JOIN crops c ON c.id = h.crop_id JOIN growers g ON g.id = h.grower_id
         JOIN destinations d ON d.id = h.destination_id
        ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY h.created_at DESC`,
    )
    .all(...args);
}
