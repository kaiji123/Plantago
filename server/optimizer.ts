// The optimizer does all the arithmetic. The AI planner chooses between the
// options it produces and explains the choice, but never sets prices or amounts.

import type { DB } from "./db.js";
import { assertCents, type Cents } from "./money.js";
import type { Climate, CropKind } from "./seed/kenya.js";

// ---- Assumptions (shown on the methodology panel) ----
export const ASSUMPTIONS = {
  mealKcal: 700, // one meal = a third of the 2,100 kcal/day Sphere standard ration
  dailyRationKcal: 2100,
  transportCentsPerTonneKm: 15, // ~$0.15 per tonne-km by truck on Kenyan roads
  handlingCentsPerKg: 2, // loading, bagging, storage at the partner
  truckKmPerDay: 350,
  minShelfLifeDays: 60, // food must keep at a remote distribution point
  minPulseShare: 0.2, // at least 20% of food spend on pulses for protein
  maxGrowerShareOfCereals: 0.5, // spread cereal orders across growers
  localRadiusKm: 250, // "local" growers get a small preference
  localPreference: 0.05, // default; the planner may raise it up to maxLocalPreference
  maxLocalPreference: 0.25,
  minLineCents: 500, // no order smaller than $5
  seedPackKg: 3, // seed handed to one farming household
  // Cross-border and sea freight
  borderCentsPerKg: 3, // customs, clearing agent, border fees
  borderDays: 2,
  seaCentsPerTonneKm: 1.7, // ~$75/tonne India→Mombasa in a shared container
  seaRouteFactor: 1.25, // shipping lanes vs great-circle distance
  seaKmPerDay: 550,
  portCentsPerKg: 5, // port handling and clearance at Mombasa
  portDays: 5,
  defaultToolShare: 0.4, // of the grow budget, when both seed and tools are chosen
};

export const MOMBASA = { lat: -4.0435, lng: 39.6682 };

const R_EARTH_KM = 6371;
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

// ---- Network snapshot ----
export interface Crop {
  id: string;
  name: string;
  kind: CropKind;
  kcalPerKg: number;
  proteinGPerKg: number;
  shelfLifeDays: number;
  growsIn: Climate[];
  harvestPerSeedKg: number;
  daysToHarvest: number;
  droughtTolerance: number;
  unit: string;
  kgPerUnit: number;
  mealsPerUnit: number;
  reliability: number;
}
export interface Destination {
  id: string;
  name: string;
  county: string;
  lat: number;
  lng: number;
  climate: Climate;
  needPhase: number;
  peopleInNeed: number;
  roadFactor: number;
  partner: string;
}
export interface Grower {
  id: string;
  name: string;
  kind: "farm" | "coop" | "seed_supplier" | "tool_maker" | "importer" | "farmer_group";
  town: string;
  county: string;
  country: string;
  transport: "road" | "sea";
  lat: number;
  lng: number;
  paypalEmail: string;
}
export interface Offer {
  growerId: string;
  cropId: string;
  priceCentsPerKg: number;
  stockKg: number;
}
export interface Network {
  crops: Map<string, Crop>;
  destinations: Map<string, Destination>;
  growers: Map<string, Grower>;
  offers: Offer[];
}

export function loadNetwork(db: DB): Network {
  const crops = new Map<string, Crop>();
  for (const r of db.prepare(`SELECT * FROM crops`).all() as any[]) {
    crops.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      kcalPerKg: r.kcal_per_kg,
      proteinGPerKg: r.protein_g_per_kg,
      shelfLifeDays: r.shelf_life_days,
      growsIn: JSON.parse(r.grows_in),
      harvestPerSeedKg: r.harvest_per_seed_kg,
      daysToHarvest: r.days_to_harvest,
      droughtTolerance: r.drought_tolerance,
      unit: r.unit ?? "kg",
      kgPerUnit: r.kg_per_unit ?? 1,
      mealsPerUnit: r.meals_per_unit ?? 0,
      reliability: r.reliability ?? 0,
    });
  }
  const destinations = new Map<string, Destination>();
  for (const r of db.prepare(`SELECT * FROM destinations`).all() as any[]) {
    destinations.set(r.id, {
      id: r.id,
      name: r.name,
      county: r.county,
      lat: r.lat,
      lng: r.lng,
      climate: r.climate,
      needPhase: r.need_phase,
      peopleInNeed: r.people_in_need,
      roadFactor: r.road_factor,
      partner: r.partner,
    });
  }
  const growers = new Map<string, Grower>();
  for (const r of db.prepare(`SELECT * FROM growers`).all() as any[]) {
    growers.set(r.id, { ...r, paypalEmail: r.paypal_email });
  }
  const offers = (db.prepare(`SELECT * FROM offers`).all() as any[]).map((r) => ({
    growerId: r.grower_id,
    cropId: r.crop_id,
    priceCentsPerKg: r.price_cents_per_kg,
    stockKg: r.stock_kg,
  }));
  return { crops, destinations, growers, offers };
}

