window.__ModuleLoader__.load({
	id: "dsh-loom",
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
var API_PREFIX = "/api/dsh-loom";
var LoomApiError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LoomApiError";
  }
};
async function readJson(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new LoomApiError(`HTTP ${response.status}: invalid JSON response`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new LoomApiError(message);
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
var LoomApi = class {
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

// client/src/LoomSection.tsx
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
function useLoomTheme() {
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

// client/src/LoomSection.tsx
var import_jsx_runtime = require("react/jsx-runtime");
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
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--dsh-color-surface, #ffffff)"
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
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "var(--dsh-color-surface, #fff)"
  },
  btnPrimary: {
    border: "1px solid var(--dsh-color-primary, #2563eb)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "#fff",
    background: "var(--dsh-color-primary, #2563eb)"
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" },
  clamp3: { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", maxHeight: 60, minHeight: 18, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "normal" },
  expanded: { whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 },
  linkBtn: { border: "none", background: "none", padding: 0, fontSize: 11.5, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", textDecoration: "underline" },
  pageBar: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--dsh-color-muted, #6b7280)", flexWrap: "wrap" },
  tabBar: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)", marginBottom: 12 },
  tab: { border: "none", background: "none", padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "var(--dsh-color-muted, #6b7280)", borderBottom: "2px solid transparent", fontWeight: 600, margin: 0 },
  tabActive: { border: "none", background: "none", padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "var(--dsh-color-primary, #2563eb)", borderBottom: "2px solid var(--dsh-color-primary, #2563eb)", fontWeight: 700, margin: 0 },
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
  subPanel: { border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.cardNum, children: num }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.cardLabel, children: label })
  ] });
}
function taskGaps(t) {
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
function LoomSection({ api, t }) {
  const [overview, setOverview] = (0, import_react2.useState)(null);
  const [memories, setMemories] = (0, import_react2.useState)([]);
  const [tasks, setTasks] = (0, import_react2.useState)([]);
  const [links, setLinks] = (0, import_react2.useState)([]);
  const [nodes, setNodes] = (0, import_react2.useState)([]);
  const [usageStats, setUsageStats] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [workspace, setWorkspace] = (0, import_react2.useState)("");
  const [kind, setKind] = (0, import_react2.useState)("");
  const [status, setStatus] = (0, import_react2.useState)("active");
  const [q, setQ] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [memPage, setMemPage] = (0, import_react2.useState)(0);
  const [expandedRows, setExpandedRows] = (0, import_react2.useState)(/* @__PURE__ */ new Set());
  const [view, setView] = (0, import_react2.useState)("mem");
  const [gcDryRun, setGcDryRun] = (0, import_react2.useState)(true);
  const [gcReport, setGcReport] = (0, import_react2.useState)(null);
  const [gcRunning, setGcRunning] = (0, import_react2.useState)(false);
  const [newTaskWs, setNewTaskWs] = (0, import_react2.useState)("");
  const [newTaskName, setNewTaskName] = (0, import_react2.useState)("");
  const [newTaskDesc, setNewTaskDesc] = (0, import_react2.useState)("");
  const [newTaskBusy, setNewTaskBusy] = (0, import_react2.useState)(false);
  const [closeFor, setCloseFor] = (0, import_react2.useState)(null);
  const [closeArtifact, setCloseArtifact] = (0, import_react2.useState)("");
  const [closeEval, setCloseEval] = (0, import_react2.useState)("");
  const [closeRefs, setCloseRefs] = (0, import_react2.useState)("");
  const [closeBusy, setCloseBusy] = (0, import_react2.useState)(false);
  const refresh = (0, import_react2.useCallback)(async () => {
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
  (0, import_react2.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const workspaces = (0, import_react2.useMemo)(() => overview ? Object.keys(overview.workspaces) : [], [overview]);
  const kindsPresent = (0, import_react2.useMemo)(() => overview ? Object.keys(overview.kinds) : [], [overview]);
  (0, import_react2.useEffect)(() => {
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
  (0, import_react2.useEffect)(() => {
    setMemPage(0);
  }, [workspace, status, kind, q]);
  (0, import_react2.useEffect)(() => {
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
  const { vars } = useLoomTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.root, ...vars }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { style: s.h1, children: "Loom \u8BB0\u5FC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: s.sub, children: "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6 \xB7 \u96F6 LLM \u81EA\u52A8\u6355\u83B7 \xB7 \u7B26\u53F7\u7D22\u5F15\u6E10\u8FDB\u62AB\u9732 \u2014 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_loom.json" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.error, children: [
      t("error"),
      ": ",
      error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.tabBar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: view === "mem" ? s.tabActive : s.tab, onClick: () => setView("mem"), children: "\u8BB0\u5FC6" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: view === "esr" ? s.tabActive : s.tab, onClick: () => setView("esr"), children: "ESR\uFF08\u4EFB\u52A1 \xB7 \u8282\u70B9 \xB7 \u5173\u7CFB\uFF09" })
    ] }),
    view === "mem" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      overview && (() => {
        const memNum = wsCounts ? wsCounts.memories : overview.totals.memories;
        const taskNum = wsCounts ? wsCounts.tasks : overview.totals.tasks;
        const linkNum = wsCounts ? wsCounts.links : overview.totals.links;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.stats, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(memNum), label: wsCounts ? "\u8BB0\u5FC6 (active)" : "\u8BB0\u5FC6 (active, \u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(taskNum), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(linkNum), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(workspaces.length), label: "\u5DE5\u4F5C\u533A" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(overview.captures.total), label: "\u81EA\u52A8\u6355\u83B7" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            StatCard,
            {
              num: indexCost ? `~${indexCost.tokens}` : "\u2013",
              label: "[LOOM] \u7D22\u5F15 token / \u5DE5\u4F5C\u533A"
            }
          ),
          gc && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            StatCard,
            {
              num: String(gc.archivedMemories + gc.archivedTasks),
              label: `GC \u5DF2\u5F52\u6863 \xB7 \u94FE\u63A5-${gc.removedLinks}`
            }
          )
        ] });
      })(),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.subPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: 700, fontSize: 13 }, children: "\u8BB0\u5FC6 GC\uFF08pi-esr \u7EA6\u675F\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: gcDryRun, onChange: (e) => setGcDryRun(e.target.checked) }),
            "\u4EC5\u9884\u89C8\uFF08dry run\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnPrimary, onClick: () => void runGc(), disabled: gcRunning || !workspace, children: gcRunning ? "\u2026" : "\u8FD0\u884C GC" }),
          gc && gc.lastRun > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.mono, children: [
            "\u4E0A\u6B21 ",
            fmtDate(gc.lastRun)
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "\u5DE5\u4F5C\u96C6\uFF08active \u4EFB\u52A1\u5F15\u7528 / \u4EFB\u52A1\u8BB0\u5FC6 / \u5DF2\u5165\u7D22\u5F15\u547D\u4E2D\uFF09\u6C38\u4E0D\u9A71\u9010\uFF1BTTL \u8FC7\u671F\u5F52\u6863\u3001\u8D85\u5BB9\u91CF\u6DD8\u6C70\u3001stable \u4EFB\u52A1\u8D85\u7A97\u5F52\u6863\u3001\u60AC\u7A7A\u94FE\u63A5\u6E05\u7406\u3002\u53EA\u5F52\u6863\u4E0D\u786C\u5220\u2014\u2014\u6761\u76EE id \u4FDD\u6301\u53EF\u91CD\u53D6\u3002" }),
        gcReport && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8, fontSize: 12.5 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            gcReport.dryRun ? "dry-run \u9884\u89C8\uFF1A" : "\u5DF2\u6267\u884C\uFF1A",
            " ",
            "\u5F52\u6863\u8BB0\u5FC6 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: gcReport.archivedMemories.length }),
            " \xB7 \u5F52\u6863\u4EFB\u52A1 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: gcReport.archivedTasks.length }),
            " \xB7 \u6E05\u7406\u94FE\u63A5 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: gcReport.removedLinks.length }),
            " \xB7 \u4FDD\u62A4 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: gcReport.protectedMemories })
          ] }),
          gcReport.archivedMemories.slice(0, 5).map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.mono, children: [
            "- ",
            e.id.slice(0, 8),
            " ",
            e.reason,
            ": ",
            e.text
          ] }, e.id)),
          gcReport.archivedTasks.slice(0, 3).map((t2) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.mono, children: [
            "- ",
            t2.id.slice(0, 6),
            " ",
            t2.reason,
            ": ",
            t2.name
          ] }, t2.id)),
          gcReport.removedLinks.slice(0, 3).map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.mono, children: [
            "- link ",
            l.source.slice(0, 8),
            " --",
            l.relation,
            "--> ",
            l.target.slice(0, 8)
          ] }, l.id))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: s.input, value: workspace, onChange: (e) => setWorkspace(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5168\u90E8\u5DE5\u4F5C\u533A" }),
          workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: ws, children: [
            ws,
            "\uFF08",
            overview?.workspaces[ws]?.memories ?? 0,
            " \u6761\uFF09"
          ] }, ws))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(-1), children: "\u2039 \u4E0A\u4E00\u5DE5\u4F5C\u533A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, disabled: workspace === "" || workspaces.length === 0, onClick: () => goWorkspace(1), children: "\u4E0B\u4E00\u5DE5\u4F5C\u533A \u203A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: s.input, value: kind, onChange: (e) => setKind(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5168\u90E8\u7C7B\u578B" }),
          kindsPresent.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: k, children: KIND_LABEL[k] ?? k }, k))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: s.input, value: status, onChange: (e) => setStatus(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "active", children: "\u4EC5\u6D3B\u52A8" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "archived", children: "\u5DF2\u5F52\u6863" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnPrimary, onClick: () => void refresh(), disabled: busy, children: busy ? "\u2026" : t("refresh") })
      ] }),
      cfg && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
          "autoCapture ",
          cfg.autoCapture ? "on" : "off"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
          "sessionSearch ",
          cfg.sessionSearch ? "on" : "off"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
          "TTL ",
          cfg.expireDays,
          "d"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
          "index ",
          cfg.indexMaxLines,
          " \u884C / ",
          cfg.indexMaxChars,
          " \u5B57\u7B26"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
          "promote \u2265",
          cfg.promoteHits,
          " hits"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { style: s.table, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("colgroup", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("col", { style: { width: 58 } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("col", {}),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("col", { style: { width: 72 } })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u7C7B\u578B" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u5185\u5BB9" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", { children: [
          flatRows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { colSpan: 3, style: s.empty, children: "\u6682\u65E0\u8BB0\u5FC6 \u2014 \u4F7F\u7528 loom_store \u663E\u5F0F\u8BB0\u5F55\uFF0C\u6216\u8BA9\u81EA\u52A8\u6355\u83B7\u5DE5\u4F5C\uFF08git \u63D0\u4EA4 / \u5173\u952E\u6587\u4EF6\u7F16\u8F91 / \u5DE5\u5177\u9519\u8BEF\uFF09" }) }),
          memPageRows.map(
            (r) => r.kind === "head" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { colSpan: 3, style: s.wsHead, children: [
              r.ws,
              " \xB7 ",
              r.count,
              " \u6761"
            ] }) }, `h-${r.ws}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: { ...s.td, whiteSpace: "nowrap" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge, background: KIND_COLORS[r.m.kind] ?? "#6b7280" }, children: KIND_LABEL[r.m.kind] ?? r.m.kind }),
                r.m.status === "archived" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.tag, color: "#b45309", background: "#fef3c7" }, children: "archived" })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: { ...s.td, minWidth: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { title: r.m.text, style: expandedRows.has(r.m.id) ? s.expanded : s.clamp3, children: r.m.text }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 2, flexWrap: "wrap" }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.mono, ...s.ellipsis, flex: "1 1 160px" }, title: `${fmtDate(r.m.createdAt)} \xB7 ${r.m.id} \xB7 ${r.m.entity ?? ""} \xB7 signal ${r.m.signal.toFixed(2)} \xB7 hits ${r.m.hits} \xB7 TTL ${daysLeft(r.m.expiresAt)}`, children: [
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
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.linkBtn, onClick: () => toggleExpand(r.m.id), children: expandedRows.has(r.m.id) ? "\u6536\u8D77" : "\u5C55\u5F00\u5168\u6587" })
                ] }),
                r.m.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }, children: r.m.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.tag, children: tag }, tag)) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, title: "\u5F52\u6863\uFF08TTL/\u8F6F\u5220\uFF0C\u53EF\u6062\u590D\u4E0D\u8F7D\u5165\u7D22\u5F15\uFF09", onClick: () => void act(() => api.archive(r.m.id, r.m.workspace)), children: "\u5F52\u6863" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, title: "\u6C38\u4E45\u5220\u9664", onClick: () => {
                  if (window.confirm(`\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6?
