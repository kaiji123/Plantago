// Farmer earnings: what each supplier sold, what they were paid through PayPal,
// and how long it took from a donor's payment to cash in the supplier's account.

import type { DB } from "./db.js";
import { listCommitments } from "./harvest.js";
import { listFarmerOrders } from "./shop.js";

const FARMER_KINDS = ["farm", "coop", "farmer_group"];
const FAILED = ["FAILED", "RETURNED", "REVERSED", "BLOCKED", "DENIED"];

/** How a supplier typically turns a PayPal balance into cash they can spend. */
export function cashOutRoute(kind: string, country: string): { route: string; note: string } {
  if (kind === "farmer_group")
    return {
      route: "PayPal → group account → members by M-Pesa",
      note: "The group treasurer receives the payout and pays members by M-Pesa. That last step happens outside PayPal. Roadmap: Xoom transfers straight to each member's mobile wallet.",
    };
  if (country === "Kenya")
    return { route: "PayPal → M-Pesa", note: "Kenyan PayPal balances can be withdrawn to M-Pesa or a bank account." };
  return { route: "PayPal → local bank", note: `Withdrawal options depend on the account type in ${country}.` };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Hours from the donor's captured payment to the supplier's payout, per paid order line. */
function hoursToCash(db: DB, growerId?: string): number[] {
  const rows = db
    .prepare(
      `SELECT (julianday(po.paid_at) - julianday(d.captured_at)) * 24 AS h
         FROM plan_lines l JOIN payouts po ON po.id = l.payout_id
         JOIN plans p ON p.id = l.plan_id JOIN donations d ON d.id = p.donation_id
        WHERE po.paid_at IS NOT NULL AND d.captured_at IS NOT NULL ${growerId ? "AND l.grower_id = ?" : ""}`,
    )
    .all(...(growerId ? [growerId] : [])) as { h: number }[];
  return rows.map((r) => Math.max(0, r.h));
}

export function farmerStats(db: DB) {
  const paid = db
    .prepare(
      `SELECT g.kind, COALESCE(SUM(po.amount_cents),0) AS cents FROM payouts po JOIN growers g ON g.id = po.grower_id
        WHERE po.status NOT IN (${FAILED.map(() => "?").join(",")}) GROUP BY g.kind`,
    )
    .all(...FAILED) as { kind: string; cents: number }[];
  const toFarmers = paid.filter((p) => FARMER_KINDS.includes(p.kind)).reduce((a, p) => a + p.cents, 0);
  const toOthers = paid.filter((p) => !FARMER_KINDS.includes(p.kind)).reduce((a, p) => a + p.cents, 0);
  const toGroups = paid.find((p) => p.kind === "farmer_group")?.cents ?? 0;
  return { toFarmersCents: toFarmers, toSuppliersCents: toOthers, toFarmerGroupsCents: toGroups, medianHoursToCash: median(hoursToCash(db)) };
}

export function listFarmers(db: DB) {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.kind, g.town, g.county, g.country, g.transport,
              COALESCE(SUM(CASE WHEN po.status NOT IN (${FAILED.map(() => "?").join(",")}) THEN po.amount_cents END), 0) AS paid_cents,
              COUNT(po.id) AS payouts,
              MAX(po.paid_at) AS last_paid_at
         FROM growers g LEFT JOIN payouts po ON po.grower_id = g.id
        WHERE g.kind != 'importer'
        GROUP BY g.id`,
    )
    .all(...FAILED) as any[];
  return rows
    .map((r) => {
      const h = median(hoursToCash(db, r.id));
      return { ...r, median_hours_to_cash: h, cash_out: cashOutRoute(r.kind, r.country).route };
    })
    .sort((a, b) => b.paid_cents - a.paid_cents || a.name.localeCompare(b.name));
}

export function farmerDetail(db: DB, id: string) {
  const g = db.prepare(`SELECT id, name, kind, town, county, country, transport, lat, lng FROM growers WHERE id = ?`).get(id) as any;
  if (!g) return null;
  const sales = db
    .prepare(
      `SELECT l.id, l.crop_id, c.name AS crop, c.kind AS crop_kind, l.mode, l.kg, l.total_cents, d.captured_at, ds.name AS destination,
              p.donation_id, po.status AS payout_status, po.paid_at, po.paypal_item_id, pb.paypal_batch_id,
              (julianday(po.paid_at) - julianday(d.captured_at)) * 24 AS hours_to_cash
         FROM plan_lines l JOIN plans p ON p.id = l.plan_id AND p.status IN ('ready')
         JOIN donations d ON d.id = p.donation_id JOIN destinations ds ON ds.id = d.destination_id
         JOIN crops c ON c.id = l.crop_id
         LEFT JOIN payouts po ON po.id = l.payout_id LEFT JOIN payout_batches pb ON pb.id = po.batch_id
        WHERE l.grower_id = ? ORDER BY d.captured_at DESC`,
    )
    .all(id) as any[];
  const offers = db
    .prepare(`SELECT o.crop_id, c.name AS crop, c.unit, o.price_cents_per_kg, o.stock_kg FROM offers o JOIN crops c ON c.id = o.crop_id WHERE o.grower_id = ?`)
    .all(id);
  const paid = sales.filter((s) => s.paid_at && !FAILED.includes(s.payout_status));
  return {
    grower: g,
    cashOut: cashOutRoute(g.kind, g.country),
    totals: {
      paidCents: paid.reduce((a, s) => a + s.total_cents, 0),
      waitingCents: sales.filter((s) => !s.paid_at).reduce((a, s) => a + s.total_cents, 0),
      orders: sales.length,
      medianHoursToCash: median(paid.map((s) => Math.max(0, s.hours_to_cash))),
    },
    sales,
    offers,
    commitments: listCommitments(db, { growerId: id }),
    // Delivery contact details are for the operator only; farmer pages are public in this demo.
    purchases: listFarmerOrders(db, { buyerId: id }).map(({ contact_name, contact_phone, delivery_point, note, preferred_date, ...o }) => ({
      ...o,
      has_delivery_details: !!contact_phone,
    })),
  };
}
