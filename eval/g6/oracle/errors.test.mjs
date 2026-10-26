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
  // The convention says "reject a bad code", not "print this exact sentence".
  // The first version of this test required the literal phrase /code must match/
  // and therefore failed a CORRECT implementation whose message said
  // "E_INVALID_CODE: … expected UPPER_SNAKE_CASE" — an oracle testing wording
  // nobody declared. Assert the behaviour: it throws, and it does not let the
  // bad code through as a normal error.
  assert.throws(() => fail("bad-code", "x"), (error) => {
    assert.ok(error instanceof Error);
    assert.notEqual(error.code, "bad-code", "a bad code must not become the error's code");
    assert.ok(!String(error.message).startsWith("E_bad-code:"), "a bad code must not be formatted as a valid one");
    return true;
  });
});

test("carries a details bag when given", () => {
  assert.throws(() => fail("LIMIT", "too many rows", { limit: 10 }), (error) => {
    assert.deepEqual(error.details, { limit: 10 });
    return true;
  });
});
