// Seed plant network for the Kenya demo, with suppliers across East Africa and beyond.
//
// Grower and supplier names are fictional; their locations are real towns.
// Prices are approximate 2025 farm-gate / wholesale ranges in USD cents per kg,
// rounded for the demo. Nutrition values are typical per-kg figures for the dry
// (or stated) form. Need levels are illustrative, informed by public IPC /
// FEWS NET reporting for Kenya's arid north; they are not live data.

export type CropKind = "cereal" | "pulse" | "tuber" | "tool";
export type Climate = "arid" | "semi_arid" | "highland" | "humid";

export interface CropSeed {
  id: string;
  name: string;
  kind: CropKind;
  kcalPerKg: number;
  proteinGPerKg: number;
  shelfLifeDays: number;
  /** Climates where it grows well from seed. Empty = not offered as seed. */
  growsIn: Climate[];
  /** Expected kg of harvest per kg of seed planted, in a fair season. */
  harvestPerSeedKg: number;
  daysToHarvest: number;
  /** 0..1, how well a rain-fed crop survives a poor season. */
  droughtTolerance: number;
  /** Tools only: what one unit is, its shipping weight, and its rough impact per season. */
  unit?: string;
  kgPerUnit?: number;
  mealsPerUnit?: number;
  /** Tools only: chance the impact is realised (it needs water, training, etc.). */
  reliability?: number;
}

export const crops: CropSeed[] = [
  { id: "maize", name: "Maize", kind: "cereal", kcalPerKg: 3650, proteinGPerKg: 94, shelfLifeDays: 365, growsIn: ["semi_arid", "highland", "humid"], harvestPerSeedKg: 40, daysToHarvest: 120, droughtTolerance: 0.3 },
  { id: "sorghum", name: "Sorghum", kind: "cereal", kcalPerKg: 3290, proteinGPerKg: 110, shelfLifeDays: 365, growsIn: ["arid", "semi_arid", "humid"], harvestPerSeedKg: 80, daysToHarvest: 100, droughtTolerance: 0.85 },
  { id: "millet", name: "Pearl millet", kind: "cereal", kcalPerKg: 3780, proteinGPerKg: 110, shelfLifeDays: 365, growsIn: ["arid", "semi_arid"], harvestPerSeedKg: 100, daysToHarvest: 90, droughtTolerance: 0.9 },
  { id: "beans", name: "Dry beans", kind: "pulse", kcalPerKg: 3330, proteinGPerKg: 220, shelfLifeDays: 270, growsIn: ["highland", "humid"], harvestPerSeedKg: 12, daysToHarvest: 90, droughtTolerance: 0.35 },
  { id: "cowpeas", name: "Cowpeas", kind: "pulse", kcalPerKg: 3360, proteinGPerKg: 240, shelfLifeDays: 270, growsIn: ["arid", "semi_arid"], harvestPerSeedKg: 20, daysToHarvest: 75, droughtTolerance: 0.8 },
  { id: "green_grams", name: "Green grams (mung)", kind: "pulse", kcalPerKg: 3470, proteinGPerKg: 240, shelfLifeDays: 300, growsIn: ["arid", "semi_arid"], harvestPerSeedKg: 33, daysToHarvest: 70, droughtTolerance: 0.85 },
  { id: "cassava_chips", name: "Cassava (dried chips)", kind: "tuber", kcalPerKg: 3300, proteinGPerKg: 15, shelfLifeDays: 180, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0 },
  { id: "sweet_potato", name: "Sweet potato (fresh)", kind: "tuber", kcalPerKg: 860, proteinGPerKg: 16, shelfLifeDays: 21, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0 },
  { id: "rice", name: "Rice", kind: "cereal", kcalPerKg: 3650, proteinGPerKg: 70, shelfLifeDays: 365, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0 },
  { id: "wheat_flour", name: "Wheat flour", kind: "cereal", kcalPerKg: 3640, proteinGPerKg: 100, shelfLifeDays: 180, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0 },
  // Tools. Impact figures are rough per-season estimates:
  // - a hermetic bag holding 100 kg of grain avoids ~15 kg of storage loss (~75 meals);
  // - a 250 m² drip kit grows ~300 kg of vegetables in the dry season (~130 meal-equivalents);
  // - a hand-tool set lets a household plant ~0.1 ha more (~60 meals).
  { id: "hermetic_bag", name: "Hermetic storage bag (100 kg)", kind: "tool", kcalPerKg: 0, proteinGPerKg: 0, shelfLifeDays: 3650, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0, unit: "bag", kgPerUnit: 0.3, mealsPerUnit: 75, reliability: 0.9 },
  { id: "drip_kit", name: "Family drip-irrigation kit", kind: "tool", kcalPerKg: 0, proteinGPerKg: 0, shelfLifeDays: 3650, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0, unit: "kit", kgPerUnit: 12, mealsPerUnit: 130, reliability: 0.6 },
  { id: "hand_tools", name: "Farming hand-tool set", kind: "tool", kcalPerKg: 0, proteinGPerKg: 0, shelfLifeDays: 3650, growsIn: [], harvestPerSeedKg: 0, daysToHarvest: 0, droughtTolerance: 0, unit: "set", kgPerUnit: 6, mealsPerUnit: 60, reliability: 0.7 },
];

