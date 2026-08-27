/**
 * dsh-engram: agent-behavior telemetry dashboard.
 *
 * Pure-SVG dashboard over GET /api/dsh-engram/stats — the real usage rollup
 * the host accumulates per (workspace × day) on every engram_* / esr_* call.
 * Gauges surface the closure loop's health (ESR proactivity vs the 0.34
 * threshold the escalate hint uses), the daily stacked bar chart shows the
 * mem-vs-esr rhythm, and the tool breakdown shows where the calls went.
 * No chart library — every shape is hand-rolled SVG keeping the bundle pure.
 */

import { useEffect, useMemo, useState } from "react";
import type { EngramApi, EngramStats } from "./api";
import { useEngramTheme } from "./theme";
import { POLL_MS } from "./esrModel";
import { EvidenceRing } from "./EvidenceRing";

interface EngramTelemetryFace {
  api: EngramApi;
  /** "" means all workspaces (stats(undefined)). */
  workspace: string;
}

const MEM_TOOLS = ["engram_store", "engram_recall", "engram_detail", "loom_store", "loom_recall", "loom_detail"];
const ESR_TOOLS = ["esr_task", "esr_node", "esr_close", "esr_link", "esr_gc"];
const COLOR_MEM = "#3b5bdb";
const COLOR_ESR = "#7c3aed";
const COLOR_MUTED = "#94a3b8";

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return `${Math.round(v * 100)}%`;
}

