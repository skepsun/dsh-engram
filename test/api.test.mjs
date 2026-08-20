/**
 * dsh-engram web API tests — exercise `makeEngramRoutes` handlers (overview /
 * memories filter + search / tasks / links / config / archive / delete)
 * against the in-memory domain with loopback-fenced fake requests.
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
  // Pure-logic tests use fake workspace keys ("/w"); the on-disk evidence gate
  // gets its own dedicated test with a real tempdir (verifyArtifact: true).
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

/** Build a minimal loopback IncomingMessage stand-in. */
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

/** In-memory response capture. */
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

/** One-shot: route = first route whose path + method match (method default GET). */
function route(routes, path, method = "GET") {
  return routes.find((r) => r.path === path && (r.method === void 0 || r.method === method));
}

test("api: overview reports per-workspace counts, indexes and captures", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws/a", kind: "decision", text: "use JSON storage", tags: ["arch"], sessionId: "s1" }, CONFIG);
  await domain.storeMemory({ workspace: "/ws/a", kind: "fact", text: "vitest chosen", tags: ["test"], sessionId: "s1" }, CONFIG);
  await domain.storeMemory({ workspace: "/ws/b", kind: "error", text: "flaky e2e", tags: [], sessionId: "s2" }, CONFIG);
  await domain.putTask({
    id: "tsk_x", workspace: "/ws/a", name: "upgrade", state: "active",
    artifact: null, evaluation: null, memoryRefs: [], sessionId: "s1", createdAt: 1, updatedAt: 1,
  });
  const service = {
    config: CONFIG,
    captureStats: { total: 7, git: 5, file: 1, error: 1 },
    openedDomain: () => domain,
    getDomain: () => Promise.resolve(domain),
    renderIndexBlock: () => "[ENGRAM] workspace: a",
  };
  const routes = makeEngramRoutes(service);
  const r = res();
  await route(routes, `${API_PREFIX}/overview`).handler(req({ url: `${API_PREFIX}/overview` }), r);
  assert.equal(r._out.status, 200);
  const body = json(r);
  assert.equal(body.totals.memories, 3);
  assert.equal(body.totals.tasks, 1);
  assert.equal(body.workspaces["/ws/a"].memories, 2);
  assert.equal(body.kinds["decision"], 1);
  assert.equal(body.kinds["error"], 1);
  assert.equal(body.captures.git, 5);
  assert.equal(body.config.expireDays, 180);
  assert.equal(body.indexes["/ws/a"].chars, "[ENGRAM] workspace: a".length);
  await domain.close();
});

test("api: memories filter by workspace + kind and search by q", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "decision", text: "sqlite-vec wins", tags: ["arch"], sessionId: "s" }, CONFIG);
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "node 22", tags: [], sessionId: "s" }, CONFIG);
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);

  const allRes = res();
  await route(routes, `${API_PREFIX}/memories`).handler(req({ url: `${API_PREFIX}/memories` }), allRes);
  assert.equal(json(allRes).items.length, 2);

  const kindRes = res();
  await route(routes, `${API_PREFIX}/memories`).handler(req({ url: `${API_PREFIX}/memories?kind=decision` }), kindRes);
  assert.deepEqual(json(kindRes).items.map((m) => m.text), ["sqlite-vec wins"]);

  const qRes = res();
  await route(routes, `${API_PREFIX}/memories`).handler(req({ url: `${API_PREFIX}/memories?q=node` }), qRes);
  assert.deepEqual(json(qRes).items.map((m) => m.text), ["node 22"]);
  await domain.close();
});

test("api: tasks and links are workspace-scoped, archive + delete mutate", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "m1", tags: [], sessionId: "s" }, CONFIG);
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "m2", tags: [], sessionId: "s" }, CONFIG);
  await domain.putTask({
    id: "tsk_1", workspace: "/w", name: "t1", state: "active", artifact: null, evaluation: null,
    memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1,
  });
  await domain.putTask({
    id: "tsk_2", workspace: "/w", name: "t2", state: "stable", artifact: "a", evaluation: "e",
    memoryRefs: ["r"], sessionId: "s", createdAt: 2, updatedAt: 2,
  });
  await domain.addLink({ id: "l1", workspace: "/w", source: "a", relation: "depends_on", target: "b", sessionId: "s", createdAt: 1 });
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);

  const t = res();
  await route(routes, `${API_PREFIX}/tasks`).handler(req({ url: `${API_PREFIX}/tasks?workspace=${encodeURIComponent("/w")}&includeStable=1` }), t);
  assert.equal(json(t).items.length, 2);

  const l = res();
  await route(routes, `${API_PREFIX}/links`).handler(req({ url: `${API_PREFIX}/links?workspace=${encodeURIComponent("/w")}` }), l);
  assert.deepEqual(json(l).items.map((x) => x.relation), ["depends_on"]);

  // archive one memory
  const [m1] = domain.searchMemories({ workspace: "/w", q: "m1" });
  const ar = res();
  await route(routes, `${API_PREFIX}/memories/archive`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/memories/archive`, body: { id: m1.id, workspace: "/w" } }),
    ar,
  );
  assert.equal(ar._out.status, 200);
  assert.equal(domain.listMemories("/w").length, 1);

  // delete the other
  const [m2] = domain.searchMemories({ workspace: "/w", q: "m2" });
  const del = res();
  await route(routes, `${API_PREFIX}/memories/delete`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/memories/delete`, body: { id: m2.id, workspace: "/w" } }),
    del,
  );
  assert.equal(del._out.status, 200);
  assert.equal(domain.listMemories("/w").length, 0);
  await domain.close();
});

