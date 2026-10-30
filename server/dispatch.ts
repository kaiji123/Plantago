// Dispatch: turn paid shipments into truck runs on the road network.
//
// 1. Collect shipments whose supplier has been paid (status "sourced") and that
//    aren't on a truck yet: donation deliveries and farmer-shop orders.
// 2. Cluster them by drop-off region (drops within CLUSTER_KM by road).
// 3. Pack each cluster into 3-tonne trucks (first-fit decreasing by weight).
// 4. Order each truck's stops: start at the pickup farthest from the drops,
//    visit pickups nearest-neighbour then improve with 2-opt, then deliver.
// 5. Price the run and compare with one truck per shipment.
//
// Sea freight is collected at Mombasa port; everything else at the supplier.

import { newId, now, type DB } from "./db.js";
import { DRIVING_HOURS_PER_DAY, MOMBASA_PORT, ROAD_NODES, roadPath, type RoadPath } from "./roads.js";
import { ASSUMPTIONS, SURFACE_COST } from "./optimizer.js";
import { UserError } from "./payments.js";

export const TRUCK = {
  name: "3-tonne truck",
  capacityKg: 3000,
  dayRateCents: 6000, // driver and truck hire, per day
  perKmCents: 45, // fuel and wear, per km on paved road
  stopHours: 1, // loading or unloading at each stop
};
/**
 * Part loads on scheduled commercial lorries. Small consignments pay several times the bulk
 * (full-truck) freight rate used in donor prices, plus a handling fee each. That premium is
 * what consolidation saves.
 */
export const PART_LOAD = {
  name: "Part loads on scheduled lorries",
  rateMultiplier: 3,
  consignmentFeeCents: 500,
};
const CLUSTER_KM = 250;

interface Point {
  lat: number;
  lng: number;
}
export interface Cargo {
  key: string; // "sh:<shipment id>" or "fo:<farmer order id>"
  kind: "donation" | "farmer_order";
  description: string;
  weightKg: number;
  pickup: Point & { id: string; name: string; note?: string };
  drop: Point & { id: string; name: string };
}
export interface Stop {
  kind: "pickup" | "drop";
  id: string;
  name: string;
  note?: string;
  lat: number;
  lng: number;
  cargo: string[]; // cargo keys loaded or unloaded here
  kg: number;
}
export interface RunPlan {
  key: string;
  vehicle: string;
  capacityKg: number;
  loadKg: number;
  stops: Stop[];
  km: number;
  hours: number;
  days: number;
  borderCrossings: number;
  roads: string[];
  path: [number, number][];
  /** Dedicated truck along the planned route. */
  truckCostCents: number;
  /** Each load as a part load on scheduled lorries. */
  partLoadCostCents: number;
  /** The cheaper of the two. */
  recommended: "truck" | "part_loads";
  costCents: number;
  /** Load at which a dedicated truck beats part loads on this route (null if not even a full truck would). */
  breakEvenKg: number | null;
  /** Every load on its own, each by its own cheaper option. */
  separateCostCents: number;
  separateKm: number;
  savingsCents: number;
  cargo: Cargo[];
}

// ---------- Collect ----------

