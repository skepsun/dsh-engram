/**
 * dsh-engram settings-binding tests — the GUI-visible knobs must exist in the
 * schemastery schema AND in the SETTINGS_KEYS list the host onChange loop
 * propagates to `live` config. Locks in:
 *   - the new `autoSupersede` GUI knob (memories → 记忆语义 group),
 *   - the `verifyArtifact` propagation fix (it was rendered in the card but
 *     missing from SETTINGS_KEYS, so the toggle never reached live config).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveConfig } from "../lib/index.js";
import { SETTINGS_KEYS, settingsBaseFrom, makeSettingsSchema } from "../lib/settings.js";

test("autoSupersede + verifyArtifact are exposed and propa-gateable", () => {
  const defaults = resolveConfig({});
  assert.equal(defaults.autoSupersede, false, "autoSupersede defaults OFF");
  assert.equal(defaults.verifyArtifact, true);
  assert.equal(defaults.autoSinkTodosOnEnd, true, "session-end todo auto-sink defaults ON");
  assert.equal(defaults.autoWebCompaction, false, "web auto-wiring of Context GC is opt-in (v0.6 default correction)");
  assert.equal(defaults.gcReplacesCompaction, false, "replacing host compaction is opt-in (v0.6)");
  assert.equal(
    defaults.boundaryPrune,
    false,
    "BoundaryPrune defaults OFF since v0.7.11: the host prunes on its own and the boundary source never fires in ordinary sessions (live ledger: host 64,200 chars vs engram 7,841)",
  );
  assert.equal(defaults.boundaryPruneAdaptive, true, "adaptive ledger gate defaults ON");
  assert.equal(defaults.resultPack, true, "default pruning stays lossless via the archive");
  assert.equal(defaults.jitEnabled, true, "JIT push defaults ON (bounded, silent without hits)");
  assert.equal(defaults.recallScope, "workspace", "recallScope defaults to strict workspace isolation");

  // base (composition layer) includes both keys
  const base = settingsBaseFrom(defaults);
  assert.ok("recallScope" in base && base.recallScope === "workspace");
  assert.ok("autoSupersede" in base && base.autoSupersede === false);
  assert.ok("verifyArtifact" in base && base.verifyArtifact === true);
  assert.ok("autoSinkTodosOnEnd" in base && base.autoSinkTodosOnEnd === true);
  assert.ok("autoWebCompaction" in base && base.autoWebCompaction === false);
  assert.ok("boundaryPruneAdaptive" in base && base.boundaryPruneAdaptive === true);

  // the schemastery schema exposes both fields with the right defaults
  const schema = makeSettingsSchema(defaults);
  assert.equal(schema.dict.autoSupersede.type, "boolean");
  assert.equal(schema.dict.autoSupersede.meta.default, false);
  assert.equal(schema.dict.verifyArtifact.type, "boolean");
  assert.equal(schema.dict.verifyArtifact.meta.default, true);
  assert.equal(schema.dict.autoSinkTodosOnEnd.type, "boolean");
  assert.equal(schema.dict.autoSinkTodosOnEnd.meta.default, true);
  assert.equal(schema.dict.autoWebCompaction.type, "boolean");
  assert.equal(schema.dict.autoWebCompaction.meta.default, false);
  assert.equal(schema.dict.boundaryPruneAdaptive.type, "boolean");
  assert.equal(schema.dict.boundaryPruneAdaptive.meta.default, true);
  assert.equal(schema.dict.recallScope.type, "union");
  assert.equal(schema.dict.recallScope.meta.default, "workspace");

  // the onChange propagation loop iterates SETTINGS_KEYS — any GUI knob that
  // is not listed there writes to storage without ever reaching live config.
  assert.ok(SETTINGS_KEYS.includes("autoSupersede"), "autoSupersede propagates to live");
  assert.ok(SETTINGS_KEYS.includes("verifyArtifact"), "verifyArtifact propagates to live");
  assert.ok(SETTINGS_KEYS.includes("autoSinkTodosOnEnd"), "autoSinkTodosOnEnd propagates to live");
  assert.ok(SETTINGS_KEYS.includes("autoWebCompaction"), "autoWebCompaction propagates to live");
  assert.ok(SETTINGS_KEYS.includes("boundaryPruneAdaptive"), "boundaryPruneAdaptive propagates to live");
  assert.ok(SETTINGS_KEYS.includes("jitEnabled"), "jitEnabled propagates to live");
  assert.ok(SETTINGS_KEYS.includes("recallScope"), "recallScope propagates to live");
});

test("settingsBaseFrom picks exactly the curated keys", () => {
  const defaults = resolveConfig({});
  const base = settingsBaseFrom(defaults);
  assert.deepEqual(Object.keys(base).sort(), [...SETTINGS_KEYS].sort());
  for (const key of SETTINGS_KEYS) {
    assert.equal(base[key], defaults[key], `${key} mirrors defaults`);
  }
});
