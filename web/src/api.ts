export interface AppConfig {
  paypalClientId: string | null;
  simulated: boolean;
  aiPlanner: boolean;
  plannerModel: string | null;
  operatorTokenRequired: boolean;
  plantingWindow: { open: boolean; season: string; next: string };
  assumptions: Record<string, number>;
}

export interface Destination {
  id: string;
  name: string;
  county: string;
  lat: number;
  lng: number;
  climate: string;
  need_phase: number;
  people_in_need: number;
  partner: string;
  donations: number;
  meals: number;
}

export interface GrowthInfo {
  growDays?: [number, number];
  waterMm?: [number, number];
  yieldTPerHa?: [number, number];
  propagation?: string;
  wiki: string;
}

export interface Article {
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
  license: string;
}

export interface CatalogItem {
  id: string;
  cropId: string;
  name: string;
  form: "food" | "seed" | "tool";
  kind: "cereal" | "pulse" | "tuber" | "tool";
  blurb: string;
  available: boolean;
  reason?: string;
  deliveredCentsPerKg?: number;
  mealsPerUsd?: number;
  proteinGPerKg?: number;
  shelfLifeDays?: number;
  successChance?: number;
  expectedMealsPerUsd?: number;
  daysToHarvest?: number;
  seedMultiplier?: number;
  droughtTolerance?: number;
  unit?: string;
  expectedMealsPerUnit?: number;
  reliability?: number;
  countries: string[];
  growers: number;
  nearestKm?: number;
  stockKg: number;
  suppliers: string[];
  growth: GrowthInfo | null;
}

export interface FlowGrower {
  id: string;
  name: string;
  kind: string;
  town: string;
  county: string;
  country: string;
  transport: "road" | "sea";
  lat: number;
  lng: number;
}
export interface NetDestination {
  id: string;
  name: string;
  county: string;
  lat: number;
  lng: number;
  need_phase: number;
  people_in_need: number;
}
export interface FlowEdge {
  grower_id: string;
  destination_id: string; // a destination id, or a farmer's grower id for shop deliveries
  mode: "food_now" | "grow_there" | "farmer_order";
  kg: number;
  cents: number;
  meals: number;
  plans: number;
  crops: string;
  status: "queued" | "paid" | "shipped" | "delivered";
  /** Polyline along the road network. */
  path?: [number, number][];
}
export interface Flows {
  growers: FlowGrower[];
  destinations: NetDestination[];
  edges: FlowEdge[];
}

export interface TraceEntry {
  at: string;
  kind: "tool" | "note" | "error";
  label: string;
  detail?: string;
}

export interface PlanLine {
  id: string;
  grower_id: string;
  grower_name: string;
  town: string;
  country: string;
  transport: "road" | "sea";
  crop_kind: string;
  unit: string;
  lat: number;
  lng: number;
  crop_name: string;
  mode: "food_now" | "grow_there";
  kg: number;
  goods_cents: number;
  transport_cents: number;
  total_cents: number;
  meals: number;
  distance_km: number;
  days: number;
  payout_status: string | null;
  paypal_item_id: string | null;
  paypal_batch_id: string | null;
  path?: [number, number][];
}

export interface Shipment {
  id: string;
  grower_name: string;
  town: string;
  description: string;
  status: "awaiting_payment" | "sourced" | "shipped" | "delivered";
  eta_days: number;
  history: { status: string; at: string }[];
}

export interface DonationView {
  donation: {
    id: string;
    amount_cents: number;
    goal: string;
    choices: string[];
    donor_name: string | null;
    status: string;
    paypal_order_id: string | null;
    paypal_capture_id: string | null;
    paypal_refund_id: string | null;
    simulated: number;
    captured_at: string | null;
  };
  destination: Destination;
  plan: null | {
    id: string;
    status: "planning" | "ready" | "failed" | "cancelled";
    planner: "ai" | "rules" | null;
    model: string | null;
    food_now_share: number | null;
    headline: string | null;
    explanation: string | null;
    error: string | null;
    trace: TraceEntry[];
    summary: null | {
      totals: {
        spentCents: number;
        unallocatedCents: number;
        mealsNow: number;
        expectedMealsAtHarvest: number;
        personDaysNow: number;
        householdsWithSeed: number;
        expectedMealsFromTools?: number;
        tools?: { name: string; units: number; unit: string }[];
        countries?: string[];
        growersPaid: number;
        kgFood: number;
        kgSeed: number;
        proteinKg: number;
        avgMealsPerUsdNow: number;
        maxDeliveryDays: number;
        harvestInDays: number | null;
      };
      baseline: null | { description: string; mealsPerUsd: number; mealsForSameMoney: number; multiplier: number | null };
      notes: string[];
      localBoost: number;
    };
  };
  lines: PlanLine[];
  shipments: Shipment[];
  payouts: { id: string; status: string; amount_cents: number; paypal_item_id: string | null; paypal_batch_id: string | null; grower_name: string }[];
  commitments: Commitment[];
  runs: DispatchRun[];
}

