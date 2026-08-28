/**
 * dsh-engram — minimalist symbolic-index × pi-esr memory for DeepSeek Harness.
 *
 * Host-half plugin only, no browser half, no external servers.
 *   - zero-LLM auto-capture from tool results (tools/result)
 *   - a compact, per-session-frozen [ENGRAM] symbolic index injected through a
 *     systemPrompt section (order 40) — prefix-stable for KV cache reuse
 *   - an [ESR] task/closure block (order 41) listing evidence gaps
 *   - fourteen tight tools: memory plane (engram_store / engram_recall /
 *     engram_detail) + ESR protocol (esr_task / esr_close / esr_link / esr_dep /
 *     esr_claim / esr_unclaim / esr_ready / esr_status / esr_node / esr_gc /
 *     esr_model)
 *   - storage on ctx.storageDomain (JSON unit dsh_engram), reads synchronous
 *
 * All model-visible writes are immediate (no approval gate — zero friction,
 * fully auditable through the session log provenance). Reads never call a
 * model. The only optional model-free dependency is ctx.sessionQuery for the
 * `search_sessions` FTS fallback.
 */

import { resolve as resolvePath } from "node:path";
import { openEngramDomain } from "./store.js";
import { registerTools } from "./tools.js";
import { makeCaptureHandler } from "./capture.js";
import { installGoalCapture } from "./goal-capture.js";
import { renderIndex, renderEsr, esrMethodology, buildEsrSnapshot, buildFrozenEsrBlock } from "./index-block.js";
import { makeTriggerRecorder } from "./trigger.js";
import { pendingTodosFromSession, sinkPendingTodos } from "./todo-sink.js";
import { installEngramSettings } from "./settings.js";
import { makeEngramRoutes } from "./api.js";
import { collectPointerContext, mountCompactionEngine } from "./context-gc.js";
import { provisionWebCompaction } from "./web-provision.js";
import { writeContextGcStatus } from "./status.js";
import { workspaceKey as wk } from "./util.js";

/** Stable cordis plugin name. */
export const name = "engram";

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
  // session-diversified recall: max memories per session before cross-session
  // evidence takes over (agentmemory 候选①; "few and precise")
  maxRecallPerSession: 3,
  // [ENGRAM] index budget (token discipline)
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
  // Context GC — the auto-GC that REPLACES DSH's built-in lossy LLM-summary
  // compaction (pi-esr CONTEXT_GC): mechanical eviction + re-fetch pointers,
  // NOT the memory-panel GC above. `gcReplacesCompaction` off → the host keeps
  // its default compaction backend; `gcNarrative` off → fully mechanical.
  gcReplacesCompaction: true,
  gcNarrative: true,
  gcNarrativeMaxTokens: 1024,
  gcNarrativeMaxChars: 4000,
  // GUI access: hostnames allowed past the loopback fence for /api/dsh-engram
  // (e.g. an operator-authorized cloudflare tunnel). Empty = loopback-only.
  trustedHosts: [],
  // ESR evidence hardening: a non-URL artifact must exist on disk (relative
  // artifacts resolve against the workspace = the session cwd DSH provides).
  // esr_close's force:true bypasses this existence check.
  verifyArtifact: true,
  // prompt section order (before the persona/tools bands per DSH convention)
  engramIndexOrder: 40,
  esrMethodOrder: 40.5, // static ESR protocol section (byte-identical every turn)
  esrOrder: 41,
  // decision-point triggers (P0-A): promote a session plan to an ESR task
  // when the pending-todo count is at least minTodosForPromote and exceeds
  // active ESR tasks × todoPromoteRatio (default: pending > active).
  minTodosForPromote: 2,
  todoPromoteRatio: 1,
  // P0-B: an error memory becomes a root-cause task candidate at this many
  // repeat-failure hits.
  minErrorHits: 2,
  // P3: an active task with no update for this many days is surfaced as stale.
  staleTaskDays: 14,
  // Session-end todo continuity (audit follow-up): when a session is disposed
  // while its plan still has pending todos, auto-sink them into ESR as DRAFT
  // tasks (deduped by name, capped by maxTasksPerWorkspace). During the session
  // nothing is auto-written — todo stays cheap/ephemeral and the [ESR] prefix
  // stays stable; the sink only lands drafts, which still need the deliberate
  // esr_claim / esr_task step to become active.
  autoSinkTodosOnEnd: true,
  // Web-plane auto-wiring for Context GC: web sessions resolve `compaction`
  // inside the agent preset's own realm, which a profile patch cannot reach,
  // so the plugin edits every stock-layout preset's `compaction` group once —
  // the default preset plus the whole roster (shipped + user roots) — swapping
  // the `compaction-basic` row for `dsh-engram/compaction` (backup + strict
  // validation + idempotent; a preset with a custom compaction layout — or
  // none, like `minimal` — is never touched). Off = every preset keeps DSH's
  // default LLM summarizer; the host plane (headless/TUI/base) is unaffected.
  autoWebCompaction: true,
  // Memory-to-memory semantics (zero LLM): when ON, an entity-anchored write
  // that carries a replacement/negation cue ("改用 / no longer / switched…")
  // auto-marks the matching older same-entity+kind memory as superseded.
  // OFF by default — explicit `supersedes` is always the primary path.
  autoSupersede: false,
};

