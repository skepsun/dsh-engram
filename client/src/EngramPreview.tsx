/**
 * dsh-engram: [ENGRAM] / [ESR] injection preview.
 *
 * Shows the exact prompt blocks the model sees each session — the compact
 * [ENGRAM] symbolic index (order 40) and the [ESR] task/closure block
 * (order 41). Both are rendered once per session and frozen, so the prefix
 * stays byte-stable for KV cache reuse; this panel live-renders the same
 * pure functions so the user can audit what will be injected and its token
 * cost, per workspace.
 */

import { useEffect, useMemo, useState } from "react";
import type { EngramApi, InjectPreview } from "./api";
import { useEngramTheme } from "./theme";

interface EngramPreviewFace {
  api: EngramApi;
  /** "" means "全部工作区" — the panel falls back to the first workspace. */
  workspace: string;
  workspaces: string[];
}

function lineColor(line: string, dark: boolean): React.CSSProperties {
  if (line.startsWith("[ENGRAM]") || line.startsWith("[ESR]")) {
    return { color: dark ? "#7aa2ff" : "#3b5bdb", fontWeight: 700 };
  }
  if (line.startsWith("escalate:")) {
    return { color: "#d97706", fontWeight: 600 };
  }
  if (line.startsWith("drill:")) {
    return { color: dark ? "#6b7280" : "#9ca3af" };
  }
  if (line.startsWith("nodes:")) {
    return { color: dark ? "#8b93a7" : "#6b7280" };
  }
  if (line.startsWith("- ")) {
    return { color: dark ? "#c9d0dc" : "#4b5563" };
  }
  if (line.startsWith("[T]")) {
    return { color: dark ? "#f0ab6a" : "#b45309" };
  }
  return {};
}