${r.m.text.slice(0, 60)}`)) void act(() => api.remove(r.m.id, r.m.workspace));
                }, children: "\u5220\u9664" })
              ] }) })
            ] }, r.m.id)
          )
        ] })
      ] }),
      flatRows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.pageBar, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, disabled: memPageSafe === 0, onClick: () => setMemPage(memPageSafe - 1), children: "\u2039 \u4E0A\u4E00\u9875" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "\u7B2C ",
          memPageSafe + 1,
          " / ",
          memPageCount,
          " \u9875 \xB7 \u5171 ",
          flatRows.length,
          " \u6761"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, disabled: memPageSafe >= memPageCount - 1, onClick: () => setMemPage(memPageSafe + 1), children: "\u4E0B\u4E00\u9875 \u203A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { style: s.input, value: memPageSafe, onChange: (e) => setMemPage(Number(e.target.value)), title: "\u8DF3\u9875", children: Array.from({ length: memPageCount }, (_, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: i, children: [
          "\u7B2C ",
          i + 1,
          " \u9875"
        ] }, i)) })
      ] })
    ] }),
    view === "esr" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.stats, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(wsCounts ? wsCounts.tasks : overview?.totals.tasks ?? 0), label: wsCounts ? "\u4EFB\u52A1 (active)" : "\u4EFB\u52A1 (active, \u5168\u5C40)" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(wsCounts ? wsCounts.links : overview?.totals.links ?? 0), label: wsCounts ? "\u5173\u7CFB" : "\u5173\u7CFB (\u5168\u5C40)" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(wsCounts ? wsCounts.nodes ?? 0 : overview?.totals.nodes ?? 0), label: wsCounts ? "\u8282\u70B9" : "\u8282\u70B9 (\u5168\u5C40)" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.subPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 6 }, children: [
          "agent \u884C\u4E3A\u89C2\u6D4B",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11.5, fontWeight: 400, color: "var(--dsh-color-muted, #6b7280)" }, children: " \xB7 \u6BCF\u6B21 loom_*/esr_* \u5DE5\u5177\u8C03\u7528\u5B9E\u65F6\u7D2F\u8BA1\uFF08\u771F\u5B9E\u6570\u636E\uFF0C\u6309\u5DE5\u4F5C\u533A/\u5929\u6EDA\u52A8\uFF09" })
        ] }),
        !usageStats ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.mono, children: "\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "ESR \u4E3B\u52A8\u6027 ",
              pct(usageStats.ratios.esrRatio),
              "\uFF08",
              usageStats.ratios.esrCalls,
              "/",
              usageStats.ratios.calls,
              " \u6B21\uFF09"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "\u53EC\u56DE\u547D\u4E2D\u7387 ",
              pct(usageStats.ratios.recallHitRate)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "\u5E73\u5747\u547D\u4E2D ",
              usageStats.ratios.recallHitsPerQuery ?? "\u2013",
              "/\u67E5\u8BE2"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "detail \u8F6C\u5316 ",
              pct(usageStats.ratios.detailFollowRate)
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "\u5931\u8D25 ",
              usageStats.totals.failures
            ] }),
            usageStats.ratios.calls < 10 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              "\u6837\u672C\u4E0D\u8DB3\uFF08",
              usageStats.ratios.calls,
              " \u6B21\uFF09\uFF0C\u6BD4\u4F8B\u4EC5\u4F9B\u53C2\u8003"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: "ESR \u4E3B\u52A8\u6027\u8FC7\u4F4E\u65F6\uFF0C\u4E0B\u4E00\u4E2A\u4F1A\u8BDD\u7684 [ESR] \u6CE8\u5165\u5757\u4F1A\u9644\u52A0\u4E00\u884C\u57FA\u4E8E\u771F\u5B9E\u6570\u636E\u7684 escalate \u63D0\u9192\uFF0C\u5F15\u5BFC\u6A21\u578B\u5F53\u573A\u8865\u5EFA\u4EFB\u52A1/\u8282\u70B9/\u5173\u7CFB\u2014\u2014\u6BD4\u4F8B\u56DE\u5347\u540E\u63D0\u9192\u81EA\u52A8\u6D88\u5931\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted-weak, #9ca3af)", marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: [
            "\u5DE5\u5177\u8C03\u7528\uFF1A",
            Object.entries(usageStats.totals.counts).map(([k, v]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.tag, children: [
              k,
              " \xD7",
              v
            ] }, k))
          ] }),
          usageStats.byDay.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }, children: usageStats.byDay.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            d.day,
            " \xB7 \u8C03\u7528 ",
            Object.values(d.counts).reduce((a, b) => a + b, 0),
            " \xB7 \u5931\u8D25 ",
            d.failures
          ] }, d.day)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.panelTitle, children: [
        "ESR \u4EFB\u52A1\uFF08\u8BC1\u636E\u95ED\u73AF\uFF09",
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.subPanel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: s.input, value: newTaskWs, onChange: (e) => setNewTaskWs(e.target.value), children: [
          workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "(no workspaces)" }),
          workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: ws, children: ws }, ws))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...s.input, width: 170 }, placeholder: "\u4EFB\u52A1\u540D\u2026", value: newTaskName, onChange: (e) => setNewTaskName(e.target.value), onKeyDown: (e) => {
          if (e.key === "Enter") void createNewTask();
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...s.input, width: 240 }, placeholder: "\u8981\u4EA7\u51FA / \u6EE1\u8DB3\u4EC0\u4E48\uFF08\u53EF\u9009\uFF09", value: newTaskDesc, onChange: (e) => setNewTaskDesc(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnPrimary, disabled: newTaskBusy || newTaskName.trim() === "", onClick: () => void createNewTask(), children: newTaskBusy ? "\u2026" : "\u65B0\u5EFA\u4EFB\u52A1" })
      ] }) }),
      tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u4EFB\u52A1 \u2014 \u7528\u4E0A\u65B9\u300C\u65B0\u5EFA\u4EFB\u52A1\u300D\u6216 esr_task \u5DE5\u5177\u521B\u5EFA" }),
      taskGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react2.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u4E2A\u4EFB\u52A1"
        ] }),
        items.map((task) => {
          const gaps = taskGaps(task);
          const isStable = task.state === "stable";
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.subPanel, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontWeight: 600, fontSize: 13 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.mono, children: task.id.slice(0, 6) }),
              " ",
              task.name,
              " ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }, children: isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE" }),
              !isStable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, onClick: () => setCloseFor(closeFor === task.id ? null : task.id), children: closeFor === task.id ? "\u6536\u8D77" : "\u586B\u5199\u8BC1\u636E\u5173\u95ED\u2026" })
            ] }),
            !isStable && gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: [
              "\u7F3A\u53E3\uFF1A",
              gaps.join(", "),
              " \u2014 \u63D0\u4F9B artifact / evaluation / memory_ref \u540E\u8F6C\u4E3A STABLE"
            ] }),
            task.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }, children: task.description }),
            task.memoryRefs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, marginTop: 4 }, children: [
              "\u8BB0\u5FC6\u5F15\u7528\uFF1A",
              task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.tag, children: r.slice(0, 8) }, r))
            ] }),
            closeFor === task.id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8, padding: 8, border: "1px solid var(--dsh-color-border, #e5e7eb)", borderRadius: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 11, color: "var(--dsh-color-muted, #6b7280)", marginBottom: 6 }, children: "\u63D0\u4F9B\u8BC1\u636E\u540E\u5173\u95ED\uFF08\u4E09\u9879\u5168\u9F50\u624D\u8F6C STABLE\uFF09" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "artifact \u8DEF\u5F84/URL", value: closeArtifact, onChange: (e) => setCloseArtifact(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "evaluation \u9A8C\u8BC1\u8BC1\u636E", value: closeEval, onChange: (e) => setCloseEval(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...s.input, width: 150 }, placeholder: "memory_refs \u9017\u53F7\u5206\u9694", value: closeRefs, onChange: (e) => setCloseRefs(e.target.value) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btnPrimary, disabled: closeBusy, onClick: () => void submitClose(task), children: closeBusy ? "\u2026" : "\u63D0\u4EA4\u5173\u95ED" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, onClick: () => setCloseFor(null), children: "\u53D6\u6D88" })
              ] })
            ] })
          ] }, task.id);
        })
      ] }, ws)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.panelTitle, children: [
        "\u8282\u70B9\u4E0E\u5173\u7CFB\uFF08esr_node / esr_link\uFF09",
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "var(--dsh-color-muted, #9ca3af)" }, children: "\xB7 \u5168\u90E8\u5DE5\u4F5C\u533A" })
      ] }),
      nodes.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u8282\u70B9 \u2014 \u6A21\u578B\u4F1A\u4E3A\u53CD\u590D\u51FA\u73B0\u7684\u9886\u57DF\u5BF9\u8C61\u4E3B\u52A8\u767B\u8BB0\uFF08esr_node\uFF09\uFF0C\u6B64\u5904\u4E5F\u53EF\u67E5\u770B\u5173\u7CFB" }),
      nodeGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react2.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u4E2A\u8282\u70B9"
        ] }),
        items.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12.5, padding: "2px 0" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mono", style: { ...s.mono, color: "#4338ca" }, children: n.id.slice(0, 24) }),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: n.name }),
          n.kind && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.tag, color: "#4338ca", background: "#eef2ff" }, children: n.kind }),
          n.description && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--dsh-color-muted, #6b7280)" }, children: [
            " \u2014 ",
            n.description.slice(0, 48)
          ] })
        ] }, n.id))
      ] }, ws)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 6 }, children: "\u5173\u7CFB\uFF1A" }),
      links.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u5173\u7CFB \u2014 esr_link \u521B\u5EFA" }),
      linkGroups.map(([ws, items]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react2.Fragment, { children: [
        workspace === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.groupLabel, children: [
          ws,
          " \xB7 ",
          items.length,
          " \u6761\u5173\u7CFB"
        ] }),
        items.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12.5, padding: "2px 0" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mono", style: s.mono, children: l.source.slice(0, 10) }),
          " ",
          "--",
          l.relation,
          "-->",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mono", style: s.mono, children: l.target.slice(0, 10) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--dsh-color-muted-weak, #9ca3af)" }, children: [
            " \xB7 ",
            fmtDate(l.createdAt)
          ] })
        ] }, l.id))
      ] }, ws))
    ] })
  ] });
}

// client/src/LoomConfigCard.tsx
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var GROUPS = [
  {
    id: "capture",
    title: "\u6355\u83B7\u4E0E\u68C0\u7D22",
    description: "\u96F6 LLM \u81EA\u52A8\u6355\u83B7\u4E0E\u8DE8\u4F1A\u8BDD\u641C\u7D22",
    fields: [
      { key: "autoCapture", label: "\u81EA\u52A8\u6355\u83B7", hint: "\u96F6 LLM \u4ECE\u5DE5\u5177\u7ED3\u679C\u63D0\u53D6\u8BB0\u5FC6\uFF08git/\u5173\u952E\u6587\u4EF6/\u9519\u8BEF\uFF09", kind: "bool" },
      { key: "autoCapturePerSession", label: "\u6BCF\u4F1A\u8BDD\u6355\u83B7\u4E0A\u9650", hint: "\u5355\u4F1A\u8BDD\u81EA\u52A8\u6355\u83B7\u6761\u6570\u4E0A\u9650", kind: "num", min: 0, max: 1e3 },
      { key: "sessionSearch", label: "\u4F1A\u8BDD\u5386\u53F2\u641C\u7D22", hint: "loom_recall \u652F\u6301\u8DE8\u4F1A\u8BDD FTS \u515C\u5E95", kind: "bool" }
    ]
  },
  {
    id: "index",
    title: "\u7D22\u5F15",
    description: "[LOOM] \u5757\u7684\u5185\u5BB9\u9884\u7B97\u4E0E\u664B\u5347\u89C4\u5219",
    fields: [
      { key: "indexMaxLines", label: "\u7D22\u5F15\u6700\u5927\u884C\u6570", hint: "[LOOM] \u5757\u6700\u591A\u663E\u793A\u7684\u6761\u76EE\u884C\u6570", kind: "num", min: 0, max: 50 },
      { key: "indexMaxChars", label: "\u7D22\u5F15\u5B57\u7B26\u4E0A\u9650", hint: "[LOOM] \u5757 token \u9884\u7B97", kind: "num", min: 0, max: 4e3 },
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
var CARD_DESCRIPTION = "\u63A7\u5236 loom \u8BB0\u5FC6\u7684\u6355\u83B7\u3001\u7D22\u5F15\u3001\u4FDD\u7559\u4E0E\u96A7\u9053\u8BBF\u95EE";
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
function LoomConfigCard({ scope }) {
  const [snap, setSnap] = (0, import_react3.useState)(null);
  const [draft, setDraft] = (0, import_react3.useState)({});
  const [saving, setSaving] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [open, setOpen] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
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
  const setField = (0, import_react3.useCallback)((key, value2) => {
    setDraft((prev) => ({ ...prev, [key]: value2 }));
  }, []);
  const effective = snap?.value ?? snap?.base ?? {};
  const anyDirty = FIELDS.some((field) => {
    const staged = draft[field.key];
    return staged !== void 0 && staged !== effective[field.key];
  });
  const save = (0, import_react3.useCallback)(async () => {
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
  const discard = (0, import_react3.useCallback)(() => {
    setError(null);
    const value2 = snap?.value ?? snap?.base ?? {};
    setDraft({ ...value2 });
  }, [snap]);
  const resetField = (0, import_react3.useCallback)(async (key) => {
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
  const { vars } = useLoomTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: vars, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: available ? { ...s2.card, ...open ? s2.cardOpen : void 0 } : { display: "none" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        style: s2.header,
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"} dsh-loom \u8BBE\u7F6E`,
        onClick: () => setOpen((prev) => !prev),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: s2.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s2.name, children: "dsh-loom" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s2.description, children: CARD_DESCRIPTION })
          ] }),
          anyDirty && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: s2.pending, children: "\u672A\u4FDD\u5B58" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Chevron, { open })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.body, children: [
      !writable && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: s2.readOnly, children: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF08\u5BBF\u4E3B\u672A\u6388\u6743\u5199\u5165\u6216\u9700\u91CD\u542F\u5E94\u7528\uFF09\u3002" }),
      GROUPS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.groupPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.groupHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.groupTitle, children: group.title }),
          group.description && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.groupDesc, children: group.description })
        ] }),
        group.fields.map((field) => {
          const raw = value[field.key];
          const overridden = snap?.user !== void 0 && field.key in snap.user;
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.label, children: field.label }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.hint, children: field.hint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
              field.kind === "bool" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: raw === true,
                  disabled: !writable,
                  onChange: (e) => setField(field.key, e.target.checked)
                }
              ) : field.kind === "text" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
              ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.note, children: "\u8BBE\u7F6E\u5BF9\u65B0\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u5DF2\u51BB\u7ED3\u7684 [LOOM] \u5757\u4FDD\u6301\u524D\u7F00\u7A33\u5B9A\u3002" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.failed, children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            style: { ...s2.discard, ...!anyDirty || saving ? s2.disabled : void 0 },
            disabled: !anyDirty || saving,
            onClick: discard,
            children: "\u653E\u5F03\u4FEE\u6539"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
