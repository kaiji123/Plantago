// Checks that PayPal sandbox and Claude credentials work.
//   npm run check            → PayPal auth + create an order, Claude ping
//   npm run check -- --payout → also send a $1.00 sandbox payout (needs Payouts enabled)
import Anthropic from "@anthropic-ai/sdk";
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

console.log("\nClaude (AI planner)");
if (!config.planner.enabled) {
  bad("ANTHROPIC_API_KEY not set: plans use the rule-based planner");
  failed = true;
} else {
  try {
    const client = new Anthropic();
    const r = await client.messages.create({
      model: config.planner.model,
      max_tokens: 64,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    });
    const text = r.content.find((b) => b.type === "text");
    ok(`${config.planner.model} responded: ${text && "text" in text ? text.text.trim() : r.stop_reason}`);
  } catch (e) {
    bad(`${(e as Error).message}`);
    failed = true;
  }
}
console.log(failed ? "\nSome checks failed.\n" : "\nAll good.\n");
process.exit(failed ? 1 : 0);
