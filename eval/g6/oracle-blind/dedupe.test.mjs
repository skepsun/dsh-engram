import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRows } from "../src/dedupe.js";

// Team convention (memory only): when an id appears more than once the LAST row
// wins, but the id keeps the position where it FIRST appeared. The input is not
// mutated.
test("the last row for an id wins at the first row's position", () => {
  const rows = [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
    { id: "a", v: 3 },
  ];
  assert.deepEqual(mergeRows(rows), [
    { id: "a", v: 3 },
    { id: "b", v: 2 },
  ]);
});

test("does not mutate its input", () => {
  const rows = [{ id: "x", v: 1 }, { id: "x", v: 2 }];
  const before = structuredClone(rows);
  mergeRows(rows);
  assert.deepEqual(rows, before);
  assert.deepEqual(mergeRows([]), []);
});
