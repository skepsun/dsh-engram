/**
 * dsh-engram web-plane auto-wiring for Context GC.
 *
 * Why this file exists: web sessions resolve their `compaction` engine inside
 * the agent preset's isolated realm — the shipped `standard` preset mounts its
 * own `compaction-basic` there — and the profile patch cannot reach into
 * preset files (verified against the harness: `mountPreset` builds
 * `Include.Config` with no patches, and the loader's patch semantics apply to
 * the main composition only). The one sanctioned lever left is editing the
 * preset file itself, so this module performs that edit automatically:
 *
 *   - it covers the resolved DEFAULT preset plus EVERY preset on the roster
 *     (`list()` — shipped roots and the user root alike), so a session composed
 *     from any preset gets Context GC, not just the default one;
 *   - per preset it touches ONLY compositions that are still the untouched
 *     stock layout (`compaction-basic` present inside the `compaction` group);
 *     a preset with a custom compaction group — or none at all (e.g. the
 *     shipped `minimal` preset) — is left alone and only logged;
 *   - a `.engram.bak` copy of the original is taken before any write;
 *   - every step is validated; an already-wired preset is never rewritten, and
 *     a failed edit restores the original.
 *
 * The swap is textual and deliberately tiny (one stock row → the engram row),
 * so it survives harness upgrades that only touch surrounding content; a
 * harness upgrade that changes the `compaction` group's stock shape makes the
 * "stock" status fail (status "custom"/"layout-mismatch") and the provisioner
 * leaves the file alone instead of guessing.
 *
 * Two preset generations are supported, and the row matching is
 * INDENTATION-AGNOSTIC (the row is located structurally inside the
 * `compaction` group), because the same row lives at different depths:
 *
 *   - DSH ≤ 0.1.x — one composition per preset:
 *     `<root>/<id>/agent.cordis.yml` (row at 4 spaces), `preset.path` is known;
 *   - DSH ≥ 0.2.0 — declarative presets, one patch file per preset:
 *     `@deepseek-ai/dsh-web-app/presets/<id>.patch.yml` (row at 14 spaces
 *     inside the `- insert:` operation), and `preset.path` does not exist — the
 *     id is mapped to the shipped file by {@link discoverPresetsDir}.
 *
 * Flip `autoWebCompaction:false` to opt out; `revertWebCompaction` restores
 * the stock row on uninstall.
 * @module dsh-engram/web-provision
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The engine package subpath a preset row mounts dsh-engram's engine under. */
export const ENGRAM_ROW_NAME = "dsh-engram/compaction";

/** The stock row name the shipped presets mount inside the `compaction` group. */
export const STOCK_ROW_NAME = "'@deepseek-ai/dsh-compaction-basic'";

/** Package name part of {@link STOCK_ROW_NAME} (quote-free, for matching). */
const STOCK_NAME = "@deepseek-ai/dsh-compaction-basic";

/** Row ids the provisioner looks for (list-item `- id:` values). */
const STOCK_ROW_ID = "compaction-basic";
const ENGRAM_ROW_ID = "engram-compaction";
const COMPACTION_GROUP_ID = "compaction";

/** Engine config the plugin writes into each wired preset row (settings-driven). */
export const DEFAULT_ROW_CONFIG = Object.freeze({
  gcReplacesCompaction: true,
  gcNarrative: true,
});

/**
 * The stock `compaction-basic` row at a given indentation (the row sits at
 * different depths across preset generations: 4 in DSH ≤ 0.1.x composition
 * files, 14 in the DSH ≥ 0.2.0 declarative patch files).
 * @param {number} [indent] - leading spaces before `- id:`.
 * @returns {string}
 */
export function stockCompactionRowText(indent = 4) {
  const pad = " ".repeat(indent);
  return `${pad}- id: ${STOCK_ROW_ID}\n${pad}  name: ${STOCK_ROW_NAME}`;
}

/** The legacy 4-space stock row (back-compat export). */
export const STOCK_COMPACTION_ROW = stockCompactionRowText(4);