/** Short donor-facing descriptions for the catalog. */
export const cropBlurbs: Record<string, string> = {
  maize: "Kenya's staple grain, cooked as ugali. Cheap energy, grown widely in the Rift Valley.",
  sorghum: "Hardy grain that thrives where maize fails. Grown near the arid north, so it travels less.",
  millet: "The toughest dryland cereal: needs little rain and stores for a year.",
  beans: "Protein-rich pulse from the highlands. Pairs with maize for a balanced meal.",
  cowpeas: "Drought-tolerant pulse with high protein; its leaves are eaten too.",
  green_grams: "Mung beans from Kitui and Makueni: fast-growing, high-protein, sold across Kenya.",
  cassava_chips: "Dried cassava keeps for months and gives cheap calories, but little protein.",
  sweet_potato: "Nutritious, but fresh roots spoil within weeks on the road north.",
  rice: "Grown in Mwea and Ahero. Costs more per meal than local grains.",
  wheat_flour: "Milled flour for chapati and bread; keeps for about six months.",
  hermetic_bag: "Airtight bag that keeps weevils out of stored grain, so a harvest isn't lost to pests before it's eaten.",
  drip_kit: "Bucket-fed drip lines for a 250 m² vegetable plot; grows greens in the dry season with little water.",
  hand_tools: "Hoe, panga and rake made by local smiths, so a family can clear and plant more land.",
};

export interface DestinationSeed {
  id: string;
  name: string;
  county: string;
  lat: number;
  lng: number;
  climate: Climate;
  /** IPC-style phase 1-5 (illustrative). */
  needPhase: number;
  peopleInNeed: number;
  /** Multiplier from straight-line to road distance; higher = worse roads. */
  roadFactor: number;
  /** Fictional local distribution partner that receives deliveries. */
  partner: string;
}

export const destinations: DestinationSeed[] = [
  { id: "lodwar", name: "Lodwar", county: "Turkana", lat: 3.1191, lng: 35.5973, climate: "arid", needPhase: 4, peopleInNeed: 310000, roadFactor: 1.4, partner: "Lodwar community kitchens (demo partner)" },
  { id: "kakuma", name: "Kakuma", county: "Turkana", lat: 3.7167, lng: 34.8667, climate: "arid", needPhase: 4, peopleInNeed: 190000, roadFactor: 1.5, partner: "Kakuma school feeding (demo partner)" },
  { id: "marsabit", name: "Marsabit", county: "Marsabit", lat: 2.3284, lng: 37.9899, climate: "arid", needPhase: 3, peopleInNeed: 160000, roadFactor: 1.35, partner: "Marsabit women's groups (demo partner)" },
  { id: "wajir", name: "Wajir", county: "Wajir", lat: 1.7471, lng: 40.0573, climate: "arid", needPhase: 3, peopleInNeed: 210000, roadFactor: 1.45, partner: "Wajir pastoralist network (demo partner)" },
  { id: "mandera", name: "Mandera", county: "Mandera", lat: 3.9373, lng: 41.8569, climate: "arid", needPhase: 4, peopleInNeed: 240000, roadFactor: 1.6, partner: "Mandera health posts (demo partner)" },
  { id: "garissa", name: "Garissa", county: "Garissa", lat: -0.4532, lng: 39.6461, climate: "arid", needPhase: 3, peopleInNeed: 170000, roadFactor: 1.3, partner: "Garissa food bank (demo partner)" },
  { id: "maralal", name: "Maralal", county: "Samburu", lat: 1.0968, lng: 36.6983, climate: "semi_arid", needPhase: 3, peopleInNeed: 90000, roadFactor: 1.4, partner: "Samburu school meals (demo partner)" },
];

