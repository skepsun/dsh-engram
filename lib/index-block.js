/**
 * dsh-engram: the [ENGRAM] symbolic index + [ESR] task block.
 *
 * The whole token-saving philosophy lives here: instead of injecting recalled
 * raw text, we inject ONE compact line per memory (type prefix · short date ·
 * ≤56-char summary · short id) so the model knows what exists and can drill
 * down on demand. The block is rendered once per session and then frozen (the
 * section provider caches by session), keeping the prefix byte-stable for KV
 * cache reuse.
 */

import { label, shortId, fmtDate, escapeLt, truncate, byRecency } from "./util.js";

/** Deterministic index line prefix per memory kind. */
export function prefixFor(kind) {
  switch (kind) {
    case "decision": return "D";
    case "error": return "E";
    case "procedure": return "P";
    case "insight": return "I";
    case "handoff": return "H";
    case "task": return "T";
    default: return "F";
  }
}

const INDEX_LINE_CHARS = 56;

/**
 * Git echoes captured before the plumbing filter still carry the full shell
 * command ("git push: cd /repo && ...") — pure operational noise that should
 * never steal a [ENGRAM] index line unless recall has proven it useful.
 */
function isGitPlumbingEcho(m) {
  if (!Array.isArray(m.tags) || !m.tags.includes("auto-captured") || !m.tags.includes("git")) return false;
  const text = String(m.text ?? "");
  return /(^|\s)(cd\s|\&\&|;|\|)/.test(text);
}

/** A procedure that has been used (hit) enough times to count as proven. */
export function isProvenProcedure(m, config) {
  return (m?.kind ?? "") === "procedure" && (m?.hits ?? 0) >= (config?.promoteHits ?? 3);
}

/**
 * Select the memories that earn an index line: knowingly stored high-signal
 * entries, auto-captures past minIndexSignal, and low-signal entries promoted
 * by repeated recall (hits >= promoteHits). Proven procedures (a Skill-ish
 * asset: a workflow validated by repeated use) are ranked first, stably —
 * each group still newest-first so the block stays deterministic per session.
 */
export function selectIndexMemories(store, workspace, config) {
  const all = store.listMemories(workspace, 200);
  // Stale truth (a newer memory marked itself as replacing that row) never
  // earns an index line — the current statement is the one worth surfacing.
  const { supersededBy } = store.memoryRelations?.(workspace) ?? { supersededBy: new Map() };
  return all
    .filter((m) => !supersededBy.has(m.id))
    .filter(
      (m) =>
        (isGitPlumbingEcho(m) && (m.hits ?? 0) < config.promoteHits
          ? false
          : (m.signal ?? 0.5) >= config.minIndexSignal ||
            (m.hits ?? 0) >= config.promoteHits ||
            m.kind === "task"),
    )
    .sort((a, b) => {
      const ap = isProvenProcedure(a, config) ? 0 : 1;
      const bp = isProvenProcedure(b, config) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return byRecency(a, b);
    })
    .slice(0, config.indexMaxLines);
}

function memoryLine(m, config) {
  const px = prefixFor(m.kind);
  const mark = isProvenProcedure(m, config) ? `${px}✓` : px;
  const date = fmtDate(m.createdAt ?? m.updatedAt);
  const text = truncate(String(m.text).replace(/\s*\n+\s*/g, " ").trim(), INDEX_LINE_CHARS);
  return `[${mark}] ${date} ${escapeLt(text)} #${shortId(m.id)}`;
}

function taskStateLine(t) {
  const gaps = [];
  if (t.artifact === null || t.artifact === "") gaps.push("artifact");
  if (t.evaluation === null || t.evaluation === "") gaps.push("evaluation");
  if (t.memoryRefs.length === 0) gaps.push("memory_ref");
  const state = t.state;
  const suffix =
    state === "stable"
      ? "STABLE (artifact ✓ evaluation ✓ memory_ref ✓)"
      : gaps.length === 0
        ? "READY-to-close"
        : `ACTIVE · gap: ${gaps.join(", ")}`;
  const name = truncate(String(t.name).replace(/\s*\n+\s*/g, " ").trim(), INDEX_LINE_CHARS);
  return `[T] ${fmtDate(t.createdAt)} ${name} — ${suffix} #${t.id.slice(0, 8)}`;
}

