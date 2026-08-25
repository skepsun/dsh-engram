/**
 * dsh-engram: Context GC — the auto-GC that REPLACES DSH's built-in lossy
 * LLM-summary compaction (NOT the memory-panel GC).
 *
 * Thesis (mirrors pi-esr `extensions/context-gc.ts`): the bulk of evicted
 * context is RE-FETCHABLE — engram memories (`engram_store`/`engram_recall`/
 * `engram_detail`), ESR tasks/entities (`esr_*`), filePath anchors. So instead
 * of asking an LLM to compress everything into prose (lossy, un-queryable, and
 * itself a context consumer), we scan the messages being evicted for
 * provenance anchors and emit an explicit pointer summary: "this detail lives
 * at `<tool call>`". Only genuinely un-provenanced turns (pure chat / reasoning
 * with no re-fetchable backing) get a scoped LLM narrative — the safety net,
 * configurable off for a pure-mechanical zero-LLM path.
 *
 * The 6 pi-esr GC constraints:
 *   - indexed-output-evictable → pointer to `engram_detail(id)` / `engram_recall`
 *   - stable-task-evictable    → pointer to the [ESR] block / `esr_ready`
 *   - working-set-protected    → active tasks restated in the summary
 *   - pointer-salience         → every evicted category has an explicit re-fetch call
 *   - no-provenance-no-evict   → un-provenanced turns via scoped narrative or verbatim
 *
 * Layout: the pure (zero-LLM, dependency-free) layer lives here; the DSH
 * `CompactionEngine` binding is `loadContextGcEngine`, behind a guarded dynamic
 * import so the whole module never crashes when `dsh-compaction-basic` is
 * absent from the host.
 */

import { basename } from "node:path";
import { slugId } from "./util.js";

/** Memory ids are uuids; the [ENGRAM] index shows `#` + first 8 alnum chars. */
const MEMORY_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MEMORY_MARKER_RE = /#([a-z0-9]{6,})/gi;
// A bare 8-hex word is a memory short id (the first 8 chars of a uuid, which
// is always hex) as echoed by engram_recall / engram_detail memory lines.
const MEMORY_SHORT_RE = /\b[a-f0-9]{8}\b/g;
const TASK_ID_RE = /\btsk_[a-z0-9]{4,}\b/gi;
const ENTITY_ID_RE = /\bent_[a-z0-9-]{2,48}\b/gi;

/** engram memory-surface tools — their output is persisted and re-fetchable. */
const ENGRAM_ANCHOR_TOOLS = new Set(["engram_store", "engram_recall", "engram_detail"]);

/** ESR task/entity tools — structured state in the task store. */
const ESR_ANCHOR_TOOLS = new Set([
  "esr_task",
  "esr_close",
  "esr_ready",
  "esr_link",
  "esr_dep",
  "esr_claim",
  "esr_unclaim",
  "esr_node",
  "esr_model",
]);

/** Management tools are NOT provenance anchors (like ctx_purge — never re-run). */
const ESR_MANAGEMENT_TOOLS = new Set(["esr_gc"]);

/** Concatenate the visible text of a DSH content-block array. */
export function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (part && typeof part === "object" && typeof part.text === "string") out += `${part.text}\n`;
  }
  return out.trim();
}

function addSet(set, value) {
  const v = String(value ?? "").trim();
  if (v.length > 0) set.add(v);
}

