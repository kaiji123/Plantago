import "dotenv/config";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env("PORT", "8787")),
  isProd: env("NODE_ENV") === "production",
  databasePath: env("DATABASE_PATH", "./data/plantago.db"),
  operatorToken: env("OPERATOR_TOKEN"),
  payoutThresholdCents: Math.round(Number(env("PAYOUT_THRESHOLD_USD", "100")) * 100),
  paypal: {
    clientId: env("PAYPAL_CLIENT_ID"),
    clientSecret: env("PAYPAL_CLIENT_SECRET"),
    apiBase: env("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com"),
    webhookId: env("PAYPAL_WEBHOOK_ID"),
    payoutReceiverOverride: env("PAYPAL_PAYOUT_RECEIVER_OVERRIDE"),
  },
  planner: {
    model: env("PLANNER_MODEL", "claude-opus-5-5"),
    // The SDK also reads ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile,
    // but on a server we want an explicit key.
    enabled: env("ANTHROPIC_API_KEY") !== "" || env("ANTHROPIC_AUTH_TOKEN") !== "",
  },
};

/** Simulation mode: no PayPal credentials, so payments are faked and labelled as such. */
export const paypalSimulated = !config.paypal.clientId || !config.paypal.clientSecret;
