/**
 * dsh-engram — BoundaryPrune (L1) as a mountable entry INSIDE the agent preset.
 *
 * Why this entry exists: web sessions live in the agent preset's own realm, and
 * their `session/event`s are only observed by plugins mounted in that realm.
 * The host-plane install armed fine (`boundaryPrune.armed: true`) and still never
 * fired across every session on the profile: the listener was on the wrong side
 * of the realm boundary, so a real `todo/write` boundary produced nothing — the
 * ledger's prune credit leg was structurally dead for `dsh web`.
 *
 * This row sits in the same `compaction` group as `dsh-engram/compaction`
 * (which already isolates `toolResultPruner` for the agent plane), so it sees
 * the sessions' events and holds that realm's pruner:
 *
 * ```yaml
 * - id: compaction
 *   name: cordis:group
 *   group: true
 *   isolate: { compaction: true, toolResultPruner: true }
 *   config:
 *     - id: engram-compaction
 *       name: dsh-engram/compaction
 *     - id: engram-prune
 *       name: dsh-engram/prune        # this entry
 *     - id: command-compact
 *       name: '@deepseek-ai/dsh-command-compact'
 *     - id: tool-result-pruner
 *       name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
 * ```
 *
 * The host plugin still installs its own L1 for host-plane (headless/TUI)
 * sessions. Running both is safe: `toolResultPruner.pruneSession` only prunes
 * over-threshold results, so a second pass over an already-pruned surface finds
 * nothing and credits nothing.
 *
 * Config: the same keys the host entries read (`boundaryPrune`,
 * `boundaryPruneMinRemaining`, `boundaryPruneThresholdChars`,
 * `boundaryPruneHeadChars`, `boundaryPruneTailChars`,
 * `boundaryPruneIdleCadence`, `boundaryPruneAdaptive`). Ledger credit goes
 * through the host-provided `engramLedger` service so there is exactly one
 * ledger writer.
 */
import { installBoundaryPrune, boundaryPruneAvailability } from "./boundary-prune.js";
import { estimatePrefixChars } from "./ledger.js";
import { recordBoundaryPruneFire, engramHome } from "./pack-telemetry.js";
import { recordPruneAttempt } from "./status.js";
import { workspaceKey as wk } from "./util.js";

export const name = "dsh-engram-prune";
export const inject = ["toolResultPruner"];

/** The plane tag every attempt from this entry carries. */
export const PLANE = "preset";

export function apply(ctx, config = {}) {
  const log = typeof ctx?.logger === "function" ? ctx.logger("dsh-engram-prune") : undefined;

  // Diagnostics first: proves the row loaded at all (a row that fails to load
  // looks exactly like one that works, until nothing ever fires).
  try {
    ctx.logger?.info?.(`engram boundary-prune (preset plane): ${boundaryPruneAvailability(ctx, config).reason ?? "armed"}`);
  } catch { /* never break the mount for a log line */ }

  const hooks = {
    onPruned: (session, report, boundary) => {
      const workspace = wk(session?.header?.cwd);
      // Durable activation telemetry (shared with the host plane; the summary
      // reports `activation.boundaryPrune` from it).
      recordBoundaryPruneFire({ home: engramHome(), boundary, report, workspace });
      // The prune rewrote the prefix: credit the removed chars, price the
      // invalidation with the pre-prune size (mirrors the host-plane path).
      const removed = Number.isFinite(report?.charsRemoved) ? report.charsRemoved : 0;
      const prefixChars = estimatePrefixChars(session);
      try {
        const ledger = ctx.get?.("engramLedger");
        ledger?.notePrune?.(session?.id, workspace, {
          charsRemoved: removed,
          rewriteChars: prefixChars + removed,
        });
      } catch { /* accounting must never break pruning */ }
    },
  };

  return installBoundaryPrune(ctx, config, log, hooks, {
    onAttempt: (attempt) => {
      void recordPruneAttempt({ plane: PLANE, ...attempt });
    },
  });
}
