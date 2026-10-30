// Road network and pathfinding.
//
// A simplified graph of Kenya's main highways plus the corridors into Uganda and
// Tanzania. Segment length is the straight-line distance times a winding factor;
// speed depends on surface. Shortest paths are by driving time (Dijkstra), so a
// longer paved road beats a shorter rough track, as a trucker would choose.
//
// Coordinates are real towns. Surfaces are a simplification for the demo.

export type Surface = "paved" | "fair" | "rough";

export interface RoadNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  port?: boolean;
  border?: boolean;
}

const N = (id: string, name: string, lat: number, lng: number, country = "Kenya", extra: Partial<RoadNode> = {}): RoadNode => ({
  id,
  name,
  lat,
  lng,
  country,
  ...extra,
});

export const ROAD_NODES: RoadNode[] = [
  // Coast and Nairobi corridor
  N("mombasa", "Mombasa port", -4.0435, 39.6682, "Kenya", { port: true }),
  N("voi", "Voi", -3.3961, 38.5561),
  N("malindi", "Malindi", -3.2192, 40.1169),
  N("garsen", "Garsen", -2.27, 40.1167),
  N("mtito", "Mtito Andei", -2.69, 38.1667),
  N("athi", "Athi River", -1.456, 36.978),
  N("nairobi", "Nairobi", -1.2921, 36.8219),
  N("thika", "Thika", -1.0333, 37.0693),
  N("mwea", "Mwea", -0.69, 37.36),
  N("embu", "Embu", -0.5389, 37.4596),
  N("meru", "Meru", 0.0463, 37.6559),
  N("marimanti", "Marimanti", -0.15, 37.98),
  N("nanyuki", "Nanyuki", 0.0167, 37.0667),
  N("isiolo", "Isiolo", 0.3546, 37.5822),
  N("machakos", "Machakos", -1.5177, 37.2634),
  N("wote", "Wote", -1.7833, 37.6333),
  N("kitui", "Kitui", -1.3667, 38.0167),
  N("mwingi", "Mwingi", -0.9333, 38.0667),
  // Rift Valley and west
  N("narok", "Narok", -1.0876, 35.8711),
  N("naivasha", "Naivasha", -0.7167, 36.4333),
  N("nakuru", "Nakuru", -0.3031, 36.08),
  N("eldoret", "Eldoret", 0.5143, 35.2698),
  N("kitale", "Kitale", 1.0157, 35.0062),
  N("kapenguria", "Kapenguria", 1.2389, 35.1119),
  N("bungoma", "Bungoma", 0.5635, 34.5606),
  N("kakamega", "Kakamega", 0.2827, 34.7519),
  N("kisumu", "Kisumu", -0.0917, 34.768),
  N("ahero", "Ahero", -0.1717, 34.9167),
  N("siaya", "Siaya", 0.0607, 34.2881),
  N("homabay", "Homa Bay", -0.5273, 34.4571),
  N("busia", "Busia border", 0.4608, 34.1115, "Kenya", { border: true }),
  N("malaba", "Malaba border", 0.635, 34.2833, "Kenya", { border: true }),
  N("rumuruti", "Rumuruti", 0.2725, 36.5381),
  // North
  N("lokichar", "Lokichar", 2.3833, 35.65),
  N("katilu", "Katilu", 2.08, 35.55),
  N("lodwar", "Lodwar", 3.1191, 35.5973),
  N("kakuma", "Kakuma", 3.7167, 34.8667),
  N("lokiriama", "Lokiriama border", 2.37, 34.9, "Kenya", { border: true }),
  N("maralal", "Maralal", 1.0968, 36.6983),
  N("marsabit", "Marsabit", 2.3284, 37.9899),
  N("sagante", "Sagante", 2.25, 37.95),
  // North-east and east
  N("garissa", "Garissa", -0.4532, 39.6461),
  N("bura", "Bura", -1.1, 39.95),
  N("hola", "Hola", -1.5, 40.0333),
  N("habaswein", "Habaswein", 1.01, 39.49),
  N("wajir", "Wajir", 1.7471, 40.0573),
  N("elwak", "El Wak", 2.8, 40.93),
  N("rhamu", "Rhamu", 3.93, 41.22),
  N("mandera", "Mandera", 3.9373, 41.8569),
  // Tanzania
  N("namanga", "Namanga border", -2.545, 36.79, "Kenya", { border: true }),
  N("arusha", "Arusha", -3.3869, 36.683, "Tanzania"),
  N("dodoma", "Dodoma", -6.163, 35.7516, "Tanzania"),
  // Uganda
  N("tororo", "Tororo", 0.6928, 34.1809, "Uganda"),
  N("mbale", "Mbale", 1.0821, 34.175, "Uganda"),
  N("jinja", "Jinja", 0.4244, 33.2042, "Uganda"),
  N("soroti", "Soroti", 1.7146, 33.6111, "Uganda"),
  N("lira", "Lira", 2.2499, 32.8999, "Uganda"),
  N("moroto", "Moroto", 2.5345, 34.6664, "Uganda"),
];

