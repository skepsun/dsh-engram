/**
 * Cross-generation session-log access + its three dependents (2026-10-20).
 *
 * Regression for the "second silent zero": DSH 0.2.x removed the
 * `session.events` getter, so every `Array.isArray(session.events)` read
 * returned `[]` on the running host. The [RECALL] push leg, session episodes,
 * resume briefs and the session-end todo sink were all dormant in production
 * while their unit tests (which mocked `{ events: [...] }`) stayed green.
 *
 * Every test here uses a session double that does NOT expose `.events` — it
 * mirrors what `Session.prototype` actually has on ≥0.2.x (`seq`,
 * `eventAt`, `snapshotEvents`) — so a regression back to `session.events`
 * fails loudly instead of degrading to an empty log.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { readSessionEvents, sessionEventsSource, sessionSeq } from "../lib/session-events.js";
import { firstUserMessageText } from "../lib/index-block.js";
import { buildEpisode } from "../lib/episode.js";
import { pendingTodosFromSession } from "../lib/todo-sink.js";

/** DSH ≥0.2.x hand: log is private, reads go through snapshotEvents/seq. */
function hostSession(events, cwd = "/ws") {
  return {
    id: "s1",
    header: { cwd },
    seq: events.length,
    eventAt: (seq) => events[seq],
    snapshotEvents: (from = 0, to = events.length) => Object.freeze(events.slice(from, to)),
  };
}

/** ctx.sessionQuery stand-in: lazily materialized lease with a dispose hook. */
function hostQuery(events, { throws = false, disposed = [] } = {}) {
  return {
    live() {
      if (throws) throw new Error("no live entry");
      return {
        get events() {
          return Object.freeze([...events]);
        },
        [Symbol.dispose]() {
          disposed.push(true);
        },
      };
    },
  };
}

const userMessage = (text) => ({ type: "user/message", data: { content: [{ type: "text", text }] } });
const call = (name, args, callId) => ({ type: "tool/call", data: { name, arguments: JSON.stringify(args), callId } });
const result = (callId, isError) => ({
  type: "tool/result",
  data: { message: { content: [{ type: "tool-result", toolCallId: callId, isError }] } },
});

test("readSessionEvents: legacy hosts still read session.events as-is", () => {
  const events = [userMessage("hi")];
  const legacy = { header: { cwd: "/ws" }, events };
  assert.equal(readSessionEvents(legacy), events, "identity, no copy");
  assert.equal(sessionEventsSource(legacy), "legacy");
});

test("readSessionEvents: ≥0.2.x session with only snapshotEvents is readable", () => {
  const events = [userMessage("hi")];
  const session = hostSession(events);
  assert.equal(session.events, void 0, "double must not expose .events");
  assert.deepEqual(readSessionEvents(session), events);
  assert.equal(sessionEventsSource(session), "snapshotEvents");
});

test("readSessionEvents: ctx.sessionQuery lease wins when mounted, and is disposed", () => {
  const events = [userMessage("hi")];
  const disposed = [];
  const session = hostSession(events);
  assert.deepEqual(readSessionEvents(session, hostQuery(events, { disposed })), events);
  assert.equal(sessionEventsSource(session, hostQuery(events)), "sessionQuery");
  assert.equal(disposed.length, 1, "lease released after the read");
});

test("readSessionEvents: a throwing lease falls back to snapshotEvents", () => {
  const events = [userMessage("hi")];
  const session = hostSession(events);
  assert.deepEqual(readSessionEvents(session, hostQuery(events, { throws: true })), events);
});

test("readSessionEvents: unreadable host → [] and source 'none' (never throws)", () => {
  const opaque = { header: { cwd: "/ws" } };
  assert.deepEqual(readSessionEvents(opaque), []);
  assert.deepEqual(readSessionEvents(opaque, hostQuery([])), []);
  assert.equal(sessionEventsSource(opaque), "none");
  assert.deepEqual(readSessionEvents(null), []);
});

test("sessionSeq: prefers the host seq counter, falls back to the log length", () => {
  assert.equal(sessionSeq({ seq: 42 }), 42);
  assert.equal(sessionSeq(hostSession([userMessage("a"), userMessage("b")])), 2);
  assert.equal(sessionSeq(null), 0);
});

test("firstUserMessageText: works on a 0.2.x session (no .events)", () => {
  const session = hostSession([call("bash", { command: "ls" }, "c1"), userMessage("fix the ledger math")]);
  assert.equal(firstUserMessageText(session), "fix the ledger math");
  assert.equal(firstUserMessageText(session, hostQuery(readSessionEvents(session))), "fix the ledger math");
});

test("buildEpisode: works on a 0.2.x session (no .events)", () => {
  const session = hostSession(
    [
      call("edit", { path: "/ws/src/a.ts" }, "c1"),
      call("bash", { command: "npm test -- foo" }, "c2"),
      result("c2", true),
      call("bash", { command: "npm test -- foo" }, "c3"),
      result("c3", false),
    ],
    "/ws",
  );
  const episode = buildEpisode(session);
  assert.ok(episode, "episode must be produced from the snapshotEvents log");
  assert.match(episode.text, /files src\/a\.ts/);
  assert.match(episode.text, /cmds npm test×2→fixed/);
});

test("pendingTodosFromSession: works on a 0.2.x session (no .events)", () => {
  const session = hostSession([
    { type: "todo/write", data: { todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }] } },
  ]);
  assert.deepEqual(
    pendingTodosFromSession(session).map((todo) => todo.content ?? todo),
    ["b"],
  );
});

test("episode open-loops read the same 0.2.x log (no double-read regression)", () => {
  const session = hostSession([
    call("edit", { path: "/ws/src/a.ts" }, "c1"),
    { type: "todo/write", data: { todos: [{ content: "write docs", status: "pending" }] } },
  ]);
  const episode = buildEpisode(session);
  assert.ok(episode);
  assert.match(episode.text, /open write docs/);
});
