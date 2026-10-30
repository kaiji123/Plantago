// Farmer shop: farmers spend their own money (typically PayPal earnings from
// Plantago) on tools and seed from the network. They pay with PayPal checkout,
// Plantago pays the supplier through PayPal Payouts and handles delivery.
// Plantago never holds farmers' money as a balance and charges no fee.

import { paypalSimulated } from "./config.js";
import { newId, now, type DB } from "./db.js";
import type { Cents } from "./money.js";
import { loadNetwork, route, transportCentsPerKg, type Destination, type Grower } from "./optimizer.js";
import * as paypal from "./paypal.js";
import { UserError } from "./payments.js";

const BUYER_KINDS = ["farm", "coop", "farmer_group"];
const MAX_ORDER_CENTS = 200_000;

/** Delivery is to the farmer's own location: road distance with a typical rural road factor. */
function deliveryPoint(b: Grower): Destination {
  return {
    id: b.id,
    name: b.name,
    county: b.county,
    lat: b.lat,
    lng: b.lng,
    climate: "semi_arid",
    needPhase: 0,
    peopleInNeed: 0,
    roadFactor: 1.4,
    partner: b.name,
  };
}

export interface ShopOption {
  supplierId: string;
  supplierName: string;
  town: string;
  country: string;
  transport: "road" | "sea";
  unitCents: number;
  deliveryCentsPerUnit: number;
  deliveredCentsPerUnit: number;
  stock: number;
  distanceKm: number;
  days: number;
}
export interface ShopItem {
  cropId: string;
  name: string;
  form: "tool" | "seed";
  unit: string;
  wholeUnits: boolean;
  options: ShopOption[];
}

function buyerOrThrow(db: DB, buyerId: string): Grower {
  const net = loadNetwork(db);
  const b = net.growers.get(buyerId);
  if (!b) throw new UserError("Unknown farmer", 404);
  if (!BUYER_KINDS.includes(b.kind)) throw new UserError("Only farmers, co-ops and farmer groups can use the shop");
  return b;
}

/** Tools and seed this farmer can buy, with delivered prices to their location (cheapest supplier first). */
export function shopCatalog(db: DB, buyerId: string): ShopItem[] {
  const net = loadNetwork(db);
  const b = buyerOrThrow(db, buyerId);
  const to = deliveryPoint(b);
  const items = new Map<string, ShopItem>();
  for (const o of net.offers) {
    const s = net.growers.get(o.growerId)!;
    if (s.kind !== "tool_maker" && s.kind !== "seed_supplier") continue;
    if (o.stockKg < 1) continue;
    const c = net.crops.get(o.cropId)!;
    const isTool = c.kind === "tool";
    const r = route(s, to);
    const perUnitDelivery = transportCentsPerKg(r) * (isTool ? c.kgPerUnit : 1);
    const item = items.get(c.id) ?? {
      cropId: c.id,
      name: isTool ? c.name : `${c.name} seed`,
      form: isTool ? ("tool" as const) : ("seed" as const),
      unit: isTool ? c.unit : "kg",
      wholeUnits: isTool,
      options: [],
    };
    item.options.push({
      supplierId: s.id,
      supplierName: s.name,
      town: s.town,
      country: s.country,
      transport: s.transport,
      unitCents: o.priceCentsPerKg,
      deliveryCentsPerUnit: Math.round(perUnitDelivery * 100) / 100,
      deliveredCentsPerUnit: Math.round((o.priceCentsPerKg + perUnitDelivery) * 100) / 100,
      stock: isTool ? Math.floor(o.stockKg) : Math.round(o.stockKg),
      distanceKm: Math.round(r.totalKm),
      days: r.days,
    });
    items.set(c.id, item);
  }
  for (const i of items.values()) i.options.sort((a, b) => a.deliveredCentsPerUnit - b.deliveredCentsPerUnit);
  return [...items.values()].sort((a, b) => (a.form === b.form ? a.name.localeCompare(b.name) : a.form === "tool" ? -1 : 1));
}