/** [from, to, surface, name, border crossing?]. Undirected. */
export const ROAD_EDGES: [string, string, Surface, string, boolean?][] = [
  ["mombasa", "malindi", "paved", "B8"],
  ["malindi", "garsen", "paved", "B8"],
  ["garsen", "hola", "fair", "B8"],
  ["soroti", "moroto", "fair", "A104"],
  ["lira", "moroto", "fair", "Kotido road"],
  ["moroto", "lokiriama", "rough", "Moroto–Lokiriama", true],
  ["lokiriama", "lodwar", "fair", "A1 link"],
  ["mombasa", "voi", "paved", "A109"],
  ["voi", "mtito", "paved", "A109"],
  ["mtito", "athi", "paved", "A109"],
  ["athi", "nairobi", "paved", "A109"],
  ["athi", "machakos", "paved", "C97"],
  ["machakos", "kitui", "paved", "B7"],
  ["machakos", "wote", "paved", "C99"],
  ["wote", "mtito", "fair", "C99"],
  ["kitui", "mwingi", "paved", "B7"],
  ["nairobi", "thika", "paved", "A2"],
  ["thika", "mwingi", "paved", "A3"],
  ["mwingi", "garissa", "paved", "A3"],
  ["thika", "mwea", "paved", "B21"],
  ["mwea", "embu", "paved", "B6"],
  ["embu", "meru", "paved", "B6"],
  ["meru", "marimanti", "fair", "C92"],
  ["marimanti", "mwingi", "fair", "C92"],
  ["thika", "nanyuki", "paved", "A2"],
  ["nanyuki", "isiolo", "paved", "A2"],
  ["meru", "isiolo", "paved", "A2"],
  ["isiolo", "marsabit", "paved", "A2"],
  ["marsabit", "sagante", "fair", "local"],
  ["isiolo", "habaswein", "rough", "C81"],
  ["garissa", "habaswein", "fair", "A3"],
  ["habaswein", "wajir", "fair", "A3"],
  ["wajir", "elwak", "rough", "C81"],
  ["elwak", "rhamu", "rough", "C81"],
  ["elwak", "mandera", "rough", "A13"],
  ["rhamu", "mandera", "fair", "B9"],
  ["garissa", "bura", "fair", "B8"],
  ["bura", "hola", "fair", "B8"],
  ["nairobi", "naivasha", "paved", "A104"],
  ["nairobi", "narok", "paved", "B3"],
  ["naivasha", "nakuru", "paved", "A104"],
  ["nakuru", "eldoret", "paved", "A104"],
  ["eldoret", "kitale", "paved", "A1"],
  ["kitale", "kapenguria", "paved", "A1"],
  ["kapenguria", "lokichar", "fair", "A1"],
  ["lokichar", "lodwar", "paved", "A1"],
  ["lokichar", "katilu", "rough", "local"],
  ["lodwar", "kakuma", "fair", "A1"],
  ["eldoret", "bungoma", "paved", "A104"],
  ["bungoma", "malaba", "paved", "A104"],
  ["bungoma", "kakamega", "paved", "A1"],
  ["kakamega", "kisumu", "paved", "A1"],
  ["kisumu", "ahero", "paved", "B1"],
  ["ahero", "nakuru", "paved", "B1"],
  ["kisumu", "siaya", "fair", "C27"],
  ["siaya", "busia", "fair", "C30"],
  ["kisumu", "homabay", "paved", "A1"],
  ["nakuru", "rumuruti", "fair", "B5"],
  ["nanyuki", "rumuruti", "fair", "C76"],
  ["rumuruti", "maralal", "fair", "C77"],
  ["nairobi", "namanga", "paved", "A104"],
  ["namanga", "arusha", "paved", "A104", true],
  ["arusha", "dodoma", "paved", "B129"],
  ["malaba", "tororo", "paved", "Northern Corridor", true],
  ["busia", "tororo", "paved", "Northern Corridor", true],
  ["tororo", "mbale", "paved", "A104"],
  ["tororo", "jinja", "paved", "A109"],
  ["mbale", "soroti", "paved", "A104"],
  ["soroti", "lira", "paved", "A104"],
];

const SPEED_KMH: Record<Surface, number> = { paved: 55, fair: 38, rough: 25 };
const WINDING = 1.2; // roads vs straight line
const ACCESS_WINDING = 1.4; // feeder roads from a farm to the nearest junction
const ACCESS_SPEED_KMH = 30;
export const DRIVING_HOURS_PER_DAY = 9;

const R_EARTH_KM = 6371;
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

// ---- Graph ----
const nodeById = new Map(ROAD_NODES.map((n) => [n.id, n]));
/** Routing penalty for a border crossing (customs queues), so routes don't leave Kenya to save an hour. */
const BORDER_PENALTY_HOURS = 24;