export function EngramTelemetry({ api, workspace }: EngramTelemetryFace) {
  const { dark, vars } = useEngramTheme();
  const [stats, setStats] = useState<EngramStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useMemo(
    () => async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await api.stats(workspace || undefined);
        setStats(res);
        setError(null);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
      }
    },
    [api, workspace],
  );

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const toolRows = useMemo(() => {
    if (!stats) return [];
    const entries = Object.entries(stats.totals.counts ?? {}).sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 8).map(([name, count]) => ({
      name,
      count,
      esc: ESR_TOOLS.includes(name) ? "esr" : MEM_TOOLS.includes(name) ? "mem" : "other",
    }));
  }, [stats]);

  const daily = useMemo(() => {
    if (!stats) return { rows: [], max: 1 };
    const rows = [...(stats.byDay ?? [])].reverse().slice(-14);
    const max = Math.max(1, ...rows.map((d) => Object.values(d.counts ?? {}).reduce((a, b) => a + b, 0)));
    return { rows, max };
  }, [stats]);

  const dose = stats && stats.ratios ? stats.ratios : null;
  const sampleText = stats && stats.ratios && stats.ratios.calls < 10 ? `样本不足（${stats.ratios.calls} 次），比例仅供参考` : null;

  const hb: Record<string, React.CSSProperties> = {
    root: { display: "flex", flexDirection: "column", gap: 12, ...vars },
    head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    title: { fontWeight: 700, fontSize: 13 },
    sub: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 },
    gaugeCard: {
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 10, padding: "10px 12px",
      display: "flex", alignItems: "center", gap: 10,
      background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)",
    },
    gaugeLabel: { fontSize: 11.5, fontWeight: 600, lineHeight: 1.35 },
    gaugeSub: { fontSize: 10.5, color: "var(--dsh-color-muted-weak, #9ca3af)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    statCard: {
      border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 10,
      padding: "9px 12px", background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)",
    },
    statNum: { fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    statLabel: { fontSize: 10.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 1 },
    panel: { border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 10, padding: "10px 12px", background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)" },
    panelTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8 },
    warn: { fontSize: 11.5, padding: "6px 10px", borderRadius: 8, background: "rgba(245,158,11,.14)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)" },
    legend: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--dsh-color-muted, #6b7280)" },
  };

  // daily stacked bar chart geometry
  const BW = 460;
  const BH = 150;
  const barPad = Math.max(2, Math.min(5, Math.floor(BW / (daily.rows.length * 1.6))));
  const barW = daily.rows.length > 0 ? (BW - barPad * 2 * daily.rows.length) / daily.rows.length : 0;
  const maxBar = daily.max;

  return (
    <div style={hb.root}>
      <div style={hb.head}>
        <span style={hb.title}>agent 行为遥测仪表盘</span>
        <span style={hb.sub}>
          基于 /stats 真实调用累计（工作区 × 天滚动）· 20s 自动刷新{workspace === "" ? " · 全部工作区" : ` · ${workspace}`}
        </span>
        {loading && <span style={hb.sub}>…</span>}
        <button
          style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 7, cursor: "pointer", border: "1px solid var(--dsh-color-border, #d1d5db)", background: "transparent", color: "var(--dsh-color-muted-strong, #374151)" }}
          onClick={() => void refresh()}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {error && <div style={hb.warn}>⚠ {error}</div>}
      {sampleText && stats && <div style={hb.warn}>{sampleText}</div>}
      {!stats && !error && <div style={{ ...hb.sub, padding: 8 }}>加载中…</div>}
      {stats && (
        <>
          <div style={hb.grid}>
            <div style={hb.gaugeCard}>
              <EvidenceRing artifact={false} evaluation={false} refs={false} size={64} fraction={dose?.esrRatio ?? 0} labelText={pct(dose?.esrRatio)} title={`ESR 主动性（目标 ≥ 34%）`} />
              <div>
                <div style={hb.gaugeLabel}>ESR 主动性</div>
                <div style={hb.gaugeSub}>esr {dose?.esrCalls} / mem {dose?.memCalls} · 共 {dose?.calls}</div>
                <div style={{ fontSize: 10, color: (dose?.esrRatio ?? 0) >= 0.34 ? "#059669" : "#d97706", fontWeight: 700 }}>
                  {(dose?.esrRatio ?? 0) >= 0.34 ? "健康" : "偏低 → 下会话注入 escalate 提醒"}
                </div>
              </div>
            </div>
            <div style={hb.gaugeCard}>
              <EvidenceRing artifact={false} evaluation={false} refs={false} size={64} fraction={dose?.recallHitRate ?? 0} labelText={pct(dose?.recallHitRate)} />
              <div>
                <div style={hb.gaugeLabel}>召回命中率</div>
                <div style={hb.gaugeSub}>有命中的 engram_recall 占比</div>
              </div>
            </div>
            <div style={hb.gaugeCard}>
              <EvidenceRing artifact={false} evaluation={false} refs={false} size={64} fraction={dose?.detailFollowRate ?? 0} labelText={pct(dose?.detailFollowRate)} />
              <div>
                <div style={hb.gaugeLabel}>detail 转化</div>
                <div style={hb.gaugeSub}>命中召回后 8 事件内跟 engram_detail</div>
              </div>
            </div>
          </div>

          <div style={hb.grid}>
            <div style={hb.statCard}><div style={hb.statNum}>{dose?.calls ?? 0}</div><div style={hb.statLabel}>累计工具调用</div></div>
            <div style={hb.statCard}><div style={hb.statNum}>{dose?.esrCalls ?? 0}</div><div style={hb.statLabel}>esr_* 调用</div></div>
            <div style={hb.statCard}><div style={hb.statNum}>{dose?.memCalls ?? 0}</div><div style={hb.statLabel}>记忆类调用</div></div>
            <div style={hb.statCard}><div style={hb.statNum}>{dose?.recallHitsPerQuery ?? "–"}</div><div style={hb.statLabel}>平均命中/查询</div></div>
            <div style={hb.statCard}><div style={hb.statNum}>{stats.totals.failures ?? 0}</div><div style={hb.statLabel}>失败次数</div></div>
          </div>

          <div style={hb.panel}>
            <div style={hb.panelTitle}>近 14 天每日活动 · mem vs esr</div>
            {daily.rows.length === 0 ? (
              <div style={hb.sub}>还没有按天数据（工具调用会实时累计）。</div>
            ) : (
              <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`} style={{ display: "block", maxWidth: "100%" }}>
                {daily.rows.map((d, i) => {
                  const mem = MEM_TOOLS.reduce((a, k) => a + (d.counts?.[k] ?? 0), 0);
                  const esr = ESR_TOOLS.reduce((a, k) => a + (d.counts?.[k] ?? 0), 0);
                  const total = mem + esr;
                  const hi = (total / maxBar) * (BH - 22);
                  const x = i * (barW + barPad * 2) + barPad;
                  const y0 = BH - 18 - hi;
                  const esrH = total > 0 ? (esr / total) * hi : 0;
                  const memH = total > 0 ? (mem / total) * hi : 0;
                  const dayLabel = (d.day ?? "").slice(5).replace("-", "/");
                  return (
                    <g key={d.day ?? i}>
                      <rect x={x} y={y0 + memH} width={barW} height={esrH} fill={COLOR_ESR} rx={1.5}>
                        <title>{`${d.day} · mem ${mem} / esr ${esr}`}</title>
                      </rect>
                      <rect x={x} y={y0} width={barW} height={memH} fill={COLOR_MEM} rx={1.5}>
                        <title>{`${d.day} · mem ${mem} / esr ${esr}`}</title>
                      </rect>
                      <text x={x + barW / 2} y={BH - 6} fontSize={8.5} fill={dark ? "#8b93a7" : "#6b7280"} textAnchor="middle">{dayLabel}</text>
                    </g>
                  );
                })}
              </svg>
            )}
            <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
              <span style={hb.legend}><i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR_MEM, display: "inline-block" }} /> 记忆类 (engram_*/loom_*)</span>
              <span style={hb.legend}><i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR_ESR, display: "inline-block" }} /> ESR (esr_*)</span>
            </div>
          </div>

          <div style={hb.panel}>
            <div style={hb.panelTitle}>工具调用分布（Top 8）</div>
            {toolRows.length === 0 ? (
              <div style={hb.sub}>还没有工具调用记录。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {toolRows.map((r) => {
                  const max = toolRows[0].count;
                  const w = Math.max(4, Math.round((r.count / max) * 320));
                  const c = r.esc === "esr" ? COLOR_ESR : r.esc === "mem" ? COLOR_MEM : COLOR_MUTED;
                  return (
                    <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 120, fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted-strong, #374151)", flex: "0 0 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                      <div style={{ flex: "1 1 auto", height: 10, borderRadius: 5, background: dark ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.22)" }}>
                        <div style={{ width: w, height: 10, borderRadius: 5, background: c }} />
                      </div>
                      <span style={{ fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", width: 34, textAlign: "right" }}>×{r.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
