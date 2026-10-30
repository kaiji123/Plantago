import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, num, usd, type DeliveryDetails, type FarmerDetail, type ShopItem } from "../api";
import RequestForm from "../components/RequestForm";
import CropIcon from "../components/CropIcon";
import FarmerSwitcher from "../components/FarmerSwitcher";
import { useConfig } from "../hooks";

/** A farmer spends their own money (often their Plantago earnings) on tools and seed. Plantago delivers. */
export default function ShopPage() {
  const { id = "" } = useParams();
  const cfg = useConfig();
  const [farmer, setFarmer] = useState<FarmerDetail | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [cropId, setCropId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<DeliveryDetails>(() => loadDelivery(id));
  useEffect(() => setDetails(loadDelivery(id)), [id]);
  const setField = (k: keyof DeliveryDetails, v: string) =>
    setDetails((d) => {
      const next = { ...d, [k]: v };
      saveDelivery(id, next);
      return next;
    });
  const orderRef = useRef<string | null>(null);

  const load = () => {
    api.farmer(id).then(setFarmer).catch((e) => setError(e.message));
    api.shop(id).then(setItems).catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
    setCropId(null);
    setDone(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const item = items.find((i) => i.cropId === cropId) ?? null;
  const opt = item?.options.find((o) => o.supplierId === supplierId) ?? item?.options[0] ?? null;
  const goods = opt ? Math.round(qty * opt.unitCents) : 0;
  const delivery = opt ? Math.round(qty * opt.deliveryCentsPerUnit) : 0;
  const qtyOk = !!item && !!opt && qty > 0 && qty <= opt.stock && (!item.wholeUnits || Number.isInteger(qty)) && goods + delivery >= 100;
  const detailsOk =
    details.contactName.trim().length >= 2 && /^\+?[0-9][0-9 -]{6,18}$/.test(details.contactPhone.trim()) && details.deliveryPoint.trim().length >= 3;
  const canPay = qtyOk && detailsOk;

  function pick(i: ShopItem) {
    setCropId(i.cropId);
    setSupplierId(i.options[0]?.supplierId ?? null);
    setQty(i.wholeUnits ? 1 : 5);
    setDone(null);
    setError(null);
  }

  async function start() {
    setError(null);
    const r = await api.createFarmerOrder(id, { supplierId: opt!.supplierId, cropId: item!.cropId, qty, delivery: details });
    orderRef.current = r.orderId;
    return r.paypalOrderId;
  }
  async function finish(paypalOrderId: string) {
    const r = await api.captureFarmerOrder(orderRef.current!, paypalOrderId);
    setDone(r.message ?? `Paid. ${opt!.supplierName} will be paid through PayPal and Plantago will deliver to ${farmer?.grower.town}.`);
    setCropId(null);
    load();
  }
  async function simulate() {
    setBusy(true);
    try {
      await finish(await start());
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

  if (!farmer) return <div className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  const g = farmer.grower;

  return (
    <div className="page">
      <FarmerSwitcher current={g.id} to="shop" />
      <p className="muted small"><Link to={`/farmers/${g.id}`}>← {g.name}</Link></p>
      <h1 className="h-page">Shop for {g.name}</h1>
      <p className="muted">
        Buy tools and seed from suppliers across the network and pay with PayPal, including money you've earned selling to Plantago. Plantago pays the supplier and
        handles delivery to {g.town}. Prices are the supplier's price plus delivery at cost: <b>no Plantago fee</b>.
      </p>
      {farmer.totals.paidCents > 0 && (
        <p className="earned">
          You've earned <b>{usd(farmer.totals.paidCents)}</b> from Plantago so far, paid to your PayPal account.
        </p>
      )}
      {done && <div className="card notice">{done}</div>}

      <div className="shop-grid">
        <div className="shop-left">
        <div className="shop-items">
          {items.map((i) => {
            const best = i.options[0];
            return (
              <button key={i.cropId} className={`shop-item ${cropId === i.cropId ? "on" : ""}`} onClick={() => pick(i)}>
                <CropIcon cropId={i.cropId} form={i.form} big />
                <div className="shop-item-body">
                  <div className="crop-name">{i.name}</div>
                  <div className="muted small">
                    from <b>{usd(Math.round(best.deliveredCentsPerUnit))}</b> per {i.unit}, delivered · {i.options.length} supplier{i.options.length > 1 ? "s" : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
          <RequestForm
            farmerId={g.id}
            onPick={(cropId) => {
              const i = items.find((x) => x.cropId === cropId);
              if (i) pick(i);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>

        <aside className="card shop-order">
          {!item || !opt ? (
            <p className="muted" style={{ margin: 0 }}>Pick something on the left to see the delivered price and order it.</p>
          ) : (
            <>
              <h2 className="step" style={{ marginBottom: 4 }}>{item.name}</h2>
              <label className="field">
                <span>Supplier</span>
                <select value={opt.supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  {item.options.map((o) => (
                    <option key={o.supplierId} value={o.supplierId}>
                      {o.supplierName} ({o.country}) · {usd(Math.round(o.deliveredCentsPerUnit))}/{item.unit} · ~{o.days}d
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted small" style={{ margin: 0 }}>
                {o2s(opt.town, opt.country)} · {num(opt.distanceKm)} km {opt.transport === "sea" ? "by sea and road" : "by road"} · about {opt.days} days · {num(opt.stock)} {item.unit} in stock
              </p>
              <div className="field">
                <span>Quantity ({item.unit}{item.wholeUnits ? "s" : ""})</span>
                <div className="qty">
                  <button type="button" onClick={() => setQty((q) => Math.max(item.wholeUnits ? 1 : 0.5, +(q - (item.wholeUnits ? 1 : 1)).toFixed(1)))}>−</button>
                  <input
                    inputMode="decimal"
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
                    aria-label="Quantity"
                  />
                  <button type="button" onClick={() => setQty((q) => +(q + 1).toFixed(1))}>+</button>
                </div>
              </div>
              <table className="facts">
                <tbody>
                  <tr><th>{item.wholeUnits ? `${qty} × ${usd(opt.unitCents)}` : `${qty} kg × ${usd(opt.unitCents)}`}</th><td className="r">{usd(goods)}</td></tr>
                  <tr><th>Delivery to {g.town}</th><td className="r">{usd(delivery)}</td></tr>
                  <tr><th>Plantago fee</th><td className="r">{usd(0)}</td></tr>
                  <tr className="total"><th>Total</th><td className="r">{usd(goods + delivery)}</td></tr>
                </tbody>
              </table>
              {!qtyOk && <p className="error small">Check the quantity{opt && qty > opt.stock ? `: only ${opt.stock} in stock` : ""}.</p>}

              <fieldset className="delivery-form">
                <legend>Delivery details</legend>
                <div className="two-fields">
                  <label className="field">
                    <span>Contact name *</span>
                    <input value={details.contactName} onChange={(e) => setField("contactName", e.target.value)} autoComplete="name" />
                  </label>
                  <label className="field">
                    <span>Phone (for the driver) *</span>
                    <input
                      value={details.contactPhone}
                      onChange={(e) => setField("contactPhone", e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+254 712 345 678"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Where should we deliver? *</span>
                  <input
                    value={details.deliveryPoint}
                    onChange={(e) => setField("deliveryPoint", e.target.value)}
                    placeholder={`Village, market or landmark near ${g.town}`}
                  />
                </label>
                <div className="two-fields">
                  <label className="field">
                    <span>Preferred date</span>
                    <input type="date" value={details.preferredDate ?? ""} onChange={(e) => setField("preferredDate", e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Note for the supplier</span>
                    <input value={details.note ?? ""} onChange={(e) => setField("note", e.target.value)} placeholder="e.g. call on arrival" />
                  </label>
                </div>
                <p className="muted small" style={{ margin: 0 }}>Only the Plantago operator and driver see your phone number and delivery point.</p>
              </fieldset>
              {qtyOk && !detailsOk && <p className="muted small">Fill in the delivery details to pay.</p>}
              {error && <p className="error small">{error}</p>}
              {cfg?.simulated ? (
                <button className="btn primary wide" disabled={!canPay || busy} onClick={simulate}>
                  {busy ? "Processing…" : `Simulate PayPal payment of ${usd(goods + delivery)}`}
                </button>
              ) : (
                paypalOptions && (
                  <PayPalScriptProvider options={paypalOptions}>
                    <PayPalButtons
                      style={{ layout: "vertical", shape: "rect", label: "pay" }}
                      disabled={!canPay}
                      forceReRender={[item.cropId, opt.supplierId, qty, JSON.stringify(details)]}
                      createOrder={start}
                      onApprove={async (data) => {
                        try {
                          await finish(data.orderID);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                      onError={() => setError("PayPal could not start the payment.")}
                    />
                  </PayPalScriptProvider>
                )
              )}
              <p className="muted small" style={{ margin: 0 }}>
                Refundable until the supplier is paid.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const o2s = (town: string, country: string) => `${town}, ${country}`;

// Delivery details are remembered per farmer on this device, so repeat orders are quick.
const EMPTY: DeliveryDetails = { contactName: "", contactPhone: "", deliveryPoint: "", preferredDate: "", note: "" };
function loadDelivery(farmerId: string): DeliveryDetails {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(`plantago.delivery.${farmerId}`) ?? "{}") };
  } catch {
    return { ...EMPTY };
  }
}
function saveDelivery(farmerId: string, d: DeliveryDetails) {
  try {
    localStorage.setItem(`plantago.delivery.${farmerId}`, JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}
