/**
 * Entity page + entity card tests (v0.7-B) — pure projections over a fake store.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildEntityPage, renderEntityCard, renderEntityPage, resolveEntity } from "../lib/entity-page.js";
import { renderIndex } from "../lib/index-block.js";

const ENTITY = {
  id: "ent_dsh-engram",
  workspace: "/ws",
  name: "dsh-engram",
  kind: "package",
  description: "the memory plugin",
  createdAt: 1,
  updatedAt: 10,
  sessionId: "s1",
};

function memory(overrides = {}) {
  return {
    id: "m0000001",
    workspace: "/ws",
    kind: "fact",
    text: "ledger defaults on",
    tags: [],
    entity: "dsh-engram",
    sessionId: "s1",
    seq: 0,
    createdAt: 10,
    updatedAt: 10,
    hits: 0,
    status: "active",
    signal: 0.8,
    ...overrides,
  };
}

function fakeStore({ entities = [ENTITY], memories = [], tasks = [], links = [], relations } = {}) {
  return {
    listEntities: () => entities,
    timeline: (_ws, key) => memories.filter((m) => m.entity === key || (entities[0] && m.entity === entities[0].name)),
    memoryRelations: () => relations ?? { supersededBy: new Map(), contradictedBy: new Map() },
    listTasks: () => tasks,
    linksFor: (_ws, key) => links.filter((l) => l.source === key || l.target === key),
    workspaceEntries: () => ({ memories: memories.length, links: links.length, nodes: entities.length }),
    listMemories: () => memories.slice().sort((a, b) => b.createdAt - a.createdAt),
  };
}

test("buildEntityPage: current truth excludes superseded rows, preference first", () => {
  const stale = memory({ id: "mStale01", kind: "fact", text: "old truth", updatedAt: 5 });
  const pref = memory({ id: "mPref001", kind: "preference", text: "use pnpm", updatedAt: 7 });
  const fact = memory({ id: "mFact001", kind: "fact", text: "ledger defaults on", updatedAt: 20 });
  const store = fakeStore({
    memories: [stale, pref, fact],
    relations: { supersededBy: new Map([["mStale01", { newer: "mFact001" }]]), contradictedBy: new Map() },
  });
  const page = buildEntityPage(store, "/ws", "ent_dsh-engram");
  assert.equal(page.truth[0].id, "mPref001", "preference ranks first");
  assert.equal(page.truth.length, 2);
  assert.ok(!page.truth.some((m) => m.id === "mStale01"), "superseded truth is excluded");
  assert.equal(page.counts.memories, 2);
});

test("buildEntityPage: open tasks, conflicts and relations", () => {
  const a = memory({ id: "mA000001", text: "claim A" });
  const b = memory({ id: "mB000001", text: "claim B", contradicts: "mA000001" });
  const task = { id: "tsk_1", entity: "dsh-engram", name: "ship", state: "active", artifact: null, evaluation: null, memoryRefs: [], createdAt: 1, updatedAt: 2 };
  const relation = { id: "lnk_1", source: "ent_dsh-engram", relation: "depends_on", target: "ent_sol-pi", confidence: 0.8 };
  const store = fakeStore({
    memories: [a, b],
    tasks: [task],
    links: [relation],
    relations: { supersededBy: new Map(), contradictedBy: new Map([["mA000001", [{ id: "mB000001" }]]]) },
  });
  const page = buildEntityPage(store, "/ws", "dsh-engram");
  assert.equal(page.counts.openTasks, 1);
  assert.equal(page.openTasks[0].id, "tsk_1");
  assert.equal(page.conflicts.length, 1);
  assert.equal(page.conflicts[0].contradictedById, "mB000001");
  assert.equal(page.links[0].id, "lnk_1");
});

test("resolveEntity: id, name, case-insensitive, virtual fallback", () => {
  const store = fakeStore();
  assert.equal(resolveEntity(store, "/ws", "ent_dsh-engram").id, "ent_dsh-engram");
  assert.equal(resolveEntity(store, "/ws", "DSH-ENGRAM").id, "ent_dsh-engram");
  assert.equal(resolveEntity(store, "/ws", "unknown").name, "unknown");
  assert.equal(resolveEntity(store, "/ws", ""), null);
});

test("renderEntityCard: one line with truth id and drill pointer", () => {
  const page = buildEntityPage(fakeStore({ memories: [memory()] }), "/ws", "ent_dsh-engram");
  const card = renderEntityCard(page);
  assert.match(card, /^\[ENT\] dsh-engram · package · 1 mem · 0 open · truth: ledger defaults on #m0000001/);
  assert.match(card, /engram_detail\(entity="dsh-engram"\)/);
  assert.ok(card.length <= 160);
});

test("renderEntityPage: sections and truncation", () => {
  const page = buildEntityPage(fakeStore({ memories: [memory()] }), "/ws", "ent_dsh-engram");
  const text = renderEntityPage(page);
  assert.match(text, /^ent:dsh-engram · package · 1 memory · 0 open/);
  assert.match(text, /truth:/);
  assert.match(text, /timeline:/);
  assert.match(text, /drill: engram_detail/);
  assert.ok(renderEntityPage(page, { maxChars: 40 }).length <= 40);
});

test("[ENGRAM] index uses entity cards and does not repeat anchored memories", () => {
  const anchored = memory({ id: "mAnch001", text: "ledger defaults on", entity: "dsh-engram" });
  const free = memory({ id: "mFree001", text: "unrelated fact", entity: null, updatedAt: 30 });
  const store = fakeStore({ memories: [anchored, free] });
  const config = {
    minIndexSignal: 0.4,
    promoteHits: 3,
    indexMaxLines: 10,
    indexMaxChars: 700,
    entityCardsEnabled: true,
    entityCardsMax: 2,
    entityCardChars: 120,
  };
  const block = renderIndex(store, "/ws", "/ws", config);
  assert.match(block, /\[ENT\] dsh-engram/);
  assert.match(block, /engram_detail\(entity="dsh-engram"\)/);
  assert.match(block, /mFree001/, "non-anchored memory keeps a flat line");
  const flatLines = block.split("\n").filter((line) => /^\[[DFPIEHR]\]/.test(line));
  assert.ok(!flatLines.some((line) => line.includes("mAnch001")), "anchored memory is represented by the card only");
});

test("[ENGRAM] index: entityCardsEnabled:false keeps the old flat layout", () => {
  const anchored = memory({ id: "mAnch001", text: "ledger defaults on", entity: "dsh-engram" });
  const store = fakeStore({ memories: [anchored] });
  const config = {
    minIndexSignal: 0.4,
    promoteHits: 3,
    indexMaxLines: 10,
    indexMaxChars: 700,
    entityCardsEnabled: false,
  };
  const block = renderIndex(store, "/ws", "/ws", config);
  assert.ok(!block.includes("[ENT]"));
  assert.match(block, /mAnch001/);
});