export function resolveConfig(config) {
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

  const log = ctx.logger ? ctx.logger("engram") : undefined;
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
          new Error("the storage-domain facility is not available in this profile — engram memory is disabled here"),
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
    domainPromise ??= storageDomainPromise.then((storageDomain) => openEngramDomain(storageDomain)).then((domain) => {
      opened = domain;
      return domain;
    });
    return domainPromise;
  };

  // Decision-point triggers (P0-A + P1): live mem-vs-esr balance + the
  // todo_write promote hook. Process-local; fed by a tools/result listener.
  const recorder = makeTriggerRecorder(resolved);

  const service = {
    config: resolved,
    getDomain,
    openedDomain: () => opened,
    recorder,
    ensureDomain: () => {
      getDomain().catch(() => {});
    },
    sessionQuery,
    log,
    /** Cumulative auto-capture totals (GUI overview observability). */
    captureStats: { total: 0, git: 0, file: 0, error: 0 },
    /** Last GC sweep totals (GUI overview observability). */
    gcStats: { lastRun: 0, archivedMemories: 0, archivedTasks: 0, removedLinks: 0 },
    /** Live Context GC status (API overview + durable status file). */
    compactionStatus: {
      host: "pending",
      web: { action: "pending", presets: [] },
      config: { autoWebCompaction: resolved.autoWebCompaction, gcReplacesCompaction: resolved.gcReplacesCompaction, gcNarrative: resolved.gcNarrative },
    },
    /** Recompute the exact [ENGRAM] block for a workspace (GUI overview cost). */
    renderIndexBlock(workspace) {
      if (opened === void 0) return "";
      try {
        return renderIndex(opened, workspace, workspace, resolved);
      } catch {
        return "";
      }
    },
    /** Recompute the exact [ESR] snapshot for a workspace (GUI inject preview). */
    renderEsrBlock(workspace) {
      if (opened === void 0) return "";
      try {
        return renderEsr(opened, workspace, resolved);
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
        log?.info?.(`engram gc: ${report.archivedMemories.length} memories archived, ${report.archivedTasks.length} tasks, ${report.removedLinks.length} links removed`);
      }
    } catch (error) {
      log?.warn?.(`engram gc sweep failed: ${String(error)}`);
    }
  };

  // User settings (web GUI card): merges stored values onto the live config.
  // Non-blocking — when the settings service is absent this never runs.
  installEngramSettings(ctx, resolved, resolved);

  // Web API for the GUI: deferred on the webServer service, so headless
  // profiles keep running the plugin without it. `register` returns the
  // disposer immediately (the dsh-ssh family does the same).
  ctx.inject(["webServer"], (webCtx) => {
    const routes = makeEngramRoutes(service);
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

  // [ENGRAM] block: render once, then reuse — prefix stability is the point
  // (KV cache). New session (or resumed reload) object → fresh block. The
  // [ESR] block below follows the same frozen-snapshot rule but additionally
  // accumulates this-session actionables (see esrBlockFor).
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
      log?.warn?.(`engram index render failed: ${String(error)}`);
    }
    sessionCache.set(session, block);
    return block;
  };

  // [ESR] block = FROZEN snapshot + this-session's monotonically accumulated
  // actionables (promote/root-cause/close/stale/escalate).
  //   - The snapshot is rendered ONCE at the first assembly of the session and
  //     cached per session (pi-esr rule 2: injected once, never
  //     auto-refreshed) — tasks created/updated mid-session surface via
  //     `esr_status`, not by re-rendering this block.
  //   - An actionable is APPENDED exactly once, the moment it first matures
  //     (recorder-fed, one-shot via esrHintLines), then stays frozen — the
  //     prefix therefore changes only when genuinely new decision-point info
  //     exists, never per-turn.
  const esrSnapshotCache = new WeakMap();  // session -> frozen snapshot text
  const esrSessionHolders = new WeakMap(); // session -> { actionables: Map<kind,line> }
  const esrBlockFor = (agent) => {
    if (agent === void 0) return "";
    const session = agent.session;
    if (session === void 0) return "";
    const cwd = session.header?.cwd;
    if (cwd === void 0 || cwd.length === 0) return "";
    if (opened === void 0) return "";
    let snapshot = esrSnapshotCache.get(session);
    if (snapshot === void 0) {
      try {
        snapshot = buildEsrSnapshot(opened, resolvePath(cwd), resolved, { sessionId: session.id });
      } catch (error) {
        log?.warn?.(`engram esr render failed: ${String(error)}`);
        return "";
      }
      esrSnapshotCache.set(session, snapshot);
    }
    let holder = esrSessionHolders.get(session);
    if (holder === void 0) {
      holder = { actionables: new Map() };
      esrSessionHolders.set(session, holder);
    }
    let block = "";
    try {
      block = buildFrozenEsrBlock(opened, resolvePath(cwd), resolved, {
        recorder,
        sessionId: session.id,
        holder,
        snapshot,
      });
    } catch (error) {
      log?.warn?.(`engram esr render failed: ${String(error)}`);
    }
    return block;
  };

  ctx.effect(() => {
    const disposers = [];

    // tools
    disposers.push(registerTools(ctx, service));

    // Context GC (host plane) — the auto-GC that REPLACES DSH's built-in
    // lossy LLM-summary compaction. Mounts the `compaction` service on THIS
    // fiber (cordis removes it again when the fiber tears down, so reloading /
    // unloading engram rolls back automatically). The profile patch disables
    // the base `compaction-basic` row, making engram the sole provider:
    // `gcReplacesCompaction:true` (default) → ContextGcEngine; `false` → a bare
    // BasicCompactionEngine so the `compaction` service never disappears while
    // dsh-engram is installed. Web profiles mount per-session compaction inside
    // the agent preset's own realm (see README); this host-plane provider
    // covers headless/TUI/base profiles and any host-plane consumer.
    const hostCompactionPromise = mountCompactionEngine(ctx, resolved, {
      readWorkspace: async (workspace, report) => {
        if (!workspace) return null;
        try {
          const domain = await service.getDomain();
          return collectPointerContext(domain, wk(workspace), report);
        } catch {
          return null;
        }
      },
    });
    disposers.push(() => {
      // The engine's service registration is fiber-scoped and auto-removed on
      // teardown; this only settles the async mount and surfaces late errors.
      void hostCompactionPromise.catch(() => {});
    });

    // Context GC status: record the settled host/web facts and flush a durable
    // snapshot to $DSH_HOME/engram/context-gc.status.json once BOTH planes have
    // settled (the web inject may never fire on a profile without agentPresets,
    // so a bounded timer marks the web plane done for host-only profiles).
    let hostSettled = false;
    let webSettled = resolved.autoWebCompaction === false;
    let statusTimer = void 0;
    const flushStatus = () => {
      if (!hostSettled || !webSettled) return;
      if (statusTimer !== void 0) { clearTimeout(statusTimer); statusTimer = void 0; }
      void writeContextGcStatus({
        planes: resolved.autoWebCompaction === false ? ["host"] : ["host", "web"],
        host: service.compactionStatus.host,
        web: service.compactionStatus.web,
        config: service.compactionStatus.config,
        configSource: {
          autoWebCompaction: resolved.autoWebCompaction,
          gcReplacesCompaction: resolved.gcReplacesCompaction,
          gcNarrative: resolved.gcNarrative,
        },
      }).catch(() => {});
    };
    void hostCompactionPromise
      .then((Engine) => {
        hostSettled = true;
        service.compactionStatus.host = Engine
          ? (resolved.gcReplacesCompaction ? "context-gc" : "default")
          : "unavailable";
        flushStatus();
      })
      .catch(() => {
        hostSettled = true;
        service.compactionStatus.host = "unavailable";
        flushStatus();
      });

    // Web-plane auto-wiring (Context GC): web sessions resolve `compaction`
    // inside the agent preset's own realm, which a profile patch cannot reach.
    // When the `agentPresets` service is present, swap the stock
    // `compaction-basic` row for `dsh-engram/compaction` in every stock-layout
    // preset — the default one plus the whole roster (shipped + user roots) —
    // so a session composed from any preset gets Context GC. Surgical,
    // idempotent, backed up, validated; a preset with a custom compaction
    // layout (or none) is never touched. The row's engine config is derived
    // from the settings knobs (`gcReplacesCompaction` / `gcNarrative`), so
    // changing them re-provisions the web rows on the next boot. Flip
    // `autoWebCompaction:false` to stop auto-wiring on later boots (it does
    // not un-wire already-wired presets — use `npm run web-compaction:revert`
    // for that). Best-effort: a failure only warns.
    if (resolved.autoWebCompaction !== false) {
      ctx.inject(["agentPresets"], (webCtx) => {
        const agentPresets = webCtx.get("agentPresets");
        provisionWebCompaction(agentPresets, {
          rowConfig: {
            gcReplacesCompaction: resolved.gcReplacesCompaction,
            gcNarrative: resolved.gcNarrative,
          },
          log: (line) => webCtx.logger.info(line),
        })
          .then((report) => {
            webSettled = true;
            service.compactionStatus.web = { action: report.action, presets: report.presets };
            flushStatus();
          })
          .catch((error) => {
            webSettled = true;
            service.compactionStatus.web = { action: "failed", presets: [], error: String(error?.message ?? error) };
            webCtx.logger.warn(`engram web-provision failed: ${String(error?.message ?? error)}`);
            flushStatus();
          });
      });
      // Host-only profiles never provide `agentPresets`; settle the web plane
      // after a bounded wait so the status flush still happens there.
      statusTimer = setTimeout(() => {
        if (!webSettled) {
          webSettled = true;
          flushStatus();
        }
      }, 15_000);
      setTimeout(() => { statusTimer = void 0; }, 16_000);
    } else {
      flushStatus();
    }

    // systemPrompt sections (frozen per session)
    const systemPrompt = ctx.get("systemPrompt");
    if (systemPrompt !== void 0) {
      const indexDispose = systemPrompt.section({
        name: "engram:index",
        order: resolved.engramIndexOrder,
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

      // Static ESR protocol (pi-esr rule 1): byte-identical every turn, so
      // the model never depends on runtime nudges to know WHEN to use ESR.
      const esrMethodDispose = systemPrompt.section({
        name: "engram:esr-method",
        order: resolved.esrMethodOrder,
        text: () => esrMethodology(),
      });
      disposers.push(() => esrMethodDispose());

      const esrDispose = systemPrompt.section({
        name: "engram:esr",
        order: resolved.esrOrder,
        text: (assemblyContext) => {
          const agent = assemblyContext?.agent;
          if (agent === void 0) return "";
          return esrBlockFor(agent);
        },
      });
      disposers.push(() => esrDispose());
    }

    // decision-point triggers: always on (independent of autoCapture) —
    // feeds the live mem-vs-esr balance and the todo_write promote hint.
    const disposeTrigger = ctx.on("tools/result", (exec, result) => {
      recorder.handle(exec, result);
    });
    disposers.push(disposeTrigger);

    // session-end todo auto-sink: a session whose plan still has pending todos
    // lands them as ESR drafts at its teardown edge, so the plan survives the
    // session (flip `autoSinkTodosOnEnd` off to opt out). Live-toggleable — the
    // flag is read per event. Fully contained: a sink failure only warns.
    const disposeSink = ctx.on("session/disposed", (session) => {
      if (resolved.autoSinkTodosOnEnd === false) return;
      const cwd = session?.header?.cwd;
      const sessionId = session?.id;
      if (typeof cwd !== "string" || cwd.length === 0) return;
      if (typeof sessionId !== "string" || sessionId.length === 0) return;
      const todos = pendingTodosFromSession(session);
      if (todos.length === 0) return;
      const workspace = wk(cwd);
      service
        .getDomain()
        .then((domain) =>
          sinkPendingTodos(domain, workspace, todos, {
            sessionId,
            maxTasks: resolved.maxTasksPerWorkspace,
          }),
        )
        .then((report) => {
          if (report.created.length > 0) {
            log?.info?.(`engram todo auto-sink: ${report.created.length} pending todo(s) → ${report.created.length} ESR draft(s) in ${workspace}`);
          } else if (report.existed.length > 0 || report.atCap.length > 0) {
            log?.info?.(`engram todo auto-sink: ${report.existed.length} already in ESR, ${report.atCap.length} skipped (cap) in ${workspace}`);
          }
        })
        .catch((error) => log?.warn?.(`engram todo auto-sink failed: ${String(error)}`));
    });
    disposers.push(disposeSink);

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
            return Promise.reject(new Error("engram domain not open yet"));
          }
          return domain.storeMemory(...args);
        },
        // failure→fix closure reads (sync; [] until the domain is open)
        listMemories(workspace, limit) {
          const domain = service.openedDomain();
          return domain === void 0 ? [] : domain.listMemories(workspace, limit);
        },
        // failure→fix closure tags prior error rows as resolved (async)
        tagMemory(workspace, id, tag) {
          const domain = service.openedDomain();
          return domain === void 0 ? Promise.resolve(false) : domain.tagMemory(workspace, id, tag);
        },
      };
      const capture = makeCaptureHandler(captureStore, resolved, log, service.captureStats);
      const disposeCapture = ctx.on("tools/result", (exec, result) => {
        capture(exec, result);
      });
      disposers.push(disposeCapture);

      // DSH goal-domain integration: a completed/blocked goal auto-sediments
      // as a memory (`goal/change` session event → handoff/error row), so the
      // outcome survives the session without any LLM call.
      const disposeGoal = installGoalCapture(ctx, captureStore, log);
      disposers.push(disposeGoal);
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
