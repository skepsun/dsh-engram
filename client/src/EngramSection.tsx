/**
 * dsh-engram client: the Settings → "Engram 记忆" page (settings.section).
 *
 * Reads the real store through the /api/dsh-engram route family and renders:
 *   - overview stat cards (counts, capture totals, per-workspace index cost)
 *   - memory search/filter table with archive/delete actions
 *   - the ESR task board (state + evidence gaps) and the relation list
 *   - the interactive force-directed relation graph (EngramGraph)
 *
 * Plain React + inline styles — no UI-primitives import (bundle-purity gate).
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EngramGraph } from "./EngramGraph";
import { EngramPreview } from "./EngramPreview";
import { EvidenceRing } from "./EvidenceRing";
import { EngramTelemetry } from "./EngramTelemetry";
import { EngramDetail, type DetailTarget } from "./EngramDetail";
import type { EngramApi, EngramConfig, EngramOverview, MemoryRecord, TaskRecord, LinkRecord, EntityRecord, GcReport, EngramStats } from "./api";
import { useEngramTheme } from "./theme";

export interface EngramSectionFace {
  api: EngramApi;
  t: (key: string) => string;
}

const KIND_COLORS: Record<string, string> = {
  decision: "#2563eb",
  error: "#dc2626",
  procedure: "#7c3aed",
  fact: "#059669",
  insight: "#d97706",
  handoff: "#0891b2",
  task: "#4f46e5",
};

const KIND_LABEL: Record<string, string> = {
  decision: "决定",
  error: "错误",
  procedure: "流程",
  fact: "事实",
  insight: "洞察",
  handoff: "交接",
  task: "任务",
};

const s = {
  root: { padding: "2px 4px 40px" },
  h1: { fontSize: 20, fontWeight: 700, margin: "0 0 4px" },
  sub: { color: "var(--dsh-color-muted, #6b7280)", fontSize: 12, margin: "0 0 16px" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 },
  card: {
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    borderRadius: 12,
    padding: "10px 12px",
    background: "var(--dsh-color-surface, #ffffff)",
    boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 2px 8px rgba(15,23,42,.03)",
  },
  cardNum: { fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
  cardLabel: { color: "var(--dsh-color-muted, #6b7280)", fontSize: 11, marginTop: 2 },
  row: { display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 12 },
  input: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    background: "var(--dsh-color-surface, #fff)",
    color: "inherit",
  },
  btn: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)",
    transition: "background .15s ease, border-color .15s ease",
  },
  btnPrimary: {
    border: "1px solid transparent",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    color: "#fff",
    background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
    boxShadow: "0 1px 3px rgba(99,102,241,.35)",
    transition: "opacity .15s ease",
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12.5, tableLayout: "fixed" as const },
  clamp3: { display: "-webkit-box" as const, WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden", maxHeight: 60, minHeight: 18, lineHeight: 1.5, wordBreak: "break-word" as const, whiteSpace: "normal" as const },
  expanded: { whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, lineHeight: 1.5 },
  linkBtn: { border: "none", background: "none", padding: 0, fontSize: 11.5, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", textDecoration: "underline" as const },
  pageBar: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", flexWrap: "wrap" as const },
  tabBar: {
    display: "inline-flex",
    gap: 4,
    padding: 3,
    background: "var(--dsh-color-hover-bg, #f3f4f6)",
    borderRadius: 999,
    marginBottom: 14,
  },
  tab: {
    border: "none",
    background: "none",
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "var(--dsh-color-muted, #6b7280)",
    borderRadius: 999,
    fontWeight: 600,
    margin: 0,
    transition: "background .16s ease, color .16s ease",
  },
  tabActive: {
    border: "none",
    background: "var(--dsh-color-surface, #fff)",
    color: "var(--dsh-color-primary, #2563eb)",
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    borderRadius: 999,
    fontWeight: 700,
    margin: 0,
    boxShadow: "0 1px 3px rgba(15,23,42,.10)",
  },
  th: {
    textAlign: "left" as const,
    padding: "6px 8px",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
    color: "var(--dsh-color-muted, #6b7280)",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
  td: { padding: "6px 8px", borderBottom: "1px solid var(--dsh-color-border, #f3f4f6)", verticalAlign: "top" as const },
  wsHead: {
    padding: "8px 8px 4px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--dsh-color-muted, #4b5563)",
    background: "var(--dsh-color-hover-bg, #f3f4f6)",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
  },
  badge: { display: "inline-block", borderRadius: 5, padding: "1px 6px", fontSize: 11, color: "#fff", whiteSpace: "nowrap" as const },
  tag: {
    display: "inline-block",
    borderRadius: 4,
    padding: "0 5px",
    fontSize: 11,
    marginRight: 4,
    background: "var(--dsh-color-hover-bg, #f3f4f6)",
  },
  panelTitle: { fontSize: 14, fontWeight: 700, margin: "18px 0 6px" },
  groupLabel: { fontSize: 12.5, fontWeight: 600, color: "var(--dsh-color-muted, #4b5563)", margin: "8px 0 4px" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: "var(--dsh-color-muted, #4b5563)" },
  empty: { color: "var(--dsh-color-muted, #9ca3af)", fontSize: 12.5, padding: "14px 4px" },
  error: { color: "#dc2626", fontSize: 12.5, marginBottom: 10 },
  subPanel: {
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    borderRadius: 12,
    padding: "10px 12px",
    marginBottom: 10,
    background: "var(--dsh-color-surface, #fff)",
    boxShadow: "0 1px 2px rgba(15,23,42,.03)",
  },
  relRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap" as const,
    padding: "5px 8px",
    borderRadius: 10,
    border: "1px solid var(--dsh-color-border, #f3f4f6)",
    background: "var(--dsh-color-hover-bg, #f8fafc)",
  },
  nodePill: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    borderRadius: 8,
    padding: "2px 9px",
    fontSize: 12,
    fontWeight: 600,
    background: "rgba(99,102,241,.12)",
    color: "#4338ca",
  },
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Memories per page in the memory table (workspace pager stays separate). */
const MEM_PAGE_SIZE = 10;

