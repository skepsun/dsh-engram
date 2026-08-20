/**
 * EngramBoard — the full-screen ESR task kanban shown in the center column
 * (mounted by EngramBoardMount into the conversation grid item; visibility is
 * CSS-driven so the conversation underneath stays mounted and stateful).
 *
 * Layout: 草稿 / 进行中(证据缺口) / 就绪(证据齐) / 已闭环 columns, a workspace
 * filter + search, an inline create form, and per-card evidence-closure forms
 * that share the esr_close gates (artifact + evaluation + memory_refs).
 *
 * Plain React + inline styles; the only value imports are react (bundle
 * purity). The scoped --dsh-color-* palette comes from useEngramTheme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngramTheme } from "./theme";
import { EvidenceRing } from "./EvidenceRing";
import type { LinkRecord, TaskRecord } from "./api";

export interface EngramBoardApi {
  overview(): Promise<{ workspaces: Record<string, { memories: number; tasks: number; links: number; nodes?: number }> }>;
  tasks(workspace: string, includeStable?: boolean): Promise<{ items: TaskRecord[] }>;
  links(workspace: string): Promise<{ items: LinkRecord[] }>;
  createTask(workspace: string, name: string, description?: string): Promise<unknown>;
  closeTask(workspace: string, id: string, evidence: { artifact?: string; evaluation?: string; memoryRefs?: string[] }): Promise<{ ok: boolean; state: "active" | "stable"; gaps?: string[]; artifactReason?: string }>;
}

export interface EngramBoardProps {
  api: EngramBoardApi;
  /** Called by the ✕ button; the mount layer hides the board via CSS. */
  onRequestClose: () => void;
}

/** Evidence gaps of an active task (artifact / evaluation / memory_ref). */
function taskGaps(t: TaskRecord): string[] {
  const gaps: string[] = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}

const COLUMNS = [
  { key: "draft", title: "草稿", sub: "未被激活", color: "#94a3b8", match: (t: TaskRecord) => t.state === "draft" },
  { key: "gapped", title: "进行中", sub: "证据有缺口", color: "#f59e0b", match: (t: TaskRecord) => t.state === "active" && taskGaps(t).length > 0 },
  { key: "ready", title: "就绪", sub: "证据齐，可闭环", color: "#10b981", match: (t: TaskRecord) => t.state === "active" && taskGaps(t).length === 0 },
  { key: "stable", title: "已闭环", sub: "凭据齐备", color: "#6366f1", match: (t: TaskRecord) => t.state === "stable" },
] as const;