/**
 * Render the full [ENGRAM] block (or "" when nothing to show). Pure function;
 * called by the section provider and cached per session.
 */
export function renderIndex(store, workspace, cwd, config) {
  const entries = store.workspaceEntries(workspace);
  const memories = selectIndexMemories(store, workspace, config);
  const tasks = store.listTasks(workspace, { includeStable: false });
  const links = entries.links;

  if (memories.length === 0 && tasks.length === 0 && links === 0) return "";

  const lines = [];
  lines.push(`[ENGRAM] workspace: ${label(cwd)} · ${entries.memories} memories · ${tasks.length} task(s) active · ${links} links · ${entries.nodes} node(s)`);
  const entityNames = store.listEntities(workspace).map((e) => e.name);
  if (entityNames.length > 0) lines.push(`nodes: ${truncate(entityNames.join(", "), 72)}`);
  for (const m of memories.slice(0, config.indexMaxLines)) lines.push(memoryLine(m, config));
  for (const t of tasks.slice(0, 4)) lines.push(taskStateLine(t));
  lines.push("drill: engram_recall <query> | engram_detail <id> | esr_task (multi-step work → create now) | esr_node (recurring domain object → create now) | esr_link (relate nodes/tasks)");
  return enforceCharCap(lines, config.indexMaxChars);
}

/**
 * Keep the header + drill hint, drop the oldest content lines until the
 * joined block fits the character budget (token discipline).
 */
function enforceCharCap(lines, maxChars) {
  if (lines.length <= 2) return lines.join("\n");
  let joined = lines.join("\n");
  while (joined.length > maxChars && lines.length > 2) {
    lines.splice(lines.length - 2, 1);
    joined = lines.join("\n");
  }
  return joined;
}

/**
 * One-line escalation reminder from an arbitrary balance view
 * ({ memCalls, esrCalls, days }). Surfaces the workspace real recent
 * mem-vs-esr balance so the model sees its own under-proactivity and can
 * self-correct NOW. Returns "" when there is nothing to correct (no data,
 * too small a sample, or the balance is healthy) — the reminder disappears
 * once behaviour improves, closing the loop. Pure, deterministic.
 */
export function esrBalanceHint(balance) {
  if (balance === void 0 || balance === null) return "";
  const memCalls = balance.memCalls ?? 0;
  const esrCalls = balance.esrCalls ?? 0;
  const days = balance.days ?? 0;
  // No data or too little signal — lecturing on <3 memory ops is noise.
  if (memCalls < 3 || days < 1) return "";
  const ratio = esrCalls / (memCalls + esrCalls);
  // Healthy once esr exceeds ~a third of memory-ops volume; otherwise nudge.
  if (ratio >= 0.34) return "";
  return `escalate: last ${days}d ${memCalls} mem ops vs ${esrCalls} esr calls (${Math.round(ratio * 100)}%) — multi-step work → esr_task now, recurring objects → esr_node, related things → esr_link, and close with evidence (esr_close) #suggest-escalate`;
}

/**
 * Balance view derived from the per-(workspace,day) `usage` table (legacy).
 * The table is no longer written in production (assessment P3 moved
 * observability to on-demand session-log scans); this path exists for
 * backward compatibility and store-driven tests. Production prefers the
 * live in-memory recorder view (lib/trigger.js) so the nudge is not starved.
 */
export function usageBalanceView(store, workspace) {
  const rows = store.usageRows(workspace);
  if (rows.length === 0) return null;
  const recent = rows.slice(-14);
  const MEM = ["engram_store", "engram_recall", "engram_detail", "loom_store", "loom_recall", "loom_detail"];
  const ESR = ["esr_task", "esr_node", "esr_close", "esr_link", "esr_gc"];
  let memCalls = 0;
  let esrCalls = 0;
  for (const r of recent) {
    const c = r.counts ?? {};
    for (const k of MEM) memCalls += c[k] ?? 0;
    for (const k of ESR) esrCalls += c[k] ?? 0;
  }
  return { memCalls, esrCalls, days: recent.length };
}

/**
 * Legacy entry point (store-driven escalation nudge). Kept for callers/tests
 * that predate the decision-point recorder; prefer `esrBalanceHint` with a
 * live balance view.
 */