// ---- Scoring ----
export interface RouteInfo {
  country: string;
  transport: "road" | "sea";
  roadKm: number;
  seaKm: number;
  totalKm: number;
  days: number;
  crossBorder: boolean;
}

export interface FoodOption extends RouteInfo {
  growerId: string;
  growerName: string;
  growerTown: string;
  growerKind: Grower["kind"];
  cropId: string;
  cropName: string;
  cropKind: CropKind;
  priceCentsPerKg: number;
  transportCentsPerKg: number;
  deliveredCentsPerKg: number;
  mealsPerKg: number;
  mealsPerUsd: number;
  stockKg: number;
  local: boolean;
  score: number;
  excludedReason?: string;
}

/** How goods get from a supplier to a destination: by road, or by sea to Mombasa then road. */
export function route(g: Pick<Grower, "lat" | "lng" | "country" | "transport">, d: Destination): RouteInfo {
  const crossBorder = (g.country ?? "Kenya") !== "Kenya";
  if (g.transport === "sea") {
    const seaKm = haversineKm(g, MOMBASA) * ASSUMPTIONS.seaRouteFactor;
    const roadKm = haversineKm(MOMBASA, d) * d.roadFactor;
    const days =
      Math.ceil(seaKm / ASSUMPTIONS.seaKmPerDay) + ASSUMPTIONS.portDays + Math.max(1, Math.ceil(roadKm / ASSUMPTIONS.truckKmPerDay));
    return { country: g.country, transport: "sea", roadKm: round1(roadKm), seaKm: round1(seaKm), totalKm: round1(seaKm + roadKm), days, crossBorder };
  }
  const roadKm = haversineKm(g, d) * d.roadFactor;
  const days = Math.max(1, Math.ceil(roadKm / ASSUMPTIONS.truckKmPerDay)) + (crossBorder ? ASSUMPTIONS.borderDays : 0);
  return { country: g.country ?? "Kenya", transport: "road", roadKm: round1(roadKm), seaKm: 0, totalKm: round1(roadKm), days, crossBorder };
}

/** Delivered transport cost per kg along a route. */
export function transportCentsPerKg(r: RouteInfo | number): number {
  const ri: RouteInfo = typeof r === "number" ? { country: "Kenya", transport: "road", roadKm: r, seaKm: 0, totalKm: r, days: 0, crossBorder: false } : r;
  return (
    (ri.roadKm * ASSUMPTIONS.transportCentsPerTonneKm) / 1000 +
    ASSUMPTIONS.handlingCentsPerKg +
    (ri.seaKm * ASSUMPTIONS.seaCentsPerTonneKm) / 1000 +
    (ri.transport === "sea" ? ASSUMPTIONS.portCentsPerKg : 0) +
    (ri.crossBorder ? ASSUMPTIONS.borderCentsPerKg : 0)
  );
}

/** All ways to buy ready food for a destination, best first. Excluded options are kept with a reason. */
export function foodNowOptions(net: Network, destinationId: string, localBoost = ASSUMPTIONS.localPreference): FoodOption[] {
  const d = net.destinations.get(destinationId);
  if (!d) throw new Error(`Unknown destination ${destinationId}`);
  const out: FoodOption[] = [];
  for (const o of net.offers) {
    const g = net.growers.get(o.growerId)!;
    if (g.kind === "seed_supplier" || g.kind === "tool_maker") continue;
    const c = net.crops.get(o.cropId)!;
    if (c.kind === "tool") continue;
    const r = route(g, d);
    const t = transportCentsPerKg(r);
    const delivered = o.priceCentsPerKg + t;
    const mealsPerKg = c.kcalPerKg / ASSUMPTIONS.mealKcal;
    const mealsPerUsd = (mealsPerKg / delivered) * 100;
    const local = !r.crossBorder && r.roadKm <= ASSUMPTIONS.localRadiusKm;
    let excludedReason: string | undefined;
    if (c.shelfLifeDays < ASSUMPTIONS.minShelfLifeDays)
      excludedReason = `spoils in ${c.shelfLifeDays} days; needs ${ASSUMPTIONS.minShelfLifeDays}+ at a remote distribution point`;
    else if (o.stockKg < 1) excludedReason = "out of stock";
    out.push({
      growerId: g.id,
      growerName: g.name,
      growerTown: g.town,
      growerKind: g.kind,
      cropId: c.id,
      cropName: c.name,
      cropKind: c.kind,
      ...r,
      priceCentsPerKg: o.priceCentsPerKg,
      transportCentsPerKg: round2(t),
      deliveredCentsPerKg: round2(delivered),
      mealsPerKg: round2(mealsPerKg),
      mealsPerUsd: round2(mealsPerUsd),
      stockKg: o.stockKg,
      local,
      score: round2(mealsPerUsd * (local ? 1 + localBoost : 1)),
      excludedReason,
    });
  }
  return out.sort((a, b) => Number(!!a.excludedReason) - Number(!!b.excludedReason) || b.score - a.score);
}

