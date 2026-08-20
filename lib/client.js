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
  const sessionsState = useSessions?.call ? useSessions((s3) => s3) : void 0;
  const workspacesState = useWorkspaces?.call ? useWorkspaces((s3) => s3) : void 0;
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
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
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
var s = {
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
function fmtDate(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
var MEM_PAGE_SIZE = 10;
var pct = (n) => n === null || n === void 0 ? "\u2013" : `${(n * 100).toFixed(1)}%`;
function daysLeft(ts) {
  if (ts === null || ts === void 0) return "\u221E";
  const days = Math.ceil((ts - Date.now()) / 864e5);
  return days > 0 ? `${days}d` : "expired";
}
function StatCard({ num, label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.cardNum, children: num }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.cardLabel, children: label })
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
  const [overview, setOverview] = (0, import_react3.useState)(null);
  const [memories, setMemories] = (0, import_react3.useState)([]);
  const [tasks, setTasks] = (0, import_react3.useState)([]);
  const [links, setLinks] = (0, import_react3.useState)([]);
  const [nodes, setNodes] = (0, import_react3.useState)([]);
  const [usageStats, setUsageStats] = (0, import_react3.useState)(null);
  const [error, setError] = (0, import_react3.useState)(null);
  const [workspace, setWorkspace] = (0, import_react3.useState)("");
  const [kind, setKind] = (0, import_react3.useState)("");
  const [status, setStatus] = (0, import_react3.useState)("active");
  const [q, setQ] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [memPage, setMemPage] = (0, import_react3.useState)(0);
  const [expandedRows, setExpandedRows] = (0, import_react3.useState)(/* @__PURE__ */ new Set());
  const [view, setView] = (0, import_react3.useState)("mem");
  const [gcDryRun, setGcDryRun] = (0, import_react3.useState)(true);
  const [gcReport, setGcReport] = (0, import_react3.useState)(null);
  const [gcRunning, setGcRunning] = (0, import_react3.useState)(false);
  const [newTaskWs, setNewTaskWs] = (0, import_react3.useState)("");
  const [newTaskName, setNewTaskName] = (0, import_react3.useState)("");
  const [newTaskDesc, setNewTaskDesc] = (0, import_react3.useState)("");
  const [newTaskBusy, setNewTaskBusy] = (0, import_react3.useState)(false);
  const [closeFor, setCloseFor] = (0, import_react3.useState)(null);
  const [closeArtifact, setCloseArtifact] = (0, import_react3.useState)("");
  const [closeEval, setCloseEval] = (0, import_react3.useState)("");
  const [closeRefs, setCloseRefs] = (0, import_react3.useState)("");
  const [closeBusy, setCloseBusy] = (0, import_react3.useState)(false);
  const refresh = (0, import_react3.useCallback)(async () => {
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
  (0, import_react3.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const workspaces = (0, import_react3.useMemo)(() => overview ? Object.keys(overview.workspaces) : [], [overview]);
  const kindsPresent = (0, import_react3.useMemo)(() => overview ? Object.keys(overview.kinds) : [], [overview]);
  const nameOf = (0, import_react3.useMemo)(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of nodes) map.set(n.id, n.name);
    for (const t2 of tasks) map.set(t2.id, t2.name);
    return (id) => map.get(id) ?? id;
  }, [nodes, tasks]);
  (0, import_react3.useEffect)(() => {
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
  (0, import_react3.useEffect)(() => {
    setMemPage(0);
  }, [workspace, status, kind, q]);
  (0, import_react3.useEffect)(() => {
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
  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  const gc = overview?.gc ?? null;
  const wsCounts = workspace && overview ? overview.workspaces[workspace] ?? null : null;
  const { vars } = useEngramTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...s.root, ...vars }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h1", { style: s.h1, children: "Engram \u8BB0\u5FC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: s.sub, children: "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6 \xB7 \u96F6 LLM \u81EA\u52A8\u6355\u83B7 \xB7 \u7B26\u53F7\u7D22\u5F15\u6E10\u8FDB\u62AB\u9732 \u2014 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_engram.json" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.error, children: [
      t("error"),
      ": ",
      error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.tabBar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: view === "mem" ? s.tabActive : s.tab, onClick: () => setView("mem"), children: "\u8BB0\u5FC6" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: view === "esr" ? s.tabActive : s.tab, onClick: () => setView("esr"), children: "ESR\uFF08\u4EFB\u52A1 \xB7 \u8282\u70B9 \xB7 \u5173\u7CFB\uFF09" })
    ] }),
    view === "mem" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      overview && (() => {
        const memNum = wsCounts ? wsCounts.memories : overview.totals.memories;
        const taskNum = wsCounts ? wsCounts.tasks : overview.totals.tasks;
        const linkNum = wsCounts ? wsCounts.links : overview.totals.links;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.stats, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(memNum), label: wsCounts ? "\u8BB0\u5FC6 (active)" : "\u8BB0\u5FC6 (active, \u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(taskNum), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(linkNum), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(workspaces.length), label: "\u5DE5\u4F5C\u533A" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(overview.captures.total), label: "\u81EA\u52A8\u6355\u83B7" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            StatCard,
            {
              num: indexCost ? `~${indexCost.tokens}` : "\u2013",
              label: "[ENGRAM] \u7D22\u5F15 token / \u5DE5\u4F5C\u533A"
            }
          ),
          gc && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            StatCard,
            {
              num: String(gc.archivedMemories + gc.archivedTasks),
              label: `GC \u5DF2\u5F52\u6863 \xB7 \u94FE\u63A5-${gc.removedLinks}`
            }
          )
        ] });
      })(),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.subPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 700, fontSize: 13 }, children: "\u8BB0\u5FC6 GC\uFF08pi-esr \u7EA6\u675F\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: gcDryRun, onChange: (e) => setGcDryRun(e.target.checked) }),
            "\u4EC5\u9884\u89C8\uFF08dry run\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btnPrimary, onClick: () => void runGc(), disabled: gcRunning || !workspace, children: gcRunning ? "\u2026" : "\u8FD0\u884C GC" }),
          gc && gc.lastRun > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.mono, children: [
            "\u4E0A\u6B21 ",
            fmtDate(gc.lastRun)
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "\u5DE5\u4F5C\u96C6\uFF08active \u4EFB\u52A1\u5F15\u7528 / \u4EFB\u52A1\u8BB0\u5FC6 / \u5DF2\u5165\u7D22\u5F15\u547D\u4E2D\uFF09\u6C38\u4E0D\u9A71\u9010\uFF1BTTL \u8FC7\u671F\u5F52\u6863\u3001\u8D85\u5BB9\u91CF\u6DD8\u6C70\u3001stable \u4EFB\u52A1\u8D85\u7A97\u5F52\u6863\u3001\u60AC\u7A7A\u94FE\u63A5\u6E05\u7406\u3002\u53EA\u5F52\u6863\u4E0D\u786C\u5220\u2014\u2014\u6761\u76EE id \u4FDD\u6301\u53EF\u91CD\u53D6\u3002" }),
        gcReport && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 8, fontSize: 12.5 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
            gcReport.dryRun ? "dry-run \u9884\u89C8\uFF1A" : "\u5DF2\u6267\u884C\uFF1A",
            " ",
            "\u5F52\u6863\u8BB0\u5FC6 ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("b", { children: gcReport.archivedMemories.length }),
            " \xB7 \u5F52\u6863\u4EFB\u52A1 ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("b", { children: gcReport.archivedTasks.length }),
            " \xB7 \u6E05\u7406\u94FE\u63A5 ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("b", { children: gcReport.removedLinks.length }),
            " \xB7 \u4FDD\u62A4 ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("b", { children: gcReport.protectedMemories })
          ] }),
          gcReport.archivedMemories.slice(0, 5).map((e) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.mono, children: [
            "- ",
            e.id.slice(0, 8),
            " ",
            e.reason,
            ": ",
            e.text
          ] }, e.id)),
          gcReport.archivedTasks.slice(0, 3).map((t2) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.mono, children: [
            "- ",
            t2.id.slice(0, 6),
            " ",
            t2.reason,
            ": ",
            t2.name
          ] }, t2.id)),
          gcReport.removedLinks.slice(0, 3).map((l) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.mono, children: [
            "- link ",
            l.source.slice(0, 8),
            " --",
            l.relation,
            "--> ",
            l.target.slice(0, 8)
          ] }, l.id))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { style: s.input, value: workspace, onChange: (e) => setWorkspace(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u5168\u90E8\u5DE5\u4F5C\u533A" }),
          workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: ws, children: [
            ws,
            "\uFF08",
            overview?.workspaces[ws]?.memories ?? 0,
            " \u6761\uFF09"
          ] }, ws))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(-1), children: "\u2039 \u4E0A\u4E00\u5DE5\u4F5C\u533A" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(1), children: "\u4E0B\u4E00\u5DE5\u4F5C\u533A \u203A" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { style: s.input, value: kind, onChange: (e) => setKind(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u5168\u90E8\u7C7B\u578B" }),
          kindsPresent.map((k) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: k, children: KIND_LABEL[k] ?? k }, k))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { style: s.input, value: status, onChange: (e) => setStatus(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "active", children: "\u4EC5\u6D3B\u52A8" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "all", children: "\u5168\u90E8\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "archived", children: "\u5DF2\u5F52\u6863" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            style: { ...s.input, width: 180 },
            placeholder: "\u641C\u7D22\u8BB0\u5FC6\u2026",
            value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") void refresh();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btnPrimary, onClick: () => void refresh(), disabled: busy, children: busy ? "\u2026" : t("refresh") })
      ] }),
      cfg && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
          "autoCapture ",
          cfg.autoCapture ? "on" : "off"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
          "sessionSearch ",
          cfg.sessionSearch ? "on" : "off"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
          "TTL ",
          cfg.expireDays,
          "d"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
          "index ",
          cfg.indexMaxLines,
          " \u884C / ",
          cfg.indexMaxChars,
          " \u5B57\u7B26"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
          "promote \u2265",
          cfg.promoteHits,
          " hits"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("table", { style: s.table, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("colgroup", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("col", { style: { width: 58 } }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("col", {}),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("col", { style: { width: 72 } })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { style: s.th, children: "\u7C7B\u578B" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { style: s.th, children: "\u5185\u5BB9" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { style: s.th })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tbody", { children: [
          flatRows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { colSpan: 3, style: s.empty, children: "\u6682\u65E0\u8BB0\u5FC6 \u2014 \u4F7F\u7528 engram_store \u663E\u5F0F\u8BB0\u5F55\uFF0C\u6216\u8BA9\u81EA\u52A8\u6355\u83B7\u5DE5\u4F5C\uFF08git \u63D0\u4EA4 / \u5173\u952E\u6587\u4EF6\u7F16\u8F91 / \u5DE5\u5177\u9519\u8BEF\uFF09" }) }),
          memPageRows.map(
            (r) => r.kind === "head" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("td", { colSpan: 3, style: s.wsHead, children: [
              r.ws,
              " \xB7 ",
              r.count,
              " \u6761"
            ] }) }, `h-${r.ws}`) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("td", { style: { ...s.td, whiteSpace: "nowrap" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.badge, background: KIND_COLORS[r.m.kind] ?? "#6b7280" }, children: KIND_LABEL[r.m.kind] ?? r.m.kind }),
                r.m.status === "archived" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.tag, color: "#b45309", background: "#fef3c7" }, children: "archived" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("td", { style: { ...s.td, minWidth: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { title: r.m.text, style: expandedRows.has(r.m.id) ? s.expanded : s.clamp3, children: r.m.text }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 2, flexWrap: "wrap" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...s.mono, ...s.ellipsis, flex: "1 1 160px" }, title: `${fmtDate(r.m.createdAt)} \xB7 ${r.m.id} \xB7 ${r.m.entity ?? ""} \xB7 signal ${r.m.signal.toFixed(2)} \xB7 hits ${r.m.hits} \xB7 TTL ${daysLeft(r.m.expiresAt)}`, children: [
                    fmtDate(r.m.createdAt),
                    " \xB7 ",
                    r.m.id.slice(0, 8),
                    r.m.entity ? ` \xB7 ${r.m.entity}` : "",
                    " \xB7 ",
                    r.m.signal.toFixed(2),
                    " \xB7 hits ",
                    r.m.hits,
                    " \xB7 ",
                    daysLeft(r.m.expiresAt)
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.linkBtn, onClick: () => toggleExpand(r.m.id), children: expandedRows.has(r.m.id) ? "\u6536\u8D77" : "\u5C55\u5F00\u5168\u6587" })
                ] }),
                r.m.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }, children: r.m.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s.tag, children: tag }, tag)) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { style: s.td, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, title: "\u5F52\u6863\uFF08TTL/\u8F6F\u5220\uFF0C\u53EF\u6062\u590D\u4E0D\u8F7D\u5165\u7D22\u5F15\uFF09", onClick: () => void act(() => api.archive(r.m.id, r.m.workspace)), children: "\u5F52\u6863" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, title: "\u6C38\u4E45\u5220\u9664", onClick: () => {
                  if (window.confirm(`\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6?
${r.m.text.slice(0, 60)}`)) void act(() => api.remove(r.m.id, r.m.workspace));
                }, children: "\u5220\u9664" })
              ] }) })
            ] }, r.m.id)
          )
        ] })
      ] }),
      flatRows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.pageBar, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, disabled: memPageSafe === 0, onClick: () => setMemPage(memPageSafe - 1), children: "\u2039 \u4E0A\u4E00\u9875" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          "\u7B2C ",
          memPageSafe + 1,
          " / ",
          memPageCount,
          " \u9875 \xB7 \u5171 ",
          flatRows.length,
          " \u6761"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, disabled: memPageSafe >= memPageCount - 1, onClick: () => setMemPage(memPageSafe + 1), children: "\u4E0B\u4E00\u9875 \u203A" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("select", { style: s.input, value: memPageSafe, onChange: (e) => setMemPage(Number(e.target.value)), title: "\u8DF3\u9875", children: Array.from({ length: memPageCount }, (_, i) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: i, children: [
          "\u7B2C ",
          i + 1,
          " \u9875"
        ] }, i)) })
      ] })
    ] }),
    view === "esr" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.stats, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(wsCounts ? wsCounts.tasks : overview?.totals.tasks ?? 0), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(wsCounts ? wsCounts.links : overview?.totals.links ?? 0), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview?.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.subPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 6 }, children: [
          "agent \u884C\u4E3A\u89C2\u6D4B",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }, children: " \xB7 \u6BCF\u6B21 engram_*/esr_* \u5DE5\u5177\u8C03\u7528\u5B9E\u65F6\u7D2F\u8BA1\uFF08\u771F\u5B9E\u6570\u636E\uFF0C\u6309\u5DE5\u4F5C\u533A/\u5929\u6EDA\u52A8\uFF09" })
        ] }),
        !usageStats ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.mono, children: "\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "ESR \u4E3B\u52A8\u6027 ",
              pct(usageStats.ratios.esrRatio),
              "\uFF08",
              usageStats.ratios.esrCalls,
              "/",
              usageStats.ratios.calls,
              " \u6B21\uFF09"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "\u53EC\u56DE\u547D\u4E2D\u7387 ",
              pct(usageStats.ratios.recallHitRate)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "\u5E73\u5747\u547D\u4E2D ",
              usageStats.ratios.recallHitsPerQuery ?? "\u2013",
              "/\u67E5\u8BE2"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "detail \u8F6C\u5316 ",
              pct(usageStats.ratios.detailFollowRate)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "\u5931\u8D25 ",
              usageStats.totals.failures
            ] }),
            usageStats.ratios.calls < 10 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              "\u6837\u672C\u4E0D\u8DB3\uFF08",
              usageStats.ratios.calls,
              " \u6B21\uFF09\uFF0C\u6BD4\u4F8B\u4EC5\u4F9B\u53C2\u8003"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "ESR \u4E3B\u52A8\u6027\u8FC7\u4F4E\u65F6\uFF0C\u4E0B\u4E00\u4E2A\u4F1A\u8BDD\u7684 [ESR] \u6CE8\u5165\u5757\u4F1A\u9644\u52A0\u4E00\u884C\u57FA\u4E8E\u771F\u5B9E\u6570\u636E\u7684 escalate \u63D0\u9192\uFF0C\u5F15\u5BFC\u6A21\u578B\u5F53\u573A\u8865\u5EFA\u4EFB\u52A1/\u8282\u70B9/\u5173\u7CFB\u2014\u2014\u6BD4\u4F8B\u56DE\u5347\u540E\u63D0\u9192\u81EA\u52A8\u6D88\u5931\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: [
            "\u5DE5\u5177\u8C03\u7528\uFF1A",
            Object.entries(usageStats.totals.counts).map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s.tag, children: [
              k,
              " \xD7",
              v
            ] }, k))
          ] }),
          usageStats.byDay.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }, children: usageStats.byDay.map((d) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
            d.day,
            " \xB7 \u8C03\u7528 ",
            Object.values(d.counts).reduce((a, b) => a + b, 0),
            " \xB7 \u5931\u8D25 ",
            d.failures
          ] }, d.day)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.panelTitle, children: [
        "ESR \u4EFB\u52A1\uFF08\u8BC1\u636E\u95ED\u73AF\uFF09",
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.subPanel, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { style: s.input, value: newTaskWs, onChange: (e) => setNewTaskWs(e.target.value), children: [
          workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "(no workspaces)" }),
          workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: ws, children: ws }, ws))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { style: { ...s.input, width: 170 }, placeholder: "\u4EFB\u52A1\u540D\u2026", value: newTaskName, onChange: (e) => setNewTaskName(e.target.value), onKeyDown: (e) => {
          if (e.key === "Enter") void createNewTask();
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { style: { ...s.input, width: 240 }, placeholder: "\u8981\u4EA7\u51FA / \u6EE1\u8DB3\u4EC0\u4E48\uFF08\u53EF\u9009\uFF09", value: newTaskDesc, onChange: (e) => setNewTaskDesc(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btnPrimary, disabled: newTaskBusy || newTaskName.trim() === "", onClick: () => void createNewTask(), children: newTaskBusy ? "\u2026" : "\u65B0\u5EFA\u4EFB\u52A1" })
      ] }) }),
      tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u4EFB\u52A1 \u2014 \u7528\u4E0A\u65B9\u300C\u65B0\u5EFA\u4EFB\u52A1\u300D\u6216 esr_task \u5DE5\u5177\u521B\u5EFA" }),
      taskGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_react3.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u4E2A\u4EFB\u52A1"
        ] }),
        items.map((task) => {
          const gaps = taskGaps2(task);
          const isStable = task.state === "stable";
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.subPanel, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontWeight: 600, fontSize: 13 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s.mono, children: task.id.slice(0, 6) }),
              " ",
              task.name,
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }, children: isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE" }),
              !isStable && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, onClick: () => setCloseFor(closeFor === task.id ? null : task.id), children: closeFor === task.id ? "\u6536\u8D77" : "\u586B\u5199\u8BC1\u636E\u5173\u95ED\u2026" })
            ] }),
            !isStable && gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: [
              "\u7F3A\u53E3\uFF1A",
              gaps.join(", "),
              " \u2014 \u63D0\u4F9B artifact / evaluation / memory_ref \u540E\u8F6C\u4E3A STABLE"
            ] }),
            task.description && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }, children: task.description }),
            task.memoryRefs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, marginTop: 4 }, children: [
              "\u8BB0\u5FC6\u5F15\u7528\uFF1A",
              task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s.tag, children: r.slice(0, 8) }, r))
            ] }),
            closeFor === task.id && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: 8, padding: 8, border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }, children: "\u63D0\u4F9B\u8BC1\u636E\u540E\u5173\u95ED\uFF08\u4E09\u9879\u5168\u9F50\u624D\u8F6C STABLE\uFF09" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "artifact \u8DEF\u5F84/URL", value: closeArtifact, onChange: (e) => setCloseArtifact(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "evaluation \u9A8C\u8BC1\u8BC1\u636E", value: closeEval, onChange: (e) => setCloseEval(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "memory_refs \u9017\u53F7\u5206\u9694", value: closeRefs, onChange: (e) => setCloseRefs(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btnPrimary, disabled: closeBusy, onClick: () => void submitClose(task), children: closeBusy ? "\u2026" : "\u63D0\u4EA4\u5173\u95ED" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s.btn, onClick: () => setCloseFor(null), children: "\u53D6\u6D88" })
              ] })
            ] })
          ] }, task.id);
        })
      ] }, ws)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.panelTitle, children: [
        "\u8282\u70B9\u4E0E\u5173\u7CFB\uFF08esr_node / esr_link\uFF09",
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
      ] }),
      nodes.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u8282\u70B9 \u2014 \u6A21\u578B\u4F1A\u4E3A\u53CD\u590D\u51FA\u73B0\u7684\u9886\u57DF\u5BF9\u8C61\u4E3B\u52A8\u767B\u8BB0\uFF08esr_node\uFF09\uFF0C\u6B64\u5904\u4E5F\u53EF\u67E5\u770B\u5173\u7CFB" }),
      nodeGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_react3.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u4E2A\u8282\u70B9"
        ] }),
        items.map((n) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12.5, padding: "2px 0" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mono", style: { ...s.mono, color: "#4338ca" }, children: n.id.slice(0, 24) }),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontWeight: 600 }, children: n.name }),
          n.kind && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...s.tag, color: "#4338ca", background: "#eef2ff" }, children: n.kind }),
          n.description && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { color: "var(--dsh-color-muted, #6b7280)" }, children: [
            " \u2014 ",
            n.description.slice(0, 48)
          ] })
        ] }, n.id))
      ] }, ws)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 6 }, children: "\u5173\u7CFB\uFF1A" }),
      links.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u5173\u7CFB \u2014 esr_link \u521B\u5EFA" }),
      linkGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_react3.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u6761\u5173\u7CFB"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }, children: items.map((l) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s.relRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mono", style: s.nodePill, title: l.source, children: nameOf(l.source) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--dsh-color-muted, #6b7280)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { border: "1px dashed var(--dsh-color-border, #cbd5e1)", borderRadius: 999, padding: "1px 7px" }, children: l.relation }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": true, children: "\u2192" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mono", style: s.nodePill, title: l.target, children: nameOf(l.target) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { fontSize: 11, color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: [
            "\xB7 ",
            fmtDate(l.createdAt)
          ] })
        ] }, l.id)) })
      ] }, ws))
    ] })
  ] });
}

