window.__ModuleLoader__.load({
	id: "dsh-engram",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/src/entry.tsx
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  en: () => en,
  inject: () => inject,
  zh: () => zh
});
module.exports = __toCommonJS(entry_exports);

// client/src/api.ts
var API_PREFIX = "/api/dsh-engram";
var EngramApiError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "EngramApiError";
  }
};
async function readJson(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new EngramApiError(`HTTP ${response.status}: invalid JSON response`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new EngramApiError(message);
  }
  return body;
}
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== void 0 && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}
var EngramApi = class {
  async overview() {
    return readJson(await fetch(`${API_PREFIX}/overview`));
  }
  async memories(opts = {}) {
    return readJson(
      await fetch(`${API_PREFIX}/memories${query({ workspace: opts.workspace, q: opts.q, kind: opts.kind, status: opts.status, limit: opts.limit })}`)
    );
  }
  async tasks(workspace, includeStable = false) {
    return readJson(await fetch(`${API_PREFIX}/tasks${query({ workspace, includeStable: includeStable ? "1" : void 0 })}`));
  }
  async createTask(workspace, name, description = "") {
    return readJson(
      await fetch(`${API_PREFIX}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace, name, description })
      })
    );
  }
  async closeTask(workspace, id, evidence) {
    return readJson(
      await fetch(`${API_PREFIX}/tasks/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          id,
          artifact: evidence.artifact ?? "",
          evaluation: evidence.evaluation ?? "",
          memory_refs: evidence.memoryRefs ?? []
        })
      })
    );
  }
  async links(workspace) {
    return readJson(await fetch(`${API_PREFIX}/links${query({ workspace })}`));
  }
  async nodes(workspace) {
    return readJson(await fetch(`${API_PREFIX}/nodes${query({ workspace })}`));
  }
  async stats(workspace) {
    return readJson(await fetch(`${API_PREFIX}/stats${query({ workspace })}`));
  }
  async config() {
    return readJson(await fetch(`${API_PREFIX}/config`));
  }
  async preview(workspace) {
    return readJson(await fetch(`${API_PREFIX}/preview${query({ workspace })}`));
  }
  async archive(id, workspace) {
    await readJson(
      await fetch(`${API_PREFIX}/memories/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace })
      })
    );
  }
  async remove(id, workspace) {
    await readJson(
      await fetch(`${API_PREFIX}/memories/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace })
      })
    );
  }
  async gc(workspace, dryRun) {
    return readJson(
      await fetch(`${API_PREFIX}/gc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...workspace ? { workspace } : {},
          dryRun
        })
      })
    );
  }
};

// client/src/EngramTaskDock.tsx
var import_react2 = require("react");

// client/src/theme.ts
var import_react = require("react");
var LIGHT = {
  text: "#111827",
  surface: "#ffffff",
  border: "#e5e7eb",
  muted: "#6b7280",
  mutedStrong: "#4b5563",
  mutedWeak: "#9ca3af",
  hoverBg: "#f3f4f6",
  primary: "#2563eb"
};
var DARK = {
  text: "#e6e9ef",
  surface: "#1c222b",
  border: "#37404e",
  muted: "#9aa4b5",
  mutedStrong: "#c9d0dc",
  mutedWeak: "#7d8796",
  hoverBg: "rgba(255,255,255,0.07)",
  primary: "#5b8cff"
};
function detectDark() {
  if (typeof window === "undefined") return false;
  const cs = getComputedStyle(document.documentElement).colorScheme;
  if (cs === "dark") return true;
  if (cs === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function useEngramTheme() {
  const [dark, setDark] = (0, import_react.useState)(detectDark);
  (0, import_react.useEffect)(() => {
    const apply2 = () => setDark(detectDark());
    const mo = new MutationObserver(apply2);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"]
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", apply2);
    apply2();
    return () => {
      mo.disconnect();
      mq.removeEventListener?.("change", apply2);
    };
  }, []);
  const p = dark ? DARK : LIGHT;
  const vars = {
    color: p.text,
    "--dsh-color-surface": p.surface,
    "--dsh-color-border": p.border,
    "--dsh-color-muted": p.muted,
    "--dsh-color-muted-strong": p.mutedStrong,
    "--dsh-color-muted-weak": p.mutedWeak,
    "--dsh-color-hover-bg": p.hoverBg,
    "--dsh-color-primary": p.primary
  };
  return { dark, vars };
}

// client/src/EngramTaskDock.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var EMPTY = { tasks: [], links: [], nodes: [], denied: false, error: null, loading: true };
function normalizeWs(cwd) {
  if (!cwd) return "";
  return cwd.replace(/[\\/]+$/, "") || cwd;
}
function shortIdS(id) {
  const bare = id.replace(/[^a-z0-9]/gi, "");
  return (bare.length >= 8 ? bare.slice(0, 8) : id.slice(0, 8)) || "?";
}
function fmtD(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
var taskGaps = (t) => {
  const gaps = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
};
var STATUS = {
  gap: { bg: "var(--dsw-alias-state-warn-secondary, rgba(245,158,11,.14))", fg: "var(--dsw-alias-state-warn-label, #b45309)" },
  ready: { bg: "rgba(59,130,246,.13)", fg: "var(--dsw-alias-label-primary-bluish, #1d4ed8)" },
  stable: { bg: "rgba(16,185,129,.14)", fg: "var(--dsw-alias-state-success-primary, #047857)" }
};
function IconChecklist({ size = 14 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "2.5", stroke: "currentColor", strokeWidth: "1.3" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.2 8.1l1.8 1.8 3.8-4", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
function IconChevron({ down }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      style: { transform: down ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .18s ease" },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 6l4 4 4-4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" })
    }
  );
}
function IconPlus({ size = 13 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3.2v9.6M3.2 8h9.6", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }) });
}
function IconRefresh({ size = 13 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.2 5.2A5.4 5.4 0 1 0 13.4 10", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13.2 2.6v2.6h-2.6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" })
  ] });
}
function IconLink({ size = 13 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.8 9.2c1 1 2.6 1 3.6 0l2.3-2.3a2.55 2.55 0 0 0-3.6-3.6L8.3 4.1", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M9.2 6.8c-1-1-2.6-1-3.6 0L3.3 9.1a2.55 2.55 0 0 0 3.6 3.6l1.2-1.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })
  ] });
}
function IconArrow({ size = 12 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.6 8h10.4M9.6 4.8L13 8l-3.4 3.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function PlanGlyph({ status }) {
  if (status === "completed") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { color: "var(--dsw-alias-state-success-primary, #059669)", flex: "none" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "7", cy: "7", r: "6.4", stroke: "currentColor", strokeWidth: "1.2" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.96 5.71L7.7 8.98c-.22.22-.42.42-.6.57-.2.16-.43.3-.73.35a1.5 1.5 0 0 1-.74 0c-.3-.05-.53-.2-.73-.35a7 7 0 0 1-.6-.57L3.04 7.46l.93-.93 1.51 1.51 4.55-4.55.93.92z", fill: "currentColor" })
    ] });
  }
  if (status === "in_progress") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { color: "var(--dsw-alias-label-primary-bluish, #3b82f6)", flex: "none" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "7", cy: "7", r: "6.4", stroke: "currentColor", strokeWidth: "1.2", opacity: ".45" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7 3v4l2.6 1.6", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { color: "var(--dsw-alias-label-tertiary, #9ca3af)", flex: "none" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "7", cy: "7", r: "6.4", stroke: "currentColor", strokeWidth: "1.2", strokeDasharray: "2.4 2.4" }) });
}
var DOCK_STYLE_ID = "engram-dock-styles";
function ensureDockStyles() {
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
function EngramTaskDock({ sessionId, useSessions, useWorkspaces, useProjection, api }) {
  ensureDockStyles();
  const { vars } = useEngramTheme();
  const [collapsed, setCollapsed] = (0, import_react2.useState)(true);
  const [data, setData] = (0, import_react2.useState)(EMPTY);
  const [creating, setCreating] = (0, import_react2.useState)(false);
  const [newName, setNewName] = (0, import_react2.useState)("");
  const [newDesc, setNewDesc] = (0, import_react2.useState)("");
  const [closingFor, setClosingFor] = (0, import_react2.useState)(null);
  const [closeArtifact, setCloseArtifact] = (0, import_react2.useState)("");
  const [closeEval, setCloseEval] = (0, import_react2.useState)("");
  const [closeRefs, setCloseRefs] = (0, import_react2.useState)("");
  const [actionBusy, setActionBusy] = (0, import_react2.useState)(false);
  const [touched, setTouched] = (0, import_react2.useState)(false);
  const pollRef = (0, import_react2.useRef)(null);
  const sessionsState = useSessions?.call ? useSessions((s4) => s4) : void 0;
  const workspacesState = useWorkspaces?.call ? useWorkspaces((s4) => s4) : void 0;
  const planRaw = useProjection ? useProjection("todos") : void 0;
  const planItems = (0, import_react2.useMemo)(() => {
    if (!Array.isArray(planRaw)) return [];
    return planRaw.filter(
      (x) => typeof x === "object" && x !== null && typeof x.content === "string"
    );
  }, [planRaw]);
  const cwd = (0, import_react2.useMemo)(() => {
    if (!sessionId) return "";
    const fromSession = sessionsState?.byId?.[sessionId]?.cwd;
    if (fromSession) return normalizeWs(fromSession);
    const ws = workspacesState?.items?.find((w) => w.sessionIds.includes(sessionId));
    return ws ? normalizeWs(ws.path) : "";
  }, [sessionId, sessionsState, workspacesState]);
  const load = (0, import_react2.useCallback)(async () => {
    if (!cwd) {
      setData({ ...EMPTY, loading: false });
      setTouched(true);
      return;
    }
    setData((prev) => ({ ...prev, loading: true }));
    try {
      const [tasks, links, nodes] = await Promise.all([
        api.tasks(cwd, true),
        api.links(cwd),
        api.nodes(cwd)
      ]);
      setData({ tasks: tasks.items, links: links.items, nodes: nodes.items, denied: false, error: null, loading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const denied = /403|loopback/i.test(message);
      setData((prev) => ({ ...prev, denied, error: message, loading: false }));
    } finally {
      setTouched(true);
    }
  }, [cwd, api]);
  (0, import_react2.useEffect)(() => {
    setTouched(false);
    void load();
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [load]);
  (0, import_react2.useEffect)(() => {
    if (!cwd || data.denied) return;
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => void load(), 15e3);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [cwd, data.denied, load]);
  const activeTasks = (0, import_react2.useMemo)(() => data.tasks.filter((t) => t.state !== "stable"), [data.tasks]);
  const readyTasks = activeTasks.filter((t) => taskGaps(t).length === 0);
  const gappedTasks = activeTasks.filter((t) => taskGaps(t).length > 0);
  const stableCount = data.tasks.length - activeTasks.length;
  const nameOf = (0, import_react2.useMemo)(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of data.nodes) map.set(n.id, n.name);
    for (const t of data.tasks) map.set(t.id, t.name);
    return (id) => map.get(id) ?? id;
  }, [data.nodes, data.tasks]);
  const planVisible = planItems.length > 0;
  const esrVisible = touched && !data.loading && !data.denied && (activeTasks.length > 0 || data.links.length > 0);
  if (!cwd || !planVisible && !esrVisible) return null;
  const refreshNow = () => void load();
  const toggle = () => setCollapsed((v) => !v);
  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setActionBusy(true);
    try {
      await api.createTask(cwd, name, newDesc);
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
  const submitClose = async (task) => {
    setActionBusy(true);
    setData((prev) => ({ ...prev, error: null }));
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const out = await api.closeTask(task.workspace, task.id, {
        artifact: closeArtifact,
        evaluation: closeEval,
        memoryRefs: refs
      });
      if (out.state === "active") {
        setData((prev) => ({
          ...prev,
          error: `\u8BC1\u636E\u4ECD\u6709\u7F3A\u53E3\uFF1A${(out.gaps ?? []).join(", ")} \u2014 \u4EFB\u52A1\u4FDD\u6301 ACTIVE`
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-engram-dock": true,
      style: {
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
        ...vars
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            "aria-hidden": true,
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: "linear-gradient(180deg, var(--ed-accent-a) 0%, var(--ed-accent-b) 55%, var(--ed-accent-c) 100%)"
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "ed-header",
            onClick: toggle,
            "aria-expanded": !collapsed,
            style: {
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
              font: "inherit"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "span",
                {
                  style: {
                    display: "grid",
                    flex: "none",
                    placeItems: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
                    background: "var(--dsw-alias-state-business-tertiary, rgba(99,102,241,.12))"
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChecklist, {})
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { flex: "none", fontSize: 13, fontWeight: 600, lineHeight: "20px", color: "var(--dsw-alias-label-primary, inherit)", display: "inline-flex", alignItems: "center", gap: 5 }, children: [
                "\u4EFB\u52A1",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...chip, ...chipNeutral, fontSize: 9.5, padding: "0 6px", lineHeight: "15px", fontWeight: 700, letterSpacing: ".02em" }, children: "ESR" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "none", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }, children: wsBasename }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "span",
                {
                  style: {
                    flex: "1 1 auto",
                    minWidth: 0,
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                    flexWrap: "wrap"
                  },
                  children: [
                    planItems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...chipNeutral }, children: [
                      "\u672C\u8F6E\u8BA1\u5212 ",
                      planItems.length
                    ] }),
                    gappedTasks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...STATUS.gap }, children: [
                      "\u8FDB\u884C\u4E2D ",
                      gappedTasks.length
                    ] }),
                    readyTasks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...STATUS.ready }, children: [
                      "\u5C31\u7EEA ",
                      readyTasks.length
                    ] }),
                    stableCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...STATUS.stable }, children: [
                      "\u5DF2\u95ED\u73AF ",
                      stableCount
                    ] }),
                    data.links.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...chipNeutral }, children: [
                      "\u5173\u7CFB ",
                      data.links.length
                    ] }),
                    data.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...chip, ...chipError }, title: data.error, children: "API \u5931\u8D25" })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { display: "grid", placeItems: "center", flex: "none", color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { down: !collapsed }) })
            ]
          }
        ),
        !collapsed && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ed-anim", style: { padding: "2px 12px 12px 15px", display: "flex", flexDirection: "column", gap: 8 }, children: [
          data.error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, color: "#dc2626", lineHeight: 1.4 }, role: "alert", children: [
            "\u26A0 ",
            data.error
          ] }),
          data.denied && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", lineHeight: 1.5 }, children: "ESR \u5DE5\u4F5C\u533A\u6570\u636E\u4E0D\u53EF\u8FBE\uFF08loopback-only \u5B88\u536B\uFF09\u2014 \u672C\u8F6E\u8BA1\u5212\u7167\u5E38\u5C55\u793A\uFF1B\u5B8C\u6574\u4EFB\u52A1\u4E0E\u5173\u7CFB\u89C1 \u8BBE\u7F6E \u2192 Engram \u8BB0\u5FC6\u3002" }),
          planItems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: planBox, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }, children: "\u672C\u8F6E\u8BA1\u5212\uFF08todo_write\uFF09" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }, children: [
                planItems.filter((p) => p.status === "completed").length,
                "/",
                planItems.length,
                " \u5B8C\u6210 \xB7 \u8DDF\u968F\u4F1A\u8BDD\u81EA\u52A8\u66F4\u65B0"
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }, children: planItems.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: "20px", color: item.status === "completed" ? "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" : "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { marginTop: 3 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlanGlyph, { status: item.status }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { textDecoration: item.status === "completed" ? "line-through" : "none", overflowWrap: "anywhere" }, children: item.content })
            ] }, `${item.content}-${i}`)) })
          ] }),
          !data.denied && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }, children: [
                "\u5DE5\u4F5C\u533A ESR \u4EFB\u52A1 \xB7 ",
                activeTasks.length,
                " \u8FDB\u884C\u4E2D"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: "1 1 auto" } }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "button",
                {
                  type: "button",
                  className: "ed-btn",
                  style: { ...btn },
                  onClick: () => {
                    setCreating((v) => !v);
                    setClosingFor(null);
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconPlus, {}),
                    " \u65B0\u5EFA"
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "ed-btn", style: { ...btn }, onClick: refreshNow, disabled: data.loading, title: "\u5237\u65B0", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconRefresh, {}),
                " ",
                data.loading ? "\u2026" : "\u5237\u65B0"
              ] })
            ] }),
            creating && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { border: "1px dashed var(--dsw-alias-border-l3, #c7d2fe)", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 6, background: "var(--dsw-alias-bg-multi-select, transparent)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  autoFocus: true,
                  style: input,
                  placeholder: "\u4EFB\u52A1\u540D\u2026",
                  value: newName,
                  onChange: (e) => setNewName(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter") void submitCreate();
                    if (e.key === "Escape") setCreating(false);
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  style: { ...input, fontSize: 12 },
                  placeholder: "\u8981\u4EA7\u51FA / \u6EE1\u8DB3\u4EC0\u4E48\uFF08\u53EF\u9009\uFF09",
                  value: newDesc,
                  onChange: (e) => setNewDesc(e.target.value)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ed-btn", style: { ...btn, ...btnSolid }, disabled: actionBusy || !newName.trim(), onClick: () => void submitCreate(), children: actionBusy ? "\u2026" : "\u521B\u5EFA" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ed-btn", style: btn, onClick: () => setCreating(false), children: "\u53D6\u6D88" })
              ] })
            ] }),
            activeTasks.length === 0 && data.tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", padding: "2px 0" }, children: "\u6682\u65E0\u6D3B\u52A8\u4EFB\u52A1 \u2014 \u70B9\u300C\u65B0\u5EFA\u300D\u6216\u5728\u5BF9\u8BDD\u4E2D\u8BA9 agent \u7528 esr_task \u5EFA\u4EFB\u52A1" }),
            data.tasks.map((task) => {
              const gaps = taskGaps(task);
              const isStable = task.state === "stable";
              const statusColor = isStable ? STATUS.stable : gaps.length === 0 ? STATUS.ready : STATUS.gap;
              const label = isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE";
              const open = closingFor === task.id;
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ed-task", style: taskCard, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, style: { width: 3, borderRadius: 2, alignSelf: "stretch", background: statusColor.fg } }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { flex: "1 1 200px", minWidth: 0, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary, inherit)", overflowWrap: "anywhere" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }, children: [
                        shortIdS(task.id),
                        " "
                      ] }),
                      task.name
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...chip, ...statusColor, fontWeight: 700 }, children: label }),
                    !isStable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: "ed-btn",
                        style: { ...btn, padding: "3px 8px", fontSize: 11.5 },
                        onClick: () => {
                          setClosingFor(open ? null : task.id);
                          setCreating(false);
                        },
                        children: open ? "\u6536\u8D77" : "\u8865\u9F50\u8BC1\u636E"
                      }
                    )
                  ] }),
                  task.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }, children: task.description }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }, children: [
                    gaps.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...chipGap }, title: "\u8BC1\u636E\u7F3A\u53E3", children: [
                      g,
                      " \u2717"
                    ] }, g)),
                    task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { ...chip, ...chipRef }, title: `memory_ref ${r}`, children: [
                      "#",
                      r.slice(0, 8)
                    ] }, r)),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }, children: fmtD(task.createdAt) })
                  ] }),
                  open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { border: "1px dashed var(--dsw-alias-border-l2, #e5e7eb)", borderRadius: 8, padding: 7, display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }, children: "\u63D0\u4F9B\u4E09\u9879\u8BC1\u636E\u540E\u8F6C STABLE\uFF08artifact \xB7 evaluation \xB7 memory_ref\uFF09" }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "auto", flex: "1 1 130px" }, placeholder: "artifact \u8DEF\u5F84/URL", value: closeArtifact, onChange: (e) => setCloseArtifact(e.target.value) }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "auto", flex: "1 1 130px" }, placeholder: "evaluation \u8BC1\u636E", value: closeEval, onChange: (e) => setCloseEval(e.target.value) }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "auto", flex: "1 1 130px" }, placeholder: "memory_refs \u9017\u53F7\u5206\u9694", value: closeRefs, onChange: (e) => setCloseRefs(e.target.value) }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "ed-btn", style: { ...btn, ...btnSolid }, disabled: actionBusy, onClick: () => void submitClose(task), children: actionBusy ? "\u2026" : "\u63D0\u4EA4\u5173\u95ED" })
                    ] })
                  ] })
                ] })
              ] }, task.id);
            }),
            data.links.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 2 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))" }, children: [
                  "\u5173\u7CFB \xB7 ",
                  data.links.length
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", display: "inline-flex", alignItems: "center", gap: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconLink, {}),
                  " esr_node / esr_link \u5EFA\u6A21"
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 5 }, children: [
                data.links.slice(0, 8).map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...nodePill }, title: l.source, children: nameOf(l.source) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 3, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))", fontSize: 11 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { border: "1px dashed var(--dsw-alias-border-l3, #cbd5e1)", borderRadius: 999, padding: "1px 7px", color: "var(--dsw-alias-label-secondary, #64748b)" }, children: l.relation }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconArrow, {})
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...nodePill }, title: l.target, children: nameOf(l.target) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 10.5, color: "var(--dsw-alias-label-dimmed, var(--dsh-color-muted-weak, #9ca3af))" }, children: [
                    "\xB7 ",
                    fmtD(l.createdAt)
                  ] })
                ] }, l.id)),
                data.links.length > 8 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))" }, children: [
                  "+",
                  data.links.length - 8,
                  " \u6761\u66F4\u591A \u2014 \u5B8C\u6574\u5173\u7CFB\u89C1 \u8BBE\u7F6E \u2192 \u8BBE\u7F6E \xB7 Engram \u8BB0\u5FC6"
                ] })
              ] })
            ] })
          ] })
        ] })
      ]
    }
  );
}
var chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  borderRadius: 999,
  padding: "1px 8px",
  fontSize: 11,
  lineHeight: "18px",
  fontWeight: 600,
  whiteSpace: "nowrap"
};
var chipNeutral = {
  background: "var(--dsw-alias-bg-layer-2, var(--dsh-color-hover-bg, #f3f4f6))",
  color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted-strong, #4b5563))"
};
var chipError = {
  background: "rgba(220,38,38,.10)",
  color: "#dc2626"
};
var chipGap = {
  background: "var(--dsw-alias-state-warn-secondary, rgba(245,158,11,.14))",
  color: "var(--dsw-alias-state-warn-label, #b45309)",
  fontWeight: 500
};
var chipRef = {
  background: "var(--dsw-alias-bg-layer-2, var(--dsh-color-hover-bg, #f3f4f6))",
  color: "var(--dsw-alias-label-primary-bluish, #4338ca)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: 500
};
var nodePill = {
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
  color: "var(--dsw-alias-label-primary-bluish, #4338ca)"
};
var taskCard = {
  display: "flex",
  gap: 8,
  border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
  borderRadius: 10,
  padding: "7px 9px",
  background: "var(--dsw-alias-bg-layer-1, transparent)"
};
var planBox = {
  border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
  borderRadius: 10,
  padding: "7px 10px",
  background: "var(--dsw-alias-bg-layer-1, transparent)",
  display: "flex",
  flexDirection: "column",
  gap: 5
};
var btn = {
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
  background: "transparent"
};
var btnSolid = {
  color: "#fff",
  borderColor: "transparent",
  background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)"
};
var input = {
  border: "1px solid var(--dsw-alias-border-l2, var(--dsh-color-border, #d1d5db))",
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 12,
  background: "var(--dsw-alias-bg-base, var(--dsh-color-surface, #fff))",
  color: "inherit",
  outline: "none",
  minWidth: 0
};

// client/src/EngramSection.tsx
var import_react7 = require("react");

// client/src/EngramGraph.tsx
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var W = 640;
var H = 420;
var REL_LABEL = {
  depends_on: "\u4F9D\u8D56",
  implements: "\u5B9E\u73B0",
  refines: "\u7EC6\u5316",
  contradicts: "\u77DB\u76FE",
  tracks: "\u8FFD\u8E2A",
  relates_to: "\u5173\u8054"
};
var REL_COLOR = {
  depends_on: "#f59e0b",
  implements: "#10b981",
  refines: "#38bdf8",
  contradicts: "#ef4444",
  tracks: "#8b5cf6",
  relates_to: "#64748b"
};
var REL_DEFAULT = "#94a3b8";
var KIND_COLOR = {
  package: "#6366f1",
  service: "#0ea5e9",
  repo: "#10b981",
  doc: "#f59e0b",
  person: "#ec4899",
  bug: "#ef4444",
  module: "#14b8a6",
  concept: "#8b5cf6"
};
var NODE_DEFAULT = "#6366f1";
var TASK_COLOR = "#0f766e";
function relColor(relation) {
  return REL_COLOR[relation] ?? REL_DEFAULT;
}
function truncate(s4, n) {
  return s4.length > n ? `${s4.slice(0, n - 1)}\u2026` : s4;
}
function simulate(pos, edges) {
  const arr = [...pos.values()];
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
      const f = 9e3 / (d2 + 1);
      const fx = dx / d * f;
      const fy = dy / d * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }
  for (const [s4, t] of edges) {
    const a = pos.get(s4);
    const b = pos.get(t);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - 100) * 0.045;
    const fx = dx / d * f;
    const fy = dy / d * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }
  let maxSpeed = 0;
  for (const p of arr) {
    if (p.fx !== null && p.fy !== null) {
      p.x = p.fx;
      p.y = p.fy;
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    p.vx += (W / 2 - p.x) * 4e-3;
    p.vy += (H / 2 - p.y) * 4e-3;
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
function EngramGraph({ workspace, entities, tasks, links, nameOf }) {
  const uid = (0, import_react3.useMemo)(() => `eg${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`, []);
  const svgRef = (0, import_react3.useRef)(null);
  const graph = (0, import_react3.useMemo)(() => {
    const keep = (ws) => workspace === "" || ws === workspace;
    const entitiesF = entities.filter((e) => keep(e.workspace));
    const tasksF = tasks.filter((t) => keep(t.workspace));
    const linksF = links.filter((l) => keep(l.workspace));
    const nodesRaw = [
      ...entitiesF.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind ?? "entity",
        description: e.description,
        kindType: "entity",
        state: "",
        degree: 0
      })),
      ...tasksF.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.state,
        description: t.description,
        kindType: "task",
        state: t.state,
        degree: 0
      }))
    ];
    const byId2 = new Map(nodesRaw.map((n) => [n.id, n]));
    const edges = [];
    const keptLinks = [];
    let dangling = 0;
    for (const l of linksF) {
      if (byId2.has(l.source) && byId2.has(l.target)) {
        edges.push([l.source, l.target]);
        keptLinks.push(l);
      } else {
        dangling++;
      }
    }
    for (const [s4, t] of edges) {
      byId2.get(s4).degree++;
      byId2.get(t).degree++;
    }
    const nodes = [...byId2.values()].sort((a, b) => b.degree - a.degree);
    return { nodes, edges, keptLinks, dangling };
  }, [workspace, entities, tasks, links]);
  const posRef = (0, import_react3.useRef)(/* @__PURE__ */ new Map());
  const [, setTick] = (0, import_react3.useState)(0);
  const dragging = (0, import_react3.useRef)(null);
  const [hover, setHover] = (0, import_react3.useState)(null);
  const [selected, setSelected] = (0, import_react3.useState)(null);
  const [hoverEdge, setHoverEdge] = (0, import_react3.useState)(null);
  const [simRound, setSimRound] = (0, import_react3.useState)(0);
  const [view, setView] = (0, import_react3.useState)({ x: 0, y: 0, k: 1 });
  const pan = (0, import_react3.useRef)(null);
  const graphKey = (0, import_react3.useMemo)(
    () => graph.nodes.map((n) => n.id).join(",") + "|" + graph.edges.map(([s4, t]) => `${s4}>${t}`).join(","),
    [graph]
  );
  (0, import_react3.useEffect)(() => {
    const pos = /* @__PURE__ */ new Map();
    const n = graph.nodes.length;
    graph.nodes.forEach((node, i) => {
      const ang = n > 1 ? i / n * Math.PI * 2 : 0;
      const ring = 190 - i / Math.max(1, n) * 120;
      pos.set(node.id, {
        x: W / 2 + Math.cos(ang) * ring,
        y: H / 2 + Math.sin(ang) * ring * 0.8,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null
      });
    });
    posRef.current = pos;
    setSelected(null);
    setHover(null);
    setView({ x: 0, y: 0, k: 1 });
  }, [graphKey]);
  (0, import_react3.useEffect)(() => {
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
  }, [graphKey, simRound]);
  (0, import_react3.useEffect)(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        return { ...v, k: Math.max(0.35, Math.min(3, v.k * factor)) };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);
  const toGraph = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = (clientX - rect.left) / Math.max(1, rect.width) * W;
    const sy = (clientY - rect.top) / Math.max(1, rect.height) * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  const onPointerDown = (e) => {
    const nodeEl = e.target.closest?.("[data-node-id]");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id");
      dragging.current = { id };
      const g = toGraph(e.clientX, e.clientY);
      const p = posRef.current.get(id);
      if (p) {
        p.fx = g.x;
        p.fy = g.y;
      }
      setSelected(id);
      e.target.setPointerCapture?.(e.pointerId);
      e.stopPropagation();
      return;
    }
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e) => {
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
  const endPointer = (e) => {
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
  const byId = (0, import_react3.useMemo)(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const neighbors = (0, import_react3.useMemo)(() => {
    const m = /* @__PURE__ */ new Map();
    for (const [s4, t] of graph.edges) {
      if (!m.has(s4)) m.set(s4, /* @__PURE__ */ new Set());
      if (!m.has(t)) m.set(t, /* @__PURE__ */ new Set());
      m.get(s4).add(t);
      m.get(t).add(s4);
    }
    return m;
  }, [graph.edges]);
  const focusSet = (0, import_react3.useMemo)(() => {
    if (hover !== null) {
      const s4 = /* @__PURE__ */ new Set([hover]);
      (neighbors.get(hover) ?? /* @__PURE__ */ new Set()).forEach((x) => s4.add(x));
      return s4;
    }
    if (selected !== null) {
      const s4 = /* @__PURE__ */ new Set([selected]);
      (neighbors.get(selected) ?? /* @__PURE__ */ new Set()).forEach((x) => s4.add(x));
      return s4;
    }
    return null;
  }, [hover, selected, neighbors]);
  const selNode = selected ? byId.get(selected) : null;
  const selEdges = (0, import_react3.useMemo)(
    () => selected ? graph.keptLinks.filter((l) => l.source === selected || l.target === selected) : [],
    [selected, graph.keptLinks]
  );
  const incidentKinds = /* @__PURE__ */ new Set();
  for (const rel of graph.keptLinks) incidentKinds.add(rel.relation);
  const zoom = (factor) => setView((v) => ({ ...v, k: Math.max(0.35, Math.min(3, v.k * factor)) }));
  if (graph.nodes.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", padding: "8px 0" }, children: "\u6682\u65E0\u8282\u70B9/\u5173\u7CFB\u53EF\u7ED8\u5236 \u2014 \u6A21\u578B\u7528 esr_node / esr_link \u767B\u8BB0\u9886\u57DF\u5BF9\u8C61\u5E76\u4E92\u8FDE\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u529B\u5BFC\u5411\u5173\u7CFB\u56FE\u3002" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...s.chip }, children: [
        graph.nodes.length,
        " \u8282\u70B9"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...s.chip }, children: [
        graph.keptLinks.length,
        " \u5173\u7CFB"
      ] }),
      graph.dangling > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { ...s.chipWarn }, children: [
        graph.dangling,
        " \u60AC\u7A7A\u94FE\u63A5\uFF08\u7AEF\u70B9\u7F3A\u5931\uFF0C\u672A\u7ED8\u5236\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: "1 1 auto" } }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s.hint, children: "\u62D6\u62FD\u8282\u70B9 \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u7A7A\u767D\u5904\u62D6\u62FD\u53EF\u5E73\u79FB" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: s.btn, onClick: () => zoom(1.2), children: "\uFF0B" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: s.btn, onClick: () => zoom(1 / 1.2), children: "\uFF0D" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: s.btn, onClick: reLayout, children: "\u91CD\u7EC4" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { position: "relative", border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 12, overflow: "hidden", background: "var(--dsh-color-surface, #fff)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "svg",
        {
          ref: svgRef,
          viewBox: `0 0 ${W} ${H}`,
          style: { display: "block", width: "100%", height: 380, cursor: pan.current ? "grabbing" : "grab", touchAction: "none" },
          onPointerDown,
          onPointerMove,
          onPointerUp: endPointer,
          onPointerLeave: endPointer,
          onDoubleClick: reLayout,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("marker", { id: `${uid}-arrow`, viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M0 0 L8 4 L0 8 z", fill: REL_DEFAULT }) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("g", { transform: `translate(${view.x},${view.y}) scale(${view.k})`, children: [
              graph.keptLinks.map((l) => {
                const a = posRef.current.get(l.source);
                const b = posRef.current.get(l.target);
                if (!a || !b) return null;
                const activeEdge = hoverEdge === l.id || selected !== null && (l.source === selected || l.target === selected) || hover !== null && (l.source === hover || l.target === hover);
                const faded = focusSet !== null && !activeEdge && !(focusSet.has(l.source) && focusSet.has(l.target));
                const color = relColor(l.relation);
                return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("g", { "data-edge-id": l.id, onPointerEnter: () => setHoverEdge(l.id), onPointerLeave: () => setHoverEdge(null), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                    "line",
                    {
                      x1: a.x,
                      y1: a.y,
                      x2: b.x,
                      y2: b.y,
                      stroke: color,
                      strokeWidth: activeEdge ? 2.2 : 1.1,
                      strokeOpacity: faded ? 0.12 : activeEdge ? 0.95 : 0.55,
                      markerEnd: `url(#${uid}-arrow)`
                    }
                  ),
                  (activeEdge || hoverEdge === l.id) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("text", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5, fontSize: 9.5, fill: color, textAnchor: "middle", style: { pointerEvents: "none" }, children: REL_LABEL[l.relation] ?? l.relation })
                ] }, l.id);
              }),
              graph.nodes.map((node) => {
                const p = posRef.current.get(node.id);
                if (!p) return null;
                const isHover = hover === node.id;
                const isSel = selected === node.id;
                const faded = focusSet !== null && !focusSet.has(node.id);
                const color = node.kindType === "task" ? TASK_COLOR : KIND_COLOR[node.kind] ?? NODE_DEFAULT;
                return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                  "g",
                  {
                    "data-node-id": node.id,
                    transform: `translate(${p.x},${p.y})`,
                    opacity: faded ? 0.18 : 1,
                    onPointerEnter: () => setHover(node.id),
                    onPointerLeave: () => setHover(null),
                    style: { cursor: "grab" },
                    children: [
                      node.kindType === "entity" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { r: 10, fill: color, fillOpacity: isSel ? 1 : 0.9, stroke: isSel || isHover ? "#0f172a" : color, strokeWidth: isSel ? 2.5 : 1 }),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { r: 10, fill: "none", stroke: color, strokeOpacity: 0.25, strokeWidth: 5 })
                      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: -11, y: -9, width: 22, height: 18, rx: 6, fill: color, stroke: isSel ? "#0f172a" : "transparent", strokeWidth: isSel ? 2.2 : 0 }),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M-5.5 -1.5 l3.4 3.4 l6.5 -6.5", stroke: "#fff", strokeWidth: 1.8, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" })
                      ] }),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("text", { y: 18, textAnchor: "middle", fontSize: 10, fill: "var(--dsh-color-muted-strong, #334155)", style: { pointerEvents: "none", fontWeight: isHover || isSel ? 700 : 500 }, children: truncate(nameOf(node.id), 12) })
                    ]
                  },
                  node.id
                );
              })
            ] })
          ]
        }
      ),
      selNode && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.infoPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.badge, background: selNode.kindType === "task" ? TASK_COLOR : KIND_COLOR[selNode.kind] ?? NODE_DEFAULT }, children: selNode.kindType === "task" ? selNode.state : selNode.kind }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 700, fontSize: 13, flex: 1, overflowWrap: "anywhere" }, children: selNode.name }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: s.closeBtn, onClick: () => setSelected(null), "aria-label": "\u5173\u95ED", children: "\u2715" })
        ] }),
        selNode.description && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: selNode.description }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...s.mono, marginTop: 4, fontSize: 11 }, children: selNode.id }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 2 }, children: [
          selNode.degree,
          " \u6761\u5173\u8054 \xB7 ",
          selEdges.length,
          " \u6761\u5173\u7CFB"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }, children: [
          selEdges.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: "\u6682\u65E0\u5173\u7CFB" }),
          selEdges.slice(0, 8).map((l) => {
            const out = l.source === selNode.id;
            const other = out ? l.target : l.source;
            return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.relChip, color: relColor(l.relation), borderColor: relColor(l.relation) }, children: REL_LABEL[l.relation] ?? l.relation }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: "var(--dsh-color-muted, #6b7280)" }, children: out ? "\u2192" : "\u2190" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }, children: nameOf(other) })
            ] }, l.id);
          }),
          selEdges.length > 8 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: [
            "+",
            selEdges.length - 8,
            " \u6761\u66F4\u591A\u2026"
          ] })
        ] })
      ] })
    ] }),
    incidentKinds.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: "\u56FE\u4F8B\uFF1A" }),
      [...incidentKinds].sort().map((rel) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.relChip, color: relColor(rel), borderColor: relColor(rel) }, children: REL_LABEL[rel] ?? rel }, rel)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { r: 5, fill: TASK_COLOR }),
        " \u4EFB\u52A1"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { r: 5, fill: NODE_DEFAULT }),
        " \u5B9E\u4F53"
      ] })
    ] })
  ] });
}
var s = {
  chip: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "2px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    background: "rgba(99,102,241,.10)",
    color: "var(--dsh-color-primary, #4338ca)"
  },
  chipWarn: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "2px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    background: "#fef3c7",
    color: "#b45309"
  },
  hint: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)" },
  btn: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 8,
    padding: "3px 9px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)"
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "var(--dsh-color-muted, #6b7280)",
    fontSize: 12,
    padding: 0
  },
  badge: {
    borderRadius: 6,
    padding: "1px 7px",
    fontSize: 10.5,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.02em"
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
    background: "transparent"
  },
  infoPanel: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 250,
    maxHeight: 300,
    overflow: "auto",
    borderRadius: 12,
    padding: 10,
    background: "var(--dsh-color-surface, #ffffff)",
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    boxShadow: "0 4px 16px rgba(15,23,42,.12)"
  }
};

