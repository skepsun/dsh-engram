/**
 * Web-plane Context GC auto-wiring: pure swap/restore logic + the provision /
 * revert orchestration (in-memory adapters) + one real-fs round trip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENGRAM_ROW_NAME,
  STOCK_COMPACTION_ROW,
  ENGRAM_COMPACTION_ROW,
  engramCompactionRowText,
  compactionWireStatus,
  swapCompactionRow,
  restoreCompactionRow,
  provisionWebCompaction,
  revertWebCompaction,
} from "../lib/web-provision.js";

// A realistic slice of the shipped `standard` preset (only the parts the
// provisioner reads). Indentation must match the real file exactly.
const STOCK = `# agent composition
- id: persona
  name: cordis:group
  config:
    - id: system-prompt
      name: '@deepseek-ai/dsh-system-prompt'

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
`;

const WIRED = STOCK.replace(STOCK_COMPACTION_ROW, ENGRAM_COMPACTION_ROW);

const CUSTOM = STOCK.replace(
  "      name: '@deepseek-ai/dsh-compaction-basic'",
  "      name: 'my-own-compaction-backend'",
);

const DOUBLE_STOCK = STOCK + STOCK;

// ── pure classification ─────────────────────────────────────────────────────
test("compactionWireStatus: stock / wired / custom", () => {
  assert.equal(compactionWireStatus(STOCK), "stock");
  assert.equal(compactionWireStatus(WIRED), "wired");
  assert.equal(compactionWireStatus(CUSTOM), "custom");
  assert.equal(compactionWireStatus(""), "custom");
});

// ── swap ────────────────────────────────────────────────────────────────────
test("swapCompactionRow: stock → engram row, all invariants hold", () => {
  const next = swapCompactionRow(STOCK);
  assert.ok(next !== null, "stock layout must swap");
  assert.ok(next.includes(ENGRAM_ROW_NAME));
  assert.ok(!next.includes("@deepseek-ai/dsh-compaction-basic"));
  assert.ok(!next.includes("compaction-basic"));
  // sibling rows survive
  assert.ok(next.includes("command-compact"));
  assert.ok(next.includes("tool-result-pruner"));
  // still a single group with its isolate block
  assert.equal(next.split("- id: compaction").length - 1, 1);
  assert.ok(next.includes("name: cordis:group"));
  assert.ok(next.includes("isolate:"));
  // the engram row carries explicit engine config
  assert.ok(next.includes("gcReplacesCompaction: true"));
  assert.ok(next.includes("gcNarrative: true"));
});

test("swapCompactionRow: wired with matching config is a no-op; custom/malformed → null", () => {
  assert.equal(swapCompactionRow(WIRED), WIRED, "already wired at the requested config → unchanged text");
  assert.equal(swapCompactionRow(CUSTOM), null, "custom → null");
  assert.equal(swapCompactionRow(""), null);
  assert.equal(swapCompactionRow(DOUBLE_STOCK), null, "marker twice → null (refuse to guess)");
});

test("swapCompactionRow: refresh rewrites a wired row to the requested config", () => {
  const refreshed = swapCompactionRow(WIRED, { gcReplacesCompaction: false });
  assert.ok(refreshed !== null && refreshed !== WIRED);
  assert.ok(refreshed.includes("gcReplacesCompaction: false"), "toggle propagated into the row");
  assert.ok(refreshed.includes("gcNarrative: true"));
  assert.ok(refreshed.includes("dsh-engram/compaction"));
  assert.ok(!refreshed.includes("@deepseek-ai/dsh-compaction-basic"));
  const refreshed2 = swapCompactionRow(WIRED, { gcNarrative: false });
  assert.ok(refreshed2 !== null && refreshed2.includes("gcNarrative: false"));
  // re-running at the same config is a no-op
  assert.equal(swapCompactionRow(refreshed, { gcReplacesCompaction: false }), refreshed);
  // restore handles any engine config the refresh wrote
  assert.equal(restoreCompactionRow(refreshed), STOCK);
  assert.equal(restoreCompactionRow(refreshed2), STOCK);
});

test("engramCompactionRowText: builds the stock row from arbitrary config", () => {
  const text = engramCompactionRowText({ gcReplacesCompaction: false, gcNarrative: false });
  assert.ok(text.startsWith("    - id: engram-compaction\n      name: dsh-engram/compaction"));
  assert.ok(text.includes("        gcReplacesCompaction: false"));
  assert.ok(text.includes("        gcNarrative: false"));
  assert.equal(engramCompactionRowText({}), ENGRAM_COMPACTION_ROW);
});

test("swap+restore round trip returns the identical stock text", () => {
  const next = swapCompactionRow(STOCK);
  assert.ok(next !== null);
  const back = restoreCompactionRow(next);
  assert.ok(back !== null);
  assert.equal(back, STOCK);
});

test("restoreCompactionRow: refuses stock / custom / wired-but-changed input", () => {
  assert.equal(restoreCompactionRow(STOCK), null, "stock has nothing to restore");
  assert.equal(restoreCompactionRow(CUSTOM), null);
  // a wired file whose row was hand-edited afterwards must not be guessed
  const tampered = WIRED.replace("dsh-engram/compaction", "someone/else");
  assert.equal(compactionWireStatus(tampered), "custom");
  assert.equal(restoreCompactionRow(tampered), null);
});

// ── in-memory provision harness ─────────────────────────────────────────────
function memoryHarness(entries, { resolveError = false, listError = false } = {}) {
  // entries: [{ id, path, text }]
  const store = new Map(entries.map((e) => [e.path, e.text]));
  const log = [];
  let failWrite = null;
  let failVerify = false;
  const service = {
    async resolve() {
      if (resolveError) throw new Error("boom — no agentPresets");
      return {
        id: entries[0]?.id,
        path: entries[0]?.path,
      };
    },
    async list() {
      if (listError) throw new Error("boom — no roster");
      return entries.map((e) => ({ id: e.id, path: e.path }));
    },
  };
  const opts = {
    log: (line) => log.push(line),
    readText: async (preset) => store.get(preset.path),
    writeText: async (preset, text) => {
      if (failWrite !== null) throw failWrite;
      store.set(preset.path, text);
    },
    writeBackup: async (path, text) => {
      if (store.has(path)) {
        const e = new Error("EEXIST");
        e.code = "EEXIST";
        throw e;
      }
      store.set(path, text);
    },
  };
  return {
    service,
    store,
    log,
    get opts() {
      // post-write verify re-reads the file; a failing verifier fabricates a
      // clean read even though the write landed.
      if (failVerify) return { ...opts, readText: async () => STOCK };
      return opts;
    },
    set failWrite(err) { failWrite = err; },
    set failVerify(v) { failVerify = v; },
  };
}

const singleStock = () =>
  [{ id: "standard", path: "/p/standard/agent.cordis.yml", text: STOCK }];

test("provision: stock default preset → swapped + backup holds the original", async () => {
  const h = memoryHarness(singleStock());
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "swapped");
  assert.equal(report.presetId, "standard");
  assert.equal(report.presets.length, 1);
  const written = h.store.get("/p/standard/agent.cordis.yml");
  assert.equal(written, WIRED, "preset file now carries the engram row");
  assert.equal(
    h.store.get("/p/standard/agent.cordis.yml.engram.bak"),
    STOCK,
    "create-only backup keeps the original stock text",
  );
  assert.ok(h.log.some((l) => l.includes("restart dsh web")));
});

test("provision: already wired → no writes at all", async () => {
  const h = memoryHarness([{ id: "standard", path: "/p/standard/agent.cordis.yml", text: WIRED }]);
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "already");
  assert.equal(h.store.size, 1, "no backup, no rewrite");
});

test("provision: custom preset → skipped, never touched", async () => {
  const h = memoryHarness([{ id: "standard", path: "/p/standard/agent.cordis.yml", text: CUSTOM }]);
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "skipped");
  assert.equal(report.presets[0].reason, "custom");
  assert.equal(h.store.size, 1, "custom composition left byte-identical");
  assert.ok(h.log.some((l) => l.includes("leaving it untouched")));
});

test("provision: agentPresets unavailable → skipped, no crash", async () => {
  const h = memoryHarness([], { resolveError: true, listError: true });
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "no-default");
  assert.equal(report.presets.length, 0);
});

test("provision: rowConfig drives the engine config written into presets (+ refresh)", async () => {
  const h = memoryHarness(singleStock());
  const report = await provisionWebCompaction(h.service, {
    ...h.opts,
    rowConfig: { gcReplacesCompaction: false, gcNarrative: false },
  });
  assert.equal(report.action, "swapped");
  const written = h.store.get("/p/standard/agent.cordis.yml");
  assert.ok(written.includes("gcReplacesCompaction: false"));
  assert.ok(written.includes("gcNarrative: false"));

  // already wired with a stale config gets refreshed to the requested one
  const h2 = memoryHarness([{ id: "standard", path: "/p/standard/agent.cordis.yml", text: WIRED }]);
  const report2 = await provisionWebCompaction(h2.service, {
    ...h2.opts,
    rowConfig: { gcReplacesCompaction: false },
  });
  assert.equal(report2.action, "swapped");
  assert.equal(report2.presets[0].action, "swapped", "stale wired row was rewritten");
  assert.ok(h2.store.get("/p/standard/agent.cordis.yml").includes("gcReplacesCompaction: false"));
});

test("provision: write failure → failed, original intact, no crash", async () => {
  const h = memoryHarness(singleStock());
  h.failWrite = new Error("EACCES: permission denied");
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "failed");
  assert.equal(report.presets[0].reason, "write-failed");
  assert.equal(h.store.get("/p/standard/agent.cordis.yml"), STOCK);
});

test("provision: post-write verification failure → restore original", async () => {
  const h = memoryHarness(singleStock());
  h.failVerify = true;
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "failed");
  assert.equal(report.presets[0].reason, "verify-failed");
  assert.equal(h.store.get("/p/standard/agent.cordis.yml"), STOCK, "write rolled back");
});

test("revert: wired → restored to stock, noop when already stock", async () => {
  const h = memoryHarness([{ id: "standard", path: "/p/standard/agent.cordis.yml", text: WIRED }]);
  const report = await revertWebCompaction(h.service, h.opts);
  assert.equal(report.action, "reverted");
  assert.equal(h.store.get("/p/standard/agent.cordis.yml"), STOCK);

  const h2 = memoryHarness(singleStock());
  const report2 = await revertWebCompaction(h2.service, h2.opts);
  assert.equal(report2.action, "noop");
  assert.equal(h2.store.size, 1, "stock file untouched");
});

test("revert: wired-but-tampered → noop rather than guessing", async () => {
  const tampered = WIRED.replace("dsh-engram/compaction", "someone/else");
  const h = memoryHarness([{ id: "standard", path: "/p/standard/agent.cordis.yml", text: tampered }]);
  const report = await revertWebCompaction(h.service, h.opts);
  // not wired (by our marker) and not stock → the file is left exactly as-is
  assert.equal(report.action, "noop");
  assert.equal(h.store.get("/p/standard/agent.cordis.yml"), tampered);
});

// ── multi-preset coverage (the "what about my other presets" case) ─────────
test("provision: every stock preset on the roster is wired, custom/minimal left alone", async () => {
  const entries = [
    { id: "standard", path: "/p/standard/agent.cordis.yml", text: STOCK },
    { id: "code", path: "/p/code/agent.cordis.yml", text: STOCK },
    { id: "liangshen", path: "/p/liangshen/agent.cordis.yml", text: STOCK },
    { id: "minimal", path: "/p/minimal/agent.cordis.yml", text: "# no compaction at all\n- id: persona\n" },
    { id: "router-spec", path: "/p/router-spec/agent.cordis.yml", text: CUSTOM },
  ];
  const h = memoryHarness(entries);
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "swapped");
  assert.equal(report.presets.length, 5);
  const byId = Object.fromEntries(report.presets.map((p) => [p.presetId, p]));
  assert.equal(byId.standard.action, "swapped");
  assert.equal(byId.code.action, "swapped");
  assert.equal(byId.liangshen.action, "swapped");
  assert.equal(byId.minimal.action, "skipped", "preset without compaction untouched");
  assert.equal(byId.minimal.reason, "custom");
  assert.equal(byId["router-spec"].action, "skipped", "custom layout untouched");
  assert.equal(byId["router-spec"].reason, "custom");
  // all three stock files carry the engram row; each got its own backup
  for (const id of ["standard", "code", "liangshen"]) {
    assert.equal(h.store.get(`/p/${id}/agent.cordis.yml`), WIRED);
    assert.equal(h.store.get(`/p/${id}/agent.cordis.yml.engram.bak`), STOCK);
  }
  // untouched presets were never written
  assert.equal(h.store.get("/p/minimal/agent.cordis.yml"), "# no compaction at all\n- id: persona\n");
  assert.equal(h.store.get("/p/router-spec/agent.cordis.yml"), CUSTOM);
});

test("provision: roster unavailable → falls back to the default preset only", async () => {
  const h = memoryHarness(singleStock(), { listError: true });
  const report = await provisionWebCompaction(h.service, h.opts);
  assert.equal(report.action, "swapped");
  assert.equal(report.presets.length, 1);
  assert.equal(report.presets[0].presetId, "standard");
});

test("revert: unwires every wired preset, leaves others alone", async () => {
  const entries = [
    { id: "standard", path: "/p/standard/agent.cordis.yml", text: WIRED },
    { id: "code", path: "/p/code/agent.cordis.yml", text: WIRED },
    { id: "minimal", path: "/p/minimal/agent.cordis.yml", text: "# no compaction\n" },
  ];
  const h = memoryHarness(entries);
  const report = await revertWebCompaction(h.service, h.opts);
  assert.equal(report.action, "reverted");
  assert.equal(h.store.get("/p/standard/agent.cordis.yml"), STOCK);
  assert.equal(h.store.get("/p/code/agent.cordis.yml"), STOCK);
  assert.equal(h.store.get("/p/minimal/agent.cordis.yml"), "# no compaction\n");
});

// ── real filesystem round trip ──────────────────────────────────────────────
test("real fs: provision writes the file + .engram.bak, revert restores it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engram-web-provision-"));
  const path = join(dir, "agent.cordis.yml");
  const backup = `${path}.engram.bak`;
  await writeFile(path, STOCK);
  try {
    const service = { async resolve() { return { id: "standard", path }; } };
    const log = [];
    const report = await provisionWebCompaction(service, { log: (l) => log.push(l) });
    assert.equal(report.action, "swapped");
    assert.equal(await readFile(path, "utf8"), WIRED);
    assert.equal(await readFile(backup, "utf8"), STOCK);

    const report2 = await revertWebCompaction(service, { log: (l) => log.push(l) });
    assert.equal(report2.action, "reverted");
    assert.equal(await readFile(path, "utf8"), STOCK);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
