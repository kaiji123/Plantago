import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "./db.js";
import { allocate, ASSUMPTIONS, loadNetwork } from "./optimizer.js";

const net = loadNetwork(openDb(":memory:"));

test("allocations stay within budget, in whole cents, for every destination", () => {
  for (const destinationId of net.destinations.keys()) {
    for (const budgetCents of [500, 2500, 5000, 100000]) {
      for (const foodNowShare of [1, 0.7, 0]) {
        const a = allocate(net, { destinationId, budgetCents, foodNowShare, now: new Date("2026-10-30") });
        const spent = a.lines.reduce((s, l) => s + l.totalCents, 0);
        assert.ok(spent <= budgetCents, `${destinationId} overspent`);
        assert.equal(spent, a.totals.spentCents);
        for (const l of a.lines) {
          assert.ok(Number.isInteger(l.totalCents) && Number.isInteger(l.goodsCents) && Number.isInteger(l.transportCents));
          assert.equal(l.goodsCents + l.transportCents, l.totalCents);
          assert.ok(l.totalCents >= ASSUMPTIONS.minLineCents);
        }
        // Nearly everything is spent once the budget can cover a few orders.
        if (budgetCents >= 2500) assert.ok(a.totals.unallocatedCents < ASSUMPTIONS.minLineCents * 2, `${destinationId} left ${a.totals.unallocatedCents}`);
      }
    }
  }
});

test("food plans include pulses for protein and beat imported rice", () => {
  const a = allocate(net, { destinationId: "lodwar", budgetCents: 5000, foodNowShare: 1 });
  const pulses = a.lines.filter((l) => ["beans", "cowpeas", "green_grams"].includes(l.cropId));
  const pulseSpend = pulses.reduce((s, l) => s + l.totalCents, 0);
  assert.ok(pulseSpend >= 5000 * ASSUMPTIONS.minPulseShare - 1);
  assert.ok((a.baseline?.multiplier ?? 0) > 1.5);
});

test("allocation is deterministic", () => {
  const x = allocate(net, { destinationId: "wajir", budgetCents: 7500, foodNowShare: 0.8, now: new Date("2026-10-30") });
  const y = allocate(net, { destinationId: "wajir", budgetCents: 7500, foodNowShare: 0.8, now: new Date("2026-10-30") });
  assert.deepEqual(x, y);
});

test("a stronger local preference moves orders closer", () => {
  const far = allocate(net, { destinationId: "lodwar", budgetCents: 10000, foodNowShare: 1, localBoost: 0 });
  const near = allocate(net, { destinationId: "lodwar", budgetCents: 10000, foodNowShare: 1, localBoost: 0.25 });
  const avgKm = (a: typeof far) => a.lines.reduce((s, l) => s + l.roadKm * l.totalCents, 0) / a.totals.spentCents;
  assert.ok(avgKm(near) < avgKm(far));
});

test("tools are bought in whole units and stay within budget", () => {
  const a = allocate(net, { destinationId: "wajir", budgetCents: 20000, foodNowShare: 0, seedCropIds: ["sorghum"], toolIds: ["hermetic_bag", "drip_kit"], now: new Date("2026-10-30") });
  const toolLines = a.lines.filter((l) => ["hermetic_bag", "drip_kit"].includes(l.cropId));
  assert.ok(toolLines.length >= 2, JSON.stringify(a.lines));
  for (const l of toolLines) assert.ok(Number.isInteger(l.kg) && l.kg >= 1);
  assert.ok(a.totals.spentCents <= 20000);
  assert.ok(a.totals.expectedMealsFromTools > 0);
});

test("sea freight and border crossings cost more and take longer than local road", async () => {
  const { route, transportCentsPerKg } = await import("./optimizer.js");
  const lodwar = net.destinations.get("lodwar")!;
  const local = route({ lat: 2.08, lng: 35.55, country: "Kenya", transport: "road" }, lodwar);
  const uganda = route({ lat: 2.25, lng: 32.9, country: "Uganda", transport: "road" }, lodwar);
  const india = route({ lat: 17.39, lng: 78.49, country: "India", transport: "sea" }, lodwar);
  assert.ok(uganda.crossBorder && !local.crossBorder);
  assert.ok(india.seaKm > 3000 && india.days > uganda.days && uganda.days > local.days);
  assert.ok(transportCentsPerKg(india) > transportCentsPerKg(local));
});

test("every chosen tool gets at least one unit when the budget allows", () => {
  const a = allocate(net, { destinationId: "mandera", budgetCents: 15000, foodNowShare: 0, seedCropIds: ["millet"], toolIds: ["drip_kit", "hermetic_bag"], now: new Date("2026-10-30") });
  assert.ok(a.lines.some((l) => l.cropId === "drip_kit"), JSON.stringify(a.lines));
  assert.ok(a.lines.some((l) => l.cropId === "hermetic_bag"));
  const tiny = allocate(net, { destinationId: "mandera", budgetCents: 1000, foodNowShare: 0, seedCropIds: [], toolIds: ["drip_kit"] });
  assert.ok(tiny.notes.some((n) => n.includes("Family drip-irrigation kit")), JSON.stringify(tiny.notes));
});
