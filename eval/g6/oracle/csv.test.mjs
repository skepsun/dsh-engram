import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvLine, toCsvLine } from "../src/csv.js";

test("parses quoted fields containing commas", () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(parseCsvLine("1,2,3"), ["1", "2", "3"]);
});

test("unescapes doubled quotes", () => {
  assert.deepEqual(parseCsvLine('a,"say ""hi""",b'), ["a", 'say "hi"', "b"]);
});

test("round-trips a record with commas and quotes", () => {
  const fields = ["plain", "with,comma", 'with"quote'];
  assert.deepEqual(parseCsvLine(toCsvLine(fields)), fields);
});
