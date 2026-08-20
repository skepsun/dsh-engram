/**
 * dsh-engram GC tests — pi-esr-flavoured memory garbage collection:
 * working-set protection, TTL expiry, over-cap eviction, stable-task
 * retention, dangling-link removal, dry-run no-op, and the /gc API route.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { openEngramDomain } from "../lib/store.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";

const CONFIG = {
  promoteHits: 3,
  maxMemoriesPerWorkspace: 2000,
  gcStableRetentionDays: 30,
  gcEnabled: true,
  gcIntervalHours: 24,
  expireDays: 180,
  maxMemoryChars: 1600,
};
const DAY = 24 * 60 * 60 * 1000;

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

async function seed(domain, ws = "/w") {
  const now = Date.now();
  await domain.storeMemory({ workspace: ws, kind: "fact", text: "expired one", tags: [], sessionId: "s1", expiresAt: now - 1 }, CONFIG);
  await domain.storeMemory({ workspace: ws, kind: "fact", text: "live one", tags: [], sessionId: "s1" }, CONFIG);
  await domain.putTask({
    id: "tsk_active", workspace: ws, name: "active work", state: "active",
    memoryRefs: [], sessionId: "s1", createdAt: now, updatedAt: now, stateChangedAt: now,
  });
}

test("gc: archives TTL-expired memories, keeps the working set", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const decision = await domain.storeMemory({ workspace: ws, kind: "decision", text: "protected — pointed at by an active task", tags: [], sessionId: "s1" }, CONFIG);
  // working set: an ACTIVE task carries the decision id in its memoryRefs
  await domain.putTask({
    id: "tsk_active", workspace: ws, name: "active work", state: "active",
    memoryRefs: [decision.id], sessionId: "s1", createdAt: Date.now(), updatedAt: Date.now(), stateChangedAt: Date.now(),
  });
  await domain.storeMemory({ workspace: ws, kind: "fact", text: "expired one", tags: [], sessionId: "s1", expiresAt: Date.now() - 1 }, CONFIG);
  await domain.storeMemory({ workspace: ws, kind: "fact", text: "live one", tags: [], sessionId: "s1" }, CONFIG);

  const report = await domain.gc(ws, CONFIG, { dryRun: false });

  const reasons = report.archivedMemories.map((e) => e.reason);
  assert.ok(reasons.includes("expired"), `expired memory archived: ${JSON.stringify(report)}`);
  assert.ok(!report.archivedMemories.some((e) => e.id === decision.id), "working-set memory must be protected");
  assert.equal(report.protectedMemories, 1, "exactly the decision memory is protected");
  // archived stays retrievable via the archived filter (archive-only promise)
  const archived = domain.searchMemories({ workspace: ws, status: "archived" });
  assert.ok(archived.some((m) => m.text.includes("expired")), "archived memory still readable");
});

test("gc: over-cap eviction protects indexed hits and task memories", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const seedCfg = { ...CONFIG, maxMemoriesPerWorkspace: 2000 };
  for (let i = 0; i < 4; i += 1) {
    await domain.storeMemory({ workspace: ws, kind: "fact", text: `low value ${i}`, tags: [], sessionId: "s1" }, seedCfg);
  }
  // one high-value memory: promoted into the index (hits >= promoteHits)
  const [promoted] = domain.listMemories(ws, 200).slice(0, 1);
  await domain.touchMemory(ws, promoted.id);
  await domain.touchMemory(ws, promoted.id);
  await domain.touchMemory(ws, promoted.id);

  const cfg = { ...CONFIG, maxMemoriesPerWorkspace: 3 };
  const report = await domain.gc(ws, cfg, { dryRun: false });

  assert.equal(report.protectedMemories, 1);
  const active = domain.listMemories(ws, 200);
  assert.equal(active.length, 3, "evicted down to the cap");
  assert.ok(active.some((m) => m.id === promoted.id), "indexed hit must survive");
  const evicted = report.archivedMemories.filter((e) => e.reason === "cap");
  assert.equal(evicted.length, 1, "one low-value memory evicted for the cap");
});

test("gc: stable tasks past retention are archived and leave the surface", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const now = Date.now();
  await domain.putTask({
    id: "tsk_old", workspace: ws, name: "long closed work", state: "stable",
    artifact: "a", evaluation: "e", memoryRefs: ["m1"],
    sessionId: "s1", createdAt: now - 200 * DAY, updatedAt: now - 40 * DAY, stateChangedAt: now - 40 * DAY,
  });
  await domain.putTask({
    id: "tsk_fresh", workspace: ws, name: "recently closed", state: "stable",
    artifact: "a", evaluation: "e", memoryRefs: ["m2"],
    sessionId: "s1", createdAt: now - 5 * DAY, updatedAt: now - 2 * DAY, stateChangedAt: now - 2 * DAY,
  });

  const report = await domain.gc(ws, CONFIG, { dryRun: false });

  assert.deepEqual(report.archivedTasks.map((t) => t.id), ["tsk_old"]);
  assert.equal(domain.listTasks(ws, { includeStable: true }).some((t) => t.id === "tsk_old"), false, "archived task hidden from listTasks");
  assert.equal(domain.listTasks(ws, { includeStable: true }).some((t) => t.id === "tsk_fresh"), true);
  // archiveTask is idempotent on an already-archived task
  assert.equal(await domain.archiveTask(ws, "tsk_old"), false);
});

test("gc: removes only fully-dangling links", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  const now = Date.now();
  await domain.putTask({
    id: "tsk_alive", workspace: ws, name: "surviving task", state: "active",
    memoryRefs: [], sessionId: "s1", createdAt: now, updatedAt: now, stateChangedAt: now,
  });
  await domain.addLink({ id: "l1", workspace: ws, source: "ghost-a", relation: "depends_on", target: "ghost-b", confidence: 1, sessionId: "s1", createdAt: now });
  await domain.addLink({ id: "l2", workspace: ws, source: "tsk_alive", relation: "depends_on", target: "ghost-b", confidence: 1, sessionId: "s1", createdAt: now });

  const report = await domain.gc(ws, CONFIG, { dryRun: false });

  assert.deepEqual(report.removedLinks.map((l) => l.id), ["l1"], "only the fully-dangling link is removed");
  assert.equal(domain.allLinks(ws).length, 1);
  assert.equal(domain.allLinks(ws)[0].id, "l2", "link with one live endpoint survives");
});

test("gc: dryRun mutates nothing", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const ws = "/w";
  await seed(domain, ws); // 1 expired + 1 live
  const before = domain.listMemories(ws, 200).length;
  const report = await domain.gc(ws, CONFIG, { dryRun: true });
  assert.equal(report.dryRun, true);
  assert.ok(report.archivedMemories.length >= 1, "dry-run still reports candidates");
  assert.equal(domain.listMemories(ws, 200).length, before, "nothing archived in dry-run");
});

test("api: POST /gc returns a report and updates gcStats (except in dryRun)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seed(domain, "/w");
  const service = {
    config: CONFIG,
    openedDomain: () => domain,
    getDomain: () => Promise.resolve(domain),
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    gcStats: { lastRun: 0, archivedMemories: 0, archivedTasks: 0, removedLinks: 0 },
  };
  const routes = makeEngramRoutes(service);
  const stream = new Readable();
  stream._read = () => {};
  stream.method = "POST";
  stream.url = `${API_PREFIX}/gc`;
  stream.socket = { remoteAddress: "127.0.0.1" };
  stream.headers = { host: "127.0.0.1:3080" };
  stream.push(JSON.stringify({ workspace: "/w", dryRun: true }));
  stream.push(null);
  const out = { status: null, body: null };
  const r = {
    _out: out,
    writeHead(status, headers) { out.status = status; out.headers = headers; },
    end(payload) { out.body = payload; },
  };
  await route(routes, `${API_PREFIX}/gc`).handler(stream, r);
  assert.equal(out.status, 200);
  const dry = JSON.parse(out.body);
  assert.equal(dry.report.dryRun, true);
  assert.ok(dry.report.archivedMemories.length >= 1);
  assert.equal(service.gcStats.lastRun, 0, "dry-run must not bump gcStats");

  // real run
  const stream2 = new Readable();
  stream2._read = () => {};
  stream2.method = "POST";
  stream2.url = `${API_PREFIX}/gc`;
  stream2.socket = { remoteAddress: "127.0.0.1" };
  stream2.headers = { host: "127.0.0.1:3080" };
  stream2.push(JSON.stringify({ workspace: "/w" }));
  stream2.push(null);
  const out2 = { status: null, body: null };
  const r2 = {
    _out: out2,
    writeHead(status, headers) { out2.status = status; out2.headers = headers; },
    end(payload) { out2.body = payload; },
  };
  await route(routes, `${API_PREFIX}/gc`).handler(stream2, r2);
  assert.equal(out2.status, 200);
  assert.ok(service.gcStats.lastRun > 0, "real run updates gcStats.lastRun");
  assert.ok(service.gcStats.archivedMemories >= 1);
});

function route(routes, path) {
  return routes.find((r) => r.path === path);
}
