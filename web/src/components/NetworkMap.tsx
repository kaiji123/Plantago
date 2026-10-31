import type { FeatureCollection } from "geojson";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Pane, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { feature } from "topojson-client";
import { api, type FlowGrower, type NetDestination, type RoadNetwork } from "../api";
import MapSearch, { placesFrom, type Place } from "./MapSearch";

export type EdgeStatus = "candidate" | "queued" | "paid" | "shipped" | "delivered";

export interface MapEdge {
  growerId: string;
  destinationId: string;
  status: EdgeStatus;
  /** Relative load, 0..1. */
  weight?: number;
  label?: string;
  /** Polyline along the road network; drawn instead of a curve when present. */
  path?: [number, number][];
}

// One visual language for both the 2D map and the globe.
// Dashes say how far along a route is; only delivered routes are solid.
export const EDGE_STYLE: Record<EdgeStatus, { color: string; dash?: string; label: string; animate?: boolean }> = {
  candidate: { color: "#9a9483", dash: "1 5", label: "Could supply" },
  queued: { color: "#d99a1e", dash: "3 5", label: "Planned, awaiting payment" },
  paid: { color: "#2f8a5f", dash: "8 5", label: "Supplier paid, sourcing" },
  shipped: { color: "#2a7ab0", dash: "8 5", label: "On the road", animate: true },
  delivered: { color: "#1f4d3a", label: "Delivered" },
};
export const STATUS_ORDER: EdgeStatus[] = ["candidate", "queued", "paid", "shipped", "delivered"];

export const MOMBASA = { lat: -4.0435, lng: 39.6682 };

export const KIND_COLOR: Record<string, string> = {
  farm: "#e0b43c",
  coop: "#e0b43c",
  seed_supplier: "#6fae4f",
  tool_maker: "#5a9bc9",
  farmer_group: "#c0569a",
  importer: "#b9b2a0",
};
export const KIND_LABEL: Record<string, string> = {
  farm: "Grower",
  coop: "Grower",
  seed_supplier: "Seed supplier",
  tool_maker: "Tool maker",
  farmer_group: "Farmer group (grew Plantago seed)",
  importer: "Importer (baseline only)",
};
export const NEED_COLOR: Record<number, string> = { 3: "#e9a23b", 4: "#d1492e", 5: "#8c1c13" };
const IDLE_COLOR = "#cbc4b1";

/** Line width from load: thin by default, a little heavier for big loads. */
export const edgeWidth = (e: MapEdge) => (e.status === "candidate" ? 1 : 1.2 + 1.8 * Math.min(1, e.weight ?? 0.3));

type LatLng = [number, number];

/** A gentle arc between two points so overlapping routes stay readable. */
function curve(a: LatLng, b: LatLng, bend = 0.18, steps = 24): LatLng[] {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const mx = (lat1 + lat2) / 2;
  const my = (lng1 + lng2) / 2;
  // Control point: offset the midpoint perpendicular to the line.
  const cx = mx - (lng2 - lng1) * bend;
  const cy = my + (lat2 - lat1) * bend;
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([u * u * lat1 + 2 * u * t * cx + t * t * lat2, u * u * lng1 + 2 * u * t * cy + t * t * lng2]);
  }
  return pts;
}

function routePoints(from: FlowGrower, to: { lat: number; lng: number }): LatLng[] {
  if (from.transport === "sea") {
    const port: LatLng = [MOMBASA.lat, MOMBASA.lng];
    return [...curve([from.lat, from.lng], port, 0.12), ...curve(port, [to.lat, to.lng], 0.08).slice(1)];
  }
  return curve([from.lat, from.lng], [to.lat, to.lng]);
}

// ---- Basemap: Natural Earth country shapes (public domain), served by the app. No tile provider or API key. ----
let countriesPromise: Promise<FeatureCollection> | null = null;
function loadCountries(): Promise<FeatureCollection> {
  countriesPromise ??= fetch("/geo/countries-50m.json")
    .then((r) => r.json())
    .then((topo) => feature(topo, topo.objects.countries) as unknown as FeatureCollection);
  return countriesPromise;
}

