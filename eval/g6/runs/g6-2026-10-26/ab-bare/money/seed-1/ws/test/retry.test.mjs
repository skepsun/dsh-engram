import { test } from "node:test";
import assert from "node:assert/strict";
import { attempt } from "../src/retry.js";

test("retries until success and returns its value", async () => {
  let calls = 0;
  const value = await attempt(async () => {
    calls += 1;
    if (calls < 3) throw new Error("flaky");
    return "ok";
  }, { tries: 5 });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("stops after `tries` total attempts and rethrows the last error", async () => {
  let calls = 0;
  await assert.rejects(
    () => attempt(async () => {
      calls += 1;
      throw new Error(`boom-${calls}`);
    }, { tries: 3 }),
    /boom-3/,
  );
  assert.equal(calls, 3);
});

test("the attempt index is passed to fn, starting at zero", async () => {
  const seen = [];
  await attempt(async (i) => {
    seen.push(i);
    if (i < 2) throw new Error("again");
    return i;
  }, { tries: 4 });
  assert.deepEqual(seen, [0, 1, 2]);
});
