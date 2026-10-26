import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByScore } from "../src/ordering.js";

// Team convention (memory only): descending, stable, fresh array.
test("sorts descending and keeps ties in input order", () => {
  const rows = [
    { id: "a", score: 1 },
    { id: "b", score: 2 },
    { id: "c", score: 2 },
    { id: "d", score: 0 },
  ];
  const sorted = sortByScore(rows);
  assert.deepEqual(sorted.map((r) => r.id), ["b", "c", "a", "d"]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d"], "input must not be reordered");
  assert.notEqual(sorted, rows, "a fresh array");
});
