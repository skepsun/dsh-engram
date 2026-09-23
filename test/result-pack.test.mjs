import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_PAGE_CHARS,
  archiveId,
  archivePrunedResults,
  extractMiddle,
  pageArchived,
  readArchived,
  resultRecallTool,
  sweepExpired,
} from "../lib/result-pack.js";

let tmpRoot;
let dir;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "resultpack-"));
  dir = path.join(tmpRoot, "resultpack");
});
after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const TMP_NEVER = path.join(os.tmpdir(), `resultpack-never-${Date.now()}`);

// ── extractMiddle: code-point arithmetic mirrors the host pruner ───────────

test("extractMiddle splits head/middle/tail by code point", () => {
  const blocks = [{ type: "text", text: "A".repeat(3000) }, { type: "text", text: "B".repeat(3000) }];
  const m = extractMiddle(blocks, 2000, 500);
  assert.equal(m.removed.length, 3500, "middle = total 6000 - head 2000 - tail 500");
  assert.equal(m.head.length, 2000);
  assert.equal(m.tail.length, 500);
});

test("extractMiddle handles CJK (code points, not UTF-16 units)", () => {
  const text = "中".repeat(5000);
  const m = extractMiddle([{ type: "text", text }], 1000, 300);
  assert.equal(m.removed.length, 3700);
  assert.equal(m.head, "中".repeat(1000));
  assert.equal(m.tail, "中".repeat(300));
});

test("extractMiddle returns null when within head+tail budget", () => {
  assert.equal(extractMiddle([{ type: "text", text: "short" }], 100, 50), null);
  assert.equal(extractMiddle(null, 100, 50), null);
  assert.equal(extractMiddle([], 100, 50), null);
});

test("extractMiddle skips non-text blocks", () => {
  const blocks = [
    { type: "text", text: "x".repeat(1000) },
    { type: "image", data: {} },
    { type: "text", text: "y".repeat(1000) },
  ];
  const m = extractMiddle(blocks, 500, 300);
  assert.equal(m.removed.length, 1200);
  assert.equal(m.head.length, 500);
  assert.equal(m.tail.length, 300);
});

// ── archiveId / readArchived ───────────────────────────────────────────────

test("archiveId is stable and path-safe", () => {
  const a = archiveId("bash-call-1/weird name");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, archiveId("bash-call-1/weird name"));
  assert.notEqual(a, archiveId("bash-call-2/weird name"));
});

