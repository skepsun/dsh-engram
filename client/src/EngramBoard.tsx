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
import { EngramGraph } from "./EngramGraph";
import type { EntityRecord, LinkRecord, MentalModelRecord, ObservationRecord, TaskRecord } from "./api";

export interface EngramBoardApi {
  overview(): Promise<{ workspaces: Record<string, { memories: number; tasks: number; links: number; nodes?: number }> }>;
  tasks(workspace: string, includeStable?: boolean): Promise<{ items: TaskRecord[] }>;
  links(workspace: string): Promise<{ items: LinkRecord[] }>;
  nodes(workspace: string): Promise<{ items: EntityRecord[] }>;
  observations(workspace: string): Promise<{ items: ObservationRecord[] }>;
  model(workspace?: string): Promise<{ model: MentalModelRecord }>;
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

/** Compose per-task close evidence from bulk form values + existing task gates. */
export function buildCloseEvidence(bulkArtifact: string, bulkEval: string, bulkRefs: string, task: TaskRecord): { artifact?: string; evaluation?: string; memoryRefs?: string[] } {
  const refs = bulkRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  return {
    artifact: bulkArtifact.trim() || task.artifact || undefined,
    evaluation: bulkEval.trim() || task.evaluation || undefined,
    memoryRefs: refs.length > 0 ? refs : task.memoryRefs,
  };
}

/** Rendering-agnostic markdown export of the current task view (unit-testable). */
export function buildTasksMarkdown(tasks: TaskRecord[]): string {
  const esc = (s: string) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = tasks
    .slice()
    .sort((a, b) => a.state.localeCompare(b.state) || (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((t) => {
      const ev = `${t.artifact ? "artifact✓" : "artifact✗"} · ${t.evaluation ? "eval✓" : "eval✗"} · ${(t.memoryRefs?.length ?? 0) > 0 ? "ref✓" : "ref✗"}`;
      return `| ${t.state} | ${esc(t.name)} | ${esc(t.workspace.replace(/^.*[\\/]/, ""))} | ${esc(taskGaps(t).join(", ") || "—")} | ${ev} | ${fmtDate(t.createdAt ?? 0)} |`;
    });
  return `# ESR 任务导出 · ${new Date().toISOString().slice(0, 10)}\n\n| 状态 | 任务 | 工作区 | 证据缺口 | 证据 | 创建 |\n|---|---|---|---|---|---|\n${rows.join("\n") || "(无任务)"}`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Beads-inspired derived blocked state: open (non-stable) blocks/parent-of deps. */
function blockedBy(t: TaskRecord, all: TaskRecord[]): number {
  if (t.state === "stable") return 0;
  const open = new Set(all.filter((x) => x.state !== "stable").map((x) => x.id));
  return (t.deps ?? []).filter((d) => d.kind !== "relates-to" && open.has(d.id)).length;
}
function shortAgent(a: string | null): string {
  if (!a) return "";
  const bare = a.split(/[@#/:\\]+/).pop()!;
  return bare.replace(/^session[-_]/i, "").replace(/^agent[-_]/i, "").slice(0, 14);
}

const TREND_LABEL: Record<string, string> = {
  new: "新",
  strengthening: "增强",
  stable: "稳定",
  weakening: "减弱",
  stale: "陈旧",
};

export function EngramBoard({ api, onRequestClose }: EngramBoardProps) {
  const { vars } = useEngramTheme();
  const [overview, setOverview] = useState<{ workspaces: Record<string, { memories: number; tasks: number; links: number; nodes?: number }> } | null>(null);
  const [tasksByWs, setTasksByWs] = useState<Record<string, TaskRecord[]>>({});
  const [nodesByWs, setNodesByWs] = useState<Record<string, EntityRecord[]>>({});
  const [linksByWs, setLinksByWs] = useState<Record<string, LinkRecord[]>>({});
  const [viewMode, setViewMode] = useState<"board" | "graph">("board");
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkArtifact, setBulkArtifact] = useState("");
  const [bulkEval, setBulkEval] = useState("");
  const [bulkRefs, setBulkRefs] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const loadedWs = useRef(new Set<string>());
  const [obsItems, setObsItems] = useState<ObservationRecord[] | null>(null);
  const [obsOpen, setObsOpen] = useState(false);
  const [model, setModel] = useState<MentalModelRecord | null>(null);
  const [modelOpen, setModelOpen] = useState(false);

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
          const res = shouldLoad
            ? await Promise.all([api.tasks(w, true), api.nodes(w), api.links(w)])
            : null;
          return [w, res ? { tasks: res[0].items, nodes: res[1].items, links: res[2].items } : null] as const;
        }),
      );
      setTasksByWs((prev) => {
        const next: Record<string, TaskRecord[]> = { ...prev };
        for (const [w, items] of entries) if (items !== null) next[w] = items.tasks;
        return next;
      });
      setNodesByWs((prev) => {
        const next: Record<string, EntityRecord[]> = { ...prev };
        for (const [w, items] of entries) if (items !== null) next[w] = items.nodes;
        return next;
      });
      setLinksByWs((prev) => {
        const next: Record<string, LinkRecord[]> = { ...prev };
        for (const [w, items] of entries) if (items !== null) next[w] = items.links;
        return next;
      });
      // Evidence-grounded beliefs (endpoint may be pending a dsh web restart;
      // failures stay silent so the rest of the board keeps working).
      api.observations(ws).then((r) => setObsItems(r.items)).catch(() => {});
      api.model(ws).then((r) => setModel(r.model)).catch(() => {});
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
          const [res, nodeRes, linkRes] = await Promise.all([api.tasks(ws, true), api.nodes(ws), api.links(ws)]);
          setTasksByWs((prev) => ({ ...prev, [ws]: res.items }));
          setNodesByWs((prev) => ({ ...prev, [ws]: nodeRes.items }));
          setLinksByWs((prev) => ({ ...prev, [ws]: linkRes.items }));
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
  // Modeling nudge: when the filtered workspace has no entity graph at all.
  const wsNodesCount =
    overview === null ? 0
      : ws === "" ? Object.values(overview.workspaces).reduce((acc, w) => acc + (w.nodes ?? 0), 0)
      : (overview.workspaces[ws]?.nodes ?? 0);
  const showModelHint = overview !== null && wsNodesCount === 0;
  const totalActive = useMemo(
    () => workspaces.reduce((a, [, w]) => a + (w.tasks ?? 0), 0),
    [workspaces],
  );

  const allTasks = useMemo(() => Object.values(tasksByWs).flat(), [tasksByWs]);
  const allNodes = useMemo(() => Object.values(nodesByWs).flat(), [nodesByWs]);
  const allLinks = useMemo(() => Object.values(linksByWs).flat(), [linksByWs]);
  // Resolve node/task ids to display names for the graph.
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of allNodes) map.set(n.id, n.name);
    for (const t of allTasks) map.set(t.id, t.name);
    return (id: string) => map.get(id) ?? id;
  }, [allNodes, allTasks]);
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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** Batch-close every selected active task with one set of evidence. */
  const closeSelected = async () => {
    if (bulkBusy) return;
    const closable = filtered.filter((t) => selectedIds.has(t.id) && t.state === "active");
    if (closable.length === 0) return;
    setBulkBusy(true);
    setBulkMsg(null);
    let ok = 0;
    let fail = 0;
    for (const t of closable) {
      try {
        const out = await api.closeTask(t.workspace, t.id, buildCloseEvidence(bulkArtifact, bulkEval, bulkRefs, t));
        if (out?.state === "stable") ok += 1; else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkMsg(ok > 0 ? `批量完成：${ok} 个任务已闭环${fail > 0 ? ` · ${fail} 个未达证据门（见单卡表单补）` : ""}` : `未闭环：${fail} 个未达证据门（见单卡表单补）`);
    setBulkBusy(false);
    setSelectedIds(new Set());
    setBulkOpen(false);
    void refresh();
  };

  /** Download the filtered view as markdown. */
  const exportMd = () => {
    try {
      const md = buildTasksMarkdown(filtered);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `esr-tasks-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      /* download API unavailable in this host — export is a no-op */
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
          <span style={hb.legendChip}>仅 ESR · 会话内 todo 见输入框上方任务条</span>
          <span style={hb.seg}>
            <button type="button" style={viewMode === "board" ? hb.segActive : hb.segBtn} onClick={() => setViewMode("board")} title="四列任务看板">看板</button>
            <button type="button" style={viewMode === "graph" ? hb.segActive : hb.segBtn} onClick={() => setViewMode("graph")} title="实体关系图谱（esr_node / esr_link）">图谱</button>
          </span>
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
          {viewMode === "board" && (
            <>
              {selectedIds.size > 0 && (
                <button type="button" style={{ ...hb.btn, background: "var(--dsw-alias-state-business-tertiary, rgba(99,102,241,.12))" }} onClick={() => { setBulkOpen(true); setCreating(false); }}>
                  批量闭环（{selectedIds.size}）
                </button>
              )}
              <button type="button" style={hb.btn} onClick={exportMd} title="导出当前筛选为 markdown">
                导出
              </button>
              <button type="button" style={hb.btn} onClick={() => { setCreating((v) => !v); setClosingFor(null); }}>
                ＋ 新建
              </button>
            </>
          )}
          <button type="button" style={hb.btn} onClick={() => void refresh()} disabled={loading} title="刷新">
            刷新
          </button>
          <button type="button" style={hb.close} onClick={onRequestClose} aria-label="关闭看板">✕</button>
        </div>
      </div>

      {viewMode === "board" ? (
      <>
      {/* 分栏说明：原生 todo（会话内）与 ESR（跨会话闭环）不是同一平面 */}
      <div style={hb.partition}>
        <span style={hb.partitionTag}>原生 todo · 会话内</span>
        <span>
          由 todo_write 驱动，随会话结束，不跨会话保留；要长期沉淀的多步工作，请用
          <strong> esr_task / 本板「新建」</strong>建为 ESR 任务（
          <span style={hb.partitionTagEsr}>ESR · 跨会话闭环</span>
          ），闭环（artifact + evaluation + memory_refs 证据门）后进 [ENGRAM]。
        </span>
      </div>

      {showModelHint && (
        <div style={hb.modelHint}>
          <span style={hb.partitionTagEsr}>实体建模</span>
          <span>
            该范围还没有实体图 — 用 <strong>esr_node</strong> 建模反复出现的领域对象（包/服务/文档/概念），
            再用 <strong>esr_link</strong> 关联到任务与节点，上方切到「图谱」即可查看完整实体关系图。
          </span>
        </div>
      )}

      {model && (
        <div style={hb.obsBar}>
          <button type="button" style={hb.obsHead} onClick={() => setModelOpen((v) => !v)} aria-expanded={modelOpen} aria-label="切换常驻摘要">
            <span style={hb.partitionTagEsr}>常驻摘要 · {String(model.ws || "全部工作区").replace(/^.*[\\/]/, "") || "全部"}</span>
            <span style={hb.obsMeta}>
              生成于 {Math.max(0, Math.floor((Date.now() - model.generated_at) / 60000))} 分钟前 {modelOpen ? "▾" : "▸"}
            </span>
          </button>
          {modelOpen && (
            <div style={{ ...hb.obsBody, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 11, lineHeight: "16px" }}>
              {model.content}
            </div>
          )}
        </div>
      )}

      {obsItems && obsItems.length > 0 && (
        <div style={hb.obsBar}>
          <button type="button" style={hb.obsHead} onClick={() => setObsOpen((v) => !v)} aria-expanded={obsOpen} aria-label="切换观测列表">
            <span style={hb.partitionTagEsr}>观测 · 信念 {obsItems.length}</span>
            <span style={hb.obsMeta}>
              累计 {obsItems.reduce((sum, o) => sum + (o.proof?.count ?? 0), 0)} 条证据 · {TREND_LABEL[obsItems[0]?.trend ?? "new"]} {obsOpen ? "▾" : "▸"}
            </span>
          </button>
          {obsOpen && (
            <div style={hb.obsBody}>
              {obsItems.slice(0, 20).map((o) => (
                <div key={o.id} style={hb.obsRow} title={`证据 ${o.proof.count} 条：${(o.proof.sources ?? []).join(", ")}`}>
                  <span>{(o.negations ?? 0) > 0 ? "¬ " : ""}{o.text}</span>
                  <span style={hb.obsMeta}>×{o.proof.count} · {TREND_LABEL[o.trend] ?? o.trend}{(o.negations ?? 0) > 0 ? ` · 反证${o.negations}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

        {bulkOpen && (
          <div style={hb.createForm}>
            <div style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }}>
              批量闭环 {selectedIds.size} 个任务 — 三项证据应用到所有选中项（单卡已有的证据自动保留）
            </div>
            <input style={hb.input} placeholder="产物 artifact（文件/PR/路径）" value={bulkArtifact} onChange={(e) => setBulkArtifact(e.target.value)} />
            <input style={hb.input} placeholder="评估 evaluation（测试/评审/分数）" value={bulkEval} onChange={(e) => setBulkEval(e.target.value)} />
            <input style={hb.input} placeholder="记忆引用 memory_refs（#id, 逗号分隔）" value={bulkRefs} onChange={(e) => setBulkRefs(e.target.value)} />
            {bulkMsg && <div style={{ fontSize: 11, color: bulkMsg.startsWith("批量完成") ? "#059669" : "#b45309" }}>{bulkMsg}</div>}
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={hb.btnSolid} disabled={bulkBusy || selectedIds.size === 0} onClick={() => void closeSelected()}>{bulkBusy ? "…" : "按证据批量闭环"}</button>
              <button type="button" style={hb.btn} onClick={() => { setBulkOpen(false); setBulkMsg(null); }}>取消</button>
            </div>
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
                    <input
                      type="checkbox"
                      aria-label={`选择 ${t.name}`}
                      checked={selectedIds.has(t.id)}
                      disabled={col.key === "stable" || col.key === "draft"}
                      onChange={() => toggleSelect(t.id)}
                      style={{ margin: "2px 0 0 0", flex: "none", accentColor: col.color, cursor: col.key === "stable" || col.key === "draft" ? "not-allowed" : "pointer" }}
                    />
                    <span style={{ ...hb.state, background: col.color }}>{col.key === "stable" ? "✓" : "●"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, lineHeight: "17px", overflowWrap: "anywhere" }}>{t.name}</div>
                      {t.summary && (
                        <div style={hb.compacted} title="已压缩 · 原文保留在快照中（可回看）">🗜 {t.summary}</div>
                      )}
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
                        {blockedBy(t, allTasks) > 0 && (
                          <span style={hb.lock} title={`被 ${blockedBy(t, allTasks)} 个未闭环任务阻塞，先完成它们的 deps`}>🔒 {blockedBy(t, allTasks)}</span>
                        )}
                        {t.assignee && <span style={hb.meta} title={`claimed by ${t.assignee}`}>@{shortAgent(t.assignee)}</span>}
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
      </>
      ) : (
        <div style={hb.graphWrap}>
          {denied && (
            <div style={hb.warn}>
              ESR 看板数据不可达（loopback-only 守卫）— 任务/关系/图谱将无法加载；请通过本机访问 GUI，或放入受信网络访问。
            </div>
          )}
          {error && <div style={hb.error}>⚠ {error}</div>}
          <div style={hb.graphPanel}>
            <div style={hb.graphHead}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>关系图谱（esr_node / esr_link 力导向图）</span>
              <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }}>
                {ws === "" ? "全部工作区" : ws.replace(/^.*[\\/]/, "")} · 实体为圆形节点，任务为勾选徽标；点选节点查看关系明细
              </span>
            </div>
            <EngramGraph workspace={ws} entities={allNodes} tasks={allTasks} links={allLinks} nameOf={nameOf} />
          </div>
        </div>
      )}

      <div style={hb.footer}>
        <span>
          {viewMode === "board"
            ? `${columnCounts.all} 个任务（当前筛选）· 每 20s 自动刷新 · 数据源 ~/.dsh/storages/dsh_engram.json`
            : `${allNodes.length} 个实体 · ${allLinks.length} 条关系 · ${allTasks.length} 个任务 · 每 20s 自动刷新 · 数据源 ~/.dsh/storages/dsh_engram.json`}
        </span>
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
  legendChip: {
    display: "inline-flex", alignItems: "center", gap: 4,
    fontSize: 10, fontWeight: 700, lineHeight: "16px",
    padding: "0 7px", borderRadius: 999, whiteSpace: "nowrap",
    color: "var(--dsw-alias-label-tertiary, #9ca3af)",
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
  },
  /** 看板 / 图谱 segmented toggle. */
  seg: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    background: "var(--dsw-alias-bg-multi-select, var(--dsh-color-hover-bg, #f3f4f6))",
    borderRadius: 999,
  },
  segBtn: {
    border: "none",
    background: "none",
    borderRadius: 999,
    padding: "3px 10px",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
    whiteSpace: "nowrap",
  },
  segActive: {
    border: "none",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    borderRadius: 999,
    padding: "3px 10px",
    fontSize: 11.5,
    fontWeight: 700,
    cursor: "pointer",
    color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 3px rgba(15,23,42,.10)",
  },
  /** Explanation bar partitioning the native todo plane from the ESR kanban. */
  partition: {
    display: "flex", gap: 6, alignItems: "flex-start",
    fontSize: 11.5, lineHeight: 1.55, padding: "6px 14px",
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
    borderBottom: "1px dashed var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04))",
  },
  partitionTag: {
    flex: "none", fontSize: 10, fontWeight: 700, lineHeight: "16px",
    padding: "0 7px", borderRadius: 999,
    color: "var(--dsw-alias-label-amber, #b45309)",
    background: "rgba(217,119,6,.12)",
    whiteSpace: "nowrap",
  },
  partitionTagEsr: {
    flex: "none", fontSize: 10, fontWeight: 700, lineHeight: "16px",
    padding: "0 7px", borderRadius: 999,
    color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
    background: "rgba(99,102,241,.12)",
    whiteSpace: "nowrap",
  },
  obsBar: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: "0 14px 10px",
    border: "1px solid var(--dsw-alias-divider, rgba(120,130,160,.18))",
    borderRadius: 8,
    background: "var(--dsw-alias-surface-elevated, rgba(255,255,255,.5))",
    padding: "4px 8px",
  },
  obsHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    padding: "2px 0",
    font: "inherit",
    width: "100%",
  },
  obsMeta: {
    fontSize: 10.5,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
  },
  obsBody: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: "2px 0 4px",
  },
  obsRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 11.5,
    lineHeight: "16px",
    borderBottom: "1px dashed var(--dsw-alias-divider, rgba(120,130,160,.14))",
    paddingBottom: 3,
  },
  modelHint: {
    display: "flex", gap: 6, alignItems: "flex-start",
    fontSize: 11.5, lineHeight: 1.55, padding: "6px 14px",
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
    borderBottom: "1px dashed var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04))",
  },
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
  /** Graph view fills the center column, scrolling only when it overflows. */
  graphWrap: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "12px 14px",
  },
  graphPanel: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    borderRadius: 12,
    padding: "10px 12px",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
  },
  graphHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 6,
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
  lock: { fontSize: 10, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", fontWeight: 600, letterSpacing: 0.5 },
  compacted: { fontSize: 11, lineHeight: "15px", marginTop: 3, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted, #6b7280))", overflowWrap: "anywhere" },
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
