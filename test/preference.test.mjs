/**
 * dsh-engram preference-capture tests — user-correction / preference learning
 * (zero-LLM): the pure extractor (extractPreference + messageText), the
 * session/event listener wiring, per-session caps + dedup, and the [ENGRAM]
 * index integration (preference memories outrank other kinds).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { openEngramDomain } from "../lib/store.js";
import { extractPreference, installPreferenceCapture, messageText, DEFAULT_PREFERENCE_PER_SESSION } from "../lib/preference.js";
import { renderIndex, prefixFor, selectIndexMemories } from "../lib/index-block.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePreferences: true,
  preferenceCapturePerSession: DEFAULT_PREFERENCE_PER_SESSION,
  sessionSearch: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
  verifyArtifact: false,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
  };
}

// ── extractPreference: positive captures ────────────────────────────────────

test("extractPreference: Chinese negation (avoidance)", () => {
  const r = extractPreference("不要用 esbuild，改用 rollup");
  assert.ok(r !== null);
  assert.equal(r.direction, "avoid");
  assert.match(r.text, /^user avoid:/);
  assert.ok(r.tags.includes("preference"));
  assert.ok(r.tags.includes("auto-captured"));

  const r2 = extractPreference("别再用那个旧脚本了");
  assert.ok(r2 !== null);
  assert.equal(r2.direction, "avoid");

  const r3 = extractPreference("请勿在此目录直接提交");
  assert.ok(r3 !== null);
});

test("extractPreference: Chinese substitution (switch-to)", () => {
  const r = extractPreference("改用 vitest 跑测试吧");
  assert.ok(r !== null);
  assert.equal(r.direction, "switch-to");
  assert.match(r.text, /^user switch-to:/);

  const r2 = extractPreference("统一用 pnpm 管理依赖");
  assert.ok(r2 !== null);
  assert.equal(r2.direction, "switch-to");

  const r3 = extractPreference("以后都用 JSDoc 注释");
  assert.ok(r3 !== null);
  assert.equal(r3.direction, "switch-to");
});

test("extractPreference: Chinese affirmation (prefer)", () => {
  const r = extractPreference("我更喜欢用 deno fmt 而不是 prettier");
  assert.ok(r !== null);
  // "X 而不是 Y" is a substitution — switch-to wins over the bare 喜欢用 cue.
  assert.equal(r.direction, "switch-to");
  assert.match(r.text, /^user switch-to:/);

  const r2 = extractPreference("我偏好 sqlite 存储");
  assert.ok(r2 !== null);
  assert.equal(r2.direction, "prefer");
});

test("extractPreference: English patterns", () => {
  const r = extractPreference("please don't use any more anycodings");
  // whatever matches — the key is direction is avoid
  assert.ok(r === null || r.direction === "avoid");

  const r2 = extractPreference("prefer sqlite over postgres for this project");
  assert.ok(r2 !== null);
  assert.equal(r2.direction, "prefer");
  assert.match(r2.text, /^user prefer:/i);

  const r3 = extractPreference("switch to biome for linting");
  assert.ok(r3 !== null);
  assert.equal(r3.direction, "switch-to");

  const r4 = extractPreference("never use var, always use let");
  assert.ok(r4 !== null);
  assert.equal(r4.direction, "avoid");
  assert.match(r4.clause, /var/i, "short target var survives");
});

// ── extractPreference: no false positives ──────────────────────────────────

test("extractPreference: ignores ordinary instructions, questions, meta-talk", () => {
  // one-shot operation instruction, no preference cue
  assert.equal(extractPreference("运行 npm test 看看结果"), null);
  assert.equal(extractPreference("请阅读 README 并总结"), null);
  // interrogatives
  assert.equal(extractPreference("是不是应该用 vercel 部署？"), null);
  assert.equal(extractPreference("要不要先跑一下测试？"), null);
  // meta-talk about our own tools
  assert.equal(extractPreference("用 engram_store 记一下这个决定"), null);
  assert.equal(extractPreference("[ENGRAM] 记得更新索引"), null);
  // too short / empty
  assert.equal(extractPreference(""), null);
  assert.equal(extractPreference("别"), null);
  assert.equal(extractPreference("   "), null);
  // plain statement with no cue
  assert.equal(extractPreference("编辑了配置文件"), null);
});

test("extractPreference: deterministic and bounded clauses", () => {
  const r = extractPreference(`不要用这个超级超级超级超级超级超级超级超级超级超级超级超级超级超级超级
    超级超级超级超级超级超级超级超级超级超级超级超级超级长的命令来做这件事`);
  assert.ok(r !== null);
  assert.ok(r.clause.length <= 120, `clause bounded: got ${r.clause.length}`);
});

// ── messageText: user/message payload shape ─────────────────────────────────

test("messageText extracts text from content blocks and single text", () => {
  assert.equal(
    messageText({ content: [{ text: "不要" }, { text: "用 X" }] }),
    "不要 用 X",
  );
  assert.equal(messageText({ text: "改用 rollup" }), "改用 rollup");
  assert.equal(messageText({ content: [] }), "");
  assert.equal(messageText({}), "");
  assert.equal(messageText(null), "");
});

// ── installPreferenceCapture: listener wiring ───────────────────────────────

test("installPreferenceCapture sediments preference memories; caps + dedup + containment", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const stored = [];
  const adapter = {
    storeMemory(entry) {
      stored.push(entry);
      return domain.storeMemory({ ...entry, workspace: "/ws", sessionId: entry.sessionId, seq: entry.seq ?? 0 }, CONFIG).then((r) => r);
    },
  };
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
  };
  const stats = { total: 0, preference: 0 };
  const dispose = installPreferenceCapture(ctx, adapter, CONFIG, { warn: () => {} }, stats);
  const onEvent = listeners.get("session/event");
  assert.ok(typeof onEvent === "function");

  const session = { id: "sess-pref", header: { cwd: "/ws" }, events: [{ type: "user/message" }, { type: "user/message" }] };

  // A correction captures a preference memory.
  await onEvent(session, { type: "user/message", data: { source: { kind: "user" }, content: [{ text: "不要用 esbuild" }] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].kind, "preference");
  assert.equal(stat(stats, "preference"), 1);

  const rows = domain.listMemories("/ws");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "preference");

  // Non-user events ignored.
  await onEvent(session, { type: "goal/change", data: { operation: "complete" } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1);

  // Injected (non-user) user/message events ignored — only the human user's
  // own corrections become preference memories.
  await onEvent(session, { type: "user/message", data: { source: { kind: "runtime-context" }, content: [{ text: "never use X, always use Y" }] } });
  await onEvent(session, { type: "user/message", data: { source: { kind: "skill-catalog" }, content: [{ text: "please use foo" }] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1, "runtime-context / skill-catalog injections ignored");

  // Missing/invalid source kind: treated as not user-owned, ignored.
  await onEvent(session, { type: "user/message", data: { content: [{ text: "不要用 esbuild" }] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1, "user/message without source.kind=user ignored");

  // Same-session recent-window dedup: identical clause not stored twice.
  await onEvent(session, { type: "user/message", data: { source: { kind: "user" }, text: "不要用 esbuild" } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1, "exact-duplicate clause deduped in recent window");

  // No-cue user messages are ignored.
  await onEvent(session, { type: "user/message", data: { source: { kind: "user" }, content: [{ text: "跑一下测试看看" }] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stored.length, 1);

  // Rejected write must not throw into the session pipeline.
  const throwAdapter = { storeMemory: () => Promise.reject(new Error("domain not open")) };
  const ctx2 = { on: (n, fn) => { listeners.set(n, fn); return () => {}; } };
  installPreferenceCapture(ctx2, throwAdapter, CONFIG, { warn: () => {} });
  await listeners.get("session/event")(session, { type: "user/message", data: { source: { kind: "user" }, text: "防止编译失败用 strict 模式" } });
  assert.ok(true, "rejected write is contained");

  dispose();
  assert.equal(listeners.has("session/event"), false, "dispose removes the listener");
  await domain.close();
});

test("installPreferenceCapture: per-session cap applies", async () => {
  const domain = await openEngramDomain(fakeFacility());
  const stored = [];
  const adapter = {
    storeMemory(entry) {
      stored.push(entry);
      return domain.storeMemory({ ...entry, workspace: "/ws", sessionId: entry.sessionId, seq: entry.seq ?? 0 }, CONFIG).then((r) => r);
    },
  };
  const listeners = new Map();
  const ctx = { on: (n, fn) => { listeners.set(n, fn); return () => {}; } };
  const cfg = { ...CONFIG, preferenceCapturePerSession: 2 };
  installPreferenceCapture(ctx, adapter, cfg, { warn: () => {} });
  const onEvent = listeners.get("session/event");
  const session = { id: "sess-cap", header: { cwd: "/ws" }, events: [] };

  for (const msg of ["不要用 alpha", "不要用 beta", "不要用 gamma", "不要用 delta"]) {
    await onEvent(session, { type: "user/message", data: { source: { kind: "user" }, text: msg } });
  }
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(stored.length, 2, "per-session cap of 2 enforced");
  await domain.close();
});

test("installPreferenceCapture: autoCapturePreferences=false installs no listener", () => {
  const listeners = new Map();
  const ctx = { on: (n, fn) => { listeners.set(n, fn); return () => {}; } };
  const dispose = installPreferenceCapture(ctx, { storeMemory: async () => {} }, { autoCapturePreferences: false }, { warn: () => {} });
  assert.equal(listeners.has("session/event"), false, "no listener when disabled");
  dispose();
});

// ── [ENGRAM] index integration ──────────────────────────────────────────────

test("prefixFor maps preference to R", () => {
  assert.equal(prefixFor("preference"), "R");
  assert.equal(prefixFor("decision"), "D");
});

test("preference memories outrank decisions in the [ENGRAM] index", async () => {
  const domain = await openEngramDomain(fakeFacility());
  await domain.storeMemory({ workspace: "/ws", kind: "decision", text: "sqlite over postgres", tags: [], sessionId: "s", seq: 1, signal: 0.8, createdAt: 100 }, CONFIG);
  await domain.storeMemory({ workspace: "/ws", kind: "preference", text: "user avoid: esbuild", tags: ["preference"], sessionId: "s", seq: 2, signal: 0.55, createdAt: 101 }, CONFIG);

  const sel = selectIndexMemories(domain, "/ws", CONFIG);
  assert.equal(sel.length, 2);
  assert.equal(sel[0].kind, "preference", "preference sorts before decision despite newer/everything");

  const block = renderIndex(domain, "/ws", "/ws", CONFIG);
  assert.match(block, /\[R\]/);
  const prefLine = block.split("\n").find((l) => l.startsWith("[R]"));
  assert.ok(prefLine, "preference line present with R prefix");
  assert.match(prefLine, /user avoid/);
  await domain.close();
});

function stat(stats, key) {
  return stats[key] ?? 0;
}