export interface RoadNetwork {
  nodes: { id: string; name: string; lat: number; lng: number; country: string; port?: boolean; border?: boolean }[];
  edges: { from: string; to: string; surface: "paved" | "fair" | "rough"; road: string; border: boolean; coords: [number, number][] }[];
}
export interface DispatchStop {
  kind: "pickup" | "drop";
  id: string;
  name: string;
  note?: string;
  lat: number;
  lng: number;
  cargo: string[];
  kg: number;
}
export interface RunPlan {
  key: string;
  vehicle: string;
  capacityKg: number;
  loadKg: number;
  stops: DispatchStop[];
  km: number;
  hours: number;
  days: number;
  borderCrossings: number;
  roads: string[];
  path: [number, number][];
  truckCostCents: number;
  partLoadCostCents: number;
  recommended: "truck" | "part_loads";
  costCents: number;
  breakEvenKg: number | null;
  separateCostCents: number;
  separateKm: number;
  savingsCents: number;
  cargo: { key: string; kind: "donation" | "farmer_order"; description: string; weightKg: number; pickup: { name: string }; drop: { name: string } }[];
}
export interface DispatchRun {
  id: string;
  status: "on_road" | "delivered";
  mode: "truck" | "part_loads";
  vehicle: string;
  capacity_kg: number;
  load_kg: number;
  km: number;
  hours: number;
  days: number;
  cost_cents: number;
  separate_cost_cents: number;
  stops: DispatchStop[];
  path: [number, number][];
  roads: string[];
  cargo: { key: string; kind: string; description: string; weightKg: number; from: string; to: string }[];
  created_at: string;
  delivered_at: string | null;
}

export interface Commitment {
  id: string;
  plan_id: string;
  destination_id: string;
  destination: string;
  grower_id: string;
  grower_name: string;
  crop_id: string;
  crop_name: string;
  seed_kg: number;
  expected_kg: number;
  committed_kg: number;
  bought_kg: number;
  price_cents_per_kg: number;
  status: "growing" | "ready" | "bought" | "failed" | "cancelled";
  due_at: string;
  harvested_at: string | null;
  created_at: string;
}

export interface FarmerStats {
  toFarmersCents: number;
  toSuppliersCents: number;
  toFarmerGroupsCents: number;
  medianHoursToCash: number | null;
}

export interface FarmerRow {
  id: string;
  name: string;
  kind: string;
  town: string;
  county: string;
  country: string;
  paid_cents: number;
  payouts: number;
  last_paid_at: string | null;
  median_hours_to_cash: number | null;
  cash_out: string;
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
export interface DeliveryDetails {
  contactName: string;
  contactPhone: string;
  deliveryPoint: string;
  preferredDate?: string;
  note?: string;
}
export interface RequestSuggestion {
  cropId: string;
  name: string;
  why: string;
  fromCents: number;
  unit: string;
}
export interface FarmerRequest {
  id: string;
  farmer_id: string;
  farmer_name: string;
  town: string;
  country: string;
  need: string;
  quantity: string | null;
  budget_cents: number | null;
  needed_by: string | null;
  purpose: string | null;
  contact_phone?: string | null;
  suggestions: RequestSuggestion[];
  suggestion_note: string | null;
  status: "open" | "sourcing" | "fulfilled" | "declined";
  reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface FarmerOrder {
  id: string;
  crop_id: string;
  crop_name: string;
  crop_kind: string;
  unit: string;
  qty: number;
  goods_cents: number;
  delivery_cents: number;
  total_cents: number;
  status: "paid" | "refunded" | "failed";
  delivery_status: "awaiting_payment" | "sourced" | "shipped" | "delivered";
  delivery_history: { status: string; at: string }[];
  supplier_name: string;
  supplier_town: string;
  supplier_country: string;
  eta_days: number;
  paypal_capture_id: string | null;
  paypal_refund_id: string | null;
  paypal_item_id: string | null;
  created_at: string;
}

export interface FarmerDetail {
  grower: FlowGrower;
  cashOut: { route: string; note: string };
  totals: { paidCents: number; waitingCents: number; orders: number; medianHoursToCash: number | null };
  sales: {
    id: string;
    crop: string;
    crop_kind: string;
    mode: string;
    kg: number;
    total_cents: number;
    captured_at: string;
    destination: string;
    donation_id: string;
    payout_status: string | null;
    paid_at: string | null;
    paypal_item_id: string | null;
    paypal_batch_id: string | null;
    hours_to_cash: number | null;
  }[];
  offers: { crop_id: string; crop: string; unit: string; price_cents_per_kg: number; stock_kg: number }[];
  commitments: Commitment[];
  purchases: FarmerOrder[];
  runs?: DispatchRun[];
  requests?: FarmerRequest[];
}

export interface DeliveryStats {
  runs: number;
  trucks: number;
  onRoad: number;
  km: number;
  kg: number;
  costCents: number;
  savedCents: number;
  waitingLoads: number;
}

export interface Ledger {
  totals: {
    receivedCents: number;
    refundedCents: number;
    paidToGrowersCents: number;
    committedCents: number;
    heldCents: number;
    farmerPurchasesCents?: number;
    farmerPurchaseRefundsCents?: number;
    mealsPlanned: number;
    expectedMealsAtHarvest: number;
  };
  farmers?: FarmerStats;
  entries: { id: string; at: string; direction: "in" | "out"; amountCents: number; party: string; paypalId: string | null; status: string; simulated: boolean }[];
}

const TOKEN_KEY = "plantago.operatorToken";
export function getOperatorToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setOperatorToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* storage unavailable; token lasts for this page only */
  }
}

