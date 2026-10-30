import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { crops, destinations, growers, growerPayPalEmail } from "./seed/kenya.js";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  kcal_per_kg INTEGER NOT NULL,
  protein_g_per_kg INTEGER NOT NULL,
  shelf_life_days INTEGER NOT NULL,
  grows_in TEXT NOT NULL,            -- JSON array of climates
  harvest_per_seed_kg REAL NOT NULL,
  days_to_harvest INTEGER NOT NULL,
  drought_tolerance REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  kg_per_unit REAL NOT NULL DEFAULT 1,
  meals_per_unit REAL NOT NULL DEFAULT 0,
  reliability REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  county TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  climate TEXT NOT NULL,
  need_phase INTEGER NOT NULL,
  people_in_need INTEGER NOT NULL,
  road_factor REAL NOT NULL,
  partner TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  town TEXT NOT NULL,
  county TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  paypal_email TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Kenya',
  transport TEXT NOT NULL DEFAULT 'road'
);

CREATE TABLE IF NOT EXISTS offers (
  grower_id TEXT NOT NULL REFERENCES growers(id),
  crop_id TEXT NOT NULL REFERENCES crops(id),
  price_cents_per_kg INTEGER NOT NULL CHECK (price_cents_per_kg > 0),
  stock_kg REAL NOT NULL CHECK (stock_kg >= 0),
  PRIMARY KEY (grower_id, crop_id)
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  goal TEXT NOT NULL,
  choices TEXT NOT NULL DEFAULT '[]', -- JSON catalog item ids the donor picked; [] = planner decides
  donor_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('created','captured','refunded','failed')),
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_refund_id TEXT UNIQUE,
  simulated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  captured_at TEXT,
  refunded_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  donation_id TEXT NOT NULL UNIQUE REFERENCES donations(id),
  status TEXT NOT NULL CHECK (status IN ('planning','ready','failed','cancelled')),
  planner TEXT,                       -- 'ai' or 'rules'
  model TEXT,
  food_now_share REAL,
  headline TEXT,
  explanation TEXT,
  summary TEXT,                       -- JSON: totals and baseline comparison
  trace TEXT NOT NULL DEFAULT '[]',   -- JSON: planner steps shown to the donor
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_lines (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  grower_id TEXT NOT NULL REFERENCES growers(id),
  crop_id TEXT NOT NULL REFERENCES crops(id),
  mode TEXT NOT NULL CHECK (mode IN ('food_now','grow_there')),
  kg REAL NOT NULL,
  goods_cents INTEGER NOT NULL,
  transport_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents = goods_cents + transport_cents),
  meals REAL NOT NULL,               -- now (food) or expected at harvest (seed)
  distance_km REAL NOT NULL,
  days INTEGER NOT NULL,
  payout_id TEXT REFERENCES payouts(id)
);

CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY,                -- also used as PayPal sender_batch_id (idempotency)
  paypal_batch_id TEXT UNIQUE,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,                -- also used as PayPal sender_item_id
  batch_id TEXT NOT NULL REFERENCES payout_batches(id),
  grower_id TEXT NOT NULL REFERENCES growers(id),
  receiver TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paypal_item_id TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  grower_id TEXT NOT NULL REFERENCES growers(id),
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','sourced','shipped','delivered')),
  eta_days INTEGER NOT NULL,
  history TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  run_id TEXT,                        -- dispatch run (truck) carrying it
  UNIQUE (plan_id, grower_id)
);

CREATE TABLE IF NOT EXISTS paypal_events (
  id TEXT PRIMARY KEY,                -- PayPal event id; duplicates are ignored
  event_type TEXT NOT NULL,
  resource_id TEXT,
  verified INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS harvest_commitments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),      -- the seed plan that started it
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  grower_id TEXT NOT NULL REFERENCES growers(id),   -- the farmer group that planted the seed
  crop_id TEXT NOT NULL REFERENCES crops(id),
  seed_kg REAL NOT NULL,
  expected_kg REAL NOT NULL,                        -- risk-adjusted harvest
  committed_kg REAL NOT NULL,                       -- what Plantago promised to buy
  bought_kg REAL NOT NULL DEFAULT 0,
  price_cents_per_kg INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('growing','ready','bought','failed','cancelled')),
  due_at TEXT NOT NULL,
  harvested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A farmer buying tools or seed with their own money. Plantago delivers it and pays the supplier.
CREATE TABLE IF NOT EXISTS farmer_orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES growers(id),
  supplier_id TEXT NOT NULL REFERENCES growers(id),
  crop_id TEXT NOT NULL REFERENCES crops(id),
  qty REAL NOT NULL CHECK (qty > 0),               -- kg, or whole units for tools
  goods_cents INTEGER NOT NULL,
  delivery_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents = goods_cents + delivery_cents AND total_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('created','paid','refunded','failed')),
  delivery_status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (delivery_status IN ('awaiting_payment','sourced','shipped','delivered')),
  delivery_history TEXT NOT NULL DEFAULT '[]',
  distance_km REAL NOT NULL,
  eta_days INTEGER NOT NULL,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_refund_id TEXT UNIQUE,
  simulated INTEGER NOT NULL DEFAULT 0,
  payout_id TEXT REFERENCES payouts(id),
  run_id TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  updated_at TEXT NOT NULL
);

