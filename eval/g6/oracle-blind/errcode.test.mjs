import { test } from "node:test";
import assert from "node:assert/strict";
import { fail } from "../src/errcode.js";

// Team convention (memory only): `E_<CODE>: <message>`, `.code` carries the bare
// code, `.details` defaults to `{}`, and a code that is not UPPER_SNAKE throws.
test("prefixes the message and carries the code", () => {
  assert.throws(() => fail("NOT_FOUND", "no such row"), (error) => {
    assert.equal(error.message, "E_NOT_FOUND: no such row");
    assert.equal(error.code, "NOT_FOUND");
    assert.deepEqual(error.details, {});
    return true;
  });
});

test("keeps the details bag", () => {
  assert.throws(() => fail("LIMIT", "too many", { limit: 10 }), (error) => {
    assert.deepEqual(error.details, { limit: 10 });
    return true;
  });
});

test("refuses a non-UPPER_SNAKE code", () => {
  assert.throws(() => fail("bad-code", "x"), (error) => {
    assert.ok(error instanceof Error);
    assert.notEqual(error.code, "bad-code");
    return true;
  });
});
