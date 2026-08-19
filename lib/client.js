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
  async links(workspace) {
    return readJson(await fetch(`${API_PREFIX}/links${query({ workspace })}`));
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
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
  th: {
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: "1px solid var(--dsh-color-border, #e5e7eb)",
    color: "var(--dsh-color-muted, #6b7280)",
    fontWeight: 600,
    whiteSpace: "nowrap"
  },
  td: { padding: "6px 8px", borderBottom: "1px solid var(--dsh-color-border, #f3f4f6)", verticalAlign: "top" },
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
function LoomSection({ api, t }) {
  const [overview, setOverview] = (0, import_react2.useState)(null);
  const [memories, setMemories] = (0, import_react2.useState)([]);
  const [tasks, setTasks] = (0, import_react2.useState)([]);
  const [links, setLinks] = (0, import_react2.useState)([]);
  const [error, setError] = (0, import_react2.useState)(null);
  const [workspace, setWorkspace] = (0, import_react2.useState)("");
  const [kind, setKind] = (0, import_react2.useState)("");
  const [q, setQ] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [gcDryRun, setGcDryRun] = (0, import_react2.useState)(true);
  const [gcReport, setGcReport] = (0, import_react2.useState)(null);
  const [gcRunning, setGcRunning] = (0, import_react2.useState)(false);
  const refresh = (0, import_react2.useCallback)(async () => {
    setBusy(true);
    setError(null);
    try {
      const ov = await api.overview();
      setOverview(ov);
      const ws = workspace || Object.keys(ov.workspaces)[0] || "";
      if (ws) setWorkspace(ws);
      const [mem, tas] = await Promise.all([
        api.memories({ workspace: workspace || void 0, q: q || void 0, kind: kind || void 0 }),
        ws ? api.tasks(ws, true) : Promise.resolve({ items: [] })
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
  (0, import_react2.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const workspaces = (0, import_react2.useMemo)(() => overview ? Object.keys(overview.workspaces) : [], [overview]);
  const kindsPresent = (0, import_react2.useMemo)(() => overview ? Object.keys(overview.kinds) : [], [overview]);
  const cfg = overview?.config ?? null;
  const act = async (fn) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  const gc = overview?.gc ?? null;
  const { vars } = useLoomTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.root, ...vars }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { style: s.h1, children: "Loom \u8BB0\u5FC6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: s.sub, children: "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6 \xB7 \u96F6 LLM \u81EA\u52A8\u6355\u83B7 \xB7 \u7B26\u53F7\u7D22\u5F15\u6E10\u8FDB\u62AB\u9732 \u2014 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_loom.json" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.error, children: [
      t("error"),
      ": ",
      error
    ] }),
    overview && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.stats, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(overview.totals.memories), label: "\u8BB0\u5FC6 (active)" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(overview.totals.tasks), label: "\u4EFB\u52A1 (active)" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, { num: String(overview.totals.links), label: "\u5173\u7CFB" }),
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
    ] }),
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
        workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "(no workspaces)" }),
        workspaces.map((ws) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: ws, children: ws }, ws))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: s.input, value: kind, onChange: (e) => setKind(e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u5168\u90E8\u7C7B\u578B" }),
        kindsPresent.map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: k, children: KIND_LABEL[k] ?? k }, k))
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u7C7B\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u5185\u5BB9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u6807\u7B7E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "\u65F6\u95F4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "hits" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "signal" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th, children: "TTL" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: s.th })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", { children: [
        memories.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { colSpan: 8, style: s.empty, children: "\u6682\u65E0\u8BB0\u5FC6 \u2014 \u4F7F\u7528 loom_store \u663E\u5F0F\u8BB0\u5F55\uFF0C\u6216\u8BA9\u81EA\u52A8\u6355\u83B7\u5DE5\u4F5C\uFF08git \u63D0\u4EA4 / \u5173\u952E\u6587\u4EF6\u7F16\u8F91 / \u5DE5\u5177\u9519\u8BEF\uFF09" }) }),
        memories.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge, background: KIND_COLORS[m.kind] ?? "#6b7280" }, children: KIND_LABEL[m.kind] ?? m.kind }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: { ...s.td, maxWidth: 520 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: m.text }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.mono, children: [
              m.id.slice(0, 8),
              m.entity ? ` \xB7 ${m.entity}` : ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: m.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.tag, children: tag }, tag)) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: fmtDate(m.createdAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: m.hits }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: m.signal.toFixed(2) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: s.td, children: daysLeft(m.expiresAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: s.td, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, title: "\u5F52\u6863\uFF08TTL/\u8F6F\u5220\uFF0C\u53EF\u6062\u590D\u4E0D\u8F7D\u5165\u7D22\u5F15\uFF09", onClick: () => void act(() => api.archive(m.id, m.workspace)), children: "\u5F52\u6863" }),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: s.btn, title: "\u6C38\u4E45\u5220\u9664", onClick: () => {
              if (window.confirm(`\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6?
${m.text.slice(0, 60)}`)) void act(() => api.remove(m.id, m.workspace));
            }, children: "\u5220\u9664" })
          ] })
        ] }, m.id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.panelTitle, children: "ESR \u4EFB\u52A1\uFF08\u8BC1\u636E\u95ED\u73AF\uFF09" }),
    tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u4EFB\u52A1 \u2014 esr_task \u521B\u5EFA" }),
    tasks.map((task) => {
      const gaps = taskGaps(task);
      const isStable = task.state === "stable";
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.subPanel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontWeight: 600, fontSize: 13 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.mono, children: task.id.slice(0, 6) }),
          " ",
          task.name,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" }, children: isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE" })
        ] }),
        !isStable && gaps.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted, #6b7280)", marginTop: 4 }, children: [
          "\u7F3A\u53E3\uFF1A",
          gaps.join(", "),
          " \u2014 \u63D0\u4F9B artifact / evaluation / memory_ref \u540E esr_close \u8F6C STABLE"
        ] }),
        task.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsh-color-muted-strong, #4b5563)", marginTop: 4 }, children: task.description }),
        task.memoryRefs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12, marginTop: 4 }, children: [
          "\u8BB0\u5FC6\u5F15\u7528\uFF1A",
          task.memoryRefs.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.tag, children: r.slice(0, 8) }, r))
        ] })
      ] }, task.id);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.panelTitle, children: "\u5173\u7CFB\uFF08esr_link\uFF09" }),
    links.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.empty, children: "\u6682\u65E0\u5173\u7CFB" }),
    links.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 12.5, padding: "2px 0" }, children: [
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
  ] });
}