// client/src/EngramPreview.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function lineColor(line, dark) {
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
function EngramPreview({ api, workspace, workspaces }) {
  const { dark, vars } = useEngramTheme();
  const [ws, setWs] = (0, import_react4.useState)(workspace || workspaces[0] || "");
  const [data, setData] = (0, import_react4.useState)(null);
  const [loading, setLoading] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [copied, setCopied] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    if (workspace !== "") setWs(workspace);
  }, [workspace]);
  const refresh = (0, import_react4.useMemo)(
    () => async () => {
      const target2 = ws || workspaces[0] || "";
      if (!target2) {
        setData(null);
        return;
      }
      setLoading(true);
      try {
        const res = await api.preview(target2);
        setData(res);
        setError(null);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
      }
    },
    [api, ws, workspaces]
  );
  (0, import_react4.useEffect)(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2e4);
    return () => clearInterval(id);
  }, [refresh]);
  const copy = (which) => {
    const text = data ? which === "engram" ? data.engram : data.esr : "";
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
  const hb2 = {
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
      outline: "none"
    },
    meta: { display: "flex", gap: 6, flexWrap: "wrap" },
    chip: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 10.5,
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 999,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      color: "var(--dsh-color-muted-strong, #374151)",
      background: "var(--dsh-color-hover-bg, rgba(127,127,127,.08))"
    },
    panes: { display: "flex", gap: 10, flexWrap: "wrap" },
    pane: {
      flex: "1 1 340px",
      minWidth: 260,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 10,
      overflow: "hidden",
      background: dark ? "rgba(10,14,22,.4)" : "rgba(15,23,42,.04)",
      display: "flex",
      flexDirection: "column"
    },
    paneHead: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderBottom: "1px solid var(--dsh-color-border, #d1d5db)",
      fontSize: 12,
      fontWeight: 700
    },
    badge: {
      fontSize: 10,
      fontWeight: 700,
      padding: "1px 7px",
      borderRadius: 999,
      color: "#fff"
    },
    orderChip: {
      fontSize: 10.5,
      fontWeight: 600,
      padding: "1px 7px",
      borderRadius: 999,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      color: "var(--dsh-color-muted, #6b7280)"
    },
    copyBtn: {
      marginLeft: "auto",
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 9px",
      borderRadius: 7,
      cursor: "pointer",
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      background: "transparent",
      color: "var(--dsh-color-muted-strong, #374151)"
    },
    pre: {
      margin: 0,
      padding: "12px 14px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11.5,
      lineHeight: 1.65,
      color: "var(--dsh-color-text, #1f2937)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "auto",
      maxHeight: 340
    },
    empty: {
      padding: "14px 16px",
      fontSize: 12,
      color: "var(--dsh-color-muted, #6b7280)",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontStyle: "italic"
    },
    paneCost: { display: "flex", gap: 5, padding: "0 12px 10px", flexWrap: "wrap" }
  };
  const target = ws || workspaces[0] || "";
  if (!target) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { ...hb2.root, color: "var(--dsh-color-muted, #6b7280)" }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u8FD8\u6CA1\u6709\u53EF\u7528\u5DE5\u4F5C\u533A \u2014 \u5148\u521B\u5EFA/\u6253\u5F00\u4E00\u4E2A\u5DE5\u4F5C\u533A\uFF0C[ENGRAM] \u6CE8\u5165\u5757\u4F1A\u6309\u5DE5\u4F5C\u533A\u72EC\u7ACB\u6E32\u67D3\u3002" }) });
  }
  const esrLines = data ? data.esr.split("\n") : [];
  const engramLines = data ? data.engram.split("\n") : [];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.title, children: "\u6CE8\u5165\u9884\u89C8\uFF08[ENGRAM] \xB7 [ESR]\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.sub, children: "\u6BCF\u4E2A\u4F1A\u8BDD\u5B9E\u9645\u6CE8\u5165\u7684\u63D0\u793A\u5757 \xB7 \u4F1A\u8BDD\u5185\u51BB\u7ED3\u4E00\u6B21\uFF08order 40/41\uFF0C\u524D\u7F00\u7A33\u5B9A\u590D\u7528 KV \u7F13\u5B58\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { style: hb2.pick, value: ws, onChange: (e) => setWs(e.target.value), children: [
        workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: w, children: w }, w)),
        workspaces.length === 1 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: ws, children: ws })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.meta, children: [
      data && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
          "\u8BB0\u5FC6 ",
          data.meta.counts.memories
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
          "\u4EFB\u52A1 ",
          data.meta.counts.tasks,
          " active"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
          "\u5173\u7CFB ",
          data.meta.counts.links
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
          "\u8282\u70B9 ",
          data.meta.counts.nodes
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
          "\u5171 ~",
          data.meta.engram.tokens + data.meta.esr.tokens,
          " tokens"
        ] })
      ] }),
      !data && !error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.chip, children: loading ? "\u8BFB\u53D6\u4E2D\u2026" : "\u2026" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.chip, children: error })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.panes, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.pane, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.paneHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...hb2.badge, background: dark ? "#3b5bdb" : "#4f46e5" }, children: "ENGRAM" }),
          "\u7D22\u5F15\u5757",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.orderChip, children: "order 40" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { style: hb2.copyBtn, onClick: () => copy("engram"), children: copied === "engram" ? "\u5DF2\u590D\u5236 \u2713" : "\u590D\u5236" })
        ] }),
        !data && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.empty, children: loading ? "\u6E32\u67D3\u4E2D\u2026" : "\u2013" }),
        data && data.engram === "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.empty, children: "\u8BE5\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u6CE8\u5165\u7684\u8BB0\u5FC6/\u4EFB\u52A1/\u5173\u7CFB ([ENGRAM] \u5757\u4E3A\u7A7A)\u3002" }),
        data && data.engram !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { style: hb2.pre, children: engramLines.map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: lineColor(line, dark), children: line || "\xA0" }, i)) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.paneCost, children: data && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            data.meta.engram.lines,
            " \u884C"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            data.meta.engram.chars,
            " \u5B57\u7B26"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            "~",
            data.meta.engram.tokens,
            " tokens"
          ] })
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.pane, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: hb2.paneHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { ...hb2.badge, background: dark ? "#6d28d9" : "#7c3aed" }, children: "ESR" }),
          "\u4EFB\u52A1 \xB7 \u95ED\u73AF\u5757",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: hb2.orderChip, children: "order 41" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { style: hb2.copyBtn, onClick: () => copy("esr"), children: copied === "esr" ? "\u5DF2\u590D\u5236 \u2713" : "\u590D\u5236" })
        ] }),
        !data && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.empty, children: loading ? "\u6E32\u67D3\u4E2D\u2026" : "\u2013" }),
        data && data.esr === "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.empty, children: "\u8BE5\u5DE5\u4F5C\u533A\u6CA1\u6709\u4EFB\u52A1 ([ESR] \u5757\u4E3A\u7A7A)\u3002" }),
        data && data.esr !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { style: hb2.pre, children: esrLines.map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: lineColor(line, dark), children: line || "\xA0" }, i)) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.paneCost, children: data && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            data.meta.esr.lines,
            " \u884C"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            data.meta.esr.chars,
            " \u5B57\u7B26"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: hb2.chip, children: [
            "~",
            data.meta.esr.tokens,
            " tokens"
          ] })
        ] }) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: hb2.sub, children: "\u8BF4\u660E\uFF1A\u5757\u7531\u4E0E\u7CFB\u7EDF\u63D0\u793A\u76F8\u540C\u7684\u7EAF\u51FD\u6570\u5B9E\u65F6\u6E32\u67D3\uFF08\u6BCF 20s \u5237\u65B0\uFF09\uFF1B\u300Cescalate:\u300D\u884C\u662F\u6700\u8FD1 14 \u5929 mem/esr \u8C03\u7528\u5931\u8861\u65F6\u81EA\u52A8\u9644\u52A0\u7684\u6570\u636E\u9A71\u52A8\u63D0\u9192\uFF0C\u884C\u4E3A\u6539\u5584\u540E\u81EA\u52A8\u6D88\u5931\u3002\u590D\u5236\u6309\u94AE\u53EF\u76F4\u63A5\u628A\u6CE8\u5165\u5757 \u8D34\u8FDB\u63D0\u793A\u8BCD\u5BA1\u8BA1\u3002" })
  ] });
}

