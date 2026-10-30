import { useState } from "react";
import { api, usd, type RequestSuggestion } from "../api";
import CropIcon from "./CropIcon";

/** "Can't find what you need?": a farmer describes a need; the AI suggests shop items, the rest goes to the operator. */
export default function RequestForm({ farmerId, onPick }: { farmerId: string; onPick: (cropId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [need, setNeed] = useState("");
  const [quantity, setQuantity] = useState("");
  const [budget, setBudget] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [purpose, setPurpose] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ suggestions: RequestSuggestion[]; note: string | null; matchedBy: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRequest(farmerId, { need, quantity, budget, neededBy, purpose, contactPhone: phone });
      setResult(r);
      setNeed("");
      setQuantity("");
      setBudget("");
      setNeededBy("");
      setPurpose("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className="card request-cta" onClick={() => setOpen(true)}>
        <span className="request-icon" aria-hidden>📝</span>
        <span>
          <strong>Can't find what you need?</strong>
          <span className="muted small" style={{ display: "block" }}>
            Tell us what you need (a pump, fertiliser, vet supplies, a bigger order) and we'll find a supplier or suggest something from the shop.
          </span>
        </span>
      </button>
    );

  return (
    <div className="card request-form">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>📝 Request something</h3>
        <button type="button" className="btn tiny ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {result && (
        <div className="request-result">
          <strong>Request sent. The Plantago team will reply on your farmer page.</strong>
          {result.suggestions.length > 0 && (
            <>
              <p className="small" style={{ margin: "6px 0" }}>
                {result.matchedBy === "ai" ? "Our assistant thinks these shop items may help right away:" : "These shop items may help right away:"}
              </p>
              <div className="suggestions">
                {result.suggestions.map((s) => (
                  <div key={s.cropId} className="suggestion">
                    <CropIcon cropId={s.cropId} form={/seed$/i.test(s.name) ? "seed" : "tool"} />
                    <div>
                      <strong>{s.name}</strong>
                      <div className="muted small">
                        {s.why} From {usd(s.fromCents)} per {s.unit}, delivered.
                      </div>
                    </div>
                    <button type="button" className="btn tiny primary" onClick={() => onPick(s.cropId)}>
                      Buy this
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {result.note && <p className="muted small" style={{ margin: "6px 0 0" }}>{result.note}</p>}
        </div>
      )}

      <form onSubmit={submit} className="request-fields">
        <label className="field">
          <span>What do you need? *</span>
          <textarea
            rows={3}
            maxLength={600}
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            placeholder="e.g. Weevils keep eating our stored sorghum. Or: a small water pump for our river plot."
            required
          />
        </label>
        <div className="two-fields">
          <label className="field">
            <span>How much / how many</span>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 20 sacks, 1 pump" maxLength={60} />
          </label>
          <label className="field">
            <span>Budget (USD)</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="optional" />
          </label>
        </div>
        <div className="two-fields">
          <label className="field">
            <span>Needed by</span>
            <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+254 712 345 678" />
          </label>
        </div>
        <label className="field">
          <span>What is it for?</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. to keep our harvest until the dry season" maxLength={400} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button className="btn primary" disabled={busy || need.trim().length < 5}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
    </div>
  );
}