/** Register a memory id/marker (deduped) plus its 8-char `#` marker. */
function addMemoryId(report, id) {
  const v = String(id).trim();
  if (v.length === 0) return;
  report.memoryIds.add(v);
  const bare = v.replace(/^#/, "").replace(/[^a-z0-9]/gi, "").slice(0, 8);
  if (bare.length >= 4) report.memoryMarkers.add(`#${bare}`);
}

/** Discover memory ids + `#`/bare short markers echoed in a result text. */
function addMemoryIdsFromText(report, text) {
  if (typeof text !== "string") return;
  for (const m of String(text).matchAll(MEMORY_ID_RE)) addMemoryId(report, m[0]);
  for (const m of String(text).matchAll(MEMORY_MARKER_RE)) addMemoryId(report, m[1]);
  for (const m of String(text).matchAll(MEMORY_SHORT_RE)) addMemoryId(report, m[0]);
}

/** Discover task/entity ids echoed in a result text. */
function addEntityIdsFromText(report, text) {
  if (typeof text !== "string") return;
  for (const m of String(text).matchAll(TASK_ID_RE)) addSet(report.entityIds, m[0]);
  for (const m of String(text).matchAll(ENTITY_ID_RE)) addSet(report.entityIds, m[0]);
}

/** Low-level provenance extraction for one tool-call block. */
function scanToolCall(report, name, args, resultText) {
  if (ESR_MANAGEMENT_TOOLS.has(name)) return false;
  let anchored = false;

  if (name === "engram_store") {
    if (typeof args.file_path === "string" && args.file_path) addSet(report.filePaths, args.file_path);
    report.engramUsed = true;
    anchored = true;
  } else if (name === "engram_recall") {
    if (typeof args.query === "string" && args.query.trim()) report.recallQueries.push(args.query.trim());
    if (typeof args.entity === "string" && args.entity.trim()) report.entityQueries.push(args.entity.trim());
    report.engramUsed = true;
    anchored = true;
  } else if (name === "engram_detail") {
    if (typeof args.id === "string" && args.id.trim()) addMemoryId(report, args.id);
    report.engramUsed = true;
    anchored = true;
  } else if (name === "esr_task") {
    if (typeof args.id === "string" && args.id.trim()) addSet(report.entityIds, args.id);
    if (typeof args.entity === "string" && args.entity.trim()) addSet(report.entityIds, args.entity);
    report.esrUsed = true;
    anchored = true;
  } else if (name === "esr_close") {
    if (typeof args.task_id === "string" && args.task_id.trim()) addSet(report.entityIds, args.task_id);
    for (const ref of Array.isArray(args.memory_refs) ? args.memory_refs : []) addMemoryId(report, ref);
    report.esrUsed = true;
    anchored = true;
  } else if (name === "esr_link" || name === "esr_dep" || name === "esr_claim" || name === "esr_unclaim") {
    for (const key of ["source", "target", "task_id", "dep_id", "entity_id"]) {
      if (typeof args[key] === "string" && args[key].trim()) addSet(report.entityIds, args[key]);
    }
    report.esrUsed = true;
    anchored = true;
  } else if (name === "esr_node") {
    // The created node id is deterministically `ent_<slug(name)>`.
    if (typeof args.name === "string" && args.name.trim()) addSet(report.entityIds, `ent_${slugId(args.name)}`);
    report.esrUsed = true;
    anchored = true;
  } else if (name === "esr_ready" || name === "esr_model") {
    report.esrUsed = true;
    anchored = true;
  }

  // Echo enrichment: ids always appear in the tool's result text too.
  addMemoryIdsFromText(report, resultText);
  addEntityIdsFromText(report, resultText);
  return anchored;
}

/**
 * Scan a DSH message array (the evicted shadowed region, surface order) for
 * provenance anchors. Pure + deterministic; message shapes are the DSH
 * `Message`/`ContentBlock` vocabulary (`tool-call` on assistant messages,
 * `tool-result` on user messages, correlated by `toolCallId`).
 *
 * @returns {{ memoryIds, memoryMarkers, recallQueries, entityQueries,
 *   entityIds, filePaths, anchoredMessageIndices, esrUsed, engramUsed }}
 */
export function scanMessages(messages) {
  const report = {
    memoryIds: new Set(),
    memoryMarkers: new Set(),
    recallQueries: [],
    entityQueries: [],
    entityIds: new Set(),
    filePaths: new Set(),
    anchoredMessageIndices: new Set(),
    esrUsed: false,
    engramUsed: false,
  };

  const list = Array.isArray(messages) ? messages : [];

  // Pre-correlate toolCallId -> result text for conditional confirmation.
  const resultByCallId = new Map();
  for (const msg of list) {
    for (const block of Array.isArray(msg?.content) ? msg.content : []) {
      if (block?.type === "tool-result") resultByCallId.set(block.toolCallId, blockText(block.content));
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    if (msg === null || typeof msg !== "object") continue;
    let anchored = false;

    // Assistant messages carry the tool-call blocks.
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || block.type !== "tool-call") continue;
        let args = {};
        if (typeof block.arguments === "string" && block.arguments.length > 0) {
          try {
            args = JSON.parse(block.arguments);
          } catch {
            args = {};
          }
        }
        const resultText = resultByCallId.get(block.id) ?? "";
        if (scanToolCall(report, block.name ?? "", args, resultText)) anchored = true;
      }
    }

    // Tool-result messages can carry the same anchors standalone (e.g. a
    // split turn where the call left the evicted span) — but only when they
    // actually echo re-fetchable ids. A generic `bash`/`read` output with no
    // engram/ESR anchor must NOT mark the turn provenanced (no-provenance-
    // no-evict), so the narrative safety net survives tool-heavy sessions.
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type !== "tool-result") continue;
        const beforeMem = report.memoryIds.size + report.memoryMarkers.size;
        const beforeEnt = report.entityIds.size;
        const resultText = blockText(block.content);
        addMemoryIdsFromText(report, resultText);
        addEntityIdsFromText(report, resultText);
        const foundIds = report.memoryIds.size + report.memoryMarkers.size > beforeMem
          || report.entityIds.size > beforeEnt;
        if (foundIds) anchored = true;
      }
    }

    if (anchored) report.anchoredMessageIndices.add(i);
  }

  return report;
}