export function Basemap({ highlight = [] }: { highlight?: string[] }) {
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    loadCountries().then(setCountries).catch(() => setCountries(null));
  }, []);
  if (!countries) return null;
  // Own pane below Leaflet's overlay pane (z-index 400), so routes and dots always draw on top,
  // even though the shapes finish loading after them.
  return (
    <Pane name="basemap" style={{ zIndex: 150 }}>
    <GeoJSON
      key={highlight.join("|")}
      data={countries}
      interactive={false}
      attribution='Countries: <a href="https://www.naturalearthdata.com/">Natural Earth</a>'
      style={(f) => {
        const name = f?.properties?.name as string;
        const isKenya = name === "Kenya";
        const sending = highlight.includes(name);
        return {
          fillColor: isKenya ? "#efe6cf" : sending ? "#e3efe2" : "#f6f3ec",
          fillOpacity: 1,
          color: isKenya ? "#c9b98f" : sending ? "#a9c7a6" : "#d9d1c0",
          weight: isKenya || sending ? 0.9 : 0.5,
        };
      }}
    />
    </Pane>
  );
}

/**
 * Leaflet draws markers at a fixed pixel size, so they'd look smaller and smaller as the land
 * grows. Scale dots, lines and dashes with zoom instead (1x at zoom 5), within limits.
 */
export const zoomScale = (zoom: number) => Math.min(2.4, Math.max(0.8, 1 + (zoom - 5) * 0.35));
const scaleDash = (dash: string | undefined, k: number) => dash?.split(" ").map((n) => String(Math.round(Number(n) * k * 10) / 10)).join(" ");

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}

/** The highway network, drawn faintly under everything else. */
export function RoadsLayer({ roads, k = 1 }: { roads: RoadNetwork | null; k?: number }) {
  if (!roads) return null;
  return (
    <Pane name="roads" style={{ zIndex: 300 }}>
      {roads.edges.map((e) => (
        <Polyline
          key={`${e.from}-${e.to}`}
          positions={e.coords}
          interactive={false}
          pathOptions={{
            color: e.surface === "paved" ? "#a89f8a" : e.surface === "fair" ? "#c2b9a3" : "#cfc6b2",
            weight: (e.surface === "paved" ? 1.6 : 1.2) * Math.min(k, 1.8),
            dashArray: e.surface === "rough" ? "2 4" : undefined,
            opacity: 0.9,
          }}
        />
      ))}
    </Pane>
  );
}

let roadsPromise: Promise<RoadNetwork> | null = null;
export function useRoads(): RoadNetwork | null {
  const [roads, setRoads] = useState<RoadNetwork | null>(null);
  useEffect(() => {
    roadsPromise ??= api.roads();
    roadsPromise.then(setRoads).catch(() => setRoads(null));
  }, []);
  return roads;
}

/**
 * Fit the view once per change of what's shown. A place picked in the search box wins:
 * the map stays on it, even when picking it changes the routes shown.
 */
function FitTo({ points, maxZoom, focus }: { points: LatLng[]; maxZoom: number; focus: Place | null }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (focus) {
      map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 7), { duration: 0.8 });
      return;
    }
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [24, 24], maxZoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map, focus]);
  return null;
}

