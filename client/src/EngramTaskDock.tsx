/**
 * dsh-engram client: the unified "任务" dock strip above the composer.
 *
 * It occupies the SAME 'conversation.input.dock' cell as the built-in todo
 * strip (id 'todo', lower priority => shadows it) and MERGES the two task
 * planes into one control:
 *   - the session's built-in plan (the `todos` projection todo_write drives),
 *     rendered as a compact "本轮计划" section — the built-in TodoPanel's job,
 *     now inside this strip;
 *   - the workspace's persistent ESR tasks (esr_task) with their evidence
 *     loops — the protocol that replaces the plain todo tool;
 *   - the workspace's relation graph (esr_node / esr_link) with names
 *     resolved through the entity/task tables.
 *
 * Data sources: `useProjection('todos')` (host-computed, live) plus
 * /api/dsh-engram tasks/links/nodes for the current session cwd (the same
 * loopback-fenced family the settings page uses; light 15s polling keeps it
 * current while the agent works). The strip renders only when there is
 * anything to show (plan items, ESR tasks, or relations), exactly like the
 * built-in todo strip hides when empty.
 *
 * Interactions (mirror the settings page's ESR board):
 *   - collapsible header with live counts (plan / ESR / relations)
 *   - 快速新建任务 (POST /tasks)
 *   - per-task 补齐证据 / 关闭 (POST /tasks/close, evidence gates)
 *
 * Plain React + inline styles + a tiny scoped <style> shim for hover/entrance
 * transitions — no UI-primitives import (bundle-purity gate: the compiled
 * bundle value-imports react only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { EngramApi, LinkRecord, TaskRecord, EntityRecord } from "./api";
import { useEngramTheme } from "./theme";

/** Status of one built-in plan item (mirrors @deepseek-ai/dsh-tool-todo/client). */
export type PlanItemStatus = "pending" | "in_progress" | "completed";
export interface PlanItem {
  content: string;
  status: PlanItemStatus;
}

export interface EngramTaskDockProps {
  /** Resolved by the framework: the current session id (session-scope slot). */
  sessionId?: string | undefined;
  /** Global standard-kit hooks merged by the renderer. */
  useSessions?: (selector: (s: unknown) => unknown) => unknown;
  useWorkspaces?: (selector: (s: unknown) => unknown) => unknown;
  /** Key-addressed projection reader ('todos' = the built-in plan list). */
  useProjection?: (key: string) => unknown;
  /** Injected face: the browser API client. */
  api: EngramApi;
}

interface DockData {
  tasks: TaskRecord[];
  links: LinkRecord[];
  nodes: EntityRecord[];
  /** 403 loopback-only denial — pauses auto-polling. */
  denied: boolean;
  error: string | null;
  loading: boolean;
}

const EMPTY: DockData = { tasks: [], links: [], nodes: [], denied: false, error: null, loading: true };

/** Normalize a session cwd into the engram workspace key (trailing separator removed). */
function normalizeWs(cwd: string | undefined): string {
  if (!cwd) return "";
  return cwd.replace(/[\\/]+$/, "") || cwd;
}

function shortIdS(id: string): string {
  const bare = id.replace(/[^a-z0-9]/gi, "");
  return (bare.length >= 8 ? bare.slice(0, 8) : id.slice(0, 8)) || "?";
}

