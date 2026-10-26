import { test } from "node:test";
import assert from "node:assert/strict";
import { sumAmounts, applyDiscount } from "../src/money.js";

test("sums decimal amounts to the cent", () => {
  assert.equal(sumAmounts([0.1, 0.2]), 0.3);
  assert.equal(sumAmounts([19.99, 0.01]), 20);
  assert.equal(sumAmounts([]), 0);
});

test("discounts round to the nearest cent (half up)", () => {
  assert.equal(applyDiscount(100, 12.5), 87.5);
  assert.equal(applyDiscount(19.99, 10), 17.99);
  assert.equal(applyDiscount(0.05, 50), 0.03);
});
