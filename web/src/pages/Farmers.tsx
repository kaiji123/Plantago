import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, num, timeToCash, usd, type Commitment } from "../api";
import Grid, { moneyCol } from "../components/Grid";
import { KIND_COLOR, KIND_LABEL } from "../components/NetworkMap";
import { usePoll } from "../hooks";
import { SHIP_META, ShipStatusPill } from "../components/ShipmentStatus";

export default function FarmersPage() {
  const { id } = useParams();
  return id ? <FarmerDetailPage id={id} /> : <FarmerList />;
}

function FarmerList() {
  const { data } = usePoll(() => api.farmers(), 5000, []);
  const [q, setQ] = useState("");
  const [onlyPaid, setOnlyPaid] = useState(true);
  const s = data?.stats;
  const rows = (data?.farmers ?? []).filter((f) => !onlyPaid || f.paid_cents > 0);

  const cols: ColDef<any>[] = [
    {
      field: "name",
      headerName: "Supplier",
      minWidth: 260,
      pinned: "left",
      cellRenderer: (p: ICellRendererParams) => (
        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <i className="kind-dot" style={{ background: KIND_COLOR[p.data.kind] }} />
          <Link to={`/farmers/${p.data.id}`}>{p.value}</Link>
        </span>
      ),
    },
    { field: "kind", headerName: "Type", minWidth: 150, valueFormatter: (p) => KIND_LABEL[p.value]?.replace(" (grew Plantago seed)", "") ?? p.value },
    { field: "town", headerName: "Town", minWidth: 120 },
    { field: "country", headerName: "Country", minWidth: 120 },
    { ...moneyCol("paid_cents", "Paid via PayPal"), minWidth: 150, sort: "desc" },
    { field: "payouts", headerName: "Payouts", minWidth: 110, type: "rightAligned" },
    { field: "median_hours_to_cash", headerName: "Donation → cash", minWidth: 160, valueFormatter: (p) => timeToCash(p.value) },
    { field: "cash_out", headerName: "Cash-out route", minWidth: 240 },
  ];

  return (
    <div className="page wide">
      <h1 className="h-page">Farmers</h1>
      <p className="muted">
        Plantago doesn't just move food: it puts cash in the hands of the people who grow it. Every supplier is paid through PayPal Payouts as soon as their order
        is approved, and families who plant Plantago seed get a promise that part of their harvest will be bought back at a fair price.
      </p>
      {s && (
        <div className="stats">
          <Stat value={usd(s.toFarmersCents)} label="paid to farmers and farmer groups" accent />
          <Stat value={usd(s.toFarmerGroupsCents)} label="paid to farmer groups for harvest grown from Plantago seed" />
          <Stat value={usd(s.toSuppliersCents)} label="paid to seed suppliers and tool makers" />
          <Stat value={timeToCash(s.medianHoursToCash)} label="median time from donation to a supplier's cash" />
        </div>
      )}
      <div className="row filters">
        <input className="search" placeholder="Search suppliers" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small" style={{ gap: 6, fontWeight: 600 }}>
          <input type="checkbox" checked={onlyPaid} onChange={(e) => setOnlyPaid(e.target.checked)} style={{ width: "auto" }} /> Only suppliers who've been paid
        </label>
      </div>
      <Grid rows={rows} cols={cols} height={480} quickFilter={q} />
      <p className="muted small">Click a supplier to see every order, payout and PayPal transaction ID. In simulation mode payouts land within seconds.</p>
    </div>
  );
}

