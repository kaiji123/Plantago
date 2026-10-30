// Shipment status pill and next-step button, coloured to match the network map.

export type ShipStatus = "awaiting_payment" | "sourced" | "shipped" | "delivered";

export const SHIP_META: Record<ShipStatus, { label: string; color: string; bg: string }> = {
  awaiting_payment: { label: "Awaiting payment", color: "#9a6a00", bg: "#fdf0d2" },
  sourced: { label: "Sourced", color: "#21734c", bg: "#e1f1e7" },
  shipped: { label: "On the road", color: "#1f6694", bg: "#e0eef8" },
  delivered: { label: "Delivered", color: "#ffffff", bg: "#1f4d3a" },
};

export function ShipStatusPill({ status }: { status: ShipStatus }) {
  const m = SHIP_META[status] ?? SHIP_META.awaiting_payment;
  return (
    <span className="ship-pill" style={{ color: m.color, background: m.bg }}>
      <i style={{ background: status === "delivered" ? "#9be3b8" : m.color }} />
      {m.label}
    </span>
  );
}

export function ShipAction({ status, busy, onAdvance }: { status: ShipStatus; busy?: boolean; onAdvance: () => void }) {
  if (status === "sourced")
    return (
      <button className="ship-btn ship" disabled={busy} onClick={onAdvance}>
        <span aria-hidden>🚚</span> Mark shipped
      </button>
    );
  if (status === "shipped")
    return (
      <button className="ship-btn deliver" disabled={busy} onClick={onAdvance}>
        <span aria-hidden>✓</span> Mark delivered
      </button>
    );
  if (status === "delivered") return <span className="ship-done">✓ Done</span>;
  return <span className="ship-wait">Pay supplier first</span>;
}