-- A truck run: pickups and drop-offs in order along the road network.
CREATE TABLE IF NOT EXISTS dispatch_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('on_road','delivered')),
  mode TEXT NOT NULL DEFAULT 'truck',        -- 'truck' or 'part_loads'
  vehicle TEXT NOT NULL,
  capacity_kg REAL NOT NULL,
  load_kg REAL NOT NULL,
  km REAL NOT NULL,
  hours REAL NOT NULL,
  days INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  separate_cost_cents INTEGER NOT NULL,
  stops TEXT NOT NULL,
  path TEXT NOT NULL,
  roads TEXT NOT NULL,
  cargo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lines_unpaid ON plan_lines(payout_id) WHERE payout_id IS NULL;
`;

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Load the reference network. Crops, destinations and growers are refreshed on
 * every boot; offers are only added if missing, so reserved stock is preserved.
 */
export function seedNetwork(db: DB): void {
  const tx = db.transaction(() => {
    const insCrop = db.prepare(
      `INSERT OR REPLACE INTO crops (id, name, kind, kcal_per_kg, protein_g_per_kg, shelf_life_days, grows_in, harvest_per_seed_kg, days_to_harvest,
         drought_tolerance, unit, kg_per_unit, meals_per_unit, reliability)
       VALUES (@id,@name,@kind,@kcalPerKg,@proteinGPerKg,@shelfLifeDays,@growsIn,@harvestPerSeedKg,@daysToHarvest,@droughtTolerance,@unit,@kgPerUnit,@mealsPerUnit,@reliability)`,
    );
    for (const c of crops)
      insCrop.run({ unit: "kg", kgPerUnit: 1, mealsPerUnit: 0, reliability: 0, ...c, growsIn: JSON.stringify(c.growsIn) });

    const insDest = db.prepare(
      `INSERT OR REPLACE INTO destinations VALUES (@id,@name,@county,@lat,@lng,@climate,@needPhase,@peopleInNeed,@roadFactor,@partner)`,
    );
    for (const d of destinations) insDest.run(d);

    const insGrower = db.prepare(
      `INSERT INTO growers (id, name, kind, town, county, lat, lng, paypal_email, country, transport)
       VALUES (@id,@name,@kind,@town,@county,@lat,@lng,@email,@country,@transport)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, town=excluded.town, county=excluded.county,
         lat=excluded.lat, lng=excluded.lng, country=excluded.country, transport=excluded.transport`,
    );
    const insOffer = db.prepare(`INSERT OR IGNORE INTO offers VALUES (?,?,?,?)`);
    for (const g of growers) {
      insGrower.run({ country: "Kenya", transport: "road", ...g, email: growerPayPalEmail(g.id) });
      for (const [cropId, [price, stock]] of Object.entries(g.offers)) insOffer.run(g.id, cropId, price, stock);
    }
  });
  tx();
}

/** Add columns introduced after a database was first created. */
function migrate(db: DB): void {
  const has = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has("donations", "choices")) db.exec(`ALTER TABLE donations ADD COLUMN choices TEXT NOT NULL DEFAULT '[]'`);
  if (!has("crops", "unit")) {
    db.exec(`ALTER TABLE crops ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg'`);
    db.exec(`ALTER TABLE crops ADD COLUMN kg_per_unit REAL NOT NULL DEFAULT 1`);
    db.exec(`ALTER TABLE crops ADD COLUMN meals_per_unit REAL NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE crops ADD COLUMN reliability REAL NOT NULL DEFAULT 0`);
  }
  if (db.prepare(`SELECT name FROM sqlite_master WHERE name = 'dispatch_runs'`).get() && !has("dispatch_runs", "mode"))
    db.exec(`ALTER TABLE dispatch_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'truck'`);
  if (!has("shipments", "run_id")) db.exec(`ALTER TABLE shipments ADD COLUMN run_id TEXT`);
  if (db.prepare(`SELECT name FROM sqlite_master WHERE name = 'farmer_orders'`).get() && !has("farmer_orders", "run_id"))
    db.exec(`ALTER TABLE farmer_orders ADD COLUMN run_id TEXT`);
  if (!has("payouts", "paid_at")) db.exec(`ALTER TABLE payouts ADD COLUMN paid_at TEXT`);
  // Payouts that succeeded before paid_at existed: their last update is when they were paid.
  db.exec(`UPDATE payouts SET paid_at = updated_at WHERE status = 'SUCCESS' AND paid_at IS NULL`);
  // Promises left a few grams short by cent rounding count as fulfilled.
  if (db.prepare(`SELECT name FROM sqlite_master WHERE name = 'harvest_commitments'`).get())
    db.exec(`UPDATE harvest_commitments SET status = 'bought' WHERE status = 'ready' AND bought_kg >= committed_kg - MAX(0.1, committed_kg * 0.005)`);
  if (!has("growers", "country")) {
    db.exec(`ALTER TABLE growers ADD COLUMN country TEXT NOT NULL DEFAULT 'Kenya'`);
    db.exec(`ALTER TABLE growers ADD COLUMN transport TEXT NOT NULL DEFAULT 'road'`);
  }
}

export function openDb(file = config.databasePath): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seedNetwork(db);
  return db;
}