/**
 * The engram row text for a given engine config. Indentation must match the
 * stock row it replaces (`- id:` at `indent`, keys at `indent + 2`, sub-keys
 * at `indent + 4`).
 * @param {{ gcReplacesCompaction?: boolean; gcNarrative?: boolean }} [config]
 * @param {number} [indent] - leading spaces before `- id:`.
 * @returns {string}
 */
export function engramCompactionRowText(config = {}, indent = 4) {
  const { gcReplacesCompaction = true, gcNarrative = true } = config;
  const pad = " ".repeat(indent);
  return [
    `${pad}- id: ${ENGRAM_ROW_ID}`,
    `${pad}  name: dsh-engram/compaction`,
    `${pad}  config:`,
    `${pad}    gcReplacesCompaction: ${gcReplacesCompaction}`,
    `${pad}    gcNarrative: ${gcNarrative}`,
  ].join("\n");
}

/** The replacement row at default settings (back-compat export). */
export const ENGRAM_COMPACTION_ROW = engramCompactionRowText(DEFAULT_ROW_CONFIG);

/** Backup filename suffix written next to the preset composition. */
export const BACKUP_SUFFIX = ".engram.bak";

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error */
function codeOf(error) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

/** Leading-space width of one line. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** `{ indent, id }` for a YAML list item line `- id: <id>`, else undefined. */
function itemOf(line) {
  const match = /^(\s*)- id:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line);
  if (match === null) return undefined;
  return { indent: match[1].length, id: match[2] };
}

/**
 * End (exclusive line index) of the YAML block starting at `start`: the first
 * blank line, or the first line indented no deeper than the item itself.
 * @param {string[]} lines
 * @param {number} start
 */
function blockEnd(lines, start) {
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") break;
    if (indentOf(line) <= indent) break;
    end += 1;
  }
  return end;
}

/** The `name:` value of the item block starting at `index` (quotes stripped). */
function nameOf(lines, index) {
  const end = blockEnd(lines, index);
  for (let i = index + 1; i < end; i += 1) {
    const match = /^\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(lines[i]);
    if (match !== null) return match[1];
  }
  return undefined;
}

/**
 * Spans covering the items of every `compaction` group in the composition (a
 * list item whose block carries `group: true`). The group exists in both
 * preset generations; only its indentation differs, which is why nothing here
 * depends on column positions.
 * @param {string[]} lines
 * @returns {Array<{ start: number; end: number }>}
 */
function compactionGroupSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = itemOf(lines[i]);
    if (head === undefined || head.id !== COMPACTION_GROUP_ID) continue;
    const end = blockEnd(lines, i);
    const isGroup = lines
      .slice(i + 1, end)
      .some((line) => /^\s*group:\s*true\s*$/.test(line));
    if (isGroup) spans.push({ start: i + 1, end });
  }
  return spans;
}

/**
 * Locate the stock and engram rows of a composition. Rows are validated by
 * BOTH the `- id:` value and the `name:` value, so a hand-edited backend under
 * the same id is never mistaken for a row we may rewrite.
 * @param {string} text
 * @returns {{ lines: string[]; stock: number[]; engram: number[]; ambiguous: boolean }}
 */
function locateRows(text) {
  const lines = text.split("\n");
  const groups = compactionGroupSpans(lines);
  // Two compaction groups in one composition: refuse to guess which one runs.
  if (groups.length > 1) return { lines, stock: [], engram: [], ambiguous: true };
  const span = groups[0] ?? { start: 0, end: lines.length, fallback: true };
  const valid = (rowId, name) => {
    const hits = [];
    for (let i = span.start; i < span.end; i += 1) {
      const head = itemOf(lines[i]);
      if (head === undefined || head.id !== rowId) continue;
      if (span.fallback === true && head.indent === 0) continue;
      if (nameOf(lines, i) !== name) continue;
      hits.push(i);
    }
    return hits;
  };
  return {
    lines,
    stock: valid(STOCK_ROW_ID, STOCK_NAME),
    engram: valid(ENGRAM_ROW_ID, ENGRAM_ROW_NAME),
    ambiguous: false,
  };
}

/** Replace lines `[start, end)` with `replacement` (joined by newlines). */
function replaceBlock(lines, start, end, replacement) {
  return [
    ...lines.slice(0, start),
    ...replacement.split("\n"),
    ...lines.slice(end),
  ].join("\n");
}

