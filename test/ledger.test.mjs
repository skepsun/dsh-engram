/**
 * Context Ledger tests (lib/ledger.js) — deterministic accounting under a temp
 * home. Zero LLM.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createLedger,
  readLedger,
  finalizeLedgerBucket,
  finalizeSessionRow,
  estimatePrefixChars,
  ledgerDayKey,
  ledgerFile,
} from "../lib/ledger.js";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engram-ledger-"));
}

test("finalizeLedgerBucket: net = avoided − injected − rewrite×(1−discount)", () => {
  const out = finalizeLedgerBucket(
    { sessions: 1, requests: 10, injectedChars: 2000, avoidedChars: 10000, rewriteCount: 1, rewriteChars: 20000 },
    0.1,
  );
  assert.equal(out.rewritesCostChars, 18000);
  assert.equal(out.netChars, 10000 - 2000 - 18000);
  assert.equal(out.netTokens, Math.round(-10000 / 4));
  assert.equal(out.injectedTokens, 500);
  assert.equal(out.avoidedTokens, 2500);
});

test("finalizeLedgerBucket: clamps a bad discount and counts negatives as zero", () => {
  const out = finalizeLedgerBucket(
    { sessions: -2, requests: -1, injectedChars: -5, avoidedChars: 10, rewriteCount: -1, rewriteChars: -100 },
    7,
  );
  assert.equal(out.sessions, 0);
  assert.equal(out.requests, 0);
  assert.equal(out.injectedChars, 0);
  assert.equal(out.rewriteChars, 0);
  assert.equal(out.netChars, 10);
});

test("summary: empty ledger is a zero net, not null", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false });
  const s = ledger.summary();
  assert.equal(s.openSessions, 0);
  assert.equal(s.totals.requests, 0);
  assert.equal(s.totals.netChars, 0);
  assert.equal(s.cacheDiscount, 0.1);
  assert.deepEqual(s.byDay, []);
});

test("injection is charged once per request (index + esr)", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false });
  ledger.noteInjection("s1", "/ws", "index", 100);
  ledger.noteInjection("s1", "/ws", "esr", 50);
  for (let i = 0; i < 4; i += 1) ledger.tick("s1", "/ws");
  const s = ledger.summary();
  assert.equal(s.totals.requests, 4);
  assert.equal(s.totals.injectedChars, 600);
  assert.equal(s.totals.netChars, -600);
  assert.equal(s.byWorkspace["/ws"].injectedChars, 600);
});

test("a prune credits avoided chars on each later request, net of the rewrite", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false, cacheDiscount: 0.1 });
  ledger.tick("s1", "/ws"); // request 1
  ledger.notePrune("s1", "/ws", { charsRemoved: 1000, rewriteChars: 5000 });
  for (let i = 0; i < 4; i += 1) ledger.tick("s1", "/ws"); // requests 2..5
  const s = ledger.summary();
  assert.equal(s.totals.requests, 5);
  assert.equal(s.totals.avoidedChars, 4000);
  assert.equal(s.totals.rewriteCount, 1);
  assert.equal(s.totals.rewriteChars, 5000);
  assert.equal(s.totals.rewritesCostChars, 4500);
  assert.equal(s.totals.netChars, 4000 - 4500);
});

test("prune before any tick still credits later requests only", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false, cacheDiscount: 0 });
  ledger.notePrune("s1", "/ws", { charsRemoved: 500 });
  ledger.tick("s1", "/ws");
  ledger.tick("s1", "/ws");
  const s = ledger.summary();
  assert.equal(s.totals.avoidedChars, 1000);
  assert.equal(s.totals.netChars, 1000);
});

test("a compaction credit feeds avoided chars from the next request on", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false, cacheDiscount: 0 });
  ledger.tick("s1", "/ws"); // request 1 paid the pre-compaction prefix
  ledger.noteCompaction("s1", "/ws", { charsSaved: 3000 });
  ledger.tick("s1", "/ws"); // request 2 replays the shorter prefix
  ledger.tick("s1", "/ws");
  const s = ledger.summary();
  assert.equal(s.totals.avoidedChars, 6000, "credited per replayed request, like a prune");
  assert.equal(s.totals.netChars, 6000);
  assert.equal(s.byWorkspace["/ws"].avoidedChars, 6000);
});

test("persisted rollup survives an instance restart (delta flush)", () => {
  const home = tmpHome();
  const first = createLedger({ home, flushEvery: 2, cacheDiscount: 0.1 });
  first.noteInjection("s1", "/ws", "index", 100);
  first.tick("s1", "/ws");
  first.tick("s1", "/ws"); // flush at request 2
  first.notePrune("s1", "/ws", { charsRemoved: 2000, rewriteChars: 10000 });
  first.dispose("s1");

  const onDisk = readLedger({ home });
  assert.equal(onDisk.totals.requests, 2);
  assert.equal(onDisk.totals.injectedChars, 200);
  assert.equal(onDisk.totals.avoidedChars, 0, "the prune lands after the last tick");
  assert.equal(onDisk.byWorkspace["/ws"].sessions, 1);

  const second = createLedger({ home, cacheDiscount: 0.1 });
  const s = second.summary();
  assert.equal(s.totals.rewriteCount, 1);
  assert.equal(s.totals.netChars, 0 - 200 - 9000);
  second.tick("s2", "/ws");
  second.tick("s2", "/ws");
  const s2 = second.summary();
  assert.equal(s2.totals.requests, 4);
  assert.equal(s2.openSessions, 1);
  assert.equal(s2.byWorkspace["/ws"].sessions, 2, "second session counts on first flush");
});

test("daily buckets split by flush day and keep the live tail on today", () => {
  const home = tmpHome();
  let clock = new Date("2026-10-18T23:00:00").getTime();
  const ledger = createLedger({ home, persist: true, flushEvery: 0, now: () => clock });
  ledger.notePrune("s1", "/ws", { charsRemoved: 100 }); // flushes on 10-18
  clock = new Date("2026-10-19T09:00:00").getTime();
  ledger.tick("s1", "/ws");
  ledger.tick("s1", "/ws");
  const s = ledger.summary();
  assert.equal(s.byDay.length, 2);
  assert.equal(s.byDay[0].day, "2026-10-19");
  assert.equal(s.byDay[0].avoidedChars, 200);
  assert.equal(s.byDay[1].day, "2026-10-18");
  assert.equal(s.byDay[1].rewriteCount, 1);
});

test("dispose folds the tail and removes the open session", () => {
  const home = tmpHome();
  const ledger = createLedger({ home, persist: true, flushEvery: 0 });
  ledger.noteInjection("s1", "/ws", "index", 40);
  ledger.tick("s1", "/ws");
  ledger.tick("s1", "/ws");
  assert.equal(ledger.summary().openSessions, 1);
  ledger.dispose("s1");
  const s = ledger.summary();
  assert.equal(s.openSessions, 0);
  assert.equal(s.totals.requests, 2);
  assert.equal(s.totals.injectedChars, 80);
});

test("missing/degenerate session ids are ignored, bad homes never throw", () => {
  const badHome = path.join(os.tmpdir(), `no-such-${process.pid}`, "deep", "home");
  const ledger = createLedger({ home: badHome, persist: true });
  ledger.tick(void 0, "/ws");
  ledger.tick("", "/ws");
  ledger.noteInjection(null, "/ws", "index", 10);
  ledger.notePrune(123, "/ws", { charsRemoved: 10 });
  const s = ledger.summary();
  assert.equal(s.totals.requests, 0);
  assert.equal(s.totals.rewriteCount, 0);
});

test("estimatePrefixChars sums text blocks over the surface, never throws", () => {
  const messages = {
    1: { content: [{ type: "text", text: "abcd" }, { type: "image", data: "x" }] },
    2: { content: [{ type: "text", text: "你好" }] },
  };
  const session = {
    surface: { nodes: [1, 2, 3] },
    eventAt: (seq) => (seq === 3 ? null : { seq }),
    deriveEventMessage: (event) => messages[event.seq] ?? { content: [] },
  };
  assert.equal(estimatePrefixChars(session), 6);
  assert.equal(estimatePrefixChars(null), 0);
  assert.equal(estimatePrefixChars({ surface: {} }), 0);
  assert.equal(
    estimatePrefixChars({
      surface: { nodes: [1] },
      eventAt: () => {
        throw new Error("boom");
      },
    }),
    0,
  );
});

test("ledgerDayKey and ledgerFile are stable helpers", () => {
  assert.equal(ledgerDayKey(new Date("2026-01-02T03:04:05").getTime()), "2026-01-02");
  assert.equal(ledgerFile("/x"), path.join("/x", "ledger.json"));
});

test("JIT injections and non-prune rewrites are priced through the ledger", () => {
  const ledger = createLedger({ home: tmpHome(), persist: false, cacheDiscount: 0.1 });
  ledger.noteInjection("s1", "/ws", "jit", 50);
  ledger.tick("s1", "/ws");
  ledger.tick("s1", "/ws");
  ledger.noteRewrite("s1", "/ws", { chars: 1000 });
  ledger.tick("s1", "/ws");
  const s = ledger.summary();
  assert.equal(s.totals.injectedChars, 150, "JIT block charged per surviving request");
  assert.equal(s.totals.rewriteCount, 1);
  assert.equal(s.totals.rewriteChars, 1000);
  assert.equal(s.totals.rewritesCostChars, 900);
  assert.equal(s.totals.netChars, -150 - 900);
});

// ── per-session rows (v0.7.5: make the §6 gates computable) ─────────────────
test("session rows: one row per session, net computed per session, survives dispose", () => {
  const home = tmpHome();
  const ledger = createLedger({ home, flushEvery: 0, cacheDiscount: 0.1 });
  ledger.noteInjection("s1", "/ws", "index", 400);
  for (let i = 0; i < 3; i += 1) ledger.tick("s1", "/ws");
  ledger.notePrune("s1", "/ws", { charsRemoved: 4000, rewriteChars: 0 });
  // three requests replay the 4000 saved chars
  for (let i = 0; i < 3; i += 1) ledger.tick("s1", "/ws");

  ledger.noteInjection("s2", "/ws", "index", 200);
  ledger.tick("s2", "/ws"); // a tiny session: cost only
  ledger.dispose("s2");
  ledger.flush();

  const rows = readLedger({ home }).sessions;
  assert.equal(rows.length, 2, "one durable row per session");
  const s1 = rows.find((r) => r.sessionId === "s1");
  const s2 = rows.find((r) => r.sessionId === "s2");
  assert.equal(s1.requests, 6);
  assert.equal(s1.injectedChars, 2400, "index charged once per request");
  assert.equal(s1.avoidedChars, 12000, "4000 saved × 3 later requests");
  assert.equal(s1.netChars, 12000 - 2400);
  assert.equal(s1.prunedChars, 4000);
  assert.equal(s2.netChars, -200, "cost-only session reads negative, not omitted");
  assert.ok(s1.updatedAt >= s2.updatedAt, "newest activity first");
});

test("session rows: the open session's unflushed tail is visible in summary()", () => {
  const ledger = createLedger({ home: tmpHome(), flushEvery: 0, cacheDiscount: 0.1 });
  ledger.noteInjection("s1", "/ws", "index", 100);
  ledger.tick("s1", "/ws");
  ledger.tick("s1", "/ws"); // no flush yet (flushEvery 0 = only prune/dispose flush)
  const row = ledger.summary().sessions.find((r) => r.sessionId === "s1");
  assert.ok(row, "live session appears without waiting for a flush");
  assert.equal(row.requests, 2);
  assert.equal(row.injectedChars, 200);
});

test("session rows: capped by maxSessionRows, oldest activity dropped", () => {
  const home = tmpHome();
  let clock = Date.now();
  const ledger = createLedger({ home, flushEvery: 1, persist: true, maxSessionRows: 2, now: () => clock });
  for (const id of ["a", "b", "c"]) {
    clock += 1000;
    ledger.noteInjection(id, "/ws", "index", 10);
    ledger.tick(id, "/ws"); // flushEvery 1 → durable row per tick
  }
  const rows = readLedger({ home }).sessions;
  assert.equal(rows.length, 2, "cap keeps the disk file bounded");
  assert.deepEqual(rows.map((r) => r.sessionId).sort(), ["b", "c"], "oldest dropped");
});

test("finalizeSessionRow keeps the bucket arithmetic but drops the session counter", () => {
  const row = finalizeSessionRow(
    { sessionId: "s", workspace: "/w", firstDay: "2026-10-01", lastDay: "2026-10-02", requests: 2, injectedChars: 100, avoidedChars: 1000, rewriteCount: 0, rewriteChars: 0 },
    0.1,
  );
  assert.equal(row.netChars, 900);
  assert.equal(row.sessions, void 0, "a row is one session — no nested count");
  assert.equal(row.firstDay, "2026-10-01");
});

test("notePrune: host prunes land in hostPrunedChars, never in the engram leg", () => {
  const home = tmpHome();
  const ledger = createLedger({ home, every: 0 });
  const ws = "/tmp/ws-attrib";

  // The host pruned on its own (12,491 tokens observed live).
  ledger.notePrune("s-host", ws, { charsRemoved: 49_964, rewriteChars: 60_000, source: "host" });
  // Engram's own boundary prune.
  ledger.notePrune("s-host", ws, { charsRemoved: 9_000, rewriteChars: 12_000 });

  const row = readLedger({ home }).sessions.find((r) => r.sessionId === "s-host");
  assert.equal(row.hostPrunedChars, 49_964, "host leg recorded separately");
  assert.equal(row.prunedChars, 9_000, "engram leg untouched by host prunes");
  assert.equal(row.rewriteCount, 1, "only the engram prune pays a rewrite cost");
  assert.equal(row.rewriteChars, 12_000, "the host's rewrite cost is not ours");

  // Only the engram leg can reach avoidedChars (what NetTokens spends).
  ledger.noteInjection("s-host", ws, "index", 1_000);
  ledger.tick("s-host", ws);
  const after = ledger.summary();
  const sessionRow = after.sessions.find((r) => r.sessionId === "s-host") ?? after.sessions[0];
  assert.equal(sessionRow.avoidedChars, 9_000, "host savings are not claimed as avoided");
  assert.ok(after.hostPrunedChars >= 49_964, "summary surfaces the host leg");
  fs.rmSync(home, { recursive: true, force: true });
});

test("a restart does not zero a session's prune counters", async (t) => {
  // Live bug (2026-10-26): flush wrote `row.prunedChars = session.prunedChars`,
  // and a freshly booted process starts that counter at 0 — so the first flush
  // after any restart erased the durable row's prune history. Same class as the
  // reentrancy bug: the in-memory object is not the durable truth.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "engram-ledger-restart-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = ledgerFile(home);

  const first = createLedger({ home, flushEvery: 0 });
  first.notePrune("sess-r", "/repo/restart", { charsRemoved: 7_841, rewriteChars: 9_000 });
  first.noteInjection("sess-r", "/repo/restart", "index", 1_000);
  first.tick("sess-r", "/repo/restart");
  first.flush();
  const rowAfterOne = JSON.parse(fs.readFileSync(file, "utf8")).sessions["sess-r"];
  assert.equal(rowAfterOne.prunedChars, 7_841);

  // "Restart": a new process opens the same file, does ordinary work, flushes.
  const second = createLedger({ home, flushEvery: 0 });
  second.noteInjection("sess-r", "/repo/restart", "index", 500);
  second.tick("sess-r", "/repo/restart");
  second.flush();
  const rowAfterTwo = JSON.parse(fs.readFileSync(file, "utf8")).sessions["sess-r"];
  assert.equal(rowAfterTwo.prunedChars, 7_841, "prune history survives the restart");
  assert.equal(rowAfterTwo.injectedChars, 1_500, "traffic keeps accumulating");

  // And a new prune after the restart adds on top instead of resetting.
  second.notePrune("sess-r", "/repo/restart", { charsRemoved: 2_000, rewriteChars: 1_000 });
  second.noteInjection("sess-r", "/repo/restart", "index", 100);
  second.tick("sess-r", "/repo/restart");
  second.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).sessions["sess-r"].prunedChars, 9_841);
});