/** Is this message a tool-result splice (DSH: single `tool-result` block)? */
export function isToolResultMessage(msg) {
  if (msg === null || typeof msg !== "object" || msg.role !== "user") return false;
  if (!Array.isArray(msg.content) || msg.content.length !== 1) return false;
  return msg.content[0]?.type === "tool-result";
}

/**
 * Group messages into turns. A turn opens at a genuine user message (not a
 * tool-result splice) or at index 0, and absorbs the tool-call/result
 * sequence that follows. A turn is `anchored` when any of its messages carries
 * a provenance anchor.
 */
export function groupTurns(messages, anchoredIndices) {
  const anchored = anchoredIndices instanceof Set ? anchoredIndices : new Set();
  const list = Array.isArray(messages) ? messages : [];
  const turns = [];
  let cur = null;
  for (let i = 0; i < list.length; i += 1) {
    const opensTurn = cur === null || (list[i]?.role === "user" && !isToolResultMessage(list[i]));
    if (opensTurn && cur !== null) cur.end = i;
    if (opensTurn) {
      cur = { start: i, end: list.length, anchored: false };
      turns.push(cur);
    }
    if (anchored.has(i) && cur !== null) cur.anchored = true;
  }
  return turns;
}

/**
 * Read the workspace's task/memory surface to classify the referenced ids
 * (best-effort, zero-LLM). `known` memories are re-fetchable right now and are
 * the only ones worth an explicit `engram_detail` pointer (pointer-salience);
 * unknown ids are dropped rather than offered as dead re-fetch calls.
 */