// client/src/EngramConfigCard.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
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
var s2 = {
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  const [snap, setSnap] = (0, import_react4.useState)(null);
  const [draft, setDraft] = (0, import_react4.useState)({});
  const [saving, setSaving] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [open, setOpen] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => {
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
  const setField = (0, import_react4.useCallback)((key, value2) => {
    setDraft((prev) => ({ ...prev, [key]: value2 }));
  }, []);
  const effective = snap?.value ?? snap?.base ?? {};
  const anyDirty = FIELDS.some((field) => {
    const staged = draft[field.key];
    return staged !== void 0 && staged !== effective[field.key];
  });
  const save = (0, import_react4.useCallback)(async () => {
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
  const discard = (0, import_react4.useCallback)(() => {
    setError(null);
    const value2 = snap?.value ?? snap?.base ?? {};
    setDraft({ ...value2 });
  }, [snap]);
  const resetField = (0, import_react4.useCallback)(async (key) => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: vars, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: available ? { ...s2.card, ...open ? s2.cardOpen : void 0 } : { display: "none" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "button",
      {
        type: "button",
        style: s2.header,
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"} dsh-engram \u8BBE\u7F6E`,
        onClick: () => setOpen((prev) => !prev),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: s2.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: s2.name, children: "dsh-engram" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: s2.description, children: CARD_DESCRIPTION })
          ] }),
          anyDirty && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: s2.pending, children: "\u672A\u4FDD\u5B58" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chevron, { open })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: s2.body, children: [
      !writable && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: s2.readOnly, children: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF08\u5BBF\u4E3B\u672A\u6388\u6743\u5199\u5165\u6216\u9700\u91CD\u542F\u5E94\u7528\uFF09\u3002" }),
      GROUPS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: s2.groupPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: s2.groupHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.groupTitle, children: group.title }),
          group.description && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.groupDesc, children: group.description })
        ] }),
        group.fields.map((field) => {
          const raw = value[field.key];
          const overridden = snap?.user !== void 0 && field.key in snap.user;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: s2.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.label, children: field.label }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.hint, children: field.hint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              field.kind === "bool" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: raw === true,
                  disabled: !writable,
                  onChange: (e) => setField(field.key, e.target.checked)
                }
              ) : field.kind === "text" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "text",
                  style: { ...s2.input, width: field.width ?? 180 },
                  value: Array.isArray(raw) ? raw.join(", ") : raw === void 0 ? "" : String(raw),
                  disabled: !writable,
                  placeholder: "host.domain, \u53E6\u4E00\u57DF\u540D\u2026",
                  onChange: (e) => {
                    const tokens = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
                    setField(field.key, tokens);
                  }
                }
              ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "number",
                  style: s2.input,
                  step: field.step ?? 1,
                  min: field.min,
                  max: field.max,
                  value: raw === void 0 ? "" : String(raw),
                  disabled: !writable,
                  onChange: (e) => setField(field.key, e.target.value === "" ? void 0 : Number(e.target.value))
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  style: overridden ? { ...s2.reset, color: "var(--dsw-alias-brand-primary, #2563eb)" } : { ...s2.reset, cursor: "default", opacity: 0.55 },
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
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.note, children: "\u8BBE\u7F6E\u5BF9\u65B0\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u5DF2\u51BB\u7ED3\u7684 [ENGRAM] \u5757\u4FDD\u6301\u524D\u7F00\u7A33\u5B9A\u3002" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: s2.failed, children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: s2.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            style: { ...s2.discard, ...!anyDirty || saving ? s2.disabled : void 0 },
            disabled: !anyDirty || saving,
            onClick: discard,
            children: "\u653E\u5F03\u4FEE\u6539"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            style: { ...s2.save, ...!anyDirty || saving ? s2.disabled : void 0 },
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
}

		return module.exports;
	}
});