export function EngramPreview({ api, workspace, workspaces }: EngramPreviewFace) {
  const { dark, vars } = useEngramTheme();
  const [ws, setWs] = useState<string>(workspace || workspaces[0] || "");
  const [data, setData] = useState<InjectPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"engram" | "esr" | null>(null);

  // Follow the parent workspace picker when it selects one explicitly.
  useEffect(() => {
    if (workspace !== "") setWs(workspace);
  }, [workspace]);

  const refresh = useMemo(
    () => async (): Promise<void> => {
      const target = ws || workspaces[0] || "";
      if (!target) {
        setData(null);
        return;
      }
      setLoading(true);
      try {
        const res = await api.preview(target);
        setData(res);
        setError(null);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
      }
    },
    [api, ws, workspaces],
  );

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const copy = (which: "engram" | "esr"): void => {
    const text = data ? (which === "engram" ? data.engram : data.esr) : "";
    if (!text) return;
    const done = () => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  };

  const hb: Record<string, React.CSSProperties> = {
    root: { display: "flex", flexDirection: "column", gap: 10, ...vars },
    head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    title: { fontWeight: 700, fontSize: 13 },
    sub: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" },
    pick: {
      marginLeft: "auto",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      padding: "4px 8px",
      borderRadius: 7,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      background: "var(--dsh-color-surface, #fafafa)",
      color: "var(--dsh-color-text, #1f2937)",
      outline: "none",
    },
    meta: { display: "flex", gap: 6, flexWrap: "wrap" },
    chip: {
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10.5, fontWeight: 600, padding: "2px 8px",
      borderRadius: 999, border: "1px solid var(--dsh-color-border, #d1d5db)",
      color: "var(--dsh-color-muted-strong, #374151)",
      background: "var(--dsh-color-hover-bg, rgba(127,127,127,.08))",
    },
    panes: { display: "flex", gap: 10, flexWrap: "wrap" },
    pane: {
      flex: "1 1 340px", minWidth: 260,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 10, overflow: "hidden",
      background: dark ? "rgba(10,14,22,.4)" : "rgba(15,23,42,.04)",
      display: "flex", flexDirection: "column",
    },
    paneHead: {
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px",
      borderBottom: "1px solid var(--dsh-color-border, #d1d5db)",
      fontSize: 12, fontWeight: 700,
    },
    badge: {
      fontSize: 10, fontWeight: 700, padding: "1px 7px",
      borderRadius: 999, color: "#fff",
    },
    orderChip: {
      fontSize: 10.5, fontWeight: 600, padding: "1px 7px",
      borderRadius: 999,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      color: "var(--dsh-color-muted, #6b7280)",
    },
    copyBtn: {
      marginLeft: "auto",
      fontSize: 11, fontWeight: 600,
      padding: "2px 9px", borderRadius: 7, cursor: "pointer",
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      background: "transparent",
      color: "var(--dsh-color-muted-strong, #374151)",
    },
    pre: {
      margin: 0, padding: "12px 14px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11.5, lineHeight: 1.65,
      color: "var(--dsh-color-text, #1f2937)",
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      overflow: "auto", maxHeight: 340,
    },
    empty: {
      padding: "14px 16px", fontSize: 12,
      color: "var(--dsh-color-muted, #6b7280)",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontStyle: "italic",
    },
    paneCost: { display: "flex", gap: 5, padding: "0 12px 10px", flexWrap: "wrap" },
  };

  const target = ws || workspaces[0] || "";

  if (!target) {
    return (
      <div style={{ ...hb.root, color: "var(--dsh-color-muted, #6b7280)" }}>
        <span>还没有可用工作区 — 先创建/打开一个工作区，[ENGRAM] 注入块会按工作区独立渲染。</span>
      </div>
    );
  }

  const esrLines = data ? data.esr.split("\n") : [];
  const engramLines = data ? data.engram.split("\n") : [];

  return (
    <div style={hb.root}>
      <div style={hb.head}>
        <span style={hb.title}>注入预览（[ENGRAM] · [ESR]）</span>
        <span style={hb.sub}>
          每个会话实际注入的提示块 · 会话内冻结一次（order 40/41，前缀稳定复用 KV 缓存）
        </span>
        <select style={hb.pick} value={ws} onChange={(e) => setWs(e.target.value)}>
          {workspaces.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
          {workspaces.length === 1 && <option value={ws}>{ws}</option>}
        </select>
      </div>

      <div style={hb.meta}>
        {data && (
          <>
            <span style={hb.chip}>记忆 {data.meta.counts.memories}</span>
            <span style={hb.chip}>任务 {data.meta.counts.tasks} active</span>
            <span style={hb.chip}>关系 {data.meta.counts.links}</span>
            <span style={hb.chip}>节点 {data.meta.counts.nodes}</span>
            <span style={hb.chip}>共 ~{(data.meta.engram.tokens + data.meta.esr.tokens)} tokens</span>
          </>
        )}
        {!data && !error && <span style={hb.chip}>{loading ? "读取中…" : "…"}</span>}
        {error && <span style={hb.chip}>{error}</span>}
      </div>

      <div style={hb.panes}>
        {/* [ENGRAM] index block */}
        <div style={hb.pane}>
          <div style={hb.paneHead}>
            <span style={{ ...hb.badge, background: dark ? "#3b5bdb" : "#4f46e5" }}>ENGRAM</span>
            索引块
            <span style={hb.orderChip}>order 40</span>
            <button style={hb.copyBtn} onClick={() => copy("engram")}>
              {copied === "engram" ? "已复制 ✓" : "复制"}
            </button>
          </div>
          {!data && <div style={hb.empty}>{loading ? "渲染中…" : "–"}</div>}
          {data && data.engram === "" && (
            <div style={hb.empty}>该工作区没有可注入的记忆/任务/关系 ([ENGRAM] 块为空)。</div>
          )}
          {data && data.engram !== "" && (
            <pre style={hb.pre}>
              {engramLines.map((line, i) => (
                <div key={i} style={lineColor(line, dark)}>{line || "\u00a0"}</div>
              ))}
            </pre>
          )}
          <div style={hb.paneCost}>
            {data && (
              <>
                <span style={hb.chip}>{data.meta.engram.lines} 行</span>
                <span style={hb.chip}>{data.meta.engram.chars} 字符</span>
                <span style={hb.chip}>~{data.meta.engram.tokens} tokens</span>
              </>
            )}
          </div>
        </div>

        {/* [ESR] task/closure block */}
        <div style={hb.pane}>
          <div style={hb.paneHead}>
            <span style={{ ...hb.badge, background: dark ? "#6d28d9" : "#7c3aed" }}>ESR</span>
            任务 · 闭环块
            <span style={hb.orderChip}>order 41</span>
            <button style={hb.copyBtn} onClick={() => copy("esr")}>
              {copied === "esr" ? "已复制 ✓" : "复制"}
            </button>
          </div>
          {!data && <div style={hb.empty}>{loading ? "渲染中…" : "–"}</div>}
          {data && data.esr === "" && (
            <div style={hb.empty}>该工作区没有任务 ([ESR] 块为空)。</div>
          )}
          {data && data.esr !== "" && (
            <pre style={hb.pre}>
              {esrLines.map((line, i) => (
                <div key={i} style={lineColor(line, dark)}>{line || "\u00a0"}</div>
              ))}
            </pre>
          )}
          <div style={hb.paneCost}>
            {data && (
              <>
                <span style={hb.chip}>{data.meta.esr.lines} 行</span>
                <span style={hb.chip}>{data.meta.esr.chars} 字符</span>
                <span style={hb.chip}>~{data.meta.esr.tokens} tokens</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={hb.sub}>
        说明：块由与系统提示相同的纯函数实时渲染（每 20s 刷新）；「escalate:」行是最近 14 天
        mem/esr 调用失衡时自动附加的数据驱动提醒，行为改善后自动消失。复制按钮可直接把注入块
        贴进提示词审计。
      </div>
    </div>
  );
}
