import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, num, usd, type DonationView, type Flows, type TraceEntry } from "../api";
import CropIcon from "../components/CropIcon";
import { ShipStatusPill } from "../components/ShipmentStatus";
import { PromiseCard } from "./Farmers";
import NetworkMap, { type EdgeStatus, type MapEdge } from "../components/NetworkMap";
import { usePoll } from "../hooks";

const SHIP_STEPS = ["awaiting_payment", "sourced", "shipped", "delivered"] as const;
const SHIP_LABEL: Record<string, string> = { awaiting_payment: "Awaiting payment", sourced: "Sourced", shipped: "Shipped", delivered: "Delivered" };

function stillMoving(v: DonationView | null) {
  if (!v) return true;
  if (v.donation.status === "created") return true;
  if (v.donation.status !== "captured") return false;
  if (!v.plan || v.plan.status === "planning") return true;
  if (v.plan.status !== "ready") return false;
  return v.shipments.some((s) => s.status !== "delivered");
}

export default function DonationPage() {
  const { id = "" } = useParams();
  const { data, error } = usePoll(() => api.donation(id), 1500, [id], stillMoving);
  const [net, setNet] = useState<Flows | null>(null);
  useEffect(() => {
    api.flows().then(setNet).catch(() => setNet(null));
  }, []);

  if (error && !data) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">Loading your donation…</p></div>;

  const { donation: d, destination: dest, plan, lines, shipments, payouts } = data;
  const t = plan?.summary?.totals;
  const baseline = plan?.summary?.baseline;
  const paidCount = lines.filter((l) => l.payout_status).length;
  const delivered = shipments.length > 0 && shipments.every((s) => s.status === "delivered");

  const steps = [
    { label: "Paid with PayPal", done: d.status === "captured" || d.status === "refunded" },
    { label: "Plan ready", done: plan?.status === "ready" },
    { label: "Growers paid", done: lines.length > 0 && paidCount === lines.length },
    { label: "Food delivered", done: delivered },
  ];

  // This donation's routes on the full network, coloured by how far each delivery has got.
  const shipByGrower = new Map(shipments.map((s) => [s.grower_name, s.status]));
  const maxKg = Math.max(1, ...lines.map((l) => l.kg));
  const edges: MapEdge[] = lines.map((l) => {
    const ship = shipByGrower.get(l.grower_name);
    const status: EdgeStatus = ship === "delivered" ? "delivered" : ship === "shipped" ? "shipped" : l.payout_status ? "paid" : "queued";
    return {
      growerId: l.grower_id,
      destinationId: dest.id,
      status,
      weight: l.kg / maxKg,
      path: l.path,
      label: `${l.grower_name}: ${num(l.kg, 1)} kg ${l.crop_name.toLowerCase()} · ${Math.round(l.distance_km)} km`,
    };
  });

  return (
    <div className="page">
      <p className="muted small">
        <Link to="/">← Give again</Link>
      </p>
      <h1 className="h-page">
        {usd(d.amount_cents)} for {dest.name}, {dest.county}
      </h1>
      <p className="quote">“{d.goal}”</p>
      {d.choices.length > 0 && (
        <div className="picked" style={{ marginBottom: 16 }}>
          <span className="muted small">You chose:</span>
          {d.choices.map((c) => {
            const [cropId, form] = c.split(":");
            return (
              <span key={c} className="picked-chip static">
                <CropIcon cropId={cropId} form={form as "food" | "seed"} /> {cropId.replace("_", " ")}{form === "seed" ? " seed" : ""}
              </span>
            );
          })}
        </div>
      )}

      <ol className="stepper">
        {steps.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : steps.slice(0, i).every((x) => x.done) ? "active" : ""}>
            <span className="dot">{s.done ? "✓" : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {d.status === "refunded" && <div className="card notice">This donation was refunded through PayPal ({d.paypal_refund_id}).</div>}

      {(!plan || plan.status === "planning") && d.status === "captured" && (
        <div className="card">
          <h2>Planning your donation…</h2>
          <Trace trace={plan?.trace ?? []} live />
        </div>
      )}

      {plan?.status === "failed" && (
        <div className="card notice">
          The plan could not be completed ({plan.error}). The operator will refund this donation.
        </div>
      )}

      {plan?.status === "ready" && t && (
        <>
          <div className="card plan">
            <div className="plan-head">
              <h2>{plan.headline}</h2>
              <span className={`badge ${plan.planner === "ai" ? "ai" : ""}`}>
                {plan.planner === "ai" ? `Planned by AI · ${plan.model}` : "Rule-based plan"}
              </span>
            </div>
            <p className="explanation">{plan.explanation}</p>

            <div className="stats">
              <Stat value={num(t.mealsNow)} label="meals delivered now" />
              <Stat value={num(t.personDaysNow)} label="days of food for one person" />
              <Stat value={String(t.growersPaid)} label="Kenyan growers paid" />
              {baseline?.multiplier ? (
                <Stat value={`${baseline.multiplier}×`} label="the meals of imported rice" accent />
              ) : null}
              {(t.expectedMealsFromTools ?? 0) > 0 && (
                <Stat value={`~${num(t.expectedMealsFromTools ?? 0)}`} label="meals a season from tools (rough estimate)" />
              )}
              {(t.countries?.length ?? 0) > 1 && <Stat value={String(t.countries!.length)} label={`countries: ${t.countries!.join(", ")}`} />}
              {t.expectedMealsAtHarvest > 0 && (
                <Stat value={`~${num(t.expectedMealsAtHarvest)}`} label={`meals expected at harvest (in ~${t.harvestInDays} days)`} />
              )}
            </div>
            {baseline && (
              <p className="muted small">
                Compared with {baseline.description.toLowerCase()}: the same food money would buy about {num(baseline.mealsForSameMoney)} meals. Meals are{" "}
                700 kcal each. Seed outcomes are risk-adjusted estimates.
              </p>
            )}
            {plan.summary?.notes?.map((n) => (
              <p key={n} className="muted small">Note: {n}</p>
            ))}
          </div>

          <div className="two-col">
            <div>
              <h3>Where it comes from</h3>
              {net && <NetworkMap growers={net.growers.filter((g) => g.kind !== "importer")} destinations={net.destinations} edges={edges} selectedDestinationId={dest.id} height={380} />}
            </div>
            <div>
              <h3>Orders</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Grower</th>
                    <th>What</th>
                    <th className="r">Cost</th>
                    <th>PayPal</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.grower_name}
                        <div className="muted small">
                          {l.town}, {l.country} · {num(Math.round(l.distance_km))} km{l.transport === "sea" ? " by sea + road" : ""}
                        </div>
                      </td>
                      <td>
                        {l.crop_kind === "tool"
                          ? `${num(l.kg)} × ${l.crop_name.toLowerCase()}`
                          : `${num(l.kg, 1)} kg ${l.crop_name.toLowerCase()}${l.mode === "grow_there" ? " seed" : ""}`}
                        <div className="muted small">
                          {l.crop_kind === "tool" ? `~${num(l.meals)} meals a season (estimate)` : l.mode === "grow_there" ? `~${num(l.meals)} meals at harvest` : `${num(l.meals)} meals`}
                        </div>
                      </td>
                      <td className="r">
                        {usd(l.total_cents)}
                        <div className="muted small">incl. {usd(l.transport_cents)} transport</div>
                      </td>
                      <td>
                        <span className={`pill cap ${l.payout_status ? "ok" : ""}`}>{l.payout_status ?? "queued"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.commitments.length > 0 && (
            <>
              <h3>Harvest buy-back promise</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Your seed comes with a promise: when the farmers harvest, Plantago buys part of their crop at a fair price and pays them through PayPal, so this
                donation also becomes their income.
              </p>
              <div className="promises">
                {data.commitments.map((c) => <PromiseCard key={c.id} c={c} />)}
              </div>
            </>
          )}

          <h3>Deliveries</h3>
          <div className="shipments">
            {shipments.map((s) => (
              <div key={s.id} className="card ship">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{s.grower_name}</strong>
                    <ShipStatusPill status={s.status} />
                  </div>
                  <span className="muted small">→ {dest.partner}</span>
                  <div className="muted small">{s.description} · about {s.eta_days} day{s.eta_days > 1 ? "s" : ""} by road</div>
                </div>
                <ol className="timeline">
                  {SHIP_STEPS.map((st) => {
                    const h = s.history.find((x) => x.status === st);
                    return (
                      <li key={st} className={h ? "done" : ""}>
                        <span>{SHIP_LABEL[st]}</span>
                        {h && <time>{new Date(h.at).toLocaleString()}</time>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <p className="muted small">Deliveries are simulated in this demo; payments are real PayPal sandbox transactions.</p>

          <details className="card">
            <summary>How the planner decided</summary>
            <Trace trace={plan.trace} />
          </details>
        </>
      )}

      <div className="card receipt">
        <h3>Impact receipt</h3>
        <dl>
          <dt>Donation</dt>
          <dd>{usd(d.amount_cents)}{d.donor_name ? ` from ${d.donor_name}` : ""}</dd>
          <dt>PayPal order</dt>
          <dd><code>{d.paypal_order_id ?? "—"}</code></dd>
          <dt>PayPal capture</dt>
          <dd><code>{d.paypal_capture_id ?? "—"}</code></dd>
          {payouts.map((p) => (
            <FragmentRow key={p.id} label={`Payout to ${p.grower_name}`} value={`${usd(p.amount_cents)} · ${p.status}`} code={p.paypal_item_id ?? p.paypal_batch_id} />
          ))}
          {t && (
            <>
              <dt>Food</dt>
              <dd>{num(t.kgFood, 1)} kg, {num(t.proteinKg, 1)} kg protein</dd>
              {(t.tools?.length ?? 0) > 0 && (
                <>
                  <dt>Tools</dt>
                  <dd>{t.tools!.map((x) => `${num(x.units)} × ${x.name.toLowerCase()}`).join(", ")}</dd>
                </>
              )}
              {t.kgSeed > 0 && (
                <>
                  <dt>Seed</dt>
                  <dd>{num(t.kgSeed, 1)} kg for about {t.householdsWithSeed} farming household{t.householdsWithSeed === 1 ? "" : "s"}</dd>
                </>
              )}
            </>
          )}
        </dl>
        {!!d.simulated && <p className="muted small">Simulated payment: IDs starting with SIM- are not real PayPal transactions.</p>}
        <p className="muted small">
          See every dollar in and out on the <Link to="/ledger">public ledger</Link>.
        </p>
      </div>
    </div>
  );
}

function FragmentRow({ label, value, code }: { label: string; value: string; code: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value} {code && <code>{code}</code>}
      </dd>
    </>
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

function Trace({ trace, live }: { trace: TraceEntry[]; live?: boolean }) {
  return (
    <ol className="trace">
      {trace.map((e, i) => (
        <li key={i} className={e.kind}>
          <span className="label">{e.label}</span>
          {e.detail && <span className="muted small"> · {e.detail}</span>}
        </li>
      ))}
      {live && <li className="pending">Working…</li>}
    </ol>
  );
}
