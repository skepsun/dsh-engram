/**
 * Session episode + resume brief tests (v0.7-A/D) — pure functions, no I/O.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildEpisode } from "../lib/episode.js";
import { renderResumeBrief, selectIndexMemories } from "../lib/index-block.js";

function session(events, cwd = "/ws") {
  return { id: "s1", header: { cwd }, events };
}

function call(name, args, callId) {
  return { type: "tool/call", data: { name, arguments: JSON.stringify(args), callId } };
}

function result(callId, isError) {
  return {
    type: "tool/result",
    data: { message: { content: [{ type: "tool-result", toolCallId: callId, isError }] } },
  };
}

test("buildEpisode: files / commands / failures→fixed / decisions / open todos", () => {
  const episode = buildEpisode(
    session([
      call("edit", { path: "/ws/src/a.ts" }, "c1"),
      call("bash", { command: "npm test -- foo" }, "c2"),
      result("c2", true),
      call("bash", { command: "npm test -- foo" }, "c3"),
      result("c3", false),
      call("bash", { command: 'git commit -m "fix ledger"' }, "c4"),
      { type: "todo/write", data: { todos: [{ content: "write docs", status: "pending" }, { content: "ship", status: "completed" }] } },
    ]),
    { now: new Date("2026-10-19T09:30:00").getTime() },
  );
  assert.ok(episode, "substantive session yields an episode");
  assert.match(episode.text, /^session episode 2026-10-19 09:30:/);
  assert.match(episode.text, /files src\/a\.ts/);
  assert.match(episode.text, /cmds npm test×2→fixed/);
  assert.match(episode.text, /decisions "fix ledger"/);
  assert.match(episode.text, /open write docs/);
  assert.deepEqual(episode.tags, ["episode", "auto-captured", "fix"]);
  assert.equal(episode.summary.failedRuns, 1);
  assert.equal(episode.summary.files[0], "src/a.ts", "cwd-relative display path");
});

test("buildEpisode: a command-only session is not worth remembering", () => {
  const episode = buildEpisode(session([call("bash", { command: "ls -la" }, "c1"), result("c1", false)]));
  assert.equal(episode, null);
});

test("buildEpisode: malformed arguments and empty sessions never throw", () => {
  assert.equal(buildEpisode(null), null);
  assert.equal(buildEpisode(session([])), null);
  const malformed = session([
    { type: "tool/call", data: { name: "edit", arguments: "{not json", callId: "c1" } },
    { type: "tool/result", data: null },
  ]);
  assert.equal(buildEpisode(malformed), null);
});

test("buildEpisode: a failed command that never recovers says →failed", () => {
  const episode = buildEpisode(
    session([
      call("bash", { command: "make build" }, "c1"),
      result("c1", true),
      call("edit", { path: "main.c" }, "c2"),
    ]),
  );
  assert.ok(episode);
  assert.match(episode.text, /make build×1→failed/);
});

test("buildEpisode: bounds files/commands/decisions/open", () => {
  const events = [];
  for (let i = 0; i < 8; i += 1) events.push(call("edit", { path: `/ws/f${i}.ts` }, `e${i}`));
  for (let i = 0; i < 8; i += 1) events.push(call("bash", { command: `cmd-${i} run` }, `b${i}`));
  for (let i = 0; i < 5; i += 1) events.push(call("bash", { command: `git commit -m "msg ${i}"` }, `g${i}`));
  for (let i = 0; i < 5; i += 1) events.push({ type: "todo/write", data: { todos: [{ content: `todo ${i}`, status: "pending" }] } });
  const episode = buildEpisode(session(events));
  assert.ok(episode);
  assert.ok(episode.text.length <= 900);
  assert.ok(episode.summary.files.length <= 8);
  assert.ok(episode.text.includes("open todo 4"), "last todo snapshot wins, capped at 3");
});

function fakeStore(episodes, extra = {}) {
  return {
    listMemories: () => episodes,
    memoryRelations: () => ({ supersededBy: new Map() }),
    ...extra,
  };
}

test("renderResumeBrief: newest recent episode becomes the [RESUME] line", () => {
  const now = new Date("2026-10-19T10:00:00").getTime();
  const store = fakeStore([
    { id: "ep000001", kind: "episode", status: "active", createdAt: now - 3600_000, text: "session episode 2026-10-19 09:00: files a.ts · open ship" },
    { id: "ep000002", kind: "episode", status: "active", createdAt: now - 10 * 86_400_000, text: "old" },
  ]);
  const text = renderResumeBrief(store, "/ws", {}, { now });
  assert.match(text, /^\[RESUME\] last episode/);
  assert.match(text, /files a\.ts/);
  assert.match(text, /engram_detail ep000001/);
});

test("renderResumeBrief: old episode, disabled config and empty store are silent", () => {
  const now = new Date("2026-10-19T10:00:00").getTime();
  const old = fakeStore([{ id: "ep1", kind: "episode", status: "active", createdAt: now - 30 * 86_400_000, text: "old" }]);
  assert.equal(renderResumeBrief(old, "/ws", {}, { now }), "");
  assert.equal(renderResumeBrief(old, "/ws", { resumeBriefEnabled: false }, { now }), "");
  assert.equal(renderResumeBrief(fakeStore([]), "/ws", {}, { now }), "");
});

test("renderResumeBrief: truncates the body and keeps the drill pointer", () => {
  const now = new Date("2026-10-19T10:00:00").getTime();
  const long = "x".repeat(500);
  const store = fakeStore([{ id: "ep9", kind: "episode", status: "active", createdAt: now, text: `session episode x: ${long}` }]);
  const text = renderResumeBrief(store, "/ws", { resumeBriefMaxChars: 80 }, { now });
  assert.ok(text.includes("…"), "body is truncated");
  assert.ok(text.includes("engram_detail ep9"));
  assert.ok(text.length < 200);
});

test("episodes never earn an [ENGRAM] index line even with high signal", () => {
  const store = fakeStore([
    { id: "ep1", kind: "episode", status: "active", text: "session episode", signal: 0.99, createdAt: 1, hits: 99 },
    { id: "f1", kind: "fact", status: "active", text: "durable fact", signal: 0.9, createdAt: 2, hits: 0 },
  ]);
  const picked = selectIndexMemories(store, "/ws", { minIndexSignal: 0.4, promoteHits: 3, indexMaxLines: 10 });
  assert.deepEqual(picked.map((m) => m.id), ["f1"]);
});
