import { test } from "node:test";
import assert from "node:assert/strict";
import { rankRows } from "../src/ranking.js";

// Team convention (memory only): ascending by score; ties go to the LONGER id;
// still tied → reverse input order (last-in-first-out); always a fresh array.
test("orders by score, then id length, then reverse input order", () => {
  const rows = [
    { id: "a", score: 2 },
    { id: "bbb", score: 2 },
    { id: "cc", score: 2 },
    { id: "d", score: 1 },
    { id: "ee", score: 2 },
  ];
  assert.deepEqual(rankRows(rows).map((r) => r.id), ["d", "bbb", "ee", "cc", "a"]);
});

test("does not touch the input and returns a new array", () => {
  const rows = [
    { id: "x", score: 2 },
    { id: "y", score: 1 },
  ];
  const out = rankRows(rows);
  assert.notEqual(out, rows);
  assert.deepEqual(rows.map((r) => r.id), ["x", "y"]);
});