const fmtDate = (ts: number) => (ts ? new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "–");

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function EngramBoard({ api, onRequestClose }: EngramBoardProps) {
  const { vars } = useEngramTheme();
  const [overview, setOverview] = useState<{ workspaces: Record<string, { memories: number; tasks: number; links: number; nodes?: number }> } | null>(null);
  const [tasksByWs, setTasksByWs] = useState<Record<string, TaskRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ws, setWs] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newWs, setNewWs] = useState("");
  const [busy, setBusy] = useState(false);
  const [closingFor, setClosingFor] = useState<string | null>(null);
  const [closeArtifact, setCloseArtifact] = useState("");
  const [closeEval, setCloseEval] = useState("");
  const [closeRefs, setCloseRefs] = useState("");
  const loadedWs = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const ov = await api.overview();
      setOverview(ov);
      setDenied(false);
      const wsList = Object.keys(ov.workspaces);
      const entries = await Promise.all(
        wsList.map(async (w) => {
          const shouldLoad = !loadedWs.current.has(w);
          if (shouldLoad) loadedWs.current.add(w);
          const res = shouldLoad ? await api.tasks(w, true) : null;
          return [w, res ? res.items : (null as TaskRecord[] | null)] as const;
        }),
      );
      setTasksByWs((prev) => {
        const next: Record<string, TaskRecord[]> = { ...prev };
        for (const [w, items] of entries) if (items !== null) next[w] = items;
        return next;
      });
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/403|loopback/i.test(message)) setDenied(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20000);
    return () => clearInterval(id);
  }, [refresh]);

  // The 20s polling above skips already-loaded workspaces; only re-fetch the
  // current selection's workspace every poll so newly created tasks appear.
  useEffect(() => {
    if (!ws || denied) return;
    const id = setInterval(() => {
      const fetchWs = async () => {
        try {
          const res = await api.tasks(ws, true);
          setTasksByWs((prev) => ({ ...prev, [ws]: res.items }));
        } catch { /* polling errors are surface-level; full refresh handles them */ }
      };
      void fetchWs();
    }, 20000);
    return () => clearInterval(id);
  }, [ws, denied, api]);

  const workspaces = useMemo(
    () => (overview ? Object.entries(overview.workspaces).sort((a, b) => b[1].tasks - a[1].tasks) : []),
    [overview],
  );
  const totalActive = useMemo(
    () => workspaces.reduce((a, [, w]) => a + (w.tasks ?? 0), 0),
    [workspaces],
  );

  const allTasks = useMemo(() => Object.values(tasksByWs).flat(), [tasksByWs]);
  // Evidence gauge across active tasks: fraction of the 3 gates already filled.
  const evidenceGauge = useMemo(() => {
    let active = 0;
    let gateTotal = 0;
    let gateFilled = 0;
    let ready = 0;
    let stable = 0;
    for (const t of allTasks) {
      if (t.state === "stable") { stable += 1; continue; }
      if (t.state === "draft") continue;
      active += 1;
      const gates = taskGaps(t);
      gateTotal += 3;
      gateFilled += 3 - gates.length;
      if (gates.length === 0) ready += 1;
    }
    return { active, gateTotal, gateFilled, ready, stable, frac: gateTotal > 0 ? gateFilled / gateTotal : 0 };
  }, [allTasks]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (ws !== "" && t.workspace !== ws) return false;
      if (needle === "") return true;
      return `${t.name} ${t.description ?? ""} ${t.id}`.toLowerCase().includes(needle);
    });
  }, [allTasks, ws, q]);

  const columnCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const col of COLUMNS) counts[col.key] = filtered.filter(col.match).length;
    counts.all = filtered.length;
    return counts;
  }, [filtered]);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const targetWs = newWs || (workspaces[0] ? workspaces[0][0] : "");
    if (!targetWs) return;
    setBusy(true);
    try {
      await api.createTask(targetWs, name, newDesc);
      loadedWs.current.add(targetWs);
      setNewName("");
      setNewDesc("");
      setCreating(false);
      const res = await api.tasks(targetWs, true);
      setTasksByWs((prev) => ({ ...prev, [targetWs]: res.items }));
      setWs(targetWs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitClose = async (t: TaskRecord) => {
    setBusy(true);
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const res = await api.closeTask(t.workspace, t.id, { artifact: closeArtifact, evaluation: closeEval, memoryRefs: refs });
      if (res.state === "active") {
        setError(`证据仍有缺口：${(res.gaps ?? []).join(", ") || "—"}${res.artifactReason ? `（${res.artifactReason}）` : ""} — 任务保持 ACTIVE`);
        return;
      }
      setClosingFor(null);
      setCloseArtifact("");
      setCloseEval("");
      setCloseRefs("");
      // Refresh this workspace's tasks (moves the card to 已闭环).
      const tasks = await api.tasks(t.workspace, true);
      setTasksByWs((prev) => ({ ...prev, [t.workspace]: tasks.items }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-engram-board="true" style={{ ...vars, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))" }}>
      {/* Header */}
      <div style={hb.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: "var(--dsw-alias-label-primary-bluish, #4338ca)" }}>
            <rect x="2" y="2.5" width="12" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.2 8.1l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={hb.title}>ESR 任务看板</span>
          <span style={hb.sub}>draft → active(证据) → stable · 跨工作区 · 与 esr_task/esr_close 同一证据门</span>
          {loading && <span style={hb.loading}>…</span>}
          <span style={{ flex: "1 1 auto" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={`证据完备度 ${Math.round(evidenceGauge.frac * 100)}% · ${evidenceGauge.ready}/${evidenceGauge.active} 个进行中任务证据齐 · ${evidenceGauge.stable} 已闭环`}>
            <EvidenceRing artifact={false} evaluation={false} refs={false} size={30} showLabel={false} fraction={evidenceGauge.frac} />
            <span style={{ fontSize: 11.5, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted, #6b7280))", fontWeight: 600 }}>
              {evidenceGauge.active === 0 ? "无进行中" : `${evidenceGauge.ready} 就绪 · 完备 ${Math.round(evidenceGauge.frac * 100)}%`}
            </span>
          </span>
          <select style={hb.select} value={ws} onChange={(e) => setWs(e.target.value)} title="工作区筛选">
            <option value="">全部工作区 · {totalActive} 进行中</option>
            {workspaces.map(([w, c]) => (
              <option key={w} value={w}>{w.replace(/^.*[\\/]/, "")} · {c.tasks} 进行中</option>
            ))}
          </select>
          <input
            style={{ ...hb.input, width: 170 }}
            placeholder="搜索任务…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" style={hb.btn} onClick={() => { setCreating((v) => !v); setClosingFor(null); }}>
            ＋ 新建
          </button>
          <button type="button" style={hb.btn} onClick={() => void refresh()} disabled={loading} title="刷新">
            刷新
          </button>
          <button type="button" style={hb.close} onClick={onRequestClose} aria-label="关闭看板">✕</button>
        </div>
      </div>

      <div style={{ padding: "0 14px" }}>
        {denied && (
          <div style={hb.warn}>
            ESR 看板数据不可达（loopback-only 守卫）— 任务/关系将无法加载；请通过本机访问 GUI，或放入受信网络访问。
          </div>
        )}
        {error && <div style={hb.error}>⚠ {error}</div>}

        {creating && (
          <div style={hb.createForm}>
            <select style={hb.select} value={newWs} onChange={(e) => setNewWs(e.target.value)}>
              <option value="">选择工作区…</option>
              {workspaces.map(([w]) => <option key={w} value={w}>{w.replace(/^.*[\\/]/, "")}</option>)}
            </select>
            <input style={{ ...hb.input, flex: "1 1 200px" }} placeholder="任务名…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); }} autoFocus />
            <input style={{ ...hb.input, flex: "1 1 240px" }} placeholder="要产出 / 满足什么（可选）" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <button type="button" style={hb.btnSolid} disabled={busy || !newName.trim() || !(newWs || workspaces.length > 0)} onClick={() => void submitCreate()}>{busy ? "…" : "创建"}</button>
            <button type="button" style={hb.btn} onClick={() => setCreating(false)}>取消</button>
          </div>
        )}
      </div>

      {/* Columns */}
      <div style={hb.columns}>
        {COLUMNS.map((col) => (
          <div key={col.key} data-col={col.key} style={{ ...hb.column, borderTop: `2px solid ${col.color}` }}>
            <div style={hb.colHead}>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{col.title}</span>
              <span style={{ ...hb.count, color: col.color, background: `${col.color}1f` }}>{columnCounts[col.key]}</span>
            </div>
            <div style={hb.colSub}>{col.sub}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6 }}>
              {filtered.filter(col.match).slice(0, 20).map((t) => (
                <div key={t.id} style={hb.card}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ ...hb.state, background: col.color }}>{col.key === "stable" ? "✓" : "●"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, lineHeight: "17px", overflowWrap: "anywhere" }}>{t.name}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3, alignItems: "center" }}>
                        <EvidenceRing
                          artifact={Boolean(t.artifact)}
                          evaluation={Boolean(t.evaluation)}
                          refs={(t.memoryRefs?.length ?? 0) > 0}
                          size={20}
                          showLabel={false}
                        />
                        <span style={hb.meta}>{shortId(t.id)}</span>
                        {ws === "" && <span style={hb.meta}>{t.workspace.replace(/^.*[\\/]/, "")}</span>}
                        {(col.key === "gapped" || col.key === "ready") && taskGaps(t).map((g) => (
                          <span key={g} style={hb.gap}>{g} ✗</span>
                        ))}
                        {col.key === "stable" && (
                          <span style={{ fontSize: 10, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" }}>
                            artifact{t.artifact ? "✓" : "✗"}·eval{t.evaluation ? "✓" : "✗"}·ref{(t.memoryRefs?.length ?? 0) > 0 ? "✓" : "✗"}
                          </span>
                        )}
                        <span style={hb.meta}>{fmtDate(t.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {col.key === "draft" && (
                    <div style={hb.cardHint}>草稿 · 用 esr_task 可将其推进为 active</div>
                  )}
                  {(col.key === "gapped" || col.key === "ready") && closingFor === t.id ? (
                    <div style={{ ...hb.closeForm, borderColor: col.color }}>
                      <input style={hb.input} placeholder="产物 artifact（文件/PR/路）" value={closeArtifact} onChange={(e) => setCloseArtifact(e.target.value)} />
                      <input style={hb.input} placeholder="评估 evaluation（测试/评审/分数）" value={closeEval} onChange={(e) => setCloseEval(e.target.value)} />
                      <input style={hb.input} placeholder="记忆引用 memory_refs（#id, 逗号分隔）" value={closeRefs} onChange={(e) => setCloseRefs(e.target.value)} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" style={hb.btnSolid} disabled={busy} onClick={() => void submitClose(t)}>{busy ? "…" : "按证据闭环"}</button>
                        <button type="button" style={hb.btn} onClick={() => setClosingFor(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    (col.key === "gapped" || col.key === "ready") && (
                      <button type="button" style={hb.advance} onClick={() => { setClosingFor(t.id); }}>补齐证据 → 关闭</button>
                    )
                  )}
                </div>
              ))}
              {filtered.filter(col.match).length > 20 && (
                <div style={hb.more}>+{filtered.filter(col.match).length - 20} 更多…</div>
              )}
              {filtered.filter(col.match).length === 0 && (
                <div style={hb.empty}>{col.key === "stable" ? "还没有闭环任务" : "暂无任务"}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={hb.footer}>
        <span>{columnCounts.all} 个任务（当前筛选）· 每 20s 自动刷新 · 数据源 ~/.dsh/storages/dsh_engram.json</span>
      </div>
    </div>
  );
}

const hb = {
  header: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #ffffff))",
  },
  title: { fontSize: 15, fontWeight: 700 },
  sub: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" },
  loading: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" },
  select: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    color: "inherit",
    maxWidth: 220,
  },
  input: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
    borderRadius: 8,
    padding: "5px 9px",
    fontSize: 12,
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    color: "inherit",
  },
  btn: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    color: "inherit",
  },
  btnSolid: {
    border: "none",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    color: "#fff",
    background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
  },
  close: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
    padding: "2px 6px",
  },
  warn: {
    fontSize: 12,
    color: "#b45309",
    background: "#fef3c7",
    borderRadius: 8,
    padding: "6px 10px",
    marginTop: 8,
  },
  error: { fontSize: 12, color: "#dc2626", marginTop: 8 },
  createForm: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    border: "1px dashed var(--dsw-alias-border-l3, #c7d2fe)",
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    background: "var(--dsw-alias-bg-multi-select, transparent)",
  },
  columns: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(190px, 1fr))",
    gap: 10,
    padding: "12px 14px",
    overflow: "auto",
    alignItems: "start",
  },
  column: {
    borderRadius: 12,
    padding: "9px 10px",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-hover-bg, #f9fafb))",
  },
  colHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  count: { borderRadius: 999, padding: "0 8px", fontSize: 11, fontWeight: 700 },
  colSub: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", marginTop: 1 },
  card: {
    borderRadius: 10,
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    padding: "7px 9px",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #ffffff))",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  state: {
    width: 12,
    height: 12,
    borderRadius: 4,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 8,
    color: "#fff",
    flex: "0 0 auto",
    marginTop: 2,
  },
  meta: {
    fontSize: 10,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  gap: {
    fontSize: 10,
    fontWeight: 700,
    color: "#b45309",
    background: "#fef3c7",
    borderRadius: 999,
    padding: "0 6px",
  },
  cardHint: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" },
  advance: {
    border: "1px solid rgba(99,102,241,.35)",
    background: "rgba(99,102,241,.08)",
    color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  closeForm: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    border: "1px dashed",
    borderRadius: 8,
    padding: 7,
    background: "var(--dsw-alias-bg-multi-select, transparent)",
  },
  more: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", padding: "2px 2px" },
  empty: {
    fontSize: 11.5,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    padding: "8px 2px",
    border: "1px dashed var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    borderRadius: 8,
    textAlign: "center" as const,
  },
  footer: {
    padding: "6px 14px",
    fontSize: 11,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    borderTop: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
  },
};