// client/src/EvidenceRing.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function EvidenceRing({ artifact, evaluation, refs, size = 24, showLabel = true, title, fraction, labelText }) {
  const filled = Number(artifact) + Number(evaluation) + Number(refs);
  const complete = fraction !== void 0 ? fraction >= 1 : filled === 3;
  const partial = fraction !== void 0 ? fraction > 0 : filled > 0 && filled < 3;
  const color = complete ? "#10b981" : partial ? "#f59e0b" : "#94a3b8";
  const track = "rgba(148,163,184,.22)";
  const sw = Math.max(2.5, Math.round(size * 0.16));
  const r = (size - sw) / 2 - 0.5;
  const c = 2 * Math.PI * r;
  const gap = c * 0.05;
  const arc = (c - gap * 3) / 3;
  const cx = size / 2;
  const cy = size / 2;
  const isFraction = fraction !== void 0;
  const label = showLabel && size >= 28;
  const centerText = labelText ?? (isFraction ? `${Math.round(fraction * 100)}%` : `${filled}/3`);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "span",
    {
      title: title ?? (isFraction ? `\u8BC1\u636E\u5B8C\u5907\u5EA6 ${Math.round(fraction * 100)}%` : `\u8BC1\u636E\u95ED\u73AF\uFF1Aartifact${artifact ? "\u2713" : "\u2717"} \xB7 evaluation${evaluation ? "\u2713" : "\u2717"} \xB7 memory_ref${refs ? "\u2713" : "\u2717"} (${filled}/3)`),
      style: { position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: size, height: size, lineHeight: 1 },
      children: [
        isFraction ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("circle", { cx, cy, r, fill: "none", stroke: track, strokeWidth: sw }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "circle",
            {
              cx,
              cy,
              r,
              fill: "none",
              stroke: color,
              strokeWidth: sw,
              strokeDasharray: `${Math.max(0, Math.min(1, fraction)) * c} ${c}`,
              transform: `rotate(-90 ${cx} ${cy})`,
              strokeLinecap: "round"
            }
          )
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true", children: gates().map((g, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "circle",
          {
            cx,
            cy,
            r,
            fill: "none",
            stroke: g.on ? color : track,
            strokeWidth: sw,
            strokeDasharray: `${arc} ${c - arc}`,
            transform: `rotate(${i * 120 - 90} ${cx} ${cy})`,
            strokeLinecap: "round"
          },
          g.name
        )) }),
        label && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "span",
          {
            style: {
              position: "absolute",
              color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-strong, #374151))",
              fontSize: isFraction ? Math.max(8, Math.round(size * 0.26)) : Math.max(8, Math.round(size * 0.3)),
              fontWeight: 700
            },
            children: centerText
          }
        )
      ]
    }
  );
  function gates() {
    return [
      { on: Boolean(artifact), name: "artifact" },
      { on: Boolean(evaluation), name: "evaluation" },
      { on: Boolean(refs), name: "memory_ref" }
    ];
  }
}

// client/src/EngramTelemetry.tsx
var import_react5 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
var MEM_TOOLS = ["engram_store", "engram_recall", "engram_detail", "loom_store", "loom_recall", "loom_detail"];
var ESR_TOOLS = ["esr_task", "esr_node", "esr_close", "esr_link", "esr_gc"];
var COLOR_MEM = "#3b5bdb";
var COLOR_ESR = "#7c3aed";
var COLOR_MUTED = "#94a3b8";
function pct(v) {
  if (v === null || v === void 0) return "\u2013";
  return `${Math.round(v * 100)}%`;
}
function EngramTelemetry({ api, workspace }) {
  const { dark, vars } = useEngramTheme();
  const [stats, setStats] = (0, import_react5.useState)(null);
  const [loading, setLoading] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)(null);
  const refresh = (0, import_react5.useMemo)(
    () => async () => {
      setLoading(true);
      try {
        const res = await api.stats(workspace || void 0);
        setStats(res);
        setError(null);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
      }
    },
    [api, workspace]
  );
  (0, import_react5.useEffect)(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2e4);
    return () => clearInterval(id);
  }, [refresh]);
  const toolRows = (0, import_react5.useMemo)(() => {
    if (!stats) return [];
    const entries = Object.entries(stats.totals.counts ?? {}).sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0][1] : 0;
    return entries.slice(0, 8).map(([name, count]) => ({
      name,
      count,
      esc: ESR_TOOLS.includes(name) ? "esr" : MEM_TOOLS.includes(name) ? "mem" : "other"
    }));
  }, [stats]);
  const daily = (0, import_react5.useMemo)(() => {
    if (!stats) return { rows: [], max: 1 };
    const rows = [...stats.byDay ?? []].reverse().slice(-14);
    const max = Math.max(1, ...rows.map((d) => Object.values(d.counts ?? {}).reduce((a, b) => a + b, 0)));
    return { rows, max };
  }, [stats]);
  const dose = stats && stats.ratios ? stats.ratios : null;
  const sampleText = stats && stats.ratios && stats.ratios.calls < 10 ? `\u6837\u672C\u4E0D\u8DB3\uFF08${stats.ratios.calls} \u6B21\uFF09\uFF0C\u6BD4\u4F8B\u4EC5\u4F9B\u53C2\u8003` : null;
  const hb2 = {
    root: { display: "flex", flexDirection: "column", gap: 12, ...vars },
    head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    title: { fontWeight: 700, fontSize: 13 },
    sub: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 },
    gaugeCard: {
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 10,
      padding: "10px 12px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)"
    },
    gaugeLabel: { fontSize: 11.5, fontWeight: 600, lineHeight: 1.35 },
    gaugeSub: { fontSize: 10.5, color: "var(--dsh-color-muted-weak, #9ca3af)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    statCard: {
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 10,
      padding: "9px 12px",
      background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)"
    },
    statNum: { fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    statLabel: { fontSize: 10.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 1 },
    panel: { border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 10, padding: "10px 12px", background: dark ? "rgba(10,14,22,.35)" : "rgba(15,23,42,.03)" },
    panelTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8 },
    warn: { fontSize: 11.5, padding: "6px 10px", borderRadius: 8, background: "rgba(245,158,11,.14)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)" },
    legend: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--dsh-color-muted, #6b7280)" }
  };
  const BW = 460;
  const BH = 150;
  const barPad = Math.max(2, Math.min(5, Math.floor(BW / (daily.rows.length * 1.6))));
  const barW = daily.rows.length > 0 ? (BW - barPad * 2 * daily.rows.length) / daily.rows.length : 0;
  const maxBar = daily.max;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: hb2.title, children: "agent \u884C\u4E3A\u9065\u6D4B\u4EEA\u8868\u76D8" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: hb2.sub, children: [
        "\u57FA\u4E8E /stats \u771F\u5B9E\u8C03\u7528\u7D2F\u8BA1\uFF08\u5DE5\u4F5C\u533A \xD7 \u5929\u6EDA\u52A8\uFF09\xB7 20s \u81EA\u52A8\u5237\u65B0",
        workspace === "" ? " \xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" : ` \xB7 ${workspace}`
      ] }),
      loading && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: hb2.sub, children: "\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          style: { marginLeft: "auto", fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 7, cursor: "pointer", border: "1px solid var(--dsh-color-border, #d1d5db)", background: "transparent", color: "var(--dsh-color-muted-strong, #374151)" },
          onClick: () => void refresh(),
          disabled: loading,
          children: "\u5237\u65B0"
        }
      )
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.warn, children: [
      "\u26A0 ",
      error
    ] }),
    sampleText && stats && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.warn, children: sampleText }),
    !stats && !error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...hb2.sub, padding: 8 }, children: "\u52A0\u8F7D\u4E2D\u2026" }),
    stats && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.grid, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.gaugeCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(EvidenceRing, { artifact: false, evaluation: false, refs: false, size: 64, fraction: dose?.esrRatio ?? 0, labelText: pct(dose?.esrRatio), title: `ESR \u4E3B\u52A8\u6027\uFF08\u76EE\u6807 \u2265 34%\uFF09` }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.gaugeLabel, children: "ESR \u4E3B\u52A8\u6027" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.gaugeSub, children: [
              "esr ",
              dose?.esrCalls,
              " / mem ",
              dose?.memCalls,
              " \xB7 \u5171 ",
              dose?.calls
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 10, color: (dose?.esrRatio ?? 0) >= 0.34 ? "#059669" : "#d97706", fontWeight: 700 }, children: (dose?.esrRatio ?? 0) >= 0.34 ? "\u5065\u5EB7" : "\u504F\u4F4E \u2192 \u4E0B\u4F1A\u8BDD\u6CE8\u5165 escalate \u63D0\u9192" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.gaugeCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(EvidenceRing, { artifact: false, evaluation: false, refs: false, size: 64, fraction: dose?.recallHitRate ?? 0, labelText: pct(dose?.recallHitRate) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.gaugeLabel, children: "\u53EC\u56DE\u547D\u4E2D\u7387" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.gaugeSub, children: "\u6709\u547D\u4E2D\u7684 engram_recall \u5360\u6BD4" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.gaugeCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(EvidenceRing, { artifact: false, evaluation: false, refs: false, size: 64, fraction: dose?.detailFollowRate ?? 0, labelText: pct(dose?.detailFollowRate) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.gaugeLabel, children: "detail \u8F6C\u5316" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.gaugeSub, children: "\u547D\u4E2D\u53EC\u56DE\u540E 8 \u4E8B\u4EF6\u5185\u8DDF engram_detail" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.grid, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.statCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statNum, children: dose?.calls ?? 0 }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statLabel, children: "\u7D2F\u8BA1\u5DE5\u5177\u8C03\u7528" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.statCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statNum, children: dose?.esrCalls ?? 0 }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statLabel, children: "esr_* \u8C03\u7528" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.statCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statNum, children: dose?.memCalls ?? 0 }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statLabel, children: "\u8BB0\u5FC6\u7C7B\u8C03\u7528" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.statCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statNum, children: dose?.recallHitsPerQuery ?? "\u2013" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statLabel, children: "\u5E73\u5747\u547D\u4E2D/\u67E5\u8BE2" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.statCard, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statNum, children: stats.totals.failures ?? 0 }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.statLabel, children: "\u5931\u8D25\u6B21\u6570" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.panel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.panelTitle, children: "\u8FD1 14 \u5929\u6BCF\u65E5\u6D3B\u52A8 \xB7 mem vs esr" }),
        daily.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.sub, children: "\u8FD8\u6CA1\u6709\u6309\u5929\u6570\u636E\uFF08\u5DE5\u5177\u8C03\u7528\u4F1A\u5B9E\u65F6\u7D2F\u8BA1\uFF09\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { width: BW, height: BH, viewBox: `0 0 ${BW} ${BH}`, style: { display: "block", maxWidth: "100%" }, children: daily.rows.map((d, i) => {
          const mem = MEM_TOOLS.reduce((a, k) => a + (d.counts?.[k] ?? 0), 0);
          const esr = ESR_TOOLS.reduce((a, k) => a + (d.counts?.[k] ?? 0), 0);
          const total = mem + esr;
          const hi = total / maxBar * (BH - 22);
          const x = i * (barW + barPad * 2) + barPad;
          const y0 = BH - 18 - hi;
          const esrH = total > 0 ? esr / total * hi : 0;
          const memH = total > 0 ? mem / total * hi : 0;
          const dayLabel = (d.day ?? "").slice(5).replace("-", "/");
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("g", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x, y: y0 + memH, width: barW, height: esrH, fill: COLOR_ESR, rx: 1.5, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("title", { children: `${d.day} \xB7 mem ${mem} / esr ${esr}` }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x, y: y0, width: barW, height: memH, fill: COLOR_MEM, rx: 1.5, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("title", { children: `${d.day} \xB7 mem ${mem} / esr ${esr}` }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("text", { x: x + barW / 2, y: BH - 6, fontSize: 8.5, fill: dark ? "#8b93a7" : "#6b7280", textAnchor: "middle", children: dayLabel })
          ] }, d.day ?? i);
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", gap: 14, marginTop: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: hb2.legend, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("i", { style: { width: 9, height: 9, borderRadius: 2, background: COLOR_MEM, display: "inline-block" } }),
            " \u8BB0\u5FC6\u7C7B (engram_*/loom_*)"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: hb2.legend, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("i", { style: { width: 9, height: 9, borderRadius: 2, background: COLOR_ESR, display: "inline-block" } }),
            " ESR (esr_*)"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: hb2.panel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.panelTitle, children: "\u5DE5\u5177\u8C03\u7528\u5206\u5E03\uFF08Top 8\uFF09" }),
        toolRows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: hb2.sub, children: "\u8FD8\u6CA1\u6709\u5DE5\u5177\u8C03\u7528\u8BB0\u5F55\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 5 }, children: toolRows.map((r) => {
          const max = toolRows[0].count;
          const w = Math.max(4, Math.round(r.count / max * 320));
          const c = r.esc === "esr" ? COLOR_ESR : r.esc === "mem" ? COLOR_MEM : COLOR_MUTED;
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { width: 120, fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted-strong, #374151)", flex: "0 0 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: r.name }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { flex: "1 1 auto", height: 10, borderRadius: 5, background: dark ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.22)" }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { width: w, height: 10, borderRadius: 5, background: c } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", width: 34, textAlign: "right" }, children: [
              "\xD7",
              r.count
            ] })
          ] }, r.name);
        }) })
      ] })
    ] })
  ] });
}

