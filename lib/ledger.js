/**
 * Context Ledger — the accounting layer of the "context portfolio"
 * (docs/PROPOSAL-evolution.zh.md §4 v0.6-A).
 *
 * Every engram mechanism either spends context (injected index / recall / ESR
 * blocks, held in the prompt prefix for the rest of the session) or saves it
 * (pruned / compacted tool results that stop replaying). The ledger turns that
 * into one auditable number per session, workspace and day:
 *
 *   net = avoided − injected − rewriteChars × (1 − cacheDiscount)
 *
 * where `rewriteChars` is the prefix size invalidated by a prune (KV cache
 * break). `cacheDiscount` is the fraction a cached prefix would have cost
 * (0.1 = 10%, the conservative L0 assumption), so the penalty is the
 * non-discounted remainder.
 *
 * Zero LLM, deterministic, fail-contained. Two layers:
 *   - live per-session accumulator, ticked by `assistant/message` events
 *   - durable daily rollup at `~/.dsh/engram/ledger.json`, delta-flushed so a
 *     restart loses at most `flushEvery` requests of accounting
 *
 * Deliberately NOT here: model-quality deltas, actual provider billing, and
 * compaction savings whose before/after size the host does not expose yet.
 * Those stay labelled assumptions, never invented numbers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "ledger.json";
/** Matches the estimate used by the GUI (`chars / 4`). */
const CHARS_PER_TOKEN = 4;
const DEFAULT_CACHE_DISCOUNT = 0.1;
const DEFAULT_FLUSH_EVERY = 20;

/** Default ledger file under the engram home. */
export function ledgerFile(home = path.join(os.homedir(), ".dsh", "engram")) {
  return path.join(home, FILE_NAME);
}

