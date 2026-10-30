import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, usd, type FarmerRow } from "../api";
import { KIND_COLOR } from "./NetworkMap";

const BUYER_KINDS = ["farm", "coop", "farmer_group"];
const KEY = "plantago.viewingAs";

export function rememberFarmer(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
}
export function lastFarmer(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Demo stand-in for farmer sign-in: pick which farmer you're acting as.
 * A real version would sign farmers in with PayPal.
 */
export default function FarmerSwitcher({ current, to = "shop" }: { current?: string; to?: "shop" | "profile" }) {
  const navigate = useNavigate();
  const [farmers, setFarmers] = useState<FarmerRow[]>([]);
  useEffect(() => {
    api.farmers().then((r) => setFarmers(r.farmers.filter((f) => BUYER_KINDS.includes(f.kind)))).catch(() => setFarmers([]));
  }, []);
  useEffect(() => {
    if (current) rememberFarmer(current);
  }, [current]);

  // Farmer groups and anyone with earnings first: they have the most to show.
  const sorted = [...farmers].sort(
    (a, b) => Number(b.kind === "farmer_group") - Number(a.kind === "farmer_group") || b.paid_cents - a.paid_cents || a.name.localeCompare(b.name),
  );
  const cur = farmers.find((f) => f.id === current);

  return (
    <div className="switcher">
      <span className="switcher-tag">Demo</span>
      <span className="switcher-label">Viewing as</span>
      {cur && <i className="kind-dot" style={{ background: KIND_COLOR[cur.kind] }} />}
      <select
        value={current ?? ""}
        onChange={(e) => e.target.value && navigate(to === "shop" ? `/farmers/${e.target.value}/shop` : `/farmers/${e.target.value}`)}
        aria-label="Choose which farmer to act as"
      >
        {!current && <option value="">Choose a farmer…</option>}
        {sorted.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} · {f.town}, {f.country}
            {f.paid_cents > 0 ? ` · earned ${usd(f.paid_cents)}` : ""}
          </option>
        ))}
      </select>
      <span className="switcher-note">Stands in for farmer sign-in. A real version would use Log in with PayPal.</span>
    </div>
  );
}
