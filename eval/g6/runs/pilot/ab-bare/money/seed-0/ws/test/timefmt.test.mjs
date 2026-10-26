import { test } from "node:test";
import assert from "node:assert/strict";
import { formatStamp, parseStamp } from "../src/timefmt.js";

test("formats as UTC ISO seconds with a trailing Z", () => {
  assert.equal(formatStamp(new Date("2026-01-02T03:04:05.987Z")), "2026-01-02T03:04:05Z");
});

test("round-trips through parseStamp", () => {
  const iso = formatStamp(new Date("2030-12-31T23:59:59Z"));
  assert.equal(parseStamp(iso).toISOString(), "2030-12-31T23:59:59.000Z");
});

test("is independent of the machine timezone", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "Asia/Shanghai";
    const east = formatStamp(new Date("2026-01-02T03:04:05Z"));
    process.env.TZ = "America/New_York";
    const west = formatStamp(new Date("2026-01-02T03:04:05Z"));
    assert.equal(east, west);
    assert.equal(east, "2026-01-02T03:04:05Z");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
