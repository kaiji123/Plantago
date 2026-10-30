// Checks that PayPal sandbox and AI planner (DeepSeek) credentials work.
//   npm run check            → PayPal auth + create an order, AI planner ping (with a tool call)
//   npm run check -- --payout → also send a $1.00 sandbox payout (needs Payouts enabled)
import OpenAI from "openai";
import { config, paypalSimulated } from "../config.js";
import * as paypal from "../paypal.js";

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);
let failed = false;

console.log("\nPayPal sandbox");
if (paypalSimulated) {
  bad("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set: the app runs in simulation mode");
  failed = true;
} else {
  try {
    const { orderId } = await paypal.createOrder({ donationId: `check-${Date.now()}`, amountCents: 100, description: "Plantago key check" });
    ok(`Authenticated and created a $1.00 test order (${orderId}); it is never captured`);
  } catch (e) {
    bad(`Orders API: ${(e as Error).message}`);
    failed = true;
  }
  if (process.argv.includes("--payout")) {
    try {
      const receiver = config.paypal.payoutReceiverOverride || "plantago-check@example.com";
      const r = await paypal.createPayoutBatch({
        senderBatchId: `check_${Date.now()}`,
        items: [{ senderItemId: `check_${Date.now()}`, receiver, amountCents: 100, note: "Plantago key check" }],
      });
      ok(`Payouts enabled: sent $1.00 to ${receiver} (batch ${r.payoutBatchId}, ${r.status})`);
    } catch (e) {
      bad(`Payouts API: ${(e as Error).message}. Enable Payouts for the sandbox app in the developer dashboard.`);
      failed = true;
    }
  } else console.log("  · Payouts not tested (run with --payout to send a $1.00 sandbox payout)");
  console.log(config.paypal.webhookId ? "  ✓ Webhook ID set" : "  · PAYPAL_WEBHOOK_ID not set (optional; needs a public URL)");
}

console.log("\nAI planner");
if (!config.planner.enabled) {
  bad("DEEPSEEK_API_KEY (or PLANNER_API_KEY) not set: plans use the rule-based planner");
  failed = true;
} else {
  try {
    const client = new OpenAI({ apiKey: config.planner.apiKey, baseURL: config.planner.baseUrl });
    const t0 = Date.now();
    // Ask for a tool call: the planner depends on tool calling, so test exactly that.
    const r = await client.chat.completions.create({
      model: config.planner.model,
      messages: [{ role: "user", content: "Call the ping tool with message 'ready'." }],
      tools: [{ type: "function", function: { name: "ping", description: "Health check", parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } } }],
      max_tokens: 2000,
      reasoning_effort: "low",
      ...(config.planner.thinking ? { thinking: { type: "enabled" } } : {}),
    } as any);
    const call = r.choices[0].message.tool_calls?.[0] as any;
    if (call?.function?.name === "ping") ok(`${config.planner.model} at ${config.planner.baseUrl} made a tool call in ${Date.now() - t0} ms (${call.function.arguments})`);
    else {
      bad(`${config.planner.model} answered without calling the tool (finish: ${r.choices[0].finish_reason})`);
      failed = true;
    }
  } catch (e) {
    bad(`${(e as Error).message}`);
    failed = true;
  }
}
console.log(failed ? "\nSome checks failed.\n" : "\nAll good.\n");
process.exit(failed ? 1 : 0);