// client/src/EngramDetail.tsx
var import_react6 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
var KIND_COLORS = {
  decision: "#2563eb",
  error: "#dc2626",
  procedure: "#7c3aed",
  fact: "#059669",
  insight: "#d97706",
  handoff: "#0891b2",
  task: "#4f46e5"
};
var KIND_LABEL = {
  decision: "\u51B3\u5B9A",
  error: "\u9519\u8BEF",
  procedure: "\u6D41\u7A0B",
  fact: "\u4E8B\u5B9E",
  insight: "\u6D1E\u5BDF",
  handoff: "\u4EA4\u63A5",
  task: "\u4EFB\u52A1"
};
var REL_COLORS = {
  depends_on: "#d97706",
  implements: "#2563eb",
  refines: "#7c3aed",
  contradicts: "#dc2626",
  tracks: "#059669"
};
function fmtDate(ts) {
  if (!ts) return "\u2013";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function daysLeft(ts) {
  if (ts === null || ts === void 0) return "\u221E";
  const days = Math.ceil((ts - Date.now()) / 864e5);
  return days > 0 ? `${days}d` : "\u5DF2\u8FC7\u671F";
}
function gapsOf(t) {
  const gaps = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}
function EngramDetail({ target, api, memories, tasks, nodes, links, onClose, onNavigateMemory, onChanged }) {
  const { dark, vars } = useEngramTheme();
  const [gArt, setGArt] = (0, import_react6.useState)("");
  const [gEval, setGEval] = (0, import_react6.useState)("");
  const [gRefs, setGRefs] = (0, import_react6.useState)("");
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [closing, setClosing] = (0, import_react6.useState)(false);
  const [notice, setNotice] = (0, import_react6.useState)(null);
  const task = target.kind === "task" ? tasks.find((t) => t.id === target.id) ?? null : null;
  const node = target.kind === "node" ? nodes.find((n) => n.id === target.id) ?? null : null;
  const link = target.kind === "link" ? target.link : null;
  const nameOf = (0, import_react6.useMemo)(() => {
    const nodeName = (id) => nodes.find((n) => n.id === id)?.name;
    const taskName = (id) => tasks.find((t) => t.id === id)?.name;
    return (id) => nodeName(id) ?? taskName(id) ?? id;
  }, [nodes, tasks]);
  const incident = (0, import_react6.useMemo)(() => {
    if (target.kind !== "node" || !node) return [];
    return links.filter((l) => l.source === node.id || l.target === node.id).map((l) => ({ l, outgoing: l.source === node.id }));
  }, [links, node, target.kind]);
  const hb2 = {
    root: {
      ...vars,
      border: "1px solid var(--dsh-color-border, #d1d5db)",
      borderRadius: 12,
      background: dark ? "rgba(10,14,22,.55)" : "var(--dsh-color-surface, #ffffff)",
      boxShadow: "0 1px 2px rgba(15,23,42,.05), 0 8px 24px rgba(15,23,42,.07)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      maxHeight: "72vh"
    },
    head: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 12px",
      borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
      background: dark ? "rgba(15,23,42,.6)" : "rgba(15,23,42,.04)"
    },
    title: { fontWeight: 700, fontSize: 13, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    close: { border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "var(--dsh-color-muted, #6b7280)", padding: "2px 6px", borderRadius: 6 },
    body: { padding: "10px 12px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 },
    kv: { display: "flex", flexDirection: "column", gap: 3 },
    k: { fontSize: 10.5, fontWeight: 700, color: "var(--dsh-color-muted-weak, #9ca3af)", textTransform: "uppercase", letterSpacing: 0.4 },
    v: { color: "var(--dsh-color-muted-strong, #374151)", wordBreak: "break-word", lineHeight: 1.5 },
    mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
    badge: { fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: "#fff" },
    tag: { fontSize: 11, padding: "1px 8px", borderRadius: 999, background: "var(--dsh-color-hover-bg, #f3f4f6)", color: "var(--dsh-color-muted, #6b7280)", border: "1px solid var(--dsh-color-border, #e5e7eb)" },
    chip: { fontSize: 11, padding: "2px 9px", borderRadius: 999, background: "rgba(37,99,235,.1)", color: "#2563eb", border: "1px solid rgba(37,99,235,.25)", cursor: "pointer" },
    input: { fontSize: 12, padding: "5px 8px", border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 8, background: "var(--dsh-color-surface, #ffffff)", color: "var(--dsh-color-muted-strong, #374151)", width: "100%", boxSizing: "border-box" },
    btn: { fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid var(--dsh-color-border, #d1d5db)", background: "transparent", color: "var(--dsh-color-muted-strong, #374151)" },
    btnPrimary: { fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 8, cursor: "pointer", border: "none", background: "#2563eb", color: "#fff" },
    relRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12 },
    relType: { border: "1px dashed var(--dsh-color-border, #cbd5e1)", borderRadius: 999, padding: "1px 7px", fontSize: 11, color: "var(--dsh-color-muted, #6b7280)" },
    dot: { width: 8, height: 8, borderRadius: 999, display: "inline-block" },
    section: { marginTop: 2 }
  };
  async function submitClose() {
    if (!task) return;
    setBusy(true);
    setNotice(null);
    try {
      const refs = gRefs.split(/[,，\s]+/).map((s4) => s4.trim()).filter(Boolean);
      const res = await api.closeTask(task.workspace, task.id, { artifact: gArt.trim() || void 0, evaluation: gEval.trim() || void 0, memoryRefs: refs.length ? refs : void 0 });
      setNotice(res.state === "stable" ? `\u5DF2\u95ED\u73AF \u2192 STABLE \u2713` : `\u4ECD\u6709\u7F3A\u53E3\uFF1A${(res.gaps ?? []).join(", ") || "\u2014"}`);
      onChanged?.();
    } catch (e) {
      setNotice(`\u5173\u95ED\u5931\u8D25\uFF1A${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  const kindBadge = (kind, label) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { ...hb2.badge, background: KIND_COLORS[kind] ?? "#6b7280" }, children: label });
  const headerTitle = target.kind === "task" ? task?.name ?? target.id : target.kind === "memory" ? target.memory.text.slice(0, 40) : target.kind === "node" ? node?.name ?? target.id : link ? nameOf(link.source) : "";
  const headerKind = target.kind === "task" ? task?.state === "stable" ? { k: "task", label: "STABLE" } : task ? { k: "task", label: task.state === "draft" ? "DRAFT" : "\u4EFB\u52A1" } : { k: "task", label: "\u4EFB\u52A1" } : target.kind === "memory" ? { k: target.memory.kind, label: KIND_LABEL[target.memory.kind] ?? target.memory.kind } : target.kind === "node" ? { k: "node", label: node?.kind || "\u8282\u70B9" } : { k: "link", label: "\u5173\u7CFB" };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.head, children: [
      kindBadge(headerKind.k, headerKind.label),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.title, title: headerTitle, children: headerTitle }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: hb2.close, onClick: onClose, "aria-label": "\u5173\u95ED\u8BE6\u60C5", children: "\u2715" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.body, children: [
      target.kind === "task" && !task && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.v, children: "\u4EFB\u52A1\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u88AB\u5173\u95ED/\u5F52\u6863\uFF09\u3002" }),
      target.kind === "task" && task && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(EvidenceRing, { artifact: Boolean(task.artifact), evaluation: Boolean(task.evaluation), refs: (task.memoryRefs?.length ?? 0) > 0, size: 40 }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 12, fontWeight: 700 }, children: task.name }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.mono, children: [
              task.id,
              " \xB7 ",
              task.workspace
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginTop: 3 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { ...hb2.badge, background: task.state === "stable" ? "#059669" : task.state === "draft" ? "#6b7280" : gapsOf(task).length === 0 ? "#2563eb" : "#d97706" }, children: task.state === "stable" ? "STABLE" : task.state === "draft" ? "DRAFT" : gapsOf(task).length === 0 ? "READY" : "ACTIVE" }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
              "\u521B\u5EFA ",
              fmtDate(task.createdAt)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
              "\u66F4\u65B0 ",
              fmtDate(task.updatedAt)
            ] })
          ] })
        ] }),
        task.description && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u63CF\u8FF0" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { ...hb2.v, marginTop: 3 }, children: task.description })
        ] }),
        task.state === "active" && gapsOf(task).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u8BC1\u636E\u7F3A\u53E3" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }, children: gapsOf(task).map((g) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
            g,
            " \u2717"
          ] }, g)) })
        ] }),
        task.artifact && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "artifact" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { ...hb2.mono, marginTop: 3, color: "#059669" }, children: [
            "\u2713 ",
            task.artifact
          ] })
        ] }),
        task.evaluation && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "evaluation" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: 3, color: "#059669" }, children: [
            "\u2713 ",
            task.evaluation
          ] })
        ] }),
        task.memoryRefs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u8BB0\u5FC6\u5F15\u7528" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }, children: task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.chip, title: `\u6253\u5F00\u8BB0\u5FC6 ${r}`, onClick: () => onNavigateMemory(r), children: [
            "#",
            r.slice(0, 8)
          ] }, r)) })
        ] }),
        task.state === "active" && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: 4, padding: 8, border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 10, background: dark ? "rgba(15,23,42,.35)" : "rgba(15,23,42,.03)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }, children: "\u8865\u9F50\u8BC1\u636E \u2192 \u5173\u95ED\uFF08\u4E09\u9879\u5168\u9F50\u8F6C STABLE\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { style: hb2.input, placeholder: "artifact \u4EA7\u7269\uFF08\u6587\u4EF6/PR/\u8DEF\uFF09", value: gArt, onChange: (e) => setGArt(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { style: hb2.input, placeholder: "evaluation \u8BC4\u4F30\uFF08\u6D4B\u8BD5/\u8BC4\u5BA1/\u5206\u6570\uFF09", value: gEval, onChange: (e) => setGEval(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { style: hb2.input, placeholder: "memory_refs\uFF08#id, \u9017\u53F7\u5206\u9694\uFF09", value: gRefs, onChange: (e) => setGRefs(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: hb2.btnPrimary, disabled: busy, onClick: () => setClosing(true), children: busy ? "\u2026" : "\u6309\u8BC1\u636E\u95ED\u73AF" }),
              closing && !busy && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", alignSelf: "center" }, children: "\u786E\u8BA4\u63D0\u4EA4\uFF1F" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: hb2.btn, onClick: () => {
                  void submitClose();
                  setClosing(false);
                }, children: "\u786E\u8BA4" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { style: hb2.btn, onClick: () => setClosing(false), children: "\u53D6\u6D88" })
              ] })
            ] })
          ] })
        ] }),
        task.state === "stable" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 11.5, color: "#059669", fontWeight: 700 }, children: "\u5DF2\u95ED\u73AF \u2713 \u2014 \u5168\u90E8\u8BC1\u636E\u95E8\u5DF2\u6EE1\u8DB3\uFF0C\u53EF\u4EE5\u4ECE\u770B\u677F/\u6E05\u5355\u79FB\u9664" }),
        notice && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 11.5, fontWeight: 600, color: "#d97706" }, children: notice })
      ] }),
      target.kind === "memory" && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: 6 }, children: [
          kindBadge(target.memory.kind, KIND_LABEL[target.memory.kind] ?? target.memory.kind),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
            "signal ",
            target.memory.signal.toFixed(2)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
            "hits ",
            target.memory.hits
          ] }),
          target.memory.status === "archived" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: hb2.tag, children: "archived" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u5185\u5BB9" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { ...hb2.v, whiteSpace: "pre-wrap", background: dark ? "rgba(15,23,42,.5)" : "rgba(15,23,42,.05)", borderRadius: 8, padding: 8, marginTop: 3 }, children: target.memory.text })
        ] }),
        target.memory.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u6807\u7B7E" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }, children: target.memory.tags.map((t) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: hb2.tag, children: [
            "#",
            t
          ] }, t)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u5143\u6570\u636E" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2, marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "id   ",
              target.memory.id
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "ws   ",
              target.memory.workspace
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "entity ",
              target.memory.entity ?? "\u2014"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "session ",
              target.memory.sessionId,
              " \xB7 seq ",
              target.memory.seq
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "created ",
              fmtDate(target.memory.createdAt),
              " \xB7 updated ",
              fmtDate(target.memory.updatedAt)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "TTL ",
              daysLeft(target.memory.expiresAt)
            ] })
          ] })
        ] })
      ] }),
      target.kind === "node" && !node && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.v, children: "\u8282\u70B9\u4E0D\u5B58\u5728\u3002" }),
      target.kind === "node" && node && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
          kindBadge("node", node.kind || "\u8282\u70B9"),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontWeight: 700, fontSize: 13 }, children: node.name })
        ] }),
        node.description && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u63CF\u8FF0" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { ...hb2.v, marginTop: 3 }, children: node.description })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u5143\u6570\u636E" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", display: "flex", flexDirection: "column", gap: 2 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              node.id,
              " \xB7 ",
              node.workspace
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "created ",
              fmtDate(node.createdAt)
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.k, children: [
            "\u5173\u8054\u5173\u7CFB\uFF08",
            incident.length,
            "\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 5, marginTop: 3 }, children: [
            incident.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.v, children: "\u6682\u65E0\u5173\u7CFB \u2014 \u7528 esr_link \u5173\u8054" }),
            incident.map(({ l, outgoing }) => {
              const other = outgoing ? l.target : l.source;
              const color = REL_COLORS[l.relation] ?? "#6b7280";
              return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.relRow, children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { ...hb2.dot, background: color } }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "mono", style: { fontSize: 11 }, children: [
                  outgoing ? "\u2192" : "\u2190",
                  " ",
                  nameOf(other)
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: hb2.relType, children: l.relation }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: [
                  Math.round(l.confidence * 100),
                  "%"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: fmtDate(l.createdAt) })
              ] }, l.id);
            })
          ] })
        ] })
      ] }),
      target.kind === "link" && link && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.relRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "mono", style: { fontSize: 12, fontWeight: 600 }, children: nameOf(link.source) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { ...hb2.relType, color: REL_COLORS[link.relation] ?? "var(--dsh-color-muted, #6b7280)", borderColor: (REL_COLORS[link.relation] ?? "#cbd5e1") + "66" }, children: link.relation }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { "aria-hidden": true, children: "\u2192" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "mono", style: { fontSize: 12, fontWeight: 600 }, children: nameOf(link.target) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: hb2.section, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: hb2.k, children: "\u5143\u6570\u636E" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: 3, fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--dsh-color-muted, #6b7280)", display: "flex", flexDirection: "column", gap: 2 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "id ",
              link.id,
              " \xB7 ",
              link.workspace
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "confidence ",
              Math.round(link.confidence * 100),
              "%"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              "created ",
              fmtDate(link.createdAt)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
              link.source,
              " \u2192 ",
              link.target
            ] })
          ] })
        ] })
      ] })
    ] })
  ] });
}

// client/src/EngramSection.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var KIND_COLORS2 = {
  decision: "#2563eb",
  error: "#dc2626",
  procedure: "#7c3aed",
  fact: "#059669",
  insight: "#d97706",
  handoff: "#0891b2",
  task: "#4f46e5"
};
var KIND_LABEL2 = {
  decision: "\u51B3\u5B9A",
  error: "\u9519\u8BEF",
  procedure: "\u6D41\u7A0B",
  fact: "\u4E8B\u5B9E",
  insight: "\u6D1E\u5BDF",
  handoff: "\u4EA4\u63A5",
  task: "\u4EFB\u52A1"
};
var s2 = {
  root: { padding: "2px 4px 40px" },
  h1: { fontSize: 20, fontWeight: 700, margin: "0 0 4px" },
  sub: { color: "var(--dsh-color-muted, #6b7280)", fontSize: 12, margin: "0 0 16px" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 16 },
  card: {
    border: "1px solid var(--dsh-color-border, #e5e7eb)",
    borderRadius: 12,
    padding: "10px 12px",
    background: "var(--dsh-color-surface, #ffffff)",
    boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 2px 8px rgba(15,23,42,.03)"
  },
  cardNum: { fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
  cardLabel: { color: "var(--dsh-color-muted, #6b7280)", fontSize: 11, marginTop: 2 },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 },
  input: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    background: "var(--dsh-color-surface, #fff)",
    color: "inherit"
  },
  btn: {
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)",
    transition: "background .15s ease, border-color .15s ease"
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
    transition: "opacity .15s ease"
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" },
  clamp3: { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", maxHeight: 60, minHeight: 18, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "normal" },
  expanded: { whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 },
  linkBtn: { border: "none", background: "none", padding: 0, fontSize: 11.5, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", textDecoration: "underline" },
  pageBar: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", flexWrap: "wrap" },
  tabBar: {
    display: "inline-flex",
    gap: 4,
    padding: 3,
    background: "var(--dsh-color-hover-bg, #f3f4f6)",
    borderRadius: 999,
    marginBottom: 14
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
    transition: "background .16s ease, color .16s ease"
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
    boxShadow: "0 1px 3px rgba(15,23,42,.10)"
  },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
    color: "var(--dsh-color-muted, #6b7280)",
    fontWeight: 600,
    whiteSpace: "nowrap"
  },
  td: { padding: "6px 8px", borderBottom: "1px solid var(--dsh-color-border, #f3f4f6)", verticalAlign: "top" },
  wsHead: {
    padding: "8px 8px 4px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--dsh-color-muted, #4b5563)",
    background: "var(--dsh-color-hover-bg, #f3f4f6)",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)"
  },
  badge: { display: "inline-block", borderRadius: 5, padding: "1px 6px", fontSize: 11, color: "#fff", whiteSpace: "nowrap" },
  tag: {
    display: "inline-block",
    borderRadius: 4,
    padding: "0 5px",
    fontSize: 11,
    marginRight: 4,
    background: "var(--dsh-color-hover-bg, #f3f4f6)"
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
    boxShadow: "0 1px 2px rgba(15,23,42,.03)"
  },
  relRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    padding: "5px 8px",
    borderRadius: 10,
    border: "1px solid var(--dsh-color-border, #f3f4f6)",
    background: "var(--dsh-color-hover-bg, #f8fafc)"
  },
  nodePill: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    borderRadius: 8,
    padding: "2px 9px",
    fontSize: 12,
    fontWeight: 600,
    background: "rgba(99,102,241,.12)",
    color: "#4338ca"
  }
};
function fmtDate2(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
var MEM_PAGE_SIZE = 10;
var pct2 = (n) => n === null || n === void 0 ? "\u2013" : `${(n * 100).toFixed(1)}%`;
function daysLeft2(ts) {
  if (ts === null || ts === void 0) return "\u221E";
  const days = Math.ceil((ts - Date.now()) / 864e5);
  return days > 0 ? `${days}d` : "expired";
}
function StatCard({ num, label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.cardNum, children: num }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.cardLabel, children: label })
  ] });
}
function taskGaps2(t) {
  const gaps = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}
function groupByWorkspace(items) {
  const groups = /* @__PURE__ */ new Map();
  for (const m of items) {
    const list = groups.get(m.workspace) ?? [];
    list.push(m);
    groups.set(m.workspace, list);
  }
  return [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
}
function EngramSection({ api, t }) {
  const [overview, setOverview] = (0, import_react7.useState)(null);
  const [memories, setMemories] = (0, import_react7.useState)([]);
  const [tasks, setTasks] = (0, import_react7.useState)([]);
  const [links, setLinks] = (0, import_react7.useState)([]);
  const [nodes, setNodes] = (0, import_react7.useState)([]);
  const [usageStats, setUsageStats] = (0, import_react7.useState)(null);
  const [detail, setDetail] = (0, import_react7.useState)(null);
  const [detailNotice, setDetailNotice] = (0, import_react7.useState)(null);
  const [error, setError] = (0, import_react7.useState)(null);
  const [workspace, setWorkspace] = (0, import_react7.useState)("");
  const [kind, setKind] = (0, import_react7.useState)("");
  const [status, setStatus] = (0, import_react7.useState)("active");
  const [q, setQ] = (0, import_react7.useState)("");
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [memPage, setMemPage] = (0, import_react7.useState)(0);
  const [expandedRows, setExpandedRows] = (0, import_react7.useState)(/* @__PURE__ */ new Set());
  const [view, setView] = (0, import_react7.useState)("mem");
  const [gcDryRun, setGcDryRun] = (0, import_react7.useState)(true);
  const [gcReport, setGcReport] = (0, import_react7.useState)(null);
  const [gcRunning, setGcRunning] = (0, import_react7.useState)(false);
  const [newTaskWs, setNewTaskWs] = (0, import_react7.useState)("");
  const [newTaskName, setNewTaskName] = (0, import_react7.useState)("");
  const [newTaskDesc, setNewTaskDesc] = (0, import_react7.useState)("");
  const [newTaskBusy, setNewTaskBusy] = (0, import_react7.useState)(false);
  const [closeFor, setCloseFor] = (0, import_react7.useState)(null);
  const [closeArtifact, setCloseArtifact] = (0, import_react7.useState)("");
  const [closeEval, setCloseEval] = (0, import_react7.useState)("");
  const [closeRefs, setCloseRefs] = (0, import_react7.useState)("");
  const [closeBusy, setCloseBusy] = (0, import_react7.useState)(false);
  const refresh = (0, import_react7.useCallback)(async () => {
    setBusy(true);
    setError(null);
    try {
      const ov = await api.overview();
      setOverview(ov);
      const wsList = workspace ? [workspace] : Object.keys(ov.workspaces);
      const [mem, taskGroups2, linkGroups2, nodeGroups2, st] = await Promise.all([
        api.memories({
          workspace: workspace || void 0,
          q: q || void 0,
          kind: kind || void 0,
          status: status === "all" ? void 0 : status
        }),
        Promise.all(wsList.map((w) => api.tasks(w, true))),
        Promise.all(wsList.map((w) => api.links(w))),
        Promise.all(wsList.map((w) => api.nodes(w))),
        api.stats(workspace || void 0)
      ]);
      setMemories(mem.items);
      setTasks(taskGroups2.flatMap((x) => x.items));
      setLinks(linkGroups2.flatMap((x) => x.items));
      setNodes(nodeGroups2.flatMap((x) => x.items));
      setUsageStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, workspace, q, kind, status]);
  (0, import_react7.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const workspaces = (0, import_react7.useMemo)(() => overview ? Object.keys(overview.workspaces) : [], [overview]);
  const kindsPresent = (0, import_react7.useMemo)(() => overview ? Object.keys(overview.kinds) : [], [overview]);
  const nameOf = (0, import_react7.useMemo)(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of nodes) map.set(n.id, n.name);
    for (const t2 of tasks) map.set(t2.id, t2.name);
    return (id) => map.get(id) ?? id;
  }, [nodes, tasks]);
  (0, import_react7.useEffect)(() => {
    if (!newTaskWs && workspaces.length > 0 && !workspace) setNewTaskWs(workspaces[0]);
  }, [newTaskWs, workspaces, workspace]);
  const cfg = overview?.config ?? null;
  const act = async (fn) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const toggleExpand = (id) => {
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
      const { report } = await api.gc(workspace || void 0, gcDryRun);
      setGcReport(report);
      if (!gcDryRun) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGcRunning(false);
    }
  };
  const goWorkspace = (dir) => {
    if (!overview || workspace === "") return;
    const list = Object.keys(overview.workspaces);
    if (list.length === 0) return;
    const idx = list.indexOf(workspace);
    const next = list[(idx + dir + list.length) % list.length];
    setWorkspace(next);
  };
  const groupedRows = workspace === "" ? groupByWorkspace(memories) : [[workspace, memories]];
  const taskGroups = workspace === "" ? groupByWorkspace(tasks) : [[workspace, tasks]];
  const linkGroups = workspace === "" ? groupByWorkspace(links) : [[workspace, links]];
  const nodeGroups = workspace === "" ? groupByWorkspace(nodes) : [[workspace, nodes]];
  const flatRows = [];
  for (const [ws, items] of groupedRows) {
    if (workspace === "") flatRows.push({ kind: "head", ws, count: items.length });
    for (const m of items) flatRows.push({ kind: "row", m });
  }
  const memPageCount = Math.max(1, Math.ceil(flatRows.length / MEM_PAGE_SIZE));
  const memPageSafe = Math.min(memPage, memPageCount - 1);
  const memPageRows = flatRows.slice(memPageSafe * MEM_PAGE_SIZE, (memPageSafe + 1) * MEM_PAGE_SIZE);
  (0, import_react7.useEffect)(() => {
    setMemPage(0);
  }, [workspace, status, kind, q]);
  (0, import_react7.useEffect)(() => {
    if (memPage >= memPageCount) setMemPage(Math.max(0, memPageCount - 1));
  }, [memPage, memPageCount]);
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
  const submitClose = async (task) => {
    setCloseBusy(true);
    setError(null);
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      const out = await api.closeTask(task.workspace, task.id, {
        artifact: closeArtifact,
        evaluation: closeEval,
        memoryRefs: refs
      });
      if (out.state === "active") {
        setError(`\u8BC1\u636E\u4ECD\u6709\u7F3A\u53E3\uFF1A${(out.gaps ?? []).join(", ")} \u2014 \u4EFB\u52A1\u4FDD\u6301 ACTIVE\uFF0C\u8865\u9F50\u540E\u518D\u63D0\u4EA4`);
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
  const openMemory = (id) => {
    const m = memories.find((mem) => mem.id === id);
    if (m) {
      setDetail({ kind: "memory", memory: m });
      setDetailNotice(null);
    } else {
      setDetailNotice(`\u8BB0\u5FC6 ${id} \u4E0D\u5728\u5F53\u524D\u52A0\u8F7D\u5217\u8868 \u2014 \u5207\u6362\u5230\u300C\u8BB0\u5FC6\u300D\u9875\u52A0\u8F7D\u540E\u53EF\u7528`);
    }
  };
  const openTask = (id) => {
    setDetail({ kind: "task", id });
    setDetailNotice(null);
  };
  const openNode = (id) => {
    setDetail({ kind: "node", id });
    setDetailNotice(null);
  };
  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  const gc = overview?.gc ?? null;
  const wsCounts = workspace && overview ? overview.workspaces[workspace] ?? null : null;
  const { vars } = useEngramTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { ...s2.root, ...vars }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h1", { style: s2.h1, children: "Engram \u8BB0\u5FC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { style: s2.sub, children: "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6 \xB7 \u96F6 LLM \u81EA\u52A8\u6355\u83B7 \xB7 \u7B26\u53F7\u7D22\u5F15\u6E10\u8FDB\u62AB\u9732 \u2014 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_engram.json" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.error, children: [
      t("error"),
      ": ",
      error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.tabBar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: view === "mem" ? s2.tabActive : s2.tab, onClick: () => setView("mem"), children: "\u8BB0\u5FC6" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: view === "esr" ? s2.tabActive : s2.tab, onClick: () => setView("esr"), children: "ESR\uFF08\u4EFB\u52A1 \xB7 \u8282\u70B9 \xB7 \u5173\u7CFB\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: view === "graph" ? s2.tabActive : s2.tab, onClick: () => setView("graph"), children: "\u5173\u7CFB\u56FE\u8C31" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: view === "preview" ? s2.tabActive : s2.tab, onClick: () => setView("preview"), children: "\u6CE8\u5165\u9884\u89C8" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: view === "telemetry" ? s2.tabActive : s2.tab, onClick: () => setView("telemetry"), children: "\u9065\u6D4B" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: "1 1 auto", minWidth: 0 }, children: [
        view === "mem" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
          overview && (() => {
            const memNum = wsCounts ? wsCounts.memories : overview.totals.memories;
            const taskNum = wsCounts ? wsCounts.tasks : overview.totals.tasks;
            const linkNum = wsCounts ? wsCounts.links : overview.totals.links;
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.stats, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(memNum), label: wsCounts ? "\u8BB0\u5FC6 (active)" : "\u8BB0\u5FC6 (active, \u5168\u5C40)" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(taskNum), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(linkNum), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(workspaces.length), label: "\u5DE5\u4F5C\u533A" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(overview.captures.total), label: "\u81EA\u52A8\u6355\u83B7" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                StatCard,
                {
                  num: indexCost ? `~${indexCost.tokens}` : "\u2013",
                  label: "[ENGRAM] \u7D22\u5F15 token / \u5DE5\u4F5C\u533A"
                }
              ),
              gc && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                StatCard,
                {
                  num: String(gc.archivedMemories + gc.archivedTasks),
                  label: `GC \u5DF2\u5F52\u6863 \xB7 \u94FE\u63A5-${gc.removedLinks}`
                }
              )
            ] });
          })(),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.subPanel, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontWeight: 700, fontSize: 13 }, children: "\u8BB0\u5FC6 GC\uFF08pi-esr \u7EA6\u675F\uFF09" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { style: { fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { type: "checkbox", checked: gcDryRun, onChange: (e) => setGcDryRun(e.target.checked) }),
                "\u4EC5\u9884\u89C8\uFF08dry run\uFF09"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btnPrimary, onClick: () => void runGc(), disabled: gcRunning || !workspace, children: gcRunning ? "\u2026" : "\u8FD0\u884C GC" }),
              gc && gc.lastRun > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.mono, children: [
                "\u4E0A\u6B21 ",
                fmtDate2(gc.lastRun)
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "\u5DE5\u4F5C\u96C6\uFF08active \u4EFB\u52A1\u5F15\u7528 / \u4EFB\u52A1\u8BB0\u5FC6 / \u5DF2\u5165\u7D22\u5F15\u547D\u4E2D\uFF09\u6C38\u4E0D\u9A71\u9010\uFF1BTTL \u8FC7\u671F\u5F52\u6863\u3001\u8D85\u5BB9\u91CF\u6DD8\u6C70\u3001stable \u4EFB\u52A1\u8D85\u7A97\u5F52\u6863\u3001\u60AC\u7A7A\u94FE\u63A5\u6E05\u7406\u3002\u53EA\u5F52\u6863\u4E0D\u786C\u5220\u2014\u2014\u6761\u76EE id \u4FDD\u6301\u53EF\u91CD\u53D6\u3002" }),
            gcReport && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: 8, fontSize: 12.5 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
                gcReport.dryRun ? "dry-run \u9884\u89C8\uFF1A" : "\u5DF2\u6267\u884C\uFF1A",
                " ",
                "\u5F52\u6863\u8BB0\u5FC6 ",
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("b", { children: gcReport.archivedMemories.length }),
                " \xB7 \u5F52\u6863\u4EFB\u52A1 ",
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("b", { children: gcReport.archivedTasks.length }),
                " \xB7 \u6E05\u7406\u94FE\u63A5 ",
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("b", { children: gcReport.removedLinks.length }),
                " \xB7 \u4FDD\u62A4 ",
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("b", { children: gcReport.protectedMemories })
              ] }),
              gcReport.archivedMemories.slice(0, 5).map((e) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.mono, children: [
                "- ",
                e.id.slice(0, 8),
                " ",
                e.reason,
                ": ",
                e.text
              ] }, e.id)),
              gcReport.archivedTasks.slice(0, 3).map((t2) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.mono, children: [
                "- ",
                t2.id.slice(0, 6),
                " ",
                t2.reason,
                ": ",
                t2.name
              ] }, t2.id)),
              gcReport.removedLinks.slice(0, 3).map((l) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.mono, children: [
                "- link ",
                l.source.slice(0, 8),
                " --",
                l.relation,
                "--> ",
                l.target.slice(0, 8)
              ] }, l.id))
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { style: s2.input, value: workspace, onChange: (e) => setWorkspace(e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "\u5168\u90E8\u5DE5\u4F5C\u533A" }),
              workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("option", { value: ws, children: [
                ws,
                "\uFF08",
                overview?.workspaces[ws]?.memories ?? 0,
                " \u6761\uFF09"
              ] }, ws))
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(-1), children: "\u2039 \u4E0A\u4E00\u5DE5\u4F5C\u533A" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(1), children: "\u4E0B\u4E00\u5DE5\u4F5C\u533A \u203A" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { style: s2.input, value: kind, onChange: (e) => setKind(e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "\u5168\u90E8\u7C7B\u578B" }),
              kindsPresent.map((k) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: k, children: KIND_LABEL2[k] ?? k }, k))
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { style: s2.input, value: status, onChange: (e) => setStatus(e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "active", children: "\u4EC5\u6D3B\u52A8" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "all", children: "\u5168\u90E8\u72B6\u6001" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "archived", children: "\u5DF2\u5F52\u6863" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "input",
              {
                style: { ...s2.input, width: 180 },
                placeholder: "\u641C\u7D22\u8BB0\u5FC6\u2026",
                value: q,
                onChange: (e) => setQ(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") void refresh();
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btnPrimary, onClick: () => void refresh(), disabled: busy, children: busy ? "\u2026" : t("refresh") })
          ] }),
          cfg && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
              "autoCapture ",
              cfg.autoCapture ? "on" : "off"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
              "sessionSearch ",
              cfg.sessionSearch ? "on" : "off"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
              "TTL ",
              cfg.expireDays,
              "d"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
              "index ",
              cfg.indexMaxLines,
              " \u884C / ",
              cfg.indexMaxChars,
              " \u5B57\u7B26"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
              "promote \u2265",
              cfg.promoteHits,
              " hits"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("table", { style: s2.table, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("colgroup", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("col", { style: { width: 58 } }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("col", {}),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("col", { style: { width: 72 } })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("th", { style: s2.th, children: "\u7C7B\u578B" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("th", { style: s2.th, children: "\u5185\u5BB9" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("th", { style: s2.th })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("tbody", { children: [
              flatRows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("td", { colSpan: 3, style: s2.empty, children: "\u6682\u65E0\u8BB0\u5FC6 \u2014 \u4F7F\u7528 engram_store \u663E\u5F0F\u8BB0\u5F55\uFF0C\u6216\u8BA9\u81EA\u52A8\u6355\u83B7\u5DE5\u4F5C\uFF08git \u63D0\u4EA4 / \u5173\u952E\u6587\u4EF6\u7F16\u8F91 / \u5DE5\u5177\u9519\u8BEF\uFF09" }) }),
              memPageRows.map(
                (r) => r.kind === "head" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("td", { colSpan: 3, style: s2.wsHead, children: [
                  r.ws,
                  " \xB7 ",
                  r.count,
                  " \u6761"
                ] }) }, `h-${r.ws}`) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("tr", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("td", { style: { ...s2.td, whiteSpace: "nowrap" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { ...s2.badge, background: KIND_COLORS2[r.m.kind] ?? "#6b7280" }, children: KIND_LABEL2[r.m.kind] ?? r.m.kind }),
                    r.m.status === "archived" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { ...s2.tag, color: "#b45309", background: "#fef3c7" }, children: "archived" })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("td", { style: { ...s2.td, minWidth: 0 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { title: r.m.text, style: expandedRows.has(r.m.id) ? s2.expanded : s2.clamp3, children: r.m.text }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 2, flexWrap: "wrap" }, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { ...s2.mono, ...s2.ellipsis, flex: "1 1 160px" }, title: `${fmtDate2(r.m.createdAt)} \xB7 ${r.m.id} \xB7 ${r.m.entity ?? ""} \xB7 signal ${r.m.signal.toFixed(2)} \xB7 hits ${r.m.hits} \xB7 TTL ${daysLeft2(r.m.expiresAt)}`, children: [
                        fmtDate2(r.m.createdAt),
                        " \xB7 ",
                        r.m.id.slice(0, 8),
                        r.m.entity ? ` \xB7 ${r.m.entity}` : "",
                        " \xB7 ",
                        r.m.signal.toFixed(2),
                        " \xB7 hits ",
                        r.m.hits,
                        " \xB7 ",
                        daysLeft2(r.m.expiresAt)
                      ] }),
                      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.linkBtn, onClick: () => toggleExpand(r.m.id), children: expandedRows.has(r.m.id) ? "\u6536\u8D77" : "\u5C55\u5F00\u5168\u6587" })
                    ] }),
                    r.m.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }, children: r.m.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: s2.tag, children: tag }, tag)) })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("td", { style: s2.td, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.linkBtn, title: "\u5728\u4FA7\u680F\u6253\u5F00\u8BE6\u60C5", onClick: () => {
                      setDetail({ kind: "memory", memory: r.m });
                      setDetailNotice(null);
                    }, children: "\u8BE6\u60C5" }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, title: "\u5F52\u6863\uFF08TTL/\u8F6F\u5220\uFF0C\u53EF\u6062\u590D\u4E0D\u8F7D\u5165\u7D22\u5F15\uFF09", onClick: () => void act(() => api.archive(r.m.id, r.m.workspace)), children: "\u5F52\u6863" }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, title: "\u6C38\u4E45\u5220\u9664", onClick: () => {
                      if (window.confirm(`\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6?
${r.m.text.slice(0, 60)}`)) void act(() => api.remove(r.m.id, r.m.workspace));
                    }, children: "\u5220\u9664" })
                  ] }) })
                ] }, r.m.id)
              )
            ] })
          ] }),
          flatRows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.pageBar, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, disabled: memPageSafe === 0, onClick: () => setMemPage(memPageSafe - 1), children: "\u2039 \u4E0A\u4E00\u9875" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
              "\u7B2C ",
              memPageSafe + 1,
              " / ",
              memPageCount,
              " \u9875 \xB7 \u5171 ",
              flatRows.length,
              " \u6761"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, disabled: memPageSafe >= memPageCount - 1, onClick: () => setMemPage(memPageSafe + 1), children: "\u4E0B\u4E00\u9875 \u203A" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { style: s2.input, value: memPageSafe, onChange: (e) => setMemPage(Number(e.target.value)), title: "\u8DF3\u9875", children: Array.from({ length: memPageCount }, (_, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("option", { value: i, children: [
              "\u7B2C ",
              i + 1,
              " \u9875"
            ] }, i)) })
          ] })
        ] }),
        view === "esr" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.stats, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(wsCounts ? wsCounts.tasks : overview?.totals.tasks ?? 0), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(wsCounts ? wsCounts.links : overview?.totals.links ?? 0), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview?.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.subPanel, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 6 }, children: [
              "agent \u884C\u4E3A\u89C2\u6D4B",
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }, children: " \xB7 \u6BCF\u6B21 engram_*/esr_* \u5DE5\u5177\u8C03\u7528\u5B9E\u65F6\u7D2F\u8BA1\uFF08\u771F\u5B9E\u6570\u636E\uFF0C\u6309\u5DE5\u4F5C\u533A/\u5929\u6EDA\u52A8\uFF09" })
            ] }),
            !usageStats ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.mono, children: "\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "ESR \u4E3B\u52A8\u6027 ",
                  pct2(usageStats.ratios.esrRatio),
                  "\uFF08",
                  usageStats.ratios.esrCalls,
                  "/",
                  usageStats.ratios.calls,
                  " \u6B21\uFF09"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "\u53EC\u56DE\u547D\u4E2D\u7387 ",
                  pct2(usageStats.ratios.recallHitRate)
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "\u5E73\u5747\u547D\u4E2D ",
                  usageStats.ratios.recallHitsPerQuery ?? "\u2013",
                  "/\u67E5\u8BE2"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "detail \u8F6C\u5316 ",
                  pct2(usageStats.ratios.detailFollowRate)
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "\u5931\u8D25 ",
                  usageStats.totals.failures
                ] }),
                usageStats.ratios.calls < 10 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  "\u6837\u672C\u4E0D\u8DB3\uFF08",
                  usageStats.ratios.calls,
                  " \u6B21\uFF09\uFF0C\u6BD4\u4F8B\u4EC5\u4F9B\u53C2\u8003"
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "ESR \u4E3B\u52A8\u6027\u8FC7\u4F4E\u65F6\uFF0C\u4E0B\u4E00\u4E2A\u4F1A\u8BDD\u7684 [ESR] \u6CE8\u5165\u5757\u4F1A\u9644\u52A0\u4E00\u884C\u57FA\u4E8E\u771F\u5B9E\u6570\u636E\u7684 escalate \u63D0\u9192\uFF0C\u5F15\u5BFC\u6A21\u578B\u5F53\u573A\u8865\u5EFA\u4EFB\u52A1/\u8282\u70B9/\u5173\u7CFB\u2014\u2014\u6BD4\u4F8B\u56DE\u5347\u540E\u63D0\u9192\u81EA\u52A8\u6D88\u5931\u3002" }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: [
                "\u5DE5\u5177\u8C03\u7528\uFF1A",
                Object.entries(usageStats.totals.counts).map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: s2.tag, children: [
                  k,
                  " \xD7",
                  v
                ] }, k))
              ] }),
              usageStats.byDay.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }, children: usageStats.byDay.map((d) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
                d.day,
                " \xB7 \u8C03\u7528 ",
                Object.values(d.counts).reduce((a, b) => a + b, 0),
                " \xB7 \u5931\u8D25 ",
                d.failures
              ] }, d.day)) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.panelTitle, children: [
            "ESR \u4EFB\u52A1\uFF08\u8BC1\u636E\u95ED\u73AF\uFF09",
            workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.subPanel, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { style: s2.input, value: newTaskWs, onChange: (e) => setNewTaskWs(e.target.value), children: [
              workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: "(no workspaces)" }),
              workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: ws, children: ws }, ws))
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { style: { ...s2.input, width: 170 }, placeholder: "\u4EFB\u52A1\u540D\u2026", value: newTaskName, onChange: (e) => setNewTaskName(e.target.value), onKeyDown: (e) => {
              if (e.key === "Enter") void createNewTask();
            } }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { style: { ...s2.input, width: 240 }, placeholder: "\u8981\u4EA7\u51FA / \u6EE1\u8DB3\u4EC0\u4E48\uFF08\u53EF\u9009\uFF09", value: newTaskDesc, onChange: (e) => setNewTaskDesc(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btnPrimary, disabled: newTaskBusy || newTaskName.trim() === "", onClick: () => void createNewTask(), children: newTaskBusy ? "\u2026" : "\u65B0\u5EFA\u4EFB\u52A1" })
          ] }) }),
          tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.empty, children: "\u6682\u65E0\u4EFB\u52A1 \u2014 \u7528\u4E0A\u65B9\u300C\u65B0\u5EFA\u4EFB\u52A1\u300D\u6216 esr_task \u5DE5\u5177\u521B\u5EFA" }),
          taskGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_react7.Fragment, { children: [
            workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.groupLabel, children: [
              ws,
              " \xB7 ",
              items.length,
              " \u4E2A\u4EFB\u52A1"
            ] }),
            items.map((task) => {
              const gaps = taskGaps2(task);
              const isStable = task.state === "stable";
              return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.subPanel, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontWeight: 600, fontSize: 13 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: s2.mono, children: task.id.slice(0, 6) }),
                  " ",
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                    EvidenceRing,
                    {
                      artifact: Boolean(task.artifact),
                      evaluation: Boolean(task.evaluation),
                      refs: (task.memoryRefs?.length ?? 0) > 0,
                      size: 22
                    }
                  ),
                  " ",
                  task.name,
                  " ",
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { ...s2.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }, children: isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE" }),
                  !isStable && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, onClick: () => setCloseFor(closeFor === task.id ? null : task.id), children: closeFor === task.id ? "\u6536\u8D77" : "\u586B\u5199\u8BC1\u636E\u5173\u95ED\u2026" }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.linkBtn, title: "\u5728\u4FA7\u680F\u6253\u5F00\u8BE6\u60C5", onClick: () => openTask(task.id), children: "\u8BE6\u60C5" })
                ] }),
                !isStable && gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: [
                  "\u7F3A\u53E3\uFF1A",
                  gaps.join(", "),
                  " \u2014 \u63D0\u4F9B artifact / evaluation / memory_ref \u540E\u8F6C\u4E3A STABLE"
                ] }),
                task.description && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }, children: task.description }),
                task.memoryRefs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 12, marginTop: 4 }, children: [
                  "\u8BB0\u5FC6\u5F15\u7528\uFF1A",
                  task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: s2.tag, children: r.slice(0, 8) }, r))
                ] }),
                closeFor === task.id && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: 8, padding: 8, border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }, children: "\u63D0\u4F9B\u8BC1\u636E\u540E\u5173\u95ED\uFF08\u4E09\u9879\u5168\u9F50\u624D\u8F6C STABLE\uFF09" }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { style: { ...s2.input, width: 150 }, placeholder: "artifact \u8DEF\u5F84/URL", value: closeArtifact, onChange: (e) => setCloseArtifact(e.target.value) }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { style: { ...s2.input, width: 150 }, placeholder: "evaluation \u9A8C\u8BC1\u8BC1\u636E", value: closeEval, onChange: (e) => setCloseEval(e.target.value) }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { style: { ...s2.input, width: 150 }, placeholder: "memory_refs \u9017\u53F7\u5206\u9694", value: closeRefs, onChange: (e) => setCloseRefs(e.target.value) }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btnPrimary, disabled: closeBusy, onClick: () => void submitClose(task), children: closeBusy ? "\u2026" : "\u63D0\u4EA4\u5173\u95ED" }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { style: s2.btn, onClick: () => setCloseFor(null), children: "\u53D6\u6D88" })
                  ] })
                ] })
              ] }, task.id);
            })
          ] }, ws)),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.panelTitle, children: [
            "\u8282\u70B9\u4E0E\u5173\u7CFB\uFF08esr_node / esr_link\uFF09",
            workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
          ] }),
          nodes.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.empty, children: "\u6682\u65E0\u8282\u70B9 \u2014 \u6A21\u578B\u4F1A\u4E3A\u53CD\u590D\u51FA\u73B0\u7684\u9886\u57DF\u5BF9\u8C61\u4E3B\u52A8\u767B\u8BB0\uFF08esr_node\uFF09\uFF0C\u6B64\u5904\u4E5F\u53EF\u67E5\u770B\u5173\u7CFB" }),
          nodeGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_react7.Fragment, { children: [
            workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.groupLabel, children: [
              ws,
              " \xB7 ",
              items.length,
              " \u4E2A\u8282\u70B9"
            ] }),
            items.map((n) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { fontSize: 12.5, padding: "2px 0", cursor: "pointer", borderRadius: 6 }, title: "\u5728\u4FA7\u680F\u6253\u5F00\u8282\u70B9\u8BE6\u60C5", onClick: () => openNode(n.id), children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "mono", style: { ...s2.mono, color: "#4338ca" }, children: n.id.slice(0, 24) }),
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontWeight: 600 }, children: n.name }),
              n.kind && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { ...s2.tag, color: "#4338ca", background: "#eef2ff" }, children: n.kind }),
              n.description && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { color: "var(--dsh-color-muted, #6b7280)" }, children: [
                " \u2014 ",
                n.description.slice(0, 48)
              ] })
            ] }, n.id))
          ] }, ws)),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 6 }, children: "\u5173\u7CFB\uFF1A" }),
          links.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.empty, children: "\u6682\u65E0\u5173\u7CFB \u2014 esr_link \u521B\u5EFA" }),
          linkGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_react7.Fragment, { children: [
            workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.groupLabel, children: [
              ws,
              " \xB7 ",
              items.length,
              " \u6761\u5173\u7CFB"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }, children: items.map((l) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { ...s2.relRow, cursor: "pointer" }, title: "\u5728\u4FA7\u680F\u6253\u5F00\u5173\u7CFB\u8BE6\u60C5", onClick: () => {
              setDetail({ kind: "link", link: l });
              setDetailNotice(null);
            }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "mono", style: s2.nodePill, title: l.source, children: nameOf(l.source) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--dsh-color-muted, #6b7280)" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { border: "1px dashed var(--dsh-color-border, #cbd5e1)", borderRadius: 999, padding: "1px 7px" }, children: l.relation }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { "aria-hidden": true, children: "\u2192" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "mono", style: s2.nodePill, title: l.target, children: nameOf(l.target) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: [
                "\xB7 ",
                fmtDate2(l.createdAt)
              ] })
            ] }, l.id)) })
          ] }, ws))
        ] }),
        view === "graph" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: s2.subPanel, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontWeight: 700, fontSize: 13 }, children: "\u5173\u7CFB\u56FE\u8C31\uFF08esr_link \u529B\u5BFC\u5411\u56FE\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }, children: [
              workspace === "" ? "\u5168\u90E8\u5DE5\u4F5C\u533A" : `\u5DE5\u4F5C\u533A\uFF1A${workspace}`,
              " \xB7 \u5B9E\u4F53\u4E3A\u5706\u5F62\u8282\u70B9\uFF0C\u4EFB\u52A1\u4E3A\u52FE\u9009\u5FBD\u6807\uFF1B\u70B9\u9009\u8282\u70B9\u67E5\u770B\u5173\u7CFB\u660E\u7EC6"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            EngramGraph,
            {
              workspace,
              entities: nodes,
              tasks,
              links,
              nameOf
            }
          )
        ] }),
        view === "preview" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.subPanel, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(EngramPreview, { api, workspace, workspaces }) }),
        view === "telemetry" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: s2.subPanel, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(EngramTelemetry, { api, workspace }) })
      ] }),
      detail && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: "0 0 320px", maxWidth: "38%", position: "sticky", top: 8 }, children: [
        detailNotice && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { fontSize: 11.5, padding: "6px 10px", marginBottom: 6, borderRadius: 8, background: "rgba(245,158,11,.14)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)" }, children: detailNotice }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          EngramDetail,
          {
            target: detail,
            api,
            memories,
            tasks,
            nodes,
            links,
            onClose: () => setDetail(null),
            onNavigateMemory: openMemory,
            onChanged: () => void refresh()
          }
        )
      ] })
    ] })
  ] });
}

// client/src/EngramConfigCard.tsx
var import_react8 = require("react");
var import_jsx_runtime8 = require("react/jsx-runtime");
var GROUPS = [
  {
    id: "capture",
    title: "\u6355\u83B7\u4E0E\u68C0\u7D22",
    description: "\u96F6 LLM \u81EA\u52A8\u6355\u83B7\u4E0E\u8DE8\u4F1A\u8BDD\u641C\u7D22",
    fields: [
      { key: "autoCapture", label: "\u81EA\u52A8\u6355\u83B7", hint: "\u96F6 LLM \u4ECE\u5DE5\u5177\u7ED3\u679C\u63D0\u53D6\u8BB0\u5FC6\uFF08git/\u5173\u952E\u6587\u4EF6/\u9519\u8BEF\uFF09", kind: "bool" },
      { key: "autoCapturePerSession", label: "\u6BCF\u4F1A\u8BDD\u6355\u83B7\u4E0A\u9650", hint: "\u5355\u4F1A\u8BDD\u81EA\u52A8\u6355\u83B7\u6761\u6570\u4E0A\u9650", kind: "num", min: 0, max: 1e3 },
      { key: "sessionSearch", label: "\u4F1A\u8BDD\u5386\u53F2\u641C\u7D22", hint: "engram_recall \u652F\u6301\u8DE8\u4F1A\u8BDD FTS \u515C\u5E95", kind: "bool" }
    ]
  },
  {
    id: "index",
    title: "\u7D22\u5F15",
    description: "[ENGRAM] \u5757\u7684\u5185\u5BB9\u9884\u7B97\u4E0E\u664B\u5347\u89C4\u5219",
    fields: [
      { key: "indexMaxLines", label: "\u7D22\u5F15\u6700\u5927\u884C\u6570", hint: "[ENGRAM] \u5757\u6700\u591A\u663E\u793A\u7684\u6761\u76EE\u884C\u6570", kind: "num", min: 0, max: 50 },
      { key: "indexMaxChars", label: "\u7D22\u5F15\u5B57\u7B26\u4E0A\u9650", hint: "[ENGRAM] \u5757 token \u9884\u7B97", kind: "num", min: 0, max: 4e3 },
      { key: "minIndexSignal", label: "\u5165\u7D22\u5F15\u4FE1\u53F7\u9608\u503C", hint: "signal \u2265 \u6B64\u503C\u7684\u81EA\u52A8\u6355\u83B7\u624D\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 1, step: 0.05 },
      { key: "promoteHits", label: "\u664B\u5347\u547D\u4E2D\u6570", hint: "hit \u6570\u8FBE\u6B64\u503C\u7684\u4F4E\u4FE1\u53F7\u6761\u76EE\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 20 }
    ]
  },
  {
    id: "retention",
    title: "\u751F\u547D\u5468\u671F\u4E0E GC",
    description: "\u8FC7\u671F\u3001\u5BB9\u91CF\u4E0A\u9650\u4E0E\u5B9A\u671F\u56DE\u6536",
    fields: [
      { key: "expireDays", label: "TTL\uFF08\u5929\uFF09", hint: "0 = \u4E0D\u8FC7\u671F", kind: "num", min: 0, max: 3650 },
      { key: "maxMemoriesPerWorkspace", label: "\u5DE5\u4F5C\u533A\u8BB0\u5FC6\u4E0A\u9650", kind: "num", min: 0, max: 1e4 },
      { key: "gcEnabled", label: "\u8BB0\u5FC6 GC", hint: "\u5B9A\u65F6\u56DE\u6536\uFF08\u8FC7\u671F/\u8D85\u5BB9\u91CF/stable \u8D85\u7A97/\u60AC\u7A7A\u94FE\u63A5\uFF09", kind: "bool" },
      { key: "gcStableRetentionDays", label: "stable \u4EFB\u52A1\u4FDD\u7559\uFF08\u5929\uFF09", hint: "\u8D85\u7A97\u540E\u7531 GC \u5F52\u6863\u3001\u79BB\u5F00 [ESR] \u8868\u9762", kind: "num", min: 0, max: 3650 }
    ]
  },
  {
    id: "security",
    title: "\u5B89\u5168",
    description: "\u8BBF\u95EE\u56F4\u680F\u4E0E\u96A7\u9053\u6388\u6743",
    fields: [
      { key: "trustedHosts", label: "\u53D7\u4FE1\u96A7\u9053\u57DF\u540D", hint: "\u5141\u8BB8\u7ECF\u96A7\u9053\u8BBF\u95EE\u8BB0\u5FC6\u67E5\u770B\u5668\u7684\u57DF\u540D\uFF0C\u9017\u53F7\u5206\u9694\uFF1B\u7559\u7A7A = \u4EC5\u672C\u673A\u3002\u6539\u540E\u9700\u91CD\u542F dsh web \u751F\u6548", kind: "text", width: 260 }
    ]
  }
];
var FIELDS = GROUPS.flatMap((group) => group.fields);
var CARD_DESCRIPTION = "\u63A7\u5236 engram \u8BB0\u5FC6\u7684\u6355\u83B7\u3001\u7D22\u5F15\u3001\u4FDD\u7559\u4E0E\u96A7\u9053\u8BBF\u95EE";
var s3 = {
  card: {
    listStyle: "none",
    border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    borderRadius: 12,
    background: "var(--dsw-alias-bg-layer-3, #ffffff)",
    transition: "border-color .16s, background .16s"
  },
  cardOpen: {
    background: "var(--dsw-alias-bg-layer-2, #ffffff)",
    borderColor: "var(--dsw-alias-label-dimmed, #9ca3af)"
  },
  header: {
    width: "100%",
    appearance: "none",
    border: 0,
    background: "none",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 12
  },
  headText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4
  },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary, #111827)" },
  description: { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  pending: {
    flex: "none",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    lineHeight: "17px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    background: "var(--dsw-alias-bg-module-platform, #f3f4f6)",
    color: "var(--dsw-alias-label-secondary, #4b5563)"
  },
  body: {
    borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    margin: "0 16px",
    paddingBottom: 8
  },
  readOnly: { margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  groupPanel: {
    marginTop: 10,
    border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    borderRadius: 10,
    padding: "8px 12px 2px",
    background: "var(--dsw-alias-bg-layer-3, #ffffff)"
  },
  groupHead: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 },
  groupTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 0.2, color: "var(--dsw-alias-label-primary, #111827)" },
  groupDesc: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid var(--dsw-alias-border-l1, #f3f4f6)"
  },
  label: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #111827)" },
  hint: { fontSize: 11.5, lineHeight: 1.4, color: "var(--dsw-alias-label-tertiary, #6b7280)", marginTop: 2 },
  input: {
    width: 90,
    border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
    borderRadius: 6,
    padding: "4px 7px",
    fontSize: 12.5,
    background: "var(--dsw-alias-bg-layer-3, #fff)",
    color: "inherit"
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 0 4px",
    borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)"
  },
  reset: {
    appearance: "none",
    border: 0,
    background: "none",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    color: "var(--dsw-alias-label-tertiary, #6b7280)"
  },
  discard: {
    appearance: "none",
    border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
    borderRadius: 8,
    padding: "5px 14px",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    cursor: "pointer",
    background: "none",
    color: "var(--dsw-alias-label-secondary, #4b5563)"
  },
  save: {
    appearance: "none",
    border: "1px solid transparent",
    borderRadius: 8,
    padding: "5px 14px",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    cursor: "pointer",
    background: "var(--dsw-alias-label-primary, #111827)",
    color: "var(--dsw-alias-bg-layer-3, #ffffff)"
  },
  disabled: { opacity: 0.4, cursor: "default" },
  failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: "#dc2626" },
  note: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)", marginTop: 8 }
};
function Chevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 14 14",
      "aria-hidden": "true",
      style: {
        flex: "none",
        color: "var(--dsw-alias-label-tertiary, #6b7280)",
        transition: "transform .16s",
        transform: open ? "rotate(180deg)" : void 0
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "path",
        {
          d: "M3 5.5 L7 9 L11 5.5",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.6",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      )
    }
  );
}
function EngramConfigCard({ scope }) {
  const [snap, setSnap] = (0, import_react8.useState)(null);
  const [draft, setDraft] = (0, import_react8.useState)({});
  const [saving, setSaving] = (0, import_react8.useState)(false);
  const [error, setError] = (0, import_react8.useState)(null);
  const [open, setOpen] = (0, import_react8.useState)(false);
  (0, import_react8.useEffect)(() => {
    void scope.load();
    const off = scope.subscribe(() => {
      const next = scope.getSnapshot();
      setSnap(next);
      const value2 = next.value ?? next.base;
      if (value2) setDraft((prev) => ({ ...value2, ...prev }));
    });
    setSnap(scope.getSnapshot());
    return off;
  }, [scope]);
  const setField = (0, import_react8.useCallback)((key, value2) => {
    setDraft((prev) => ({ ...prev, [key]: value2 }));
  }, []);
  const effective = snap?.value ?? snap?.base ?? {};
  const anyDirty = FIELDS.some((field) => {
    const staged = draft[field.key];
    return staged !== void 0 && staged !== effective[field.key];
  });
  const save = (0, import_react8.useCallback)(async () => {
    setSaving(true);
    setError(null);
    try {
      for (const field of FIELDS) {
        const value2 = draft[field.key];
        if (value2 === void 0) continue;
        if (value2 === effective[field.key]) continue;
        if (typeof value2 === "number" && Number.isNaN(value2)) continue;
        await scope.set(field.key, value2);
      }
      await scope.load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }, [draft, scope, effective]);
  const discard = (0, import_react8.useCallback)(() => {
    setError(null);
    const value2 = snap?.value ?? snap?.base ?? {};
    setDraft({ ...value2 });
  }, [snap]);
  const resetField = (0, import_react8.useCallback)(async (key) => {
    setError(null);
    try {
      await scope.unset(key);
      await scope.load();
      setDraft((prev) => ({ ...prev, [key]: void 0 }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [scope]);
  const value = { ...snap?.base ?? {}, ...draft };
  const writable = snap?.writable !== false && snap?.status !== "unavailable";
  const available = snap?.status === "ready";
  const { vars } = useEngramTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: vars, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: available ? { ...s3.card, ...open ? s3.cardOpen : void 0 } : { display: "none" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "button",
      {
        type: "button",
        style: s3.header,
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"} dsh-engram \u8BBE\u7F6E`,
        onClick: () => setOpen((prev) => !prev),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: s3.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: s3.name, children: "dsh-engram" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: s3.description, children: CARD_DESCRIPTION })
          ] }),
          anyDirty && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: s3.pending, children: "\u672A\u4FDD\u5B58" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Chevron, { open })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: s3.body, children: [
      !writable && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: s3.readOnly, children: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF08\u5BBF\u4E3B\u672A\u6388\u6743\u5199\u5165\u6216\u9700\u91CD\u542F\u5E94\u7528\uFF09\u3002" }),
      GROUPS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: s3.groupPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: s3.groupHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.groupTitle, children: group.title }),
          group.description && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.groupDesc, children: group.description })
        ] }),
        group.fields.map((field) => {
          const raw = value[field.key];
          const overridden = snap?.user !== void 0 && field.key in snap.user;
          return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: s3.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.label, children: field.label }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.hint, children: field.hint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              field.kind === "bool" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: raw === true,
                  disabled: !writable,
                  onChange: (e) => setField(field.key, e.target.checked)
                }
              ) : field.kind === "text" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  type: "text",
                  style: { ...s3.input, width: field.width ?? 180 },
                  value: Array.isArray(raw) ? raw.join(", ") : raw === void 0 ? "" : String(raw),
                  disabled: !writable,
                  placeholder: "host.domain, \u53E6\u4E00\u57DF\u540D\u2026",
                  onChange: (e) => {
                    const tokens = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
                    setField(field.key, tokens);
                  }
                }
              ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "input",
                {
                  type: "number",
                  style: s3.input,
                  step: field.step ?? 1,
                  min: field.min,
                  max: field.max,
                  value: raw === void 0 ? "" : String(raw),
                  disabled: !writable,
                  onChange: (e) => setField(field.key, e.target.value === "" ? void 0 : Number(e.target.value))
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "button",
                {
                  type: "button",
                  style: overridden ? { ...s3.reset, color: "var(--dsw-alias-brand-primary, #2563eb)" } : { ...s3.reset, cursor: "default", opacity: 0.55 },
                  title: "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4",
                  disabled: !writable || !overridden,
                  onClick: () => void resetField(field.key),
                  children: "\u91CD\u7F6E"
                }
              )
            ] })
          ] }, field.key);
        })
      ] }, group.id)),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.note, children: "\u8BBE\u7F6E\u5BF9\u65B0\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u5DF2\u51BB\u7ED3\u7684 [ENGRAM] \u5757\u4FDD\u6301\u524D\u7F00\u7A33\u5B9A\u3002" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: s3.failed, children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: s3.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            type: "button",
            style: { ...s3.discard, ...!anyDirty || saving ? s3.disabled : void 0 },
            disabled: !anyDirty || saving,
            onClick: discard,
            children: "\u653E\u5F03\u4FEE\u6539"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "button",
          {
            type: "button",
            style: { ...s3.save, ...!anyDirty || saving ? s3.disabled : void 0 },
            disabled: !anyDirty || saving,
            onClick: () => void save(),
            children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
          }
        )
      ] })
    ] })
  ] }) });
}

