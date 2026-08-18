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
  overview() {
    return readJson(fetch(`${API_PREFIX}/overview`));
  }
  memories(opts = {}) {
    return readJson(
      fetch(`${API_PREFIX}/memories${query({ workspace: opts.workspace, q: opts.q, kind: opts.kind, status: opts.status, limit: opts.limit })}`)
    );
  }
  tasks(workspace, includeStable = false) {
    return readJson(fetch(`${API_PREFIX}/tasks${query({ workspace, includeStable: includeStable ? "1" : void 0 })}`));
  }
  links(workspace) {
    return readJson(fetch(`${API_PREFIX}/links${query({ workspace })}`));
  }
  config() {
    return readJson(fetch(`${API_PREFIX}/config`));
  }
  async archive(id, workspace) {
    await readJson(
      fetch(`${API_PREFIX}/memories/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace })
      })
    );
  }
  async remove(id, workspace) {
    await readJson(
      fetch(`${API_PREFIX}/memories/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace })
      })
    );
  }
};

// client/src/LoomSection.tsx
var import_react = require("react");
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
  return /* @__PURE__ */ React.createElement("div", { style: s.card }, /* @__PURE__ */ React.createElement("div", { style: s.cardNum }, num), /* @__PURE__ */ React.createElement("div", { style: s.cardLabel }, label));
}
function taskGaps(t) {
  const gaps = [];
  if (!t.artifact) gaps.push("artifact");
  if (!t.evaluation) gaps.push("evaluation");
  if (!t.memoryRefs || t.memoryRefs.length === 0) gaps.push("memory_ref");
  return gaps;
}
function LoomSection({ api, t }) {
  const [overview, setOverview] = (0, import_react.useState)(null);
  const [memories, setMemories] = (0, import_react.useState)([]);
  const [tasks, setTasks] = (0, import_react.useState)([]);
  const [links, setLinks] = (0, import_react.useState)([]);
  const [error, setError] = (0, import_react.useState)(null);
  const [workspace, setWorkspace] = (0, import_react.useState)("");
  const [kind, setKind] = (0, import_react.useState)("");
  const [q, setQ] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const refresh = (0, import_react.useCallback)(async () => {
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
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const workspaces = (0, import_react.useMemo)(() => overview ? Object.keys(overview.workspaces) : [], [overview]);
  const kindsPresent = (0, import_react.useMemo)(() => overview ? Object.keys(overview.kinds) : [], [overview]);
  const cfg = overview?.config ?? null;
  const act = async (fn) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const indexCost = workspace && overview ? overview.indexes[workspace] : null;
  return /* @__PURE__ */ React.createElement("div", { style: s.root }, /* @__PURE__ */ React.createElement("h1", { style: s.h1 }, "Loom \u8BB0\u5FC6"), /* @__PURE__ */ React.createElement("p", { style: s.sub }, "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6 \xB7 \u96F6 LLM \u81EA\u52A8\u6355\u83B7 \xB7 \u7B26\u53F7\u7D22\u5F15\u6E10\u8FDB\u62AB\u9732 \u2014 \u6570\u636E\u6E90 ~/.dsh/storages/dsh_loom.json"), error && /* @__PURE__ */ React.createElement("div", { style: s.error }, t("error"), ": ", error), overview && /* @__PURE__ */ React.createElement("div", { style: s.stats }, /* @__PURE__ */ React.createElement(StatCard, { num: String(overview.totals.memories), label: "\u8BB0\u5FC6 (active)" }), /* @__PURE__ */ React.createElement(StatCard, { num: String(overview.totals.tasks), label: "\u4EFB\u52A1 (active)" }), /* @__PURE__ */ React.createElement(StatCard, { num: String(overview.totals.links), label: "\u5173\u7CFB" }), /* @__PURE__ */ React.createElement(StatCard, { num: String(workspaces.length), label: "\u5DE5\u4F5C\u533A" }), /* @__PURE__ */ React.createElement(StatCard, { num: String(overview.captures.total), label: "\u81EA\u52A8\u6355\u83B7" }), /* @__PURE__ */ React.createElement(
    StatCard,
    {
      num: indexCost ? `~${indexCost.tokens}` : "\u2013",
      label: "[LOOM] \u7D22\u5F15 token / \u5DE5\u4F5C\u533A"
    }
  )), /* @__PURE__ */ React.createElement("div", { style: s.row }, /* @__PURE__ */ React.createElement("select", { style: s.input, value: workspace, onChange: (e) => setWorkspace(e.target.value) }, workspaces.length === 0 && /* @__PURE__ */ React.createElement("option", { value: "" }, "(no workspaces)"), workspaces.map((ws) => /* @__PURE__ */ React.createElement("option", { key: ws, value: ws }, ws))), /* @__PURE__ */ React.createElement("select", { style: s.input, value: kind, onChange: (e) => setKind(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u5168\u90E8\u7C7B\u578B"), kindsPresent.map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, KIND_LABEL[k] ?? k))), /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement("button", { style: s.btnPrimary, onClick: () => void refresh(), disabled: busy }, busy ? "\u2026" : t("refresh"))), cfg && /* @__PURE__ */ React.createElement("div", { style: s.row }, /* @__PURE__ */ React.createElement("span", { style: s.tag }, "autoCapture ", cfg.autoCapture ? "on" : "off"), /* @__PURE__ */ React.createElement("span", { style: s.tag }, "sessionSearch ", cfg.sessionSearch ? "on" : "off"), /* @__PURE__ */ React.createElement("span", { style: s.tag }, "TTL ", cfg.expireDays, "d"), /* @__PURE__ */ React.createElement("span", { style: s.tag }, "index ", cfg.indexMaxLines, " \u884C / ", cfg.indexMaxChars, " \u5B57\u7B26"), /* @__PURE__ */ React.createElement("span", { style: s.tag }, "promote \u2265", cfg.promoteHits, " hits")), /* @__PURE__ */ React.createElement("table", { style: s.table }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: s.th }, "\u7C7B\u578B"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "\u5185\u5BB9"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "\u6807\u7B7E"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "\u65F6\u95F4"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "hits"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "signal"), /* @__PURE__ */ React.createElement("th", { style: s.th }, "TTL"), /* @__PURE__ */ React.createElement("th", { style: s.th }))), /* @__PURE__ */ React.createElement("tbody", null, memories.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 8, style: s.empty }, "\u6682\u65E0\u8BB0\u5FC6 \u2014 \u4F7F\u7528 loom_store \u663E\u5F0F\u8BB0\u5F55\uFF0C\u6216\u8BA9\u81EA\u52A8\u6355\u83B7\u5DE5\u4F5C\uFF08git \u63D0\u4EA4 / \u5173\u952E\u6587\u4EF6\u7F16\u8F91 / \u5DE5\u5177\u9519\u8BEF\uFF09")), memories.map((m) => /* @__PURE__ */ React.createElement("tr", { key: m.id }, /* @__PURE__ */ React.createElement("td", { style: s.td }, /* @__PURE__ */ React.createElement("span", { style: { ...s.badge, background: KIND_COLORS[m.kind] ?? "#6b7280" } }, KIND_LABEL[m.kind] ?? m.kind)), /* @__PURE__ */ React.createElement("td", { style: { ...s.td, maxWidth: 520 } }, /* @__PURE__ */ React.createElement("div", null, m.text), /* @__PURE__ */ React.createElement("div", { style: s.mono }, m.id.slice(0, 8), m.entity ? ` \xB7 ${m.entity}` : "")), /* @__PURE__ */ React.createElement("td", { style: s.td }, m.tags.map((tag) => /* @__PURE__ */ React.createElement("span", { key: tag, style: s.tag }, tag))), /* @__PURE__ */ React.createElement("td", { style: s.td }, fmtDate(m.createdAt)), /* @__PURE__ */ React.createElement("td", { style: s.td }, m.hits), /* @__PURE__ */ React.createElement("td", { style: s.td }, m.signal.toFixed(2)), /* @__PURE__ */ React.createElement("td", { style: s.td }, daysLeft(m.expiresAt)), /* @__PURE__ */ React.createElement("td", { style: s.td }, /* @__PURE__ */ React.createElement("button", { style: s.btn, title: "\u5F52\u6863\uFF08TTL/\u8F6F\u5220\uFF0C\u53EF\u6062\u590D\u4E0D\u8F7D\u5165\u7D22\u5F15\uFF09", onClick: () => void act(() => api.archive(m.id, m.workspace)) }, "\u5F52\u6863"), " ", /* @__PURE__ */ React.createElement("button", { style: s.btn, title: "\u6C38\u4E45\u5220\u9664", onClick: () => {
    if (window.confirm(`\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6?
${m.text.slice(0, 60)}`)) void act(() => api.remove(m.id, m.workspace));
  } }, "\u5220\u9664")))))), /* @__PURE__ */ React.createElement("div", { style: s.panelTitle }, "ESR \u4EFB\u52A1\uFF08\u8BC1\u636E\u95ED\u73AF\uFF09"), tasks.length === 0 && /* @__PURE__ */ React.createElement("div", { style: s.empty }, "\u6682\u65E0\u4EFB\u52A1 \u2014 esr_task \u521B\u5EFA"), tasks.map((task) => {
    const gaps = taskGaps(task);
    const isStable = task.state === "stable";
    return /* @__PURE__ */ React.createElement("div", { key: task.id, style: s.subPanel }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: s.mono }, task.id.slice(0, 6)), " ", task.name, " ", /* @__PURE__ */ React.createElement("span", { style: { ...s.badge, background: isStable ? "#059669" : gaps.length === 0 ? "#2563eb" : "#d97706" } }, isStable ? "STABLE" : gaps.length === 0 ? "READY" : "ACTIVE")), !isStable && gaps.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#6b7280", marginTop: 4 } }, "\u7F3A\u53E3\uFF1A", gaps.join(", "), " \u2014 \u63D0\u4F9B artifact / evaluation / memory_ref \u540E esr_close \u8F6C STABLE"), task.description && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#4b5563", marginTop: 4 } }, task.description), task.memoryRefs.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, marginTop: 4 } }, "\u8BB0\u5FC6\u5F15\u7528\uFF1A", task.memoryRefs.map((r) => /* @__PURE__ */ React.createElement("span", { key: r, style: s.tag }, r.slice(0, 8)))));
  }), /* @__PURE__ */ React.createElement("div", { style: s.panelTitle }, "\u5173\u7CFB\uFF08esr_link\uFF09"), links.length === 0 && /* @__PURE__ */ React.createElement("div", { style: s.empty }, "\u6682\u65E0\u5173\u7CFB"), links.map((l) => /* @__PURE__ */ React.createElement("div", { key: l.id, style: { fontSize: 12.5, padding: "2px 0" } }, /* @__PURE__ */ React.createElement("span", { className: "mono", style: s.mono }, l.source.slice(0, 10)), " ", "--", l.relation, "-->", " ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: s.mono }, l.target.slice(0, 10)), /* @__PURE__ */ React.createElement("span", { style: { color: "#9ca3af" } }, " \xB7 ", fmtDate(l.createdAt)))));
}

// client/src/LoomConfigCard.tsx
var import_react2 = require("react");
var FIELDS = [
  { key: "autoCapture", label: "\u81EA\u52A8\u6355\u83B7", hint: "\u96F6 LLM \u4ECE\u5DE5\u5177\u7ED3\u679C\u63D0\u53D6\u8BB0\u5FC6\uFF08git/\u5173\u952E\u6587\u4EF6/\u9519\u8BEF\uFF09", kind: "bool" },
  { key: "sessionSearch", label: "\u4F1A\u8BDD\u5386\u53F2\u641C\u7D22", hint: "loom_recall \u652F\u6301\u8DE8\u4F1A\u8BDD FTS \u515C\u5E95", kind: "bool" },
  { key: "autoCapturePerSession", label: "\u6BCF\u4F1A\u8BDD\u6355\u83B7\u4E0A\u9650", hint: "\u5355\u4F1A\u8BDD\u81EA\u52A8\u6355\u83B7\u6761\u6570\u4E0A\u9650", kind: "num", min: 0, max: 1e3 },
  { key: "indexMaxLines", label: "\u7D22\u5F15\u6700\u5927\u884C\u6570", hint: "[LOOM] \u5757\u6700\u591A\u663E\u793A\u7684\u6761\u76EE\u884C\u6570", kind: "num", min: 0, max: 50 },
  { key: "indexMaxChars", label: "\u7D22\u5F15\u5B57\u7B26\u4E0A\u9650", hint: "[LOOM] \u5757 token \u9884\u7B97", kind: "num", min: 0, max: 4e3 },
  { key: "minIndexSignal", label: "\u5165\u7D22\u5F15\u4FE1\u53F7\u9608\u503C", hint: "signal \u2265 \u6B64\u503C\u7684\u81EA\u52A8\u6355\u83B7\u624D\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 1, step: 0.05 },
  { key: "promoteHits", label: "\u664B\u5347\u547D\u4E2D\u6570", hint: "hit \u6570\u8FBE\u6B64\u503C\u7684\u4F4E\u4FE1\u53F7\u6761\u76EE\u8FDB\u7D22\u5F15", kind: "num", min: 0, max: 20 },
  { key: "expireDays", label: "TTL\uFF08\u5929\uFF09", hint: "0 = \u4E0D\u8FC7\u671F", kind: "num", min: 0, max: 3650 },
  { key: "maxMemoriesPerWorkspace", label: "\u5DE5\u4F5C\u533A\u8BB0\u5FC6\u4E0A\u9650", kind: "num", min: 0, max: 1e4 }
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
  const [snap, setSnap] = (0, import_react2.useState)(null);
  const [draft, setDraft] = (0, import_react2.useState)({});
  const [saving, setSaving] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
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
  const setField = (0, import_react2.useCallback)((key, value2) => {
    setDraft((prev) => ({ ...prev, [key]: value2 }));
  }, []);
  const save = (0, import_react2.useCallback)(async () => {
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
  const resetField = (0, import_react2.useCallback)(async (key) => {
    await scope.unset(key);
    await scope.load();
    setDraft((prev) => ({ ...prev, [key]: void 0 }));
  }, [scope]);
  const value = { ...snap?.base ?? {}, ...draft };
  const writable = snap?.writable !== false && snap?.status !== "unavailable";
  return /* @__PURE__ */ React.createElement("div", null, FIELDS.map((field) => {
    const raw = value[field.key];
    const overridden = snap?.user !== void 0 && field.key in snap.user;
    return /* @__PURE__ */ React.createElement("div", { key: field.key, style: s2.row }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: s2.label }, field.label), /* @__PURE__ */ React.createElement("div", { style: s2.hint }, field.hint)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, field.kind === "bool" ? /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: raw === true,
        disabled: !writable,
        onChange: (e) => setField(field.key, e.target.checked)
      }
    ) : /* @__PURE__ */ React.createElement(
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
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        style: { ...s2.btn, color: overridden ? "#2563eb" : "#9ca3af" },
        title: "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4",
        disabled: !writable || !overridden,
        onClick: () => void resetField(field.key)
      },
      "\u91CD\u7F6E"
    )));
  }), /* @__PURE__ */ React.createElement("div", { style: s2.actions }, /* @__PURE__ */ React.createElement("button", { style: s2.btn, onClick: save, disabled: !writable || saving }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58")), /* @__PURE__ */ React.createElement("div", { style: s2.note }, snap?.status === "unavailable" ? "\u8FDC\u7A0B\u6D4F\u89C8\u5668\u4E0D\u53EF\u6301\u4E45\u5316\u8BBE\u7F6E\uFF08loopback-only\uFF09\u3002" : "\u8BBE\u7F6E\u5BF9\u65B0\u5EFA\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u5DF2\u51BB\u7ED3\u7684 [LOOM] \u5757\u4FDD\u6301\u524D\u7F00\u7A33\u5B9A\u3002"));
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
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: "loom",
          order: 30,
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
  const scope = ctx.settingsScope.bind({ namespace: "dsh-loom" });
  const cardInjected = () => ({ scope });
  try {
    ctx.slots.inject(
      "settings.plugin.item",
      () => ctx.slots.register(
        {
          name: "settings.plugin.item",
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