/** Price an order exactly as it will be charged. */
export function quote(db: DB, buyerId: string, supplierId: string, cropId: string, qty: number) {
  const item = shopCatalog(db, buyerId).find((i) => i.cropId === cropId);
  const opt = item?.options.find((o) => o.supplierId === supplierId);
  if (!item || !opt) throw new UserError("That supplier doesn't sell this item");
  if (!Number.isFinite(qty) || qty <= 0) throw new UserError("Enter a quantity");
  if (item.wholeUnits && !Number.isInteger(qty)) throw new UserError(`${item.name} is sold in whole ${item.unit}s`);
  if (!item.wholeUnits && Math.round(qty * 10) !== qty * 10) throw new UserError("Seed is sold in steps of 0.1 kg");
  if (qty > opt.stock) throw new UserError(`Only ${opt.stock} ${item.unit} in stock`);
  const goods: Cents = Math.round(qty * opt.unitCents);
  const delivery: Cents = Math.round(qty * opt.deliveryCentsPerUnit);
  if (goods + delivery > MAX_ORDER_CENTS) throw new UserError("Orders are limited to $2,000 in the demo");
  if (goods + delivery < 100) throw new UserError("Orders must be at least $1");
  return { item, opt, goods, delivery, total: goods + delivery };
}

export async function createFarmerOrder(db: DB, input: { buyerId: string; supplierId: string; cropId: string; qty: number }) {
  const q = quote(db, input.buyerId, input.supplierId, input.cropId, input.qty);
  const id = newId("fo");
  db.prepare(
    `INSERT INTO farmer_orders (id, buyer_id, supplier_id, crop_id, qty, goods_cents, delivery_cents, total_cents, status, distance_km, eta_days,
       simulated, delivery_history, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'created', ?, ?, ?, '[]', ?, ?)`,
  ).run(id, input.buyerId, input.supplierId, input.cropId, input.qty, q.goods, q.delivery, q.total, q.opt.distanceKm, q.opt.days, paypalSimulated ? 1 : 0, now(), now());
  const { orderId } = await paypal.createOrder({
    donationId: id,
    amountCents: q.total,
    description: `Plantago shop: ${input.qty} ${q.item.unit} ${q.item.name}, delivered`,
  });
  db.prepare(`UPDATE farmer_orders SET paypal_order_id = ? WHERE id = ?`).run(orderId, id);
  return { orderId: id, paypalOrderId: orderId, totalCents: q.total };
}

/** Capture payment, then reserve stock. If the stock is gone, refund straight away. */
export async function captureFarmerOrder(db: DB, id: string, paypalOrderId: string): Promise<{ status: string; message?: string }> {
  const o = db.prepare(`SELECT * FROM farmer_orders WHERE id = ?`).get(id) as any;
  if (!o) throw new UserError("Unknown order", 404);
  if (o.paypal_order_id !== paypalOrderId) throw new UserError("PayPal order does not match");
  if (o.status !== "created") return { status: o.status };
  const cap = await paypal.captureOrder({ orderId: paypalOrderId, donationId: id, amountCents: o.total_cents });
  if (cap.status !== "COMPLETED" || cap.amountCents !== o.total_cents) {
    db.prepare(`UPDATE farmer_orders SET status='failed', updated_at=? WHERE id=?`).run(now(), id);
    throw new UserError(`Payment was not completed (${cap.status})`, 402);
  }
  const reserved = db.transaction(() => {
    const r = db
      .prepare(`UPDATE offers SET stock_kg = stock_kg - ? WHERE grower_id = ? AND crop_id = ? AND stock_kg >= ?`)
      .run(o.qty, o.supplier_id, o.crop_id, o.qty);
    if (r.changes !== 1) return false;
    db.prepare(
      `UPDATE farmer_orders SET status='paid', paypal_capture_id=?, paid_at=?, updated_at=?,
         delivery_history=json_array(json_object('status','awaiting_payment','at',?)) WHERE id=? AND status='created'`,
    ).run(cap.captureId, now(), now(), now(), id);
    return true;
  })();
  if (reserved) return { status: "paid" };
  db.prepare(`UPDATE farmer_orders SET paypal_capture_id=?, updated_at=? WHERE id=?`).run(cap.captureId, now(), id);
  const r = await paypal.refundCapture({ captureId: cap.captureId, donationId: id });
  db.prepare(`UPDATE farmer_orders SET status='refunded', paypal_refund_id=?, updated_at=? WHERE id=?`).run(r.refundId, now(), id);
  return { status: "refunded", message: "The supplier sold out while you were paying, so your payment was refunded." };
}