function fmtD(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const taskGaps = (t: TaskRecord): string[] => {
  const gaps: string[] = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
};

/** Status coloring used across the strip (light/dark aware via CSS vars). */
const STATUS = {
  gap: { bg: "var(--dsw-alias-state-warn-secondary, rgba(245,158,11,.14))", fg: "var(--dsw-alias-state-warn-label, #b45309)" },
  ready: { bg: "rgba(59,130,246,.13)", fg: "var(--dsw-alias-label-primary-bluish, #1d4ed8)" },
  stable: { bg: "rgba(16,185,129,.14)", fg: "var(--dsw-alias-state-success-primary, #047857)" },
};

/* ------------------------------------------------------------------ */
/* Icons (inline SVG — no UI-primitives import allowed)                */
/* ------------------------------------------------------------------ */

function IconChecklist({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 8.1l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevron({ down }: { down: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true"
      style={{ transform: down ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .18s ease" }}>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlus({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconRefresh({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.2 5.2A5.4 5.4 0 1 0 13.4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.2 2.6v2.6h-2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function IconLink({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.8 9.2c1 1 2.6 1 3.6 0l2.3-2.3a2.55 2.55 0 0 0-3.6-3.6L8.3 4.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.2 6.8c-1-1-2.6-1-3.6 0L3.3 9.1a2.55 2.55 0 0 0 3.6 3.6l1.2-1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconArrow({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.6 8h10.4M9.6 4.8L13 8l-3.4 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Plan-item status glyphs (mirror the built-in TodoPanel's 14px artboard). */
function PlanGlyph({ status }: { status: PlanItemStatus }) {
  if (status === "completed") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ color: "var(--dsw-alias-state-success-primary, #059669)", flex: "none" }}>
        <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M10.96 5.71L7.7 8.98c-.22.22-.42.42-.6.57-.2.16-.43.3-.73.35a1.5 1.5 0 0 1-.74 0c-.3-.05-.53-.2-.73-.35a7 7 0 0 1-.6-.57L3.04 7.46l.93-.93 1.51 1.51 4.55-4.55.93.92z" fill="currentColor" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ color: "var(--dsw-alias-label-primary-bluish, #3b82f6)", flex: "none" }}>
        <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" opacity=".45" />
        <path d="M7 3v4l2.6 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ color: "var(--dsw-alias-label-tertiary, #9ca3af)", flex: "none" }}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped style shim (hover + entrance transitions)                    */
/* ------------------------------------------------------------------ */

const DOCK_STYLE_ID = "engram-dock-styles";

function ensureDockStyles(): void {
  if (typeof document === "undefined" || document.getElementById(DOCK_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = DOCK_STYLE_ID;
  style.textContent = `
[data-engram-dock] { --ed-accent-a: #6366f1; --ed-accent-b: #8b5cf6; --ed-accent-c: #22d3ee; }
[data-engram-dock] .ed-header { transition: background .16s ease; }
[data-engram-dock] .ed-header:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(120,130,150,.08)); }
[data-engram-dock] .ed-btn { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
[data-engram-dock] .ed-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(120,130,150,.10)); }
[data-engram-dock] .ed-btn:active:not(:disabled) { transform: translateY(1px); }
[data-engram-dock] .ed-task { transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
[data-engram-dock] .ed-task:hover { border-color: var(--dsw-alias-border-l3, #c7d2fe); box-shadow: 0 1px 6px rgba(76,84,191,.08); }
@keyframes ed-rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
[data-engram-dock] .ed-anim { animation: ed-rise .18s ease; }
@media (prefers-reduced-motion: reduce) { [data-engram-dock] .ed-anim { animation: none; } }
`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/* The dock strip                                                      */
/* ------------------------------------------------------------------ */

export function EngramTaskDock({ sessionId, useSessions, useWorkspaces, useProjection, api }: EngramTaskDockProps) {
  ensureDockStyles();
  const { vars } = useEngramTheme();

  const [collapsed, setCollapsed] = useState(true);
  const [data, setData] = useState<DockData>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [closingFor, setClosingFor] = useState<string | null>(null);
  const [closeArtifact, setCloseArtifact] = useState("");
  const [closeEval, setCloseEval] = useState("");
  const [closeRefs, setCloseRefs] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focusWs, setFocusWs] = useState("");
  const [wsOpen, setWsOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<number | null>(null);

  // Current session workspace cwd (the engram workspace key), resolved from
  // the framework session list; falls back to the workspace registry path.
  const sessionsState = (useSessions?.call ? useSessions((s: unknown) => s) : undefined) as
    | { byId?: Record<string, { cwd?: string } | undefined> }
    | undefined;
  const workspacesState = (useWorkspaces?.call ? useWorkspaces((s: unknown) => s) : undefined) as
    | { items?: Array<{ path: string; sessionIds: string[] }> }
    | undefined;

  // The built-in plan list (todo_write) — host-computed projection; the
  // built-in TodoPanel reads this exact key, so merging it here keeps the
  // model's plan visible inside the unified strip.
  const planRaw = useProjection ? useProjection("todos") : undefined;
  const planItems = useMemo<PlanItem[]>(() => {
    if (!Array.isArray(planRaw)) return [];
    return planRaw.filter(
      (x): x is PlanItem => typeof x === "object" && x !== null && typeof (x as PlanItem).content === "string",
    );
  }, [planRaw]);

  const cwd = useMemo(() => {
    if (!sessionId) return "";
    const fromSession = sessionsState?.byId?.[sessionId]?.cwd;
    if (fromSession) return normalizeWs(fromSession);
    const ws = workspacesState?.items?.find((w) => w.sessionIds.includes(sessionId));
    return ws ? normalizeWs(ws.path) : "";
  }, [sessionId, sessionsState, workspacesState]);

  /** Workspace focus: "" follows the session; otherwise a pinned workspace. */
  const effWs = focusWs || cwd;
  const wsOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ path: string; label: string }> = [];
    for (const w of workspacesState?.items ?? []) {
      const p = normalizeWs(w.path);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, label: p.split(/[/\\]/).filter(Boolean).pop() ?? p });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [workspacesState]);

  const load = useCallback(async () => {
    if (!effWs) {
      setData({ ...EMPTY, loading: false });
      setTouched(true);
      return;
    }
    setData((prev) => ({ ...prev, loading: true }));
    try {
      const [tasks, links, nodes] = await Promise.all([
        api.tasks(effWs, true),
        api.links(effWs),
        api.nodes(effWs),
      ]);
      setData({ tasks: tasks.items, links: links.items, nodes: nodes.items, denied: false, error: null, loading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const denied = /403|loopback/i.test(message);
      setData((prev) => ({ ...prev, denied, error: message, loading: false }));
    } finally {
      setTouched(true);
    }
  }, [effWs, api]);

  // (Re)load whenever the workspace changes; light polling keeps the strip
  // current while the agent works. Polling pauses under a loopback deny so a
  // tunneled GUI isn't spammed.
  useEffect(() => {
    setTouched(false);
    void load();
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    if (!effWs || data.denied) return;
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => void load(), 15000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [effWs, data.denied, load]);

  // close the workspace menu on outside click
  useEffect(() => {
    if (!wsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wsOpen]);

  const activeTasks = useMemo(() => data.tasks.filter((t) => t.state !== "stable"), [data.tasks]);
  const readyTasks = activeTasks.filter((t) => taskGaps(t).length === 0);
  const gappedTasks = activeTasks.filter((t) => taskGaps(t).length > 0);
  const stableCount = data.tasks.length - activeTasks.length;

  // Resolve node/task ids to display names for relation rows.
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of data.nodes) map.set(n.id, n.name);
    for (const t of data.tasks) map.set(t.id, t.name);
    return (id: string) => map.get(id) ?? id;
  }, [data.nodes, data.tasks]);

  // The strip stays hidden while there is genuinely nothing to show. Two
  // visibility planes, so the built-in plan never disappears behind the
  // engram API: plan items render from the host projection (no HTTP), while
  // the ESR/relations sections need a successful /api/dsh-engram read.
  const planVisible = planItems.length > 0;
  const esrVisible = touched && !data.loading && !data.denied
    && (activeTasks.length > 0 || data.links.length > 0);
  if (!effWs || (!planVisible && !esrVisible)) return null;

  const refreshNow = () => void load();
  const toggle = () => setCollapsed((v) => !v);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setActionBusy(true);
    try {
      await api.createTask(effWs, name, newDesc);
      setNewName("");
      setNewDesc("");
      setCreating(false);
      await load();
    } catch (e) {
      setData((prev) => ({ ...prev, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setActionBusy(false);
    }
  };

  const submitClose = async (task: TaskRecord) => {
    setActionBusy(true);
    setData((prev) => ({ ...prev, error: null }));
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const out = await api.closeTask(task.workspace, task.id, {
        artifact: closeArtifact,
        evaluation: closeEval,
        memoryRefs: refs,
      });
      if (out.state === "active") {
        setData((prev) => ({
          ...prev,
          error: `证据仍有缺口：${(out.gaps ?? []).join(", ")} — 任务保持 ACTIVE`,
        }));
      } else {
        setClosingFor(null);
        setCloseArtifact("");
        setCloseEval("");
        setCloseRefs("");
      }
      await load();
    } catch (e) {
      setData((prev) => ({ ...prev, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setActionBusy(false);
    }
  };

  const wsBasename = cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd;
  const following = focusWs === "";
  const effLabel = (effWs.split(/[/\\]/).filter(Boolean).pop() ?? effWs) || "—";

  return (
    <div
      data-engram-dock
      style={{
        boxSizing: "border-box",
        flex: "none",
        margin: "0 auto",
        width: "calc(100% - var(--dsh-composer-side-clearance, 8px) * 2 - var(--dsh-composer-dock-inset, 6px) * 4)",
        maxWidth: "calc(var(--dsh-composer-card-max-width, 760px) - var(--dsh-composer-dock-inset, 6px) * 4)",
        border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
        borderRadius: 12,
        background: "var(--dsw-specific-tip, var(--dsh-color-surface, #ffffff))",
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 1px 2px rgba(15,23,42,.05), 0 2px 10px rgba(15,23,42,.04)",
        ...vars,
      }}
    >
      {/* Accent edge */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: "linear-gradient(180deg, var(--ed-accent-a) 0%, var(--ed-accent-b) 55%, var(--ed-accent-c) 100%)",
        }}
      />

      <button
        type="button"
        className="ed-header"
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "9px 12px 9px 15px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
          font: "inherit",
        }}
      >
        <span
          style={{
            display: "grid",
            flex: "none",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 7,
            color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
            background: "var(--dsw-alias-state-business-tertiary, rgba(99,102,241,.12))",
          }}
        >
          <IconChecklist />
        </span>
        <span style={{ flex: "none", fontSize: 13, fontWeight: 600, lineHeight: "20px", color: "var(--dsw-alias-label-primary, inherit)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          任务
          <span style={{ ...chip, ...chipNeutral, fontSize: 9.5, padding: "0 6px", lineHeight: "15px", fontWeight: 700, letterSpacing: ".02em" }}>ESR</span>
        </span>
        <span ref={wsMenuRef} onClick={(e) => e.stopPropagation()} style={{ position: "relative", display: "inline-flex", flex: "none", alignItems: "center" }}>
          <span
            role="button"
            tabIndex={0}
            title={following ? `跟随当前会话 · 工作区 ${wsBasename || "—"}（点击切换 ESR 任务来源）` : `已固定到 ${effLabel}（点击切换）`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWsOpen((v) => !v); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setWsOpen((v) => !v); } }}
            style={wsChip}
          >
            {effLabel}
            <span style={{ fontSize: 8, opacity: 0.75, marginLeft: 3 }}>{wsOpen ? "▲" : "▼"}</span>
          </span>
          {!following && (
            <span
              role="button"
              tabIndex={0}
              title="恢复跟随当前会话"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFocusWs(""); setWsOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setFocusWs(""); setWsOpen(false); } }}
              style={wsClear}
            >
              ×
            </span>
          )}
          {wsOpen && (
            <div style={wsMenu} role="menu">
              <div role="menuitem" style={wsItem(following)} onClick={() => { setFocusWs(""); setWsOpen(false); }}>
                跟随会话 · {wsBasename || "—"}{following ? " ✓" : ""}
              </div>
              {wsOptions.length === 0 && (
                <div style={{ ...wsItem(false), cursor: "default", color: "var(--dsh-color-muted-weak, #9ca3af)" }}>暂无其他工作区</div>
              )}
              {wsOptions.map((o) => (
                <div key={o.path} role="menuitem" style={wsItem(effWs === o.path && !following)} onClick={() => { setFocusWs(o.path); setWsOpen(false); }}>
                  {o.label}{effWs === o.path && !following ? " ✓" : ""}
                </div>
              ))}
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--dsh-color-border, #e5e7eb)", fontSize: 10.5, color: "var(--dsh-color-muted-weak, #9ca3af)", padding: "3px 9px" }}>
                仅切换 ESR 任务/关系来源；内置 todo 仍属本会话
              </div>
            </div>
          )}
        </span>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            gap: 6,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          {planItems.length > 0 && (
            <span style={{ ...chip, ...chipNeutral }}>本轮计划 {planItems.length}</span>
          )}
          {gappedTasks.length > 0 && (
            <span style={{ ...chip, ...STATUS.gap }}>进行中 {gappedTasks.length}</span>
          )}
          {readyTasks.length > 0 && (
            <span style={{ ...chip, ...STATUS.ready }}>就绪 {readyTasks.length}</span>
          )}
          {stableCount > 0 && (
            <span style={{ ...chip, ...STATUS.stable }}>已闭环 {stableCount}</span>
          )}
          {data.links.length > 0 && <span style={{ ...chip, ...chipNeutral }}>关系 {data.links.length}</span>}
          {data.error && (
            <span style={{ ...chip, ...chipError }} title={data.error}>API 失败</span>
          )}
        </span>
        <span style={{ display: "grid", placeItems: "center", flex: "none", color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" }}>
          <IconChevron down={!collapsed} />
        </span>
      </button>

      {!collapsed && (
        <div className="ed-anim" style={{ padding: "2px 12px 12px 15px", display: "flex", flexDirection: "column", gap: 8 }}>
          {data.error && (
            <div style={{ fontSize: 12, color: "#dc2626", lineHeight: 1.4 }} role="alert">⚠ {data.error}</div>
          )}
          {data.denied && (
            <div style={{ fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", lineHeight: 1.5 }}>
              ESR 工作区数据不可达（loopback-only 守卫）— 本轮计划照常展示；完整任务与关系见 设置 → Engram 记忆。
            </div>
          )}

          {/* Session plan (the built-in todo_write list, merged in) */}
          {planItems.length > 0 && (
            <div style={planBox}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }}>
                  本轮计划（todo_write）
                </span>
                <span style={{ fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }}>
                  {planItems.filter((p) => p.status === "completed").length}/{planItems.length} 完成 · 跟随会话自动更新
                </span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                {planItems.map((item, i) => (
                  <li key={`${item.content}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: "20px", color: item.status === "completed" ? "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" : "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }}>
                    <span style={{ marginTop: 3 }}><PlanGlyph status={item.status} /></span>
                    <span style={{ textDecoration: item.status === "completed" ? "line-through" : "none", overflowWrap: "anywhere" }}>{item.content}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!data.denied && (
            <>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }}>
              工作区 ESR 任务 · {activeTasks.length} 进行中
            </span>
            <span style={{ flex: "1 1 auto" }} />
            <button type="button" className="ed-btn" style={{ ...btn }}
              onClick={() => { setCreating((v) => !v); setClosingFor(null); }}>
              <IconPlus /> 新建
            </button>
            <button type="button" className="ed-btn" style={{ ...btn }} onClick={refreshNow} disabled={data.loading} title="刷新">
              <IconRefresh /> {data.loading ? "…" : "刷新"}
            </button>
          </div>

          {creating && (
            <div style={{ border: "1px dashed var(--dsw-alias-border-l3, #c7d2fe)", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 6, background: "var(--dsw-alias-bg-multi-select, transparent)" }}>
              <input
                autoFocus
                style={input}
                placeholder="任务名…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); if (e.key === "Escape") setCreating(false); }}
              />
              <input
                style={{ ...input, fontSize: 12 }}
                placeholder="要产出 / 满足什么（可选）"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="ed-btn" style={{ ...btn, ...btnSolid }} disabled={actionBusy || !newName.trim()} onClick={() => void submitCreate()}>
                  {actionBusy ? "…" : "创建"}
                </button>
                <button type="button" className="ed-btn" style={btn} onClick={() => setCreating(false)}>取消</button>
              </div>
            </div>
          )}

          {/* Task cards */}
          {activeTasks.length === 0 && data.tasks.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", padding: "2px 0" }}>
              暂无活动任务 — 点「新建」或在对话中让 agent 用 esr_task 建任务
            </div>
          )}
          {data.tasks.map((task) => {
            const gaps = taskGaps(task);
            const isStable = task.state === "stable";
            const statusColor = isStable ? STATUS.stable : gaps.length === 0 ? STATUS.ready : STATUS.gap;
            const label = isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE";
            const open = closingFor === task.id;
            return (
              <div key={task.id} className="ed-task" style={taskCard}>
                <span aria-hidden style={{ width: 3, borderRadius: 2, alignSelf: "stretch", background: statusColor.fg }} />
                <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary, inherit)", overflowWrap: "anywhere" }}>
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }}>
                        {shortIdS(task.id)}{" "}
                      </span>
                      {task.name}
                    </span>
                    <span style={{ ...chip, ...statusColor, fontWeight: 700 }}>{label}</span>
                    {!isStable && (
                      <button
                        type="button"
                        className="ed-btn"
                        style={{ ...btn, padding: "3px 8px", fontSize: 11.5 }}
                        onClick={() => { setClosingFor(open ? null : task.id); setCreating(false); }}
                      >
                        {open ? "收起" : "补齐证据"}
                      </button>
                    )}
                  </div>
                  {task.description && (
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {task.description}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    {gaps.map((g) => (
                      <span key={g} style={{ ...chip, ...chipGap }} title="证据缺口">{g} ✗</span>
                    ))}
                    {task.memoryRefs.map((r) => (
                      <span key={r} style={{ ...chip, ...chipRef }} title={`memory_ref ${r}`}>#{r.slice(0, 8)}</span>
                    ))}
                    <span style={{ fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }}>
                      {fmtD(task.createdAt)}
                    </span>
                  </div>
                  {open && (
                    <div style={{ border: "1px dashed var(--dsw-alias-border-l2, #e5e7eb)", borderRadius: 8, padding: 7, display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                      <div style={{ fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }}>
                        提供三项证据后转 STABLE（artifact · evaluation · memory_ref）
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        <input style={{ ...input, width: "auto", flex: "1 1 130px" }} placeholder="artifact 路径/URL" value={closeArtifact} onChange={(e) => setCloseArtifact(e.target.value)} />
                        <input style={{ ...input, width: "auto", flex: "1 1 130px" }} placeholder="evaluation 证据" value={closeEval} onChange={(e) => setCloseEval(e.target.value)} />
                        <input style={{ ...input, width: "auto", flex: "1 1 130px" }} placeholder="memory_refs 逗号分隔" value={closeRefs} onChange={(e) => setCloseRefs(e.target.value)} />
                        <button type="button" className="ed-btn" style={{ ...btn, ...btnSolid }} disabled={actionBusy} onClick={() => void submitClose(task)}>
                          {actionBusy ? "…" : "提交关闭"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Relations */}
          {data.links.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }}>
                  关系 · {data.links.length}
                </span>
                <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <IconLink /> esr_node / esr_link 建模
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {data.links.slice(0, 8).map((l) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ ...nodePill }} title={l.source}>{nameOf(l.source)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", fontSize: 11 }}>
                      <span style={{ border: "1px dashed var(--dsw-alias-border-l3, #cbd5e1)", borderRadius: 999, padding: "1px 7px", color: "var(--dsw-alias-label-secondary, #64748b)" }}>{l.relation}</span>
                      <IconArrow />
                    </span>
                    <span style={{ ...nodePill }} title={l.target}>{nameOf(l.target)}</span>
                    <span style={{ fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }}>· {fmtD(l.createdAt)}</span>
                  </div>
                ))}
                {data.links.length > 8 && (
                  <div style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }}>
                    +{data.links.length - 8} 条更多 — 完整关系见 设置 → 设置 · Engram 记忆
                  </div>
                )}
              </div>
            </>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  borderRadius: 999,
  padding: "1px 8px",
  fontSize: 11,
  lineHeight: "18px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const chipNeutral: CSSProperties = {
  background: "var(--dsw-alias-bg-layer-2, var(--dsh-color-hover-bg, #f3f4f6))",
  color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))",
};

const wsChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  fontSize: 11,
  lineHeight: "18px",
  fontWeight: 600,
  cursor: "pointer",
  padding: "1px 7px",
  borderRadius: 999,
  color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))",
  background: "var(--dsw-alias-bg-layer-2, var(--dsh-color-hover-bg, #f3f4f6))",
  border: "1px solid var(--dsh-color-border, #e5e7eb)",
  maxWidth: 150,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const wsClear: CSSProperties = {
  cursor: "pointer",
  marginLeft: 2,
  padding: "0 4px",
  fontSize: 12,
  lineHeight: "16px",
  color: "var(--dsh-color-muted, #6b7280)",
  borderRadius: 6,
  userSelect: "none",
};

const wsMenu: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  zIndex: 60,
  minWidth: 190,
  maxHeight: 260,
  overflowY: "auto",
  background: "var(--dsw-specific-tip, var(--dsh-color-surface, #ffffff))",
  border: "1px solid var(--dsh-color-border, #d1d5db)",
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(15,23,42,.14)",
  padding: 4,
};

const wsItem = (active: boolean): CSSProperties => ({
  fontSize: 12,
  padding: "5px 9px",
  borderRadius: 7,
  cursor: "pointer",
  color: active ? "var(--dsh-color-primary, #2563eb)" : "var(--dsh-color-muted-strong, #374151)",
  background: active ? "rgba(37,99,235,.08)" : "transparent",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

const chipError: CSSProperties = {
  background: "rgba(220,38,38,.10)",
  color: "#dc2626",
};

const chipGap: CSSProperties = {
  background: "var(--dsw-alias-state-warn-secondary, rgba(245,158,11,.14))",
  color: "var(--dsw-alias-state-warn-label, #b45309)",
  fontWeight: 500,
};

const chipRef: CSSProperties = {
  background: "var(--dsw-alias-bg-layer-2, var(--dsh-color-hover-bg, #f3f4f6))",
  color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: 500,
};

const nodePill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  borderRadius: 8,
  padding: "2px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  background: "var(--dsw-alias-state-business-tertiary, rgba(99,102,241,.12))",
  color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
};

const taskCard: CSSProperties = {
  display: "flex",
  gap: 8,
  border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
  borderRadius: 10,
  padding: "7px 9px",
  background: "var(--dsw-alias-bg-layer-1, transparent)",
};

const planBox: CSSProperties = {
  border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
  borderRadius: 10,
  padding: "7px 10px",
  background: "var(--dsw-alias-bg-layer-1, transparent)",
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const btn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  border: "1px solid var(--dsw-alias-border-l2, var(--dsh-color-border, #d1d5db))",
  borderRadius: 8,
  padding: "3px 9px",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))",
  background: "transparent",
};

const btnSolid: CSSProperties = {
  color: "#fff",
  borderColor: "transparent",
  background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
};

const input: CSSProperties = {
  border: "1px solid var(--dsw-alias-border-l2, var(--dsh-color-border, #d1d5db))",
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 12,
  background: "var(--dsw-alias-bg-base, var(--dsh-color-surface, #fff))",
  color: "inherit",
  outline: "none",
  minWidth: 0,
};