/**
 * Classify a preset composition's compaction wiring.
 * - `wired` — already carries `dsh-engram/compaction`;
 * - `stock` — untouched shipped layout; safe to auto-wire;
 * - `custom` — anything else; never touch.
 * @param {string} text - the preset composition text.
 * @returns {"wired" | "stock" | "custom"}
 */
export function compactionWireStatus(text) {
  const { stock, engram } = locateRows(text);
  if (engram.length > 0) return stock.length > 0 ? "custom" : "wired";
  return stock.length > 0 ? "stock" : "custom";
}

/** Post-swap sanity invariants the result must satisfy. */
function invariantsOk(text) {
  return (
    text.includes(ENGRAM_ROW_NAME) &&
    !text.includes(STOCK_NAME) &&
    text.includes("command-compact") &&
    text.includes("tool-result-pruner") &&
    text.includes("cordis:group") &&
    text.includes("isolate:")
  );
}

/**
 * Produce the wired composition for `rowConfig`. Input may be `stock` (first
 * wiring: the stock row is replaced) or `wired` (refresh: the existing engram
 * row block is updated to the requested config). Returns the new text, or
 * `null` when the input is not something we may rewrite. The caller can detect
 * a no-op refresh via `next === text`.
 * @param {string} text - the preset composition text.
 * @param {{ gcReplacesCompaction?: boolean; gcNarrative?: boolean }} [rowConfig]
 * @returns {string | null}
 */
export function swapCompactionRow(text, rowConfig = {}) {
  const { lines, stock, engram, ambiguous } = locateRows(text);
  if (ambiguous) return null;
  if (engram.length > 0) {
    if (engram.length > 1 || stock.length > 0) return null;
    const index = engram[0];
    const end = blockEnd(lines, index);
    const rowText = engramCompactionRowText(rowConfig, indentOf(lines[index]));
    if (lines.slice(index, end).join("\n") === rowText) return text; // already this config
    const next = replaceBlock(lines, index, end, rowText);
    return invariantsOk(next) ? next : null;
  }
  if (stock.length !== 1) return null;
  const index = stock[0];
  const end = blockEnd(lines, index);
  const next = replaceBlock(
    lines,
    index,
    end,
    engramCompactionRowText(rowConfig, indentOf(lines[index])),
  );
  return invariantsOk(next) ? next : null;
}

/**
 * Reverse {@link swapCompactionRow}: restore the stock `compaction-basic` row
 * from a wired composition (any engram row block — engine config included).
 * `null` when the input is not a composition we wired.
 * @param {string} text - the preset composition text.
 * @returns {string | null}
 */
export function restoreCompactionRow(text) {
  const { lines, engram, ambiguous } = locateRows(text);
  if (ambiguous || engram.length !== 1) return null;
  const index = engram[0];
  const end = blockEnd(lines, index);
  const next = replaceBlock(lines, index, end, stockCompactionRowText(indentOf(lines[index])));
  return compactionWireStatus(next) === "stock" ? next : null;
}

/** Environment override for the shipped declarative preset directory. */
export const PRESETS_DIR_ENV = "DSH_WEB_PRESETS_DIR";

/**
 * Resolve the shipped declarative preset directory
 * (`@deepseek-ai/dsh-web-app/presets`, DSH ≥ 0.2.0). Both the plugin and the
 * standalone CLI run OUTSIDE that package, so the directory is resolved
 * through the `dsh` installation that launched the process (`process.argv[1]`,
 * plus `opts.anchors` — the CLI passes the `dsh` bin it finds on `PATH`).
 *
 * Resolution order: `opts.presetsDir` (explicit; an empty string disables
 * discovery) → `DSH_WEB_PRESETS_DIR` → package resolution from each anchor.
 * @param {{ presetsDir?: string; anchors?: string[] }} [opts]
 * @returns {string | undefined}
 */
export function discoverPresetsDir(opts = {}) {
  if (typeof opts.presetsDir === "string") {
    return opts.presetsDir.length > 0 ? opts.presetsDir : undefined;
  }
  const fromEnv = process.env[PRESETS_DIR_ENV];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  for (const anchor of [process.argv[1], ...(opts.anchors ?? [])]) {
    const dir = presetsDirFromAnchor(anchor);
    if (dir !== undefined) return dir;
  }
  return undefined;
}

