import { test } from "node:test";
import assert from "node:assert/strict";
import { fail } from "../src/errors.js";

test("throws an Error carrying the code", () => {
  assert.throws(() => fail("NOT_FOUND", "no such row"), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(error.message, "E_NOT_FOUND: no such row");
    return true;
  });
});

test("rejects codes that are not upper snake case", () => {
  assert.throws(() => fail("bad-code", "x"), /code must match/);
});

test("carries a details bag when given", () => {
  assert.throws(() => fail("LIMIT", "too many rows", { limit: 10 }), (error) => {
    assert.deepEqual(error.details, { limit: 10 });
    return true;
  });
});