export function readyCargo(db: DB): Cargo[] {
  const ships = db
    .prepare(
      `SELECT s.id, s.description, s.grower_id, g.name AS g_name, g.lat AS g_lat, g.lng AS g_lng, g.transport, g.country,
              d.id AS d_id, d.name AS d_name, d.lat AS d_lat, d.lng AS d_lng,
              (SELECT COALESCE(SUM(CASE WHEN c.kind = 'tool' THEN l.kg * c.kg_per_unit ELSE l.kg END), 0)
                 FROM plan_lines l JOIN crops c ON c.id = l.crop_id WHERE l.plan_id = s.plan_id AND l.grower_id = s.grower_id) AS kg
         FROM shipments s JOIN growers g ON g.id = s.grower_id JOIN destinations d ON d.id = s.destination_id
         JOIN plans p ON p.id = s.plan_id AND p.status = 'ready'
        WHERE s.status = 'sourced' AND s.run_id IS NULL`,
    )
    .all() as any[];
  const orders = db
    .prepare(
      `SELECT o.id, o.qty, c.kind, c.kg_per_unit, c.name AS crop, s.name AS g_name, s.lat AS g_lat, s.lng AS g_lng, s.transport, s.country,
              b.id AS b_id, b.name AS b_name, b.lat AS b_lat, b.lng AS b_lng
         FROM farmer_orders o JOIN crops c ON c.id = o.crop_id JOIN growers s ON s.id = o.supplier_id JOIN growers b ON b.id = o.buyer_id
        WHERE o.status = 'paid' AND o.delivery_status = 'sourced' AND o.run_id IS NULL`,
    )
    .all() as any[];

  // Imports are handed over in Kenya: sea freight at Mombasa port, cross-border road freight at the
  // Kenyan border post on the route. The supplier's leg up to there is part of their delivered price.
  const pickupFor = (r: any, drop: Point) => {
    if (r.transport === "sea")
      return { id: "port:mombasa", name: "Mombasa port", note: `sea freight from ${r.g_name}, ${r.country}`, lat: MOMBASA_PORT.lat, lng: MOMBASA_PORT.lng };
    if (r.country && r.country !== "Kenya") {
      const post = roadPath({ lat: r.g_lat, lng: r.g_lng }, drop)
        .nodes.map((id) => ROAD_NODES.find((n) => n.id === id)!)
        .find((n) => n.border && n.country === "Kenya");
      if (post) return { id: `border:${post.id}`, name: post.name, note: `cross-border delivery from ${r.g_name}, ${r.country}`, lat: post.lat, lng: post.lng };
    }
    return { id: `sup:${r.g_name}`, name: r.g_name, lat: r.g_lat, lng: r.g_lng };
  };

  return [
    ...ships.map((r) => ({
      key: `sh:${r.id}`,
      kind: "donation" as const,
      description: r.description,
      weightKg: Math.max(1, Math.round(r.kg * 10) / 10),
      pickup: pickupFor(r, { lat: r.d_lat, lng: r.d_lng }),
      drop: { id: `dest:${r.d_id}`, name: r.d_name, lat: r.d_lat, lng: r.d_lng },
    })),
    ...orders.map((r) => ({
      key: `fo:${r.id}`,
      kind: "farmer_order" as const,
      description: r.kind === "tool" ? `${r.qty} × ${String(r.crop).toLowerCase()}` : `${r.qty} kg ${String(r.crop).toLowerCase()} seed`,
      weightKg: Math.max(1, Math.round(r.qty * (r.kind === "tool" ? r.kg_per_unit : 1) * 10) / 10),
      pickup: pickupFor(r, { lat: r.b_lat, lng: r.b_lng }),
      drop: { id: `farm:${r.b_id}`, name: r.b_name, lat: r.b_lat, lng: r.b_lng },
    })),
  ];
}

// ---------- Plan ----------

const legKm = (a: Point, b: Point) => roadPath(a, b).km;
const costKm = (p: RoadPath) => p.km + p.surfaces.fair * (SURFACE_COST.fair - 1) + p.surfaces.rough * (SURFACE_COST.rough - 1);

function tripCost(km: number, costKmValue: number, hours: number, borders: number): { days: number; cents: number } {
  const days = Math.max(1, Math.ceil(hours / DRIVING_HOURS_PER_DAY)) + borders * ASSUMPTIONS.borderDays;
  return { days, cents: Math.round(days * TRUCK.dayRateCents + costKmValue * TRUCK.perKmCents) };
}

/** Group by drop-off region: a drop joins the first cluster whose anchor is within CLUSTER_KM by road. */
function cluster(cargo: Cargo[]): Cargo[][] {
  const groups: { anchor: Point; items: Cargo[] }[] = [];
  for (const c of [...cargo].sort((a, b) => a.drop.id.localeCompare(b.drop.id))) {
    const g = groups.find((x) => legKm(x.anchor, c.drop) <= CLUSTER_KM);
    if (g) g.items.push(c);
    else groups.push({ anchor: c.drop, items: [c] });
  }
  return groups.map((g) => g.items);
}

/** First-fit decreasing into trucks. A single load heavier than a truck gets its own truck(s). */
function pack(items: Cargo[]): Cargo[][] {
  const bins: { kg: number; items: Cargo[] }[] = [];
  for (const c of [...items].sort((a, b) => b.weightKg - a.weightKg)) {
    const bin = bins.find((b) => b.kg + c.weightKg <= TRUCK.capacityKg);
    if (bin) (bin.kg += c.weightKg), bin.items.push(c);
    else bins.push({ kg: c.weightKg, items: [c] });
  }
  return bins.map((b) => b.items);
}

