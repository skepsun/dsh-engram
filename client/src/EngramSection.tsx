/**
 * dsh-engram client: the Settings → "Engram Memory" page (settings.section).
 *
 * Reads the real store through the /api/dsh-engram route family and renders:
 *   - overview stat cards (counts, capture totals, per-workspace index cost)
 *   - memory search/filter table with archive/delete actions
 *   - the ESR task board (state + evidence gaps) and the relation list
 *
 * Plain React + inline styles — no UI-primitives import (bundle-purity gate).
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  decision: "Decision",
  error: "Error",
  procedure: "Procedure",
  fact: "Fact",
  insight: "Insight",
  handoff: "Handoff",
  task: "Task",
};

const s = {
  root: { padding: "2px 4px 40px" },
  h1: { fontSize: 20, fontWeight: 700, margin: "0 0 4px" },
  sub: { color: "var(--dsh-color-muted, #6b7280)", fontSize: 12, margin: "0 0 16px" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 },
  card: {
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--dsh-color-surface, #ffffff)",
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
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)",
  },
  btnPrimary: {
    border: "1px solid var(--dsh-color-primary, #2563eb)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "#fff",
    background: "var(--dsh-color-primary, #2563eb)",
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12.5, tableLayout: "fixed" as const },
  clamp3: { display: "-webkit-box" as const, WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden", maxHeight: 60, minHeight: 18, lineHeight: 1.5, wordBreak: "break-word" as const, whiteSpace: "normal" as const },
  expanded: { whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, lineHeight: 1.5 },
  linkBtn: { border: "none", background: "none", padding: 0, fontSize: 11.5, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", textDecoration: "underline" as const },
  pageBar: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", flexWrap: "wrap" as const },
  tabBar: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)", marginBottom: 12 },
  tab: { border: "none", background: "none", padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "var(--dsh-color-muted, #6b7280)", borderBottom: "2px solid transparent", fontWeight: 600, margin: 0 },
  tabActive: { border: "none", background: "none", padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", borderBottom: "2px solid var(--dsh-color-primary, #2563eb)", fontWeight: 700, margin: 0 },
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
  subPanel: { border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 },
};

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Memories per page in the memory table (workspace pager stays separate). */
const MEM_PAGE_SIZE = 10;

