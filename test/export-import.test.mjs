/**
 * dsh-engram data-contract tests — `domain.exportAll` / `domain.importAll`
 * round-trip, idempotence, secret redaction on the import write path, cap/skip
 * reports and dry-run, plus the `/export` + `/import` web routes (including
 * the replace-mode `confirm` gate and the large-body import cap).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { openEngramDomain } from "../lib/store.js";
import { makeEngramRoutes, API_PREFIX } from "../lib/api.js";

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
  engramIndexOrder: 40,
  esrOrder: 41,
  verifyArtifact: false,
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

function req({ method = "GET", url = "/", remoteAddress = "127.0.0.1", host = "127.0.0.1:3080", origin, body } = {}) {
  const stream = new Readable();
  stream._read = () => {};
  stream.method = method;
  stream.url = url;
  stream.socket = { remoteAddress };
  stream.headers = { host };
  if (origin !== undefined) stream.headers.origin = origin;
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

const json = (r) => JSON.parse(r._out.body);

function route(routes, path, method = "GET") {
  return routes.find(
    (r) =>
      r.path === path &&
      (r.method === void 0 || r.method === method || (Array.isArray(r.method) && r.method.includes(method))),
  );
}

function serviceFor(domain) {
  return {
    config: CONFIG,
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    openedDomain: () => domain,
    getDomain: () => Promise.resolve(domain),
  };
}

async function seedWorkspace(domain, ws) {
  await domain.storeMemory({ workspace: ws, kind: "decision", text: "use json storage, api key = sk-proj-AbCdEf1234567890", tags: ["arch"], sessionId: "s1" }, CONFIG);
  await domain.storeMemory({ workspace: ws, kind: "fact", text: "node 22 chosen", tags: [], sessionId: "s1" }, CONFIG);
  await domain.putTask({
    id: `tsk_${ws.slice(-1)}`, workspace: ws, name: "upgrade", state: "active",
    artifact: null, evaluation: null, memoryRefs: [], sessionId: "s1", createdAt: 1, updatedAt: 1,
  });
  await domain.addLink({ id: `l_${ws.slice(-1)}`, workspace: ws, source: "a", relation: "depends_on", target: "b", sessionId: "s1", createdAt: 1 });
  await domain.putEntity({ id: `ent_${ws.slice(-1)}`, workspace: ws, name: "engine", description: "", kind: "service", sessionId: "s1", createdAt: 1, updatedAt: 1 });
}

// ── store-level contract ────────────────────────────────────────────────

test("export: dump is the four-table contract and includes archived rows", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  // Archive one memory — it must still be in the dump (backup never loses provenance).
  const [m] = domain.searchMemories({ workspace: "/w", q: "node" });
  await domain.archiveMemory("/w", m.id);
  const dump = domain.exportAll("/w");
  assert.equal(dump.meta.format, "dsh-engram/export");
  assert.equal(dump.meta.version, 1);
  assert.equal(dump.meta.workspace, "/w");
  assert.equal(dump.memories.length, 2);
  assert.equal(dump.tasks.length, 1);
  assert.equal(dump.links.length, 1);
  assert.equal(dump.entities.length, 1);
  assert.equal(dump.memories.find((x) => x.id === m.id).status, "archived");
  await domain.close();
});

test("export: without workspace dumps every workspace", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/a");
  await seedWorkspace(domain, "/b");
  const dump = domain.exportAll();
  assert.equal(dump.meta.workspace, null);
  assert.deepEqual(new Set(dump.memories.map((m) => m.workspace)), new Set(["/a", "/b"]));
  assert.deepEqual(new Set(dump.tasks.map((t) => t.workspace)), new Set(["/a", "/b"]));
  await domain.close();
});

test("import merge: idempotent round-trip, secrets redacted on the write path", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  const pre = domain.exportAll("/w");

  // Re-import into the SAME store: every row already exists → all skipped,
  // nothing duplicated (this is what makes restore/backup idempotent).
  const again = await domain.importAll(pre, { mode: "merge", config: CONFIG });
  assert.equal(again.written.memories, 0);
  assert.equal(again.written.tasks, 0);
  assert.equal(again.written.links, 0);
  assert.equal(again.written.entities, 0);
  assert.ok(again.skipped.length >= 4);
  assert.ok(again.skipped.every((s) => s.reason === "exists"));
  assert.equal(domain.exportAll("/w").memories.length, 2, "no duplicate memories after re-import");
  await domain.close();

  // Fresh store: import merges the dump. The memory whose text carried a
  // secret shape must land REDACTED — import honors the same choke point as
  // storeMemory, so a dump can never smuggle a raw key back onto disk.
  const fresh = await openEngramDomain(fakeFacility());
  const restored = await fresh.importAll(pre, { mode: "merge", config: CONFIG });
  assert.equal(restored.written.memories, 2);
  assert.equal(restored.written.tasks, 1);
  assert.equal(restored.written.links, 1);
  assert.equal(restored.written.entities, 1);
  const secret = fresh.searchMemories({ workspace: "/w", q: "json storage" })[0];
  assert.ok(!secret.text.includes("sk-proj-AbCdEf1234567890"), "imported text must be redacted");
  assert.ok(secret.text.includes("<REDACTED"), "imported text carries the redaction marker");
  await fresh.close();
});

test("import: bad rows are skipped with reasons, never abort the batch", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const dump = {
    meta: { format: "dsh-engram/export", version: 1 },
    memories: [
      { id: "m_ok", workspace: "/w", text: "fine", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "", workspace: "/w", text: "no id", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "m_empty", workspace: "/w", text: "   ", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "m_long", workspace: "/w", text: "x".repeat(2000), sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "m_nows", text: "no workspace", sessionId: "s", createdAt: 1, updatedAt: 1 },
    ],
    tasks: [{ id: "tsk_ok", workspace: "/w", name: "t", state: "active", sessionId: "s", createdAt: 1, updatedAt: 1 }],
  };
  const report = await domain.importAll(dump, { mode: "merge", config: CONFIG });
  assert.equal(report.written.memories, 1);
  assert.equal(report.written.tasks, 1);
  const reasons = report.skipped.map((s) => s.reason).sort();
  assert.deepEqual(reasons, ["empty text", "missing id", "missing workspace", "over maxMemoryChars"].sort());
  await domain.close();
});

test("import dryRun: identical plan, zero writes", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const dump = {
    meta: { format: "dsh-engram/export", version: 1 },
    memories: [{ id: "m1", workspace: "/w", text: "hello", sessionId: "s", createdAt: 1, updatedAt: 1 }],
    tasks: [{ id: "tsk1", workspace: "/w", name: "t", state: "active", sessionId: "s", createdAt: 1, updatedAt: 1 }],
  };
  const report = await domain.importAll(dump, { mode: "merge", dryRun: true, config: CONFIG });
  assert.equal(report.dryRun, true);
  assert.equal(report.written.memories, 1);
  assert.equal(report.written.tasks, 1);
  assert.equal(domain.listMemories("/w").length, 0, "dryRun must not write");
  assert.equal(domain.listTasks("/w").length, 0);
  await domain.close();
});

test("import replace: wipes the workspace then restores only its rows", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  await seedWorkspace(domain, "/other");
  const backup = domain.exportAll("/w");
  // Wipe /w by hand (simulating drift since the backup was taken).
  for (const m of domain.exportAll("/w").memories) await domain.deleteMemory("/w", m.id);
  assert.equal(domain.listMemories("/w").length, 0);

  const report = await domain.importAll(backup, { mode: "replace", workspace: "/w", config: CONFIG });
  assert.equal(report.written.memories, 2);
  const after = domain.exportAll("/w");
  assert.equal(after.memories.length, 2);
  assert.equal(after.tasks.length, 1);
  // The other workspace is untouched by a scoped replace.
  assert.equal(domain.exportAll("/other").memories.length, 2);
  await domain.close();
});

test("import replace: requires a workspace (invalid-args guard)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await assert.rejects(
    () => domain.importAll({ memories: [] }, { mode: "replace", config: CONFIG }),
    (err) => err.code === "ENGRAM_INVALID_ARGS",
  );
  await domain.close();
});

test("import merge: enforces the memory cap per workspace, not globally", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/other"); // 2 active memories in ANOTHER workspace
  const small = { ...CONFIG, maxMemoriesPerWorkspace: 2 };
  const dump = {
    meta: { format: "dsh-engram/export", version: 1 },
    memories: [
      { id: "cap_a", workspace: "/w", text: "a", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "cap_b", workspace: "/w", text: "b", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "cap_c", workspace: "/w", text: "c", sessionId: "s", createdAt: 1, updatedAt: 1 },
    ],
  };
  const report = await domain.importAll(dump, { mode: "merge", config: small });
  assert.equal(report.written.memories, 2, "two fit under the /w cap");
  assert.deepEqual(report.skipped.map((s) => s.reason), ["workspace memory cap"]);
  // The OTHER workspace's 2 active memories must not consume /w's budget.
  assert.equal(domain.searchMemories({ workspace: "/other", limit: 50 }).length, 2);
  await domain.close();
});

test("import replace: skips rows that belong to a different workspace", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const dump = {
    meta: { format: "dsh-engram/export", version: 1 },
    memories: [
      { id: "in", workspace: "/w", text: "in scope", sessionId: "s", createdAt: 1, updatedAt: 1 },
      { id: "out", workspace: "/other", text: "outside", sessionId: "s", createdAt: 1, updatedAt: 1 },
    ],
  };
  const report = await domain.importAll(dump, { mode: "replace", workspace: "/w", config: CONFIG });
  assert.equal(report.written.memories, 1);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "outside restored workspace");
  assert.equal(domain.searchMemories({ workspace: "/w", limit: 50 }).length, 1);
  assert.equal(domain.searchMemories({ workspace: "/other", limit: 50 }).length, 0);
  await domain.close();
});

// ── web routes ──────────────────────────────────────────────────────────

test("api: GET /export serves the dump, POST /import restores it", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  const routes = makeEngramRoutes(serviceFor(domain));

  const ex = res();
  await route(routes, `${API_PREFIX}/export`).handler(req({ url: `${API_PREFIX}/export?workspace=${encodeURIComponent("/w")}` }), ex);
  assert.equal(ex._out.status, 200);
  const dump = json(ex);
  assert.equal(dump.meta.format, "dsh-engram/export");
  assert.equal(dump.memories.length, 2);

  // Wipe, then restore through the API.
  for (const m of dump.memories) await domain.deleteMemory("/w", m.id);
  assert.equal(domain.listMemories("/w").length, 0);
  const im = res();
  await route(routes, `${API_PREFIX}/import`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/import`, body: { payload: dump, mode: "merge" } }),
    im,
  );
  assert.equal(im._out.status, 200);
  assert.equal(json(im).written.memories, 2);
  assert.equal(domain.listMemories("/w").length, 2);
  await domain.close();
});

test("api: replace import is gated behind confirm: \"restore\"", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  const dump = domain.exportAll("/w");
  const routes = makeEngramRoutes(serviceFor(domain));

  const denied = res();
  await route(routes, `${API_PREFIX}/import`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/import`, body: { payload: dump, mode: "replace", workspace: "/w" } }),
    denied,
  );
  assert.equal(denied._out.status, 400);
  assert.match(json(denied).error, /confirm/);
  assert.equal(domain.listMemories("/w").length, 2, "nothing was wiped by the denied call");

  const allowed = res();
  await route(routes, `${API_PREFIX}/import`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/import`, body: { payload: dump, mode: "replace", workspace: "/w", confirm: "restore" } }),
    allowed,
  );
  assert.equal(allowed._out.status, 200);
  assert.equal(domain.listMemories("/w").length, 2);
  await domain.close();
});

test("api: import accepts large dumps (data-contract body cap is 32 MiB)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const routes = makeEngramRoutes(serviceFor(domain));
  // ~500 rows × ~400 chars ≈ 200 KB — well past the 32 KB default JSON body cap,
  // proving the import route uses its own larger limit.
  const rows = Array.from({ length: 500 }, (_, i) => ({
    id: `bulk_${i}`, workspace: "/big", text: `bulk memory row ${i} ` + "y".repeat(380),
    sessionId: "s", createdAt: i, updatedAt: i,
  }));
  const im = res();
  await route(routes, `${API_PREFIX}/import`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/import`, body: { payload: { meta: { format: "dsh-engram/export", version: 1 }, memories: rows }, mode: "merge" } }),
    im,
  );
  assert.equal(im._out.status, 200);
  assert.equal(json(im).written.memories, 500);
  assert.equal(domain.searchMemories({ workspace: "/big", limit: 500 }).length, 500);
  await domain.close();
});

test("api: /export is loopback-fenced like every other route", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await seedWorkspace(domain, "/w");
  const routes = makeEngramRoutes(serviceFor(domain));
  const far = res();
  await route(routes, `${API_PREFIX}/export`).handler(
    req({ url: `${API_PREFIX}/export`, remoteAddress: "203.0.113.5", host: "dsh.example.com" }),
    far,
  );
  assert.equal(far._out.status, 403);
  assert.match(json(far).error, /loopback/);
  await domain.close();
});
