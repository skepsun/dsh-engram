/**
 * dsh-engram: shared PURE ESR-model logic for the client views.
 *
 * Everything here is rendering-agnostic and dependency-free (type-only
 * imports from ./api, erased at compile time) so it can be compiled to a
 * plain ESM module (`lib/esrModel.mjs`) and unit-tested under node without
 * a React harness. The three views (full-screen board, settings section,
 * composer dock) used to each carry their own copies of taskGaps & friends —
 * this is the single source of truth, and the tests here are the regression
 * net for exactly the class of bug caught in 0.3.4 (board inheriting a stale
 * task snapshot).
 */

import type { TaskRecord } from "./api";

/** The three esr_close evidence gates, in the order they render. */
export type GapKey = "artifact" | "evaluation" | "memory_ref";

/** Evidence gaps of an active task (artifact / evaluation / memory_ref). */
export function taskGaps(t: TaskRecord): GapKey[] {
  const gaps: GapKey[] = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}

/** Compact stable id for a card ("<first6>…<last4>" when long). */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Beads-inspired derived blocked state: open (non-stable) blocks/parent-of deps. */
export function blockedBy(t: TaskRecord, all: TaskRecord[]): number {
  if (t.state === "stable") return 0;
  const open = new Set(all.filter((x) => x.state !== "stable").map((x) => x.id));
  return (t.deps ?? []).filter((d) => d.kind !== "relates-to" && open.has(d.id)).length;
}

/** Human-short claimer ("session-9f3a@web" → "9f3a"). */
export function shortAgent(a: string | null): string {
  if (!a) return "";
  const bare = a.split(/[@#/:\\]+/).pop()!;
  return bare.replace(/^session[-_]/i, "").replace(/^agent[-_]/i, "").slice(0, 14);
}

/** Short zh-CN birthdate used in the markdown export ("8月26日"). */
export function fmtDateShort(ts: number): string {
  return ts ? new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "–";
}

/** Rendering-agnostic markdown export of the current task view. */
export function buildTasksMarkdown(tasks: TaskRecord[]): string {
  const esc = (s: string) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = tasks
    .slice()
    .sort((a, b) => a.state.localeCompare(b.state) || (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((t) => {
      const ev = `${t.artifact ? "artifact✓" : "artifact✗"} · ${t.evaluation ? "eval✓" : "eval✗"} · ${(t.memoryRefs?.length ?? 0) > 0 ? "ref✓" : "ref✗"}`;
      return `| ${t.state} | ${esc(t.name)} | ${esc(t.workspace.replace(/^.*[\\/]/, ""))} | ${esc(taskGaps(t).join(", ") || "—")} | ${ev} | ${fmtDateShort(t.createdAt ?? 0)} |`;
    });
  return `# ESR 任务导出 · ${new Date().toISOString().slice(0, 10)}\n\n| 状态 | 任务 | 工作区 | 证据缺口 | 证据 | 创建 |\n|---|---|---|---|---|---|\n${rows.join("\n") || "(无任务)"}`;
}

/**
 * Shared auto-refresh interval for every polling surface (board / section /
 * preview / telemetry / dock). One constant so the views can never drift
 * apart again — the 0.3.3 board kept 20s polling yet never surfaced newly
 * created tasks; consistency here is part of the fix.
 */
export const POLL_MS = 20000;
