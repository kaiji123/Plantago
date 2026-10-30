import { config } from "./config.js";
import { newId, now, type DB } from "./db.js";
import { createCommitments, recordBuyBack } from "./harvest.js";
import type { Allocation } from "./optimizer.js";
import { runAiPlanner, runRulesPlanner, type PlannerContext } from "./planner.js";

export interface PlanDraft {
  allocation: Allocation;
  headline: string;
  explanation: string;
  planner: "ai" | "rules";
  model: string | null;
  /** AI planner token usage and estimated cost, for the operator. */
  usage?: unknown;
}

export interface TraceEntry {
  at: string;
  kind: "tool" | "note" | "error";
  label: string;
  detail?: string;
}

export function appendTrace(db: DB, planId: string, e: Omit<TraceEntry, "at">): void {
  const row = db.prepare(`SELECT trace FROM plans WHERE id = ?`).get(planId) as { trace: string } | undefined;
  if (!row) return;
  const trace: TraceEntry[] = JSON.parse(row.trace);
  trace.push({ at: now(), ...e });
  db.prepare(`UPDATE plans SET trace = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(trace), now(), planId);
}

class StockConflict extends Error {}

/** "28.5 kg cowpeas seed", or "2 × hermetic storage bag (100 kg)" for tools (kg holds the unit count). */
function describeLine(db: DB, cropId: string, cropName: string, qty: number): string {
  const c = db.prepare(`SELECT kind FROM crops WHERE id = ?`).get(cropId) as { kind: string } | undefined;
  return c?.kind === "tool" ? `${qty} × ${cropName.toLowerCase()}` : `${Math.round(qty * 10) / 10} kg ${cropName.toLowerCase()}`;
}

/** Rewrite shipment load descriptions from their plan lines (fixes older rows that showed tools in kg). */
export function refreshShipmentDescriptions(db: DB): void {
  const rows = db
    .prepare(
      `SELECT s.id, l.crop_id, l.kg, l.mode, c.name FROM shipments s
         JOIN plan_lines l ON l.plan_id = s.plan_id AND l.grower_id = s.grower_id
         JOIN crops c ON c.id = l.crop_id`,
    )
    .all() as { id: string; crop_id: string; kg: number; mode: string; name: string }[];
  const byShipment = new Map<string, string[]>();
  for (const r of rows) {
    const name = r.mode === "grow_there" && !["hermetic_bag", "drip_kit", "hand_tools"].includes(r.crop_id) ? `${r.name} seed` : r.name;
    byShipment.set(r.id, [...(byShipment.get(r.id) ?? []), describeLine(db, r.crop_id, name, r.kg)]);
  }
  const upd = db.prepare(`UPDATE shipments SET description = ? WHERE id = ?`);
  db.transaction(() => {
    for (const [id, parts] of byShipment) upd.run(parts.join(", "), id);
  })();
}

/** Save a plan's lines, reserve grower stock and open shipments, all or nothing. */
function persistDraft(db: DB, planId: string, draft: PlanDraft): void {
  const a = draft.allocation;
  const tx = db.transaction(() => {
    const reserve = db.prepare(
      `UPDATE offers SET stock_kg = stock_kg - @kg WHERE grower_id = @g AND crop_id = @c AND stock_kg >= @kg`,
    );
    const insLine = db.prepare(
      `INSERT INTO plan_lines (id, plan_id, grower_id, crop_id, mode, kg, goods_cents, transport_cents, total_cents, meals, distance_km, days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const l of a.lines) {
      const r = reserve.run({ kg: l.kg, g: l.growerId, c: l.cropId });
      if (r.changes !== 1) throw new StockConflict(`${l.growerName} no longer has ${l.kg} kg of ${l.cropName}`);
      insLine.run(newId("ln"), planId, l.growerId, l.cropId, l.mode, l.kg, l.goodsCents, l.transportCents, l.totalCents, l.meals, l.roadKm, l.days);
      if (l.growerId.startsWith("fg-")) recordBuyBack(db, l.growerId, l.cropId, l.kg);
    }
    // Seed sent today comes with a promise to buy part of the harvest.
    createCommitments(db, planId, a.destinationId, a.lines);
    const byGrower = new Map<string, { desc: string[]; days: number }>();
    for (const l of a.lines) {
      const s = byGrower.get(l.growerId) ?? { desc: [], days: 0 };
      s.desc.push(describeLine(db, l.cropId, l.cropName, l.kg));
      s.days = Math.max(s.days, l.days);
      byGrower.set(l.growerId, s);
    }
    const insShip = db.prepare(
      `INSERT INTO shipments (id, plan_id, grower_id, destination_id, description, status, eta_days, history, updated_at)
       VALUES (?,?,?,?,?,'awaiting_payment',?,?,?)`,
    );
    for (const [growerId, s] of byGrower) {
      insShip.run(newId("sh"), planId, growerId, a.destinationId, s.desc.join(", "), s.days, JSON.stringify([{ status: "awaiting_payment", at: now() }]), now());
    }
    db.prepare(
      `UPDATE plans SET status='ready', planner=?, model=?, food_now_share=?, headline=?, explanation=?, summary=?, updated_at=? WHERE id=?`,
    ).run(
      draft.planner,
      draft.model,
      a.foodNowShare,
      draft.headline,
      draft.explanation,
      JSON.stringify({ totals: a.totals, baseline: a.baseline, notes: a.notes, localBoost: a.localBoost, budgetCents: a.budgetCents, usage: draft.usage ?? null }),
      now(),
      planId,
    );
  });
  tx();
}

