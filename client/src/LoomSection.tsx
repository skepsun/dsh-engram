/**
 * dsh-loom client: the Settings → "Loom 记忆" page (settings.section).
 *
 * Reads the real store through the /api/dsh-loom route family and renders:
 *   - overview stat cards (counts, capture totals, per-workspace index cost)
 *   - memory search/filter table with archive/delete actions
 *   - the ESR task board (state + evidence gaps) and the relation list
 *
 * Plain React + inline styles — no UI-primitives import (bundle-purity gate).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoomApi, LoomConfig, LoomOverview, MemoryRecord, TaskRecord, LinkRecord } from "./api";

export interface LoomSectionFace {
  api: LoomApi;
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
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12.5 },
  th: {
    textAlign: "left" as const,
    padding: "6px 8px",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
    color: "var(--dsh-color-muted, #6b7280)",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
  td: { padding: "6px 8px", borderBottom: "1px solid var(--dsh-color-border, #f3f4f6)", verticalAlign: "top" as const },
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

export function LoomSection({ api, t }: LoomSectionFace) {
  const [overview, setOverview] = useState<LoomOverview | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ov = await api.overview();
      setOverview(ov);
      const ws = workspace || Object.keys(ov.workspaces)[0] || "";
      if (ws) setWorkspace(ws);
      const [mem, tas] = await Promise.all([
        api.memories({ workspace: workspace || undefined, q: q || undefined, kind: kind || undefined }),
        ws ? api.tasks(ws, true) : Promise.resolve({ items: [] as TaskRecord[] }),
      ]);
      setMemories(mem.items);
      setTasks(tas.items);
      if (ws) {
        const lin = await api.links(ws);
        setLinks(lin.items);
      } else {
        setLinks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, workspace, q, kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workspaces = useMemo(() => (overview ? Object.keys(overview.workspaces) : []), [overview]);
  const kindsPresent = useMemo(() => (overview ? Object.keys(overview.kinds) : []), [overview]);
  const cfg: LoomConfig | null = overview?.config ?? null;

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const indexCost = workspace && overview ? overview.indexes[workspace] : null;

  return (
    <div style={s.root}>
      <h1 style={s.h1}>Loom 记忆</h1>
      <p style={s.sub}>
        跨会话记忆 · 零 LLM 自动捕获 · 符号索引渐进披露 — 数据源 ~/.dsh/storages/dsh_loom.json
      </p>

      {error && <div style={s.error}>{t("error")}: {error}</div>}

      {overview && (
        <div style={s.stats}>
          <StatCard num={String(overview.totals.memories)} label="记忆 (active)" />
          <StatCard num={String(overview.totals.tasks)} label="任务 (active)" />
          <StatCard num={String(overview.totals.links)} label="关系" />
          <StatCard num={String(workspaces.length)} label="工作区" />
          <StatCard num={String(overview.captures.total)} label="自动捕获" />
          <StatCard
            num={indexCost ? `~${indexCost.tokens}` : "–"}
            label="[LOOM] 索引 token / 工作区"
          />
        </div>
      )}

      <div style={s.row}>
        <select style={s.input} value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
          {workspaces.length === 0 && <option value="">(no workspaces)</option>}
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>{ws}</option>
          ))}
        </select>
        <select style={s.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">全部类型</option>
          {kindsPresent.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
          ))}
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
        <thead>
          <tr>
            <th style={s.th}>类型</th>
            <th style={s.th}>内容</th>
            <th style={s.th}>标签</th>
            <th style={s.th}>时间</th>
            <th style={s.th}>hits</th>
            <th style={s.th}>signal</th>
            <th style={s.th}>TTL</th>
            <th style={s.th} />
          </tr>
        </thead>
        <tbody>
          {memories.length === 0 && (
            <tr><td colSpan={8} style={s.empty}>暂无记忆 — 使用 loom_store 显式记录，或让自动捕获工作（git 提交 / 关键文件编辑 / 工具错误）</td></tr>
          )}
          {memories.map((m) => (
            <tr key={m.id}>
              <td style={s.td}><span style={{ ...s.badge, background: KIND_COLORS[m.kind] ?? "#6b7280" }}>{KIND_LABEL[m.kind] ?? m.kind}</span></td>
              <td style={{ ...s.td, maxWidth: 520 }}>
                <div>{m.text}</div>
                <div style={s.mono}>{m.id.slice(0, 8)}{m.entity ? ` · ${m.entity}` : ""}</div>
              </td>
              <td style={s.td}>{m.tags.map((tag) => <span key={tag} style={s.tag}>{tag}</span>)}</td>
              <td style={s.td}>{fmtDate(m.createdAt)}</td>
              <td style={s.td}>{m.hits}</td>
              <td style={s.td}>{(m.signal).toFixed(2)}</td>
              <td style={s.td}>{daysLeft(m.expiresAt)}</td>
              <td style={s.td}>
                <button style={s.btn} title="归档（TTL/软删，可恢复不载入索引）" onClick={() => void act(() => api.archive(m.id, m.workspace))}>归档</button>{" "}
                <button style={s.btn} title="永久删除" onClick={() => { if (window.confirm(`删除这条记忆?\n${m.text.slice(0, 60)}`)) void act(() => api.remove(m.id, m.workspace)); }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={s.panelTitle}>ESR 任务（证据闭环）</div>
      {tasks.length === 0 && <div style={s.empty}>暂无任务 — esr_task 创建</div>}
      {tasks.map((task) => {
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
            </div>
            {!isStable && gaps.length > 0 && (
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                缺口：{gaps.join(", ")} — 提供 artifact / evaluation / memory_ref 后 esr_close 转 STABLE
              </div>
            )}
            {task.description && <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>{task.description}</div>}
            {task.memoryRefs.length > 0 && (
              <div style={{ fontSize: 12, marginTop: 4 }}>记忆引用：{task.memoryRefs.map((r) => <span key={r} style={s.tag}>{r.slice(0, 8)}</span>)}</div>
            )}
          </div>
        );
      })}

      <div style={s.panelTitle}>关系（esr_link）</div>
      {links.length === 0 && <div style={s.empty}>暂无关系</div>}
      {links.map((l: LinkRecord) => (
        <div key={l.id} style={{ fontSize: 12.5, padding: "2px 0" }}>
          <span className="mono" style={s.mono}>{l.source.slice(0, 10)}</span>
          {" "}--{l.relation}--&gt;{" "}
          <span className="mono" style={s.mono}>{l.target.slice(0, 10)}</span>
          <span style={{ color: "#9ca3af" }}> · {fmtDate(l.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
