/**
 * dsh-engram usage-observability tests — recall-output parsing, daily rollups,
 * and the /stats route ratios (real ESR-proactivity / recall-hit metrics).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openEngramDomain } from "../lib/store.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";
import { collectUsageStats, dayKey, recallStatsFromOutput } from "../lib/usage.js";

const CONFIG = {
  autoCapture: true,
  sessionSearch: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

test("dayKey renders local YYYY-MM-DD", () => {
  assert.match(dayKey(new Date(2026, 7, 20, 15, 40).getTime()), /^2026-08-20$/);
});

test("recallStatsFromOutput counts item lines and zero-hit messages", () => {
  const hits = recallStatsFromOutput(["# recall: \"build\" (3)", "- 3b9840b5 [decision] build…", "- 747cfa3b [procedure] release…", "- 885febb6 [error] npm…"].join("\n"));
  assert.deepEqual(hits, { withHits: 1, hitsTotal: 3 });
  const zero = recallStatsFromOutput("no active memories match \"xyz\" in this workspace");
  assert.deepEqual(zero, { withHits: 0, hitsTotal: 0 });
  const entityZero = recallStatsFromOutput('no memories for entity "ent_x" in this workspace');
  assert.deepEqual(entityZero, { withHits: 0, hitsTotal: 0 });
  const timeline = recallStatsFromOutput(["# timeline: ent_db", "- a [fact] one", "- b [fact] two"].join("\n"));
  assert.deepEqual(timeline, { withHits: 1, hitsTotal: 2 });
});

/** Write one zstd-compressed session log under a temp sessions root. */
function seedSession(root, bucket, sid, lines, mtimeMs = Date.now()) {
  const dir = path.join(root, bucket, sid);
  fs.mkdirSync(dir, { recursive: true });
  const plain = path.join(dir, "session.jsonl");
  fs.writeFileSync(plain, lines.join("\n") + "\n");
  const out = path.join(dir, "session.jsonl.zstd");
  execFileSync("zstd", ["-q", "-f", plain, "-o", out]);
  fs.rmSync(plain);
  fs.utimesSync(out, new Date(mtimeMs), new Date(mtimeMs));
  return out;
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-usage-"));
}

const R = (callId, isError, text) =>
  JSON.stringify({ type: "tool/result", data: { message: { content: [{ type: "tool-result", toolCallId: callId, isError, content: text === undefined ? [] : [{ type: "text", text }] }] } } });
const C = (name, callId) => JSON.stringify({ type: "tool/call", data: { name, callId } });
const USAGE_FIXTURE = [
  JSON.stringify({ type: "session", cwd: "/ws/a", id: "s1" }),
  C("engram_store", "c1"),
  R("c1", false, "stored memory abc"),
  C("engram_recall", "c2"),
  R("c2", false, '# recall: "build" (2)\n- 3b9840b5 [error] fix build\n- 747cfa3b [fact] cache'),
  C("engram_detail", "c3"),
  R("c3", true),
  C("esr_node", "c4"),
  R("c4", false),
  C("esr_task", "c5"),
  R("c5", false),
];

test("collectUsageStats rebuilds the rollup from session logs (call+result pairing)", () => {
  const root = makeRoot();
  seedSession(root, "--p--", "s1", USAGE_FIXTURE);
  const r = collectUsageStats({ root, days: 14 });
  assert.equal(r.files, 1);
  assert.equal(r.events, 5);
  const row = r.rows.find((x) => x.workspace === "/ws/a");
  assert.ok(row, "row for the session workspace");
  assert.equal(row.counts.engram_store, 1);
  assert.equal(row.counts.engram_recall, 1);
  assert.equal(row.counts.engram_detail, 1);
  assert.equal(row.counts.esr_node, 1);
  assert.equal(row.failures, 1, "the errored engram_detail result");
  assert.equal(row.recall.queries, 1);
  assert.equal(row.recall.withHits, 1, "recall output had hit lines");
  assert.equal(row.recall.hitsTotal, 2);
  assert.equal(row.recall.detailFollows, 1, "detail within 8 events of a hit recall");
});

