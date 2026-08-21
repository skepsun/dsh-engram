/**
 * dsh-engram session-log usage rollup tests — tool-call counting over the
 * canonical session stream, mtime windowing, and the /toolstats route.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectToolCounts } from "../lib/usage.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";

const DAY = 86_400_000;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sessionstats-"));
}

const SAMPLES = [
  '{"type":"tool/call","data":{"name":"todo_write"}}',
  '{"type":"tool/call","data":{"name":"esr_task"}}',
  '{"type":"tool/call","data":{"name":"esr_task"}}',
  '{"type":"tool/call","data":{"name":"engram_store"}}',
  '{"type":"tool/call","data":{"name":"run_code"}}',
  '{"type":"other","data":{"name":"todo_write"}}', // NOT a tool/call → ignored
];

test("collectToolCounts counts type:tool/call events by tool name (todo included)", () => {
  const root = makeRoot();
  seedSession(root, "--proj-a--", "s1", SAMPLES);
  const r = collectToolCounts({ root, days: 14 });
  assert.equal(r.files, 1);
  assert.equal(r.events, 5);
  assert.equal(r.tools.todo_write, 1);
  assert.equal(r.tools.esr_task, 2);
  assert.equal(r.tools.engram_store, 1);
  assert.equal(r.tools.run_code, 1);
  assert.equal(r.tools.other, undefined); // non tool/call excluded
  assert.ok(r.buckets["--proj-a--"], "bucket rollup present");
  assert.equal(r.buckets["--proj-a--"].esr_task, 2);
});

test("collectToolCounts filters files older than the window by mtime", () => {
  const root = makeRoot();
  const now = Date.now();
  seedSession(root, "--old--", "sA", SAMPLES, now - 30 * DAY); // outside 14d
  seedSession(root, "--new--", "sB", SAMPLES, now - 2 * DAY);
  const r = collectToolCounts({ root, days: 14, now });
  assert.equal(r.files, 1);
  assert.equal(r.events, 5);
  assert.equal(r.tools.todo_write, 1); // only the fresh bucket counted
  assert.deepEqual(Object.keys(r.buckets), ["--new--"]);
});

test("collectToolCounts caches within TTL and recomputes after expiry", () => {
  const root = makeRoot();
  seedSession(root, "--c--", "s1", SAMPLES);
  const t0 = Date.now();
  const a = collectToolCounts({ root, days: 14, now: t0 });
  const b = collectToolCounts({ root, days: 14, now: t0 + 30_000 }); // < 60s TTL
  assert.equal(a.cachedAt, b.cachedAt, "serve from cache");
  const c = collectToolCounts({ root, days: 14, now: t0 + 120_000 }); // > TTL
  assert.ok(c.cachedAt > a.cachedAt, "recomputed after TTL");
  assert.equal(c.events, 5);
});

test("api: /toolstats route registered under the guard", () => {
  const service = {
    config: {},
    openedDomain: () => undefined,
    getDomain: () => Promise.resolve(undefined),
  };
  const routes = makeEngramRoutes(service);
  const route = routes.find((r) => r.path === `${API_PREFIX}/toolstats`);
  assert.ok(route, "/toolstats route registered");
  assert.equal(route.method, "GET");
  assert.equal(typeof route.handler, "function");
});
