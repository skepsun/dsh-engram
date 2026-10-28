import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRetry } from "../src/retry.js";

// Team convention (memory only): retry 5xx, 429 and E_LEDGER_LOCKED; never retry
// E_VALIDATION or any other 4xx; at most three attempts, and `attempt` counts
// from 1 (so attempt 3 is the last one).
test("retries server errors and rate limits", () => {
  assert.equal(shouldRetry(500, null, 1), true);
  assert.equal(shouldRetry(503, null, 2), true);
  assert.equal(shouldRetry(429, null, 1), true);
});

test("a locked ledger is retryable even though it is a 409", () => {
  assert.equal(shouldRetry(409, "E_LEDGER_LOCKED", 2), true);
});

test("does not retry validation or other client errors", () => {
  assert.equal(shouldRetry(400, "E_VALIDATION", 1), false);
  assert.equal(shouldRetry(409, "E_CONFLICT", 1), false);
});

test("gives up after the third attempt", () => {
  assert.equal(shouldRetry(500, null, 3), false);
});