// client/src/scope.ts
var LOADING = {
  status: "loading",
  value: void 0,
  base: void 0,
  user: void 0,
  revision: 0,
  writable: false
};
var EngramScopeImpl = class {
  constructor(api, ns, opts = { writable: true }) {
    this.api = api;
    this.ns = ns;
    this.opts = opts;
  }
  api;
  ns;
  opts;
  listeners = /* @__PURE__ */ new Set();
  snapshot = LOADING;
  disposed = false;
  getSnapshot() {
    return this.snapshot;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    for (const listener of this.listeners) listener();
  }
  fail(reason, writable = false) {
    this.snapshot = { status: "unavailable", value: void 0, base: void 0, user: void 0, revision: 0, writable, reason };
    this.notify();
  }
  async load() {
    if (this.disposed) return;
    this.snapshot = LOADING;
    this.notify();
    try {
      const response = await this.api.settings.describe({});
      const result = response?.result;
      if (!result || result.ok !== true) {
        const err = result && "error" in result ? result.error : { code: "settings.describe", message: "unreachable" };
        this.fail(`settings.describe failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
        return;
      }
      const payload = result.value;
      const view = payload.namespaces?.find((n) => n.ns === this.ns);
      if (!view) {
        this.fail(`the '${this.ns}' settings namespace is not served by this host.`);
        return;
      }
      const applied = view.applies === "live";
      const viewValue = view.value ?? view.base;
      this.snapshot = {
        status: "ready",
        value: viewValue,
        base: view.base ?? view.value,
        user: view.user,
        revision: view.revision ?? 0,
        writable: this.opts.writable !== false && payload.writable !== false && applied
      };
      this.notify();
    } catch (error) {
      this.fail(`settings.describe threw: ${String(error instanceof Error ? error.message : error)}`);
    }
  }
  async mutate(op) {
    const revision = this.snapshot.revision;
    const response = await this.api.settings.mutate({
      ns: this.ns,
      ops: [op],
      ...revision ? { expectedRevision: revision } : {}
    });
    const result = response?.result;
    if (!result || result.ok !== true) {
      const err = result && "error" in result ? result.error : { code: "settings.mutate", message: "unreachable" };
      throw new Error(`settings.mutate failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
    }
    const view = result.value;
    if (view) this.snapshot = { ...this.snapshot, revision: view.revision ?? revision };
  }
  async set(key, value) {
    await this.mutate({ op: "set", path: [String(key)], value });
    this.notify();
  }
  async unset(key) {
    await this.mutate({ op: "unset", path: [String(key)] });
    this.notify();
  }
};

// client/src/EngramBoardMount.tsx
var import_client = require("react-dom/client");

// client/src/EngramBoard.tsx
var import_react9 = require("react");
var import_jsx_runtime9 = require("react/jsx-runtime");
function taskGaps3(t) {
  const gaps = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}
var COLUMNS = [
  { key: "draft", title: "\u8349\u7A3F", sub: "\u672A\u88AB\u6FC0\u6D3B", color: "#94a3b8", match: (t) => t.state === "draft" },
  { key: "gapped", title: "\u8FDB\u884C\u4E2D", sub: "\u8BC1\u636E\u6709\u7F3A\u53E3", color: "#f59e0b", match: (t) => t.state === "active" && taskGaps3(t).length > 0 },
  { key: "ready", title: "\u5C31\u7EEA", sub: "\u8BC1\u636E\u9F50\uFF0C\u53EF\u95ED\u73AF", color: "#10b981", match: (t) => t.state === "active" && taskGaps3(t).length === 0 },
  { key: "stable", title: "\u5DF2\u95ED\u73AF", sub: "\u51ED\u636E\u9F50\u5907", color: "#6366f1", match: (t) => t.state === "stable" }
];
var fmtDate3 = (ts) => ts ? new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "\u2013";
function shortId(id) {
  return id.length > 12 ? `${id.slice(0, 6)}\u2026${id.slice(-4)}` : id;
}
function EngramBoard({ api, onRequestClose }) {
  const { vars } = useEngramTheme();
  const [overview, setOverview] = (0, import_react9.useState)(null);
  const [tasksByWs, setTasksByWs] = (0, import_react9.useState)({});
  const [loading, setLoading] = (0, import_react9.useState)(true);
  const [denied, setDenied] = (0, import_react9.useState)(false);
  const [error, setError] = (0, import_react9.useState)(null);
  const [ws, setWs] = (0, import_react9.useState)("");
  const [q, setQ] = (0, import_react9.useState)("");
  const [creating, setCreating] = (0, import_react9.useState)(false);
  const [newName, setNewName] = (0, import_react9.useState)("");
  const [newDesc, setNewDesc] = (0, import_react9.useState)("");
  const [newWs, setNewWs] = (0, import_react9.useState)("");
  const [busy, setBusy] = (0, import_react9.useState)(false);
  const [closingFor, setClosingFor] = (0, import_react9.useState)(null);
  const [closeArtifact, setCloseArtifact] = (0, import_react9.useState)("");
  const [closeEval, setCloseEval] = (0, import_react9.useState)("");
  const [closeRefs, setCloseRefs] = (0, import_react9.useState)("");
  const loadedWs = (0, import_react9.useRef)(/* @__PURE__ */ new Set());
  const refresh = (0, import_react9.useCallback)(async () => {
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
          return [w, res ? res.items : null];
        })
      );
      setTasksByWs((prev) => {
        const next = { ...prev };
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
  (0, import_react9.useEffect)(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2e4);
    return () => clearInterval(id);
  }, [refresh]);
  (0, import_react9.useEffect)(() => {
    if (!ws || denied) return;
    const id = setInterval(() => {
      const fetchWs = async () => {
        try {
          const res = await api.tasks(ws, true);
          setTasksByWs((prev) => ({ ...prev, [ws]: res.items }));
        } catch {
        }
      };
      void fetchWs();
    }, 2e4);
    return () => clearInterval(id);
  }, [ws, denied, api]);
  const workspaces = (0, import_react9.useMemo)(
    () => overview ? Object.entries(overview.workspaces).sort((a, b) => b[1].tasks - a[1].tasks) : [],
    [overview]
  );
  const totalActive = (0, import_react9.useMemo)(
    () => workspaces.reduce((a, [, w]) => a + (w.tasks ?? 0), 0),
    [workspaces]
  );
  const allTasks = (0, import_react9.useMemo)(() => Object.values(tasksByWs).flat(), [tasksByWs]);
  const evidenceGauge = (0, import_react9.useMemo)(() => {
    let active = 0;
    let gateTotal = 0;
    let gateFilled = 0;
    let ready = 0;
    let stable = 0;
    for (const t of allTasks) {
      if (t.state === "stable") {
        stable += 1;
        continue;
      }
      if (t.state === "draft") continue;
      active += 1;
      const gates = taskGaps3(t);
      gateTotal += 3;
      gateFilled += 3 - gates.length;
      if (gates.length === 0) ready += 1;
    }
    return { active, gateTotal, gateFilled, ready, stable, frac: gateTotal > 0 ? gateFilled / gateTotal : 0 };
  }, [allTasks]);
  const filtered = (0, import_react9.useMemo)(() => {
    const needle = q.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (ws !== "" && t.workspace !== ws) return false;
      if (needle === "") return true;
      return `${t.name} ${t.description ?? ""} ${t.id}`.toLowerCase().includes(needle);
    });
  }, [allTasks, ws, q]);
  const columnCounts = (0, import_react9.useMemo)(() => {
    const counts = {};
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
  const submitClose = async (t) => {
    setBusy(true);
    try {
      const refs = closeRefs.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      await api.closeTask(t.workspace, t.id, { artifact: closeArtifact, evaluation: closeEval, memoryRefs: refs });
      setClosingFor(null);
      setCloseArtifact("");
      setCloseEval("");
      setCloseRefs("");
      const res = await api.tasks(t.workspace, true);
      setTasksByWs((prev) => ({ ...prev, [t.workspace]: res.items }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-engram-board": "true", style: { ...vars, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.header, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { color: "var(--dsw-alias-label-primary-bluish, #4338ca)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "2.5", stroke: "currentColor", strokeWidth: "1.3" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("path", { d: "M5.2 8.1l1.8 1.8 3.8-4", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.title, children: "ESR \u4EFB\u52A1\u770B\u677F" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.sub, children: "draft \u2192 active(\u8BC1\u636E) \u2192 stable \xB7 \u8DE8\u5DE5\u4F5C\u533A \xB7 \u4E0E esr_task/esr_close \u540C\u4E00\u8BC1\u636E\u95E8" }),
      loading && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.loading, children: "\u2026" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { flex: "1 1 auto" } }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, title: `\u8BC1\u636E\u5B8C\u5907\u5EA6 ${Math.round(evidenceGauge.frac * 100)}% \xB7 ${evidenceGauge.ready}/${evidenceGauge.active} \u4E2A\u8FDB\u884C\u4E2D\u4EFB\u52A1\u8BC1\u636E\u9F50 \xB7 ${evidenceGauge.stable} \u5DF2\u95ED\u73AF`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(EvidenceRing, { artifact: false, evaluation: false, refs: false, size: 30, showLabel: false, fraction: evidenceGauge.frac }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary, var(--dsh-color-muted, #6b7280))", fontWeight: 600 }, children: evidenceGauge.active === 0 ? "\u65E0\u8FDB\u884C\u4E2D" : `${evidenceGauge.ready} \u5C31\u7EEA \xB7 \u5B8C\u5907 ${Math.round(evidenceGauge.frac * 100)}%` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("select", { style: hb.select, value: ws, onChange: (e) => setWs(e.target.value), title: "\u5DE5\u4F5C\u533A\u7B5B\u9009", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("option", { value: "", children: [
          "\u5168\u90E8\u5DE5\u4F5C\u533A \xB7 ",
          totalActive,
          " \u8FDB\u884C\u4E2D"
        ] }),
        workspaces.map(([w, c]) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("option", { value: w, children: [
          w.replace(/^.*[\\/]/, ""),
          " \xB7 ",
          c.tasks,
          " \u8FDB\u884C\u4E2D"
        ] }, w))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        "input",
        {
          style: { ...hb.input, width: 170 },
          placeholder: "\u641C\u7D22\u4EFB\u52A1\u2026",
          value: q,
          onChange: (e) => setQ(e.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btn, onClick: () => {
        setCreating((v) => !v);
        setClosingFor(null);
      }, children: "\uFF0B \u65B0\u5EFA" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btn, onClick: () => void refresh(), disabled: loading, title: "\u5237\u65B0", children: "\u5237\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.close, onClick: onRequestClose, "aria-label": "\u5173\u95ED\u770B\u677F", children: "\u2715" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { padding: "0 14px" }, children: [
      denied && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.warn, children: "ESR \u770B\u677F\u6570\u636E\u4E0D\u53EF\u8FBE\uFF08loopback-only \u5B88\u536B\uFF09\u2014 \u4EFB\u52A1/\u5173\u7CFB\u5C06\u65E0\u6CD5\u52A0\u8F7D\uFF1B\u8BF7\u901A\u8FC7\u672C\u673A\u8BBF\u95EE GUI\uFF0C\u6216\u653E\u5165\u53D7\u4FE1\u7F51\u7EDC\u8BBF\u95EE\u3002" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: hb.error, children: [
        "\u26A0 ",
        error
      ] }),
      creating && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: hb.createForm, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("select", { style: hb.select, value: newWs, onChange: (e) => setNewWs(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "", children: "\u9009\u62E9\u5DE5\u4F5C\u533A\u2026" }),
          workspaces.map(([w]) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: w, children: w.replace(/^.*[\\/]/, "") }, w))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { style: { ...hb.input, flex: "1 1 200px" }, placeholder: "\u4EFB\u52A1\u540D\u2026", value: newName, onChange: (e) => setNewName(e.target.value), onKeyDown: (e) => {
          if (e.key === "Enter") void submitCreate();
        }, autoFocus: true }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { style: { ...hb.input, flex: "1 1 240px" }, placeholder: "\u8981\u4EA7\u51FA / \u6EE1\u8DB3\u4EC0\u4E48\uFF08\u53EF\u9009\uFF09", value: newDesc, onChange: (e) => setNewDesc(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btnSolid, disabled: busy || !newName.trim() || !(newWs || workspaces.length > 0), onClick: () => void submitCreate(), children: busy ? "\u2026" : "\u521B\u5EFA" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btn, onClick: () => setCreating(false), children: "\u53D6\u6D88" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.columns, children: COLUMNS.map((col) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-col": col.key, style: { ...hb.column, borderTop: `2px solid ${col.color}` }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: hb.colHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { fontWeight: 700, fontSize: 12.5 }, children: col.title }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { ...hb.count, color: col.color, background: `${col.color}1f` }, children: columnCounts[col.key] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.colSub, children: col.sub }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 6 }, children: [
        filtered.filter(col.match).slice(0, 20).map((t) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: hb.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: 6 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: { ...hb.state, background: col.color }, children: col.key === "stable" ? "\u2713" : "\u25CF" }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { fontWeight: 600, fontSize: 12.5, lineHeight: "17px", overflowWrap: "anywhere" }, children: t.name }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                  EvidenceRing,
                  {
                    artifact: Boolean(t.artifact),
                    evaluation: Boolean(t.evaluation),
                    refs: (t.memoryRefs?.length ?? 0) > 0,
                    size: 20,
                    showLabel: false
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.meta, children: shortId(t.id) }),
                ws === "" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.meta, children: t.workspace.replace(/^.*[\\/]/, "") }),
                (col.key === "gapped" || col.key === "ready") && taskGaps3(t).map((g) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { style: hb.gap, children: [
                  g,
                  " \u2717"
                ] }, g)),
                col.key === "stable" && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { style: { fontSize: 10, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))" }, children: [
                  "artifact",
                  t.artifact ? "\u2713" : "\u2717",
                  "\xB7eval",
                  t.evaluation ? "\u2713" : "\u2717",
                  "\xB7ref",
                  (t.memoryRefs?.length ?? 0) > 0 ? "\u2713" : "\u2717"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { style: hb.meta, children: fmtDate3(t.createdAt) })
              ] })
            ] })
          ] }),
          col.key === "draft" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.cardHint, children: "\u8349\u7A3F \xB7 \u7528 esr_task \u53EF\u5C06\u5176\u63A8\u8FDB\u4E3A active" }),
          (col.key === "gapped" || col.key === "ready") && closingFor === t.id ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { ...hb.closeForm, borderColor: col.color }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { style: hb.input, placeholder: "\u4EA7\u7269 artifact\uFF08\u6587\u4EF6/PR/\u8DEF\uFF09", value: closeArtifact, onChange: (e) => setCloseArtifact(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { style: hb.input, placeholder: "\u8BC4\u4F30 evaluation\uFF08\u6D4B\u8BD5/\u8BC4\u5BA1/\u5206\u6570\uFF09", value: closeEval, onChange: (e) => setCloseEval(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("input", { style: hb.input, placeholder: "\u8BB0\u5FC6\u5F15\u7528 memory_refs\uFF08#id, \u9017\u53F7\u5206\u9694\uFF09", value: closeRefs, onChange: (e) => setCloseRefs(e.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btnSolid, disabled: busy, onClick: () => void submitClose(t), children: busy ? "\u2026" : "\u6309\u8BC1\u636E\u95ED\u73AF" }),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.btn, onClick: () => setClosingFor(null), children: "\u53D6\u6D88" })
            ] })
          ] }) : (col.key === "gapped" || col.key === "ready") && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", style: hb.advance, onClick: () => {
            setClosingFor(t.id);
          }, children: "\u8865\u9F50\u8BC1\u636E \u2192 \u5173\u95ED" })
        ] }, t.id)),
        filtered.filter(col.match).length > 20 && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { style: hb.more, children: [
          "+",
          filtered.filter(col.match).length - 20,
          " \u66F4\u591A\u2026"
        ] }),
        filtered.filter(col.match).length === 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.empty, children: col.key === "stable" ? "\u8FD8\u6CA1\u6709\u95ED\u73AF\u4EFB\u52A1" : "\u6682\u65E0\u4EFB\u52A1" })
      ] })
    ] }, col.key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: hb.footer, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { children: [
      columnCounts.all,
      " \u4E2A\u4EFB\u52A1\uFF08\u5F53\u524D\u7B5B\u9009\uFF09\xB7 \u6BCF 20s \u81EA\u52A8\u5237\u65B0 \xB7 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_engram.json"
    ] }) })
  ] });
}
var hb = {
  header: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #ffffff))"
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
    maxWidth: 220
  },
  input: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
    borderRadius: 8,
    padding: "5px 9px",
    fontSize: 12,
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    color: "inherit"
  },
  btn: {
    border: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #d1d5db))",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-surface, #fff))",
    color: "inherit"
  },
  btnSolid: {
    border: "none",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
    color: "#fff",
    background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)"
  },
  close: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted, #6b7280))",
    padding: "2px 6px"
  },
  warn: {
    fontSize: 12,
    color: "#b45309",
    background: "#fef3c7",
    borderRadius: 8,
    padding: "6px 10px",
    marginTop: 8
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
    background: "var(--dsw-alias-bg-multi-select, transparent)"
  },
  columns: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(190px, 1fr))",
    gap: 10,
    padding: "12px 14px",
    overflow: "auto",
    alignItems: "start"
  },
  column: {
    borderRadius: 12,
    padding: "9px 10px",
    background: "var(--dsw-alias-bg-layer-1, var(--dsh-color-hover-bg, #f9fafb))"
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
    gap: 6
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
    marginTop: 2
  },
  meta: {
    fontSize: 10,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
  },
  gap: {
    fontSize: 10,
    fontWeight: 700,
    color: "#b45309",
    background: "#fef3c7",
    borderRadius: 999,
    padding: "0 6px"
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
    alignSelf: "flex-start"
  },
  closeForm: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    border: "1px dashed",
    borderRadius: 8,
    padding: 7,
    background: "var(--dsw-alias-bg-multi-select, transparent)"
  },
  more: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))", padding: "2px 2px" },
  empty: {
    fontSize: 11.5,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    padding: "8px 2px",
    border: "1px dashed var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))",
    borderRadius: 8,
    textAlign: "center"
  },
  footer: {
    padding: "6px 14px",
    fontSize: 11,
    color: "var(--dsw-alias-label-tertiary, var(--dsh-color-muted-weak, #9ca3af))",
    borderTop: "1px solid var(--dsw-alias-border-l1, var(--dsh-color-border, #e5e7eb))"
  }
};

