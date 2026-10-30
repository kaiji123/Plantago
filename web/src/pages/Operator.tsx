import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getOperatorToken, setOperatorToken, usd } from "../api";
import Grid, { dateCol, moneyCol } from "../components/Grid";
import { ShipAction, ShipStatusPill, type ShipStatus } from "../components/ShipmentStatus";
import { PromiseCard } from "./Farmers";
import Dispatch from "../components/Dispatch";
import { useConfig, usePoll } from "../hooks";

type Tab = "dispatch" | "shipments" | "harvests" | "payouts" | "donations" | "network";

export default function OperatorPage() {
  const cfg = useConfig();
  const [token, setToken] = useState(getOperatorToken());
  const [tab, setTab] = useState<Tab>("dispatch");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = usePoll(() => api.operator.overview(), 4000, [token]);
  const network = usePoll(() => api.network(), 30000, []);
  const harvests = usePoll(() => api.operator.harvests(), 5000, [token]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r: any = await fn();
      setMsg(ok ?? r?.message ?? "Done");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (cfg?.operatorTokenRequired && (error?.includes("token") || !token)) {
    return (
      <div className="page narrow">
        <h1 className="h-page">Operator</h1>
        <p className="muted">Enter the operator token (see the README for the demo token).</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = (new FormData(e.currentTarget).get("t") as string).trim();
            setOperatorToken(v);
            setToken(v);
          }}
        >
          <input name="t" type="password" defaultValue={token} placeholder="Operator token" />
          <button className="btn primary">Open</button>
        </form>
        {error && token && <p className="error">{error}</p>}
      </div>
    );
  }

  const unpaidTotal = (data?.unpaid ?? []).reduce((a: number, l: any) => a + l.total_cents, 0);

  const shipmentCols: ColDef<any>[] = [
    { field: "destination", headerName: "To", minWidth: 200, tooltipField: "destination" },
    {
      field: "kind",
      headerName: "Type",
      minWidth: 140,
      cellRenderer: (p: ICellRendererParams) => <span className={`pill ${p.value === "farmer_order" ? "farmer" : ""}`}>{p.value === "farmer_order" ? "Farmer purchase" : "Donation"}</span>,
    },
    { field: "grower", headerName: "Supplier", minWidth: 260, tooltipField: "grower" },
    { field: "description", headerName: "Load", minWidth: 300, tooltipField: "description" },
    {
      field: "status",
      headerName: "Status",
      minWidth: 170,
      cellRenderer: (p: ICellRendererParams) => <ShipStatusPill status={p.value as ShipStatus} />,
    },
    { field: "eta_days", headerName: "Transit", minWidth: 120, valueFormatter: (p) => `~${p.value} day${p.value === 1 ? "" : "s"}` },
    {
      headerName: "Next step",
      minWidth: 180,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) =>
        p.data.kind === "farmer_order" && p.data.status === "awaiting_payment" ? (
          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <span className="ship-wait">Pay supplier first</span>
            <button
              className="btn tiny ghost"
              disabled={busy}
              onClick={() => confirm("Refund this farmer's purchase through PayPal?") && act(() => api.operator.refundFarmerOrder(p.data.id))}
            >
              Refund
            </button>
          </span>
        ) : (
          <ShipAction status={p.data.status} busy={busy} onAdvance={() => act(() => api.operator.advance(p.data.id), "Shipment updated")} />
        ),
    },
  ];

  const payoutCols: ColDef<any>[] = [
    dateCol("updated_at", "Updated"),
    { field: "grower", headerName: "Grower", minWidth: 200 },
    moneyCol("amount_cents", "Amount"),
    { field: "receiver", headerName: "PayPal receiver", minWidth: 220 },
    { field: "status", headerName: "Status", minWidth: 130 },
    { field: "paypal_item_id", headerName: "Payout item ID", minWidth: 170 },
    { field: "paypal_batch_id", headerName: "Batch ID", minWidth: 170 },
  ];

  const batchCols: ColDef<any>[] = [
    dateCol("created_at", "Created"),
    moneyCol("total_cents", "Total"),
    { field: "status", headerName: "Status", minWidth: 130 },
    { field: "paypal_batch_id", headerName: "PayPal batch ID", minWidth: 180 },
    { field: "error", headerName: "Error", minWidth: 160 },
    {
      headerName: "",
      minWidth: 130,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) =>
        p.data.status === "ERROR" ? (
          <button className="btn tiny" onClick={() => act(() => api.operator.retryBatch(p.data.id))}>Retry</button>
        ) : p.data.paypal_batch_id ? (
          <button className="btn tiny" onClick={() => act(() => api.operator.refreshBatch(p.data.id), "Status refreshed from PayPal")}>Refresh</button>
        ) : null,
    },
  ];

  const donationCols: ColDef<any>[] = [
    dateCol("created_at", "Created"),
    { field: "destination", headerName: "To", minWidth: 130 },
    moneyCol("amount_cents", "Amount"),
    { field: "status", headerName: "Payment", minWidth: 120 },
    { field: "plan_status", headerName: "Plan", minWidth: 120 },
    { field: "planner", headerName: "Planner", minWidth: 120 },
    { field: "headline", headerName: "Plan headline", minWidth: 240 },
    {
      field: "id",
      headerName: "",
      minWidth: 200,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) => (
        <span className="row">
          <Link to={`/d/${p.value}`}>View</Link>
          {p.data.status === "captured" && (
            <button
              className="btn tiny ghost"
              onClick={() => confirm("Refund this donation through PayPal? Only possible before growers are paid.") && act(() => api.operator.refund(p.value), "Refunded")}
            >
              Refund
            </button>
          )}
        </span>
      ),
    },
  ];

  const offerRows = (network.data?.offers ?? []).map((o: any) => {
    const g = network.data.growers.find((x: any) => x.id === o.grower_id);
    const paid = network.data.paid.find((x: any) => x.grower_id === o.grower_id);
    return { ...o, grower: g?.name, kind: g?.kind, town: g?.town, county: g?.county, paid_cents: paid?.paid_cents ?? 0 };
  });
  const networkCols: ColDef<any>[] = [
    { field: "grower", headerName: "Grower", minWidth: 220 },
    { field: "kind", headerName: "Type", minWidth: 130 },
    { field: "town", headerName: "Town", minWidth: 130 },
    { field: "county", headerName: "County", minWidth: 140 },
    { field: "crop", headerName: "Crop", minWidth: 150 },
    moneyCol("price_cents_per_kg", "Price / kg"),
    { field: "stock_kg", headerName: "Stock (kg)", type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => Math.round(p.value).toLocaleString() },
    moneyCol("paid_cents", "Paid to date"),
  ];

  return (
    <div className="page wide">
      <div className="op-head">
        <div>
          <h1 className="h-page">Operator console</h1>
          <p className="muted">
            Pay growers in batches with PayPal Payouts and move shipments along. Auto-payout runs when a destination's unpaid orders reach{" "}
            {data ? usd(data.thresholdCents) : "…"}.
          </p>
        </div>
        <div className="card payout-box">
          <div className="muted small">Planned, not yet paid</div>
          <div className="big">{usd(unpaidTotal)}</div>
          <div className="muted small">{data?.unpaid?.length ?? 0} orders</div>
          <button className="btn primary" disabled={busy || unpaidTotal === 0} onClick={() => act(() => api.operator.runPayouts())}>
            Run payout batch now
          </button>
        </div>
      </div>
      {msg && <div className="card notice">{msg}</div>}
      {error && <p className="error">{error}</p>}

      <div className="tabs">
        {(["dispatch", "shipments", "harvests", "payouts", "donations", "network"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "network" ? "Plant network" : t === "harvests" ? "Harvest buy-back" : t === "dispatch" ? "🚚 Dispatch" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "dispatch" && <Dispatch act={act} busy={busy} />}
      {tab === "shipments" && <Grid rows={data?.shipments ?? []} cols={shipmentCols} height={440} />}
      {tab === "harvests" && (
        <>
          <p className="muted small">
            Seed plans promise to buy part of each farmer group's harvest. Record the outcome when the season ends: a harvest that's in becomes stock that the
            next donations to that place buy first, and the group is paid through PayPal Payouts.
          </p>
          {(harvests.data ?? []).length === 0 && <p className="muted">No promises yet. Send seed to a destination to start one.</p>}
          <div className="promises">
            {(harvests.data ?? []).map((c) => (
              <PromiseCard
                key={c.id}
                c={c}
                action={
                  c.status === "growing" ? (
                    <span className="row" style={{ gap: 6 }}>
                      <button className="ship-btn deliver" disabled={busy} onClick={() => act(() => api.operator.harvestReady(c.id).then((r) => (harvests.reload(), r)))}>
                        🌾 Harvest is in
                      </button>
                      <button className="btn tiny ghost" disabled={busy} onClick={() => act(() => api.operator.harvestFailed(c.id).then((r) => (harvests.reload(), r)))}>
                        Failed
                      </button>
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </>
      )}
      {tab === "payouts" && (
        <>
          <h3>Batches</h3>
          <Grid rows={data?.batches ?? []} cols={batchCols} height={220} />
          <h3>Payout items</h3>
          <Grid rows={data?.payouts ?? []} cols={payoutCols} height={360} />
        </>
      )}
      {tab === "donations" && <Grid rows={data?.donations ?? []} cols={donationCols} height={440} />}
      {tab === "network" && <Grid rows={offerRows} cols={networkCols} height={520} />}
    </div>
  );
}
