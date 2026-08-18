/**
 * dsh-loom web API tests — exercise `makeLoomRoutes` handlers (overview /
 * memories filter + search / tasks / links / config / archive / delete)
 * against the in-memory domain with loopback-fenced fake requests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { openLoomDomain } from "../lib/store.js";
import { makeLoomRoutes, API_PREFIX } from "../lib/api.js";

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
  loomIndexOrder: 40,
  esrOrder: 41,
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

/** One-shot: route = first route whose path matches. */
function route(routes, path) {
  return routes.find((r) => r.path === path);
}

test("api: overview reports per-workspace counts, indexes and captures", async () => {
  const domain = await openLoomDomain(fakeFacility());
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
    renderIndexBlock: () => "[LOOM] workspace: a",
  };
  const routes = makeLoomRoutes(service);
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
  assert.equal(body.indexes["/ws/a"].chars, "[LOOM] workspace: a".length);
  await domain.close();
});

test("api: memories filter by workspace + kind and search by q", async () => {
  const domain = await openLoomDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/w", kind: "decision", text: "sqlite-vec wins", tags: ["arch"], sessionId: "s" }, CONFIG);
  await domain.storeMemory({ workspace: "/w", kind: "fact", text: "node 22", tags: [], sessionId: "s" }, CONFIG);
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeLoomRoutes(service);

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
  const domain = await openLoomDomain(fakeFacility());
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
  const routes = makeLoomRoutes(service);

  const t = res();
  await route(routes, `${API_PREFIX}/tasks`).handler(req({ url: `${API_PREFIX}/tasks?workspace=${encodeURIComponent("/w")}&includeStable=1` }), t);
  assert.equal(json(t).items.length, 2);

  const l = res();
  await route(routes, `${API_PREFIX}/links`).handler(req({ url: `${API_PREFIX}/links?workspace=${encodeURIComponent("/w")}` }), l);
  assert.deepEqual(json(l).items.map((x) => x.relation), ["depends_on"]);

  // archive one memory
  const [m1] = domain.searchMemories({ workspace: "/w", q: "m1" });
  const ar = res();
  await route(routes, `${API_PREFIX}/memories/archive`).handler(
    req({ method: "POST", url: `${API_PREFIX}/memories/archive`, body: { id: m1.id, workspace: "/w" } }),
    ar,
  );
  assert.equal(ar._out.status, 200);
  assert.equal(domain.listMemories("/w").length, 1);

  // delete the other
  const [m2] = domain.searchMemories({ workspace: "/w", q: "m2" });
  const del = res();
  await route(routes, `${API_PREFIX}/memories/delete`).handler(
    req({ method: "POST", url: `${API_PREFIX}/memories/delete`, body: { id: m2.id, workspace: "/w" } }),
    del,
  );
  assert.equal(del._out.status, 200);
  assert.equal(domain.listMemories("/w").length, 0);
  await domain.close();
});

test("api: non-loopback requests are refused with 403", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const service = { config: CONFIG, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeLoomRoutes(service);
  const r = res();
  await route(routes, `${API_PREFIX}/config`).handler(
    req({ url: `${API_PREFIX}/config`, remoteAddress: "192.168.1.9", host: "10.0.0.2:3080" }),
    r,
  );
  assert.equal(json(r).error, "loopback-only");
  await domain.close();
});

test("api: config endpoint returns the live config", async () => {
  const domain = await openLoomDomain(fakeFacility());
  const live = { ...CONFIG, expireDays: 90 };
  const service = { config: live, captureStats: { total: 0, git: 0, file: 0, error: 0 }, openedDomain: () => domain, getDomain: () => Promise.resolve(domain) };
  const routes = makeLoomRoutes(service);
  const r = res();
  await route(routes, `${API_PREFIX}/config`).handler(req({ url: `${API_PREFIX}/config` }), r);
  assert.equal(r._out.status, 200);
  assert.equal(json(r).expireDays, 90);
  await domain.close();
});