test("readArchived returns undefined for missing/corrupt files", () => {
  assert.equal(readArchived(dir, "no-such-call"), void 0);
  const bad = path.join(dir, `${archiveId("bad")}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(bad, "{not json");
  assert.equal(readArchived(dir, "bad"), void 0);
});

// ── archivePrunedResults end-to-end (fake session) ─────────────────────────

/** Minimal fake session: eventAt + deriveEventMessage return a scripted result. */
function fakeSession(originalContent, opts = {}) {
  const appends = [];
  return {
    id: opts.sessionId ?? "sess-1",
    header: { cwd: opts.cwd ?? "/ws" },
    eventAt(seq) {
      if (seq === 5 || seq === 42) {
        return { type: "tool/result", seq, data: { message: { source: { callId: "bash-abc123" } } } };
      }
      return null;
    },
    deriveEventMessage() {
      return { content: originalContent };
    },
    append(type, data, meta) {
      appends.push({ type, data, meta });
      return { seq: 99 };
    },
    appends,
  };
}

test("archivePrunedResults writes a redacted archive + handle tail", () => {
  const removedBody = ("secret sk_live_" + "abcdefghijklmnop1234567890 here").repeat(1);
  const content = [
    { type: "text", text: "H".repeat(200) },
    { type: "text", text: removedBody },
    { type: "text", text: "T".repeat(100) },
  ];
  const session = fakeSession(content);
  const report = {
    pruned: [
      {
        callId: "bash-abc123",
        originalSeq: 5,
        replacementSeq: 42,
        charsBefore: 10000,
        charsAfter: 400,
        headChars: 200,
        tailChars: 100,
      },
    ],
    charsRemoved: 9600,
  };
  const warns = [];
  const n = archivePrunedResults({ dir, session, report, workspace: "/ws", log: { warn: (x) => warns.push(x) } });
  assert.equal(n, 1);

  const archived = readArchived(dir, "bash-abc123");
  assert.ok(archived, "archive readable");
  assert.equal(archived.callId, "bash-abc123");
  assert.equal(archived.workspace, "/ws");
  // Redacted: the live stripe key shape must never be persisted.
  assert.ok(!archived.removed.includes("sk-live-"), "secret redacted from archive");
  assert.ok(archived.removed.includes("<REDACTED:stripe>"), "redaction marker present");
  assert.ok(archived.removed.length > 0);

  // Handle appended through the host surface-replace protocol.
  assert.equal(session.appends.length, 1);
  const a = session.appends[0];
  assert.equal(a.type, "tool/result");
  assert.equal(a.meta.surfaceOp.op, "replace");
  assert.equal(a.meta.surfaceOp.startSeq, 42);
  assert.equal(a.meta.sourceEventSeqs[0], 42);
  const tailText = a.data.message.content.at(-1).text;
  assert.ok(tailText.includes("result_recall(bash-abc123)"), `handle tail references callId`);
});

test("archivePrunedResults is contained: bad session never throws", () => {
  const bad = {
    eventAt: () => null,
    deriveEventMessage: () => null,
    append: () => {
      throw new Error("nope");
    },
  };
  const report = { pruned: [{ callId: "x", originalSeq: 1, replacementSeq: 2 }] };
  assert.doesNotThrow(() => archivePrunedResults({ dir, session: bad, report, log: { warn: () => {} } }));
});

test("archivePrunedResults skips empty reports and missing callIds", () => {
  assert.equal(archivePrunedResults({ dir, session: fakeSession([]), report: {}, log: { warn: () => {} } }), 0);
  assert.equal(
    archivePrunedResults({
      dir,
      session: fakeSession([{ type: "text", text: "x".repeat(1000) }]),
      report: { pruned: [{ originalSeq: 5, replacementSeq: 1 }] }, // no callId
      log: { warn: () => {} },
    }),
    0,
  );
});

test("archive survives across reads (metadata round-trip)", () => {
  const content = [{ type: "text", text: "Z".repeat(500) }];
  const session = fakeSession(content, { sessionId: "sess-meta", cwd: "/other" });
  const report = { pruned: [{ callId: "read-id", originalSeq: 5, replacementSeq: 3, headChars: 100, tailChars: 50 }] };
  archivePrunedResults({ dir, session, report, workspace: "/other", log: { warn: () => {} } });
  const rec = readArchived(dir, "read-id");
  assert.equal(rec.sessionId, "sess-meta");
  assert.equal(rec.workspace, "/other");
  assert.equal(rec.originalSeq, 5);
});

// ── paging ─────────────────────────────────────────────────────────────────

test("pageArchived pages by char budget", () => {
  const archived = { callId: "c1", removed: "x".repeat(10000) };
  const p0 = pageArchived(archived, 0, 4000);
  assert.equal(p0.total, 3);
  assert.equal(p0.page, 1);
  assert.equal(p0.text.length, 4000);
  assert.ok(p0.hasMore);
  const p1 = pageArchived(archived, 1, 4000);
  assert.equal(p1.page, 2);
  assert.ok(p1.hasMore);
  const p2 = pageArchived(archived, 2, 4000);
  assert.equal(p2.page, 3);
  assert.equal(p2.hasMore, false);
  assert.equal(p2.text.length, 2000);
});

test("pageArchived clamps out-of-range and negative offsets", () => {
  const archived = { callId: "c2", removed: "y".repeat(100) };
  assert.equal(pageArchived(archived, 99, 4000).page, 1);
  assert.equal(pageArchived(archived, -5, 4000).page, 1);
  assert.equal(pageArchived(archived, "x", 4000).page, 1);
});

test("pageArchived handles empty/missing", () => {
  const r = pageArchived({ callId: "c3", removed: "" }, 0, 4000);
  assert.equal(r.total, 1);
  assert.equal(r.text, "");
  assert.equal(r.hasMore, false);
});

// ── result_recall tool ─────────────────────────────────────────────────────

test("result_recall returns a page and guides further paging", async () => {
  const content = [{ type: "text", text: "R".repeat(9000) }];
  const session = fakeSession(content);
  archivePrunedResults({ dir, session, report: { pruned: [{ callId: "tool-recall", originalSeq: 5, replacementSeq: 1, headChars: 100, tailChars: 50, charsBefore: 9000 }] }, workspace: "/ws", log: { warn: () => {} } });
  const tool = resultRecallTool(dir, 2000);
  const out = await tool.execute({ callId: "tool-recall" });
  assert.ok(out.startsWith("result_recall tool-recall · page 1/5"));
  assert.ok(out.includes("offset=1 取下一页"));
  assert.ok(out.includes("RRRR"));
  const out2 = await tool.execute({ callId: "tool-recall", offset: 4 });
  assert.ok(out2.startsWith("result_recall tool-recall · page 5/5"));
  assert.ok(!out2.includes("取下一页"));
});

test("result_recall reports missing archives", async () => {
  const tool = resultRecallTool(dir, DEFAULT_PAGE_CHARS);
  const out = await tool.execute({ callId: "ghost" });
  assert.ok(out.includes("no archived middle for callId ghost"));
});

test("result_recall validates callId", async () => {
  const tool = resultRecallTool(dir, DEFAULT_PAGE_CHARS);
  assert.ok((await tool.execute({})).includes("callId is required"));
});

// ── retention sweep ────────────────────────────────────────────────────────

test("sweepExpired removes only mtime-expired archives", async () => {
  const now = Date.now();
  const keepDir = path.join(tmpRoot, "sweep");
  fs.mkdirSync(keepDir, { recursive: true });
  const fresh = path.join(keepDir, "fresh.json");
  const old = path.join(keepDir, "old.json");
  fs.writeFileSync(fresh, "{}");
  fs.writeFileSync(old, "{}");
  const past = now - (10 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, new Date(past), new Date(past));

  assert.equal(sweepExpired(keepDir, 7), 1);
  assert.ok(fs.existsSync(fresh));
  assert.ok(!fs.existsSync(old));

  // Missing/empty dir is a no-op, never throws.
  assert.equal(sweepExpired(path.join(tmpRoot, "nope"), 7), 0);
  assert.equal(sweepExpired(TMP_NEVER, 7), 0);
});