function stopsFor(items: Cargo[], kind: "pickup" | "drop"): Stop[] {
  const by = new Map<string, Stop>();
  for (const c of items) {
    const p = kind === "pickup" ? c.pickup : c.drop;
    const s: Stop = by.get(p.id) ?? { kind, id: p.id, name: p.name, note: (p as { note?: string }).note, lat: p.lat, lng: p.lng, cargo: [], kg: 0 };
    s.cargo.push(c.key);
    s.kg = Math.round((s.kg + c.weightKg) * 10) / 10;
    by.set(p.id, s);
  }
  return [...by.values()];
}

function tourKm(stops: Stop[]): number {
  let km = 0;
  for (let i = 1; i < stops.length; i++) km += legKm(stops[i - 1], stops[i]);
  return km;
}

/** Nearest-neighbour from `start`, then 2-opt. Small n (a handful of stops), so brute-force improvement is fine. */
function orderStops(start: Stop, rest: Stop[], tail: Stop[] = []): Stop[] {
  const seq = [start];
  const left = [...rest];
  while (left.length) {
    const last = seq.at(-1)!;
    left.sort((a, b) => legKm(last, a) - legKm(last, b));
    seq.push(left.shift()!);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < seq.length - 1; i++)
      for (let j = i + 1; j < seq.length; j++) {
        const candidate = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
        if (tourKm([...candidate, ...tail]) + 0.5 < tourKm([...seq, ...tail])) {
          seq.splice(0, seq.length, ...candidate);
          improved = true;
        }
      }
  }
  return seq;
}

function planRun(items: Cargo[]): RunPlan {
  const pickups = stopsFor(items, "pickup");
  const drops = stopsFor(items, "drop");
  // Start at the pickup farthest from the drops, so the truck sweeps towards them.
  const far = [...pickups].sort((a, b) => legKm(b, drops[0]) - legKm(a, drops[0]))[0];
  const pickupSeq = orderStops(far, pickups.filter((p) => p !== far), drops.slice(0, 1));
  const lastPickup = pickupSeq.at(-1)!;
  const firstDrop = [...drops].sort((a, b) => legKm(lastPickup, a) - legKm(lastPickup, b))[0];
  const dropSeq = orderStops(firstDrop, drops.filter((d) => d !== firstDrop));
  const stops = [...pickupSeq, ...dropSeq];

  let km = 0;
  let cKm = 0;
  let hours = stops.length * TRUCK.stopHours;
  let borders = 0;
  const roads: string[] = [];
  const path: [number, number][] = [];
  for (let i = 1; i < stops.length; i++) {
    const leg = roadPath(stops[i - 1], stops[i]);
    km += leg.km;
    cKm += costKm(leg);
    hours += leg.hours;
    borders += leg.borderCrossings;
    for (const r of leg.roads) if (roads.at(-1) !== r) roads.push(r);
    path.push(...(path.length ? leg.coords.slice(1) : leg.coords));
  }
  const run = tripCost(km, cKm, hours, borders);

  // Part loads: each load pays the per-kg freight rate along its own route, plus a handling fee.
  const partLoad = (c: Cargo) => {
    const leg = roadPath(c.pickup, c.drop);
    const perKg = ((costKm(leg) * ASSUMPTIONS.transportCentsPerTonneKm) / 1000 + ASSUMPTIONS.handlingCentsPerKg) * PART_LOAD.rateMultiplier;
    return { cents: Math.round(c.weightKg * perKg + PART_LOAD.consignmentFeeCents), perKg, leg };
  };
  let partLoadCents = 0;
  let separateCents = 0;
  let separateKm = 0;
  let weightedPerKg = 0;
  for (const c of items) {
    const pl = partLoad(c);
    partLoadCents += pl.cents;
    weightedPerKg += pl.perKg * c.weightKg;
    separateKm += pl.leg.km;
    const ownTruck = tripCost(pl.leg.km, costKm(pl.leg), pl.leg.hours + 2 * TRUCK.stopHours, pl.leg.borderCrossings).cents;
    separateCents += Math.min(ownTruck, pl.cents);
  }
  const loadKg = items.reduce((a, c) => a + c.weightKg, 0);
  const recommended = run.cents <= partLoadCents ? ("truck" as const) : ("part_loads" as const);
  const chosen = Math.min(run.cents, partLoadCents);
  // Break-even: the load at which the truck costs the same as part loads (fees count once per consignment).
  const avgPerKg = weightedPerKg / Math.max(1, loadKg);
  const breakEven = (run.cents - items.length * PART_LOAD.consignmentFeeCents) / Math.max(0.01, avgPerKg);
  const keys = items.map((c) => c.key).sort();
  return {
    key: keys.join(","),
    vehicle: TRUCK.name,
    capacityKg: TRUCK.capacityKg,
    loadKg: Math.round(loadKg * 10) / 10,
    stops,
    km: Math.round(km),
    hours: Math.round(hours * 10) / 10,
    days: run.days,
    borderCrossings: borders,
    roads,
    path,
    truckCostCents: run.cents,
    partLoadCostCents: partLoadCents,
    recommended,
    costCents: chosen,
    breakEvenKg: breakEven <= TRUCK.capacityKg ? Math.max(0, Math.round(breakEven)) : null,
    separateCostCents: separateCents,
    separateKm: Math.round(separateKm),
    savingsCents: Math.max(0, separateCents - chosen),
    cargo: items,
  };
}

