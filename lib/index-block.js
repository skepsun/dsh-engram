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

import { label, shortId, fmtDate, escapeLt, truncate } from "./util.js";

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

/**
 * Select the memories that earn an index line: knowingly stored high-signal
 * entries, auto-captures past minIndexSignal, and low-signal entries promoted
 * by repeated recall (hits >= promoteHits). Sorted newest first.
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
    .slice(0, config.indexMaxLines);
}

function memoryLine(m) {
  const px = prefixFor(m.kind);
  const date = fmtDate(m.createdAt ?? m.updatedAt);
  const text = truncate(String(m.text).replace(/\s*\n+\s*/g, " ").trim(), INDEX_LINE_CHARS);
  return `[${px}] ${date} ${escapeLt(text)} #${shortId(m.id)}`;
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
  for (const m of memories.slice(0, config.indexMaxLines)) lines.push(memoryLine(m));
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
 * One-line, data-driven escalation reminder. Surfaces the workspace real
 * recent mem-vs-esr balance (usage rollup, last 14 days) so the model sees
 * its own under-proactivity at the next session and can self-correct NOW.
 * Returns "" when there is nothing to correct (no data, too small a sample,
 * or the balance is healthy) — the reminder disappears once behaviour
 * improves, closing the loop.
 */
export function escalationHint(store, workspace) {
  const rows = store.usageRows(workspace);
  if (rows.length === 0) return "";
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
  // No data or too little signal — lecturing on <3 memory ops is noise.
  if (memCalls < 3) return "";
  const ratio = esrCalls / (memCalls + esrCalls);
  // Healthy once esr exceeds ~half the memory-ops volume; otherwise nudge.
  if (ratio >= 0.34) return "";
  return `escalate: last ${recent.length}d ${memCalls} mem ops vs ${esrCalls} esr calls (${Math.round(ratio * 100)}%) — multi-step work → esr_task now, recurring objects → esr_node, related things → esr_link, and close with evidence (esr_close)`;
}

/**
 * Render the [ESR] block — active tasks with closure gaps. Only appears when
 * at least one task exists. "STABLE" tasks are folded to a count line to save
 * tokens.
 */
export function renderEsr(store, workspace, config) {
  const active = store.listTasks(workspace, { includeStable: false });
  const stable = store.listTasks(workspace, { includeStable: true }).filter((t) => t.state === "stable");
  const hint = escalationHint(store, workspace);
  if (active.length === 0 && stable.length === 0) {
    // Keep the mechanism visible even when idle: one compact line teaches the
    // model that multi-step work earns an esr_task closed with real evidence.
    const base = "[ESR] no open tasks — BE PROACTIVE: multi-step work gets a task now (esr_task); recurring domain objects get a node (esr_node); related things get a link (esr_link). Close tasks with real evidence (esr_close)";
    return hint === "" ? base : `${base}\n${hint}`;
  }

  const lines = [];
  lines.push(`[ESR] tasks: ${active.length} active / ${stable.length} stable`);
  for (const t of active.slice(0, 8)) lines.push(`- ${t.id.slice(0, 6)}: ${escapeLt(truncate(t.name, 60))} — ${t.state.toUpperCase()}${taskGapSuffix(t)}`);
  if (active.length > 8) lines.push(`- … ${active.length - 8} more`);
  if (stable.length > 0) lines.push(`- closed: ${stable.slice(0, 6).map((t) => `${t.id.slice(0, 6)} (${truncate(t.name, 28)})`).join(" · ")}${stable.length > 6 ? ` +${stable.length - 6}` : ""}`);
  if (hint !== "") lines.push(hint);
  return lines.join("\n");
}

function taskGapSuffix(t) {
  if (t.state === "stable") return "";
  const gaps = [];
  if (t.artifact === null || t.artifact === "") gaps.push("artifact");
  if (t.evaluation === null || t.evaluation === "") gaps.push("evaluation");
  if (t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps.length === 0 ? " · READY to close" : ` · gap: ${gaps.join(", ")}`;
}