export interface SeedOption extends RouteInfo {
  growerId: string;
  growerName: string;
  growerTown: string;
  cropId: string;
  cropName: string;
  cropKind: CropKind;
  seedCentsPerKg: number;
  transportCentsPerKg: number;
  deliveredCentsPerKg: number;
  successChance: number;
  expectedHarvestKgPerSeedKg: number;
  expectedMealsPerUsd: number;
  daysToHarvest: number;
  stockKg: number;
  score: number;
  excludedReason?: string;
}

/** Chance a rain-fed crop gives a fair harvest, from climate and drought tolerance. */
export function successChance(climate: Climate, droughtTolerance: number): number {
  const base: Record<Climate, [number, number]> = {
    arid: [0.15, 0.5],
    semi_arid: [0.45, 0.45],
    highland: [0.7, 0.2],
    humid: [0.75, 0.15],
  };
  const [b, k] = base[climate];
  return round2(Math.min(0.95, b + k * droughtTolerance));
}

/** Kenya's two rainy seasons: long rains (Mar–May) and short rains (Oct–Dec). */
export function plantingWindow(date = new Date()): { open: boolean; season: string; next: string } {
  const m = date.getUTCMonth() + 1;
  if (m >= 3 && m <= 4) return { open: true, season: "long rains (Mar–May)", next: "now" };
  if (m >= 10 && m <= 11) return { open: true, season: "short rains (Oct–Dec)", next: "now" };
  const next = m < 3 || m === 12 ? "March (long rains)" : "October (short rains)";
  return { open: false, season: "dry season", next };
}

export function growThereOptions(net: Network, destinationId: string): SeedOption[] {
  const d = net.destinations.get(destinationId);
  if (!d) throw new Error(`Unknown destination ${destinationId}`);
  const out: SeedOption[] = [];
  for (const o of net.offers) {
    const g = net.growers.get(o.growerId)!;
    if (g.kind !== "seed_supplier") continue;
    const c = net.crops.get(o.cropId)!;
    const r = route(g, d);
    const t = transportCentsPerKg(r);
    const delivered = o.priceCentsPerKg + t;
    const p = successChance(d.climate, c.droughtTolerance);
    const expectedKg = c.harvestPerSeedKg * p;
    const expectedMealsPerUsd = ((expectedKg * c.kcalPerKg) / ASSUMPTIONS.mealKcal / delivered) * 100;
    let excludedReason: string | undefined;
    if (!c.growsIn.includes(d.climate)) excludedReason = `${c.name} is not suited to ${d.climate.replace("_", "-")} land`;
    else if (o.stockKg < 1) excludedReason = "out of stock";
    out.push({
      growerId: g.id,
      growerName: g.name,
      growerTown: g.town,
      cropId: c.id,
      cropName: c.name,
      cropKind: c.kind,
      ...r,
      seedCentsPerKg: o.priceCentsPerKg,
      transportCentsPerKg: round2(t),
      deliveredCentsPerKg: round2(delivered),
      successChance: p,
      expectedHarvestKgPerSeedKg: round1(expectedKg),
      expectedMealsPerUsd: round1(expectedMealsPerUsd),
      daysToHarvest: c.daysToHarvest,
      stockKg: o.stockKg,
      score: round1(expectedMealsPerUsd),
      excludedReason,
    });
  }
  return out.sort((a, b) => Number(!!a.excludedReason) - Number(!!b.excludedReason) || b.score - a.score);
}

export interface ToolOption extends RouteInfo {
  growerId: string;
  growerName: string;
  growerTown: string;
  cropId: string;
  cropName: string;
  unit: string;
  unitCents: number;
  transportCentsPerUnit: number;
  deliveredCentsPerUnit: number;
  reliability: number;
  expectedMealsPerUnit: number;
  expectedMealsPerUsd: number;
  stockUnits: number;
  score: number;
}

