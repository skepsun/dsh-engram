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
 * The 6 pi-esr GC constraints (+ the harness shrink gate that keeps them legal):
 *   - indexed-output-evictable → pointer to `engram_detail(id)` / `engram_recall`
 *   - stable-task-evictable    → pointer to the [ESR] block / `esr_ready`
 *   - working-set-protected    → active tasks restated in the summary
 *   - pointer-salience         → every evicted category has an explicit re-fetch call
 *   - no-provenance-no-evict   → un-provenanced turns via scoped narrative or verbatim
 *   - shrink-gated             → the framed checkpoint must be STRICTLY SMALLER
 *     than the evicted span (`fitSummaryToSpan`): the harness refuses and rolls
 *     back any summary that is not smaller, which otherwise blocks every auto
 *     compaction and pushes the session into the model-side context overflow.
 *     The pointer/narrative body is therefore fitted under the span with the
 *     host token meter, truncating tail detail (still durable in the log).
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

/**
 * The durable checkpoint framing the harness applies to a compaction summary
 * before accepting it (`frameSummary()` in dsh-compaction-basic): the summary
 * body is wrapped in a preamble + `<compacted-summary>` tags and the WHOLE
 * framed user message must estimate strictly SMALLER than the evicted span,
 * or the harness throws `summary is not smaller than the shadowed content`
 * and rolls the compaction back. These constants mirror that framing so the
 * Context GC can self-predict acceptance with the host token meter (verified
 * to reproduce the harness's estimate exactly); a small safety margin absorbs
 * any harness drift.
 */
const FRAME_PREAMBLE =
  "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";
const FRAME_OPEN_TAG = "<compacted-summary>";
const FRAME_CLOSE_TAG = "</compacted-summary>";

/** Best-effort token estimate of one derived message through the host meter. */
function estimateMessageTokens(meter, message) {
  if (typeof meter?.estimateMessage !== "function") return 0;
  try {
    const tokens = meter.estimateMessage(message);
    return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  } catch {
    return 0;
  }
}

/**
 * Exact token estimate of the span a compaction is about to shadow: the sum of
 * the evicted region's derived messages through the SAME token meter the
 * harness compares against (verified to equal the harness's shadowed count).
 * Returns 0 when no meter is available — callers then skip the shrink gate
 * rather than guess.
 * @param {object|undefined} meter - `ctx.tokenMeter` (host), or undefined.
 * @param {Array<object>} messages - the region messages passed to `summarize`.
 * @returns {number}
 */
export function estimateShadowedTokens(meter, messages) {
  const list = Array.isArray(messages) ? messages : [];
  let total = 0;
  for (const message of list) total += estimateMessageTokens(meter, message);
  return total;
}

/** The harness-framed checkpoint user message for a summary body. */
function framedCheckpointMessage(bodyText) {
  return {
    role: "user",
    content: [
      { type: "text", text: `${FRAME_PREAMBLE}\n\n${FRAME_OPEN_TAG}` },
      { type: "text", text: bodyText },
      { type: "text", text: FRAME_CLOSE_TAG },
    ],
  };
}

/**
 * Token estimate of the framed checkpoint the harness will generate for this
 * body (mirrors `frameSummary` + `createUserMessage` + `estimateMessage`;
 * verified byte-identical to the live meter). Without a meter, a conservative
 * chars→tokens heuristic is used — divided by two so both CJK and latin
 * over-estimate, biasing toward trimming more, never less.
 * @param {object|undefined} meter - `ctx.tokenMeter`, or undefined.
 * @param {string} bodyText - the summary body inside the checkpoint.
 * @returns {number}
 */
export function estimateFramedTokens(meter, bodyText) {
  if (typeof meter?.estimateMessage === "function") {
    try {
      const tokens = meter.estimateMessage(framedCheckpointMessage(bodyText));
      if (Number.isFinite(tokens)) return Math.max(1, tokens);
    } catch {
      // fall through to the char heuristic
    }
  }
  const text = typeof bodyText === "string" ? bodyText : "";
  return (
    Math.ceil((FRAME_PREAMBLE.length + FRAME_OPEN_TAG.length + FRAME_CLOSE_TAG.length + text.length) / 2) + 8
  );
}

/** Truncation note appended when the checkpoint must shrink to fit the span. */
const FIT_SUFFIX = "\n_…(full detail stays re-fetchable via the engram/ESR tools; see the session log)_";

/**
 * Shrink a Context GC summary body so the framed checkpoint stays strictly
 * under the evicted span — the harness's hard shrink gate. Without this, a
 * large verbatim/pointer body makes every automatic pressure / overflow
 * compaction roll back (`summary is not smaller than the shadowed content`),
 * the context never shrinks, and the session eventually hits the model-side
 * context overflow.
 *
 * Truncation keeps the largest PREFIX that still fits — the pointer head and
 * working set survive, only tail detail is cut — and appends a short note when
 * the span is large enough to afford one. Exact under the host token meter;
 * deterministic everywhere; degrades to an empty body for spans so small that
 * the exact framing overhead does not fit (the stock LLM summarizer would be
 * refused by the harness for those too).
 *
 * @param {string} bodyText - the full Context GC body.
 * @param {number} shadowedTokens - evicted-span token estimate (0 = unknown).
 * @param {{meter?: object, margin?: number}} [opts]
 * @returns {{ text: string, framed: number, shadowed: number, trimmed: boolean }}
 */
