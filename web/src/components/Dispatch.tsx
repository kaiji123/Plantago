import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import { api, num, usd, type DispatchRun, type DispatchStop, type RunPlan } from "../api";
import { usePoll } from "../hooks";
import { Basemap, RoadsLayer, useRoads } from "./NetworkMap";

type Shown = { kind: "proposal"; plan: RunPlan } | { kind: "run"; run: DispatchRun };

/** Operator dispatch: proposed truck runs, one click to send, one click when delivered. */
export default function Dispatch({ act, busy }: { act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; busy: boolean }) {
  const { data, reload } = usePoll(() => api.operator.dispatch(), 5000, []);
  const [selected, setSelected] = useState<string | null>(null);
  const proposals = data?.proposals ?? [];
  const onRoad = (data?.runs ?? []).filter((r) => r.status === "on_road");
  const delivered = (data?.runs ?? []).filter((r) => r.status === "delivered").slice(0, 6);

  const shown: Shown | null = useMemo(() => {
    const p = proposals.find((x) => x.key === selected);
    if (p) return { kind: "proposal", plan: p };
    const r = (data?.runs ?? []).find((x) => x.id === selected);
    if (r) return { kind: "run", run: r };
    if (proposals[0]) return { kind: "proposal", plan: proposals[0] };
    if (onRoad[0]) return { kind: "run", run: onRoad[0] };
    return null;
  }, [selected, proposals, data, onRoad]);

  const totalSaving = proposals.reduce((a, p) => a + p.savingsCents, 0);
  const run = (fn: () => Promise<unknown>, ok?: string) => act(() => fn().then((r) => (reload(), r)), ok);

  return (
    <div className="dispatch">
      <p className="muted small" style={{ marginTop: 0 }}>
        Paid shipments are grouped by drop-off region and routed along the road network: pickups first (starting with the farthest), then drop-offs, with the stop
        order improved by 2-opt. Imports are collected where they enter Kenya: Mombasa port or the border post. Each run is costed two ways, as a dedicated{" "}
        {data?.truck.name ?? "truck"} or as part loads on scheduled lorries, and the cheaper one is recommended. Small loads ride on scheduled lorries; once enough
        loads head the same way, a truck pays off.
      </p>
      <div className="dispatch-grid">
        <div className="dispatch-list">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Ready to dispatch ({proposals.length})</h3>
            {totalSaving > 0 && <span className="saving-badge">saves {usd(totalSaving)}</span>}
          </div>
          {proposals.length === 0 && <p className="muted small">Nothing waiting. Shipments appear here once their suppliers have been paid.</p>}
          {proposals.map((p) => (
            <RunCard
              key={p.key}
              title={`${p.stops.filter((s) => s.kind === "drop").map((s) => s.name).join(" + ")}`}
              stops={p.stops}
              km={p.km}
              days={p.days}
              loadKg={p.loadKg}
              capacityKg={p.capacityKg}
              costCents={p.costCents}
              separateCents={p.separateCostCents}
              roads={p.roads}
              mode={p.recommended}
              compare={{ truck: p.truckCostCents, parts: p.partLoadCostCents, breakEvenKg: p.breakEvenKg }}
              active={shown?.kind === "proposal" && shown.plan.key === p.key}
              onSelect={() => setSelected(p.key)}
              action={
                <span className="row" style={{ gap: 6 }}>
                  {(["truck", "part_loads"] as ("truck" | "part_loads")[])
                    .sort((a) => (a === p.recommended ? -1 : 1))
                    .map((m) => (
                      <button
                        key={m}
                        className={m === p.recommended ? `ship-btn ${m === "truck" ? "ship" : "deliver"}` : "btn tiny ghost"}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          run(() => api.operator.dispatchRun(p.cargo.map((c) => c.key), m));
                        }}
                      >
                        {m === "truck" ? "🚚 Dispatch truck" : "📦 Send as part loads"}
                        {m !== p.recommended && ` (${usd(m === "truck" ? p.truckCostCents : p.partLoadCostCents)})`}
                      </button>
                    ))}
                </span>
              }
            />
          ))}

          <h3>On the road ({onRoad.length})</h3>
          {onRoad.length === 0 && <p className="muted small">No trucks out.</p>}
          {onRoad.map((r) => (
            <RunCard
              key={r.id}
              title={r.stops.filter((s) => s.kind === "drop").map((s) => s.name).join(" + ")}
              stops={r.stops}
              km={r.km}
              days={r.days}
              loadKg={r.load_kg}
              capacityKg={r.capacity_kg}
              costCents={r.cost_cents}
              separateCents={r.separate_cost_cents}
              roads={r.roads}
              mode={r.mode}
              since={r.created_at}
              active={shown?.kind === "run" && shown.run.id === r.id}
              onSelect={() => setSelected(r.id)}
              action={
                <button
                  className="ship-btn deliver"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(() => api.operator.deliverRun(r.id));
                  }}
                >
                  ✓ Mark delivered
                </button>
              }
            />
          ))}

          {delivered.length > 0 && (
            <>
              <h3>Recently delivered</h3>
              {delivered.map((r) => (
                <button key={r.id} className={`run-mini ${shown?.kind === "run" && shown.run.id === r.id ? "on" : ""}`} onClick={() => setSelected(r.id)}>
                  ✓ {r.mode === "truck" ? "🚚" : "📦"} {r.stops.filter((s) => s.kind === "drop").map((s) => s.name).join(" + ")} · {num(r.km)} km ·{" "}
                  {new Date(r.delivered_at!).toLocaleDateString()}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="dispatch-map">
          <RunMap shown={shown} />
          {shown && <Manifest shown={shown} />}
        </div>
      </div>
    </div>
  );
}

function RunCard(p: {
  title: string;
  stops: DispatchStop[];
  km: number;
  days: number;
  loadKg: number;
  capacityKg: number;
  costCents: number;
  separateCents: number;
  roads: string[];
  mode: "truck" | "part_loads";
  compare?: { truck: number; parts: number; breakEvenKg: number | null };
  since?: string;
  active: boolean;
  onSelect: () => void;
  action: React.ReactNode;
}) {
  const fill = Math.min(100, (p.loadKg / p.capacityKg) * 100);
  const saving = p.separateCents - p.costCents;
  const be = p.compare?.breakEvenKg;
  return (
    <div role="button" tabIndex={0} className={`run-card ${p.active ? "on" : ""}`} onClick={p.onSelect} onKeyDown={(e) => e.key === "Enter" && p.onSelect()}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{p.mode === "truck" ? "🚚" : "📦"} To {p.title}</strong>
          <div className={`mode-tag ${p.mode}`}>{p.mode === "truck" ? "Dedicated 3-tonne truck" : "Part loads on scheduled lorries"}</div>
          <div className="muted small">
            {p.stops.length} stops · {num(p.km)} km · ~{p.days} day{p.days === 1 ? "" : "s"}
            {p.since && <> · out since {new Date(p.since).toLocaleDateString()}</>}
          </div>
        </div>
        {saving > 0 && <span className="saving-badge">saves {usd(saving)}</span>}
      </div>
      <ol className="stop-chips">
        {p.stops.map((s, i) => (
          <li key={s.id + i} className={s.kind}>
            <span>{i + 1}</span>
            {s.name}
          </li>
        ))}
      </ol>
      <div className="load">
        <div className="bar load-bar">
          <span style={{ width: `${Math.max(2, fill)}%` }} />
          {be != null && <i className="breakeven" style={{ left: `${Math.min(100, (be / p.capacityKg) * 100)}%` }} title={`A truck pays off from about ${num(be)} kg`} />}
        </div>
        <span className="muted small">
          {num(p.loadKg)} of {num(p.capacityKg)} kg
          {p.compare &&
            (be != null
              ? p.loadKg >= be
                ? ` · full enough for a truck (pays off from ${num(be)} kg)`
                : ` · a truck pays off from about ${num(be)} kg`
              : " · too light for a truck to pay off on this route")}
        </span>
        {p.compare && (
          <span className="small cost-compare">
            <span className={p.mode === "truck" ? "best" : ""}>🚚 Truck {usd(p.compare.truck)}</span>
            <span className={p.mode === "part_loads" ? "best" : ""}>📦 Part loads {usd(p.compare.parts)}</span>
          </span>
        )}
        <span className="muted small">via {p.roads.slice(0, 5).join(" → ")}{p.roads.length > 5 ? " …" : ""}</span>
      </div>
      <div className="run-action">{p.action}</div>
    </div>
  );
}

function Manifest({ shown }: { shown: Shown }) {
  const cargo =
    shown.kind === "proposal"
      ? shown.plan.cargo.map((c) => ({ key: c.key, kind: c.kind, description: c.description, weightKg: c.weightKg, from: c.pickup.name, to: c.drop.name }))
      : shown.run.cargo;
  return (
    <table className="table manifest">
      <thead>
        <tr>
          <th>Load</th>
          <th>From</th>
          <th>To</th>
          <th className="r">Kg</th>
        </tr>
      </thead>
      <tbody>
        {cargo.map((c) => (
          <tr key={c.key}>
            <td>
              {c.description}
              {c.kind === "farmer_order" && <span className="pill farmer" style={{ marginLeft: 6 }}>Farmer purchase</span>}
            </td>
            <td>{c.from}</td>
            <td>{c.to}</td>
            <td className="r">{num(c.weightKg, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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

function RunMap({ shown }: { shown: Shown | null }) {
  const roads = useRoads();
  const stops = shown ? (shown.kind === "proposal" ? shown.plan.stops : shown.run.stops) : [];
  const path = shown ? (shown.kind === "proposal" ? shown.plan.path : shown.run.path) : [];
  const onRoad = shown?.kind === "run" && shown.run.status === "on_road";
  const done = shown?.kind === "run" && shown.run.status === "delivered";
  return (
    <div className="map" style={{ height: 460 }}>
      <MapContainer center={[1.5, 37.5]} zoom={6} minZoom={4} maxZoom={9} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
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
          <Marker key={s.id + i} position={[s.lat, s.lng]} icon={stopIcon(i + 1, s.kind)}>
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