test("api: non-loopback requests are refused with 403", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);
  const r = res();
  await route(routes, `${API_PREFIX}/config`).handler(
    req({ url: `${API_PREFIX}/config`, remoteAddress: "192.168.1.9", host: "10.0.0.2:3080" }),
    r,
  );
  assert.equal(json(r).error, "loopback-only");
  await domain.close();
});

test("api: config endpoint returns the live config", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const live = { ...CONFIG, expireDays: 90 };
  const service = { config: live, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);
  const r = res();
  await route(routes, `${API_PREFIX}/config`).handler(req({ url: `${API_PREFIX}/config` }), r);
  assert.equal(r._out.status, 200);
  assert.equal(json(r).expireDays, 90);
  await domain.close();
});
test("api: GUI task create + close routes (evidence gates)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);

  // create without name → 400
  const bad = res();
  await route(routes, `${API_PREFIX}/tasks`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/tasks`, body: { workspace: "/w" } }),
    bad,
  );
  assert.equal(bad._out.status, 400);

  // create → 200, lands in the store
  const ok = res();
  await route(routes, `${API_PREFIX}/tasks`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/tasks`, body: { workspace: "/w", name: "gui task", description: "d" } }),
    ok,
  );
  assert.equal(ok._out.status, 200);
  const created = json(ok).task;
  assert.ok(created.id.startsWith("tsk_"));
  assert.equal(created.state, "active");
  const listed = res();
  await route(routes, `${API_PREFIX}/tasks`).handler(req({ url: `${API_PREFIX}/tasks?workspace=${encodeURIComponent("/w")}&includeStable=1` }), listed);
  assert.equal(json(listed).items.length, 1);

  // close without evidence → stays active, reports gaps
  const g = res();
  await route(routes, `${API_PREFIX}/tasks/close`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/tasks/close`, body: { workspace: "/w", id: created.id } }),
    g,
  );
  assert.equal(g._out.status, 200);
  const gbody = json(g);
  assert.equal(gbody.state, "active");
  assert.deepEqual(gbody.gaps, ["artifact", "evaluation", "memory_ref"]);

  // close with full evidence → stable
  const s = res();
  await route(routes, `${API_PREFIX}/tasks/close`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/tasks/close`, body: { workspace: "/w", id: created.id, artifact: "/tmp/a", evaluation: "tests pass", memory_refs: ["m1"] } }),
    s,
  );
  assert.equal(s._out.status, 200);
  const sbody = json(s);
  assert.equal(sbody.state, "stable");
  assert.equal(domain.getTask("/w", created.id).state, "stable");

  // unknown task → 404
  const nf = res();
  await route(routes, `${API_PREFIX}/tasks/close`, "POST").handler(
    req({ method: "POST", url: `${API_PREFIX}/tasks/close`, body: { workspace: "/w", id: "tsk_nope" } }),
    nf,
  );
  assert.equal(nf._out.status, 404);
  await domain.close();
});