/** Tools that help families grow or keep more food, from any tool maker in the network. */
export function toolOptions(net: Network, destinationId: string): ToolOption[] {
  const d = net.destinations.get(destinationId);
  if (!d) throw new Error(`Unknown destination ${destinationId}`);
  const out: ToolOption[] = [];
  for (const o of net.offers) {
    const c = net.crops.get(o.cropId)!;
    if (c.kind !== "tool") continue;
    const g = net.growers.get(o.growerId)!;
    const r = route(g, d);
    const tUnit = transportCentsPerKg(r) * c.kgPerUnit;
    const delivered = o.priceCentsPerKg + tUnit;
    const expected = c.mealsPerUnit * c.reliability;
    out.push({
      growerId: g.id,
      growerName: g.name,
      growerTown: g.town,
      cropId: c.id,
      cropName: c.name,
      unit: c.unit,
      ...r,
      unitCents: o.priceCentsPerKg,
      transportCentsPerUnit: round2(tUnit),
      deliveredCentsPerUnit: round2(delivered),
      reliability: c.reliability,
      expectedMealsPerUnit: round1(expected),
      expectedMealsPerUsd: round1((expected / delivered) * 100),
      stockUnits: Math.floor(o.stockKg),
      score: round1((expected / delivered) * 100),
    });
  }
  return out.filter((o) => o.stockUnits >= 1).sort((a, b) => b.score - a.score);
}

// ---- Allocation ----
export interface AllocationLine {
  growerId: string;
  growerName: string;
  cropId: string;
  cropName: string;
  mode: "food_now" | "grow_there";
  kg: number;
  goodsCents: Cents;
  transportCents: Cents;
  totalCents: Cents;
  meals: number;
  roadKm: number;
  days: number;
}

export interface Allocation {
  destinationId: string;
  budgetCents: Cents;
  foodNowShare: number;
  localBoost: number;
  lines: AllocationLine[];
  totals: {
    spentCents: Cents;
    unallocatedCents: Cents;
    mealsNow: number;
    expectedMealsAtHarvest: number;
    personDaysNow: number;
    householdsWithSeed: number;
    expectedMealsFromTools: number;
    tools: { name: string; units: number; unit: string }[];
    countries: string[];
    growersPaid: number;
    kgFood: number;
    kgSeed: number;
    proteinKg: number;
    avgMealsPerUsdNow: number;
    maxDeliveryDays: number;
    harvestInDays: number | null;
  };
  baseline: {
    description: string;
    mealsPerUsd: number;
    mealsForSameMoney: number;
    multiplier: number | null;
  } | null;
  notes: string[];
}

export interface AllocateInput {
  destinationId: string;
  budgetCents: Cents;
  foodNowShare: number;
  excludeGrowerIds?: string[];
  /** Crops allowed as food now. Undefined = any; empty = none. */
  foodCropIds?: string[];
  /** Crops allowed as seed. Undefined = any; empty = none. */
  seedCropIds?: string[];
  /** Tools to include. Undefined or empty = none (tools are opt-in). */
  toolIds?: string[];
  /** Share of the grow budget spent on tools when seed is also bought. */
  toolShare?: number;
  /** Extra weight for growers within localRadiusKm, 0..maxLocalPreference. */
  localBoost?: number;
  now?: Date;
}

/**
 * Turn a budget into concrete orders. Deterministic: same input, same output.
 * Every line's total is whole cents and the lines never exceed the budget.
 */