// client/src/LoomConfigCard.tsx
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var FIELDS = [
  { key: "autoCapture", label: "\u81EA\u52A8\u6355\u83B7", hint: "\u96F6 LLM \u4ECE\u5DE5\u5177\u7ED3\u679C\u63D0\u53D6\u8BB0\u5FC6\uFF08git/\u5173\u952E\u6587\u4EF6/\u9519\u8BEF\uFF09", kind: "bool" },
  { key: "sessionSearch", label: "\u4F1A\u8BDD\u5386\u53F2\u641C\u7D22", hint: "loom_recall \u652F\u6301\u8DE8\u4F1A\u8BDD FTS \u515C\u5E95", kind: "bool" },
  { key: "autoCapturePerSession", label: "\u6BCF\u4F1A\u8BDD\u6355\u83B7\u4E0A\u9650", hint: "\u5355\u4F1A\u8BDD\u81EA\u52A8\u6355\u83B7\u6761\u6570\u4E0A\u9650", kind: "num", min: 0, max: 1e3 },
  { key: "indexMaxLines", label: "\u7D22\u5F15\u6700\u5927\u884C\u6570", hint: "[LOOM] \u5757\u6700\u591A\u663E\u793A\u7684\u6761\u76EE\u884C\u6570", kind: "num", min: 0, max: 50 },
  { key: "indexMaxChars", label: "\u7D22\u5F15\u5B57\u7B26\u4E0A\u9650", hint: "[LOOM] \u5757 token \u9884\u7B97", kind: "num", min: 0, max: 4e3 },
  { key: "minIndexSignal", label: "\u5165\u7D22\u5F15\u4FE1\u53F7\u9608\u503C", hint: "signal \u2265 \u6B64\u503C\u7684\u81EA\u52A8\u6355\u83B7\u624D\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 1, step: 0.05 },
  { key: "promoteHits", label: "\u664B\u5347\u547D\u4E2D\u6570", hint: "hit \u6570\u8FBE\u6B64\u503C\u7684\u4F4E\u4FE1\u53F7\u6761\u76EE\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 20 },
  { key: "expireDays", label: "TTL\uFF08\u5929\uFF09", hint: "0 = \u4E0D\u8FC7\u671F", kind: "num", min: 0, max: 3650 },
  { key: "maxMemoriesPerWorkspace", label: "\u5DE5\u4F5C\u533A\u8BB0\u5FC6\u4E0A\u9650", kind: "num", min: 0, max: 1e4 },
  { key: "gcEnabled", label: "\u8BB0\u5FC6 GC", hint: "\u5B9A\u65F6\u56DE\u6536\uFF08\u8FC7\u671F/\u8D85\u5BB9\u91CF/stable \u8D85\u7A97/\u60AC\u7A7A\u94FE\u63A5\uFF09", kind: "bool" },
  { key: "gcStableRetentionDays", label: "stable \u4EFB\u52A1\u4FDD\u7559\uFF08\u5929\uFF09", hint: "\u8D85\u7A97\u540E\u7531 GC \u5F52\u6863\u3001\u79BB\u5F00 [ESR] \u8868\u9762", kind: "num", min: 0, max: 3650 }
];
var s2 = {
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--dsh-color-border, #f3f4f6)" },
  label: { fontSize: 13, fontWeight: 600 },
  hint: { fontSize: 11.5, color: "var(--dsh-color-muted, #6b7280)" },
  input: {
    width: 90,
    border: "1px solid var(--dsh-color-border, #d1d5db)",
    borderRadius: 6,
    padding: "4px 7px",
    fontSize: 12.5,
    background: "var(--dsh-color-surface, #fff)",
    color: "inherit"
  },
  actions: { display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" },
  btn: { border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  btnPrimary: { border: "1px solid var(--dsh-color-primary, #2563eb)", background: "var(--dsh-color-primary, #2563eb)", color: "#fff", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  note: { fontSize: 11.5, color: "var(--dsh-color-muted, #9ca3af)", marginTop: 8 }
};
function LoomConfigCard({ scope }) {
  const [snap, setSnap] = (0, import_react3.useState)(null);
  const [draft, setDraft] = (0, import_react3.useState)({});
  const [saving, setSaving] = (0, import_react3.useState)(false);
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
  const save = (0, import_react3.useCallback)(async () => {
    setSaving(true);
    try {
      for (const field of FIELDS) {
        const value2 = draft[field.key];
        if (value2 !== void 0) {
          if (typeof value2 === "number" && Number.isNaN(value2)) continue;
          await scope.set(field.key, value2);
        }
      }
      await scope.load();
    } finally {
      setSaving(false);
    }
  }, [draft, scope]);
  const resetField = (0, import_react3.useCallback)(async (key) => {
    await scope.unset(key);
    await scope.load();
    setDraft((prev) => ({ ...prev, [key]: void 0 }));
  }, [scope]);
  const value = { ...snap?.base ?? {}, ...draft };
  const writable = snap?.writable !== false && snap?.status !== "unavailable";
  const { vars } = useLoomTheme();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: vars, children: [
    FIELDS.map((field) => {
      const raw = value[field.key];
      const overridden = snap?.user !== void 0 && field.key in snap.user;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: s2.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.label, children: field.label }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.hint, children: field.hint })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
          field.kind === "bool" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "checkbox",
              checked: raw === true,
              disabled: !writable,
              onChange: (e) => setField(field.key, e.target.checked)
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
              style: { ...s2.btn, color: overridden ? "var(--dsh-color-primary, #2563eb)" : "var(--dsh-color-muted-weak, #9ca3af)" },
              title: "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4",
              disabled: !writable || !overridden,
              onClick: () => void resetField(field.key),
              children: "\u91CD\u7F6E"
            }
          )
        ] })
      ] }, field.key);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.actions, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { style: s2.btn, onClick: save, disabled: !writable || saving, children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: s2.note, children: snap?.status === "unavailable" ? "\u8FDC\u7A0B\u6D4F\u89C8\u5668\u4E0D\u53EF\u6301\u4E45\u5316\u8BBE\u7F6E\uFF08loopback-only\uFF09\u3002" : "\u8BBE\u7F6E\u5BF9\u65B0\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u5DF2\u51BB\u7ED3\u7684 [LOOM] \u5757\u4FDD\u6301\u524D\u7F00\u7A33\u5B9A\u3002" })
  ] });
}

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
var inject = ["slots", "locale", "settingsScope"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-loom: dictionaries");
  const api = new LoomApi();
  const t = ctx.locale.bind(NS);
  const sectionInjected = () => ({ api, t });
  try {
    ctx.slots.inject(
      "settings.plugins.tab",
      () => ctx.slots.register(
        {
          name: "settings.plugins.tab",
          id: "loom",
          order: 20,
          label: () => t("nav"),
          locale: NS,
          inject: sectionInjected
        },
        LoomSection
      )
    );
  } catch (error) {
    console.warn("[dsh-loom] settings.plugins.tab registration failed:", error);
  }
  const scope = ctx.settingsScope.bind({ namespace: "dsh-loom" });
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