test("api: evidence gate verifies artifact exists on disk (verifyArtifact)", async () => {
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");
  const path = await import("node:path");
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "dsh-engram-gate-"));
  await fsp.mkdir(path.join(ws, "out"), { recursive: true });
  await fsp.writeFile(path.join(ws, "out", "report.md"), "# done\n");

  const cfg = { ...CONFIG, verifyArtifact: true };
  const domain = await openEngramDomain(fakeFacility());
  const service = { config: cfg, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);

  const create = async (name) => {
    const r = res();
    await route(routes, `${API_PREFIX}/tasks`, "POST").handler(
      req({ method: "POST", url: `${API_PREFIX}/tasks`, body: { workspace: ws, name, description: "" } }),
      r,
    );
    return json(r).task.id;
  };
  const close = async (id, body) => {
    const r = res();
    await route(routes, `${API_PREFIX}/tasks/close`, "POST").handler(
      req({ method: "POST", url: `${API_PREFIX}/tasks/close`, body: { workspace: ws, id, ...body } }),
      r,
    );
    return json(r);
  };

  // relative artifact that exists on disk → stable
  const t1 = await create("exists");
  const c1 = await close(t1, { artifact: "out/report.md", evaluation: "reviewed", memory_refs: ["m1"] });
  assert.equal(c1.state, "stable");

  // missing artifact → stays active with an explicit reason
  const t2 = await create("missing");
  const c2 = await close(t2, { artifact: "out/gone.md", evaluation: "reviewed", memory_refs: ["m1"] });
  assert.equal(c2.state, "active");
  assert.ok(c2.gaps.includes("artifact"));
  assert.match(c2.artifactReason, /not found on disk/);

  // http(s) artifact → stable (URLs are exempt)
  const t3 = await create("url");
  const c3 = await close(t3, { artifact: "https://example.com/release/2.0.0", evaluation: "reviewed", memory_refs: ["m1"] });
  assert.equal(c3.state, "stable");

  // absolute path that exists → stable
  const t4 = await create("abs");
  const c4 = await close(t4, { artifact: path.join(ws, "out", "report.md"), evaluation: "reviewed", memory_refs: ["m1"] });
  assert.equal(c4.state, "stable");

  // gates still required with verify on
  const t5 = await create("gated");
  const c5 = await close(t5, { artifact: "out/report.md", evaluation: "" });
  assert.equal(c5.state, "active");
  assert.ok(c5.gaps.includes("evaluation"));
  assert.ok(c5.gaps.includes("memory_ref"));

  await domain.close();
  await fsp.rm(ws, { recursive: true, force: true });
});

test("api: nodes route lists entities; overview counts them", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.putEntity({ id: "ent_a", workspace: "/w", name: "A", kind: "pkg", description: "", sessionId: "s", createdAt: 1, updatedAt: 1 });
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeEngramRoutes(service);
  const n = res();
  await route(routes, `${API_PREFIX}/nodes`).handler(req({ url: `${API_PREFIX}/nodes?workspace=${encodeURIComponent("/w")}` }), n);
  assert.equal(n._out.status, 200);
  assert.equal(json(n).items.length, 1);
  assert.equal(json(n).items[0].id, "ent_a");
  const missing = res();
  await route(routes, `${API_PREFIX}/nodes`).handler(req({ url: `${API_PREFIX}/nodes` }), missing);
  assert.equal(missing._out.status, 400);
  const ov = res();
  await route(routes, `${API_PREFIX}/overview`).handler(req({ url: `${API_PREFIX}/overview` }), ov);
  assert.equal(json(ov).totals.nodes, 1);
  await domain.close();
});

test("api: preview route returns exact [ENGRAM]+[ESR] blocks + cost meta", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "decision", text: "use JSON storage", tags: [], sessionId: "s" }, CONFIG);
  await domain.putTask({
    id: "tsk_1", workspace: "/w", name: "ship", state: "active", artifact: null, evaluation: null,
    memoryRefs: [], sessionId: "s", createdAt: 1, updatedAt: 1,
  });
  const service = {
    config: CONFIG,
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    openedDomain: () => domain,
    getDomain: () => Promise.resolve(domain),
    renderIndexBlock: (ws) => `[ENGRAM] workspace: ${ws}\n[D] 2026 ship #abc`,
    renderEsrBlock: (ws) => `[ESR] tasks: 1 active / 0 stable\n- tsk_1: ship — ACTIVE · gap: artifact, evaluation, memory_ref`,
  };
  const routes = makeEngramRoutes(service);

  const missing = res();
  await route(routes, `${API_PREFIX}/preview`).handler(req({ url: `${API_PREFIX}/preview` }), missing);
  assert.equal(missing._out.status, 400);

  const ok = res();
  await route(routes, `${API_PREFIX}/preview`).handler(req({ url: `${API_PREFIX}/preview?workspace=${encodeURIComponent("/w")}` }), ok);
  assert.equal(ok._out.status, 200);
  const body = json(ok);
  assert.equal(body.workspace, "/w");
  assert.ok(body.engram.startsWith("[ENGRAM]"));
  assert.ok(body.esr.startsWith("[ESR]"));
  assert.equal(body.meta.engram.lines, 2);
  assert.equal(body.meta.engram.chars, "[ENGRAM] workspace: /w\n[D] 2026 ship #abc".length);
  assert.equal(body.meta.engram.tokens, Math.ceil(body.meta.engram.chars / 4));
  assert.equal(body.meta.esr.lines, 2);
  assert.deepEqual(body.meta.counts, { memories: 1, tasks: 1, links: 0, nodes: 0 });
  await domain.close();
});


