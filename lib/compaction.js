/**
 * dsh-engram — Context GC as a mountable HOST plugin entry (agent-preset row).
 *
 * Web/agent-preset compositions keep compaction on the AGENT plane: the
 * `standard` preset (and friends) mount `@deepseek-ai/dsh-compaction-basic`
 * inside a `compaction` group carrying its own isolate realm. A host-plane row
 * cannot reach that realm, so replacing the default summarizer per-session
 * needs a row that can be listed IN the preset's `compaction` group:
 *
 * ```yaml
 * - id: compaction
 *   name: cordis:group
 *   group: true
 *   isolate:
 *     compaction: true
 *     toolResultPruner: true
 *   config:
 *     - id: engram-compaction
 *       name: dsh-engram/compaction        # this entry
 *     - id: command-compact
 *       name: '@deepseek-ai/dsh-command-compact'
 *     ...
 * ```
 *
 * Config (all optional): `gcReplacesCompaction` (true → Context GC; false →
 * plain BasicCompactionEngine), `gcNarrative`, `gcNarrativeMaxTokens`,
 * `gcNarrativeMaxChars`. Values default to the plugin DEFAULTS.
 *
 * The engine reads engram/ESR state through the storage-domain service shared
 * with the host plane (best-effort reads for pointer classification — the
 * entry never writes).
 */
import { openEngramDomain } from "./store.js";
import { mountCompactionEngine, collectPointerContext } from "./context-gc.js";
import { workspaceKey as wk } from "./util.js";

export const name = "dsh-engram-compaction";
export const inject = ["llm", "tokenMeter", "sessions"];

/** One cached domain per storage-domain service (read-only for compaction). */
const domains = new WeakMap();

async function domainFor(ctx) {
  const storageDomain = ctx.get("storageDomain");
  if (!storageDomain) return null;
  let domain = domains.get(storageDomain);
  if (!domain) {
    domain = await openEngramDomain(storageDomain).catch(() => null);
    if (domain) domains.set(storageDomain, domain);
  }
  return domain;
}

export function apply(ctx, config = {}) {
  const mode = config.gcReplacesCompaction === false ? "default" : "context-gc";
  const deps =
    mode === "context-gc"
      ? {
          readWorkspace: async (workspace, report) => {
            if (!workspace) return null;
            const domain = await domainFor(ctx);
            if (!domain) return null;
            return collectPointerContext(domain, wk(workspace), report);
          },
        }
      : {};

  return mountCompactionEngine(ctx, config, deps);
}
