import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, num, timeToCash, usd } from "../api";
import Grid, { dateCol, moneyCol } from "../components/Grid";
import { usePoll } from "../hooks";

export default function LedgerPage() {
  const { data, error } = usePoll(() => api.ledger(), 5000, []);
  const [q, setQ] = useState("");
  const t = data?.totals;

  const cols: ColDef<any>[] = [
    dateCol("at", "When"),
    {
      field: "direction",
      headerName: "",
      minWidth: 100,
      cellRenderer: (p: ICellRendererParams) => <span className={`pill ${p.value === "in" ? "ok" : "out"}`}>{p.value === "in" ? "In" : "Out"}</span>,
    },
    { field: "party", headerName: "From / to", minWidth: 240 },
    moneyCol("amountCents", "Amount"),
    { field: "status", headerName: "Status", minWidth: 130 },
    {
      field: "paypalId",
      headerName: "PayPal transaction",
      minWidth: 200,
      cellRenderer: (p: ICellRendererParams) => (p.value ? <code>{p.value}</code> : "—"),
    },
    { field: "simulated", headerName: "Mode", minWidth: 120, valueFormatter: (p) => (p.value ? "simulated" : "sandbox") },
  ];

  return (
    <div className="page wide">
      <h1 className="h-page">Public ledger</h1>
      <p className="muted">Every dollar in from donors and every dollar out to growers, with its PayPal transaction ID.</p>
      {error && <p className="error">{error}</p>}
      {t && (
        <>
          <div className="stats ledger-stats">
            <Stat label="received from donors" value={usd(t.receivedCents)} />
            <Stat label="paid to Kenyan growers" value={usd(t.paidToGrowersCents)} />
            <Stat label="refunded" value={usd(t.refundedCents)} />
            <Stat label="held, planned for growers" value={usd(t.heldCents)} />
            <Stat label="meals planned" value={num(t.mealsPlanned)} />
            {(t.farmerPurchasesCents ?? 0) > 0 && <Stat label="farmers' own purchases (shop)" value={usd(t.farmerPurchasesCents ?? 0)} />}
          </div>
          {data?.farmers && (
            <div className="stats ledger-stats">
              <Stat
                label="of donations already paid to farmers and farmer groups"
                value={t.receivedCents - t.refundedCents > 0 ? `${Math.round((data.farmers.toFarmersCents / (t.receivedCents - t.refundedCents)) * 100)}%` : "—"}
              />
              <Stat label="paid to farmer groups for harvest grown from Plantago seed" value={usd(data.farmers.toFarmerGroupsCents)} />
              <Stat label="median time from donation to a supplier's cash" value={timeToCash(data.farmers.medianHoursToCash)} />
            </div>
          )}
          <p className="muted small">See who was paid on the <Link to="/farmers">Farmers</Link> page.</p>
          <p className="equation">
            {usd(t.receivedCents)} donated{(t.farmerPurchasesCents ?? 0) > 0 && <> + {usd(t.farmerPurchasesCents ?? 0)} farmer purchases</>} −{" "}
            {usd(t.refundedCents + (t.farmerPurchaseRefundsCents ?? 0))} refunded − {usd(t.paidToGrowersCents)} paid to suppliers = <strong>{usd(t.heldCents)} held</strong>
            {t.committedCents > 0 && <> (of which {usd(t.committedCents)} is already assigned to growers in approved plans)</>}
          </p>
        </>
      )}
      <input className="search" placeholder="Search by grower, place or transaction ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <Grid rows={data?.entries ?? []} cols={cols} height={520} quickFilter={q} />
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
