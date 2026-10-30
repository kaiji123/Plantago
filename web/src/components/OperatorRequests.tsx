import { useState } from "react";
import { Link } from "react-router-dom";
import { api, usd, type FarmerRequest } from "../api";
import { usePoll } from "../hooks";

const STATUSES: FarmerRequest["status"][] = ["open", "sourcing", "fulfilled", "declined"];
const LABEL = { open: "Received", sourcing: "Finding a supplier", fulfilled: "Fulfilled", declined: "Not possible" } as const;

/** Farmer requests for things the shop doesn't list: set a status and reply. */
export default function OperatorRequests({ act, busy }: { act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; busy: boolean }) {
  const { data, reload } = usePoll(() => api.operator.requests(), 8000, []);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const rows = (data ?? []).filter((r) => filter === "all" || r.status === "open" || r.status === "sourcing");
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="muted small" style={{ margin: 0 }}>
          Needs farmers can't meet from the shop. The AI's shop suggestions are shown with each request. Replies appear on the farmer's page.
        </p>
        <div className="tabs small-tabs">
          <button className={filter === "active" ? "on" : ""} onClick={() => setFilter("active")}>Open</button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
        </div>
      </div>
      {rows.length === 0 && <p className="muted">No requests {filter === "active" ? "waiting" : "yet"}.</p>}
      <div className="requests-list">
        {rows.map((r) => (
          <RequestRow key={r.id} r={r} busy={busy} save={(status, reply) => act(() => api.operator.updateRequest(r.id, status, reply).then((x) => (reload(), x)))} />
        ))}
      </div>
    </>
  );
}

function RequestRow({ r, busy, save }: { r: FarmerRequest; busy: boolean; save: (s: FarmerRequest["status"], reply: string) => void }) {
  const [status, setStatus] = useState(r.status);
  const [reply, setReply] = useState(r.reply ?? "");
  return (
    <div className={`card request-item ${r.status}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{r.need}</strong>
          <div className="muted small">
            <Link to={`/farmers/${r.farmer_id}`}>{r.farmer_name}</Link>, {r.town} ·{" "}
            {[r.quantity, r.budget_cents != null ? `budget ${usd(r.budget_cents)}` : null, r.needed_by ? `needed by ${r.needed_by}` : null]
              .filter(Boolean)
              .join(" · ")}
            {r.contact_phone && <> · 📞 {r.contact_phone}</>}
          </div>
          {r.purpose && <div className="small">For: {r.purpose}</div>}
          <div className="muted small">
            {r.suggestions.length ? `AI suggested: ${r.suggestions.map((s) => s.name).join(", ")}` : r.suggestion_note ?? "No shop match."}
          </div>
        </div>
        <span className={`req-status ${r.status}`}>{LABEL[r.status]}</span>
      </div>
      <div className="request-reply">
        <select value={status} onChange={(e) => setStatus(e.target.value as FarmerRequest["status"])} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABEL[s]}
            </option>
          ))}
        </select>
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the farmer" maxLength={600} />
        <button className="btn tiny primary" disabled={busy} onClick={() => save(status, reply)}>
          Save
        </button>
      </div>
    </div>
  );
}
