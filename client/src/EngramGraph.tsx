/**
 * EngramGraph — a force-directed relation graph drawn in hand-rolled SVG.
 *
 * No chart library (bundle-purity gate: only react may be a value import), so
 * the layout is a small O(n²) repulsion + spring simulation run on refs, with
 * React only re-rendering the SVG each animation frame. Supports:
 *   - node drag (pointer), background pan, wheel/button zoom, "重组" re-layout;
 *   - hover highlighting (dim non-neighbours), click-to-select detail panel;
 *   - entities as circles, tasks as rounded check badges, relation coloring,
 *     arrow markers for direction;
 *   - insets/labels inside a fixed logical 640×420 viewBox.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";

export type GraphEntity = {
  id: string;
  name: string;
  kind?: string;
  description?: string;
  workspace: string;
};
export type GraphTask = {
  id: string;
  name: string;
  description?: string;
  workspace: string;
  state: string;
};
export type GraphLink = {
  id: string;
  source: string;
  relation: string;
  target: string;
  confidence?: number;
  workspace: string;
};

type Pos = { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null };
type GNode = {
  id: string;
  name: string;
  kind: string;
  description?: string;
  kindType: "entity" | "task";
  state: string;
  degree: number;
};

const W = 640;
const H = 420;

const REL_LABEL: Record<string, string> = {
  depends_on: "依赖",
  implements: "实现",
  refines: "细化",
  contradicts: "矛盾",
  tracks: "追踪",
  relates_to: "关联",
};

const REL_COLOR: Record<string, string> = {
  depends_on: "#f59e0b",
  implements: "#10b981",
  refines: "#38bdf8",
  contradicts: "#ef4444",
  tracks: "#8b5cf6",
  relates_to: "#64748b",
};
const REL_DEFAULT = "#94a3b8";

const KIND_COLOR: Record<string, string> = {
  package: "#6366f1",
  service: "#0ea5e9",
  repo: "#10b981",
  doc: "#f59e0b",
  person: "#ec4899",
  bug: "#ef4444",
  module: "#14b8a6",
  concept: "#8b5cf6",
};
const NODE_DEFAULT = "#6366f1";
const TASK_COLOR = "#0f766e";

/** Relation color with a readable fallback. */
function relColor(relation: string): string {
  return REL_COLOR[relation] ?? REL_DEFAULT;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function simulate(pos: Map<string, Pos>, edges: Array<[string, string]>): number {
  const arr = [...pos.values()];
  // Repulsion — all pairs.
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i];
      const b = arr[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2) || 1;
      const f = 9000 / (d2 + 1);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  // Springs along edges.
  for (const [s, t] of edges) {
    const a = pos.get(s);
    const b = pos.get(t);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - 100) * 0.045;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }
  // Gravity + integration; fixed (dragged) nodes are pinned.
  let maxSpeed = 0;
  for (const p of arr) {
    if (p.fx !== null && p.fy !== null) {
      p.x = p.fx;
      p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    p.vx += (W / 2 - p.x) * 0.004;
    p.vy += (H / 2 - p.y) * 0.004;
    p.vx *= 0.85;
    p.vy *= 0.85;
    if (p.vx > 2.5) p.vx = 2.5;
    else if (p.vx < -2.5) p.vx = -2.5;
    if (p.vy > 2.5) p.vy = 2.5;
    else if (p.vy < -2.5) p.vy = -2.5;
    p.x += p.vx;
    p.y += p.vy;
    p.x = Math.max(15, Math.min(W - 15, p.x));
    p.y = Math.max(15, Math.min(H - 15, p.y));
    maxSpeed = Math.max(maxSpeed, Math.abs(p.vx), Math.abs(p.vy));
  }
  return maxSpeed;
}

export interface EngramGraphProps {
  workspace: string;
  entities: GraphEntity[];
  tasks: GraphTask[];
  links: GraphLink[];
  nameOf: (id: string) => string;
}

