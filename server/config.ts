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
    // DeepSeek by default; any OpenAI-compatible chat API works (set base URL + model).
    apiKey: env("PLANNER_API_KEY") || env("DEEPSEEK_API_KEY"),
    baseUrl: env("PLANNER_BASE_URL", "https://api.deepseek.com"),
    model: env("PLANNER_MODEL", "deepseek-flash"),
    reasoningEffort: env("PLANNER_REASONING_EFFORT", "high"),
    /** DeepSeek's `thinking` switch; set PLANNER_THINKING=off for providers that reject unknown fields. */
    thinking: env("PLANNER_THINKING", "on") !== "off",
    get enabled() {
      return this.apiKey !== "";
    },
  },
};

/** Simulation mode: no PayPal credentials, so payments are faked and labelled as such. */
export const paypalSimulated = !config.paypal.clientId || !config.paypal.clientSecret;