export function fitSummaryToSpan(bodyText, shadowedTokens, opts = {}) {
  const meter = opts?.meter;
  const margin = opts?.margin ?? 4;
  const budget = shadowedTokens - margin;
  if (!Number.isFinite(shadowedTokens) || shadowedTokens <= 0 || budget <= 1) {
    return {
      text: bodyText,
      framed: estimateFramedTokens(meter, bodyText),
      shadowed: shadowedTokens,
      trimmed: false,
    };
  }
  const source = typeof bodyText === "string" && bodyText.length > 0 ? bodyText : "";
  if (estimateFramedTokens(meter, source) < budget) {
    return {
      text: source,
      framed: estimateFramedTokens(meter, source),
      shadowed: shadowedTokens,
      trimmed: false,
    };
  }
  // Largest prefix of the source that fits WITHOUT the note; the note is only
  // re-added when the budget still affords it (the note itself is ~25 tokens).
  let lo = 0;
  let hi = source.length;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (estimateFramedTokens(meter, source.slice(0, mid)) < budget) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const prefix = source.slice(0, best);
  const withNote = `${prefix}${FIT_SUFFIX}`;
  const text = best > 0 && estimateFramedTokens(meter, withNote) < budget ? withNote : prefix;
  const trimmed = text !== source;
  return { text, framed: estimateFramedTokens(meter, text), shadowed: shadowedTokens, trimmed };
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
 * Mount the compaction engine onto `ctx` — THE shared entry both planes use
 * (host plane: the main engram plugin's `apply`; preset plane: the
 * `dsh-engram/compaction` row shown in an agent preset's `compaction` group).
 *
 * `config.gcReplacesCompaction === false` → mount the bare default LLM
 * summarizer instead (keeps the `compaction` service alive after the profile
 * patch disabled the base `compaction-basic` row); otherwise mount the
 * ContextGcEngine override. `deps.readWorkspace(ws, report)` is how the engine
 * reaches engram/ESR state for pointer classification — the caller supplies
 * its own lazy-domain binding.
 *
 * Fully contained: an unimportable backend or a duplicate `compaction`
 * provider (cordis refuses second registration) only warns and returns null —
 * the host keeps whatever compaction it already has, never a crash.
 *
 * @returns {Promise<Function|null>} the mounted engine class, or null.
 */
export async function mountCompactionEngine(ctx, config = {}, deps = {}) {
  const mode = config.gcReplacesCompaction === false ? "default" : "context-gc";
  const engineDeps =
    mode === "context-gc"
      ? {
          narrativeEnabled: config.gcNarrative !== false,
          narrativeMaxTokens: config.gcNarrativeMaxTokens ?? 1024,
          narrativeMaxChars: config.gcNarrativeMaxChars ?? 4000,
          ...deps,
        }
      : {};
  const Engine = await loadCompactionEngine(ctx, { auto: true }, engineDeps, { mode });
  if (!Engine) {
    ctx?.logger?.warn?.("engram context-gc: dsh-compaction-basic unavailable — no compaction engine");
    return null;
  }
  try {
    new Engine();
  } catch (error) {
    // Duplicate `compaction` provider (base row not disabled) or constructor
    // refusal: keep whatever is already registered, never crash the host.
    ctx?.logger?.warn?.(
      `engram context-gc mount skipped (${error instanceof Error ? error.message : String(error)}) — keeping the existing compaction service`,
    );
    return null;
  }
  ctx?.logger?.info?.(
    `engram context-gc: compaction = ${mode === "context-gc" ? "Context GC (mechanical eviction + re-fetch pointers)" : "default LLM summarizer (gcReplacesCompaction:false)"}`,
  );
  return Engine;
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

      let summaryText = buildContextGcSummary(report, safeContext, { turns, narrative });

      // The harness refuses any checkpoint whose framed token estimate is >=
      // the evicted span (see fitSummaryToSpan). Fit the body under that span
      // so automatic pressure / context-overflow compaction COMMITS instead of
      // rolling back — otherwise the session only grows until the model-side
      // context overflow fires.
      const meter = this.ctx?.tokenMeter;
      const shadowedTokens = estimateShadowedTokens(meter, messages);
      const fit = fitSummaryToSpan(summaryText, shadowedTokens, { meter });
      if (fit.trimmed && typeof this.ctx?.logger?.info === "function") {
        this.ctx.logger.info(
          `engram context-gc: checkpoint trimmed to fit the evicted span (${fit.framed} framed vs ${fit.shadowed} shadowed tokens)`,
        );
      }
      summaryText = fit.text;

      const result = { summary: [{ type: "text", text: summaryText }] };
      if (narrative.llm && typeof narrative.llm === "object") Object.assign(result, narrative.llm);
      // The harness's durable `compaction/summary` record ALWAYS carries
      // `provider`/`model` (spread unconditionally; undefined values reject the
      // whole event as non-JSON-serializable). The mechanical path makes no LLM
      // call, so stamp the conversation's routed target — the same model the
      // default summarizer would have used — as the record's provenance.
      const target = this._narrativeTarget(agent);
      if (target && typeof target.provider === "string" && typeof target.model === "string") {
        result.provider = result.provider ?? target.provider;
        result.model = result.model ?? target.model;
      }
      if (result.maxTokens === undefined && this.config && Number.isFinite(this.config.maxTokens)) {
        result.maxTokens = this.config.maxTokens;
      }
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
