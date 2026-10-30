// All money is held as integer US cents. Never do money math in floats.

export type Cents = number;

export function assertCents(v: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be whole cents, got ${v}`);
  return v;
}

export function dollarsToCents(dollars: number | string): Cents {
  const s = typeof dollars === "number" ? dollars.toFixed(2) : dollars.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${dollars}`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "12.34" — the string format PayPal expects. */
export function centsToPayPal(c: Cents): string {
  assertCents(c);
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export function fmtUsd(c: Cents): string {
  return `$${centsToPayPal(c)}`;
}

/**
 * Split `total` across weights so the parts are whole cents and add up exactly
 * (largest-remainder method).
 */
export function splitCents(total: Cents, weights: number[]): Cents[] {
  assertCents(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors;
}