export function collectPointerContext(domain, workspace, report) {
  const context = {
    label: workspace ? basename(String(workspace).replace(/[\\/]+$/, "")) : "this workspace",
    activeTasks: [],
    stableTaskCount: 0,
    memoryIndex: new Map(), // marker/full-id -> { kind, text }
  };
  if (!domain || !workspace) return context;
  try {
    const tasks = domain.listTasks?.(workspace, { includeStable: true }) ?? [];
    context.stableTaskCount = tasks.filter((t) => t.state === "stable").length;
    context.activeTasks = tasks
      .filter((t) => t.state === "active")
      .map((t) => ({ id: String(t.id), name: String(t.name ?? "").slice(0, 72) }))
      .slice(0, 8);
    const pool = domain.listMemories?.(workspace, 200) ?? [];
    const resolvedIds = new Set();
    for (const id of [...report.memoryIds, ...report.memoryMarkers]) {
      if (context.memoryIndex.has(id)) continue;
      const bare = String(id).replace(/^#/, "");
      const hit = pool.find((m) => m.id === id || m.id.slice(0, 8) === bare || m.id.startsWith(bare));
      // Skip already-resolved ids (a full id and its #marker are the same memory).
      if (!hit || resolvedIds.has(hit.id)) continue;
      resolvedIds.add(hit.id);
      context.memoryIndex.set(id, { kind: hit.kind, text: String(hit.text).slice(0, 60) });
    }
  } catch {
    // best-effort: pointer summary still runs from the report alone
  }
  return context;
}

/**
 * Build the pointer summary that REPLACES the default LLM-compressed summary
 * body. Terse, deterministic, every category carries an explicit re-fetch
 * call. The narrative block is appended by the caller.
 */
export function buildPointerSummary(report, context, { turns = [], label = "this workspace" } = {}) {
  const lines = [
    "## Context GC — evicted detail is RE-FETCHABLE (do not re-derive)",
    "",
    "Older conversation was evicted to free context. The detail is NOT lost: it lives in the engram memory",
    "store and the ESR task store. Re-fetch ONLY when you actually need it, using the tools below.",
    "",
  ];

  const provenanced = turns.filter((t) => t.anchored).length;
  const unprovenanced = turns.length - provenanced;
  const what = turns.length === 1 ? "turn" : "turns";
  let evictedLine = `Evicted ${turns.length} ${what}.`;
  if (turns.length > 0) {
    evictedLine += ` ${provenanced} with re-fetchable provenance, ${unprovenanced} narrative-only.`;
  }
  lines.push(evictedLine);
  lines.push("");

  const ctx = context ?? {};

  // ── ESR task/entity pointers ─────────────────────────────────────────
  const activeTasks = Array.isArray(ctx.activeTasks) ? ctx.activeTasks : [];
  const stableCount = typeof ctx.stableTaskCount === "number" ? ctx.stableTaskCount : 0;
  const esrEntities = report?.entityIds?.size ? [...report.entityIds].slice(0, 8) : [];
  if (report?.esrUsed === true || activeTasks.length > 0 || esrEntities.length > 0) {
    lines.push("### ESR task state");
    lines.push("Reload the full graph with the [ESR] block / `esr_ready` — only re-fetch what you need.");
    if (activeTasks.length > 0) {
      lines.push("- Active working set (still tracked in ESR):");
      for (const t of activeTasks) lines.push(`  - \`${t.id}\` — ${t.name}`);
    }
    if (stableCount > 0) {
      lines.push(`- ${stableCount} closed task(s) retained — details stay re-fetchable via the [ESR] block.`);
    }
    if (esrEntities.length > 0) {
      lines.push(`- Referenced entities: ${esrEntities.map((e) => `\`${e}\``).join(", ")}`);
    }
    lines.push("");
  }

  // ── engram memory pointers ───────────────────────────────────────────
  const memoryIndex = ctx.memoryIndex instanceof Map ? ctx.memoryIndex : new Map();
  const knownIds = [...memoryIndex.keys()];
  const recallQueries = (report?.recallQueries ?? []).slice(0, 5);
  const entityQueries = (report?.entityQueries ?? []).slice(0, 5);
  const filePaths = report?.filePaths?.size ? [...report.filePaths].slice(0, 3) : [];
  if (report?.engramUsed === true || knownIds.length > 0 || recallQueries.length > 0 || entityQueries.length > 0 || filePaths.length > 0) {
    lines.push("### engram memories (re-fetchable)");
    if (knownIds.length > 0) {
      lines.push("Fetch the exact records that are still in the store:");
      for (const id of knownIds.slice(0, 10)) {
        const meta = memoryIndex.get(id);
        const kind = meta?.kind ? ` [${meta.kind}]` : "";
        lines.push(`- \`engram_detail(id: "${id}")\`${kind}`);
      }
    }
    for (const q of recallQueries) lines.push(`- Re-run recall: \`engram_recall(query: ${JSON.stringify(q)})\``);
    for (const e of entityQueries) lines.push(`- Re-run timeline: \`engram_recall(entity: ${JSON.stringify(e)})\``);
    if (filePaths.length > 0) {
      lines.push(`- File-anchored detail lives near: ${filePaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (knownIds.length === 0 && recallQueries.length === 0 && entityQueries.length === 0) {
      lines.push("- No separately re-fetchable memory ids in the evicted span; the narrative below carries it.");
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Compact serialization of un-provenanced messages for the narrative fallback.
 * Tool arguments are included verbatim (they are the re-derivable surface).
 */
export function serializeMessages(messages, { maxChars = 4000 } = {}) {
  const lines = [];
  const list = Array.isArray(messages) ? messages : [];
  for (const msg of list) {
    const role = msg?.role ?? "?";
    const blocks = Array.isArray(msg?.content) ? msg.content : [];
    if (role === "assistant") {
      for (const b of blocks) {
        if (b?.type === "text") lines.push(`assistant: ${b.text}`);
        else if (b?.type === "reasoning") lines.push(`assistant (thinking): ${b.text}`);
        else if (b?.type === "tool-call") lines.push(`assistant → ${b.name}(${b.arguments})`);
      }
    } else if (role === "user") {
      const toolResult = blocks.find((b) => b?.type === "tool-result");
      if (toolResult) lines.push(`tool result: ${blockText(toolResult.content)}`);
      else for (const b of blocks) if (b?.type === "text") lines.push(`user: ${b.text}`);
    }
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated, ${text.length} chars total]`;
}

/**
 * Narrative for un-provenanced turns (the `no-provenance-no-evict` safety
 * net). With `enabled` and a working `callLlm`, a scoped summary is produced;
 * otherwise — or on any failure — the turns are kept as truncated verbatim so
 * detail is never silently dropped. Pure aside from the injected `callLlm`.
 *
 * @param callLlm(messageSlice, signal) → { text, model?, llm? } | null
 */
export async function summarizeUnprovenanced(messages, { enabled = true, maxChars = 4000, signal, callLlm } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) {
    return { text: "_None — all evicted turns had re-fetchable provenance._", generated: false };
  }
  const fallback = () => ({ text: serializeMessages(list, { maxChars }), generated: false });
  if (enabled !== true || typeof callLlm !== "function") return fallback();
  try {
    const result = await callLlm(list, signal);
    if (!result || typeof result.text !== "string" || result.text.trim().length === 0) return fallback();
    return { text: result.text.trim(), generated: true, model: result.model, llm: result.llm };
  } catch {
    return fallback();
  }
}

