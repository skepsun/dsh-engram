/**
 * dsh-engram: details side panel (master–detail).
 *
 * Rendered by EngramSection as a right-hand detail pane. Shows the full
 * record behind a task / memory / node / relation row: identifiers, state,
 * evidence gates (with the closure form for active tasks), memory-ref
 * navigation, and incident relations. Pure React — no shell coupling.
 */

import { useMemo, useState } from "react";
import type { EngramApi, EntityRecord, LinkRecord, MemoryRecord, TaskRecord } from "./api";
import { useEngramTheme } from "./theme";
import { EvidenceRing } from "./EvidenceRing";

export type DetailTarget =
  | { kind: "task"; id: string }
  | { kind: "memory"; memory: MemoryRecord }
  | { kind: "node"; id: string }
  | { kind: "link"; link: LinkRecord };

interface EngramDetailFace {
  target: DetailTarget;
  api: EngramApi;
  memories: MemoryRecord[];
  tasks: TaskRecord[];
  nodes: EntityRecord[];
  links: LinkRecord[];
  onClose: () => void;
  /** Jump to a memory by id (caller resolves/refetches). */
  onNavigateMemory: (id: string) => void;
  /** Data changed (e.g. task closed) — caller refreshes its lists. */
  onChanged?: () => void;
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

const REL_COLORS: Record<string, string> = {
  depends_on: "#d97706",
  implements: "#2563eb",
  refines: "#7c3aed",
  contradicts: "#dc2626",
  tracks: "#059669",
};

function fmtDate(ts: number | undefined): string {
  if (!ts) return "–";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function daysLeft(ts: number | null): string {
  if (ts === null || ts === undefined) return "∞";
  const days = Math.ceil((ts - Date.now()) / 86400000);
  return days > 0 ? `${days}d` : "已过期";
}

function gapsOf(t: TaskRecord): string[] {
  const gaps: string[] = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}

export function EngramDetail({ target, api, memories, tasks, nodes, links, onClose, onNavigateMemory, onChanged }: EngramDetailFace) {
  const { dark, vars } = useEngramTheme();
  const [gArt, setGArt] = useState("");
  const [gEval, setGEval] = useState("");
  const [gRefs, setGRefs] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const task = target.kind === "task" ? tasks.find((t) => t.id === target.id) ?? null : null;
  const node = target.kind === "node" ? nodes.find((n) => n.id === target.id) ?? null : null;
  const link = target.kind === "link" ? target.link : null;

  const nameOf = useMemo(() => {
    const nodeName = (id: string) => nodes.find((n) => n.id === id)?.name;
    const taskName = (id: string) => tasks.find((t) => t.id === id)?.name;
    return (id: string) => nodeName(id) ?? taskName(id) ?? id;
  }, [nodes, tasks]);

  const incident = useMemo(() => {
    if (target.kind !== "node" || !node) return [];
    return links
      .filter((l) => l.source === node.id || l.target === node.id)
      .map((l) => ({ l, outgoing: l.source === node.id }));
  }, [links, node, target.kind]);

  const hb: Record<string, React.CSSProperties> = {
    root: {
      ...vars,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 12,
      background: dark ? "rgba(10,14,22,.55)" : "var(--dsh-color-surface, #ffffff)",
      boxShadow: "0 1px 2px rgba(15,23,42,.05), 0 8px 24px rgba(15,23,42,.07)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      maxHeight: "72vh",
    },
    head: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 12px",
      borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
      background: dark ? "rgba(15,23,42,.6)" : "rgba(15,23,42,.04)",
    },
    title: { fontWeight: 700, fontSize: 13, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
    close: { border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "var(--dsh-color-muted, #6b7280)", padding: "2px 6px", borderRadius: 6 },
    body: { padding: "10px 12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 },
    kv: { display: "flex", flexDirection: "column", gap: 3 },
    k: { fontSize: 10.5, fontWeight: 700, color: "var(--dsh-color-muted-weak, #9ca3af)", textTransform: "uppercase" as const, letterSpacing: 0.4 },
    v: { color: "var(--dsh-color-muted-strong, #374151)", wordBreak: "break-word" as const, lineHeight: 1.5 },
    mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
    badge: { fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: "#fff" },
    tag: { fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "var(--dsh-color-hover-bg, #f3f4f6)", color: "var(--dsh-color-muted, #6b7280)", border: "1px solid var(--dsh-color-border, #e5e7eb)" },
    chip: { fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(37,99,235,.1)", color: "#2563eb", border: "1px solid rgba(37,99,235,.25)", cursor: "pointer" },
    input: { fontSize: 12, padding: "5px 8px", border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 8, background: "var(--dsh-color-surface, #ffffff)", color: "var(--dsh-color-muted-strong, #374151)", width: "100%", boxSizing: "border-box" as const },
    btn: { fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid var(--dsh-color-border, #d1d5db)", background: "transparent", color: "var(--dsh-color-muted-strong, #374151)" },
    btnPrimary: { fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, cursor: "pointer", border: "none", background: "#2563eb", color: "#fff" },
    relRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const, fontSize: 12 },
    relType: { border: "1px dashed var(--dsh-color-border, #cbd5e1)", borderRadius: 999, padding: "1px 7px", fontSize: 11, color: "var(--dsh-color-muted, #6b7280)" },
    dot: { width: 8, height: 8, borderRadius: 999, display: "inline-block" },
    section: { marginTop: 2 },
  };

  async function submitClose() {
    if (!task) return;
    setBusy(true);
    setNotice(null);
    try {
      const refs = gRefs.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      const res = await api.closeTask(task.workspace, task.id, { artifact: gArt.trim() || undefined, evaluation: gEval.trim() || undefined, memoryRefs: refs.length ? refs : undefined });
      setNotice(res.state === "stable" ? `已闭环 → STABLE ✓` : `仍有缺口：${(res.gaps ?? []).join(", ") || "—"}`);
      onChanged?.();
    } catch (e) {
      setNotice(`关闭失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const kindBadge = (kind: string, label: string) => (
    <span style={{ ...hb.badge, background: KIND_COLORS[kind] ?? "#6b7280" }}>{label}</span>
  );

  const headerTitle =
    target.kind === "task" ? task?.name ?? target.id
      : target.kind === "memory" ? target.memory.text.slice(0, 40)
      : target.kind === "node" ? node?.name ?? target.id
      : link ? nameOf(link.source) : "";
  const headerKind =
    target.kind === "task" ? (task?.state === "stable" ? { k: "task", label: "STABLE" } : task ? { k: "task", label: task.state === "draft" ? "DRAFT" : "任务" } : { k: "task", label: "任务" })
      : target.kind === "memory" ? { k: target.memory.kind, label: KIND_LABEL[target.memory.kind] ?? target.memory.kind }
      : target.kind === "node" ? { k: "node", label: node?.kind || "节点" }
      : { k: "link", label: "关系" };

  return (
    <div style={hb.root}>
      <div style={hb.head}>
        {kindBadge(headerKind.k, headerKind.label)}
        <div style={hb.title} title={headerTitle}>{headerTitle}</div>
        <button style={hb.close} onClick={onClose} aria-label="关闭详情">✕</button>
      </div>
      <div style={hb.body}>
        {target.kind === "task" && !task && <div style={hb.v}>任务不存在（可能已被关闭/归档）。</div>}

        {target.kind === "task" && task && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <EvidenceRing artifact={Boolean(task.artifact)} evaluation={Boolean(task.evaluation)} refs={(task.memoryRefs?.length ?? 0) > 0} size={40} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{task.name}</div>
                <div style={hb.mono}>{task.id} · {task.workspace}</div>
              </div>
            </div>
            <div style={hb.section}>
              <div style={hb.k}>状态</div>
              <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginTop: 3 }}>
                <span style={{ ...hb.badge, background: task.state === "stable" ? "#059669" : task.state === "draft" ? "#6b7280" : gapsOf(task).length === 0 ? "#2563eb" : "#d97706" }}>
                  {task.state === "stable" ? "STABLE" : task.state === "draft" ? "DRAFT" : gapsOf(task).length === 0 ? "READY" : "ACTIVE"}
                </span>
                <span style={hb.tag}>创建 {fmtDate(task.createdAt)}</span>
                <span style={hb.tag}>更新 {fmtDate(task.updatedAt)}</span>
              </div>
            </div>
            {task.description && (
              <div style={hb.section}>
                <div style={hb.k}>描述</div>
                <div style={{ ...hb.v, marginTop: 3 }}>{task.description}</div>
              </div>
            )}
            {task.state === "active" && gapsOf(task).length > 0 && (
              <div style={hb.section}>
                <div style={hb.k}>证据缺口</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                  {gapsOf(task).map((g) => <span key={g} style={hb.tag}>{g} ✗</span>)}
                </div>
              </div>
            )}
            {task.artifact && <div style={hb.section}><div style={hb.k}>artifact</div><div style={{ ...hb.mono, marginTop: 3, color: "#059669" }}>✓ {task.artifact}</div></div>}
            {task.evaluation && <div style={hb.section}><div style={hb.k}>evaluation</div><div style={{ marginTop: 3, color: "#059669" }}>✓ {task.evaluation}</div></div>}
            {task.memoryRefs.length > 0 && (
              <div style={hb.section}>
                <div style={hb.k}>记忆引用</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                  {task.memoryRefs.map((r) => (
                    <span key={r} style={hb.chip} title={`打开记忆 ${r}`} onClick={() => onNavigateMemory(r)}>#{r.slice(0, 8)}</span>
                  ))}
                </div>
              </div>
            )}

            {task.state === "active" && (
              <div style={{ marginTop: 4, padding: 8, border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 10, background: dark ? "rgba(15,23,42,.35)" : "rgba(15,23,42,.03)" }}>
                <div style={{ fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }}>补齐证据 → 关闭（三项全齐转 STABLE）</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input style={hb.input} placeholder="artifact 产物（文件/PR/路）" value={gArt} onChange={(e) => setGArt(e.target.value)} />
                  <input style={hb.input} placeholder="evaluation 评估（测试/评审/分数）" value={gEval} onChange={(e) => setGEval(e.target.value)} />
                  <input style={hb.input} placeholder="memory_refs（#id, 逗号分隔）" value={gRefs} onChange={(e) => setGRefs(e.target.value)} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={hb.btnPrimary} disabled={busy} onClick={() => setClosing(true)}>{busy ? "…" : "按证据闭环"}</button>
                    {closing && !busy && (
                      <>
                        <span style={{ fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", alignSelf: "center" }}>确认提交？</span>
                        <button style={hb.btn} onClick={() => { void submitClose(); setClosing(false); }}>确认</button>
                        <button style={hb.btn} onClick={() => setClosing(false)}>取消</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            {task.state === "stable" && (
              <div style={{ fontSize: 11.5, color: "#059669", fontWeight: 700 }}>已闭环 ✓ — 全部证据门已满足，可以从看板/清单移除</div>
            )}
            {notice && <div style={{ fontSize: 11.5, fontWeight: 600, color: "#d97706" }}>{notice}</div>}
          </>
        )}

        {target.kind === "memory" && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              {kindBadge(target.memory.kind, KIND_LABEL[target.memory.kind] ?? target.memory.kind)}
              <span style={hb.tag}>signal {target.memory.signal.toFixed(2)}</span>
              <span style={hb.tag}>hits {target.memory.hits}</span>
              {target.memory.status === "archived" && <span style={hb.tag}>archived</span>}
            </div>
            <div style={hb.section}>
              <div style={hb.k}>内容</div>
              <div style={{ ...hb.v, whiteSpace: "pre-wrap", background: dark ? "rgba(15,23,42,.5)" : "rgba(15,23,42,.05)", borderRadius: 8, padding: 8, marginTop: 3 }}>{target.memory.text}</div>
            </div>
            {target.memory.tags.length > 0 && (
              <div style={hb.section}>
                <div style={hb.k}>标签</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>{target.memory.tags.map((t) => <span key={t} style={hb.tag}>#{t}</span>)}</div>
              </div>
            )}
            <div style={hb.section}>
              <div style={hb.k}>元数据</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)" }}>
                <span>id   {target.memory.id}</span>
                <span>ws   {target.memory.workspace}</span>
                <span>entity {target.memory.entity ?? "—"}</span>
                <span>session {target.memory.sessionId} · seq {target.memory.seq}</span>
                <span>created {fmtDate(target.memory.createdAt)} · updated {fmtDate(target.memory.updatedAt)}</span>
                <span>TTL {daysLeft(target.memory.expiresAt)}</span>
              </div>
            </div>
          </>
        )}

        {target.kind === "node" && !node && <div style={hb.v}>节点不存在。</div>}
        {target.kind === "node" && node && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {kindBadge("node", node.kind || "节点")}
              <span style={{ fontWeight: 700, fontSize: 13 }}>{node.name}</span>
            </div>
            {node.description && (
              <div style={hb.section}>
                <div style={hb.k}>描述</div>
                <div style={{ ...hb.v, marginTop: 3 }}>{node.description}</div>
              </div>
            )}
            <div style={hb.section}>
              <div style={hb.k}>元数据</div>
              <div style={{ marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span>{node.id} · {node.workspace}</span>
                <span>created {fmtDate(node.createdAt)}</span>
              </div>
            </div>
            <div style={hb.section}>
              <div style={hb.k}>关联关系（{incident.length}）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 3 }}>
                {incident.length === 0 && <div style={hb.v}>暂无关系 — 用 esr_link 关联</div>}
                {incident.map(({ l, outgoing }) => {
                  const other = outgoing ? l.target : l.source;
                  const color = REL_COLORS[l.relation] ?? "#6b7280";
                  return (
                    <div key={l.id} style={hb.relRow}>
                      <span style={{ ...hb.dot, background: color }} />
                      <span className="mono" style={{ fontSize: 11 }}>{outgoing ? "→" : "←"} {nameOf(other)}</span>
                      <span style={hb.relType}>{l.relation}</span>
                      <span style={{ fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>{Math.round(l.confidence * 100)}%</span>
                      <span style={{ fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>{fmtDate(l.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {target.kind === "link" && link && (
          <>
            <div style={hb.relRow}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{nameOf(link.source)}</span>
              <span style={{ ...hb.relType, color: REL_COLORS[link.relation] ?? "var(--dsh-color-muted, #6b7280)", borderColor: (REL_COLORS[link.relation] ?? "#cbd5e1") + "66" }}>{link.relation}</span>
              <span aria-hidden>→</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{nameOf(link.target)}</span>
            </div>
            <div style={hb.section}>
              <div style={hb.k}>元数据</div>
              <div style={{ marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span>id {link.id} · {link.workspace}</span>
                <span>confidence {Math.round(link.confidence * 100)}%</span>
                <span>created {fmtDate(link.createdAt)}</span>
                <span>{link.source} → {link.target}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
