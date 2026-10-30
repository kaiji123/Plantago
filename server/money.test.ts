import assert from "node:assert/strict";
import { test } from "node:test";
import { centsToPayPal, dollarsToCents, splitCents } from "./money.js";

test("dollars and cents convert exactly", () => {
  assert.equal(dollarsToCents("50"), 5000);
  assert.equal(dollarsToCents("0.1"), 10);
  assert.equal(dollarsToCents("19.99"), 1999);
  assert.equal(dollarsToCents(0.1 + 0.2), 30);
  assert.throws(() => dollarsToCents("1.234"));
  assert.throws(() => dollarsToCents("-5"));
  assert.equal(centsToPayPal(5), "0.05");
  assert.equal(centsToPayPal(123456), "1234.56");
});

test("splitCents always adds up", () => {
  for (const total of [1, 99, 5000, 12345]) {
    const parts = splitCents(total, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    assert.ok(parts.every(Number.isInteger));
  }
});