interface Arc {
  to: string;
  km: number;
  /** Driving time. */
  hours: number;
  /** What Dijkstra minimises: driving time plus border penalty. */
  weight: number;
  surface: Surface;
  road: string;
  border: boolean;
}
const adj = new Map<string, Arc[]>();
for (const [a, b, surface, road, border = false] of ROAD_EDGES) {
  const na = nodeById.get(a)!;
  const nb = nodeById.get(b)!;
  if (!na || !nb) throw new Error(`Bad road edge ${a}-${b}`);
  const km = haversineKm(na, nb) * WINDING;
  const hours = km / SPEED_KMH[surface];
  const weight = hours + (border ? BORDER_PENALTY_HOURS : 0);
  adj.set(a, [...(adj.get(a) ?? []), { to: b, km, hours, weight, surface, road, border }]);
  adj.set(b, [...(adj.get(b) ?? []), { to: a, km, hours, weight, surface, road, border }]);
}

interface Tree {
  prev: Map<string, string>;
}
/** Dijkstra by routing weight from one node to all others. Small graph: a sorted array is plenty. */
function dijkstra(source: string): Tree {
  const hours = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const queue: [number, string][] = [[0, source]];
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [h, u] = queue.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nh = h + e.weight;
      if (nh < (hours.get(e.to) ?? Infinity)) {
        hours.set(e.to, nh);
        prev.set(e.to, u);
        queue.push([nh, e.to]);
      }
    }
  }
  return { prev };
}
const trees = new Map<string, Tree>();
const treeFrom = (id: string) => {
  let t = trees.get(id);
  if (!t) trees.set(id, (t = dijkstra(id)));
  return t;
};

/** Nearest junction to a point (by straight line). */
export function nearestNode(p: { lat: number; lng: number }): RoadNode {
  let best = ROAD_NODES[0];
  let bestKm = Infinity;
  for (const n of ROAD_NODES) {
    const d = haversineKm(p, n);
    if (d < bestKm) (bestKm = d), (best = n);
  }
  return best;
}

export interface RoadPath {
  km: number;
  hours: number;
  /** Junctions passed, by id. */
  nodes: string[];
  /** Polyline to draw: start point, junctions, end point. */
  coords: [number, number][];
  /** Highway names used, in order (deduplicated). */
  roads: string[];
  surfaces: Record<Surface, number>;
  /** Border posts crossed. */
  borderCrossings: number;
}

const cache = new Map<string, RoadPath>();

/** Fastest road route between two points: feeder road → highways → feeder road. */
export function roadPath(from: { lat: number; lng: number }, to: { lat: number; lng: number }): RoadPath {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const a = nearestNode(from);
  const b = nearestNode(to);
  const accessKm = haversineKm(from, a) * ACCESS_WINDING + haversineKm(to, b) * ACCESS_WINDING;
  const t = treeFrom(a.id);
  const nodes: string[] = [];
  for (let cur: string | undefined = b.id; cur; cur = t.prev.get(cur)) {
    nodes.unshift(cur);
    if (cur === a.id) break;
  }
  if (nodes[0] !== a.id) throw new Error(`No road from ${a.name} to ${b.name}`);

  const roads: string[] = [];
  const surfaces: Record<Surface, number> = { paved: 0, fair: 0, rough: 0 };
  let graphKm = 0;
  let graphHours = 0;
  let borderCrossings = 0;
  for (let i = 1; i < nodes.length; i++) {
    const arc = adj.get(nodes[i - 1])!.find((e) => e.to === nodes[i])!;
    if (roads.at(-1) !== arc.road) roads.push(arc.road);
    surfaces[arc.surface] += arc.km;
    graphKm += arc.km;
    graphHours += arc.hours;
    if (arc.border) borderCrossings++;
  }
  // Same junction at both ends (e.g. two farms near one town): just the feeder roads, or a direct hop.
  const direct = a.id === b.id ? haversineKm(from, to) * ACCESS_WINDING : Infinity;
  const viaGraph = graphKm + accessKm;
  const useDirect = direct < viaGraph;
  const km = useDirect ? direct : viaGraph;
  const hours = useDirect ? km / ACCESS_SPEED_KMH : graphHours + accessKm / ACCESS_SPEED_KMH;
  const coords: [number, number][] = useDirect
    ? [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ]
    : [[from.lat, from.lng], ...nodes.map((id) => [nodeById.get(id)!.lat, nodeById.get(id)!.lng] as [number, number]), [to.lat, to.lng]];
  const out: RoadPath = {
    km: Math.round(km * 10) / 10,
    hours: Math.round(hours * 10) / 10,
    nodes: useDirect ? [] : nodes,
    coords,
    roads: useDirect ? ["local roads"] : roads,
    surfaces: useDirect ? { paved: 0, fair: 0, rough: 0 } : surfaces,
    borderCrossings: useDirect ? 0 : borderCrossings,
  };
  cache.set(key, out);
  return out;
}

export const MOMBASA_PORT = nodeById.get("mombasa")!;

/** The whole network, for drawing. */
export function roadNetwork() {
  return {
    nodes: ROAD_NODES,
    edges: ROAD_EDGES.map(([a, b, surface, road, border = false]) => ({
      from: a,
      to: b,
      surface,
      road,
      border,
      coords: [
        [nodeById.get(a)!.lat, nodeById.get(a)!.lng],
        [nodeById.get(b)!.lat, nodeById.get(b)!.lng],
      ],
    })),
  };
}
