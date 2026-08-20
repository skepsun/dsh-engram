/**
 * dsh-engram: real-data agent-behaviour observability.
 *
 * Every engram_* / esr_* tool call made by the model is recorded into the
 * store's per-(workspace, day) `usage` rollup: counts per tool, failures,
 * and recall mechanics. The GUI (`/api/dsh-engram/stats`) turns that into the
 * "proactive ESR ratio" and "recall hit rate" numbers — real measurements
 * from real sessions, not a static benchmark.
 *
 * Zero-dependency, fire-and-forget: recording must never disturb the tool
 * pipeline, so callers use `void record(...).catch(() => {})`.
 */

import { workspaceKey as wk } from "./util.js";

/** Local YYYY-MM-DD, so daily rollups land on calendar days for the user. */
export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Count recalled memory rows from a engram_recall output string. The tool
 * renders one `- <id> …` line per item (or a `no active memories…` / `no
 * memories for entity…` message on zero hits); we parse that shape.
 */
export function recallStatsFromOutput(out) {
  const s = String(out ?? "");
  if (/^\s*(no active memories|no memories for entity)/i.test(s)) {
    return { withHits: 0, hitsTotal: 0 };
  }
  const hitsTotal = (s.match(/\n- /g) ?? []).length + (s.startsWith("- ") ? 1 : 0);
  return { withHits: hitsTotal > 0 ? 1 : 0, hitsTotal };
}

/** Session-local drill-through window: a engram_detail within N events of a hit recall counts as a follow-up. */
const DETAIL_FOLLOW_WINDOW = 8;

/**
 * One tracker per plugin instance. Holds the cross-call state used to infer
 * "recall → detail drill-through" from the raw tool stream.
 */
export function makeUsageTracker() {
  const recallFresh = new Map(); // sessionId -> event seq of last hit recall

  return {
    /**
     * Record one tool-call outcome. `opts`: { ok, recallOutput? }.
     * Resolves the caller from `exec` exactly like tools.js `callerOf`. Returns
     * a promise; callers should fire-and-forget it.
     */
    async record(service, exec, name, opts) {
      const agent = exec?.agent;
      if (agent === void 0) return;
      const rawCwd = agent.session?.header?.cwd;
      const sessionId = agent.session?.id;
      if (rawCwd === void 0 || rawCwd.length === 0 || sessionId === void 0) return;
      const workspace = wk(rawCwd);
      const seq = agent.session?.events?.length ?? 0;

      const counts = { [name]: 1 };
      const recall = {};
      if (name === "engram_recall") {
        if (opts.ok) {
          const { withHits, hitsTotal } = recallStatsFromOutput(opts.recallOutput);
          recall.queries = 1;
          recall.withHits = withHits;
          recall.hitsTotal = hitsTotal;
          if (withHits > 0) recallFresh.set(sessionId, seq);
          else recallFresh.delete(sessionId);
        } else {
          recallFresh.delete(sessionId);
        }
      } else if (name === "engram_detail" && opts.ok && recallFresh.has(sessionId)) {
        const at = recallFresh.get(sessionId);
        if (seq - at <= DETAIL_FOLLOW_WINDOW) {
          recall.detailFollows = 1;
          recallFresh.delete(sessionId);
        }
      }

      try {
        const domain = await service.getDomain();
        await domain.bumpUsage(workspace, dayKey(), {
          counts,
          failures: opts.ok ? 0 : 1,
          recall,
        });
      } catch (error) {
        // observability is best-effort; a store hiccup must not surface here
        service?.log?.warn?.(`engram usage record failed: ${String(error)}`);
      }
    },
  };
}