export function allocate(net: Network, input: AllocateInput): Allocation {
  const { destinationId, budgetCents } = input;
  assertCents(budgetCents, "budget");
  if (budgetCents <= 0) throw new Error("Budget must be positive");
  const share = clamp(input.foodNowShare, 0, 1);
  const exclude = new Set(input.excludeGrowerIds ?? []);
  const foodOnly = input.foodCropIds ? new Set(input.foodCropIds) : null;
  const seedOnly = input.seedCropIds ? new Set(input.seedCropIds) : null;
  const d = net.destinations.get(destinationId);
  if (!d) throw new Error(`Unknown destination ${destinationId}`);
  const notes: string[] = [];
  const lines: AllocationLine[] = [];

  const foodBudget = Math.round(budgetCents * share);
  let growBudget = budgetCents - foodBudget;

  // --- Food now ---
  const localBoost = clamp(input.localBoost ?? ASSUMPTIONS.localPreference, 0, ASSUMPTIONS.maxLocalPreference);
  const food = foodNowOptions(net, destinationId, localBoost).filter(
    (o) => !o.excludedReason && !exclude.has(o.growerId) && (!foodOnly || foodOnly.has(o.cropId)) && o.growerKind !== "importer",
  );
  let foodLeft = foodBudget;
  if (foodBudget > 0) {
    if (food.length === 0) {
      notes.push("No ready food matched the choices; that money buys seed instead.");
      growBudget += foodBudget;
      foodLeft = 0;
    } else {
      // Harvest buy-back promises come first: farmers who grew Plantago seed get paid before anyone else.
      const promised = food.filter((o) => o.growerKind === "farmer_group");
      if (promised.length) {
        const spentOnPromises = fill(lines, promised, foodLeft, 1, "food_now");
        if (spentOnPromises > 0) notes.push("Buys back harvest from a farmer group that grew Plantago seed, as promised.");
        foodLeft -= spentOnPromises;
      }
      const pulses = food.filter((o) => o.cropKind === "pulse");
      const staples = food.filter((o) => o.cropKind !== "pulse");
      const pulseBudget = pulses.length ? Math.round(foodBudget * ASSUMPTIONS.minPulseShare) : 0;
      if (!pulses.length)
        notes.push(foodOnly ? "No beans or other pulses were chosen, so this food is low in protein." : "No pulses available; plan is low in protein.");
      foodLeft -= fill(lines, pulses, Math.min(pulseBudget, foodLeft), 1, "food_now");
      const capPerGrower = staples.length > 1 ? ASSUMPTIONS.maxGrowerShareOfCereals : 1;
      foodLeft -= fill(lines, staples, foodLeft, capPerGrower, "food_now");
      // Anything still left (stock limits, caps) goes to the best remaining option of any kind.
      if (foodLeft >= ASSUMPTIONS.minLineCents) foodLeft -= fill(lines, food, foodLeft, 1, "food_now");
    }
  }

  // --- Grow it there: seed, plus tools if asked for ---
  if (growBudget > 0) {
    const seeds = growThereOptions(net, destinationId).filter(
      (o) => !o.excludedReason && !exclude.has(o.growerId) && (!seedOnly || seedOnly.has(o.cropId)),
    );
    const toolIds = input.toolIds ?? [];
    const tools = toolIds.length
      ? toolOptions(net, destinationId).filter((o) => toolIds.includes(o.cropId) && !exclude.has(o.growerId))
      : [];
    if (seeds.length === 0 && tools.length === 0) {
      notes.push("No suitable seed or tools matched the choices; that money buys food instead.");
      foodLeft += growBudget;
      foodLeft -= fill(lines, food, foodLeft, 1, "food_now");
      growBudget = 0;
    } else {
      const toolShare = seeds.length === 0 ? 1 : tools.length === 0 ? 0 : clamp(input.toolShare ?? ASSUMPTIONS.defaultToolShare, 0, 1);
      // Every chosen tool type should get at least one unit if the grow budget allows it.
      const types = [...new Set(tools.map((t) => t.cropId))];
      const cheapest = (id: string) => Math.ceil(Math.min(...tools.filter((t) => t.cropId === id).map((t) => t.deliveredCentsPerUnit)));
      const minForAll = types.reduce((a, id) => a + cheapest(id), 0);
      const toolBudget = Math.min(growBudget, Math.max(Math.round(growBudget * toolShare), toolShare > 0 ? minForAll : 0));
      let growLeft = growBudget;

      // Tools: split across the chosen tool types (at least one unit each), best supplier first.
      if (toolBudget > 0) {
        let toolLeft = toolBudget;
        // Reserve one unit of each type first, then share what's left evenly.
        const extra = toolBudget >= minForAll ? Math.floor((toolBudget - minForAll) / types.length) : 0;
        types.forEach((id, i) => {
          const want = toolBudget >= minForAll ? cheapest(id) + extra : Math.round(toolBudget / types.length);
          const part = i === types.length - 1 ? toolLeft : Math.min(toolLeft, want);
          let partLeft = part;
          for (const t of tools.filter((x) => x.cropId === id)) {
            if (partLeft < t.deliveredCentsPerUnit) continue;
            partLeft -= fillTool(lines, t, partLeft);
          }
          if (partLeft === part) notes.push(`${net.crops.get(id)!.name} costs ${(cheapest(id) / 100).toFixed(2)} USD delivered, more than this donation could set aside for it.`);
          toolLeft -= part - partLeft;
        });
        growLeft -= toolBudget - toolLeft;
      }

      // Seed: pair the best cereal with the best pulse so a household plants both.
      if (seeds.length) {
        const seedBudget = growLeft;
        const cereal = seeds.find((x) => x.cropKind === "cereal");
        const pulse = seeds.find((x) => x.cropKind === "pulse");
        const picks = [cereal, pulse].filter(Boolean) as SeedOption[];
        const shares = picks.length === 2 ? [0.6, 0.4] : [1];
        picks.forEach((x, i) => {
          const part = i === picks.length - 1 ? growLeft : Math.round(seedBudget * shares[i]);
          growLeft -= fillSeed(net, lines, x, part, destinationId);
        });
        for (const x of seeds) {
          if (growLeft < ASSUMPTIONS.minLineCents) break;
          if (picks.includes(x)) continue;
          growLeft -= fillSeed(net, lines, x, growLeft, destinationId);
        }
        const w = plantingWindow(input.now);
        if (!w.open) notes.push(`Outside the planting season; seed would be planted in ${w.next}.`);
      }
      // Leftover from stock limits goes to any remaining tool supplier.
      for (const t of tools) {
        if (growLeft < t.deliveredCentsPerUnit) continue;
        growLeft -= fillTool(lines, t, growLeft);
      }
      foodLeft += growLeft; // reported as unallocated below if still unused
    }
  }

  const merged = mergeLines(lines);
  const spent = merged.reduce((a, l) => a + l.totalCents, 0);
  if (spent > budgetCents) throw new Error("Allocation exceeded budget"); // invariant
  const nowLines = merged.filter((l) => l.mode === "food_now");
  const isTool = (l: AllocationLine) => net.crops.get(l.cropId)!.kind === "tool";
  const seedLines = merged.filter((l) => l.mode === "grow_there" && !isTool(l));
  const toolLines = merged.filter((l) => l.mode === "grow_there" && isTool(l));
  const mealsNow = sum(nowLines.map((l) => l.meals));
  const spentNow = sum(nowLines.map((l) => l.totalCents));
  const proteinKg = sum(
    nowLines.map((l) => (l.kg * (net.crops.get(l.cropId)!.proteinGPerKg ?? 0)) / 1000),
  );
  const harvestDays = seedLines.length
    ? Math.max(...seedLines.map((l) => net.crops.get(l.cropId)!.daysToHarvest))
    : null;

  // Baseline: imported rice, the common default for aid shipments.
  const imp = foodNowOptions(net, destinationId).find((o) => o.growerKind === "importer" && o.cropId === "rice");
  const avgNow = spentNow > 0 ? (mealsNow / spentNow) * 100 : 0;
  const baseline = imp
    ? {
        description: `Imported rice via ${imp.growerTown}, ${Math.round(imp.roadKm)} km by road`,
        mealsPerUsd: imp.mealsPerUsd,
        mealsForSameMoney: round1((imp.mealsPerUsd * spentNow) / 100),
        multiplier: spentNow > 0 ? round2(avgNow / imp.mealsPerUsd) : null,
      }
    : null;

  return {
    destinationId,
    budgetCents,
    foodNowShare: share,
    localBoost,
    lines: merged,
    totals: {
      spentCents: spent,
      unallocatedCents: budgetCents - spent,
      mealsNow: round1(mealsNow),
      expectedMealsAtHarvest: round1(sum(seedLines.map((l) => l.meals))),
      personDaysNow: round1((mealsNow * ASSUMPTIONS.mealKcal) / ASSUMPTIONS.dailyRationKcal),
      householdsWithSeed: Math.floor(sum(seedLines.map((l) => l.kg)) / ASSUMPTIONS.seedPackKg),
      expectedMealsFromTools: round1(sum(toolLines.map((l) => l.meals))),
      tools: toolLines.map((l) => ({ name: l.cropName, units: l.kg, unit: net.crops.get(l.cropId)!.unit })),
      countries: [...new Set(merged.map((l) => net.growers.get(l.growerId)!.country))],
      growersPaid: new Set(merged.map((l) => l.growerId)).size,
      kgFood: round1(sum(nowLines.map((l) => l.kg))),
      kgSeed: round1(sum(seedLines.map((l) => l.kg))),
      proteinKg: round1(proteinKg),
      avgMealsPerUsdNow: round2(avgNow),
      maxDeliveryDays: merged.length ? Math.max(...merged.map((l) => l.days)) : 0,
      harvestInDays: harvestDays,
    },
    baseline,
    notes,
  };
}