/** `presets/` beside the `@deepseek-ai/dsh-web-app` package, via one anchor. */
function presetsDirFromAnchor(anchor) {
  if (typeof anchor !== "string" || anchor.length === 0) return undefined;
  let file;
  try {
    file = realpathSync(anchor);
  } catch {
    return undefined;
  }
  let require;
  try {
    require = createRequire(file);
  } catch {
    return undefined;
  }
  try {
    const pkg = require.resolve("@deepseek-ai/dsh-web-app/package.json");
    const dir = join(dirname(pkg), "presets");
    if (existsSync(dir)) return dir;
  } catch {}
  // Fallback: dsh's own nested node_modules (covers layouts where only `dsh`
  // resolves from the anchor, e.g. a global bin without a hoisted web-app).
  try {
    const dshPkg = require.resolve("@deepseek-ai/dsh/package.json");
    const dir = join(dirname(dshPkg), "node_modules", "@deepseek-ai", "dsh-web-app", "presets");
    if (existsSync(dir)) return dir;
  } catch {}
  return undefined;
}

/** `<presetsDir>/<id>.patch.yml`, when that shipped file exists. */
function declarativePresetFile(presetsDir, id) {
  if (presetsDir === undefined || typeof id !== "string" || id.length === 0) return undefined;
  const file = join(presetsDir, `${id}.patch.yml`);
  return existsSync(file) ? file : undefined;
}

