/**
 * dsh-loom — minimalist pi-loom × pi-esr memory for DeepSeek Harness.
 *
 * Host-half plugin only, no browser half, no external servers.
 *   - zero-LLM auto-capture from tool results (tools/result)
 *   - a compact, per-session-frozen [LOOM] symbolic index injected through a
 *     systemPrompt section (order 40) — prefix-stable for KV cache reuse
 *   - an [ESR] task/closure block (order 41) listing evidence gaps
 *   - six tight tools: loom_store / loom_recall / loom_detail / esr_task /
 *     esr_close / esr_link
 *   - storage on ctx.storageDomain (JSON unit dsh_loom), reads synchronous
 *
 * All model-visible writes are immediate (no approval gate — zero friction,
 * fully auditable through the session log provenance). Reads never call a
 * model. The only optional model-free dependency is ctx.sessionQuery for the
 * `search_sessions` FTS fallback.
 */

import { resolve as resolvePath } from "node:path";
import { openLoomDomain } from "./store.js";
import { registerTools } from "./tools.js";
import { makeCaptureHandler } from "./capture.js";
import { renderIndex, renderEsr } from "./index-block.js";
import { installLoomSettings } from "./settings.js";
import { makeLoomRoutes } from "./api.js";

/** Stable cordis plugin name. */
export const name = "loom";

/** Tools must exist before any registration. */
export const inject = ["tools"];

/** Defaults; every key can be overridden via profile patch config. */
const DEFAULTS = {
  enabled: true,
  // intake
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  // recall
  sessionSearch: true,
  // [LOOM] index budget (token discipline)
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  // retention / caps
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
  // memory GC (pi-esr constraints, archive-only)
  gcEnabled: true,
  gcIntervalHours: 24,
  gcStableRetentionDays: 120,
  // GUI access: hostnames allowed past the loopback fence for /api/dsh-loom
  // (e.g. an operator-authorized cloudflare tunnel). Empty = loopback-only.
  trustedHosts: [],
  // prompt section order (before the persona/tools bands per DSH convention)
  loomIndexOrder: 40,
  esrOrder: 41,
};

function resolveConfig(config) {
  const src = config && typeof config === "object" ? config : {};
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (src[key] !== void 0) out[key] = src[key];
  }
  return out;
}

