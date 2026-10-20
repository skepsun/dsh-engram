/**
 * Session event-log access across DSH generations.
 *
 * WHY THIS EXISTS (2026-10-20, the second "silent zero"):
 * DSH ≤0.1.x exposed the conversation log as `session.events`, a plain frozen
 * array. DSH 0.2.x removed that getter — `Session.prototype` now carries only
 * `eventAt` / `snapshotEvents` / `ownEvents` / `deriveEventMessage`, and the
 * synchronous full-log read is deprecated host-internally in favour of
 * `ctx.sessionQuery.live(session)` leases. Every
 * `Array.isArray(session.events)` read in this plugin therefore yielded `[]`
 * on the running host, silently disabling three whole features while their
 * unit tests (which mock `{ events: [...] }`) stayed green:
 *
 *   - `[RECALL]` session-start auto-recall never materialized (no first user
 *     message → no query), and worse, `index.js` refused to cache the
 *     `[ENGRAM]` block ("pendingRecall") on every assembly, so the index was
 *     re-rendered per turn and never metered into the ledger;
 *   - session episodes were never written → `[RESUME]` briefs never fired;
 *   - the session-end todo sink never found a pending todo → no ESR drafts.
 *
 * The lesson is the same one as the session-log rename (memory #8): a
 * host-API read must feature-detect and REPORT, never silently degrade to an
 * empty value. `sessionEventsSource()` names the path taken so the status
 * snapshot can surface `none` instead of pretending the log was empty.
 *
 * Resolution order (first working wins):
 *   1. `session.events`            — legacy hosts (≤0.1.x), and every unit test;
 *   2. `sessionQuery.live(session)`— sanctioned ≥0.2.x lease (lazy snapshot);
 *   3. `session.snapshotEvents()`  — context-free fallback (deprecated host-side,
 *                                    still the only sync full-log read a plugin has);
 *   4. `[]`                        — nothing readable; callers degrade and
 *                                    `sessionEventsSource` reports "none".
 */

/** Shared empty array: callers only read, so one frozen instance is enough. */
const NO_EVENTS = Object.freeze([]);

/**
 * Which read path a session exposes, without materializing the log.
 * @param {object} session
 * @param {object} [sessionQuery] the `ctx.sessionQuery` service, if mounted
 * @returns {"legacy"|"sessionQuery"|"snapshotEvents"|"none"}
 */
export function sessionEventsSource(session, sessionQuery = void 0) {
  if (session === null || typeof session !== "object") return "none";
  if (Array.isArray(session.events)) return "legacy";
  if (hasLive(sessionQuery)) return "sessionQuery";
  if (typeof session.snapshotEvents === "function") return "snapshotEvents";
  return "none";
}

function hasLive(sessionQuery) {
  return (
    sessionQuery !== null &&
    typeof sessionQuery === "object" &&
    typeof sessionQuery.live === "function"
  );
}

/**
 * Read a session's event log across DSH generations (see module header).
 *
 * Returns a frozen-or-plain array of events; never throws. A session that
 * genuinely has no events and a session whose log is unreadable both return
 * `[]` — use {@link sessionEventsSource} when the difference matters.
 *
 * @param {object} session host session (`agent.session`, or the arg of
 *   `session/disposed`)
 * @param {object} [sessionQuery] the `ctx.sessionQuery` service, if mounted
 * @returns {ReadonlyArray<object>}
 */
export function readSessionEvents(session, sessionQuery = void 0) {
  if (session === null || typeof session !== "object") return NO_EVENTS;

  // 1. Legacy: DSH ≤0.1.x (and every unit-test double).
  if (Array.isArray(session.events)) return session.events;

  // 2. Sanctioned ≥0.2.x: a live lease exposes a lazily materialized snapshot
  //    up to the session's current seq. Dispose it immediately — we only need
  //    the array, not the retention or the projection payload.
  if (hasLive(sessionQuery)) {
    let lease;
    try {
      lease = sessionQuery.live(session);
      const events = lease?.events;
      if (Array.isArray(events)) return events;
    } catch {
      // fall through to snapshotEvents
    } finally {
      try {
        lease?.[Symbol.dispose]?.();
      } catch {
        // best-effort lease release
      }
    }
  }

  // 3. Context-free fallback.
  if (typeof session.snapshotEvents === "function") {
    try {
      const end = typeof session.seq === "number" ? session.seq : void 0;
      const events = end === void 0 ? session.snapshotEvents() : session.snapshotEvents(0, end);
      if (Array.isArray(events)) return events;
    } catch {
      // unreadable — degrade
    }
  }

  // 4. Nothing.
  return NO_EVENTS;
}

/**
 * The session's current event count, for provenance `seq` stamps.
 *
 * `seq` is the next free seq on ≥0.2.x (`session.seq`), so it equals the log
 * length; on legacy hosts the array length is the same number. Kept here so
 * the four write sites (capture / tools / preference / episode) agree.
 */
export function sessionSeq(session, sessionQuery = void 0) {
  if (session === null || typeof session !== "object") return 0;
  const seq = session.seq;
  if (typeof seq === "number" && Number.isFinite(seq) && seq >= 0) return Math.trunc(seq);
  const events = readSessionEvents(session, sessionQuery);
  return events.length;
}