// client/src/EngramBoardMount.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
var PANEL_NAME = "engram";
var ACTIVE_ATTR = "data-dsh-engram-board-active";
var ACTIVATE_EVENT = "dsh-panel-activate";
var OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active"];
var CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
var SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
var FAMILY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-engram-entry]";
var ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M5.2 8.1l1.8 1.8 3.8-4"/></svg>';
var styleInjected = false;
function ensureBoardStyles() {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "engram-board-styles";
  style.textContent = `
[data-pane='conversation'], [class*='centerCol'] { position: relative; }
[data-dsh-engram-board] {
  position: absolute; inset: 0; z-index: 60; display: none;
  background: var(--dsw-alias-bg-base, #ffffff);
}
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-engram-board] { display: block; }
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-engram-board]),
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-engram-board]) { display: none !important; }
[data-dsh-engram-entry] {
  display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
  padding: 7px 10px; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, inherit); font-size: 12.5px; font-weight: 600; text-align: left;
  border-radius: 8px; transition: background .15s ease;
}
[data-dsh-engram-entry]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
[data-dsh-engram-entry] .engram-entry-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-engram-entry] .engram-entry-badge {
  flex: 0 0 auto; min-width: 18px; text-align: center; border-radius: 999px;
  padding: 0 6px; font-size: 10px; font-weight: 700; line-height: 16px;
  background: rgba(99,102,241,.14); color: var(--dsw-alias-label-primary-bluish, #4338ca);
}
[data-dsh-engram-entry][data-dsh-engram-idle] .engram-entry-badge { display: none; }
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-engram-entry] .engram-entry-label,
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-engram-entry] .engram-entry-badge { display: none; }
`;
  document.head.appendChild(style);
  styleInjected = true;
}
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return void 0;
  const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? column.firstElementChild;
}
function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of root.children) {
    if (child.tagName === "BUTTON") return child;
  }
  return void 0;
}
function centerColumn() {
  return document.querySelector(CENTER_COLUMN_SELECTOR) ?? void 0;
}
function mountEngramBoard(api) {
  ensureBoardStyles();
  if (typeof document === "undefined") return () => {
  };
  let open = false;
  let root;
  let container;
  let entry;
  let boardUnmounted = false;
  const close = () => {
    if (!open) return;
    open = false;
    document.documentElement.removeAttribute(ACTIVE_ATTR);
  };
  const openPanel = () => {
    if (open) return;
    open = true;
    for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr);
    document.documentElement.setAttribute(ACTIVE_ATTR, "on");
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
  };
  const toggle = () => open ? close() : openPanel();
  const createEntryRow = () => {
    const row = document.createElement("button");
    row.type = "button";
    row.dataset.dshEngramEntry = "";
    row.setAttribute("aria-label", "ESR \u770B\u677F");
    row.innerHTML = `<span style="display:inline-flex;flex:0 0 auto;color:var(--dsw-alias-label-primary-bluish,#4338ca);">${ICON}</span><span class="engram-entry-label">ESR \u770B\u677F</span><span class="engram-entry-badge">0</span>`;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    return row;
  };
  entry = createEntryRow();
  const placeEntry = (rootEl) => {
    const button = newSessionButton(rootEl);
    if (button === void 0) return false;
    if (entry.parentElement === rootEl) return true;
    const row = button.closest('[class*="logoRow"]');
    const base = row !== null && row.parentElement === rootEl ? row : button;
    const family = Array.from(rootEl.children).filter(
      (el) => el instanceof HTMLElement && el.matches(FAMILY_SELECTOR)
    );
    const lastSibling = family[family.length - 1];
    if (lastSibling !== void 0 && lastSibling.nextSibling !== null) {
      rootEl.insertBefore(entry, lastSibling.nextSibling);
    } else {
      rootEl.insertBefore(entry, base.nextSibling ?? null);
    }
    return true;
  };
  let entryRoot;
  let entryPlaced = false;
  const tryPlaceEntry = () => {
    if (!entry) return;
    if (entryRoot !== void 0 && !entryRoot.isConnected) {
      entryRoot = void 0;
      entryPlaced = false;
    }
    if (entryPlaced) {
      if (document.body.contains(entry)) return;
      entryRoot = void 0;
      entryPlaced = false;
    }
    entryRoot ??= sidebarRoot();
    if (entryRoot === void 0) return;
    entryPlaced = placeEntry(entryRoot);
  };
  const bodyObserver = new MutationObserver(() => tryPlaceEntry());
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  tryPlaceEntry();
  let badgeTimer = 0;
  const pollBadge = async () => {
    if (!entry || !entry.isConnected) return;
    try {
      const ov = await api.overview();
      const total = Object.values(ov.workspaces).reduce((a, w) => a + (w.tasks ?? 0), 0);
      const badge = entry.querySelector(".engram-entry-badge");
      if (badge) {
        badge.textContent = String(total);
        entry.toggleAttribute("data-dsh-engram-idle", total === 0);
        entry.title = `ESR \u770B\u677F \xB7 ${total} \u4E2A\u8FDB\u884C\u4E2D\u4EFB\u52A1`;
      }
    } catch {
      entry.toggleAttribute("data-dsh-engram-idle", true);
    }
  };
  void pollBadge();
  badgeTimer = window.setInterval(() => void pollBadge(), 3e4);
  const ensureContainer = () => {
    if (container !== void 0 || boardUnmounted) return;
    const column = centerColumn();
    if (column === void 0) return;
    container = document.createElement("div");
    container.dataset.dshEngramBoard = "";
    column.appendChild(container);
    root = (0, import_client.createRoot)(container);
    root.render(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(EngramBoard, { api, onRequestClose: close }));
  };
  const boardWatcher = new MutationObserver(() => ensureContainer());
  boardWatcher.observe(document.body, { childList: true, subtree: true });
  ensureContainer();
  const onOtherActivate = (event) => {
    if (event.detail !== PANEL_NAME && open) close();
  };
  const onClickSidebarRow = (event) => {
    if (!open) return;
    const target = event.target;
    if (target !== null && target.closest(SIDEBAR_ROW_SELECTOR) !== null) close();
  };
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  document.addEventListener("click", onClickSidebarRow, true);
  return () => {
    boardUnmounted = true;
    window.clearInterval(badgeTimer);
    bodyObserver.disconnect();
    boardWatcher.disconnect();
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    document.removeEventListener("click", onClickSidebarRow, true);
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    entry?.remove();
    entry = void 0;
    root?.unmount();
    root = void 0;
    container?.remove();
    container = void 0;
  };
}