/**
 * Mount the plugin. `ctx` is the scoped cordis context; `config` the optional
 * resolved plugin config (plain object from the profile patch).
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config);
  if (!resolved.enabled) return;

  const log = ctx.logger ? ctx.logger("loom") : undefined;
  const sessionQuery = ctx.get("sessionQuery");

  // `storageDomain` is provided asynchronously by the storage-domain row —
  // its apply awaits a json backend via ctx.inject before providing the
  // facility, and the loader starts rows concurrently. Snapshotting it here
  // freezes `undefined` forever when the provide lands right after this
  // apply (consistently the case on slower machines like Windows). Resolve it
  // lazily through cordis's inject instead, with a bounded fallback so a
  // genuinely facility-less profile still surfaces the friendly disabled
  // message rather than hanging every request.
  const storageDomainPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const current = ctx.get("storageDomain");
      if (current !== void 0) resolve(current);
      else {
        reject(
          new Error("the storage-domain facility is not available in this profile — loom memory is disabled here"),
        );
      }
    }, 10_000);
    ctx.inject(["storageDomain"], (scoped) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(scoped.get("storageDomain") ?? ctx.get("storageDomain"));
    });
  });

  let domainPromise;
  let opened;
  const getDomain = () => {
    domainPromise ??= storageDomainPromise.then((storageDomain) => openLoomDomain(storageDomain)).then((domain) => {
      opened = domain;
      return domain;
    });
    return domainPromise;
  };

  const service = {
    config: resolved,
    getDomain,
    openedDomain: () => opened,
    ensureDomain: () => {
      getDomain().catch(() => {});
    },
    sessionQuery,
    log,
    /** Cumulative auto-capture totals (GUI overview observability). */
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    /** Last GC sweep totals (GUI overview observability). */
    gcStats: { lastRun: 0, archivedMemories: 0, archivedTasks: 0, removedLinks: 0 },
    /** Recompute the exact [LOOM] block for a workspace (GUI overview cost). */
    renderIndexBlock(workspace) {
      if (opened === void 0) return "";
      try {
        return renderIndex(opened, workspace, workspace, resolved);
      } catch {
        return "";
      }
    },
  };

  // Mechanical, archive-only memory GC (pi-esr constraints). Runs the first
  // sweep once the store is reachable, then on the configured interval. Every
  // entry archived stays re-fetchable — nothing is hard-deleted by GC.
  const runGcAll = async () => {
    if (!resolved.gcEnabled) return;
    try {
      const domain = await getDomain();
      const report = await domain.gc(void 0, resolved, { dryRun: false });
      service.gcStats.lastRun = Date.now();
      service.gcStats.archivedMemories += report.archivedMemories.length;
      service.gcStats.archivedTasks += report.archivedTasks.length;
      service.gcStats.removedLinks += report.removedLinks.length;
      if (report.archivedMemories.length + report.archivedTasks.length + report.removedLinks.length > 0) {
        log?.info?.(`loom gc: ${report.archivedMemories.length} memories archived, ${report.archivedTasks.length} tasks, ${report.removedLinks.length} links removed`);
      }
    } catch (error) {
      log?.warn?.(`loom gc sweep failed: ${String(error)}`);
    }
  };

  // User settings (web GUI card): merges stored values onto the live config.
  // Non-blocking — when the settings service is absent this never runs.
  installLoomSettings(ctx, resolved, resolved);

  // Web API for the GUI: deferred on the webServer service, so headless
  // profiles keep running the plugin without it. `register` returns the
  // disposer immediately (the dsh-ssh family does the same).
  ctx.inject(["webServer"], (webCtx) => {
    const routes = makeLoomRoutes(service);
    const disposers = [];
    for (const route of routes) {
      try {
        disposers.push(webCtx.webServer.register(route));
      } catch {}
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {}
      }
    };
  });

  // Per-session frozen blocks: render once, then reuse — prefix stability is
  // the point (KV cache). New session (or resumed reload) object → fresh block.
  const sessionCache = new WeakMap();
  const blockFor = (agent) => {
    if (agent === void 0) return "";
    const session = agent.session;
    if (session === void 0) return "";
    const cwd = session.header?.cwd;
    if (cwd === void 0 || cwd.length === 0) return "";
    const cached = sessionCache.get(session);
    if (cached !== void 0) return cached;
    if (opened === void 0) {
      service.ensureDomain();
      return "";
    }
    let block = "";
    try {
      const workspace = resolvePath(cwd);
      block = renderIndex(opened, workspace, cwd, resolved);
    } catch (error) {
      log?.warn?.(`loom index render failed: ${String(error)}`);
    }
    sessionCache.set(session, block);
    return block;
  };

  ctx.effect(() => {
    const disposers = [];

    // tools
    disposers.push(registerTools(ctx, service));

    // systemPrompt sections (frozen per session)
    const systemPrompt = ctx.get("systemPrompt");
    if (systemPrompt !== void 0) {
      const indexDispose = systemPrompt.section({
        name: "loom:index",
        order: resolved.loomIndexOrder,
        text: (assemblyContext) => {
          const agent = assemblyContext?.agent;
          if (agent === void 0) return "";
          const session = agent.session;
          if (session === void 0) return "";
          const cwd = session.header?.cwd;
          if (cwd === void 0 || cwd.length === 0) return "";
          return blockFor(agent);
        },
      });
      disposers.push(() => indexDispose());

      const esrDispose = systemPrompt.section({
        name: "loom:esr",
        order: resolved.esrOrder,
        text: (assemblyContext) => {
          const agent = assemblyContext?.agent;
          if (agent === void 0) return "";
          const session = agent.session;
          if (session === void 0) return "";
          const cwd = session.header?.cwd;
          if (cwd === void 0 || cwd.length === 0) return "";
          if (opened === void 0) return "";
          try {
            return renderEsr(opened, resolvePath(cwd), resolved);
          } catch {
            return "";
          }
        },
      });
      disposers.push(() => esrDispose());
    }

    // zero-LLM auto-capture
    if (resolved.autoCapture) {
      // The capture handler needs a storeMemory face, but the domain opens
      // lazily. The adapter resolves it per call and drops events that arrive
      // before the first open (rate buckets still counted, so nothing is lost
      // once the domain is up).
      const captureStore = {
        storeMemory(...args) {
          const domain = service.openedDomain();
          if (domain === void 0) {
            service.ensureDomain();
            return Promise.reject(new Error("loom domain not open yet"));
          }
          return domain.storeMemory(...args);
        },
      };
      const capture = makeCaptureHandler(captureStore, resolved, log, service.captureStats);
      const disposeCapture = ctx.on("tools/result", (exec, result) => {
        capture(exec, result);
      });
      disposers.push(disposeCapture);
    }

    // memory GC scheduling: one sweep after the store is reachable, then on
    // the configured interval (cordis clears ctx-set timers on dispose).
    // Guard against a boot-order race: ctx.setInterval routes through the
    // `timer` service, which may not be injected yet at apply time, and an
    // unguarded read crashes the whole server (`cannot get property "timer"
    // without inject`). Fall back to a global interval; GC is best-effort.
    getDomain()
      .then(() => {
        setTimeout(() => void runGcAll(), 0);
      })
      .catch(() => {});
    const gcMs = Math.max(1, resolved.gcIntervalHours) * 60 * 60 * 1000;
    let gcDispose;
    try {
      gcDispose = ctx.setInterval(() => void runGcAll(), gcMs);
    } catch {
      gcDispose = undefined;
    }
    if (gcDispose === undefined) {
      const gcHandle = globalThis.setInterval(() => void runGcAll(), gcMs);
      gcDispose = () => globalThis.clearInterval(gcHandle);
    }
    disposers.push(gcDispose);

    return async () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {}
      }
      if (domainPromise !== void 0) {
        try {
          await (await domainPromise).close();
        } catch {}
      }
    };
  });
}