function FarmerDetailPage({ id }: { id: string }) {
  const { data, error } = usePoll(() => api.farmer(id), 5000, [id]);
  if (error && !data) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { grower: g, totals: t, cashOut, sales, commitments, offers, purchases } = data;
  const canShop = ["farm", "coop", "farmer_group"].includes(g.kind);

  return (
    <div className="page">
      <p className="muted small"><Link to="/farmers">← All farmers</Link></p>
      <div className="row" style={{ gap: 10 }}>
        <i className="kind-dot big" style={{ background: KIND_COLOR[g.kind] }} />
        <h1 className="h-page" style={{ margin: 0 }}>{g.name}</h1>
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0 }}>
          {KIND_LABEL[g.kind] ?? g.kind} · {g.town}, {g.country} · ships by {g.transport === "sea" ? "sea via Mombasa" : "road"}
        </p>
        {canShop && <Link className="btn primary" to={`/farmers/${g.id}/shop`}>🛒 Shop tools & seed</Link>}
      </div>

      <div className="stats">
        <Stat value={usd(t.paidCents)} label="paid through PayPal" accent />
        <Stat value={usd(t.waitingCents)} label="ordered, payout queued" />
        <Stat value={String(t.orders)} label="orders from Plantago" />
        <Stat value={timeToCash(t.medianHoursToCash)} label="median donation → cash" />
      </div>

      <div className="card cashout">
        <div className="muted small">How the money reaches their hands</div>
        <div className="cashout-route">{cashOut.route}</div>
        <p className="muted small" style={{ margin: 0 }}>{cashOut.note}</p>
      </div>

      {purchases.length > 0 && (
        <>
          <h3>Bought with their earnings</h3>
          <div className="shipments">
            {purchases.map((o) => (
              <div key={o.id} className="card ship">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{o.crop_kind === "tool" ? `${num(o.qty)} × ${o.crop_name.toLowerCase()}` : `${num(o.qty, 1)} kg ${o.crop_name.toLowerCase()} seed`}</strong>
                    {o.status === "paid" ? <ShipStatusPill status={o.delivery_status} /> : <span className="pill cap">{o.status}</span>}
                  </div>
                  <div className="muted small">
                    {usd(o.total_cents)} ({usd(o.goods_cents)} + {usd(o.delivery_cents)} delivery) from {o.supplier_name}, {o.supplier_country}
                  </div>
                  <div className="muted small">
                    Paid with PayPal <code>{o.paypal_capture_id}</code>
                    {o.paypal_refund_id && <> · refunded <code>{o.paypal_refund_id}</code></>}
                  </div>
                </div>
                {o.status === "paid" && (
                  <ol className="timeline">
                    {(["awaiting_payment", "sourced", "shipped", "delivered"] as const).map((st) => {
                      const h = o.delivery_history.find((x) => x.status === st);
                      return (
                        <li key={st} className={h ? "done" : ""}>
                          <span>{SHIP_META[st].label}</span>
                          {h && <time>{new Date(h.at).toLocaleString()}</time>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {commitments.length > 0 && (
        <>
          <h3>Harvest buy-back promises</h3>
          <div className="promises">
            {commitments.map((c) => <PromiseCard key={c.id} c={c} />)}
          </div>
        </>
      )}

      <h3>Orders and payouts</h3>
      {sales.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>For</th>
              <th className="r">Amount</th>
              <th>PayPal payout</th>
              <th>Donation → cash</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.crop_kind === "tool" ? `${num(s.kg)} × ${s.crop.toLowerCase()}` : `${num(s.kg, 1)} kg ${s.crop.toLowerCase()}${s.mode === "grow_there" ? " seed" : ""}`}
                </td>
                <td>
                  <Link to={`/d/${s.donation_id}`}>{s.destination}</Link>
                  <div className="muted small">{new Date(s.captured_at).toLocaleDateString()}</div>
                </td>
                <td className="r">{usd(s.total_cents)}</td>
                <td>
                  <span className={`pill cap ${s.paid_at ? "ok" : ""}`}>{s.payout_status ?? "queued"}</span>
                  {(s.paypal_item_id ?? s.paypal_batch_id) && <div><code>{s.paypal_item_id ?? s.paypal_batch_id}</code></div>}
                </td>
                <td>{s.paid_at ? timeToCash(s.hours_to_cash) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {offers.length > 0 && (
        <>
          <h3>Currently offering</h3>
          <p className="muted small">
            {offers
              .map((o) => `${o.crop}: ${o.unit === "kg" ? `${num(o.stock_kg)} kg at ${usd(o.price_cents_per_kg)}/kg` : `${num(o.stock_kg)} at ${usd(o.price_cents_per_kg)} each`}`)
              .join(" · ")}
          </p>
        </>
      )}
    </div>
  );
}

export function PromiseCard({ c, action }: { c: Commitment; action?: React.ReactNode }) {
  const pct = c.committed_kg ? Math.min(100, (c.bought_kg / c.committed_kg) * 100) : 0;
  const label: Record<Commitment["status"], string> = {
    growing: `Growing · harvest due ${new Date(c.due_at).toLocaleDateString()}`,
    ready: "Harvest in · waiting for the next donation to buy it",
    bought: "Bought back and paid",
    failed: "Harvest failed",
    cancelled: "Cancelled (seed plan refunded)",
  };
  return (
    <div className={`card promise ${c.status}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{c.crop_name} from {c.grower_name}</strong>
        <span className={`promise-status ${c.status}`}>{label[c.status]}</span>
      </div>
      <p className="small" style={{ margin: "6px 0" }}>
        {num(c.seed_kg, 1)} kg of seed planted → about {num(c.expected_kg)} kg expected. Plantago promised to buy <b>{num(c.committed_kg)} kg</b> at{" "}
        <b>{usd(c.price_cents_per_kg)}/kg</b> (worth {usd(Math.round(c.committed_kg * c.price_cents_per_kg))}); the families keep the rest to eat.
      </p>
      <div className="bar" aria-label={`${Math.round(pct)}% bought`}><span style={{ width: `${pct}%` }} /></div>
      <div className="row muted small" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span>{num(c.bought_kg, 1)} of {num(c.committed_kg)} kg bought back</span>
        {action}
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}
