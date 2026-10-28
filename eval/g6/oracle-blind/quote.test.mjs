import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount } from "../src/quote.js";

// Team convention (memory only): quotes print cents as an apostrophe-separated
// amount with two decimals, and a negative amount is wrapped in parentheses
// instead of carrying a minus sign.
test("separates thousands with an apostrophe", () => {
  assert.equal(formatAmount(123456), "1'234.56");
  assert.equal(formatAmount(100000), "1'000.00");
  assert.equal(formatAmount(5), "0.05");
  assert.equal(formatAmount(0), "0.00");
});

test("parenthesises negative amounts", () => {
  assert.equal(formatAmount(-123456), "(1'234.56)");
  assert.equal(formatAmount(-5), "(0.05)");
});
