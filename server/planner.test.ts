// The AI planner loop against a fake OpenAI-compatible (DeepSeek-style) server.
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

const requests: any[] = [];
const replies: any[] = [
  // 1. Two tool calls; the second has broken JSON and must come back as an error, not crash.
  {
    reasoning_content: "thinking-1",
    tool_calls: [
      { id: "c1", type: "function", function: { name: "get_destination_profile", arguments: "{}" } },
      { id: "c2", type: "function", function: { name: "build_allocation", arguments: "{bad json" } },
    ],
  },
  // 2. A valid allocation.
  { reasoning_content: "thinking-2", tool_calls: [{ id: "c3", type: "function", function: { name: "build_allocation", arguments: '{"food_now_share":1}' } }] },
  // 3. Submit it.
  {
    reasoning_content: "thinking-3",
    tool_calls: [
      {
        id: "c4",
        type: "function",
        function: {
          name: "submit_plan",
          arguments: JSON.stringify({ allocation_id: "A1", headline: "Maize and cowpeas from nearby growers", explanation: "All of this donation buys food now from Kenyan growers, which gives about twice the meals of imported rice." }),
        },
      },
    ],
  },
];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body);
    requests.push(json);
    const r = replies[requests.length - 1] ?? { content: "done" };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `x${requests.length}`,
        object: "chat.completion",
        created: 0,
        model: json.model,
        choices: [{ index: 0, message: { role: "assistant", content: r.content ?? null, ...r }, finish_reason: r.tool_calls ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 400 },
      }),
    );
  });
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.PAYOUT_THRESHOLD_USD = "100000";
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.PLANNER_API_KEY = "";
process.env.PLANNER_BASE_URL = `http://127.0.0.1:${port}`;
process.env.PLANNER_MODEL = "deepseek-flash";

const { openDb } = await import("./db.js");
const pay = await import("./payments.js");

test("AI planner: tool loop, reasoning echoed back, bad arguments survive, plan saved with usage", async () => {
  const db = openDb(":memory:");
  const { donationId, orderId } = await pay.createDonation(db, { destinationId: "lodwar", amountCents: 5000, goal: "Feed families" });
  await pay.captureDonation(db, donationId, orderId);
  let plan: any;
  for (let i = 0; i < 300; i++) {
    plan = db.prepare(`SELECT * FROM plans WHERE donation_id = ?`).get(donationId);
    if (plan && plan.status !== "planning") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  server.close();

  assert.equal(plan.status, "ready");
  assert.equal(plan.planner, "ai", "planned by the AI, not the fallback");
  assert.equal(plan.headline, "Maize and cowpeas from nearby growers");
  assert.equal(requests.length, 3);

  // Request shape: tools as JSON Schema, DeepSeek thinking switch, no $schema header.
  const first = requests[0];
  assert.equal(first.model, "deepseek-flash");
  assert.deepEqual(first.thinking, { type: "enabled" });
  const build = first.tools.find((t: any) => t.function.name === "build_allocation");
  assert.equal(build.function.parameters.type, "object");
  assert.ok(!("$schema" in build.function.parameters));

  // reasoning_content from turn 1 is sent back in turn 2 (DeepSeek returns 400 otherwise).
  const assistant1 = requests[1].messages.find((m: any) => m.role === "assistant");
  assert.equal(assistant1.reasoning_content, "thinking-1");
  // Both tool calls answered; the broken one as an error.
  const toolMsgs = requests[1].messages.filter((m: any) => m.role === "tool");
  assert.equal(toolMsgs.length, 2);
  assert.match(toolMsgs.find((m: any) => m.tool_call_id === "c2").content, /not valid JSON/);

  const summary = JSON.parse(plan.summary);
  assert.equal(summary.usage.requests, 3);
  assert.equal(summary.usage.toolCalls, 4);
  assert.ok(summary.usage.estimatedCostUsd > 0 && summary.usage.estimatedCostUsd < 0.01);
});
