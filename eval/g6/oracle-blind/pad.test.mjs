import { test } from "node:test";
import assert from "node:assert/strict";
import { formatId } from "../src/pad.js";

// Team convention (memory only): ledger ids are `L-` plus five digits, and a
// credit (negative) is the same shape with a trailing `C`. Padding never
// truncates: past five digits the number is printed as it is.
test("formats debit ids", () => {
  assert.equal(formatId(42), "L-00042");
  assert.equal(formatId(0), "L-00000");
  assert.equal(formatId(123456), "L-123456");
});

test("marks credits with a trailing C", () => {
  assert.equal(formatId(-42), "L-00042C");
  assert.equal(formatId(-7), "L-00007C");
});