/** Create a plan for a captured donation. Safe to call twice: the second call is a no-op. */
export async function planDonation(db: DB, donationId: string): Promise<void> {
  const d = db.prepare(`SELECT * FROM donations WHERE id = ?`).get(donationId) as any;
  if (!d || d.status !== "captured") return;
  const planId = newId("pl");
  const inserted = db
    .prepare(`INSERT OR IGNORE INTO plans (id, donation_id, status, trace, created_at, updated_at) VALUES (?,?, 'planning', '[]', ?, ?)`)
    .run(planId, donationId, now(), now());
  if (inserted.changes === 0) return; // already planned or planning

  const ctx: PlannerContext = {
    planId,
    donationId,
    destinationId: d.destination_id,
    budgetCents: d.amount_cents,
    goal: d.goal,
    choices: JSON.parse(d.choices ?? "[]"),
  };
  appendTrace(db, planId, { kind: "note", label: d.simulated ? "Payment confirmed (simulated)" : "Payment confirmed by PayPal", detail: d.paypal_capture_id });

  let draft: PlanDraft | null = null;
  if (config.planner.enabled) {
    try {
      appendTrace(db, planId, { kind: "note", label: "AI planner started", detail: config.planner.model });
      draft = await runAiPlanner(db, ctx);
    } catch (e) {
      console.error("[planner] AI planner failed:", e);
      appendTrace(db, planId, { kind: "error", label: "AI planner failed, using rules", detail: (e as Error).message.slice(0, 200) });
    }
  }
  try {
    if (!draft) draft = runRulesPlanner(db, ctx);
    try {
      persistDraft(db, planId, draft);
    } catch (e) {
      if (!(e instanceof StockConflict)) throw e;
      // Another plan took the stock first. Re-plan once on the fresh network.
      appendTrace(db, planId, { kind: "note", label: "Stock changed while planning; re-costing", detail: e.message });
      persistDraft(db, planId, runRulesPlanner(db, ctx));
    }
  } catch (e) {
    console.error("[planner] could not save plan:", e);
    db.prepare(`UPDATE plans SET status='failed', error=?, updated_at=? WHERE id=?`).run((e as Error).message, now(), planId);
  }
}

/** Plans left in 'planning' by a crash or restart get re-run on boot. */
export function resumeStuckPlans(db: DB): void {
  const stuck = db.prepare(`SELECT id, donation_id FROM plans WHERE status = 'planning'`).all() as { id: string; donation_id: string }[];
  for (const p of stuck) {
    db.prepare(`DELETE FROM plans WHERE id = ? AND status = 'planning'`).run(p.id);
    void planDonation(db, p.donation_id);
  }
}
