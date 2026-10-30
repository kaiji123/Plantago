import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import { num, usd, type DispatchRun, type DispatchStop } from "../api";
import { Basemap, RoadsLayer, useRoads } from "./NetworkMap";

const stopIcon = (n: number, kind: "pickup" | "drop") =>
  L.divIcon({ className: "", html: `<div class="stop-pin ${kind}">${n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** A run's road route with numbered stops (yellow pickups, red drop-offs). */
export function RunMap({
  stops,
  path,
  status,
  height = 460,
  highlight,
}: {
  stops: DispatchStop[];
  path: [number, number][];
  status?: "planned" | "on_road" | "delivered";
  height?: number;
  /** Stop ids to emphasise (e.g. this donation's destination). */
  highlight?: string[];
}) {
  const roads = useRoads();
  const onRoad = status === "on_road";
  const done = status === "delivered";
  return (
    <div className="map" style={{ height }}>
      <MapContainer center={[1.5, 37.5]} zoom={6} minZoom={4} maxZoom={9} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <Basemap />
        <RoadsLayer roads={roads} k={1.2} />
        {path.length > 1 && (
          <>
            <Polyline positions={path} pathOptions={{ color: "#fff", weight: 7, opacity: 0.9, lineCap: "round" }} />
            <Polyline
              positions={path}
              pathOptions={{
                color: done ? "#1f4d3a" : "#2a7ab0",
                weight: 3.5,
                lineCap: "round",
                dashArray: onRoad ? "10 7" : undefined,
                className: onRoad ? "flow-anim" : undefined,
              }}
            />
          </>
        )}
        {stops.map((s, i) => (
          <Marker key={s.id + i} position={[s.lat, s.lng]} icon={stopIcon(i + 1, s.kind)} zIndexOffset={highlight?.includes(s.id) ? 1000 : 0}>
            <Tooltip direction="top" offset={[0, -12]}>
              <strong>
                {i + 1}. {s.kind === "pickup" ? "Pick up at" : "Deliver to"} {s.name}
              </strong>
              {s.note && (
                <>
                  <br />
                  {s.note}
                </>
              )}
              <br />
              {num(s.kg, 1)} kg · {s.cargo.length} load{s.cargo.length === 1 ? "" : "s"}
            </Tooltip>
          </Marker>
        ))}
        <Fit points={path.length ? path : stops.map((s) => [s.lat, s.lng] as [number, number])} />
      </MapContainer>
    </div>
  );
}

export const modeLabel = (m: string) => (m === "truck" ? "Dedicated 3-tonne truck" : "Part loads on scheduled lorries");

/** Read-only summary of a run for donors, farmers and the public ledger. */
export function RunSummary({ run, mine, showMap = true }: { run: DispatchRun; mine?: string[]; showMap?: boolean }) {
  const drops = run.stops.filter((s) => s.kind === "drop").map((s) => s.name);
  const myLoads = mine ? run.cargo.filter((c) => mine.includes(c.key)).length : 0;
  const others = run.cargo.length - myLoads;
  const saving = run.separate_cost_cents - run.cost_cents;
  return (
    <div className="card run-public">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>
            {run.mode === "truck" ? "🚚" : "📦"} To {drops.join(" + ")}
          </strong>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <span className={`mode-tag ${run.mode}`}>{modeLabel(run.mode)}</span>
            <span className={`ship-pill`} style={run.status === "delivered" ? { color: "#fff", background: "#1f4d3a" } : { color: "#1f6694", background: "#e0eef8" }}>
              <i style={{ background: run.status === "delivered" ? "#9be3b8" : "#1f6694" }} />
              {run.status === "delivered" ? `Delivered ${new Date(run.delivered_at!).toLocaleDateString()}` : `On the road since ${new Date(run.created_at).toLocaleDateString()}`}
            </span>
          </div>
        </div>
        {saving > 0 && <span className="saving-badge">consolidation saved {usd(saving)}</span>}
      </div>
      <ol className="stop-chips">
        {run.stops.map((s, i) => (
          <li key={s.id + i} className={s.kind} title={s.note}>
            <span>{i + 1}</span>
            {s.name}
          </li>
        ))}
      </ol>
      <div className="muted small">
        {num(run.km)} km by road · about {run.days} day{run.days === 1 ? "" : "s"} · {num(run.load_kg)} kg in {run.cargo.length} load{run.cargo.length === 1 ? "" : "s"}
        {mine && others > 0 && <> · shared with {others} other load{others === 1 ? "" : "s"}, so each pays less for transport</>} · via{" "}
        {run.roads.slice(0, 5).join(" → ")}
        {run.roads.length > 5 ? " …" : ""}
      </div>
      {showMap && <RunMap stops={run.stops} path={run.path} status={run.status} height={300} />}
    </div>
  );
}