/**
 * Split off out-of-the-way pickups: if collecting a pickup's loads makes the run cost more than
 * sending those loads separately (usually as part loads), move them to their own run. Greedy,
 * one pickup at a time, until no split lowers the total.
 */
function splitOutliers(items: Cargo[]): Cargo[][] {
  const groups = [items];
  let improved = true;
  while (improved) {
    improved = false;
    for (let gi = 0; gi < groups.length && !improved; gi++) {
      const g = groups[gi];
      const pickups = [...new Set(g.map((c) => c.pickup.id))];
      if (pickups.length < 2) continue;
      const whole = planRun(g).costCents;
      for (const pid of pickups) {
        const out = g.filter((c) => c.pickup.id === pid);
        const rest = g.filter((c) => c.pickup.id !== pid);
        if (planRun(rest).costCents + planRun(out).costCents + 100 < whole) {
          groups.splice(gi, 1, rest, out);
          improved = true;
          break;
        }
      }
    }
  }
  return groups;
}

/** Proposed runs for everything ready to move. */
export function proposeRuns(db: DB, onlyKeys?: string[]): RunPlan[] {
  let cargo = readyCargo(db);
  if (onlyKeys) cargo = cargo.filter((c) => onlyKeys.includes(c.key));
  return cluster(cargo)
    .flatMap(pack)
    .flatMap(splitOutliers)
    .map(planRun)
    .sort((a, b) => b.savingsCents - a.savingsCents);
}

// ---------- Act ----------

/** Dispatch one run: re-plan from the server's own data (never trust the client's route), then mark its loads on the road. */
export function dispatchRun(db: DB, keys: string[], mode?: "truck" | "part_loads") {
  if (!keys.length) throw new UserError("No shipments chosen");
  const runs = proposeRuns(db, keys);
  const covered = new Set(runs.flatMap((r) => r.cargo.map((c) => c.key)));
  const missing = keys.filter((k) => !covered.has(k));
  if (missing.length) throw new UserError("Some shipments are no longer ready to dispatch. Refresh and try again.", 409);
  if (runs.length !== 1) throw new UserError("Those shipments don't fit on one truck run. Dispatch the proposed runs one at a time.");
  const run = runs[0];
  const useMode = mode ?? run.recommended;
  const cost = useMode === "truck" ? run.truckCostCents : run.partLoadCostCents;
  const id = newId("run");
  const at = now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO dispatch_runs (id, status, mode, vehicle, capacity_kg, load_kg, km, hours, days, cost_cents, separate_cost_cents, stops, path, roads, cargo, created_at, updated_at)
       VALUES (?, 'on_road', ?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      useMode,
      useMode === "truck" ? run.vehicle : PART_LOAD.name,
      run.capacityKg,
      run.loadKg,
      run.km,
      run.hours,
      run.days,
      cost,
      run.separateCostCents,
      JSON.stringify(run.stops),
      JSON.stringify(run.path),
      JSON.stringify(run.roads),
      JSON.stringify(run.cargo.map((c) => ({ key: c.key, kind: c.kind, description: c.description, weightKg: c.weightKg, from: c.pickup.name, to: c.drop.name }))),
      at,
      at,
    );
    for (const c of run.cargo) {
      const [kind, ref] = c.key.split(":");
      const r =
        kind === "sh"
          ? db
              .prepare(
                `UPDATE shipments SET status='shipped', run_id=?, history=json_insert(history,'$[#]',json_object('status','shipped','at',?)), updated_at=?
                  WHERE id=? AND status='sourced' AND run_id IS NULL`,
              )
              .run(id, at, at, ref)
          : db
              .prepare(
                `UPDATE farmer_orders SET delivery_status='shipped', run_id=?, delivery_history=json_insert(delivery_history,'$[#]',json_object('status','shipped','at',?)), updated_at=?
                  WHERE id=? AND delivery_status='sourced' AND run_id IS NULL`,
              )
              .run(id, at, at, ref);
      if (r.changes !== 1) throw new UserError("A shipment changed while dispatching. Refresh and try again.", 409);
    }
  })();
  return { id, mode: useMode, ...run, costCents: cost };
}

