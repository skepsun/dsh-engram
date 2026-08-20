/**
 * dsh-loom usage-observability tests — recall-output parsing, daily rollups,
 * and the /stats route ratios (real ESR-proactivity / recall-hit metrics).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { openLoomDomain } from "../lib/store.js";
import { makeLoomRoutes, API_PREFIX } from "../lib/api.js";
import { dayKey, recallStatsFromOutput } from "../lib/usage.js";

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

test("bumpUsage merges per-tool counts, failures, recall across days and workspaces", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const d1 = dayKey(new Date(2026, 7, 20).getTime());
  const d2 = dayKey(new Date(2026, 7, 21).getTime());
  await domain.bumpUsage("/ws/a", d1, { counts: { loom_store: 1, esr_task: 1 }, failures: 0, recall: { queries: 1, withHits: 1, hitsTotal: 2 } });
  await domain.bumpUsage("/ws/a", d1, { counts: { esr_node: 2 }, failures: 1, recall: { queries: 1, hitsTotal: 5 } });
  await domain.bumpUsage("/ws/b", d2, { counts: { loom_recall: 1 }, failures: 0, recall: {} });
  const all = domain.usageRows();
  // two bumps on the same (workspace, day) merge into ONE row; /ws/b adds another
  assert.equal(all.length, 2);
  const a1 = all.find((r) => r.workspace === "/ws/a" && r.day === d1);
  assert.equal(a1.counts.loom_store, 1);
  assert.equal(a1.counts.esr_task, 1);
  assert.equal(a1.counts.esr_node, 2);
  assert.equal(a1.failures, 1);
  assert.equal(a1.recall.queries, 2);
  assert.equal(a1.recall.withHits, 1);
  assert.equal(a1.recall.hitsTotal, 7);
  assert.equal(domain.usageRows("/ws/a").length, 1); // one merged row
  assert.equal(domain.usageRows("/ws/b").length, 1);
});

test("api: /stats returns ratios from the usage rollup", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const day = dayKey();
  // 2 memory calls + 2 esr calls → esrRatio 0.5; 2 recall queries, 1 with hits
  await domain.bumpUsage("/ws/a", day, { counts: { loom_store: 1, loom_recall: 2, esr_node: 2, esr_task: 1 }, failures: 1, recall: { queries: 2, withHits: 1, hitsTotal: 4 } });
  const service = {
    config: CONFIG,
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    openedDomain: () => domain,
    getDomain: () => Promise.resolve(domain),
    renderIndexBlock: () => "[LOOM] workspace: a",
  };
  const routes = makeLoomRoutes(service);
  const handler = routes.find((r) => r.path === `${API_PREFIX}/stats` && (r.method === void 0 || r.method === "GET"));
  assert.ok(handler, "/stats route registered");
  const r = res();
  await handler.handler(req({ url: `${API_PREFIX}/stats?workspace=/ws/a` }), r);
  assert.equal(r._out.status, 200);
  const body = JSON.parse(r._out.body);
  assert.equal(body.ratios.esrCalls, 3);
  assert.equal(body.ratios.memCalls, 3);
  assert.equal(body.ratios.calls, 6);
  assert.equal(body.ratios.esrRatio, 0.5);
  assert.equal(body.ratios.recallHitRate, 0.5);
  assert.equal(body.ratios.recallHitsPerQuery, 2);
  assert.equal(body.totals.failures, 1);
  assert.equal(body.workspace, "/ws/a");
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