/** Local YYYY-MM-DD (calendar days for the user, mirrors usage.dayKey). */
export function ledgerDayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clampDiscount(value) {
  if (!Number.isFinite(value)) return DEFAULT_CACHE_DISCOUNT;
  return Math.min(1, Math.max(0, value));
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function emptyBucket() {
  return {
    sessions: 0,
    requests: 0,
    injectedChars: 0,
    avoidedChars: 0,
    rewriteCount: 0,
    rewriteChars: 0,
  };
}

function addBucket(target, delta) {
  target.sessions += count(delta.sessions);
  target.requests += count(delta.requests);
  target.injectedChars += count(delta.injectedChars);
  target.avoidedChars += count(delta.avoidedChars);
  target.rewriteCount += count(delta.rewriteCount);
  target.rewriteChars += count(delta.rewriteChars);
  return target;
}

function deltaOf(session) {
  const f = session.flushed;
  return {
    requests: session.requests - f.requests,
    injectedChars: session.injectedChars - f.injectedChars,
    avoidedChars: session.avoidedChars - f.avoidedChars,
    rewriteCount: session.rewriteCount - f.rewriteCount,
    rewriteChars: session.rewriteChars - f.rewriteChars,
  };
}

function isEmptyDelta(delta) {
  return (
    delta.requests === 0 &&
    delta.injectedChars === 0 &&
    delta.avoidedChars === 0 &&
    delta.rewriteCount === 0 &&
    delta.rewriteChars === 0
  );
}

/** Finalize one bucket with the net-token arithmetic (pure). */
export function finalizeLedgerBucket(bucket, cacheDiscount = DEFAULT_CACHE_DISCOUNT) {
  const discount = clampDiscount(cacheDiscount);
  const injectedChars = count(bucket.injectedChars);
  const avoidedChars = count(bucket.avoidedChars);
  const rewriteChars = count(bucket.rewriteChars);
  const netChars = avoidedChars - injectedChars - Math.round(rewriteChars * (1 - discount));
  return {
    sessions: count(bucket.sessions),
    requests: count(bucket.requests),
    injectedChars,
    avoidedChars,
    rewriteCount: count(bucket.rewriteCount),
    rewriteChars,
    injectedTokens: Math.ceil(injectedChars / CHARS_PER_TOKEN),
    avoidedTokens: Math.ceil(avoidedChars / CHARS_PER_TOKEN),
    netChars,
    netTokens: Math.round(netChars / CHARS_PER_TOKEN),
    rewritesCostChars: Math.round(rewriteChars * (1 - discount)),
  };
}

function readPersisted(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (parsed.workspaces === null || typeof parsed.workspaces !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic-ish write: tmp + rename, so a crash never leaves a torn file. */
function writeJsonAtomic(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    // best-effort accounting — never throw into the session pipeline
    return false;
  }
}

function contentChars(content) {
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    if (typeof block.text === "string") chars += [...block.text].length;
  }
  return chars;
}

/**
 * Estimate the live prefix size a prune invalidates (in Unicode code points).
 *
 * Walks the session surface through the same accessors the host pruner uses
 * (`surface.nodes` → `eventAt` → `deriveEventMessage`). Fail-contained: an
 * unknown session shape yields 0, which makes the ledger conservative about
 * claiming savings.
 */
export function estimatePrefixChars(session) {
  try {
    const seqs = session?.surface?.nodes;
    if (seqs === void 0 || seqs === null) return 0;
    if (typeof session.eventAt !== "function" || typeof session.deriveEventMessage !== "function") return 0;
    let chars = 0;
    for (const seq of [...seqs]) {
      const event = session.eventAt(seq);
      if (event === void 0 || event === null) continue;
      const message = session.deriveEventMessage(event);
      chars += contentChars(message?.content);
    }
    return chars;
  } catch {
    return 0;
  }
}

/**
 * Create the in-memory ledger + durable rollup writer.
 *
 * @param {object} [opts]
 * @param {string} [opts.home] engram home (defaults to ~/.dsh/engram)
 * @param {number} [opts.cacheDiscount] cached-prefix price share (0..1)
 * @param {number} [opts.flushEvery] requests between durable flushes
 * @param {boolean} [opts.persist] false = pure in-memory (tests, dry runs)
 * @param {() => number} [opts.now] clock injection for tests
 * @param {object} [opts.log] optional logger (warn only)
 */
export function createLedger({
  home = path.join(os.homedir(), ".dsh", "engram"),
  cacheDiscount = DEFAULT_CACHE_DISCOUNT,
  flushEvery = DEFAULT_FLUSH_EVERY,
  persist = true,
  now = Date.now,
  log = void 0,
} = {}) {
  const file = ledgerFile(home);
  const discount = clampDiscount(cacheDiscount);
  const every = Number.isFinite(flushEvery) && flushEvery > 0 ? Math.trunc(flushEvery) : 0;
  const stored = persist ? readPersisted(file) : null;
  const state = stored ?? { version: 1, updatedAt: 0, workspaces: {} };
  const sessions = new Map();

  function ensure(sessionId, workspace) {
    if (typeof sessionId !== "string" || sessionId.length === 0) return null;
    let session = sessions.get(sessionId);
    if (session === void 0) {
      session = {
        sessionId,
        workspace: typeof workspace === "string" ? workspace : "",
        indexChars: 0,
        esrChars: 0,
        jitChars: 0,
        requests: 0,
        injectedChars: 0,
        avoidedChars: 0,
        prunedChars: 0,
        compactedChars: 0,
        rewriteCount: 0,
        rewriteChars: 0,
        flushed: { requests: 0, injectedChars: 0, avoidedChars: 0, rewriteCount: 0, rewriteChars: 0 },
        firstFlush: false,
      };
      sessions.set(sessionId, session);
    } else if (typeof workspace === "string" && workspace.length > 0) {
      session.workspace = workspace;
    }
    return session;
  }

  function bucketFor(workspace, day) {
    const ws = typeof workspace === "string" && workspace.length > 0 ? workspace : "(unknown)";
    const workspaces = state.workspaces;
    if (workspaces[ws] === void 0 || workspaces[ws] === null || typeof workspaces[ws] !== "object") {
      workspaces[ws] = {};
    }
    const days = workspaces[ws];
    if (days[day] === void 0 || days[day] === null || typeof days[day] !== "object") {
      days[day] = emptyBucket();
    } else {
      days[day] = { ...emptyBucket(), ...days[day] };
    }
    return days[day];
  }

  function flushSession(session) {
    if (session === null || session === void 0) return false;
    const delta = deltaOf(session);
    if (isEmptyDelta(delta)) return false;
    try {
      const day = ledgerDayKey(now());
      const bucket = bucketFor(session.workspace, day);
      if (session.firstFlush === false) {
        bucket.sessions += 1;
        session.firstFlush = true;
      }
      addBucket(bucket, delta);
      session.flushed = {
        requests: session.requests,
        injectedChars: session.injectedChars,
        avoidedChars: session.avoidedChars,
        rewriteCount: session.rewriteCount,
        rewriteChars: session.rewriteChars,
      };
      state.updatedAt = now();
      if (persist) writeJsonAtomic(file, state);
      return true;
    } catch (error) {
      log?.warn?.(`engram ledger flush failed: ${String(error)}`);
      return false;
    }
  }

  function flush() {
    for (const session of sessions.values()) flushSession(session);
  }

  return {
    /** Record the latest injected block size for one component. */
    noteInjection(sessionId, workspace, component, chars) {
      try {
        const session = ensure(sessionId, workspace);
        if (session === null) return;
        const size = count(chars);
        if (component === "esr") session.esrChars = size;
        else if (component === "jit") session.jitChars = size;
        else session.indexChars = size;
      } catch (error) {
        log?.warn?.(`engram ledger noteInjection failed: ${String(error)}`);
      }
    },

    /** One model request completed: charge injected chars, credit savings. */
    tick(sessionId, workspace) {
      try {
        const session = ensure(sessionId, workspace);
        if (session === null) return;
        session.requests += 1;
        session.injectedChars += session.indexChars + session.esrChars + session.jitChars;
        session.avoidedChars += session.prunedChars + session.compactedChars;
        if (every > 0 && session.requests % every === 0) flushSession(session);
      } catch (error) {
        log?.warn?.(`engram ledger tick failed: ${String(error)}`);
      }
    },

    /** A prune fired: its removed chars stop replaying from the next request. */
    notePrune(sessionId, workspace, { charsRemoved = 0, rewriteChars = 0 } = {}) {
      try {
        const session = ensure(sessionId, workspace);
        if (session === null) return;
        session.prunedChars += count(charsRemoved);
        session.rewriteCount += 1;
        session.rewriteChars += count(rewriteChars);
        flushSession(session);
      } catch (error) {
        log?.warn?.(`engram ledger notePrune failed: ${String(error)}`);
      }
    },

    /** A compaction replaced history: the saved chars stop replaying too. */
    noteCompaction(sessionId, workspace, { charsSaved = 0 } = {}) {
      try {
        const session = ensure(sessionId, workspace);
        if (session === null) return;
        session.compactedChars += count(charsSaved);
      } catch (error) {
        log?.warn?.(`engram ledger noteCompaction failed: ${String(error)}`);
      }
    },

    /**
     * A prefix rewrite that is not a prune (e.g. a JIT push appended to the
     * prompt): charge the full prefix invalidation, credit nothing.
     */
    noteRewrite(sessionId, workspace, { chars = 0 } = {}) {
      try {
        const session = ensure(sessionId, workspace);
        if (session === null) return;
        session.rewriteCount += 1;
        session.rewriteChars += count(chars);
        flushSession(session);
      } catch (error) {
        log?.warn?.(`engram ledger noteRewrite failed: ${String(error)}`);
      }
    },

    /** Session ended: fold the tail into the durable rollup and forget it. */
    dispose(sessionId) {
      try {
        const session = sessions.get(sessionId);
        if (session === void 0) return;
        flushSession(session);
        sessions.delete(sessionId);
      } catch (error) {
        log?.warn?.(`engram ledger dispose failed: ${String(error)}`);
      }
    },

    flush,

    /**
     * Read the ledger: persisted rollup + unflushed live deltas. Pure (never
     * mutates state), so /stats can call it on every request.
     */
    summary() {
      const byWorkspace = {};
      const byDay = {};

      // persisted floor
      for (const [ws, days] of Object.entries(state.workspaces ?? {})) {
        if (days === null || typeof days !== "object") continue;
        const wsBucket = (byWorkspace[ws] ??= emptyBucket());
        for (const [day, bucket] of Object.entries(days)) {
          if (bucket === null || typeof bucket !== "object") continue;
          addBucket(wsBucket, bucket);
          const dayBucket = (byDay[day] ??= emptyBucket());
          addBucket(dayBucket, bucket);
        }
      }

      // live, not-yet-flushed tail
      const today = ledgerDayKey(now());
      for (const session of sessions.values()) {
        const delta = deltaOf(session);
        if (isEmptyDelta(delta)) continue;
        const ws = session.workspace.length > 0 ? session.workspace : "(unknown)";
        const wsBucket = (byWorkspace[ws] ??= emptyBucket());
        if (session.firstFlush === false) wsBucket.sessions += 1;
        addBucket(wsBucket, delta);
        const dayBucket = (byDay[today] ??= emptyBucket());
        if (session.firstFlush === false) dayBucket.sessions += 1;
        addBucket(dayBucket, delta);
      }

      const totals = emptyBucket();
      for (const bucket of Object.values(byWorkspace)) addBucket(totals, bucket);

      const finalizedWorkspaces = {};
      for (const [ws, bucket] of Object.entries(byWorkspace)) {
        finalizedWorkspaces[ws] = finalizeLedgerBucket(bucket, discount);
      }
      const finalizedDays = Object.entries(byDay)
        .map(([day, bucket]) => ({ day, ...finalizeLedgerBucket(bucket, discount) }))
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

      return {
        version: 1,
        updatedAt: state.updatedAt ?? 0,
        charsPerToken: CHARS_PER_TOKEN,
        cacheDiscount: discount,
        openSessions: sessions.size,
        totals: finalizeLedgerBucket(totals, discount),
        byWorkspace: finalizedWorkspaces,
        byDay: finalizedDays,
      };
    },
  };
}

/** Read the durable ledger without creating a live instance (GUI / tests). */
export function readLedger({ home, cacheDiscount = DEFAULT_CACHE_DISCOUNT } = {}) {
  const stored = readPersisted(ledgerFile(home));
  const workspaces = {};
  const days = {};
  if (stored !== null) {
    for (const [ws, wsDays] of Object.entries(stored.workspaces)) {
      if (wsDays === null || typeof wsDays !== "object") continue;
      const wsBucket = (workspaces[ws] ??= emptyBucket());
      for (const [day, bucket] of Object.entries(wsDays)) {
        if (bucket === null || typeof bucket !== "object") continue;
        addBucket(wsBucket, bucket);
        addBucket((days[day] ??= emptyBucket()), bucket);
      }
    }
  }
  const totals = emptyBucket();
  for (const bucket of Object.values(workspaces)) addBucket(totals, bucket);
  return {
    version: 1,
    updatedAt: stored?.updatedAt ?? 0,
    charsPerToken: CHARS_PER_TOKEN,
    cacheDiscount: clampDiscount(cacheDiscount),
    totals: finalizeLedgerBucket(totals, cacheDiscount),
    byWorkspace: Object.fromEntries(
      Object.entries(workspaces).map(([ws, bucket]) => [ws, finalizeLedgerBucket(bucket, cacheDiscount)]),
    ),
    byDay: Object.entries(days)
      .map(([day, bucket]) => ({ day, ...finalizeLedgerBucket(bucket, cacheDiscount) }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
  };
}
