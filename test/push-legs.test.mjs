/**
 * Push-legs telemetry (issue #9, 2026-10-27).
 *
 * The four session-log-dependent features ([RECALL], episode, resume brief,
 * todo sink) sleep together when the host exposes no readable event log, and
 * their only trace used to be a `warn` on a terminal. These tests pin the
 * artifact that makes dormancy inspectable offline: the newest read path, the
 * per-verdict tally, and the bounded append.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describePushLegs, noteSessionEventsSource, pushLegsPath, readPushLegsHealth } from "../lib/push-legs.js";

const home = () => mkdtempSync(join(tmpdir(), "push-legs-"));

test("no file yet → undefined health and an honest status line", () => {
  const h = home();
  assert.equal(readPushLegsHealth(h), undefined);
  assert.match(describePushLegs(undefined), /还没记录/);
});

test("records the read path per session and reports the newest", () => {
  const h = home();
  assert.equal(noteSessionEventsSource({ home: h, source: "sessionQuery", sessionId: "s1", now: 1000 }), true);
  assert.equal(noteSessionEventsSource({ home: h, source: "eventAt", sessionId: "s2", now: 2000 }), true);

  const health = readPushLegsHealth(h);
  assert.equal(health.source, "eventAt");
  assert.equal(health.sessionId, "s2");
  assert.equal(health.at, 2000);
  assert.deepEqual(health.counts, { sessionQuery: 1, eventAt: 1 });
  assert.match(describePushLegs(health), /事件日志读法 eventAt/);
});

test("a dormant host says so in words, not in a bare 'none'", () => {
  const h = home();
  noteSessionEventsSource({ home: h, source: "none", sessionId: "s9", now: Date.now() });
  const line = describePushLegs(readPushLegsHealth(h));
  assert.match(line, /事件日志不可读（none）/);
  assert.match(line, /休眠中/);
});

test("the log is bounded: past the size cap only the tail rows survive", () => {
  const h = home();
  // 400 fat rows blow past the 32 KB cap; the keep-tail rewrite must kick in.
  for (let i = 0; i < 400; i += 1) {
    noteSessionEventsSource({ home: h, source: i % 2 === 0 ? "sessionQuery" : "eventAt", sessionId: `s${i}`.padEnd(80, "x"), now: 1000 + i });
  }
  const bytes = statSync(pushLegsPath(h)).size;
  assert.ok(bytes <= 64 * 1024, `expected a bounded file, got ${bytes} bytes`);
  const kept = readFileSync(pushLegsPath(h), "utf8").split("\n").filter((line) => line.length > 0);
  assert.ok(kept.length < 400, `expected the file to have rotated, got ${kept.length} rows`);
  assert.match(readPushLegsHealth(h).sessionId, /^s399x*$/);
});

test("never throws on a bad home or a corrupt line", () => {
  assert.equal(noteSessionEventsSource({ home: "", source: "legacy" }), false);
  assert.equal(noteSessionEventsSource({ home: home(), source: "" }), false);

  const h = home();
  mkdirSync(join(h, "engram"), { recursive: true });
  writeFileSync(pushLegsPath(h), "{not json\n", "utf8");
  assert.equal(readPushLegsHealth(h), undefined);
});