/** farmer_group: families who planted Plantago seed, selling their harvest back (created at runtime). */
export type GrowerKind = "farm" | "coop" | "seed_supplier" | "tool_maker" | "importer" | "farmer_group";
/** road = trucked; sea = shipped to Mombasa, then trucked. */
export type Transport = "road" | "sea";

export interface GrowerSeed {
  id: string;
  name: string;
  kind: GrowerKind;
  town: string;
  county: string;
  lat: number;
  lng: number;
  /** Defaults to Kenya. */
  country?: string;
  transport?: Transport;
  /** cropId -> [price cents per kg, stock kg]. Seed: per kg of seed. Tools: per unit, stock in units. */
  offers: Record<string, [number, number]>;
}

export const growers: GrowerSeed[] = [
  // Rift Valley / western breadbasket
  { id: "g-kitale-1", name: "Kitale Smallholder Grain Co-op", kind: "coop", town: "Kitale", county: "Trans Nzoia", lat: 1.0157, lng: 35.0062, offers: { maize: [36, 40000], beans: [102, 8000] } },
  { id: "g-kitale-2", name: "Saboti Family Farms", kind: "farm", town: "Saboti", county: "Trans Nzoia", lat: 1.05, lng: 34.85, offers: { maize: [35, 12000] } },
  { id: "g-eldoret-1", name: "Uasin Gishu Growers Union", kind: "coop", town: "Eldoret", county: "Uasin Gishu", lat: 0.5143, lng: 35.2698, offers: { maize: [37, 60000], beans: [104, 10000] } },
  { id: "g-bungoma-1", name: "Bungoma Bean & Maize Group", kind: "coop", town: "Bungoma", county: "Bungoma", lat: 0.5635, lng: 34.5606, offers: { maize: [38, 15000], beans: [98, 9000] } },
  { id: "g-kakamega-1", name: "Kakamega Mixed Farmers", kind: "coop", town: "Kakamega", county: "Kakamega", lat: 0.2827, lng: 34.7519, offers: { beans: [100, 6000], sweet_potato: [24, 9000] } },
  { id: "g-busia-1", name: "Busia Drylands Collective", kind: "coop", town: "Busia", county: "Busia", lat: 0.4608, lng: 34.1115, offers: { sorghum: [41, 14000], cassava_chips: [44, 12000], millet: [64, 5000] } },
  { id: "g-siaya-1", name: "Siaya Sorghum Farmers", kind: "coop", town: "Siaya", county: "Siaya", lat: 0.0607, lng: 34.2881, offers: { sorghum: [40, 18000], cassava_chips: [43, 8000] } },
  { id: "g-homabay-1", name: "Homa Bay Lakeside Growers", kind: "coop", town: "Homa Bay", county: "Homa Bay", lat: -0.5273, lng: 34.4571, offers: { sorghum: [42, 10000], cassava_chips: [45, 9000] } },
  { id: "g-kisumu-1", name: "West Kano Rice Growers", kind: "coop", town: "Ahero", county: "Kisumu", lat: -0.1717, lng: 34.9167, offers: { rice: [118, 12000], sorghum: [43, 6000] } },
  { id: "g-nakuru-1", name: "Nakuru Highlands Farm", kind: "farm", town: "Nakuru", county: "Nakuru", lat: -0.3031, lng: 36.08, offers: { maize: [39, 20000], beans: [106, 7000] } },
  { id: "g-narok-1", name: "Narok Wheat & Maize Estate", kind: "farm", town: "Narok", county: "Narok", lat: -1.0876, lng: 35.8711, offers: { maize: [38, 25000], wheat_flour: [94, 15000] } },
  { id: "g-nanyuki-1", name: "Laikipia Plateau Growers", kind: "coop", town: "Nanyuki", county: "Laikipia", lat: 0.0167, lng: 37.0667, offers: { maize: [40, 14000], beans: [108, 5000] } },
  // Eastern dryland pulses
  { id: "g-meru-1", name: "Meru Hillside Co-op", kind: "coop", town: "Meru", county: "Meru", lat: 0.0463, lng: 37.6559, offers: { beans: [103, 9000], maize: [40, 12000] } },
  { id: "g-tharaka-1", name: "Tharaka Millet & Grams Group", kind: "coop", town: "Marimanti", county: "Tharaka Nithi", lat: -0.15, lng: 37.98, offers: { millet: [62, 9000], green_grams: [112, 7000], sorghum: [42, 8000] } },
  { id: "g-embu-1", name: "Embu Lowland Farmers", kind: "coop", town: "Embu", county: "Embu", lat: -0.5389, lng: 37.4596, offers: { maize: [39, 10000], beans: [104, 6000] } },
  { id: "g-kitui-1", name: "Kitui Green Grams Collective", kind: "coop", town: "Kitui", county: "Kitui", lat: -1.3667, lng: 38.0167, offers: { green_grams: [110, 12000], cowpeas: [88, 9000], sorghum: [41, 7000] } },
  { id: "g-machakos-1", name: "Machakos Cowpea Growers", kind: "coop", town: "Machakos", county: "Machakos", lat: -1.5177, lng: 37.2634, offers: { cowpeas: [89, 8000], maize: [40, 9000] } },
  { id: "g-makueni-1", name: "Makueni Dryland Farmers", kind: "coop", town: "Wote", county: "Makueni", lat: -1.7833, lng: 37.6333, offers: { green_grams: [111, 10000], cowpeas: [87, 7000], sorghum: [42, 6000] } },
  { id: "g-mwea-1", name: "Mwea Paddy Farmers", kind: "coop", town: "Mwea", county: "Kirinyaga", lat: -0.69, lng: 37.36, offers: { rice: [120, 20000] } },
  // Near the arid north
  { id: "g-isiolo-1", name: "Isiolo Irrigated Plots", kind: "farm", town: "Isiolo", county: "Isiolo", lat: 0.3546, lng: 37.5822, offers: { sorghum: [46, 3000], cowpeas: [92, 1500] } },
  { id: "g-katilu-1", name: "Katilu Irrigation Scheme Farmers", kind: "coop", town: "Katilu", county: "Turkana", lat: 2.08, lng: 35.55, offers: { sorghum: [48, 6000], maize: [44, 3000] } },
  { id: "g-sagante-1", name: "Sagante Highland Farmers", kind: "coop", town: "Sagante", county: "Marsabit", lat: 2.25, lng: 37.95, offers: { maize: [45, 2500], beans: [112, 1200] } },
  { id: "g-bura-1", name: "Bura Irrigation Growers", kind: "coop", town: "Bura", county: "Tana River", lat: -1.1, lng: 39.95, offers: { maize: [42, 8000], cowpeas: [90, 4000], green_grams: [113, 3000] } },
  { id: "g-hola-1", name: "Hola Riverbank Farms", kind: "farm", town: "Hola", county: "Tana River", lat: -1.5, lng: 40.0333, offers: { maize: [43, 5000], cowpeas: [91, 2500] } },
  { id: "g-mandera-1", name: "Daua River Farmers", kind: "coop", town: "Rhamu", county: "Mandera", lat: 3.93, lng: 41.22, offers: { sorghum: [50, 1500], cowpeas: [95, 800] } },
  // Seed suppliers (for "grow it there")
  { id: "s-kitale-1", name: "Rift Valley Certified Seed Co-op", kind: "seed_supplier", town: "Kitale", county: "Trans Nzoia", lat: 1.02, lng: 35.0, offers: { maize: [280, 3000], sorghum: [240, 1500], beans: [260, 1000] } },
  { id: "s-katumani-1", name: "Machakos Dryland Seed Bank", kind: "seed_supplier", town: "Machakos", county: "Machakos", lat: -1.58, lng: 37.24, offers: { sorghum: [230, 1200], millet: [290, 800], cowpeas: [300, 900], green_grams: [340, 900] } },
  { id: "s-marsabit-1", name: "Northern Drylands Seed Group", kind: "seed_supplier", town: "Marsabit", county: "Marsabit", lat: 2.33, lng: 37.98, offers: { sorghum: [260, 400], cowpeas: [320, 300], green_grams: [360, 300] } },
  { id: "s-lodwar-1", name: "Turkana Seed Multipliers", kind: "seed_supplier", town: "Lodwar", county: "Turkana", lat: 3.12, lng: 35.6, offers: { sorghum: [270, 300], millet: [300, 250] } },
  // Kenyan tool makers
  { id: "k-nairobi-bags", name: "Nairobi Hermetic Bag Makers", kind: "tool_maker", town: "Nairobi", county: "Nairobi", lat: -1.2921, lng: 36.8219, offers: { hermetic_bag: [260, 4000] } },
  { id: "k-nairobi-jua", name: "Kariokor Jua Kali Toolsmiths", kind: "tool_maker", town: "Nairobi", county: "Nairobi", lat: -1.28, lng: 36.83, offers: { hand_tools: [1400, 300] } },
  { id: "k-thika-drip", name: "Thika Irrigation Assemblers", kind: "tool_maker", town: "Thika", county: "Kiambu", lat: -1.0333, lng: 37.0693, offers: { drip_kit: [5500, 120] } },

  // Uganda (by road, across the border)
  { id: "u-lira-1", name: "Lango Sorghum & Cowpea Co-op", kind: "coop", town: "Lira", county: "Lira", country: "Uganda", lat: 2.2499, lng: 32.8999, offers: { sorghum: [36, 20000], cowpeas: [80, 6000] } },
  { id: "u-mbale-1", name: "Mount Elgon Bean Growers", kind: "coop", town: "Mbale", county: "Mbale", country: "Uganda", lat: 1.0821, lng: 34.175, offers: { beans: [90, 8000], maize: [32, 15000] } },
  { id: "u-soroti-seed", name: "Teso Dryland Seed Co-op", kind: "seed_supplier", town: "Soroti", county: "Soroti", country: "Uganda", lat: 1.7146, lng: 33.6111, offers: { sorghum: [210, 1500], cowpeas: [260, 800], millet: [270, 600] } },
  { id: "u-jinja-tools", name: "Jinja Tool Works", kind: "tool_maker", town: "Jinja", county: "Jinja", country: "Uganda", lat: 0.4244, lng: 33.2042, offers: { hand_tools: [1250, 400] } },

  // Tanzania (by road, across the border)
  { id: "t-arusha-1", name: "Arusha Grain Traders Co-op", kind: "coop", town: "Arusha", county: "Arusha", country: "Tanzania", lat: -3.3869, lng: 36.683, offers: { maize: [33, 30000], beans: [94, 6000] } },
  { id: "t-dodoma-1", name: "Dodoma Millet Growers", kind: "coop", town: "Dodoma", county: "Dodoma", country: "Tanzania", lat: -6.163, lng: 35.7516, offers: { millet: [54, 9000], sorghum: [36, 12000] } },
  { id: "t-dodoma-seed", name: "Central Tanzania Seed Farm", kind: "seed_supplier", town: "Dodoma", county: "Dodoma", country: "Tanzania", lat: -6.17, lng: 35.74, offers: { sorghum: [220, 1200], millet: [255, 900] } },
  { id: "t-arusha-bags", name: "Northern Tanzania Packaging Co.", kind: "tool_maker", town: "Arusha", county: "Arusha", country: "Tanzania", lat: -3.37, lng: 36.69, offers: { hermetic_bag: [225, 6000] } },

  // India (by sea to Mombasa)
  { id: "in-hyderabad-seed", name: "Deccan Dryland Seed Co.", kind: "seed_supplier", town: "Hyderabad", county: "Telangana", country: "India", transport: "sea", lat: 17.385, lng: 78.4867, offers: { millet: [170, 5000], sorghum: [160, 5000], green_grams: [240, 2000] } },
  { id: "in-pune-drip", name: "Pune Micro-Irrigation Works", kind: "tool_maker", town: "Pune", county: "Maharashtra", country: "India", transport: "sea", lat: 18.5204, lng: 73.8567, offers: { drip_kit: [3600, 1000] } },

  // South Africa (by sea to Mombasa)
  { id: "za-durban-agri", name: "Durban Agri Supply", kind: "tool_maker", town: "Durban", county: "KwaZulu-Natal", country: "South Africa", transport: "sea", lat: -29.8587, lng: 31.0218, offers: { drip_kit: [4800, 400], hand_tools: [1900, 500] } },

  // Imported food baseline (what aid often defaults to)
  { id: "i-mombasa-1", name: "Mombasa Port Importer", kind: "importer", town: "Mombasa", county: "Mombasa", lat: -4.0435, lng: 39.6682, offers: { rice: [88, 200000], wheat_flour: [92, 100000] } },
];

