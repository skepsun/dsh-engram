import { test } from "node:test";
import assert from "node:assert/strict";
import { toCents, sumAmounts } from "../src/money.js";

// Team convention (memory only): round half AWAY FROM ZERO at the cent, and sum
// in integer cents so 0.1+0.2 is 0.3 exactly.
test("rounds half away from zero", () => {
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(1.004), 100);
  assert.equal(toCents(-1.005), -101);
  assert.equal(toCents(2.5), 250);
});

test("sums in cents", () => {
  assert.equal(sumAmounts([0.1, 0.2]), 0.3);
  assert.equal(sumAmounts([1.005, 1.005]), 2.02);
});