/** Refund a farmer's purchase, only before the supplier has been paid. */
export async function refundFarmerOrder(db: DB, id: string): Promise<void> {
  const o = db.prepare(`SELECT * FROM farmer_orders WHERE id = ?`).get(id) as any;
  if (!o) throw new UserError("Unknown order", 404);
  if (o.status === "refunded") return;
  if (o.status !== "paid") throw new UserError("Only paid orders can be refunded");
  // Mark first so a payout batch can't claim it while PayPal processes the refund.
  const locked = db.prepare(`UPDATE farmer_orders SET status='failed', updated_at=? WHERE id=? AND status='paid' AND payout_id IS NULL`).run(now(), id);
  if (locked.changes !== 1) throw new UserError("The supplier has already been paid for this order", 409);
  try {
    const r = await paypal.refundCapture({ captureId: o.paypal_capture_id, donationId: id });
    db.transaction(() => {
      db.prepare(`UPDATE farmer_orders SET status='refunded', paypal_refund_id=?, updated_at=? WHERE id=?`).run(r.refundId, now(), id);
      db.prepare(`UPDATE offers SET stock_kg = stock_kg + ? WHERE grower_id = ? AND crop_id = ?`).run(o.qty, o.supplier_id, o.crop_id);
    })();
  } catch (e) {
    db.prepare(`UPDATE farmer_orders SET status='paid', updated_at=? WHERE id=?`).run(now(), id);
    throw e;
  }
}

const NEXT: Record<string, string> = { sourced: "shipped", shipped: "delivered" };
export function advanceFarmerOrder(db: DB, id: string): string {
  const o = db.prepare(`SELECT delivery_status, status FROM farmer_orders WHERE id = ?`).get(id) as any;
  if (!o) throw new UserError("Unknown order", 404);
  if (o.status !== "paid") throw new UserError("Order is not active");
  const next = NEXT[o.delivery_status];
  if (!next) throw new UserError(o.delivery_status === "awaiting_payment" ? "Pay the supplier first" : "Already delivered");
  db.prepare(
    `UPDATE farmer_orders SET delivery_status=?, delivery_history=json_insert(delivery_history, '$[#]', json_object('status',?,'at',?)), updated_at=?
      WHERE id=? AND delivery_status=?`,
  ).run(next, next, now(), now(), id, o.delivery_status);
  return next;
}

export function listFarmerOrders(db: DB, where: { buyerId?: string; activeOnly?: boolean } = {}) {
  return (
    db
      .prepare(
        `SELECT o.*, c.name AS crop_name, c.kind AS crop_kind, c.unit, s.name AS supplier_name, s.town AS supplier_town, s.country AS supplier_country,
                b.name AS buyer_name, b.town AS buyer_town, po.status AS payout_status, po.paypal_item_id
           FROM farmer_orders o JOIN crops c ON c.id = o.crop_id JOIN growers s ON s.id = o.supplier_id JOIN growers b ON b.id = o.buyer_id
           LEFT JOIN payouts po ON po.id = o.payout_id
          WHERE ${where.buyerId ? "o.buyer_id = @buyer" : "1=1"} ${where.activeOnly ? "AND o.status = 'paid'" : "AND o.status != 'created'"}
          ORDER BY o.created_at DESC`,
      )
      .all(where.buyerId ? { buyer: where.buyerId } : {}) as any[]
  ).map((o) => ({ ...o, delivery_history: JSON.parse(o.delivery_history) }));
}

