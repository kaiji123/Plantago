import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { FlowGrower, NetDestination } from "../api";
import { EDGE_STYLE, KIND_COLOR, KIND_LABEL, MOMBASA, NEED_COLOR, type EdgeStatus, type MapEdge } from "./NetworkMap";

// Same dash language as the 2D map, in globe units (fractions of an arc's length).
const GLOBE_DASH: Record<EdgeStatus, [number, number]> = {
  candidate: [0.01, 0.04],
  queued: [0.03, 0.05],
  paid: [0.09, 0.05],
  shipped: [0.09, 0.05],
  delivered: [1, 0],
};
// The dark globe needs lighter tints of the 2D colours.
const GLOBE_COLOR: Partial<Record<EdgeStatus, string>> = { candidate: "rgba(230,225,210,0.45)", paid: "#4fbf86", shipped: "#5aaee6", delivered: "#9be3b8" };

interface Point {
  id: string;
  lat: number;
  lng: number;
  color: string;
  radius: number;
  alt: number;
  label: string;
  destination?: boolean;
}
interface Arc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  stroke: number;
  status: EdgeStatus;
  label: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const tip = (title: string, lines: string[]) =>
  `<div class="globe-tip"><strong>${esc(title)}</strong>${lines.map((l) => `<br/>${esc(l)}`).join("")}</div>`;

export default function GlobeView({
  growers,
  destinations,
  edges,
  selectedDestinationId,
  onSelectDestination,
  height = 560,
}: {
  growers: FlowGrower[];
  destinations: NetDestination[];
  edges: MapEdge[];
  selectedDestinationId?: string;
  onSelectDestination?: (id: string) => void;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // Start looking at East Africa, zoomed out enough to see India and South Africa.
  useEffect(() => {
    globe.current?.pointOfView({ lat: 2, lng: 45, altitude: 1.9 }, 0);
  }, []);

  const g = useMemo(() => new Map(growers.map((x) => [x.id, x])), [growers]);
  const d = useMemo(() => new Map(destinations.map((x) => [x.id, x])), [destinations]);
  const active = useMemo(() => new Set(edges.map((e) => e.growerId)), [edges]);

  const points: Point[] = useMemo(
    () => [
      ...growers.map((x) => {
        const on = active.has(x.id);
        return {
          id: x.id,
          lat: x.lat,
          lng: x.lng,
          color: on ? KIND_COLOR[x.kind] ?? KIND_COLOR.coop : "rgba(215,208,190,0.5)",
          radius: on ? 0.16 : 0.08,
          alt: on ? 0.012 : 0.004,
          label: tip(x.name, [`${KIND_LABEL[x.kind] ?? x.kind} · ${x.town}, ${x.country}`, x.transport === "sea" ? "Ships by sea via Mombasa" : "Ships by road", on ? "Sending now" : "Not sending"]),
        };
      }),
      ...destinations.map((x) => ({
        id: x.id,
        lat: x.lat,
        lng: x.lng,
        color: NEED_COLOR[x.need_phase] ?? "#e9a23b",
        radius: x.id === selectedDestinationId ? 0.4 : 0.28,
        alt: 0.016,
        label: tip(x.name, [`${x.county}, Kenya`, `Need phase ${x.need_phase} · ${(x.people_in_need / 1000).toFixed(0)}k people`]),
        destination: true,
      })),
    ],
    [growers, destinations, active, selectedDestinationId],
  );

  const arcs: Arc[] = useMemo(() => {
    const out: Arc[] = [];
    for (const e of edges) {
      const from = g.get(e.growerId);
      const to = d.get(e.destinationId) ?? g.get(e.destinationId);
      if (!from || !to) continue;
      const st = EDGE_STYLE[e.status];
      const base = {
        color: GLOBE_COLOR[e.status] ?? st.color,
        stroke: e.status === "candidate" ? 0.08 : 0.14 + 0.32 * Math.min(1, e.weight ?? 0.3),
        status: e.status,
        label: tip(`${from.name} → ${to.name}`, [e.label ?? "", st.label]),
      };
      // Sea routes: ship to Mombasa, then truck inland.
      const legs =
        from.transport === "sea"
          ? [
              [from, MOMBASA],
              [MOMBASA, to],
            ]
          : [[from, to]];
      for (const [a, b] of legs) out.push({ ...base, startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng });
    }
    return out;
  }, [edges, g, d]);

  const rings = useMemo(() => destinations.filter((x) => x.need_phase >= 4), [destinations]);

  return (
    <div ref={wrap} className="globe-wrap" style={{ height }}>
      <Globe
        ref={globe}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/globe/earth-blue-marble.jpg"
        bumpImageUrl="/globe/earth-topology.png"
        atmosphereColor="#9fd3b5"
        atmosphereAltitude={0.18}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointRadius="radius"
        pointAltitude="alt"
        pointLabel="label"
        pointsMerge={false}
        onPointClick={(p) => {
          const pt = p as Point;
          if (pt.destination && onSelectDestination) onSelectDestination(pt.id);
        }}
        arcsData={arcs}
        arcColor="color"
        arcStroke="stroke"
        arcLabel="label"
        arcAltitudeAutoScale={0.3}
        arcDashLength={(a) => GLOBE_DASH[(a as Arc).status][0]}
        arcDashGap={(a) => GLOBE_DASH[(a as Arc).status][1]}
        arcDashAnimateTime={(a) => (EDGE_STYLE[(a as Arc).status].animate ? 4000 : 0)}
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => (t: number) => `rgba(209,73,46,${0.8 * (1 - t)})`}
        ringMaxRadius={1.4}
        ringPropagationSpeed={1.5}
        ringRepeatPeriod={1400}
      />
    </div>
  );
}