/** 0.123 -> "12.3%"; null -> "–" (no sample). */
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
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<string>("active");
  const [q, setQ] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [memPage, setMemPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"mem" | "esr">("mem");
  const [gcDryRun, setGcDryRun] = useState(true);
  const [gcReport, setGcReport] = useState<GcReport | null>(null);
  const [gcRunning, setGcRunning] = useState(false);
  // ESR gui: new-task / close-task forms
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
      // workspace === "" → all workspaces: stat cards show global totals, table groups by workspace
      // Full display of all memories (default view); selecting a workspace makes every card and
      // table follow that workspace.
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

  // Default workspace for a new task: take the first when none specific is selected and no manual pick.
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

  /** Page through workspaces one at a time (prev/next pager, paged per workspace) */
  const goWorkspace = (dir: 1 | -1) => {
    if (!overview || workspace === "") return;
    const list = Object.keys(overview.workspaces);
    if (list.length === 0) return;
    const idx = list.indexOf(workspace);
    const next = list[(idx + dir + list.length) % list.length];
    setWorkspace(next);
  };

  /** Table rows: grouped by workspace in the all-workspaces view, flat otherwise. */
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

  // Memory paging: back to page 1 when filters change; clamp to the last page once data breaks the bounds.
  useEffect(() => {
    setMemPage(0);
  }, [workspace, status, kind, q]);
  useEffect(() => {
    if (memPage >= memPageCount) setMemPage(Math.max(0, memPageCount - 1));
  }, [memPage, memPageCount]);

  /** GUI new task (POST /api/dsh-engram/tasks), defaults to the currently-selected workspace. */
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

  /** GUI close task: fill artifact/evaluation/memory_refs, then hand off to the host evidence gate. */
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
        setError(`Evidence gaps remain: ${(out.gaps ?? []).join(", ")} — the task stays ACTIVE, submit again once filled`);
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

  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  const gc = overview?.gc ?? null;
  const wsCounts = workspace && overview ? overview.workspaces[workspace] ?? null : null;
  const { vars } = useEngramTheme();

  return (
    <div style={{ ...s.root, ...vars }}>
      <h1 style={s.h1}>Engram Memory</h1>
      <p style={s.sub}>
        Cross-session memory · zero-LLM auto capture · symbolic-index progressive disclosure — data source ~/.dsh/storages/dsh_engram.json
      </p>

      {error && <div style={s.error}>{t("error")}: {error}</div>}

      <div style={s.tabBar}>
        <button style={view === "mem" ? s.tabActive : s.tab} onClick={() => setView("mem")}>Memory</button>
        <button style={view === "esr" ? s.tabActive : s.tab} onClick={() => setView("esr")}>ESR (tasks · nodes · relations)</button>
      </div>

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
          <StatCard num={String(memNum)} label={wsCounts ? "Memories (active)" : "Memories (active, global)"} />
          <StatCard num={String(taskNum)} label={wsCounts ? "Tasks (active)" : "Tasks (active, global)"} />
          <StatCard num={String(linkNum)} label={wsCounts ? "Relations" : "Relations (global)"} />
          <StatCard num={String(wsCounts ? (wsCounts.nodes ?? 0) : (overview.totals.nodes ?? 0))} label={wsCounts ? "Nodes" : "Nodes (global)"} />
          <StatCard num={String(workspaces.length)} label="Workspaces" />
          <StatCard num={String(overview.captures.total)} label="Auto captures" />
          <StatCard
            num={indexCost ? `~${indexCost.tokens}` : "–"}
            label="[ENGRAM] index tokens / workspace"
          />
          {gc && (
            <StatCard
              num={String(gc.archivedMemories + gc.archivedTasks)}
              label={`GC archived · links-${gc.removedLinks}`}
            />
          )}
        </div>
        );
      })()}

      <div style={s.subPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Memory GC (pi-esr constraints)</span>
          <label style={{ fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={gcDryRun} onChange={(e) => setGcDryRun(e.target.checked)} />
            Preview only (dry run)
          </label>
          <button style={s.btnPrimary} onClick={() => void runGc()} disabled={gcRunning || !workspace}>
            {gcRunning ? "…" : "Run GC"}
          </button>
          {gc && gc.lastRun > 0 && (
            <span style={s.mono}>Last run: {fmtDate(gc.lastRun)}</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
          The working set (active task refs / task memories / already-indexed hits) is never evicted; TTL-expired entries are archived, over-cap entries pruned, stable tasks past-window archived, dangling links dropped. Archive-only, never hard-delete — entry ids stay re-fetchable.
        </div>
        {gcReport && (
          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            <div>
              {gcReport.dryRun ? "Dry-run preview:" : "Executed:"}
              {" "}archived memories <b>{gcReport.archivedMemories.length}</b> · archived tasks <b>{gcReport.archivedTasks.length}</b> · cleaned links <b>{gcReport.removedLinks.length}</b> · protected <b>{gcReport.protectedMemories}</b>
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
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>{ws} ({overview?.workspaces[ws]?.memories ?? 0} memories)</option>
          ))}
        </select>
        <button style={s.btn} disabled={workspace === "" || workspaces.length === 0} onClick={() => goWorkspace(-1)}>‹ Previous workspace</button>
        <button style={s.btn} disabled={workspace === "" || workspaces.length === 0} onClick={() => goWorkspace(1)}>Next workspace ›</button>
        <select style={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          {kindsPresent.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
          ))}
        </select>
        <select style={s.input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active only</option>
          <option value="all">All states</option>
          <option value="archived">Archived</option>
        </select>
        <input
          style={{ ...s.input, width: 180 }}
          placeholder="Search memories…"
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
          <span style={s.tag}>index {cfg.indexMaxLines} lines / {cfg.indexMaxChars} chars</span>
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
            <th style={s.th}>Type</th>
            <th style={s.th}>Content</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {flatRows.length === 0 && (
            <tr><td colSpan={3} style={s.empty}>No memories yet — record one explicitly with engram_store, or let auto-capture run (git commit / significant file edit / tool error)</td></tr>
          )}
          {memPageRows.map((r) =>
            r.kind === "head" ? (
              <tr key={`h-${r.ws}`}><td colSpan={3} style={s.wsHead}>{r.ws} · {r.count} memories</td></tr>
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
                    <button style={s.linkBtn} onClick={() => toggleExpand(r.m.id)}>{expandedRows.has(r.m.id) ? "Collapse" : "Expand full text"}</button>
                  </div>
                  {r.m.tags.length > 0 && (
                    <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }}>{r.m.tags.map((tag) => <span key={tag} style={s.tag}>{tag}</span>)}</div>
                  )}
                </td>
                <td style={s.td}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <button style={s.btn} title="Archive (soft / TTL, restorable, not indexed)" onClick={() => void act(() => api.archive(r.m.id, r.m.workspace))}>Archive</button>
                    <button style={s.btn} title="Delete permanently" onClick={() => { if (window.confirm(`Delete this memory?\n${r.m.text.slice(0, 60)}`)) void act(() => api.remove(r.m.id, r.m.workspace)); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {flatRows.length > 0 && (
        <div style={s.pageBar}>
          <button style={s.btn} disabled={memPageSafe === 0} onClick={() => setMemPage(memPageSafe - 1)}>‹ Previous page</button>
          <span>Page {memPageSafe + 1} / {memPageCount} · total {flatRows.length}</span>
          <button style={s.btn} disabled={memPageSafe >= memPageCount - 1} onClick={() => setMemPage(memPageSafe + 1)}>Next page ›</button>
          <select style={s.input} value={memPageSafe} onChange={(e) => setMemPage(Number(e.target.value))} title="Go to page">
            {Array.from({ length: memPageCount }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
        </div>
      )}
        </>
      )}

      {view === "esr" && (
        <>
      <div style={s.stats}>
        <StatCard num={String(wsCounts ? wsCounts.tasks : (overview?.totals.tasks ?? 0))} label={wsCounts ? "Tasks (active)" : "Tasks (active, global)"} />
        <StatCard num={String(wsCounts ? wsCounts.links : (overview?.totals.links ?? 0))} label={wsCounts ? "Relations" : "Relations (global)"} />
        <StatCard num={String(wsCounts ? (wsCounts.nodes ?? 0) : (overview?.totals.nodes ?? 0))} label={wsCounts ? "Nodes" : "Nodes (global)"} />
      </div>

      <div style={s.subPanel}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          Agent behaviour observability
          <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }}> · each engram_*/esr_* tool call accumulated live (real data, rolled up per workspace / per day)</span>
        </div>
        {!usageStats ? (
          <div style={s.mono}>…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={s.tag}>ESR proactivity {pct(usageStats.ratios.esrRatio)} ({usageStats.ratios.esrCalls}/{usageStats.ratios.calls} calls)</span>
              <span style={s.tag}>recall hit-rate {pct(usageStats.ratios.recallHitRate)}</span>
              <span style={s.tag}>avg hits {usageStats.ratios.recallHitsPerQuery ?? "–"}/query</span>
              <span style={s.tag}>detail conversion {pct(usageStats.ratios.detailFollowRate)}</span>
              <span style={s.tag}>failures {usageStats.totals.failures}</span>
              {usageStats.ratios.calls < 10 && <span style={s.tag}>thin sample ({usageStats.ratios.calls} calls), ratios are illustrative</span>}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
              When ESR proactivity is too low, the next session's [ESR] injected block appends a one-line data-driven escalate reminder (based on real usage), nudging the model to build tasks/nodes/relations on the spot — the reminder disappears once the ratio recovers.
            </div>
            <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              Tool calls:
              {Object.entries(usageStats.totals.counts).map(([k, v]) => (
                <span key={k} style={s.tag}>{k} ×{v}</span>
              ))}
            </div>
            {usageStats.byDay.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {usageStats.byDay.map((d) => (
                  <span key={d.day}>{d.day} · {Object.values(d.counts).reduce((a, b) => a + b, 0)} calls · failures {d.failures}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={s.panelTitle}>ESR tasks (evidence closure){workspace === "" && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }}> · all workspaces</span>}</div>

      {/* eslint-disable-next-line: place the esr_task trigger directly in the panel */}
      <div style={s.subPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select style={s.input} value={newTaskWs} onChange={(e) => setNewTaskWs(e.target.value)}>
            {workspaces.length === 0 && <option value="">(no workspaces)</option>}
            {workspaces.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
          </select>
          <input style={{ ...s.input, width: 170 }} placeholder="Task name…" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createNewTask(); }} />
          <input style={{ ...s.input, width: 240 }} placeholder="Outcomes / what to satisfy (optional)" value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} />
          <button style={s.btnPrimary} disabled={newTaskBusy || newTaskName.trim() === ""} onClick={() => void createNewTask()}>
            {newTaskBusy ? "…" : "Create task"}
          </button>
        </div>
      </div>

      {tasks.length === 0 && <div style={s.empty}>No tasks yet — create one with the "Create task" button above or the esr_task tool</div>}
      {taskGroups.map(([ws, items]) => (
        <Fragment key={ws}>
          {workspace === "" && <div style={s.groupLabel}>{ws} · {items.length} tasks</div>}
          {items.map((task, i) => {
            const gaps = taskGaps(task);
            const isStable = task.state === "stable";
            return (
              <div key={task.id} style={s.subPanel}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  <span style={s.mono}>{task.id.slice(0, 6)}</span>{" "}
                  {task.name}{" "}
                  <span style={{ ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }}>
                    {isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE"}
                  </span>
                  {!isStable && (
                    <button style={s.btn} onClick={() => setCloseFor(closeFor === task.id ? null : task.id)}>
                      {closeFor === task.id ? "Collapse" : "Fill evidence to close…"}
                    </button>
                  )}
                </div>
                {!isStable && gaps.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>
                    Gaps: {gaps.join(", ")} — provide artifact / evaluation / memory_ref to go STABLE
                  </div>
                )}
                {task.description && <div style={{ fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }}>{task.description}</div>}
                {task.memoryRefs.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>Memory refs: {task.memoryRefs.map((r) => <span key={r} style={s.tag}>{r.slice(0, 8)}</span>)}</div>
                )}
                {closeFor === task.id && (
                  <div style={{ marginTop: 8, padding: 8, border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }}>Close after evidence is provided (all three required to become STABLE)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input style={{ ...s.input, width: 150 }} placeholder="artifact path/URL" value={closeArtifact} onChange={(e) => setCloseArtifact(e.target.value)} />
                      <input style={{ ...s.input, width: 150 }} placeholder="evaluation verification" value={closeEval} onChange={(e) => setCloseEval(e.target.value)} />
                      <input style={{ ...s.input, width: 150 }} placeholder="memory_refs comma-separated" value={closeRefs} onChange={(e) => setCloseRefs(e.target.value)} />
                      <button style={s.btnPrimary} disabled={closeBusy} onClick={() => void submitClose(task)}>{closeBusy ? "…" : "Submit close"}</button>
                      <button style={s.btn} onClick={() => setCloseFor(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}

      <div style={s.panelTitle}>Nodes and relations (esr_node / esr_link){workspace === "" && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }}> · all workspaces</span>}</div>
      {nodes.length === 0 && <div style={s.empty}>No nodes yet — the model proactively registers recurring domain objects (esr_node); relations can be viewed here too</div>}
      {nodeGroups.map(([ws, items]) => (
        <Fragment key={ws}>
          {workspace === "" && <div style={s.groupLabel}>{ws} · {items.length} nodes</div>}
          {items.map((n: EntityRecord) => (
            <div key={n.id} style={{ fontSize: 12.5, padding: "2px 0" }}>
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
          {items.map((l: LinkRecord) => (
            <div key={l.id} style={{ fontSize: 12.5, padding: "2px 0" }}>
              <span className="mono" style={s.mono}>{l.source.slice(0, 10)}</span>
              {" "}--{l.relation}--&gt;{" "}
              <span className="mono" style={s.mono}>{l.target.slice(0, 10)}</span>
              <span style={{ color: "var(--dsh-color-muted-weak, #9ca3af)" }}> · {fmtDate(l.createdAt)}</span>
            </div>
          ))}
        </Fragment>
      ))}
        </>
      )}
    </div>
  );
}