/** Every `*.patch.yml` in the presets directory, sorted, as `{ id, path }`. */
async function declarativePresetFiles(presetsDir) {
  let entries = [];
  try {
    entries = await readdir(presetsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".patch.yml"))
    .map((entry) => ({
      id: entry.name.slice(0, -".patch.yml".length),
      path: join(presetsDir, entry.name),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Collect the presets to consider — the resolved DEFAULT plus every preset on
 * the roster (`service.list()` when present). Each preset is mapped to a
 * composition file: legacy presets carry `path`; declarative presets
 * (DSH ≥ 0.2.0) are mapped by id to `<presetsDir>/<id>.patch.yml`. A preset
 * without a file (user-defined declarative presets live in the profile patch)
 * is skipped with a log line. Deduped by path; broken presets are skipped.
 * Never throws.
 * @returns {Promise<Array<{ id: string; path: string }>>}
 */
async function collectPresetTargets(service, log, opts) {
  const presetsDir = discoverPresetsDir(opts);
  const targets = [];
  const seen = new Set();
  const push = (id, path) => {
    if (typeof path !== "string" || path.length === 0 || seen.has(path)) return;
    seen.add(path);
    targets.push({ id, path });
  };

  const roster = [];
  let rosterOk = false;
  try {
    const resolvedPreset = await service.resolve();
    if (resolvedPreset !== undefined && resolvedPreset !== null) roster.push(resolvedPreset);
  } catch (error) {
    log(
      `engram web-provision: default agent preset unavailable (${describe(error)}) — continuing with the roster`,
    );
  }
  if (typeof service.list === "function") {
    try {
      const listed = await service.list();
      if (Array.isArray(listed)) {
        roster.push(...listed);
        rosterOk = true;
      }
    } catch (error) {
      log(
        `engram web-provision: preset roster unavailable (${describe(error)}) — using the default only`,
      );
    }
  }

  for (const preset of roster) {
    if (preset === undefined || preset === null) continue;
    if (preset.broken !== undefined && preset.broken !== null) {
      log(
        `engram web-provision: preset "${preset.id}" is broken (${preset.broken}) — leaving it alone`,
      );
      continue;
    }
    // DSH ≤ 0.1.x: the preset knows its composition file.
    if (typeof preset.path === "string") {
      push(preset.id, preset.path);
      continue;
    }
    // DSH ≥ 0.2.0: a declarative preset — map its id to the shipped patch file.
    const file = declarativePresetFile(presetsDir, preset.id);
    if (file !== undefined) {
      push(preset.id, file);
    } else if (presetsDir === undefined) {
      log(
        `engram web-provision: preset "${preset.id}" has no composition path and no shipped preset `
        + `directory was found (set ${PRESETS_DIR_ENV} or run from a normal dsh install) — skipping`,
      );
    } else {
      log(
        `engram web-provision: preset "${preset.id}" has no shipped file in ${presetsDir} — skipping `
        + "(user-defined declarative presets live in the profile patch and are not wireable here)",
      );
    }
  }

  // Roster entirely unavailable: fall back to the shipped declarative files.
  if (!rosterOk && targets.length === 0 && presetsDir !== undefined) {
    for (const entry of await declarativePresetFiles(presetsDir)) push(entry.id, entry.path);
  }
  return targets;
}

/**
 * Automatically wire Context GC into the web plane's agent presets: the
 * default preset plus every roster preset (shipped and user roots alike).
 * Only stock-layout presets are touched; a custom layout is skipped. A preset
 * already wired with a DIFFERENT engine config is refreshed to `rowConfig`,
 * so the settings knobs (`gcReplacesCompaction` / `gcNarrative`) keep
 * governing the web plane across boots.
 *
 * Adapters (all optional, injected for tests):
 * - `readText(preset)` / `writeText(preset, text)` — default: `node:fs`
 *   reads/writes `preset.path`;
 * - `writeBackup(path, text)` — default: create-only (`wx`) write;
 * - `log(line)` — default: no-op.
 *
 * Returns a report with one entry per considered preset; never throws.
 * @param {{ resolve(): Promise<any>; list?: () => Promise<any[]> }} service - the `agentPresets` service.
 * @param {object} [opts]
 * @returns {Promise<{ action: string; presets: Array<Record<string, any>>; presetId?: string; path?: string }>}
 */
export async function provisionWebCompaction(service, opts = {}) {
  const log = opts.log ?? (() => {});
  const rowConfig = opts.rowConfig ?? {};
  const readText = opts.readText ?? ((preset) => readFile(preset.path, "utf8"));
  const writeText = opts.writeText ?? ((preset, text) => writeFile(preset.path, text, "utf8"));
  const writeBackup =
    opts.writeBackup ?? ((path, text) => writeFile(path, text, { flag: "wx" }));
  const backupSuffix = opts.backupSuffix ?? BACKUP_SUFFIX;

  const presets = await collectPresetTargets(service, log, opts);
  if (presets.length === 0) {
    log("engram web-provision: no usable agent preset found — Context GC auto-wiring skipped");
    return { action: "no-default", presets: [] };
  }

  const results = [];
  let anySwapped = false;
  let anyFailed = false;
  let anyAlready = false;

  for (const preset of presets) {
    let text;
    try {
      text = await readText(preset);
    } catch (error) {
      log(`engram web-provision: cannot read ${preset.path} (${describe(error)}) — skipping`);
      results.push({ presetId: preset.id, path: preset.path, action: "skipped", reason: "read-failed" });
      anyFailed = true;
      continue;
    }

    const status = compactionWireStatus(text);
    if (status === "custom") {
      log(
        `engram web-provision: preset "${preset.id}" has a custom compaction layout — leaving it untouched; `
        + `wire ${ENGRAM_ROW_NAME} manually if you want Context GC here`,
      );
      results.push({ presetId: preset.id, path: preset.path, action: "skipped", reason: "custom" });
      continue;
    }

    // Handles both first wiring (stock → engram row) and config refresh
    // (wired with a stale row → rewritten to the requested engine config).
    const next = swapCompactionRow(text, rowConfig);
    if (next === null) {
      log(
        `engram web-provision: preset "${preset.id}" did not match the expected stock layout — leaving it untouched`,
      );
      results.push({ presetId: preset.id, path: preset.path, action: "skipped", reason: "layout-mismatch" });
      continue;
    }
    if (next === text) {
      log(`engram web-provision: preset "${preset.id}" already uses ${ENGRAM_ROW_NAME} with the requested config — nothing to do`);
      results.push({ presetId: preset.id, path: preset.path, action: "already" });
      anyAlready = true;
      continue;
    }

    const backupPath = `${preset.path}${backupSuffix}`;
    try {
      // Create-only: the FIRST original stays the backup even across later runs.
      await writeBackup(backupPath, text).catch((error) => {
        if (codeOf(error) !== "EEXIST") throw error;
      });
      await writeText(preset, next);
    } catch (error) {
      log(
        `engram web-provision: write failed for preset "${preset.id}" (${describe(error)}) — `
        + "Context GC not wired; the session keeps DSH's default summarizer",
      );
      results.push({ presetId: preset.id, path: preset.path, action: "failed", reason: "write-failed" });
      anyFailed = true;
      continue;
    }

    // Post-write verification; restore the original on any doubt.
    let verified = false;
    try {
      verified = compactionWireStatus(await readText(preset)) === "wired";
    } catch {
      verified = false;
    }
    if (!verified) {
      log(`engram web-provision: post-write verification failed for preset "${preset.id}" — restoring`);
      try {
        await writeText(preset, text);
      } catch {}
      results.push({ presetId: preset.id, path: preset.path, action: "failed", reason: "verify-failed" });
      anyFailed = true;
      continue;
    }

    log(
      `engram web-provision: wired Context GC into preset "${preset.id}" (${preset.path}); `
      + "restart dsh web so sessions pick it up",
    );
    results.push({ presetId: preset.id, path: preset.path, action: "swapped", backupPath });
    anySwapped = true;
  }

  const action = anySwapped ? "swapped" : anyFailed ? "failed" : anyAlready ? "already" : "skipped";
  const first = results[0];
  return {
    action,
    presets: results,
    ...(first !== undefined ? { presetId: first.presetId, path: first.path } : {}),
  };
}

/**
 * Reverse {@link provisionWebCompaction}: restore the stock `compaction-basic`
 * row in every wired preset (run before uninstalling dsh-engram so a preset
 * never dangles a reference to the removed engine). No-ops on non-wired
 * presets. Never throws.
 * @param {{ resolve(): Promise<any>; list?: () => Promise<any[]> }} service - the `agentPresets` service.
 * @param {object} [opts]
 * @returns {Promise<{ action: string; presets: Array<Record<string, any>>; presetId?: string; path?: string }>}
 */
export async function revertWebCompaction(service, opts = {}) {
  const log = opts.log ?? (() => {});
  const readText = opts.readText ?? ((preset) => readFile(preset.path, "utf8"));
  const writeText = opts.writeText ?? ((preset, text) => writeFile(preset.path, text, "utf8"));

  const presets = await collectPresetTargets(service, log, opts);
  if (presets.length === 0) return { action: "no-default", presets: [] };

  const results = [];
  let anyReverted = false;
  let anyFailed = false;

  for (const preset of presets) {
    let text;
    try {
      text = await readText(preset);
    } catch (error) {
      log(`engram web-provision: cannot read ${preset.path} (${describe(error)}) — nothing reverted`);
      results.push({ presetId: preset.id, path: preset.path, action: "skipped", reason: "read-failed" });
      anyFailed = true;
      continue;
    }

    if (compactionWireStatus(text) !== "wired") {
      log(`engram web-provision: preset "${preset.id}" is not wired — nothing to revert`);
      results.push({ presetId: preset.id, path: preset.path, action: "noop" });
      continue;
    }

    const restored = restoreCompactionRow(text);
    if (restored === null) {
      log(
        `engram web-provision: preset "${preset.id}" changed since it was wired — not guessing; `
        + "restore the `.engram.bak` next to it manually if present",
      );
      results.push({ presetId: preset.id, path: preset.path, action: "failed", reason: "layout-mismatch" });
      anyFailed = true;
      continue;
    }

    try {
      await writeText(preset, restored);
    } catch (error) {
      log(`engram web-provision: revert write failed for "${preset.id}" (${describe(error)}) — restore manually`);
      results.push({ presetId: preset.id, path: preset.path, action: "failed", reason: "write-failed" });
      anyFailed = true;
      continue;
    }

    log(`engram web-provision: reverted preset "${preset.id}" to the stock compaction-basic row`);
    results.push({ presetId: preset.id, path: preset.path, action: "reverted" });
    anyReverted = true;
  }

  const action = anyReverted ? "reverted" : anyFailed ? "failed" : "noop";
  const first = results[0];
  return {
    action,
    presets: results,
    ...(first !== undefined ? { presetId: first.presetId, path: first.path } : {}),
  };
}