function fill(
  lines: AllocationLine[],
  options: FoodOption[],
  budget: Cents,
  capShare: number,
  mode: "food_now",
): Cents {
  let left = budget;
  const cap = Math.floor(budget * capShare);
  const usedByGrower = new Map<string, number>();
  for (const o of options) {
    if (left < ASSUMPTIONS.minLineCents) break;
    const already = usedByGrower.get(o.growerId) ?? 0;
    const room = Math.min(left, cap - already);
    if (room < ASSUMPTIONS.minLineCents) continue;
    // Respect stock already committed by earlier lines in this plan.
    const committedKg = sum(lines.filter((l) => l.growerId === o.growerId && l.cropId === o.cropId).map((l) => l.kg));
    const stockLeft = o.stockKg - committedKg;
    const maxByStock = Math.floor(stockLeft * o.deliveredCentsPerKg);
    const total = Math.min(room, maxByStock);
    if (total < ASSUMPTIONS.minLineCents) continue;
    const kg = total / o.deliveredCentsPerKg;
    const goods = Math.round(kg * o.priceCentsPerKg);
    lines.push({
      growerId: o.growerId,
      growerName: o.growerName,
      cropId: o.cropId,
      cropName: o.cropName,
      mode,
      kg: round2(kg),
      goodsCents: goods,
      transportCents: total - goods,
      totalCents: total,
      meals: round1(kg * o.mealsPerKg),
      roadKm: o.totalKm,
      days: o.days,
    });
    usedByGrower.set(o.growerId, already + total);
    left -= total;
  }
  return budget - left;
}

