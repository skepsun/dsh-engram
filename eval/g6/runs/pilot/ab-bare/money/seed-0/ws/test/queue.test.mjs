import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByScore } from "../src/queue.js";

test("orders by score, highest first", () => {
  const sorted = sortByScore([{ id: "a", score: 1 }, { id: "b", score: 9 }, { id: "c", score: 5 }]);
  assert.deepEqual(sorted.map((e) => e.id), ["b", "c", "a"]);
});

test("keeps insertion order for equal scores", () => {
  const sorted = sortByScore([
    { id: "first", score: 7 },
    { id: "second", score: 7 },
    { id: "third", score: 7 },
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ["first", "second", "third"]);
});

test("does not mutate its input", () => {
  const input = [{ id: "a", score: 1 }, { id: "b", score: 2 }];
  const copy = structuredClone(input);
  sortByScore(input);
  assert.deepEqual(input, copy);
});