var LoomScopeImpl = class {
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
var NS = "dsh-loom";
var zh = {
  nav: "Loom \u8BB0\u5FC6",
  refresh: "\u5237\u65B0",
  error: "\u8BFB\u53D6\u5931\u8D25"
};
var en = {
  nav: "Loom Memory",
  refresh: "Refresh",
  error: "Load failed"
};
var inject = ["slots", "locale", "connection"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-loom: dictionaries");
  const api = new LoomApi();
  const t = ctx.locale.bind(NS);
  const sectionInjected = () => ({ api, t });
  try {
    ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "loom",
          order: 16,
          label: () => t("nav"),
          locale: NS,
          inject: sectionInjected
        },
        LoomSection
      )
    );
  } catch (error) {
    console.warn("[dsh-loom] settings.section registration failed:", error);
  }
  const connection = ctx.get("connection");
  const scope = new LoomScopeImpl(connection.api, "dsh-loom");
  const cardInjected = () => ({ scope });
  try {
    ctx.slots.inject(
      "settings.plugin.item",
      () => ctx.slots.register(
        {
          name: "settings.plugin.item",
          id: "dsh-loom",
          key: "dsh-loom",
          locale: NS,
          inject: cardInjected
        },
        LoomConfigCard
      )
    );
  } catch (error) {
    console.warn("[dsh-loom] settings.plugin.item registration failed:", error);
  }
}

		return module.exports;
	}
});