/**
 * Build the Context GC replacement summary (pointer block + narrative). This
 * is the text that lands inside DSH's `<compacted-summary>` checkpoint node.
 */
export function buildContextGcSummary(report, context, { turns, narrative }) {
  const label = context?.label ?? "this workspace";
  const pointer = buildPointerSummary(report, context, { turns, label });
  const parts = [
    pointer,
    "### Narrative not captured elsewhere",
    narrative.text,
    "",
    "---",
    "_Context GC: detail above is re-fetchable via the listed tools. Prefer re-fetching over re-deriving._",
  ];
  return parts.join("\n");
}

/**
 * Load a mountable compaction engine CLASS for the host/preset plane.
 *
 * `mode: "context-gc"` (default) returns the ContextGcEngine subclass;
 * `mode: "default"` returns a thin BasicCompactionEngine subclass (identical
 * default LLM summarizer) — used when `gcReplacesCompaction` is off AFTER the
 * base `compaction-basic` row was disabled by the profile patch, so the
 * `compaction` service never disappears while dsh-engram is installed.
 *
 * Returns `null` when `@deepseek-ai/dsh-compaction-basic` is not importable
 * (graceful — the host keeps whatever compaction it still has).
 */
export async function loadCompactionEngine(ctx, config = {}, deps = {}, { mode = "context-gc" } = {}) {
  const mod = await import("@deepseek-ai/dsh-compaction-basic").catch(() => null);
  if (!mod?.BasicCompactionEngine) return null;
  if (mode === "default") {
    // The plain-default mode: construct BasicCompactionEngine verbatim (it IS
    // the shipped default LLM summarizer), so when the base row was disabled
    // by the profile patch the `compaction` service still exists.
    return class DefaultCompactionEngine extends mod.BasicCompactionEngine {
      constructor() {
        super(ctx, { auto: true, ...config });
      }
    };
  }
  return loadContextGcEngine(ctx, config, deps);
}

/**
 * Load the DSH binding: a `ContextGcEngine extends BasicCompactionEngine`
 * whose sole override is `summarize()`. Returns `null` when
 * `@deepseek-ai/dsh-compaction-basic` is not importable (graceful — the host
 * keeps its default compaction).
 *
 * @param ctx - cordis context the engine mounts `compaction` service on.
 * @param config - BasicCompactionConfig (policy; `auto` defaults true).
 * @param deps - { readWorkspace(ws, report), narrativeEnabled, narrativeMaxChars,
 *                narrativeMaxTokens, narrativeLlm?, defaultSummarize?, log? }
 * @returns the engine CLASS (construct with `new Engine()`), or null.
 */