export default function NetworkMap({
  growers,
  destinations,
  edges,
  selectedDestinationId,
  onSelectDestination,
  height = 460,
  showLegend = true,
  fadeIdle = true,
  view = "fit",
  showRoads = true,
  searchable = true,
}: {
  growers: FlowGrower[];
  destinations: NetDestination[];
  edges: MapEdge[];
  selectedDestinationId?: string;
  onSelectDestination?: (id: string) => void;
  height?: number;
  showLegend?: boolean;
  fadeIdle?: boolean;
  /** "fit": zoom to the routes shown. "world": show the whole global network. */
  view?: "fit" | "world";
  /** Draw the highway network underneath. */
  showRoads?: boolean;
  /** Show the "find a place" search box over the map. */
  searchable?: boolean;
}) {
  const roads = useRoads();
  const [zoom, setZoom] = useState(view === "world" ? 3 : 5);
  const k = zoomScale(zoom);
  const [found, setFound] = useState<Place | null>(null);
  // Choosing another destination some other way (a dot, the Give form) lets the map fit again.
  useEffect(() => {
    setFound((f) => (f && !(f.type === "destination" && f.id === selectedDestinationId) ? null : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestinationId]);
  const places = useMemo(
    () => placesFrom(growers, destinations, { need: NEED_COLOR, kind: KIND_COLOR, kindLabel: KIND_LABEL }),
    [growers, destinations],
  );
  const g = new Map(growers.map((x) => [x.id, x]));
  const d = new Map(destinations.map((x) => [x.id, x]));
  const active = new Set(edges.map((e) => e.growerId));
  const sorted = [...edges].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const fitPoints: LatLng[] =
    view === "world"
      ? [...growers, ...destinations].map((x) => [x.lat, x.lng])
      : [
          ...edges.flatMap((e) => {
            const from = g.get(e.growerId);
            const to = d.get(e.destinationId) ?? g.get(e.destinationId); // a destination, or a farmer who bought in the shop
            return from && to ? ([[from.lat, from.lng], [to.lat, to.lng]] as LatLng[]) : [];
          }),
          ...destinations.filter((x) => x.id === selectedDestinationId).map((x) => [x.lat, x.lng] as LatLng),
        ];

  const edgeLine = (e: MapEdge, i: number) => {
    const from = g.get(e.growerId);
    const to = d.get(e.destinationId) ?? g.get(e.destinationId); // a destination, or a farmer who bought in the shop
    if (!from || !to) return null;
    const st = EDGE_STYLE[e.status];
    return (
      <Polyline
        key={`${e.growerId}-${e.destinationId}-${e.status}-${i}`}
        positions={e.path ?? routePoints(from, to)}
        pathOptions={{
          color: st.color,
          weight: edgeWidth(e) * k,
          opacity: e.status === "candidate" ? 0.6 : 0.9,
          dashArray: scaleDash(st.dash, k),
          lineCap: "round",
          className: st.animate ? "flow-anim" : undefined,
        }}
      >
        {e.label && <Tooltip sticky>{e.label}</Tooltip>}
      </Polyline>
    );
  };

  return (
    <div className="netmap">
      <div className="map" style={{ height, ["--map-h" as string]: `${height}px` }}>
        {searchable && (
          <MapSearch
            places={places}
            onClear={() => setFound(null)}
            onPick={(p) => {
              setFound(p);
              if (p.type === "destination" && onSelectDestination && p.id !== selectedDestinationId) onSelectDestination(p.id);
            }}
          />
        )}
        <MapContainer
          center={view === "world" ? [5, 50] : [0.9, 37.8]}
          zoom={view === "world" ? 3 : 5}
          minZoom={2}
          maxZoom={8}
          worldCopyJump
          scrollWheelZoom={view === "world"}
          style={{ height: "100%", width: "100%" }}
        >
          <Basemap highlight={[...new Set(edges.map((e) => g.get(e.growerId)?.country).filter((c): c is string => !!c && c !== "Kenya"))]} />
          {showRoads && <RoadsLayer roads={roads} k={k} />}
          <FitTo points={fitPoints} maxZoom={view === "world" ? 5 : 7} focus={found} />
          <ZoomWatcher onZoom={setZoom} />

          {sorted.filter((e) => !EDGE_STYLE[e.status].animate).map(edgeLine)}
          {/* Moving routes get their own pane (their own SVG), so the dash animation repaints only them, not every route and road. */}
          <Pane name="moving" style={{ zIndex: 410 }}>
            {sorted.filter((e) => EDGE_STYLE[e.status].animate).map(edgeLine)}
          </Pane>

          {growers.map((x) => {
            const on = active.has(x.id);
            const idle = fadeIdle && !on;
            return (
              <CircleMarker
                key={x.id}
                center={[x.lat, x.lng]}
                radius={(idle ? 2.5 : 4.5) * k}
                pathOptions={{
                  color: "#fff",
                  weight: idle ? 0 : 1.2 * Math.min(k, 1.6),
                  fillColor: idle ? IDLE_COLOR : KIND_COLOR[x.kind] ?? KIND_COLOR.coop,
                  fillOpacity: idle ? 0.85 : 1,
                }}
              >
                <Tooltip>
                  <strong>{x.name}</strong>
                  <br />
                  {KIND_LABEL[x.kind] ?? x.kind} · {x.town}, {x.country ?? "Kenya"}
                  {x.transport === "sea" && <> · ships by sea via Mombasa</>}
                  <br />
                  {on ? "Part of these routes" : "Not sending anything here"}
                </Tooltip>
              </CircleMarker>
            );
          })}

          {destinations.map((x) => {
            const sel = x.id === selectedDestinationId;
            return [
              sel && (
                <CircleMarker
                  key={`${x.id}-halo`}
                  center={[x.lat, x.lng]}
                  radius={14 * k}
                  interactive={false}
                  pathOptions={{ color: NEED_COLOR[x.need_phase], weight: 1, dashArray: "2 3", fillColor: NEED_COLOR[x.need_phase], fillOpacity: 0.12 }}
                />
              ),
              // Keyed on selection: Leaflet only reads a tooltip's "permanent" when it is created.
              <CircleMarker
                key={`${x.id}-${sel ? "sel" : ""}`}
                center={[x.lat, x.lng]}
                radius={(sel ? 7.5 : 5.5) * k}
                pathOptions={{ color: sel ? "#1f4d3a" : "#fff", weight: (sel ? 2 : 1.5) * Math.min(k, 1.6), fillColor: NEED_COLOR[x.need_phase] ?? "#e9a23b", fillOpacity: 1 }}
                eventHandlers={onSelectDestination ? { click: () => onSelectDestination(x.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -6]} permanent={sel} className={sel ? "dest-label" : undefined}>
                  <strong>{x.name}</strong>
                  {!sel && (
                    <>
                      , {x.county}
                      <br />
                      Need phase {x.need_phase} · {(x.people_in_need / 1000).toFixed(0)}k people
                    </>
                  )}
                </Tooltip>
              </CircleMarker>,
            ];
          })}

          {found && (
            // Own pane (its own small SVG): the pulse then repaints only the ring, not every road and route.
            <Pane name="found" style={{ zIndex: 450 }}>
            <CircleMarker
              key={`found-${found.type}-${found.id}`}
              center={[found.lat, found.lng]}
              radius={16 * k}
              interactive={false}
              pathOptions={{ color: "#1f4d3a", weight: 2, dashArray: "3 4", fillColor: found.color, fillOpacity: 0.15, className: "found-ring" }}
            >
              {found.type === "grower" && (
                <Tooltip direction="top" offset={[0, -14 * k]} permanent className="dest-label">
                  {found.name}
                </Tooltip>
              )}
            </CircleMarker>
            </Pane>
          )}
        </MapContainer>
      </div>
      {showLegend && <NetworkLegend statuses={[...new Set(edges.map((e) => e.status))]} showIdle={fadeIdle} />}
    </div>
  );
}

/** Legend shared by the 2D map and the globe. Line samples are drawn with the real dash patterns. */
export function NetworkLegend({ statuses, showIdle = true, pulsing = false }: { statuses: EdgeStatus[]; showIdle?: boolean; pulsing?: boolean }) {
  const dot = (color: string, size = 9, ring = true) => (
    <svg width={size + 4} height={size + 4} aria-hidden>
      <circle cx={(size + 4) / 2} cy={(size + 4) / 2} r={size / 2} fill={color} stroke={ring ? "#fff" : "none"} strokeWidth={1.2} />
    </svg>
  );
  return (
    <div className="legend">
      <span>{dot(NEED_COLOR[4], 11)} Destination{pulsing ? " (pulsing = emergency)" : " (red = emergency, orange = crisis)"}</span>
      <span>{dot(KIND_COLOR.coop)} Grower</span>
      <span>{dot(KIND_COLOR.seed_supplier)} Seed supplier</span>
      <span>{dot(KIND_COLOR.tool_maker)} Tool maker</span>
      <span>{dot(KIND_COLOR.farmer_group)} Farmer group (grew Plantago seed)</span>
      {showIdle && <span>{dot(IDLE_COLOR, 6, false)} Not sending</span>}
      {STATUS_ORDER.filter((s) => statuses.includes(s)).map((s) => (
        <span key={s}>
          <svg width="28" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="27"
              y2="4"
              stroke={EDGE_STYLE[s].color}
              strokeWidth={s === "candidate" ? 1.5 : 2}
              strokeDasharray={EDGE_STYLE[s].dash}
              strokeLinecap="round"
              className={EDGE_STYLE[s].animate ? "flow-anim" : undefined}
            />
          </svg>
          {EDGE_STYLE[s].label}
        </span>
      ))}
    </div>
  );
}