/** The truck has arrived: everything on it is delivered. */
export function deliverRun(db: DB, runId: string) {
  const at = now();
  db.transaction(() => {
    const r = db.prepare(`UPDATE dispatch_runs SET status='delivered', delivered_at=?, updated_at=? WHERE id=? AND status='on_road'`).run(at, at, runId);
    if (r.changes !== 1) throw new UserError("Run is not on the road");
    db.prepare(
      `UPDATE shipments SET status='delivered', history=json_insert(history,'$[#]',json_object('status','delivered','at',?)), updated_at=? WHERE run_id=? AND status='shipped'`,
    ).run(at, at, runId);
    db.prepare(
      `UPDATE farmer_orders SET delivery_status='delivered', delivery_history=json_insert(delivery_history,'$[#]',json_object('status','delivered','at',?)), updated_at=? WHERE run_id=? AND delivery_status='shipped'`,
    ).run(at, at, runId);
  })();
}

/** Dispatch runs, newest first. `ids` limits to specific runs (e.g. those carrying one donation). */
export function listRuns(db: DB, ids?: string[], limit = 50) {
  if (ids && ids.length === 0) return [];
  const rows = ids
    ? (db.prepare(`SELECT * FROM dispatch_runs WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...ids) as any[])
    : (db.prepare(`SELECT * FROM dispatch_runs ORDER BY created_at DESC LIMIT ?`).all(limit) as any[]);
  return rows.map((r) => ({
    ...r,
    stops: JSON.parse(r.stops),
    path: JSON.parse(r.path),
    roads: JSON.parse(r.roads),
    cargo: JSON.parse(r.cargo),
  }));
}

/** Runs that carried a plan's shipments. */
export function runsForPlan(db: DB, planId: string) {
  const ids = (db.prepare(`SELECT DISTINCT run_id FROM shipments WHERE plan_id = ? AND run_id IS NOT NULL`).all(planId) as { run_id: string }[]).map((r) => r.run_id);
  return listRuns(db, ids);
}

/** Runs that collected from a supplier or delivered a farmer's shop purchase. */
export function runsForGrower(db: DB, growerId: string) {
  const ids = (
    db
      .prepare(
        `SELECT run_id FROM shipments WHERE grower_id = ? AND run_id IS NOT NULL
         UNION SELECT run_id FROM farmer_orders WHERE (supplier_id = ? OR buyer_id = ?) AND run_id IS NOT NULL`,
      )
      .all(growerId, growerId, growerId) as { run_id: string }[]
  ).map((r) => r.run_id);
  return listRuns(db, ids);
}

/** Public logistics summary for the ledger's Deliveries tab. */
export function deliveryStats(db: DB) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS runs, COALESCE(SUM(km),0) AS km, COALESCE(SUM(load_kg),0) AS kg, COALESCE(SUM(cost_cents),0) AS cost,
              COALESCE(SUM(MAX(separate_cost_cents - cost_cents, 0)),0) AS saved,
              SUM(CASE WHEN mode='truck' THEN 1 ELSE 0 END) AS trucks,
              SUM(CASE WHEN status='on_road' THEN 1 ELSE 0 END) AS on_road
         FROM dispatch_runs`,
    )
    .get() as any;
  const waiting = (db.prepare(`SELECT COUNT(*) n FROM shipments WHERE status = 'sourced' AND run_id IS NULL`).get() as { n: number }).n;
  return { runs: r.runs, trucks: r.trucks ?? 0, onRoad: r.on_road ?? 0, km: Math.round(r.km), kg: Math.round(r.kg), costCents: r.cost, savedCents: r.saved, waitingLoads: waiting };
}
