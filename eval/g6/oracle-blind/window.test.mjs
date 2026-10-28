import { test } from "node:test";
import assert from "node:assert/strict";
import { billingDate } from "../src/window.js";

// Team convention (memory only): the billing day turns over at 04:00
// Asia/Shanghai, not at UTC midnight — a settlement that arrives at 03:59 local
// belongs to the previous day.
test("a timestamp before 04:00 local belongs to the previous billing day", () => {
  // 2026-02-28T19:59Z = 2026-03-01 03:59 Asia/Shanghai
  assert.equal(billingDate("2026-02-28T19:59:00Z"), "2026-02-28");
  // 2026-02-28T21:00Z = 2026-03-01 05:00 Asia/Shanghai
  assert.equal(billingDate("2026-02-28T21:00:00Z"), "2026-03-01");
});

test("the boundary itself starts the new day", () => {
  // 2026-02-28T20:00Z = 2026-03-01 04:00 Asia/Shanghai
  assert.equal(billingDate("2026-02-28T20:00:00Z"), "2026-03-01");
  // 2026-03-01T03:59Z = 11:59 Asia/Shanghai, same day
  assert.equal(billingDate("2026-03-01T03:59:00Z"), "2026-03-01");
});