export function EngramGraph({ workspace, entities, tasks, links, nameOf }: EngramGraphProps) {
  const uid = useMemo(() => `eg${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`, []);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // --- filter to the active workspace (empty = all) ---
  const graph = useMemo(() => {
    const keep = (ws: string) => workspace === "" || ws === workspace;
    const entitiesF = entities.filter((e) => keep(e.workspace));
    const tasksF = tasks.filter((t) => keep(t.workspace));
    const linksF = links.filter((l) => keep(l.workspace));

    const nodesRaw: GNode[] = [
      ...entitiesF.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind ?? "entity",
        description: e.description,
        kindType: "entity" as const,
        state: "",
        degree: 0,
      })),
      ...tasksF.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.state,
        description: t.description,
        kindType: "task" as const,
        state: t.state,
        degree: 0,
      })),
    ];
    const byId = new Map(nodesRaw.map((n) => [n.id, n]));
    const edges: Array<[string, string]> = [];
    const keptLinks: GraphLink[] = [];
    let dangling = 0;
    for (const l of linksF) {
      if (byId.has(l.source) && byId.has(l.target)) {
        edges.push([l.source, l.target]);
        keptLinks.push(l);
      } else {
        dangling++;
      }
    }
    for (const [s, t] of edges) {
      byId.get(s)!.degree++;
      byId.get(t)!.degree++;
    }
    // Hubs (higher degree) start closer to the center.
    const nodes = [...byId.values()].sort((a, b) => b.degree - a.degree);
    return { nodes, edges, keptLinks, dangling };
  }, [workspace, entities, tasks, links]);

  // --- physical positions (mutated by the sim, rendered via `tick`) ---
  const posRef = useRef<Map<string, Pos>>(new Map());
  const [, setTick] = useState(0);
  const dragging = useRef<{ id: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [simRound, setSimRound] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  // (Re)seed positions + restart the sim whenever the graph changes.
  const graphKey = useMemo(
    () => graph.nodes.map((n) => n.id).join(",") + "|" + graph.edges.map(([s, t]) => `${s}>${t}`).join(","),
    [graph],
  );

  useEffect(() => {
    const pos = new Map<string, Pos>();
    const n = graph.nodes.length;
    graph.nodes.forEach((node, i) => {
      // Ring layout by degree (sorted desc): hubs toward the centroid.
      const ang = n > 1 ? (i / n) * Math.PI * 2 : 0;
      const ring = 190 - (i / Math.max(1, n)) * 120;
      pos.set(node.id, {
        x: W / 2 + Math.cos(ang) * ring,
        y: H / 2 + Math.sin(ang) * ring * 0.8,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      });
    });
    posRef.current = pos;
    setSelected(null);
    setHover(null);
    setView({ x: 0, y: 0, k: 1 });
  }, [graphKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Force loop — restarts whenever the graph or a manual re-layout round changes.
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      simulate(posRef.current, graph.edges);
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [graphKey, simRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Non-passive wheel listener so zoom can preventDefault cleanly.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        return { ...v, k: Math.max(0.35, Math.min(3, v.k * factor)) };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // --- pointer mapping: client -> graph coords (respect pan/zoom) ---
  const toGraph = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * W;
    const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const nodeEl = (e.target as Element).closest?.("[data-node-id]") as Element | null;
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id")!;
      dragging.current = { id };
      const g = toGraph(e.clientX, e.clientY);
      const p = posRef.current.get(id);
      if (p) {
        p.fx = g.x;
        p.fy = g.y;
      }
      setSelected(id);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.stopPropagation();
      return;
    }
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (dragging.current) {
      const g = toGraph(e.clientX, e.clientY);
      const p = posRef.current.get(dragging.current.id);
      if (p) {
        p.fx = g.x;
        p.fy = g.y;
      }
      return;
    }
    if (pan.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - pan.current.sx) / Math.max(1, rect.width) * W;
      const dy = (e.clientY - pan.current.sy) / Math.max(1, rect.height) * H;
      setView({ x: pan.current.vx + dx, y: pan.current.vy + dy, k: view.k });
    }
  };

  const endPointer = (e: RPointerEvent<SVGSVGElement>) => {
    if (dragging.current) {
      const p = posRef.current.get(dragging.current.id);
      if (p) {
        p.fx = null;
        p.fy = null;
      }
      dragging.current = null;
    }
    pan.current = null;
  };

  const reLayout = () => {
    setSimRound((r) => r + 1);
    for (const p of posRef.current.values()) {
      p.x = W / 2 + (Math.random() - 0.5) * 320;
      p.y = H / 2 + (Math.random() - 0.5) * 220;
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = (Math.random() - 0.5) * 2;
    }
  };

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [s, t] of graph.edges) {
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [graph.edges]);

  const focusSet = useMemo(() => {
    if (hover !== null) {
      const s = new Set<string>([hover]);
      (neighbors.get(hover) ?? new Set()).forEach((x) => s.add(x));
      return s;
    }
    if (selected !== null) {
      const s = new Set<string>([selected]);
      (neighbors.get(selected) ?? new Set()).forEach((x) => s.add(x));
      return s;
    }
    return null;
  }, [hover, selected, neighbors]);

  const selNode = selected ? byId.get(selected) : null;
  const selEdges = useMemo(
    () => (selected ? graph.keptLinks.filter((l) => l.source === selected || l.target === selected) : []),
    [selected, graph.keptLinks],
  );
  const incidentKinds = new Set<string>();
  for (const rel of graph.keptLinks) incidentKinds.add(rel.relation);

  const zoom = (factor: number) => setView((v) => ({ ...v, k: Math.max(0.35, Math.min(3, v.k * factor)) }));

  if (graph.nodes.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", padding: "8px 0" }}>
        暂无节点/关系可绘制 — 模型用 esr_node / esr_link 登记领域对象并互连后，这里会出现力导向关系图。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span style={{ ...s.chip }}>{graph.nodes.length} 节点</span>
        <span style={{ ...s.chip }}>{graph.keptLinks.length} 关系</span>
        {graph.dangling > 0 && <span style={{ ...s.chipWarn }}>{graph.dangling} 悬空链接（端点缺失，未绘制）</span>}
        <span style={{ flex: "1 1 auto" }} />
        <span style={s.hint}>拖拽节点 · 滚轮缩放 · 空白处拖拽可平移</span>
        <button type="button" style={s.btn} onClick={() => zoom(1.2)}>＋</button>
        <button type="button" style={s.btn} onClick={() => zoom(1 / 1.2)}>－</button>
        <button type="button" style={s.btn} onClick={reLayout}>重组</button>
      </div>

      <div style={{ position: "relative", border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 12, overflow: "hidden", background: "var(--dsh-color-surface, #fff)" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", width: "100%", height: 380, cursor: pan.current ? "grabbing" : "grab", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerLeave={endPointer}
          onDoubleClick={reLayout}
        >
          <defs>
            <marker id={`${uid}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill={REL_DEFAULT} />
            </marker>
          </defs>
          <rect x={0} y={0} width={W} height={H} fill="transparent" />
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {graph.keptLinks.map((l) => {
              const a = posRef.current.get(l.source);
              const b = posRef.current.get(l.target);
              if (!a || !b) return null;
              const activeEdge = hoverEdge === l.id || (selected !== null && (l.source === selected || l.target === selected)) || (hover !== null && (l.source === hover || l.target === hover));
              const faded = focusSet !== null && !activeEdge && !(focusSet.has(l.source) && focusSet.has(l.target));
              const color = relColor(l.relation);
              return (
                <g key={l.id} data-edge-id={l.id} onPointerEnter={() => setHoverEdge(l.id)} onPointerLeave={() => setHoverEdge(null)}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={color}
                    strokeWidth={activeEdge ? 2.2 : 1.1}
                    strokeOpacity={faded ? 0.12 : activeEdge ? 0.95 : 0.55}
                    markerEnd={`url(#${uid}-arrow)`}
                  />
                  {(activeEdge || hoverEdge === l.id) && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} fontSize={9.5} fill={color} textAnchor="middle" style={{ pointerEvents: "none" }}>
                      {REL_LABEL[l.relation] ?? l.relation}
                    </text>
                  )}
                </g>
              );
            })}

            {graph.nodes.map((node) => {
              const p = posRef.current.get(node.id);
              if (!p) return null;
              const isHover = hover === node.id;
              const isSel = selected === node.id;
              const faded = focusSet !== null && !focusSet.has(node.id);
              const color = node.kindType === "task" ? TASK_COLOR : KIND_COLOR[node.kind] ?? NODE_DEFAULT;
              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={faded ? 0.18 : 1}
                  onPointerEnter={() => setHover(node.id)}
                  onPointerLeave={() => setHover(null)}
                  style={{ cursor: "grab" }}
                >
                  {node.kindType === "entity" ? (
                    <>
                      <circle r={10} fill={color} fillOpacity={isSel ? 1 : 0.9} stroke={isSel || isHover ? "#0f172a" : color} strokeWidth={isSel ? 2.5 : 1} />
                      <circle r={10} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={5} />
                    </>
                  ) : (
                    <>
                      <rect x={-11} y={-9} width={22} height={18} rx={6} fill={color} stroke={isSel ? "#0f172a" : "transparent"} strokeWidth={isSel ? 2.2 : 0} />
                      <path d="M-5.5 -1.5 l3.4 3.4 l6.5 -6.5" stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                  <text y={18} textAnchor="middle" fontSize={10} fill="var(--dsh-color-muted-strong, #334155)" style={{ pointerEvents: "none", fontWeight: isHover || isSel ? 700 : 500 }}>
                    {truncate(nameOf(node.id), 12)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {selNode && (
          <div style={s.infoPanel}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...s.badge, background: selNode.kindType === "task" ? TASK_COLOR : KIND_COLOR[selNode.kind] ?? NODE_DEFAULT }}>
                {selNode.kindType === "task" ? selNode.state : selNode.kind}
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1, overflowWrap: "anywhere" }}>{selNode.name}</span>
              <button type="button" style={s.closeBtn} onClick={() => setSelected(null)} aria-label="关闭">✕</button>
            </div>
            {selNode.description && <div style={{ fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }}>{selNode.description}</div>}
            <div style={{ ...s.mono, marginTop: 4, fontSize: 11 }}>{selNode.id}</div>
            <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 2 }}>
              {selNode.degree} 条关联 · {selEdges.length} 条关系
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {selEdges.length === 0 && <div style={{ fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>暂无关系</div>}
              {selEdges.slice(0, 8).map((l) => {
                const out = l.source === selNode.id;
                const other = out ? l.target : l.source;
                return (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                    <span style={{ ...s.relChip, color: relColor(l.relation), borderColor: relColor(l.relation) }}>
                      {REL_LABEL[l.relation] ?? l.relation}
                    </span>
                    <span style={{ color: "var(--dsh-color-muted, #6b7280)" }}>{out ? "→" : "←"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{nameOf(other)}</span>
                  </div>
                );
              })}
              {selEdges.length > 8 && <div style={{ fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>+{selEdges.length - 8} 条更多…</div>}
            </div>
          </div>
        )}
      </div>

      {incidentKinds.size > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" }}>图例：</span>
          {[...incidentKinds].sort().map((rel) => (
            <span key={rel} style={{ ...s.relChip, color: relColor(rel), borderColor: relColor(rel) }}>
              {REL_LABEL[rel] ?? rel}
            </span>
          ))}
          <span style={{ marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" }}>
            <circle r={5} fill={TASK_COLOR} /> 任务
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" }}>
            <circle r={5} fill={NODE_DEFAULT} /> 实体
          </span>
        </div>
      )}
    </div>
  );
}

const s = {
  chip: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "2px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    background: "rgba(99,102,241,.10)",
    color: "var(--dsh-color-primary, #4338ca)",
  },
  chipWarn: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "2px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    background: "#fef3c7",
    color: "#b45309",
  },
  hint: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" },
  btn: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 8,
    padding: "3px 9px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)",
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "var(--dsh-color-muted, #6b7280)",
    fontSize: 12,
    padding: 0,
  },
  badge: {
    borderRadius: 6,
    padding: "1px 7px",
    fontSize: 10.5,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.02em",
  },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)" },
  relChip: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px dashed",
    borderRadius: 999,
    padding: "1px 7px",
    fontSize: 10.5,
    fontWeight: 600,
    background: "transparent",
  },
  infoPanel: {
    position: "absolute" as const,
    top: 10,
    right: 10,
    width: 250,
    maxHeight: 300,
    overflow: "auto",
    borderRadius: 12,
    padding: 10,
    background: "var(--dsh-color-surface, #ffffff)",
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    boxShadow: "0 4px 16px rgba(15,23,42,.12)",
  },
};
