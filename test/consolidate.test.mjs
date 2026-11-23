/**
 * Offline memory consolidation tests (lib/consolidate.js + API + CLI).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";

import { openEngramDomain } from "../lib/store.js";
import { applyConsolidation, formatConsolidationPlan, planConsolidation } from "../lib/consolidate.js";
import { API_PREFIX, makeEngramRoutes } from "../lib/api.js";

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

const CONFIG = {
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

test("planConsolidation clusters near-duplicates within kind+entity and protects working-set refs", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const m1 = await domain.storeMemory({
    workspace: "/w",
    kind: "decision",
    entity: "ent_db",
    text: "Use sqlite-vec for local vector search over pgvector to stay zero-infra",
    tags: ["db", "sqlite-vec"],
    signal: 0.85,
  }, CONFIG);
  const m2 = await domain.storeMemory({
    workspace: "/w",
    kind: "decision",
    entity: "ent_db",
    text: "Use sqlite-vec for local vector search over pgvector to stay zero-infra in prod",
    tags: ["db", "prod"],
    signal: 0.6,
  }, CONFIG);
  const mProtected = await domain.storeMemory({
    workspace: "/w",
    kind: "decision",
    entity: "ent_db",
    text: "Use sqlite-vec for local vector search over pgvector to stay zero-infra today",
    tags: ["db"],
    signal: 0.5,
  }, CONFIG);
  // Different kind — must NOT merge with decisions
  await domain.storeMemory({
    workspace: "/w",
    kind: "fact",
    entity: "ent_db",
    text: "Use sqlite-vec for local vector search over pgvector to stay zero-infra",
    tags: ["db"],
    signal: 0.7,
  }, CONFIG);

  // Pin mProtected to an active task → must become winner (never archived)
  await domain.putTask({
    id: "tsk_1",
    workspace: "/w",
    name: "db task",
    description: "",
    state: "active",
    artifact: null,
    evaluation: null,
    memoryRefs: [mProtected.id],
    sessionId: "s",
    createdAt: 1,
    updatedAt: 1,
    stateChangedAt: 0,
    archivedAt: null,
    deps: [],
    assignee: null,
    claimedAt: null,
  });

  const plan = planConsolidation(domain, "/w");
  assert.equal(plan.summary.clusters, 1);
  assert.equal(plan.merges[0].winner.id, mProtected.id, "working-set memory wins and is never archived");
  assert.deepEqual(
    plan.merges[0].duplicates.map((d) => d.id).sort(),
    [m1.id, m2.id].sort(),
  );
  assert.ok(plan.merges[0].mergedTags.includes("sqlite-vec"));
  assert.ok(plan.merges[0].mergedTags.includes("prod"));

  // Dry-run does not mutate
  const dry = await applyConsolidation(domain, "/w", plan, { dryRun: true });
  assert.equal(dry.applied, false);
  assert.equal(domain.listMemories("/w", 50).length, 4);

  // Real apply archives duplicates only (never hard-deletes)
  const applied = await applyConsolidation(domain, "/w", plan, { config: CONFIG });
  assert.equal(applied.applied, true);
  assert.equal(applied.archivedIds.length, 2);
  assert.equal(domain.listMemories("/w", 50).length, 2, "protected winner + separate fact survive");
  assert.equal(domain.getMemory("/w", m1.id), undefined, "archived duplicate leaves active view");
  assert.equal(domain.exportAll("/w").memories.find((m) => m.id === m1.id)?.status, "archived", "archive-only preserves retrievability");
  await domain.close();
});

test("planConsolidation rolls up recurring episode cues and stays idempotent after apply", async () => {
  const domain = await openEngramDomain(fakeFacility());
  for (let i = 1; i <= 3; i += 1) {
    await domain.storeMemory({
      workspace: "/w",
      kind: "episode",
      text: `Session ${i}: touched lib/store.js; npm-test×2→fixed`,
      tags: ["episode", "auto-captured"],
      signal: 0.4,
    }, CONFIG);
  }
  const plan = planConsolidation(domain, "/w");
  assert.ok(plan.summary.rollupCount >= 2, "detects both recurring fix and hotspot file");
  assert.ok(plan.episodeRollups.some((r) => r.kind === "procedure" && r.text.includes("npm-test")));
  assert.ok(plan.episodeRollups.some((r) => r.kind === "insight" && r.text.includes("lib/store.js")));
  assert.match(formatConsolidationPlan(plan), /DRY-RUN/);

  const res = await applyConsolidation(domain, "/w", plan, { config: CONFIG });
  assert.equal(res.createdIds.length, plan.summary.rollupCount);

  // Second run sees existing consolidated rollups → 0 new rollups
  const second = planConsolidation(domain, "/w");
  assert.equal(second.summary.rollupCount, 0);
  await domain.close();
});

test("applyConsolidation supports optional LLM summarizeCluster seam", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const a = await domain.storeMemory({ workspace: "/w", kind: "fact", text: "Redis cache TTL is 300 seconds in staging", tags: ["cache"], signal: 0.8 }, CONFIG);
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "Redis cache TTL is 300 seconds in staging env", tags: ["cache"], signal: 0.5 }, CONFIG);

  const plan = planConsolidation(domain, "/w");
  const out = await applyConsolidation(domain, "/w", plan, {
    config: CONFIG,
    summarizeCluster: async () => "Redis staging cache TTL is 300s (consolidated).",
  });
  assert.equal(out.createdIds.length, 1);
  assert.equal(out.archivedIds.length, 1);
  assert.equal(domain.getMemory("/w", out.createdIds[0]).supersedes, a.id);
  await domain.close();
});

test("POST /api/dsh-engram/consolidate defaults to dry-run and applies when apply:true", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "Deploy requires node 22 lts runtime", tags: ["ops"], signal: 0.8 }, CONFIG);
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "Deploy requires node 22 lts runtime always", tags: ["ops"], signal: 0.5 }, CONFIG);

  const service = { config: CONFIG, captureStats: { total: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);
  const handler = routes.find((r) => r.path === `${API_PREFIX}/consolidate` && r.method === "POST").handler;

  const call = async (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = "POST";
    req.url = `${API_PREFIX}/consolidate`;
    req.headers = { host: "127.0.0.1:3080" };
    req.socket = { remoteAddress: "127.0.0.1" };
    const res = { _out: null, writeHead(status, headers) { this._status = status; this._headers = headers; }, end(text) { this._out = { status: this._status, text }; } };
    await handler(req, res);
    return { status: res._out.status, body: JSON.parse(res._out.text) };
  };

  const dry = await call({ workspace: "/w" });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.applied, false);
  assert.equal(dry.body.plan.summary.duplicateCount, 1);
  assert.equal(domain.listMemories("/w", 20).length, 2);

  const run = await call({ workspace: "/w", apply: true });
  assert.equal(run.status, 200);
  assert.equal(run.body.applied, true);
  assert.equal(run.body.archivedIds.length, 1);
  assert.equal(domain.listMemories("/w", 20).length, 1);
  await domain.close();
});

test("CLI `dsh-engram consolidate` runs dry-run by default and persists on --apply", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "engram-consolidate-"));
  try {
    const storages = path.join(home, "storages");
    fs.mkdirSync(storages, { recursive: true });
    const ws = path.resolve(home, "proj");
    const wsKey = process.platform === "win32" ? ws.toLowerCase() : ws;
    const storageFile = path.join(storages, "dsh_engram.json");
    fs.writeFileSync(storageFile, JSON.stringify({
      version: 1,
      tables: {
        memories: {
          m1: { id: "m1", workspace: wsKey, kind: "fact", text: "Build uses esbuild bundler for client output", tags: ["build"], entity: null, sessionId: "s", signal: 0.8, hits: 1, status: "active", supersededBy: null, createdAt: 100, updatedAt: 100, expiresAt: null },
          m2: { id: "m2", workspace: wsKey, kind: "fact", text: "Build uses esbuild bundler for client output files", tags: ["build"], entity: null, sessionId: "s", signal: 0.5, hits: 0, status: "active", supersededBy: null, createdAt: 90, updatedAt: 90, expiresAt: null },
        },
        tasks: {},
        links: {},
        entities: {},
        usage: {},
      },
    }), "utf8");

    const cli = path.resolve("scripts/dsh-engram.mjs");
    const dryOut = execFileSync(process.execPath, [cli, "consolidate", "--home", home, "--workspace", ws], { encoding: "utf8" });
    assert.match(dryOut, /DRY-RUN/);
    assert.match(dryOut, /1 redundant memories to archive/);
    assert.equal(JSON.parse(fs.readFileSync(storageFile, "utf8")).tables.memories.m2.status, "active");

    const applyOut = execFileSync(process.execPath, [cli, "consolidate", "--home", home, "--workspace", ws, "--apply"], { encoding: "utf8" });
    assert.match(applyOut, /APPLIED/);
    assert.equal(JSON.parse(fs.readFileSync(storageFile, "utf8")).tables.memories.m2.status, "archived");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