export function growerPayPalEmail(growerId: string): string {
  return `${growerId}@growers.plantago.example`;
}

/**
 * How each plant grows, for the catalog. Typical ranges for East African
 * dryland and smallholder conditions (rain-fed unless noted), rounded.
 * `wiki` is the English Wikipedia article title.
 */
export interface GrowthInfo {
  growDays?: [number, number];
  waterMm?: [number, number];
  yieldTPerHa?: [number, number];
  propagation?: string;
  wiki: string;
}

export const cropGrowth: Record<string, GrowthInfo> = {
  maize: { growDays: [90, 150], waterMm: [500, 800], yieldTPerHa: [1, 2], propagation: "Seed", wiki: "Maize" },
  sorghum: { growDays: [90, 120], waterMm: [400, 600], yieldTPerHa: [0.8, 1.5], propagation: "Seed", wiki: "Sorghum" },
  millet: { growDays: [75, 100], waterMm: [250, 500], yieldTPerHa: [0.5, 1.2], propagation: "Seed", wiki: "Pearl_millet" },
  beans: { growDays: [80, 100], waterMm: [300, 500], yieldTPerHa: [0.5, 1], propagation: "Seed", wiki: "Phaseolus_vulgaris" },
  cowpeas: { growDays: [60, 90], waterMm: [300, 450], yieldTPerHa: [0.4, 0.8], propagation: "Seed", wiki: "Cowpea" },
  green_grams: { growDays: [60, 75], waterMm: [350, 450], yieldTPerHa: [0.4, 0.8], propagation: "Seed", wiki: "Mung_bean" },
  cassava_chips: { growDays: [240, 365], waterMm: [1000, 1500], yieldTPerHa: [8, 15], propagation: "Stem cuttings (yield is fresh roots)", wiki: "Cassava" },
  sweet_potato: { growDays: [90, 150], waterMm: [500, 750], yieldTPerHa: [6, 12], propagation: "Vine cuttings (yield is fresh roots)", wiki: "Sweet_potato" },
  rice: { growDays: [110, 150], waterMm: [1000, 2000], yieldTPerHa: [3, 6], propagation: "Seed, irrigated paddies", wiki: "Rice" },
  wheat_flour: { growDays: [100, 130], waterMm: [450, 650], yieldTPerHa: [1.5, 3], propagation: "Seed (highland wheat, milled to flour)", wiki: "Wheat" },
  hermetic_bag: { wiki: "Hermetic_storage" },
  drip_kit: { wiki: "Drip_irrigation" },
  hand_tools: { wiki: "Hoe_(tool)" },
};