// client/src/entry.tsx
var NS = "dsh-engram";
var zh = {
  nav: "Engram \u8BB0\u5FC6",
  refresh: "\u5237\u65B0",
  error: "\u8BFB\u53D6\u5931\u8D25"
};
var en = {
  nav: "Engram Memory",
  refresh: "Refresh",
  error: "Load failed"
};
var inject = ["slots", "locale", "connection", "sessions", "workspaces"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-engram: dictionaries");
  const api = new EngramApi();
  const t = ctx.locale.bind(NS);
  const sectionInjected = () => ({ api, t });
  try {
    ctx.slots.inject(
      "conversation.input.dock",
      () => ctx.slots.register(
        {
          name: "conversation.input.dock",
          id: "todo",
          order: 0,
          priority: -1,
          inject: () => ({ api })
        },
        EngramTaskDock
      )
    );
  } catch (error) {
    console.warn("[dsh-engram] conversation.input.dock registration failed:", error);
  }
  try {
    ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "engram",
          order: 16,
          label: () => t("nav"),
          locale: NS,
          inject: sectionInjected
        },
        EngramSection
      )
    );
  } catch (error) {
    console.warn("[dsh-engram] settings.section registration failed:", error);
  }
  const connection = ctx.get("connection");
  const scope = new EngramScopeImpl(connection.api, "dsh-engram");
  const cardInjected = () => ({ scope });
  try {
    ctx.slots.inject(
      "settings.plugin.item",
      () => ctx.slots.register(
        {
          name: "settings.plugin.item",
          id: "dsh-engram",
          key: "dsh-engram",
          locale: NS,
          inject: cardInjected
        },
        EngramConfigCard
      )
    );
  } catch (error) {
    console.warn("[dsh-engram] settings.plugin.item registration failed:", error);
  }
  try {
    ctx.effect(
      () => mountEngramBoard(api),
      "dsh-engram: ESR task board mount"
    );
  } catch (error) {
    console.warn("[dsh-engram] ESR task board mount setup failed:", error);
  }
}

		return module.exports;
	}
});