export async function loadContextGcEngine(ctx, config = {}, deps = {}) {
  let mod;
  try {
    mod = await import("@deepseek-ai/dsh-compaction-basic");
  } catch {
    return null;
  }
  const Basic = mod?.BasicCompactionEngine;
  if (typeof Basic !== "function") return null;

  const narrativeEnabled = deps.narrativeEnabled !== false;
  const narrativeMaxChars = deps.narrativeMaxChars ?? 4000;
  const narrativeMaxTokens = deps.narrativeMaxTokens ?? 1024;
  const engineConfig = { auto: true, ...config };

  return class ContextGcEngine extends Basic {
    constructor() {
      super(ctx, engineConfig);
      this.gcDeps = deps;
    }

    /** The one seam we take over: produce the checkpoint summary. */
    async summarize(input, agent, signal) {
      try {
        return await this._contextGc(input, agent, signal);
      } catch (error) {
        const logger = this.ctx?.logger;
        const message = error instanceof Error ? error.message : String(error);
        if (typeof logger?.warn === "function") logger.warn(`engram context-gc failed (${message}); falling back to default compaction`);
        if (typeof this.gcDeps.defaultSummarize === "function") {
          return this.gcDeps.defaultSummarize(input, agent, signal);
        }
        return super.summarize(input, agent, signal);
      }
    }

    async _contextGc(input, agent, signal) {
      const messages = Array.isArray(input?.messages) ? input.messages : [];
      const report = scanMessages(messages);
      const turns = groupTurns(messages, report.anchoredMessageIndices);

      const ws = agent?.session?.header?.cwd;
      const context = typeof this.gcDeps.readWorkspace === "function"
        ? await this.gcDeps.readWorkspace(ws, report)
        : undefined;
      const safeContext = context ?? { label: ws ? basename(String(ws).replace(/[\\/]+$/, "")) : "this workspace" };

      const unprovenanced = turns
        .filter((t) => !t.anchored)
        .flatMap((t) => messages.slice(t.start, t.end));

      const callLlm = narrativeEnabled
        ? (slice, sig) => (typeof this.gcDeps.narrativeLlm === "function"
          ? this.gcDeps.narrativeLlm(slice, agent, sig)
          : this._defaultNarrativeLlm(slice, agent, sig))
        : undefined;

      const narrative = await summarizeUnprovenanced(unprovenanced, {
        enabled: narrativeEnabled,
        maxChars: narrativeMaxChars,
        signal,
        callLlm,
      });

      const summaryText = buildContextGcSummary(report, safeContext, { turns, narrative });
      const result = { summary: [{ type: "text", text: summaryText }] };
      if (narrative.llm && typeof narrative.llm === "object") Object.assign(result, narrative.llm);
      return result;
    }

    /**
     * Default scoped narrative through the host's own LLM seam
     * (`ctx.llm.stream`, `purpose: 'compaction'`, prefix-cache friendly).
     */
    async _defaultNarrativeLlm(slice, agent, signal) {
      try {
        const llm = this.ctx?.llm;
        if (!llm || typeof llm.stream !== "function") return { text: "" };
        const dshLlm = await import("@deepseek-ai/dsh-llm");
        const target = this._narrativeTarget(agent);
        if (!target) return { text: "" };

        const instruction = [
          "You are a context-transfer assistant. The turns below were evicted from context and have NO",
          "re-fetchable provenance (no engram memory, no ESR task, no file anchor) — that is why they need a",
          "narrative. Everything re-fetchable has already been replaced by pointers elsewhere.",
          "",
          "Produce a CONCISE narrative summary (max ~250 words): what the user asked, what was explored or",
          "decided, and any open thread. No preamble.",
        ].join("\n");

        const messages = [
          ...slice,
          dshLlm.createUserMessage({
            content: [{ type: "text", text: instruction }],
            source: { kind: "plugin", plugin: "dsh-engram" },
          }),
        ];
        const assembler = new dshLlm.BlockAssembler();
        const options = {
          provider: target.provider,
          model: target.model,
          messages,
          maxTokens: narrativeMaxTokens,
          sessionId: agent?.session?.id,
          purpose: "compaction",
          ...(signal === undefined ? {} : { signal }),
        };
        for await (const chunk of llm.stream(options)) assembler.push(chunk);
        const rawOutput = assembler.blocks();
        const text = rawOutput
          .filter((b) => b?.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (text.length === 0) return { text: "" };
        return {
          text,
          model: target.model,
          llm: {
            rawOutput,
            llmStreamCall: true,
            provider: target.provider,
            model: target.model,
            maxTokens: narrativeMaxTokens,
          },
        };
      } catch {
        return { text: "" };
      }
    }

    /** Resolve the summarization route: configured → latest routed → agent options. */
    _narrativeTarget(agent) {
      const latest = agent?.session?.requestHeader?.()?.config;
      if (latest && latest.provider?.length && latest.model?.length) {
        return { provider: latest.provider, model: latest.model };
      }
      const agentTarget = agent?.options;
      if (agentTarget && agentTarget.provider?.length && agentTarget.model?.length) {
        return { provider: agentTarget.provider, model: agentTarget.model };
      }
      return undefined;
    }
  };
}
