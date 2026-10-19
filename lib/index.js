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
import { installPreferenceCapture } from "./preference.js";
import { installBoundaryPrune } from "./boundary-prune.js";
import { resultPackDir, archivePrunedResults, resultRecallTool, sweepExpired } from "./result-pack.js";
import { recordBoundaryPruneFire, recordRecallInjection, readPackTelemetry, engramHome } from "./pack-telemetry.js";
import { createLedger, estimatePrefixChars } from "./ledger.js";
import { renderIndex, renderStartRecall, firstUserMessageText, renderEsr, esrMethodology, buildEsrSnapshot, buildFrozenEsrBlock } from "./index-block.js";
import { makeTriggerRecorder } from "./trigger.js";
import { pendingTodosFromSession, sinkPendingTodos } from "./todo-sink.js";
import { installEngramSettings, makeEngineConfigSchema, SETTINGS_KEYS } from "./settings.js";
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
  // opt-in cross-workspace recall ("workspace" = current default, strict
  // per-workspace isolation; "global" = when the local pool has weak/no hits,
  // also rank entries from other workspaces' pools with a recency/origin-aware
  // penalty and surface a [W:<workspace>] origin marker). Token-discipline
  // default is preserved; this is strictly an enable knob.
  recallScope: "workspace",
  // session-diversified recall: max memories per session before cross-session
  // evidence takes over (agentmemory 候选①; "few and precise")
  maxRecallPerSession: 3,
  // Host-side session-start auto-recall (方案 B): at the FIRST assembly of a
  // new session, key a bounded BM25 recall off the session's first user message
  // and inject the top hits as a [RECALL] block — relevant memory reaches the
  // model even when it never calls engram_recall on its own (the observed gap:
  // pull-only recall left everything to model initiative and almost never
  // fired). Pure rule, zero LLM, per-session frozen with the [ENGRAM] block.
  // "few and precise" — agentmemory 候选①'s lesson from the coding leaderboard.
  autoRecallOnStart: true,
  autoRecallLimit: 3,
  autoRecallMaxChars: 700,
  // user-correction / preference learning (zero-LLM, auto-captured from
  // user/message events; prefer/avoid/switch-to cues). Store as `preference`
  // memories that outrank the [ENGRAM] index.
  autoCapturePreferences: true,
  preferenceCapturePerSession: 8,
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
  // Context Ledger (PROPOSAL-evolution §4 v0.6-A): per-session accounting of
  // injected block chars, pruned/compacted savings and prefix-rewrite penalty.
  // In-memory + daily rollup at ~/.dsh/engram/ledger.json; never on the hot
  // path of model calls (one integer add per request). `ledgerCacheDiscount`
  // is the cached-prefix price share (0.1 = cache hit costs 10%, so a rewrite
  // costs 90% of the prefix).
  ledgerEnabled: true,
  ledgerCacheDiscount: 0.1,
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
  // BoundaryPrune (PROPOSAL-resultpack L1): prune over-threshold tool
  // results at todo/goal subtask boundaries via DSH's toolResultPruner
  // (deterministic surface-replace, zero LLM). L0 simulation (77 sessions):
  // todo-progress boundaries cover 79% of replay exposure; the repayment
  // gate below lifted cache-aware net savings 12–32% on every threshold.
  // Default OFF (SoL-Pi C13: a dormant mechanism costs nothing); the
  // pruner service is feature-detected — absent ⇒ disabled with one log.
  boundaryPrune: false,
  // Repayment gate: prune only while the session is expected to run at
  // least this many more requests (empirical workspace prior, see
  // lib/boundary-prune.js). 50 = L0 sweep optimum.
  boundaryPruneMinRemaining: 50,
  // Threshold override (ResultPack L0 "T2048 landing"): the host pruner is
  // fixed at 8192; set this to a lower budget to prune earlier at boundaries
  // (L0 says T2048 has the highest net savings +61.6Mc, gated only by the
  // L2 archive requirement — now satisfied). 0/absent → host threshold.
  boundaryPruneThresholdChars: 0,
  // Edges retained by the override pruner (unless set, host's 4096/1024).
  boundaryPruneHeadChars: 0,
  boundaryPruneTailChars: 0,
  // Request-count boundary (SoL-Pi "step idle", default OFF): fire at most once
  // per N requests even in sessions with no todo/goal boundary (~62% of the L0
  // corpus never fires the event boundaries). Still under the repayment gate.
  // 0 → event boundaries only.
  boundaryPruneIdleCadence: 0,
  // ResultPack L2 (PROPOSAL-resultpack §L2): archive the middles L1 prunes
  // off the surface (~/.dsh/engram/resultpack/<callId>.json, redacted) and
  // append a `[middle archived: result_recall(<callId>) 可取]` handle tail to
  // each pruned node; register `result_recall(callId, offset?)` for paged
  // recall — the full ObservationPack pattern (SoL-Pi mech ③; paired
  // EdgeBench −23.58%). Requires `boundaryPrune: true` to have anything to
  // archive (L2 without L1 is a no-op with a log line). Default OFF (C13).
  resultPack: false,
  // result_recall page budget (chars per page). 4000 fits a typical model
  // context band without re-materializing huge results whole.
  resultPackPageChars: 4000,
  // Retain archived middles this many days (mtime sweep, same GC cadence).
  resultPackRetentionDays: 7,
};

