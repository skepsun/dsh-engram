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
  const storageDomain = ctx.get("storageDomain");
  const sessionQuery = ctx.get("sessionQuery");

  let domainPromise;
  let opened;
  const getDomain = () => {
    if (storageDomain === void 0) {
      return Promise.reject(
        new Error("the storage-domain facility is not available in this profile — loom memory is disabled here"),
      );
    }
    domainPromise ??= openLoomDomain(storageDomain).then((domain) => {
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
      if (storageDomain !== void 0) getDomain().catch(() => {});
    },
    sessionQuery,
    log,
    /** Cumulative auto-capture totals (GUI overview observability). */
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
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
