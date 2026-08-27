/**
 * dsh-engram auto-supersede tests — the config-gated (default OFF) heuristic
 * that turns a replacement/negation update into a supersedes edge. Pure,
 * deterministic, zero LLM; explicit `supersedes` always wins over it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";

const BASE = {
  autoCapture: true,
  sessionSearch: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.55,
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

async function seedOld(domain, cfg, { entity = "build" } = {}) {
  return domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们使用 webpack 构建", entity, sessionId: "s", seq: 1, signal: 0.7 },
    cfg,
  );
}

test("auto-supersede is OFF by default (no config key)", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const old = await seedOld(domain, BASE);
  const newer = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们改用 vite 构建", entity: "build", sessionId: "s", seq: 2, signal: 0.7 },
    BASE,
  );
  assert.equal(newer.stored.supersedes, null, "no auto edge without the config flag");
  assert.deepEqual([...domain.memoryRelations("/ws").supersededBy.keys()], []);
  await domain.close();
});

test("auto-supersede fires on entity + cue + token overlap when enabled", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...BASE, autoSupersede: true };
  const old = await seedOld(domain, cfg);
  const newer = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们改用 vite 构建", entity: "build", sessionId: "s", seq: 2, signal: 0.7 },
    cfg,
  );
  assert.equal(newer.stored.supersedes, old.id);
  assert.equal(domain.memoryRelations("/ws").supersededBy.get(old.id).id, newer.id);
  await domain.close();
});

test("auto-supersede stays silent without a cue, entity, or kind match", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...BASE, autoSupersede: true };
  const old = await seedOld(domain, cfg);
  // no cue (plain update)
  const noCue = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们正在使用 webpack 构建更多组件", entity: "build", sessionId: "s", seq: 2, signal: 0.7 },
    cfg,
  );
  assert.equal(noCue.stored.supersedes, null, "plain update must not stale-mark");
  // no entity anchor
  const noEntity = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们改用 esbuild 构建", entity: null, sessionId: "s", seq: 3, signal: 0.7 },
    cfg,
  );
  assert.equal(noEntity.stored.supersedes, null, "anchorless write must not trigger");
  // different kind (decision vs fact) — same entity + cue, but kind mismatch
  const otherKind = await domain.storeMemory(
    { workspace: "/ws", kind: "decision", text: "我们改用 esbuild 构建", entity: "build", sessionId: "s", seq: 4, signal: 0.7 },
    cfg,
  );
  assert.equal(otherKind.stored.supersedes, null, "cross-kind must not trigger");
  await domain.close();
});

test("explicit supersedes wins over the auto heuristic", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const cfg = { ...BASE, autoSupersede: true };
  const first = await seedOld(domain, cfg, { entity: "build" });
  const second = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们改用 esbuild 构建", entity: "build", sessionId: "s", seq: 2, signal: 0.7 },
    cfg,
  );
  // heuristic would pick `first`; explicit target overrides it
  const third = await domain.storeMemory(
    { workspace: "/ws", kind: "fact", text: "我们改用 rolldown 构建", entity: "build", sessionId: "s", seq: 3, signal: 0.7, supersedes: second.id },
    cfg,
  );
  assert.equal(third.stored.supersedes, second.id, "explicit target is honored");
  await domain.close();
});