function fillSeed(net: Network, lines: AllocationLine[], s: SeedOption, budget: Cents, destinationId: string): Cents {
  if (budget < ASSUMPTIONS.minLineCents) return 0;
  const maxByStock = Math.floor(s.stockKg * s.deliveredCentsPerKg);
  const total = Math.min(budget, maxByStock);
  if (total < ASSUMPTIONS.minLineCents) return 0;
  const kg = total / s.deliveredCentsPerKg;
  const goods = Math.round(kg * s.seedCentsPerKg);
  const c = net.crops.get(s.cropId)!;
  const expectedMeals = (kg * s.expectedHarvestKgPerSeedKg * c.kcalPerKg) / ASSUMPTIONS.mealKcal;
  void destinationId;
  lines.push({
    growerId: s.growerId,
    growerName: s.growerName,
    cropId: s.cropId,
    cropName: `${s.cropName} seed`,
    mode: "grow_there",
    kg: round2(kg),
    goodsCents: goods,
    transportCents: total - goods,
    totalCents: total,
    meals: round1(expectedMeals),
    roadKm: s.totalKm,
    days: s.days,
  });
  return total;
}

/** Whole units only: a tool can't be bought by the kilo. `kg` holds the unit count for tools. */
function fillTool(lines: AllocationLine[], t: ToolOption, budget: Cents): Cents {
  const committed = sum(lines.filter((l) => l.growerId === t.growerId && l.cropId === t.cropId).map((l) => l.kg));
  let units = Math.min(Math.floor(budget / t.deliveredCentsPerUnit), t.stockUnits - committed);
  while (units > 0 && Math.round(units * t.deliveredCentsPerUnit) > budget) units--;
  if (units < 1) return 0;
  const total = Math.round(units * t.deliveredCentsPerUnit);
  const goods = units * t.unitCents;
  lines.push({
    growerId: t.growerId,
    growerName: t.growerName,
    cropId: t.cropId,
    cropName: t.cropName,
    mode: "grow_there",
    kg: units,
    goodsCents: goods,
    transportCents: total - goods,
    totalCents: total,
    meals: round1(units * t.expectedMealsPerUnit),
    roadKm: t.totalKm,
    days: t.days,
  });
  return total;
}

