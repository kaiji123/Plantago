import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, num, type CatalogItem, type Destination, type Flows } from "../api";
import CatalogCard from "../components/CatalogCard";
import DestinationPicker from "../components/DestinationPicker";
import CropIcon from "../components/CropIcon";
import NetworkMap, { type MapEdge } from "../components/NetworkMap";
import { useConfig } from "../hooks";

const AMOUNTS = ["25", "50", "100"];
type Filter = "all" | "food" | "seed" | "tool";

export default function DonatePage() {
  const cfg = useConfig();
  const navigate = useNavigate();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [flows, setFlows] = useState<Flows | null>(null);
  const [destId, setDestId] = useState<string>("lodwar");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [amount, setAmount] = useState("50");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const donationRef = useRef<string | null>(null);

  useEffect(() => {
    api.destinations().then(setDestinations).catch((e) => setError(e.message));
    api.flows().then(setFlows).catch(() => setFlows(null));
  }, []);

  useEffect(() => {
    api
      .catalog(destId)
      .then((items) => {
        setCatalog(items);
        // Drop picks that aren't available at the new destination.
        setPicked((p) => p.filter((id) => items.find((i) => i.id === id)?.available));
      })
      .catch((e) => setError(e.message));
  }, [destId]);

  const dest = destinations.find((d) => d.id === destId);
  const goalText = goal.trim() || (dest ? `Help families in ${dest.name} eat this month.` : "");
  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) >= 5 && Number(amount) <= 10000;
  const pickedItems = catalog.filter((i) => picked.includes(i.id));
  const shown = catalog.filter((i) => filter === "all" || i.form === filter);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  // Map: real flows into this destination, plus dashed routes from growers who could supply the picks.
  const edges: MapEdge[] = useMemo(() => {
    const out: MapEdge[] = [];
    const maxKg = Math.max(1, ...(flows?.edges ?? []).map((e) => e.kg));
    for (const e of flows?.edges ?? []) {
      if (e.destination_id !== destId) continue;
      out.push({ growerId: e.grower_id, destinationId: e.destination_id, status: e.status, weight: e.kg / maxKg, path: e.path, label: `${num(e.kg)} kg ${e.crops.toLowerCase()} · ${e.status}` });
    }
    const source = pickedItems.length ? pickedItems : catalog.filter((i) => i.available);
    const already = new Set(out.map((e) => e.growerId));
    const cand = new Set(source.flatMap((i) => i.suppliers));
    for (const g of cand) if (!already.has(g)) out.push({ growerId: g, destinationId: destId, status: "candidate" });
    return out;
  }, [flows, destId, catalog, pickedItems]);

  async function startDonation() {
    setError(null);
    const r = await api.createDonation({ destinationId: destId, amount, goal: goalText, choices: picked });
    donationRef.current = r.donationId;
    return r;
  }

  async function finish(orderId: string) {
    const id = donationRef.current;
    if (!id) throw new Error("Donation was not started");
    await api.capture(id, orderId);
    navigate(`/d/${id}`);
  }

  async function simulate() {
    setBusy(true);
    try {
      const r = await startDonation();
      await finish(r.orderId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const paypalOptions = useMemo(
    () => (cfg?.paypalClientId ? { clientId: cfg.paypalClientId, currency: "USD", intent: "capture" as const } : null),
    [cfg?.paypalClientId],
  );

  return (
    <div className="page">
      <section className="hero">
        <h1>Turn a donation into food grown close to home.</h1>
        <p className="lede">
          Pick a place in northern Kenya, choose what to send (or let the planner choose) and pay with PayPal. Plantago buys from the nearest Kenyan growers
          who can feed the most people for your money and pays them through PayPal. Every dollar is on the public ledger.
        </p>
      </section>

      <div className="donate-grid">
        <div className="donate-main">
          <section>
            <h2 className="step"><span>1</span> Where should the help go?</h2>
            {flows && (
              <NetworkMap
                growers={flows.growers.filter((g) => g.kind !== "importer")}
                destinations={flows.destinations}
                edges={edges}
                selectedDestinationId={destId}
                onSelectDestination={setDestId}
                height={420}
              />
            )}
            <p className="muted small">
              Click a destination. Dashed grey lines are growers who could supply {pickedItems.length ? "your picks" : "this place"}; solid lines are food already on its way
              (<Link to="/network">see the whole network</Link>). Need levels are illustrative, based on public IPC reporting.
            </p>
          </section>

          <section>
            <div className="catalog-head">
              <h2 className="step"><span>2</span> What should we send?</h2>
              <div className="tabs small-tabs">
                {(["all", "food", "seed", "tool"] as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "food" ? "Food now" : f === "seed" ? "Seed to plant" : "Tools"}
                  </button>
                ))}
              </div>
            </div>
            <button className={`catalog-auto ${picked.length === 0 ? "on" : ""}`} onClick={() => setPicked([])}>
              <strong>Let the planner choose</strong> <span className="muted">(recommended)</span>
              <div className="muted small">The AI weighs meals per dollar, protein, distance and the season, and explains its choice.</div>
            </button>
            <div className="catalog">
              {shown.map((i) => (
                <CatalogCard key={i.id} item={i} picked={picked.includes(i.id)} onToggle={() => toggle(i.id)} />
              ))}
            </div>
            <p className="muted small">
              Prices include transport to {dest?.name ?? "the destination"}: trucking, border fees, and sea freight via Mombasa for suppliers abroad. A meal is 700 kcal.
              Seed figures are risk-adjusted for the local climate and arrive at harvest; tool impact is a rough estimate.
            </p>
          </section>
        </div>

        <aside className="card donate-card">
          <h2 className="step"><span>3</span> Give</h2>
          <div className="field">
            <span>Destination</span>
            <DestinationPicker destinations={destinations} value={destId} onChange={setDestId} />
          </div>
          {dest && (
            <p className="muted small">
              {num(dest.people_in_need)} people in need · {dest.climate.replace("_", "-")} · delivered to {dest.partner}
            </p>
          )}

          <div className="field">
            <span>You're sending</span>
            {pickedItems.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>The planner's choice of food and seed.</p>
            ) : (
              <div className="picked">
                {pickedItems.map((i) => (
                  <button key={i.id} className="picked-chip" onClick={() => toggle(i.id)} title="Remove">
                    <CropIcon cropId={i.cropId} form={i.form} /> {i.name} ×
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <span>Amount (USD)</span>
            <div className="chips">
              {AMOUNTS.map((a) => (
                <button key={a} type="button" className={`chip ${amount === a ? "on" : ""}`} onClick={() => setAmount(a)}>
                  ${a}
                </button>
              ))}
              <input className="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Custom amount" />
            </div>
            {!amountOk && <span className="error small">Enter between $5 and $10,000.</span>}
          </div>

          <label className="field">
            <span>A note for the planner (optional)</span>
            <textarea
              rows={3}
              maxLength={500}
              value={goal}
              placeholder={dest ? `e.g. "Help families in ${dest.name} eat this month, and if possible help them grow their own next season."` : ""}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>

          {error && <p className="error">{error}</p>}

          {!cfg ? (
            <p className="muted">Loading…</p>
          ) : cfg.simulated ? (
            <button className="btn primary wide" disabled={!amountOk || busy} onClick={simulate}>
              {busy ? "Processing…" : `Simulate PayPal payment of $${amount}`}
            </button>
          ) : (
            paypalOptions && (
              <PayPalScriptProvider options={paypalOptions}>
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", label: "donate" }}
                  disabled={!amountOk}
                  forceReRender={[destId, amount, goalText, picked.join(",")]}
                  createOrder={async () => (await startDonation()).orderId}
                  onApprove={async (data) => {
                    try {
                      await finish(data.orderID);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  onError={(e) => setError(String((e as any)?.message ?? "PayPal could not start the payment."))}
                />
              </PayPalScriptProvider>
            )
          )}
          <p className="muted small">
            Sandbox only: use a PayPal sandbox buyer account. If a plan can't be fulfilled before growers are paid, the donation is refunded.
          </p>
        </aside>
      </div>

      <section className="how">
        <div>
          <h3>1. You give</h3>
          <p>PayPal checkout takes your donation, tagged with the place and the crops you chose.</p>
        </div>
        <div>
          <h3>2. AI plans</h3>
          <p>The planner compares ready food with drought-tolerant seed, and local growers with imported rice, then explains its choice.</p>
        </div>
        <div>
          <h3>3. Growers get paid</h3>
          <p>PayPal Payouts sends money straight to the Kenyan growers in the plan.</p>
        </div>
        <div>
          <h3>4. You see it land</h3>
          <p>Track each shipment on the network map and get an impact receipt with PayPal transaction IDs.</p>
        </div>
      </section>
    </div>
  );
}
