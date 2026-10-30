import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { lazy, Suspense, useMemo, useState } from "react";
import { api, num } from "../api";
import Grid, { moneyCol } from "../components/Grid";
import NetworkMap, { EDGE_STYLE, NetworkLegend, type MapEdge } from "../components/NetworkMap";

// three.js is large; only load it when someone opens the globe.
const GlobeView = lazy(() => import("../components/GlobeView"));
import { usePoll } from "../hooks";

type Mode = "all" | "food_now" | "grow_there";

export default function NetworkPage() {
  const { data } = usePoll(() => api.flows(), 5000, []);
  const [dest, setDest] = useState<string>("all");
  const [mode, setMode] = useState<Mode>("all");
  const [view, setView] = useState<"map" | "globe">("map");

  const growerById = useMemo(() => new Map((data?.growers ?? []).map((g) => [g.id, g])), [data]);
  const destById = useMemo(() => new Map((data?.destinations ?? []).map((d) => [d.id, d])), [data]);
  const flows = (data?.edges ?? []).filter((e) => (dest === "all" || e.destination_id === dest) && (mode === "all" || e.mode === mode || (mode === "grow_there" && e.mode === "farmer_order")));
  const maxKg = Math.max(1, ...flows.map((e) => e.kg));

  const edges: MapEdge[] = flows.map((e) => ({
    growerId: e.grower_id,
    destinationId: e.destination_id,
    status: e.status,
    weight: e.kg / maxKg,
    label: `${growerById.get(e.grower_id)?.name} → ${destById.get(e.destination_id)?.name ?? growerById.get(e.destination_id)?.name}: ${e.mode === "farmer_order" ? "farmer purchase, " : ""}${num(e.kg)} ${e.mode === "food_now" ? "kg " : ""}${e.crops.toLowerCase()} (${EDGE_STYLE[e.status].label.toLowerCase()})`,
  }));

  const growers = (data?.growers ?? []).filter((g) => g.kind !== "importer");
  const countries = [...new Set(flows.map((e) => growerById.get(e.grower_id)?.country).filter(Boolean))];
  const sending = new Set(flows.map((e) => e.grower_id));
  const idle = growers.filter((g) => !sending.has(g.id));
  const byStatus = (s: string) => flows.filter((e) => e.status === s).reduce((a, e) => a + e.kg, 0);

  const rows = flows.map((e) => ({
    ...e,
    grower: growerById.get(e.grower_id)?.name,
    town: growerById.get(e.grower_id)?.town,
    country: growerById.get(e.grower_id)?.country,
    transport: growerById.get(e.grower_id)?.transport,
    destination: destById.get(e.destination_id)?.name ?? `${growerById.get(e.destination_id)?.name} (farmer purchase)`,
  }));
  const cols: ColDef<any>[] = [
    { field: "grower", headerName: "From", minWidth: 240, pinned: "left" },
    { field: "town", headerName: "Town", minWidth: 120 },
    { field: "country", headerName: "Country", minWidth: 130 },
    { field: "transport", headerName: "By", minWidth: 120, valueFormatter: (p) => (p.value === "sea" ? "Sea + road" : "Road") },
    { field: "destination", headerName: "To", minWidth: 120 },
    { field: "mode", headerName: "Type", minWidth: 150, valueFormatter: (p) => (p.value === "grow_there" ? "Seed / tools" : p.value === "farmer_order" ? "Farmer purchase" : "Food") },
    { field: "crops", headerName: "Items", minWidth: 220, tooltipField: "crops", valueFormatter: (p) => String(p.value ?? "").split(",").join(", ") },
    { field: "kg", headerName: "Kg / units", minWidth: 120, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => num(p.value, 1) },
    { ...moneyCol("cents", "Value"), minWidth: 120 },
    { field: "meals", headerName: "Meals", minWidth: 110, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => num(p.value) },
    {
      field: "status",
      headerName: "Status",
      minWidth: 240,
      cellRenderer: (p: ICellRendererParams) => (
        <span className="pill" style={{ background: EDGE_STYLE[p.value as keyof typeof EDGE_STYLE].color, color: "#fff" }}>
          {EDGE_STYLE[p.value as keyof typeof EDGE_STYLE].label}
        </span>
      ),
    },
  ];

  return (
    <div className="page wide">
      <h1 className="h-page">The plant network</h1>
      <p className="muted">
        Every grower, seed supplier and tool maker, in Kenya and abroad, and every destination. Lines show what donations have set moving: the dash pattern
        shows how far along a route is, a slightly heavier line carries more, and sea freight goes via Mombasa. Faint dots are suppliers not sending anything
        right now. Switch to the globe for a 3D view.
      </p>

      <div className="row filters">
        <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="all">All destinations</option>
          {(data?.destinations ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}, {d.county}</option>
          ))}
        </select>
        <div className="tabs small-tabs">
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>🗺️ World map</button>
          <button className={view === "globe" ? "on" : ""} onClick={() => setView("globe")}>🌍 Globe</button>
        </div>
        <div className="tabs small-tabs">
          {(["all", "food_now", "grow_there"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "all" ? "Everything" : m === "food_now" ? "Food now" : "Seed and tools"}
            </button>
          ))}
        </div>
      </div>

      <div className="stats net-stats">
        <Stat value={`${sending.size} / ${growers.length}`} label="growers sending" />
        <Stat value={String(flows.length)} label="active routes" />
        <Stat value={String(countries.length || 0)} label={`countries sending${countries.length ? `: ${countries.join(", ")}` : ""}`} />
        <Stat value={`${num(byStatus("queued") + byStatus("paid"))} kg`} label="planned or being sourced" />
        <Stat value={`${num(byStatus("shipped"))} kg`} label="on the road" />
        <Stat value={`${num(byStatus("delivered"))} kg`} label="delivered" />
      </div>

      {data && view === "map" && (
        <NetworkMap
          growers={data.growers.filter((g) => g.kind !== "importer")}
          destinations={data.destinations}
          edges={edges}
          selectedDestinationId={dest === "all" ? undefined : dest}
          onSelectDestination={(id) => setDest(id === dest ? "all" : id)}
          height={580}
          view="world"
        />
      )}
      {data && view === "globe" && (
        <Suspense fallback={<div className="globe-wrap globe-loading" style={{ height: 600 }}>Loading globe…</div>}>
          <GlobeView
            growers={data.growers.filter((g) => g.kind !== "importer")}
            destinations={data.destinations}
            edges={edges}
            selectedDestinationId={dest === "all" ? undefined : dest}
            onSelectDestination={(id) => setDest(id === dest ? "all" : id)}
            height={600}
          />
          <NetworkLegend statuses={[...new Set(edges.map((e) => e.status))]} pulsing />
        </Suspense>
      )}

      <h3>Routes</h3>
      <Grid rows={rows} cols={cols} height={360} />

      <h3>Not sending ({idle.length})</h3>
      <p className="muted small">
        {idle.length === 0
          ? "Every grower in this view is part of a delivery."
          : idle.map((g) => `${g.name} (${g.town}, ${g.country})`).join(" · ")}
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}