test("collectUsageStats caches within TTL", () => {
  const root = makeRoot();
  seedSession(root, "--c--", "s1", USAGE_FIXTURE);
  const t0 = Date.now();
  const a = collectUsageStats({ root, days: 14, now: t0 });
  const b = collectUsageStats({ root, days: 14, now: t0 + 30_000 });
  assert.equal(a.cachedAt, b.cachedAt);
  const c = collectUsageStats({ root, days: 14, now: t0 + 120_000 });
  assert.ok(c.cachedAt > a.cachedAt);
  assert.equal(c.events, 5);
});

test("bumpUsage merges per-tool counts, failures, recall across days and workspaces", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const d1 = dayKey(new Date(2026, 7, 20).getTime());
  const d2 = dayKey(new Date(2026, 7, 21).getTime());
  await domain.bumpUsage("/ws/a", d1, { counts: { engram_store: 1, esr_task: 1 }, failures: 0, recall: { queries: 1, withHits: 1, hitsTotal: 2 } });
  await domain.bumpUsage("/ws/a", d1, { counts: { esr_node: 2 }, failures: 1, recall: { queries: 1, hitsTotal: 5 } });
  await domain.bumpUsage("/ws/b", d2, { counts: { engram_recall: 1 }, failures: 0, recall: {} });
  const all = domain.usageRows();
  // two bumps on the same (workspace, day) merge into ONE row; /ws/b adds another
  assert.equal(all.length, 2);
  const a1 = all.find((r) => r.workspace === "/ws/a" && r.day === d1);
  assert.equal(a1.counts.engram_store, 1);
  assert.equal(a1.counts.esr_task, 1);
  assert.equal(a1.counts.esr_node, 2);
  assert.equal(a1.failures, 1);
  assert.equal(a1.recall.queries, 2);
  assert.equal(a1.recall.withHits, 1);
  assert.equal(a1.recall.hitsTotal, 7);
  assert.equal(domain.usageRows("/ws/a").length, 1); // one merged row
  assert.equal(domain.usageRows("/ws/b").length, 1);
});

test("api: /stats returns ratios computed from the session log stream", async () => {
  const root = makeRoot();
  seedSession(root, "--p--", "s1", USAGE_FIXTURE);
  const service = {
    config: CONFIG,
    statsRoot: root,
    openedDomain: () => undefined,
    getDomain: () => Promise.resolve(undefined),
  };
  const routes = makeEngramRoutes(service);
  const handler = routes.find((r) => r.path === `${API_PREFIX}/stats` && (r.method === void 0 || r.method === "GET"));
  assert.ok(handler, "/stats route registered");
  const r = res();
  await handler.handler(req({ url: `${API_PREFIX}/stats?workspace=/ws/a` }), r);
  assert.equal(r._out.status, 200);
  const body = JSON.parse(r._out.body);
  assert.equal(body.ratios.esrCalls, 2);
  assert.equal(body.ratios.memCalls, 3);
  assert.equal(body.ratios.calls, 5);
  assert.equal(body.ratios.esrRatio, 0.4);
  assert.equal(body.ratios.recallHitRate, 1);
  assert.equal(body.ratios.recallHitsPerQuery, 2);
  assert.equal(body.ratios.detailFollowRate, 1);
  assert.equal(body.totals.failures, 1);
  assert.equal(body.workspace, "/ws/a");
  assert.ok(Array.isArray(body.byDay) && body.byDay[0].day === dayKey(), "byDay is a reverse-chron list");
});

/** Loopback request stand-in (mirrors api.test.mjs helpers). */
function req({ method = "GET", url = "/", remoteAddress = "127.0.0.1", host = "127.0.0.1:3080", body } = {}) {
  const stream = new Readable();
  stream._read = () => {};
  stream.method = method;
  stream.url = url;
  stream.socket = { remoteAddress };
  stream.headers = { host };
  if (body !== undefined) stream.push(JSON.stringify(body));
  stream.push(null);
  return stream;
}

function res() {
  const out = { status: null, body: null };
  return {
    _out: out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    end(payload) {
      out.body = payload;
    },
  };
}