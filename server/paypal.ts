// Thin PayPal REST client (sandbox). Every call that moves money sends a
// PayPal-Request-Id so a retried request can never charge or pay twice.
// With no credentials configured, calls are simulated and IDs start with "SIM-".

import { config, paypalSimulated } from "./config.js";
import { centsToPayPal, dollarsToCents, type Cents } from "./money.js";

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64");
  const res = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new PayPalError("PayPal authentication failed", res.status, body);
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${config.paypal.apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name ?? res.statusText;
    throw new PayPalError(`PayPal ${method} ${path} failed: ${issue}`, res.status, json);
  }
  return json as T;
}

const sim = (kind: string) => `SIM-${kind}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

// ---------- Orders (donations in) ----------

export async function createOrder(args: {
  donationId: string;
  amountCents: Cents;
  description: string;
}): Promise<{ orderId: string }> {
  if (paypalSimulated) return { orderId: sim("ORDER") };
  const order = await call<{ id: string }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.donationId,
          custom_id: args.donationId,
          description: args.description.slice(0, 127),
          amount: { currency_code: "USD", value: centsToPayPal(args.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Plantago",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        },
      },
    },
    `order-${args.donationId}`,
  );
  return { orderId: order.id };
}

export interface CaptureResult {
  captureId: string;
  status: string;
  amountCents: Cents;
  customId: string | null;
  payerName: string | null;
}

export async function captureOrder(args: { orderId: string; donationId: string; amountCents: Cents }): Promise<CaptureResult> {
  if (paypalSimulated)
    return { captureId: sim("CAPTURE"), status: "COMPLETED", amountCents: args.amountCents, customId: args.donationId, payerName: "Simulated donor" };
  let order: any;
  try {
    order = await call<any>("POST", `/v2/checkout/orders/${encodeURIComponent(args.orderId)}/capture`, {}, `capture-${args.donationId}`);
  } catch (e) {
    // Already captured (e.g. a retry after a timeout): read the order instead.
    if (e instanceof PayPalError && JSON.stringify(e.details).includes("ORDER_ALREADY_CAPTURED")) {
      order = await call<any>("GET", `/v2/checkout/orders/${encodeURIComponent(args.orderId)}`);
    } else throw e;
  }
  const unit = order.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  if (!cap) throw new PayPalError("Capture missing from PayPal response", 502, order);
  const given = order.payer?.name?.given_name;
  return {
    captureId: cap.id,
    status: cap.status,
    amountCents: dollarsToCents(cap.amount.value),
    customId: cap.custom_id ?? unit.custom_id ?? null,
    payerName: given ?? null,
  };
}

export async function refundCapture(args: { captureId: string; donationId: string }): Promise<{ refundId: string; status: string }> {
  if (paypalSimulated) return { refundId: sim("REFUND"), status: "COMPLETED" };
  const r = await call<{ id: string; status: string }>(
    "POST",
    `/v2/payments/captures/${encodeURIComponent(args.captureId)}/refund`,
    { note_to_payer: "Plantago could not fulfil this plan, so your donation has been returned." },
    `refund-${args.donationId}`,
  );
  return { refundId: r.id, status: r.status };
}

// ---------- Payouts (money out to growers) ----------

export interface PayoutItemInput {
  senderItemId: string;
  receiver: string;
  amountCents: Cents;
  note: string;
}

export async function createPayoutBatch(args: {
  senderBatchId: string;
  items: PayoutItemInput[];
}): Promise<{ payoutBatchId: string; status: string }> {
  if (paypalSimulated) return { payoutBatchId: sim("BATCH"), status: "SUCCESS" };
  const r = await call<any>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: args.senderBatchId,
        email_subject: "Plantago: payment for your crops",
        email_message: "Thank you for growing food for families in northern Kenya.",
      },
      items: args.items.map((i) => ({
        recipient_type: "EMAIL",
        receiver: i.receiver,
        amount: { value: centsToPayPal(i.amountCents), currency: "USD" },
        note: i.note.slice(0, 4000),
        sender_item_id: i.senderItemId,
      })),
    },
    `payout-${args.senderBatchId}`,
  );
  return { payoutBatchId: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
}

export interface PayoutBatchStatus {
  status: string;
  items: { senderItemId: string; payoutItemId: string; transactionStatus: string; transactionId: string | null }[];
}

export async function getPayoutBatch(payoutBatchId: string): Promise<PayoutBatchStatus> {
  if (paypalSimulated || payoutBatchId.startsWith("SIM-")) return { status: "SUCCESS", items: [] };
  const r = await call<any>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?page_size=100`);
  return {
    status: r.batch_header.batch_status,
    items: (r.items ?? []).map((it: any) => ({
      senderItemId: it.payout_item?.sender_item_id,
      payoutItemId: it.payout_item_id,
      transactionStatus: it.transaction_status,
      transactionId: it.transaction_id ?? null,
    })),
  };
}

// ---------- Webhooks ----------

export async function verifyWebhook(headers: Record<string, string | undefined>, event: unknown): Promise<boolean> {
  if (paypalSimulated || !config.paypal.webhookId) return false;
  const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: config.paypal.webhookId,
    webhook_event: event,
  });
  return r.verification_status === "SUCCESS";
}

/** Link to the transaction in the sandbox dashboard, for the public ledger. */
export function sandboxActivityUrl(): string {
  return "https://www.sandbox.paypal.com/myaccount/activities/";
}