/**
 * Cordis reads `plugin.Config` off the module: DSH ≥0.1.7 validates the
 * `engram` profile row against it AND projects the settings form from it —
 * the curated SETTINGS_KEYS are `.volatile()`, so the settings service exposes
 * exactly the GUI card's knobs (entry id `engram`), while every other DEFAULTS
 * key stays a plain declared field so profile-patch config survives validation.
 */
export const Config = makeEngineConfigSchema(DEFAULTS);

export function resolveConfig(config) {
  const src = config && typeof config === "object" ? config : {};
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (src[key] !== void 0) {
      // A volatile reference may hold a nullish value (e.g. a profile patch
      // listed a knob as null, or schemastery's null-default sentinel); the
      // `??` keeps the DEFAULTS value in that case instead of nulling out.
      out[key] = unwrapValue(src[key]) ?? DEFAULTS[key];
    }
  }
  return out;
}

/** Unwrap a volatile config reference (DSH ≥0.1.7 settings) to its plain value. */
function unwrapValue(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

/**
 * Collect the volatile config references for the given keys from a plugin
 * config object (DSH ≥0.1.7 validates `Config` into volatile references that
 * the loader commits into IN PLACE on settings-card edits). Plain values are
 * skipped, so this is a no-op on legacy DSH.
 */
export function collectVolatileRefs(config, keys) {
  const refs = {};
  if (config !== null && typeof config === "object") {
    for (const key of keys) {
      const ref = config[key];
      if (ref !== null && typeof ref === "object" && typeof ref.get === "function") refs[key] = ref;
    }
  }
  return refs;
}

/**
 * Re-read volatile references into a resolved config (`target`, mutated in
 * place): the loader has committed a settings-card edit into the same refs and
 * emitted `loader/volatile-update`. Nullish refs fall back to DEFAULTS (the
 * schemastery null-default sentinel yields an undefined ref value). Returns
 * the keys whose value actually changed.
 */
export function syncVolatileRefs(refs, target) {
  const changed = [];
  for (const key of Object.keys(refs)) {
    const next = unwrapValue(refs[key]) ?? DEFAULTS[key];
    if (next !== target[key]) {
      target[key] = next;
      changed.push(key);
    }
  }
  return changed;
}

/**
 * Mount the plugin. `ctx` is the scoped cordis context; `config` the optional
 * resolved plugin config (plain object from the profile patch).
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config);
  // DSH ≥0.1.7 / 0.2.x settings model: the GUI card edits the `engram`
  // entry's VOLATILE Config fields. The loader commits those into the same
  // references (in place) and emits `loader/volatile-update` — hold the refs
  // so a card edit re-syncs `resolved` live for new sessions (blocks already
  // frozen for a session stay frozen — the plugin's documented contract).
  const volatileRefs = collectVolatileRefs(config, SETTINGS_KEYS);
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

  // Context Ledger: created before the service object so /stats can read it.
  // `ledgerEnabled:false` leaves a null instance (zero listeners, zero writes).
  const ledger = resolved.ledgerEnabled === false
    ? null
    : createLedger({
      home: engramHome(),
      cacheDiscount: resolved.ledgerCacheDiscount,
      log,
    });

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
    captureStats: { total: 0, git: 0, file: 0, error: 0, preference: 0 },
    /** SoL-Pi activation telemetry (M15/C13): durable boundary-prune fires +
     *  [RECALL] injection funnel, read at request time (readPackTelemetry). */
    packTelemetry: () => readPackTelemetry({ home: engramHome() }),
    /** Context Ledger snapshot: spent vs saved context, net of cache rewrites. */
    ledger: () => (ledger === null ? null : ledger.summary()),
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
      // ResultPack L2 archive sweep rides the same GC cadence (mtime-based).
      if (resolved.resultPack === true) {
        const removed = sweepExpired(resultPackDir(), resolved.resultPackRetentionDays ?? 7);
        if (removed > 0) log?.info?.(`engram gc: ${removed} expired result-pack archives removed`);
      }
    } catch (error) {
      log?.warn?.(`engram gc sweep failed: ${String(error)}`);
    }
  };

  // User settings (web GUI card): merges stored values onto the live config.
  // Non-blocking — when the settings service is absent this never runs.
  installEngramSettings(ctx, resolved, resolved, service);

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
    let pendingRecall = false;
    try {
      const workspace = resolvePath(cwd);
      block = renderIndex(opened, workspace, cwd, resolved);
      // Host-side session-start auto-recall (方案 B): append the [RECALL]
      // block keyed on the session's FIRST user message. The cache only freezes
      // once there is a query to key on — if the user text isn't in the events
      // yet (exotic pre-message assemblies), return the index alone and let the
      // next assembly retry, so a new conversation never permanently misses its
      // recalled memory.
      if (resolved.autoRecallOnStart !== false) {
        const query = firstUserMessageText(session);
        if (query.length === 0) {
          pendingRecall = true;
        } else {
          const recall = renderStartRecall(opened, workspace, resolved, { query, allowRecencyFallback: false });
          if (recall.length > 0) {
            // Activation funnel, injection leg: a [RECALL] block actually made
            // it into a session. Counted here (the block only materializes when
            // the render produced hits), so /stats can close the loop with
            // engram_recall/engram_detail tool calls from the session logs.
            recordRecallInjection({
              home: engramHome(),
              workspace,
              hits: (recall.match(/- \[/g) ?? []).length,
            });
            block = `${block}\n${recall}`.trim();
          }
        }
      }
    } catch (error) {
      log?.warn?.(`engram index render failed: ${String(error)}`);
    }
    // Never cache a render that skipped auto-recall for lack of an opening
    // message — the next assembly will have it and can still materialize the
    // [RECALL] block.
    if (pendingRecall) return block;
    sessionCache.set(session, block);
    ledger?.noteInjection(session.id, wk(cwd), "index", block.length);
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
    if (block.length > 0) ledger?.noteInjection(session.id, wk(cwd), "esr", block.length);
    return block;
  };

  ctx.effect(() => {
    const disposers = [];

    // Settings card edits (volatile Config fields) hot-commit into the refs
    // in place; re-read them so `resolved` reflects new values for new
    // sessions without a profile restart. Legacy DSH never emits this event
    // and leaves `volatileRefs` empty, so the listener is inert there.
    if (Object.keys(volatileRefs).length > 0) {
      const disposeVolatile = ctx.on?.("loader/volatile-update", () => {
        syncVolatileRefs(volatileRefs, resolved);
      });
      if (disposeVolatile !== void 0) disposers.push(disposeVolatile);
    }

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

    // Context Ledger ticks: one model request completed → charge the injected
    // blocks (held in the prefix) and credit pruned/compacted chars that would
    // otherwise replay in this request. Session teardown folds the tail into
    // the daily rollup. Both listeners are no-ops when the ledger is disabled.
    if (ledger !== null) {
      const disposeLedgerTick = ctx.on("session/event", (session, event) => {
        if (event?.type !== "assistant/message") return;
        ledger.tick(session?.id, wk(session?.header?.cwd));
      });
      disposers.push(disposeLedgerTick);
      const disposeLedgerSession = ctx.on("session/disposed", (session) => {
        ledger.dispose(session?.id);
      });
      disposers.push(disposeLedgerSession);
    }

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

      // User-correction / preference learning (zero-LLM): `user/message`
      // events carrying explicit prefer/avoid/switch-to cues auto-sediment as
      // `preference` memories (correx / PAHF / Mem0 preference-extraction
      // pattern, distilled to pure rules). No model call.
      const disposePreference = installPreferenceCapture(ctx, captureStore, resolved, log, service.captureStats);
      disposers.push(disposePreference);

      // BoundaryPrune (PROPOSAL-resultpack L1, default OFF): prune
      // over-threshold tool results at todo/goal subtask boundaries through
      // DSH's own deterministic toolResultPruner, gated by a repayment clock.
      const l2Dir = resultPackDir();
      const disposeBoundaryPrune = installBoundaryPrune(ctx, resolved, log, {
        // ResultPack L2 hook: archive the pruned middles (redacted) + append
        // a handle tail on each pruned node. Fail-contained in result-pack.js.
        // Also records durable activation telemetry (SoL-Pi M15/C13) —
        // independent of `resultPack`: /stats must be able to prove the L1
        // mechanism actually fires on the live profile.
        onPruned: (session, report, boundary) => {
          const workspace = wk(session?.header?.cwd);
          recordBoundaryPruneFire({
            home: engramHome(),
            boundary,
            report,
            workspace,
          });
          // Ledger: the removed chars stop replaying from the next request;
          // the prefix invalidation is priced with the pre-prune size (the
          // surface is already rewritten when this hook runs).
          const removed = Number.isFinite(report?.charsRemoved) ? report.charsRemoved : 0;
          const prefixChars = estimatePrefixChars(session);
          ledger?.notePrune(session?.id, workspace, {
            charsRemoved: removed,
            rewriteChars: prefixChars + removed,
          });
          if (resolved.resultPack !== true) return;
          archivePrunedResults({
            dir: l2Dir,
            session,
            report,
            workspace,
            log,
          });
        },
      });
      disposers.push(disposeBoundaryPrune);

      // ResultPack L2 tool (default OFF with L1): `result_recall(callId, offset?)`
      // pages back an archived middle. Independent of the memory domain — the
      // archive lives on the filesystem. Registers only when enabled; without
      // boundayPrune there is nothing to archive, so it self-disables.
      if (resolved.resultPack === true) {
        if (resolved.boundaryPrune !== true) {
          log?.warn?.("engram result-pack: requires boundaryPrune: true to prune middles — result_recall not registered");
        } else {
          const pageChars = Number.isFinite(resolved.resultPackPageChars)
            ? resolved.resultPackPageChars
            : 4000;
          disposers.push(
            ctx.effect(() => {
              ctx.tools.register(resultRecallTool(l2Dir, pageChars));
              log?.info?.(`engram result-pack enabled: result_recall(callId, offset) registered; archive dir ${l2Dir}`);
            }),
          );
        }
      }
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