/** 0.123 -> "12.3%"; null -> "–"（无样本）。 */
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${(n * 100).toFixed(1)}%`);

type MemRow = { kind: "head"; ws: string; count: number } | { kind: "row"; m: MemoryRecord };

function daysLeft(ts: number | null): string {
  if (ts === null || ts === void 0) return "∞";
  const days = Math.ceil((ts - Date.now()) / 86400000);
  return days > 0 ? `${days}d` : "expired";
}

function StatCard({ num, label }: { num: string; label: string }) {
  return (
    <div style={s.card}>
      <div style={s.cardNum}>{num}</div>
      <div style={s.cardLabel}>{label}</div>
    </div>
  );
}

function taskGaps(t: TaskRecord): string[] {
  const gaps: string[] = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}

/** Group workspace-tagged rows (memories/tasks/links), most rows first. */
function groupByWorkspace<T extends { workspace: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const m of items) {
    const list = groups.get(m.workspace) ?? [];
    list.push(m);
    groups.set(m.workspace, list);
  }
  return [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

export function EngramSection({ api, t }: EngramSectionFace) {
  const [overview, setOverview] = useState<EngramOverview | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [nodes, setNodes] = useState<EntityRecord[]>([]);
  const [usageStats, setUsageStats] = useState<EngramStats | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<string>("active");
  const [q, setQ] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [memPage, setMemPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"mem" | "esr" | "graph" | "preview" | "telemetry">("mem");
  const [gcDryRun, setGcDryRun] = useState(true);
  const [gcReport, setGcReport] = useState<GcReport | null>(null);
  const [gcRunning, setGcRunning] = useState(false);
  // ESR GUI 新建 / 关闭表单
  const [newTaskWs, setNewTaskWs] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskBusy, setNewTaskBusy] = useState(false);
  const [closeFor, setCloseFor] = useState<string | null>(null);
  const [closeArtifact, setCloseArtifact] = useState("");
  const [closeEval, setCloseEval] = useState("");
  const [closeRefs, setCloseRefs] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ov = await api.overview();
      setOverview(ov);
      // workspace === "" → 全部工作区：stat 卡显示全局总数，表格按工作区分组
      // 完整展示所有记忆（默认视图）；选中某个工作区时各卡片与表格跟随该工作区。
      const wsList = workspace ? [workspace] : Object.keys(ov.workspaces);
      const [mem, taskGroups, linkGroups, nodeGroups, st] = await Promise.all([
        api.memories({
          workspace: workspace || undefined,
          q: q || undefined,
          kind: kind || undefined,
          status: status === "all" ? undefined : status,
        }),
        Promise.all(wsList.map((w) => api.tasks(w, true))),
        Promise.all(wsList.map((w) => api.links(w))),
        Promise.all(wsList.map((w) => api.nodes(w))),
        api.stats(workspace || undefined),
      ]);
      setMemories(mem.items);
      setTasks(taskGroups.flatMap((x) => x.items));
      setLinks(linkGroups.flatMap((x) => x.items));
      setNodes(nodeGroups.flatMap((x) => x.items));
      setUsageStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, workspace, q, kind, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workspaces = useMemo(() => (overview ? Object.keys(overview.workspaces) : []), [overview]);
  const kindsPresent = useMemo(() => (overview ? Object.keys(overview.kinds) : []), [overview]);
  /** 注入预览默认挑「内容最多」的工作区——否则默认会落到 Object.keys 第一个（可能是空区），
   * 导致 [ENGRAM] 块空白误导为「没有记忆」。显式选中工作区时跟随用户选择。 */
  const previewDefault = useMemo(() => {
    if (workspace !== "") return workspace;
    if (!overview) return "";
    let best = "";
    let bestN = -1;
    for (const ws of Object.keys(overview.workspaces)) {
      const c = overview.workspaces[ws] ?? {};
      const n = (c.memories ?? 0) + (c.tasks ?? 0) + (c.links ?? 0) + (c.nodes ?? 0);
      if (n > bestN) {
        bestN = n;
        best = ws;
      }
    }
    return best;
  }, [workspace, overview]);

  // Resolve node/task ids to display names for graph-style relation rows.
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.name);
    for (const t of tasks) map.set(t.id, t.name);
    return (id: string) => map.get(id) ?? id;
  }, [nodes, tasks]);

  // 新建任务的默认工作区：未选具体工作区且未手动选过时，取第一个。
  useEffect(() => {
    if (!newTaskWs && workspaces.length > 0 && !workspace) setNewTaskWs(workspaces[0]);
  }, [newTaskWs, workspaces, workspace]);
  const cfg: EngramConfig | null = overview?.config ?? null;

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Inline full-text toggle for a memory row. */
  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runGc = async () => {
    setGcRunning(true);
    setError(null);
    try {
      const { report } = await api.gc(workspace || undefined, gcDryRun);
      setGcReport(report);
      if (!gcDryRun) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGcRunning(false);
    }
  };

  /** Page through workspaces one at a time (prev/next pager, 按工作区分页). */
  const goWorkspace = (dir: 1 | -1) => {
    if (!overview || workspace === "") return;
    const list = Object.keys(overview.workspaces);
    if (list.length === 0) return;
    const idx = list.indexOf(workspace);
    const next = list[(idx + dir + list.length) % list.length];
    setWorkspace(next);
  };

  /** Table rows: grouped by workspace in the 全部工作区 view, flat otherwise. */
  const groupedRows: Array<[string, MemoryRecord[]]> =
    workspace === "" ? groupByWorkspace(memories) : [[workspace, memories]];
  const taskGroups: Array<[string, TaskRecord[]]> = workspace === "" ? groupByWorkspace(tasks) : [[workspace, tasks]];
  const linkGroups: Array<[string, LinkRecord[]]> = workspace === "" ? groupByWorkspace(links) : [[workspace, links]];
  const nodeGroups: Array<[string, EntityRecord[]]> = workspace === "" ? groupByWorkspace(nodes) : [[workspace, nodes]];

  /** Flatten grouped memories into paged table rows (workspace header + rows). */
  const flatRows: MemRow[] = [];
  for (const [ws, items] of groupedRows) {
    if (workspace === "") flatRows.push({ kind: "head", ws, count: items.length });
    for (const m of items) flatRows.push({ kind: "row", m });
  }
  const memPageCount = Math.max(1, Math.ceil(flatRows.length / MEM_PAGE_SIZE));
  const memPageSafe = Math.min(memPage, memPageCount - 1);
  const memPageRows = flatRows.slice(memPageSafe * MEM_PAGE_SIZE, (memPageSafe + 1) * MEM_PAGE_SIZE);

  // 记忆分页：筛选条件变化回到第 1 页；数据变化后越界则收拢到最后一页。
  useEffect(() => {
    setMemPage(0);
  }, [workspace, status, kind, q]);
  useEffect(() => {
    if (memPage >= memPageCount) setMemPage(Math.max(0, memPageCount - 1));
  }, [memPage, memPageCount]);

  /** GUI 新建任务（POST /api/dsh-engram/tasks），默认落到当前选中的工作区。 */
  const createNewTask = async () => {
    const ws = newTaskWs || workspace || workspaces[0] || "";
    if (!ws || newTaskName.trim() === "") return;
    setNewTaskBusy(true);
    setError(null);
    try {
      await api.createTask(ws, newTaskName.trim(), newTaskDesc);
      setNewTaskName("");
      setNewTaskDesc("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNewTaskBusy(false);
    }
  };

  /** GUI 关闭任务：填 artifact/evaluation/memory_refs 后交给宿主证据门。 */
  const submitClose = async (task: TaskRecord) => {
    setCloseBusy(true);
    setError(null);
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const out = await api.closeTask(task.workspace, task.id, {
        artifact: closeArtifact,
        evaluation: closeEval,
        memoryRefs: refs,
      });
      if (out.state === "active") {
        setError(`证据仍有缺口：${(out.gaps ?? []).join(", ")}${out.artifactReason ? `（${out.artifactReason}）` : ""} — 任务保持 ACTIVE，补齐后再提交`);
      }
      setCloseFor(null);
      setCloseArtifact("");
      setCloseEval("");
      setCloseRefs("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloseBusy(false);
    }
  };

  const openMemory = (id: string) => {
    const m = memories.find((mem) => mem.id === id);
    if (m) {
      setDetail({ kind: "memory", memory: m });
      setDetailNotice(null);
    } else {
      setDetailNotice(`记忆 ${id} 不在当前加载列表 — 切换到「记忆」页加载后可用`);
    }
  };
  const openTask = (id: string) => {
    setDetail({ kind: "task", id });
    setDetailNotice(null);
  };
  const openNode = (id: string) => {
    setDetail({ kind: "node", id });
    setDetailNotice(null);
  };

  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  const gc = overview?.gc ?? null;
  const wsCounts = workspace && overview ? overview.workspaces[workspace] ?? null : null;
  const { vars } = useEngramTheme();

  return (
    <div style={{ ...s.root, ...vars }}>
      <h1 style={s.h1}>Engram 记忆</h1>
      <p style={s.sub}>
        跨会话记忆 · 零 LLM 自动捕获 · 符号索引渐进披露 — 数据源 ~/.dsh/storages/dsh_engram.json
      </p>

      {error && <div style={s.error}>{t("error")}: {error}</div>}

      <div style={s.tabBar}>
        <button style={view === "mem" ? s.tabActive : s.tab} onClick={() => setView("mem")}>记忆</button>
        <button style={view === "esr" ? s.tabActive : s.tab} onClick={() => setView("esr")}>ESR（任务 · 节点 · 关系）</button>
        <button style={view === "graph" ? s.tabActive : s.tab} onClick={() => setView("graph")}>关系图谱</button>
        <button style={view === "preview" ? s.tabActive : s.tab} onClick={() => setView("preview")}>注入预览</button>
        <button style={view === "telemetry" ? s.tabActive : s.tab} onClick={() => setView("telemetry")}>遥测</button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>

      {view === "mem" && (
        <>
      {overview && (() => {
        // Per-workspace cards so the numbers always match the table below;
        // global totals when no workspace is picked.
        const memNum = wsCounts ? wsCounts.memories : overview.totals.memories;
        const taskNum = wsCounts ? wsCounts.tasks : overview.totals.tasks;
        const linkNum = wsCounts ? wsCounts.links : overview.totals.links;
        return (
        <div style={s.stats}>
          <StatCard num={String(memNum)} label={wsCounts ? "记忆 (active)" : "记忆 (active, 全局)"} />
          <StatCard num={String(taskNum)} label={wsCounts ? "任务 (active)" : "任务 (active, 全局)"} />
          <StatCard num={String(linkNum)} label={wsCounts ? "关系" : "关系 (全局)"} />
          <StatCard num={String(wsCounts ? (wsCounts.nodes ?? 0) : (overview.totals.nodes ?? 0))} label={wsCounts ? "节点" : "节点 (全局)"} />
          <StatCard num={String(workspaces.length)} label="工作区" />
          <StatCard num={String(overview.captures.total)} label="自动捕获" />
          <StatCard
            num={indexCost ? `~${indexCost.tokens}` : "–"}
            label="[ENGRAM] 索引 token / 工作区"
          />
          {gc && (
            <StatCard
              num={String(gc.archivedMemories + gc.archivedTasks)}
              label={`GC 已归档 · 链接-${gc.removedLinks}`}
            />
          )}
        </div>
        );
      })()}

      <div style={s.subPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>记忆 GC（pi-esr 约束）</span>
          <label style={{ fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={gcDryRun} onChange={(e) => setGcDryRun(e.target.checked)} />
            仅预览（dry run）
          </label>
          <button style={s.btnPrimary} onClick={() => void runGc()} disabled={gcRunning || !workspace}>
            {gcRunning ? "…" : "运行 GC"}
          </button>
          {gc && gc.lastRun > 0 && (
            <span style={s.mono}>上次 {fmtDate(gc.lastRun)}</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
          工作集（active 任务引用 / 任务记忆 / 已入索引命中）永不驱逐；TTL 过期归档、超容量淘汰、stable 任务超窗归档、悬空链接清理。只归档不硬删——条目 id 保持可重取。
        </div>
        {gcReport && (
          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            <div>
              {gcReport.dryRun ? "dry-run 预览：" : "已执行："}
              {" "}归档记忆 <b>{gcReport.archivedMemories.length}</b> · 归档任务 <b>{gcReport.archivedTasks.length}</b> · 清理链接 <b>{gcReport.removedLinks.length}</b> · 保护 <b>{gcReport.protectedMemories}</b>
            </div>
            {gcReport.archivedMemories.slice(0, 5).map((e) => (
              <div key={e.id} style={s.mono}>- {e.id.slice(0, 8)} {e.reason}: {e.text}</div>
            ))}
            {gcReport.archivedTasks.slice(0, 3).map((t) => (
              <div key={t.id} style={s.mono}>- {t.id.slice(0, 6)} {t.reason}: {t.name}</div>
            ))}
            {gcReport.removedLinks.slice(0, 3).map((l) => (
              <div key={l.id} style={s.mono}>- link {l.source.slice(0, 8)} --{l.relation}--&gt; {l.target.slice(0, 8)}</div>
            ))}
          </div>
        )}
      </div>

      <div style={s.row}>
        <select style={s.input} value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
          <option value="">全部工作区</option>
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>{ws}（{overview?.workspaces[ws]?.memories ?? 0} 条）</option>
          ))}
        </select>
        <button style={s.btn} disabled={workspace === "" || workspaces.length === 0} onClick={() => goWorkspace(-1)}>‹ 上一工作区</button>
        <button style={s.btn} disabled={workspace === "" || workspaces.length === 0} onClick={() => goWorkspace(1)}>下一工作区 ›</button>
        <select style={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">全部类型</option>
          {kindsPresent.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
          ))}
        </select>
        <select style={s.input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">仅活动</option>
          <option value="all">全部状态</option>
          <option value="archived">已归档</option>
        </select>
        <input
          style={{ ...s.input, width: 180 }}
          placeholder="搜索记忆…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void refresh(); }}
        />
        <button style={s.btnPrimary} onClick={() => void refresh()} disabled={busy}>
          {busy ? "…" : t("refresh")}
        </button>
      </div>

      {cfg && (
        <div style={s.row}>
          <span style={s.tag}>autoCapture {cfg.autoCapture ? "on" : "off"}</span>
          <span style={s.tag}>sessionSearch {cfg.sessionSearch ? "on" : "off"}</span>
          <span style={s.tag}>TTL {cfg.expireDays}d</span>
          <span style={s.tag}>index {cfg.indexMaxLines} 行 / {cfg.indexMaxChars} 字符</span>
          <span style={s.tag}>promote ≥{cfg.promoteHits} hits</span>
        </div>
      )}

      <table style={s.table}>
        <colgroup>
          <col style={{ width: 58 }} />
          <col />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={s.th}>类型</th>
            <th style={s.th}>内容</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {flatRows.length === 0 && (
            <tr><td colSpan={3} style={s.empty}>暂无记忆 — 使用 engram_store 显式记录，或让自动捕获工作（git 提交 / 关键文件编辑 / 工具错误）</td></tr>
          )}
          {memPageRows.map((r) =>
            r.kind === "head" ? (
              <tr key={`h-${r.ws}`}><td colSpan={3} style={s.wsHead}>{r.ws} · {r.count} 条</td></tr>
            ) : (
              <tr key={r.m.id}>
                <td style={{ ...s.td, whiteSpace: "nowrap" }}>
                  <span style={{ ...s.badge, background: KIND_COLORS[r.m.kind] ?? "#6b7280" }}>{KIND_LABEL[r.m.kind] ?? r.m.kind}</span>
                  {r.m.status === "archived" && <span style={{ ...s.tag, color: "#b45309", background: "#fef3c7" }}>archived</span>}
                </td>
                <td style={{ ...s.td, minWidth: 0 }}>
                  <div title={r.m.text} style={expandedRows.has(r.m.id) ? s.expanded : s.clamp3}>{r.m.text}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
                    <div style={{ ...s.mono, ...s.ellipsis, flex: "1 1 160px" }} title={`${fmtDate(r.m.createdAt)} · ${r.m.id} · ${r.m.entity ?? ""} · signal ${r.m.signal.toFixed(2)} · hits ${r.m.hits} · TTL ${daysLeft(r.m.expiresAt)}`}>
                      {fmtDate(r.m.createdAt)} · {r.m.id.slice(0, 8)}{r.m.entity ? ` · ${r.m.entity}` : ""} · {r.m.signal.toFixed(2)} · hits {r.m.hits} · {daysLeft(r.m.expiresAt)}
                    </div>
                    <button style={s.linkBtn} onClick={() => toggleExpand(r.m.id)}>{expandedRows.has(r.m.id) ? "收起" : "展开全文"}</button>
                  </div>
                  {r.m.tags.length > 0 && (
                    <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }}>{r.m.tags.map((tag) => <span key={tag} style={s.tag}>{tag}</span>)}</div>
                  )}
                </td>
                <td style={s.td}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <button style={s.linkBtn} title="在侧栏打开详情" onClick={() => { setDetail({ kind: "memory", memory: r.m }); setDetailNotice(null); }}>详情</button>
                    <button style={s.btn} title="归档（TTL/软删，可恢复不载入索引）" onClick={() => void act(() => api.archive(r.m.id, r.m.workspace))}>归档</button>
                    <button style={s.btn} title="永久删除" onClick={() => { if (window.confirm(`删除这条记忆?\n${r.m.text.slice(0, 60)}`)) void act(() => api.remove(r.m.id, r.m.workspace)); }}>删除</button>
                  </div>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {flatRows.length > 0 && (
        <div style={s.pageBar}>
          <button style={s.btn} disabled={memPageSafe === 0} onClick={() => setMemPage(memPageSafe - 1)}>‹ 上一页</button>
          <span>第 {memPageSafe + 1} / {memPageCount} 页 · 共 {flatRows.length} 条</span>
          <button style={s.btn} disabled={memPageSafe >= memPageCount - 1} onClick={() => setMemPage(memPageSafe + 1)}>下一页 ›</button>
          <select style={s.input} value={memPageSafe} onChange={(e) => setMemPage(Number(e.target.value))} title="跳页">
            {Array.from({ length: memPageCount }, (_, i) => <option key={i} value={i}>第 {i + 1} 页</option>)}
          </select>
        </div>
      )}
        </>
      )}

      {view === "esr" && (
        <>
      <div style={s.stats}>
        <StatCard num={String(wsCounts ? wsCounts.tasks : (overview?.totals.tasks ?? 0))} label={wsCounts ? "任务 (active)" : "任务 (active, 全局)"} />
        <StatCard num={String(wsCounts ? wsCounts.links : (overview?.totals.links ?? 0))} label={wsCounts ? "关系" : "关系 (全局)"} />
        <StatCard num={String(wsCounts ? (wsCounts.nodes ?? 0) : (overview?.totals.nodes ?? 0))} label={wsCounts ? "节点" : "节点 (全局)"} />
      </div>

      <div style={s.subPanel}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          agent 行为观测
          <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }}> · 每次 engram_*/esr_* 工具调用实时累计（真实数据，按工作区/天滚动）</span>
        </div>
        {!usageStats ? (
          <div style={s.mono}>…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={s.tag}>ESR 主动性 {pct(usageStats.ratios.esrRatio)}（{usageStats.ratios.esrCalls}/{usageStats.ratios.calls} 次）</span>
              <span style={s.tag}>召回命中率 {pct(usageStats.ratios.recallHitRate)}</span>
              <span style={s.tag}>平均命中 {usageStats.ratios.recallHitsPerQuery ?? "–"}/查询</span>
              <span style={s.tag}>detail 转化 {pct(usageStats.ratios.detailFollowRate)}</span>
              <span style={s.tag}>失败 {usageStats.totals.failures}</span>
              {usageStats.ratios.calls < 10 && <span style={s.tag}>样本不足（{usageStats.ratios.calls} 次），比例仅供参考</span>}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
              ESR 主动性过低时，下一个会话的 [ESR] 注入块会附加一行基于真实数据的 escalate 提醒，引导模型当场补建任务/节点/关系——比例回升后提醒自动消失。
            </div>
            <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              工具调用：
              {Object.entries(usageStats.totals.counts).map(([k, v]) => (
                <span key={k} style={s.tag}>{k} ×{v}</span>
              ))}
            </div>
            {usageStats.byDay.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {usageStats.byDay.map((d) => (
                  <span key={d.day}>{d.day} · 调用 {Object.values(d.counts).reduce((a, b) => a + b, 0)} · 失败 {d.failures}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={s.panelTitle}>ESR 任务（证据闭环）{workspace === "" && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }}>· 全部工作区</span>}</div>

      {/* GUI 新建任务：把 esr_task 触发器直接放到面板里 */}
      <div style={s.subPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select style={s.input} value={newTaskWs} onChange={(e) => setNewTaskWs(e.target.value)}>
            {workspaces.length === 0 && <option value="">(no workspaces)</option>}
            {workspaces.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
          </select>
          <input style={{ ...s.input, width: 170 }} placeholder="任务名…" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createNewTask(); }} />
          <input style={{ ...s.input, width: 240 }} placeholder="要产出 / 满足什么（可选）" value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} />
          <button style={s.btnPrimary} disabled={newTaskBusy || newTaskName.trim() === ""} onClick={() => void createNewTask()}>
            {newTaskBusy ? "…" : "新建任务"}
          </button>
        </div>
      </div>

      {tasks.length === 0 && <div style={s.empty}>暂无任务 — 用上方「新建任务」或 esr_task 工具创建</div>}
      {taskGroups.map(([ws, items]) => (
        <Fragment key={ws}>
          {workspace === "" && <div style={s.groupLabel}>{ws} · {items.length} 个任务</div>}
          {items.map((task) => {
            const gaps = taskGaps(task);
            const isStable = task.state === "stable";
            return (
              <div key={task.id} style={s.subPanel}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  <span style={s.mono}>{task.id.slice(0, 6)}</span>{" "}
                  <EvidenceRing
                    artifact={Boolean(task.artifact)}
                    evaluation={Boolean(task.evaluation)}
                    refs={(task.memoryRefs?.length ?? 0) > 0}
                    size={22}
                  />
                  {" "}
                  {task.name}{" "}
                  <span style={{ ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }}>
                    {isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE"}
                  </span>
                  {!isStable && (
                    <button style={s.btn} onClick={() => setCloseFor(closeFor === task.id ? null : task.id)}>
                      {closeFor === task.id ? "收起" : "填写证据关闭…"}
                    </button>
                  )}
                  <button style={s.linkBtn} title="在侧栏打开详情" onClick={() => openTask(task.id)}>详情</button>
                </div>
                {!isStable && gaps.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
                    缺口：{gaps.join(", ")} — 提供 artifact / evaluation / memory_ref 后转为 STABLE
                  </div>
                )}
                {task.description && <div style={{ fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }}>{task.description}</div>}
                {task.memoryRefs.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>记忆引用：{task.memoryRefs.map((r) => <span key={r} style={s.tag}>{r.slice(0, 8)}</span>)}</div>
                )}
                {closeFor === task.id && (
                  <div style={{ marginTop: 8, padding: 8, border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }}>提供证据后关闭（三项全齐才转 STABLE）</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input style={{ ...s.input, width: 150 }} placeholder="artifact 路径/URL" value={closeArtifact} onChange={(e) => setCloseArtifact(e.target.value)} />
                      <input style={{ ...s.input, width: 150 }} placeholder="evaluation 验证证据" value={closeEval} onChange={(e) => setCloseEval(e.target.value)} />
                      <input style={{ ...s.input, width: 150 }} placeholder="memory_refs 逗号分隔" value={closeRefs} onChange={(e) => setCloseRefs(e.target.value)} />
                      <button style={s.btnPrimary} disabled={closeBusy} onClick={() => void submitClose(task)}>{closeBusy ? "…" : "提交关闭"}</button>
                      <button style={s.btn} onClick={() => setCloseFor(null)}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}

      <div style={s.panelTitle}>节点与关系（esr_node / esr_link）{workspace === "" && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }}>· 全部工作区</span>}</div>
      {nodes.length === 0 && <div style={s.empty}>暂无节点 — 模型会为反复出现的领域对象主动登记（esr_node），此处也可查看关系</div>}
      {nodeGroups.map(([ws, items]) => (
        <Fragment key={ws}>
          {workspace === "" && <div style={s.groupLabel}>{ws} · {items.length} 个节点</div>}
          {items.map((n: EntityRecord) => (
            <div key={n.id} style={{ fontSize: 12.5, padding: "2px 0", cursor: "pointer", borderRadius: 6 }} title="在侧栏打开节点详情" onClick={() => openNode(n.id)}>
              <span className="mono" style={{ ...s.mono, color: "#4338ca" }}>{n.id.slice(0, 24)}</span>{" "}
              <span style={{ fontWeight: 600 }}>{n.name}</span>
              {n.kind && <span style={{ ...s.tag, color: "#4338ca", background: "#eef2ff" }}>{n.kind}</span>}
              {n.description && <span style={{ color: "var(--dsh-color-muted, #6b7280)" }}> — {n.description.slice(0, 48)}</span>}
            </div>
          ))}
        </Fragment>
      ))}
      <div style={{ fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 6 }}>关系：</div>
      {links.length === 0 && <div style={s.empty}>暂无关系 — esr_link 创建</div>}
      {linkGroups.map(([ws, items]) => (
        <Fragment key={ws}>
          {workspace === "" && <div style={s.groupLabel}>{ws} · {items.length} 条关系</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {items.map((l: LinkRecord) => (
              <div key={l.id} style={{ ...s.relRow, cursor: "pointer" }} title="在侧栏打开关系详情" onClick={() => { setDetail({ kind: "link", link: l }); setDetailNotice(null); }}>
                <span className="mono" style={s.nodePill} title={l.source}>{nameOf(l.source)}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--dsh-color-muted, #6b7280)" }}>
                  <span style={{ border: "1px dashed var(--dsh-color-border, #cbd5e1)", borderRadius: 999, padding: "1px 7px" }}>{l.relation}</span>
                  <span aria-hidden>→</span>
                </span>
                <span className="mono" style={s.nodePill} title={l.target}>{nameOf(l.target)}</span>
                <span style={{ fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>· {fmtDate(l.createdAt)}</span>
              </div>
            ))}
          </div>
        </Fragment>
      ))}
        </>
      )}

      {view === "graph" && (
        <div style={s.subPanel}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>关系图谱（esr_link 力导向图）</span>
            <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }}>
              {workspace === "" ? "全部工作区" : `工作区：${workspace}`} · 实体为圆形节点，任务为勾选徽标；点选节点查看关系明细
            </span>
          </div>
          <EngramGraph
            workspace={workspace}
            entities={nodes}
            tasks={tasks}
            links={links}
            nameOf={nameOf}
          />
        </div>
      )}

      {view === "preview" && (
        <div style={s.subPanel}>
          <EngramPreview
            api={api}
            workspace={workspace}
            defaultWorkspace={previewDefault}
            workspaces={workspaces}
          />
        </div>
      )}

      {view === "telemetry" && (
        <div style={s.subPanel}>
          <EngramTelemetry api={api} workspace={workspace} />
        </div>
      )}

        </div>
        {detail && (
          <div style={{ flex: "0 0 320px", maxWidth: "38%", position: "sticky", top: 8 }}>
            {detailNotice && (
              <div style={{ fontSize: 11.5, padding: "6px 10px", marginBottom: 6, borderRadius: 8, background: "rgba(245,158,11,.14)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)" }}>
                {detailNotice}
              </div>
            )}
            <EngramDetail
              target={detail}
              api={api}
              memories={memories}
              tasks={tasks}
              nodes={nodes}
              links={links}
              onClose={() => setDetail(null)}
              onNavigateMemory={openMemory}
              onChanged={() => void refresh()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
