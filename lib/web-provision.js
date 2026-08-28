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
 * Flip `autoWebCompaction:false` to opt out; `revertWebCompaction` restores
 * the stock row on uninstall.
 * @module dsh-engram/web-provision
 */

import { readFile, writeFile } from "node:fs/promises";

/** The engine package subpath a preset row mounts dsh-engram's engine under. */
export const ENGRAM_ROW_NAME = "dsh-engram/compaction";

/** The stock row the shipped `standard` preset mounts inside `compaction`. */
export const STOCK_COMPACTION_ROW =
  "    - id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'";

/** Engine config the plugin writes into each wired preset row (settings-driven). */
export const DEFAULT_ROW_CONFIG = Object.freeze({
  gcReplacesCompaction: true,
  gcNarrative: true,
});

/**
 * The engram row text for a given engine config (indentation must match the
 * stock preset: `- id:` at 4 spaces, keys at 6, sub-keys at 8).
 * @param {{ gcReplacesCompaction?: boolean; gcNarrative?: boolean }} [config]
 * @returns {string}
 */
export function engramCompactionRowText(config = {}) {
  const { gcReplacesCompaction = true, gcNarrative = true } = config;
  return [
    "    - id: engram-compaction",
    "      name: dsh-engram/compaction",
    "      config:",
    `        gcReplacesCompaction: ${gcReplacesCompaction}`,
    `        gcNarrative: ${gcNarrative}`,
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

/**
 * Classify a preset composition's compaction wiring.
 * - `wired` — already carries `dsh-engram/compaction`;
 * - `stock` — untouched shipped layout; safe to auto-wire;
 * - `custom` — anything else; never touch.
 * @param {string} text - the preset composition text.
 * @returns {"wired" | "stock" | "custom"}
 */
export function compactionWireStatus(text) {
  if (text.includes(ENGRAM_ROW_NAME)) return "wired";
  if (text.includes(STOCK_COMPACTION_ROW)) return "stock";
  return "custom";
}

/** Post-swap sanity invariants the result must satisfy. */
function invariantsOk(text) {
  return (
    text.includes(ENGRAM_ROW_NAME) &&
    !text.includes("@deepseek-ai/dsh-compaction-basic") &&
    text.includes("command-compact") &&
    text.includes("tool-result-pruner") &&
    text.includes("name: cordis:group") &&
    text.includes("isolate:")
  );
}

/**
 * Locate the engram row block (the two fixed lines plus any deeper-indented
 * `config:` lines) inside a wired composition.
 * @param {string} text
 * @returns {{ start: number; end: number } | null} line indices `[start, end)`
 */
function engramRowBlockBounds(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === "    - id: engram-compaction");
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") break;
    if (line.startsWith("    - id:")) break;
    if (line.startsWith("      ")) { end += 1; continue; }
    break;
  }
  return { start, end };
}

/** Does the file already carry exactly the expected row text? */
function rowMatches(text, rowText) {
  const bounds = engramRowBlockBounds(text);
  if (bounds === null) return false;
  const current = text.split("\n").slice(bounds.start, bounds.end).join("\n");
  return current === rowText;
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
  const rowText = engramCompactionRowText(rowConfig);
  const status = compactionWireStatus(text);
  if (status === "stock") {
    if (text.split(STOCK_COMPACTION_ROW).length - 1 !== 1) return null;
    const next = text.replace(STOCK_COMPACTION_ROW, rowText);
    return invariantsOk(next) ? next : null;
  }
  if (status === "wired") {
    if (rowMatches(text, rowText)) return text; // already exactly this config
    const bounds = engramRowBlockBounds(text);
    if (bounds === null) return null;
    const lines = text.split("\n");
    const next = [
      ...lines.slice(0, bounds.start),
      rowText,
      ...lines.slice(bounds.end),
    ].join("\n");
    return invariantsOk(next) ? next : null;
  }
  return null;
}

/**
 * Reverse {@link swapCompactionRow}: restore the stock `compaction-basic` row
 * from a wired composition (any engram row block — engine config included).
 * `null` when the input is not a composition we wired.
 * @param {string} text - the preset composition text.
 * @returns {string | null}
 */
export function restoreCompactionRow(text) {
  if (compactionWireStatus(text) !== "wired") return null;
  const bounds = engramRowBlockBounds(text);
  if (bounds === null) return null;
  const lines = text.split("\n");
  const next = [
    ...lines.slice(0, bounds.start),
    STOCK_COMPACTION_ROW,
    ...lines.slice(bounds.end),
  ].join("\n");
  return compactionWireStatus(next) === "stock" ? next : null;
}

/**
 * Collect the presets to consider — the resolved DEFAULT plus every preset on
 * the roster (`service.list()` when present). Deduped by path; broken presets
 * are skipped with a log line. Never throws.
 * @returns {Promise<Array<{ id: string; path: string }>>}
 */
async function collectPresetTargets(service, log) {
  const targets = [];
  const seen = new Set();
  const push = (preset) => {
    if (preset === undefined || preset === null) return;
    if (preset.broken !== undefined && preset.broken !== null) {
      log(
        `engram web-provision: preset "${preset.id}" is broken (${preset.broken}) — leaving it alone`,
      );
      return;
    }
    if (seen.has(preset.path)) return;
    seen.add(preset.path);
    targets.push(preset);
  };
  try {
    push(await service.resolve());
  } catch (error) {
    log(
      `engram web-provision: default agent preset unavailable (${describe(error)}) — continuing with the roster`,
    );
  }
  if (typeof service.list === "function") {
    try {
      for (const preset of await service.list()) push(preset);
    } catch (error) {
      log(
        `engram web-provision: preset roster unavailable (${describe(error)}) — using the default only`,
      );
    }
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

  const presets = await collectPresetTargets(service, log);
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

  const presets = await collectPresetTargets(service, log);
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