function mergeLines(lines: AllocationLine[]): AllocationLine[] {
  const m = new Map<string, AllocationLine>();
  for (const l of lines) {
    const k = `${l.growerId}|${l.cropId}|${l.mode}`;
    const prev = m.get(k);
    if (!prev) m.set(k, { ...l });
    else {
      prev.kg = round2(prev.kg + l.kg);
      prev.goodsCents += l.goodsCents;
      prev.transportCents += l.transportCents;
      prev.totalCents += l.totalCents;
      prev.meals = round1(prev.meals + l.meals);
    }
  }
  return [...m.values()];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---- Catalog (what a donor can choose to send) ----
export interface CatalogItem {
  id: string; // "<cropId>:food", "<cropId>:seed" or "<cropId>:tool"
  cropId: string;
  name: string;
  form: "food" | "seed" | "tool";
  kind: CropKind;
  blurb: string;
  available: boolean;
  reason?: string;
  // food
  deliveredCentsPerKg?: number;
  mealsPerUsd?: number;
  proteinGPerKg?: number;
  shelfLifeDays?: number;
  // seed
  successChance?: number;
  expectedMealsPerUsd?: number;
  daysToHarvest?: number;
  seedMultiplier?: number;
  droughtTolerance?: number;
  // tools
  unit?: string;
  expectedMealsPerUnit?: number;
  reliability?: number;
  // all
  countries: string[];
  growers: number;
  nearestKm?: number;
  stockKg: number;
}

export function catalog(net: Network, destinationId: string, blurbs: Record<string, string> = {}): CatalogItem[] {
  const food = foodNowOptions(net, destinationId).filter((o) => o.growerKind !== "importer");
  const seed = growThereOptions(net, destinationId);
  const items: CatalogItem[] = [];
  const tools = toolOptions(net, destinationId);
  for (const c of net.crops.values()) {
    if (c.kind === "tool") {
      const t = tools.filter((o) => o.cropId === c.id);
      const best = t[0];
      items.push({
        id: `${c.id}:tool`,
        cropId: c.id,
        name: c.name,
        form: "tool",
        kind: c.kind,
        blurb: blurbs[c.id] ?? "",
        available: t.length > 0,
        reason: t.length ? undefined : "Out of stock",
        deliveredCentsPerKg: best?.deliveredCentsPerUnit,
        expectedMealsPerUsd: best?.expectedMealsPerUsd,
        unit: c.unit,
        expectedMealsPerUnit: best?.expectedMealsPerUnit,
        reliability: c.reliability,
        countries: [...new Set(t.map((o) => o.country))],
        growers: new Set(t.map((o) => o.growerId)).size,
        nearestKm: t.length ? Math.round(Math.min(...t.map((o) => o.totalKm))) : undefined,
        stockKg: t.reduce((a, o) => a + o.stockUnits, 0),
      });
      continue;
    }
    const f = food.filter((o) => o.cropId === c.id);
    const fOk = f.filter((o) => !o.excludedReason);
    const best = [...fOk].sort((a, b) => b.mealsPerUsd - a.mealsPerUsd)[0];
    items.push({
      id: `${c.id}:food`,
      cropId: c.id,
      name: c.name,
      form: "food",
      kind: c.kind,
      blurb: blurbs[c.id] ?? "",
      available: fOk.length > 0,
      reason: fOk.length ? undefined : f[0]?.excludedReason ?? "No Kenyan grower in the network sells it",
      deliveredCentsPerKg: best?.deliveredCentsPerKg,
      mealsPerUsd: best?.mealsPerUsd,
      proteinGPerKg: c.proteinGPerKg,
      shelfLifeDays: c.shelfLifeDays,
      droughtTolerance: c.droughtTolerance || undefined,
      countries: [...new Set(fOk.map((o) => o.country))],
      growers: new Set(fOk.map((o) => o.growerId)).size,
      nearestKm: fOk.length ? Math.round(Math.min(...fOk.map((o) => o.totalKm))) : undefined,
      stockKg: Math.round(fOk.reduce((a, o) => a + o.stockKg, 0)),
    });
    const sd = seed.filter((o) => o.cropId === c.id);
    if (sd.length === 0) continue; // not offered as seed anywhere
    const sOk = sd.filter((o) => !o.excludedReason);
    const sBest = [...sOk].sort((a, b) => b.expectedMealsPerUsd - a.expectedMealsPerUsd)[0];
    items.push({
      id: `${c.id}:seed`,
      cropId: c.id,
      name: `${c.name} seed`,
      form: "seed",
      kind: c.kind,
      blurb: blurbs[c.id] ?? "",
      available: sOk.length > 0,
      reason: sOk.length ? undefined : sd[0].excludedReason,
      deliveredCentsPerKg: sBest?.deliveredCentsPerKg,
      successChance: sBest?.successChance ?? successChance(net.destinations.get(destinationId)!.climate, c.droughtTolerance),
      expectedMealsPerUsd: sBest?.expectedMealsPerUsd,
      daysToHarvest: c.daysToHarvest,
      seedMultiplier: c.harvestPerSeedKg,
      droughtTolerance: c.droughtTolerance,
      countries: [...new Set(sOk.map((o) => o.country))],
      growers: new Set(sOk.map((o) => o.growerId)).size,
      nearestKm: sOk.length ? Math.round(Math.min(...sOk.map((o) => o.totalKm))) : undefined,
      stockKg: Math.round(sOk.reduce((a, o) => a + o.stockKg, 0)),
    });
  }
  // Available first, then food before seed, then best value.
  return items.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      FORM_ORDER[a.form] - FORM_ORDER[b.form] ||
      (b.mealsPerUsd ?? b.expectedMealsPerUsd ?? 0) - (a.mealsPerUsd ?? a.expectedMealsPerUsd ?? 0),
  );
}

/** Turn donor choices ("sorghum:food", "cowpeas:seed") into allocation filters. Empty choices = planner decides. */
const FORM_ORDER = { food: 0, seed: 1, tool: 2 } as const;

export function choicesToFilters(choices: string[]): {
  foodCropIds?: string[];
  seedCropIds?: string[];
  toolIds?: string[];
  forcedShare?: number;
} {
  if (!choices.length) return {};
  const of = (form: string) => choices.filter((c) => c.endsWith(`:${form}`)).map((c) => c.split(":")[0]);
  const food = of("food");
  const seed = of("seed");
  const tools = of("tool");
  const grow = seed.length + tools.length;
  return {
    foodCropIds: food,
    seedCropIds: seed,
    toolIds: tools,
    forcedShare: grow === 0 ? 1 : food.length === 0 ? 0 : undefined,
  };
}