async function req<T>(method: string, url: string, body?: unknown, operator = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (operator) headers["x-operator-token"] = getOperatorToken();
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  config: () => req<AppConfig>("GET", "/api/config"),
  destinations: () => req<Destination[]>("GET", "/api/destinations"),
  network: () => req<any>("GET", "/api/network"),
  catalog: (destinationId: string) => req<CatalogItem[]>("GET", `/api/catalog?destinationId=${encodeURIComponent(destinationId)}`),
  flows: () => req<Flows>("GET", "/api/flows"),
  roads: () => req<RoadNetwork>("GET", "/api/roads"),
  article: (cropId: string) => req<Article>("GET", `/api/articles/${encodeURIComponent(cropId)}`),
  createDonation: (b: { destinationId: string; amount: string; goal: string; choices: string[] }) =>
    req<{ donationId: string; orderId: string }>("POST", "/api/donations", b),
  capture: (donationId: string, orderId: string) => req<{ ok: true }>("POST", `/api/donations/${donationId}/capture`, { orderId }),
  donation: (id: string) => req<DonationView>("GET", `/api/donations/${id}`),
  ledger: () => req<Ledger>("GET", "/api/ledger"),
  deliveries: () => req<{ stats: DeliveryStats; runs: DispatchRun[] }>("GET", "/api/deliveries"),
  farmers: () => req<{ farmers: FarmerRow[]; stats: FarmerStats }>("GET", "/api/farmers"),
  farmer: (id: string) => req<FarmerDetail>("GET", `/api/farmers/${encodeURIComponent(id)}`),
  shop: (farmerId: string) => req<ShopItem[]>("GET", `/api/farmers/${encodeURIComponent(farmerId)}/shop`),
  createFarmerOrder: (farmerId: string, b: { supplierId: string; cropId: string; qty: number; delivery: DeliveryDetails }) =>
    req<{ orderId: string; paypalOrderId: string; totalCents: number }>("POST", `/api/farmers/${encodeURIComponent(farmerId)}/orders`, b),
  createRequest: (farmerId: string, b: { need: string; quantity?: string; budget?: string; neededBy?: string; purpose?: string; contactPhone?: string }) =>
    req<{ id: string; suggestions: RequestSuggestion[]; note: string | null; matchedBy: "ai" | "keywords" }>(
      "POST",
      `/api/farmers/${encodeURIComponent(farmerId)}/requests`,
      b,
    ),
  captureFarmerOrder: (orderId: string, paypalOrderId: string) =>
    req<{ status: string; message?: string }>("POST", `/api/farmer-orders/${orderId}/capture`, { paypalOrderId }),
  operator: {
    overview: () => req<any>("GET", "/api/operator/overview", undefined, true),
    runPayouts: () => req<{ message: string }>("POST", "/api/operator/payouts/run", {}, true),
    refreshBatch: (id: string) => req("POST", `/api/operator/payouts/${id}/refresh`, {}, true),
    retryBatch: (id: string) => req("POST", `/api/operator/payouts/${id}/retry`, {}, true),
    advance: (id: string) => req("POST", `/api/operator/shipments/${id}/advance`, {}, true),
    refund: (id: string) => req("POST", `/api/operator/donations/${id}/refund`, {}, true),
    refundFarmerOrder: (id: string) => req<{ message: string }>("POST", `/api/operator/farmer-orders/${id}/refund`, {}, true),
    dispatch: () => req<{ truck: { name: string; capacityKg: number }; proposals: RunPlan[]; runs: DispatchRun[] }>("GET", "/api/operator/dispatch", undefined, true),
    dispatchRun: (keys: string[], mode?: "truck" | "part_loads") => req<{ message: string }>("POST", "/api/operator/dispatch", { keys, mode }, true),
    deliverRun: (id: string) => req<{ message: string }>("POST", `/api/operator/dispatch/${id}/delivered`, {}, true),
    requests: () => req<FarmerRequest[]>("GET", "/api/operator/requests", undefined, true),
    updateRequest: (id: string, status: FarmerRequest["status"], reply: string) =>
      req<{ message: string }>("POST", `/api/operator/requests/${id}`, { status, reply }, true),
    harvests: () => req<Commitment[]>("GET", "/api/operator/harvests", undefined, true),
    harvestReady: (id: string) => req<{ message: string }>("POST", `/api/operator/harvests/${id}/ready`, {}, true),
    harvestFailed: (id: string) => req<{ message: string }>("POST", `/api/operator/harvests/${id}/failed`, {}, true),
  },
};

export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
export const num = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

/** "under an hour", "5 hours", "3.5 days". */
export function timeToCash(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${num(hours / 24, 1)} days`;
}