export function escalationHint(store, workspace) {
  return esrBalanceHint(usageBalanceView(store, workspace));
}

/**
 * The three ESR closure evidence gates for a task. Null/empty counts as a gap.
 */
export function evidenceGaps(t) {
  const gaps = [];
  if (t.artifact === null || t.artifact === "") gaps.push("artifact");
  if (t.evaluation === null || t.evaluation === "") gaps.push("evaluation");
  if (t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}

/**
 * "What should I do with this task next" sort rank — READY-to-close first
 * (evidence complete → esr_close is the highest-value next move), then claimed
 * in-progress, then other active, then drafts.
 */
function taskNextRank(t) {
  if (t.state === "stable") return 10;
  if (evidenceGaps(t).length === 0) return 0;
  if (t.assignee) return 1;
  if (t.state === "active") return 2;
  if (t.state === "draft") return 3;
  return 4;
}

/**
 * Order active tasks so the model can act top-down without re-scanning.
 *
 * The final tiebreak is the task id (lexicographic), NEVER updatedAt: a
 * timestamp in the sort would make the frozen per-session snapshot drift
 * between turns and shatter the prefix cache. pi-esr's rule 2 — timestamps
 * excluded from context — applied verbatim.
 */
export function sortActiveForNext(tasks) {
  return [...tasks].sort((a, b) => {
    const ra = taskNextRank(a);
    const rb = taskNextRank(b);
    if (ra !== rb) return ra - rb;
    const ga = evidenceGaps(a).length;
    const gb = evidenceGaps(b).length;
    if (ga !== gb) return ga - gb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Recurring-failure candidates (P0-B): error memories that earned
 * `hits >= minErrorHits` through repeat-failure revival — durable breakage,
 * the strongest "turn this into a root-cause task" signal. Most-hit first.
 */
export function selectRootCauseCandidates(store, workspace, config) {
  const min = (config?.minErrorHits ?? 2) | 0;
  if (min < 1) return [];
  return store
    .listMemories(workspace, 200)
    .filter((m) => m.kind === "error" && (m.hits ?? 0) >= min)
    .sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map((m) => ({ id: m.id, text: String(m.text), hits: m.hits ?? 0 }));
}

/**
 * Stale-task candidates (P3): active tasks that have not been touched for
 * `staleTaskDays` (default 14) — close with evidence or drop the intent.
 */
export function selectStaleCandidates(tasks, config) {
  const days = (config?.staleTaskDays ?? 14) | 0;
  if (days < 1) return [];
  const cutoff = Date.now() - days * 86_400_000;
  return tasks
    .filter((t) => (t.updatedAt ?? t.createdAt ?? 0) < cutoff)
    .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt ?? t.createdAt, createdAt: t.createdAt }));
}

/**
 * Static ESR operating methodology (pi-esr rule 1: the system prompt never
 * changes at runtime — this text is process-static and byte-identical every
 * turn). Teaches WHEN to create / promote / close so the model no longer
 * depends on runtime nudges to remember the protocol.
 */
export function esrMethodology() {
  return [
    "ESR（工程状态）操作协议 —— 多步工作建任务、用证据闭环：",
    "  1. 动工前：esr_ready 看可认领工作；esr_status 拿实时状态（本块是会话开始快照，不会自动刷新）。",
    "  2. 多步工作 → esr_task(name=\"…\", entity=…) 建任务（draft 起步）；重复对象 → esr_node；关系 → esr_link。",
    "  3. 动工 → esr_claim（draft → active）。",
    "  4. 收工 → esr_close（artifact + evaluation + memory_ref 三证齐才算数；不齐的活继续挂着，别硬关）。",
    "  state 是唯一真相：拿不准 state 就 call esr_status。",
  ].join("\n");
}

/**
 * Build the DETERMINISTIC per-session [ESR] snapshot for a workspace.
 *
 * Pure derivation from the store — no recorder, no timestamps, no hint lines.
 * Same store snapshot → byte-identical output, so the section provider can
 * render it ONCE per session and freeze it (prefix-cache stable, pi-esr rule
 * 2: injected once, never auto-refreshed; the model PULLS live state).
 *
 * @param opts {{ sessionId?: string }} — reserved for future live-tail
 *   wording; the block itself is identical either way.
 */
export function buildEsrSnapshot(store, workspace, config, opts = {}) {
  const active = store.listTasks(workspace, { includeStable: false });
  const stable = store.listTasks(workspace, { includeStable: true }).filter((t) => t.state === "stable");
  const draft = active.filter((t) => t.state === "draft").length;
  const ordered = sortActiveForNext(active);

  if (active.length === 0 && stable.length === 0) {
    // Keep the mechanism visible even when idle: one compact line teaches the
    // model that multi-step work earns an esr_task closed with real evidence.
    return [
      "[ESR] no open tasks — BE PROACTIVE: multi-step work gets a task now (esr_task); recurring domain objects get a node (esr_node); related things get a link (esr_link). Close tasks with real evidence (esr_close)",
      "snapshot from session start — WILL NOT auto-refresh; call esr_status for live state",
    ].join("\n");
  }

  const lines = [];
  lines.push(`[ESR] tasks: ${ordered.filter((t) => t.state !== "draft").length} active / ${stable.length} stable${draft > 0 ? ` / ${draft} draft` : ""}`);
  const firstReady = ordered.find((t) => evidenceGaps(t).length === 0);
  if (firstReady !== void 0) {
    lines.push(`next: esr_close ${firstReady.id.slice(0, 6)} — ${escapeLt(truncate(firstReady.name, 40))} (all evidence present)`);
  }
  for (const t of ordered.slice(0, 8)) lines.push(`- ${t.id.slice(0, 6)}: ${escapeLt(truncate(t.name, 60))} — ${t.state.toUpperCase()}${taskGapSuffix(t)}`);
  if (active.length > 8) lines.push(`- … ${active.length - 8} more`);
  if (stable.length > 0) lines.push(`- closed: ${stable.slice(0, 6).map((t) => `${t.id.slice(0, 6)} (${truncate(t.name, 28)})`).join(" · ")}${stable.length > 6 ? ` +${stable.length - 6}` : ""}`);
  lines.push("snapshot from session start — WILL NOT auto-refresh; call esr_status for live state");
  return lines.join("\n");
}

/**
 * The derived decision-point hint lines, assembled ONLY on the pull path
 * (`esr_status`) — never in the frozen [ESR] block. Recorder-fed and
 * one-shot per session; P4 exposure is counted here (real return path), while
 * the GUI preview (no recorder/session) yields [] and counts nothing.
 *
 * @returns {Array<{ kind: string, line: string }>}
 */
export function esrHintLines(store, workspace, config, opts = {}) {
  const recorder = opts?.recorder;
  const sessionId = opts?.sessionId;
  const live = recorder !== void 0 && sessionId !== void 0;
  if (!live) return [];
  const active = store.listTasks(workspace, { includeStable: false });
  const ordered = sortActiveForNext(active);
  const out = [];
  const promote = recorder.promoteHint(sessionId, workspace, active.length);
  if (promote !== "") {
    out.push({ kind: "promote", line: promote });
    recorder.emitHint("promote", workspace, sessionId);
  }
  const rootCause = recorder.errorHint(sessionId, workspace, selectRootCauseCandidates(store, workspace, config));
  if (rootCause !== "") {
    out.push({ kind: "rootcause", line: rootCause });
    recorder.emitHint("rootcause", workspace, sessionId);
  }
  const closure = recorder.closureHint(sessionId, workspace, ordered.filter((t) => evidenceGaps(t).length === 0));
  if (closure !== "") {
    out.push({ kind: "close", line: closure });
    recorder.emitHint("close", workspace, sessionId);
  }
  const stale = recorder.staleHint(sessionId, workspace, selectStaleCandidates(active, config));
  if (stale !== "") {
    out.push({ kind: "stale", line: stale });
    recorder.emitHint("stale", workspace, sessionId);
  }
  // Live in-memory balance feeds the escalation reminder (falls back to the
  // legacy usage-table view for store-driven callers without a recorder).
  const balance = recorder !== void 0 ? recorder.recentBalance(workspace) : usageBalanceView(store, workspace);
  const escalate = esrBalanceHint(balance);
  if (escalate !== "") {
    out.push({ kind: "escalate", line: escalate });
    recorder.emitHint("escalate", workspace, sessionId);
  }
  return out;
}

/**
 * Render the frozen [ESR] snapshot (backward-compatible face of
 * `buildEsrSnapshot`). ALWAYS hint-free: the section provider renders this
 * once per session and freezes it; decision-point lines live on the
 * `esr_status` pull path via `esrHintLines`.
 */
export function renderEsr(store, workspace, config, opts = {}) {
  return buildEsrSnapshot(store, workspace, config, opts);
}

/** Stable display order for accumulated this-session actionables. */
export const ESR_HINT_ORDER = ["promote", "rootcause", "close", "stale", "escalate"];

/**
 * Build the per-session [ESR] block the model actually sees: a FROZEN
 * deterministic snapshot (never changes mid-session, pi-esr rule 2) PLUS the
 * session's monotonically accumulated decision-point actionables.
 *
 * An actionable is APPENDED exactly once, the first time it matures (the
 * recorder's per-(session,kind) suppression makes esrHintLines return it only
 * that once); after appending it stays for the whole session (never removed,
 * even if the underlying condition later clears) — so the prefix changes only
 * when genuinely new decision-point info appears, never per-turn. Snapshot
 * stays pure (no timestamps, no recorder) and live state is still pulled via
 * `esr_status`.
 *
 * @param opts {{
 *   recorder?: import("./trigger.js").TriggerRecorder,
 *   sessionId?: string,
 *   holder?: { actionables: Map<string,string> },  // per-session accumulator
 *   snapshot?: string,                             // pre-frozen snapshot (host passes the session-start one)
 * }}
 */
export function buildFrozenEsrBlock(store, workspace, config, opts = {}) {
  // Host passes the session-start snapshot (frozen, pi-esr rule 2); callers
  // without one get a fresh deterministic derivation (pure functions/tests).
  const snapshot = typeof opts?.snapshot === "string" ? opts.snapshot : buildEsrSnapshot(store, workspace, config, opts);
  const holder = opts?.holder;
  const recorder = opts?.recorder;
  const sessionId = opts?.sessionId;
  if (holder !== void 0 && recorder !== void 0 && sessionId !== void 0) {
    const fresh = esrHintLines(store, workspace, config, { recorder, sessionId });
    for (const h of fresh) holder.actionables.set(h.kind, h.line);
    if (holder.actionables.size > 0) {
      const lines = [snapshot, "# this-session actionables (frozen)"];
      for (const kind of ESR_HINT_ORDER) {
        const line = holder.actionables.get(kind);
        if (line !== void 0) lines.push(line);
      }
      return lines.join("\n");
    }
  }
  return snapshot;
}

/**
 * Compose an `esr_status` response (the PULL surface): the deterministic ESR
 * snapshot + revision, plus the derived decision-point hints. When the caller
 * passes the current revision via `sinceRevision`, the state view collapses
 * to a short "unchanged" line (pi-esr rule 3) while actionables still surface
 * — they are the volatile part (balance / stale window) that motivates a pull.
 *
 * @param opts {{ recorder?, sessionId?, sinceRevision? }}
 */
export function buildEsrStatusView(store, workspace, config, opts = {}) {
  const revision = store.esrFingerprint(workspace);
  const hints = esrHintLines(store, workspace, config, opts);
  const hintBlock = hints.length > 0 ? ["── actionables ──", ...hints.map((h) => h.line)].join("\n") : "";
  const since = opts?.sinceRevision;
  if (since !== void 0 && since !== null && since !== "" && since === revision) {
    const lines = ["[ESR_STATUS]", `ESR state unchanged since revision ${since}.`, `ESR revision: ${revision}`];
    if (hintBlock !== "") lines.push("", hintBlock);
    return lines.join("\n");
  }
  const snapshot = buildEsrSnapshot(store, workspace, config, opts);
  const lines = [snapshot, `ESR revision: ${revision}`];
  if (hintBlock !== "") lines.push("", hintBlock);
  return lines.join("\n");
}

function taskGapSuffix(t) {
  if (t.state === "stable") return "";
  const gaps = evidenceGaps(t);
  return gaps.length === 0 ? " · READY to close" : ` · gap: ${gaps.join(", ")}`;
}
