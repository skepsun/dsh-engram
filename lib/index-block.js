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
  return all
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

/** Order active tasks so the model can act top-down without re-scanning. */
export function sortActiveForNext(tasks) {
  return [...tasks].sort((a, b) => {
    const ra = taskNextRank(a);
    const rb = taskNextRank(b);
    if (ra !== rb) return ra - rb;
    const ga = evidenceGaps(a).length;
    const gb = evidenceGaps(b).length;
    if (ga !== gb) return ga - gb;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
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
 * Render the [ESR] block — active tasks with closure gaps. Only appears when
 * at least one task exists. "STABLE" tasks are folded to a count line to save
 * tokens.
 *
 * @param opts {{
 *   recorder?: import("./trigger.js").TriggerRecorder,  // decision-point recorder (P0-A–P3)
 *   sessionId?: string,                                  // live session for the hints
 * }}
 */
export function renderEsr(store, workspace, config, opts = {}) {
  const recorder = opts?.recorder;
  const sessionId = opts?.sessionId;
  const live = recorder !== void 0 && sessionId !== void 0;
  const active = store.listTasks(workspace, { includeStable: false });
  const stable = store.listTasks(workspace, { includeStable: true }).filter((t) => t.state === "stable");
  const ordered = sortActiveForNext(active);
  // Prefer the live in-memory balance (recorder); fall back to the legacy
  // usage-table view so store-driven callers/tests keep working unchanged.
  const balance = recorder !== void 0 ? recorder.recentBalance(workspace) : usageBalanceView(store, workspace);
  const hint = esrBalanceHint(balance);
  const promote = live ? recorder.promoteHint(sessionId, workspace, active.length) : "";
  const rootCause = live ? recorder.errorHint(sessionId, workspace, selectRootCauseCandidates(store, workspace, config)) : "";
  const closure = live ? recorder.closureHint(sessionId, workspace, ordered.filter((t) => evidenceGaps(t).length === 0)) : "";
  const stale = live ? recorder.staleHint(sessionId, workspace, selectStaleCandidates(active, config)) : "";
  // P4: count only what is actually injected for a live session (never the
  // GUI preview, which renders the same lines without a sessionId).
  if (live) {
    if (promote !== "") recorder.emitHint("promote", workspace, sessionId);
    if (rootCause !== "") recorder.emitHint("rootcause", workspace, sessionId);
    if (closure !== "") recorder.emitHint("close", workspace, sessionId);
    if (stale !== "") recorder.emitHint("stale", workspace, sessionId);
    if (hint !== "") recorder.emitHint("escalate", workspace, sessionId);
  }

  if (active.length === 0 && stable.length === 0) {
    // Keep the mechanism visible even when idle: one compact line teaches the
    // model that multi-step work earns an esr_task closed with real evidence.
    const base = "[ESR] no open tasks — BE PROACTIVE: multi-step work gets a task now (esr_task); recurring domain objects get a node (esr_node); related things get a link (esr_link). Close tasks with real evidence (esr_close)";
    const rest = [promote, rootCause, hint].filter((l) => l !== "");
    return rest.length === 0 ? base : `${base}\n${rest.join("\n")}`;
  }

  const lines = [];
  lines.push(`[ESR] tasks: ${active.length} active / ${stable.length} stable`);
  const firstReady = ordered.find((t) => evidenceGaps(t).length === 0);
  if (firstReady !== void 0) {
    lines.push(`next: esr_close ${firstReady.id.slice(0, 6)} — ${escapeLt(truncate(firstReady.name, 40))} (all evidence present)`);
  }
  for (const t of ordered.slice(0, 8)) lines.push(`- ${t.id.slice(0, 6)}: ${escapeLt(truncate(t.name, 60))} — ${t.state.toUpperCase()}${taskGapSuffix(t)}`);
  if (active.length > 8) lines.push(`- … ${active.length - 8} more`);
  if (stable.length > 0) lines.push(`- closed: ${stable.slice(0, 6).map((t) => `${t.id.slice(0, 6)} (${truncate(t.name, 28)})`).join(" · ")}${stable.length > 6 ? ` +${stable.length - 6}` : ""}`);
  if (promote !== "") lines.push(promote);
  if (rootCause !== "") lines.push(rootCause);
  if (closure !== "") lines.push(closure);
  if (stale !== "") lines.push(stale);
  if (hint !== "") lines.push(hint);
  return lines.join("\n");
}

function taskGapSuffix(t) {
  if (t.state === "stable") return "";
  const gaps = evidenceGaps(t);
  return gaps.length === 0 ? " · READY to close" : ` · gap: ${gaps.join(", ")}`;
}
