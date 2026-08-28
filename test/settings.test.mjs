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
  assert.equal(defaults.autoWebCompaction, true, "web auto-wiring of Context GC defaults ON");

  // base (composition layer) includes both keys
  const base = settingsBaseFrom(defaults);
  assert.ok("autoSupersede" in base && base.autoSupersede === false);
  assert.ok("verifyArtifact" in base && base.verifyArtifact === true);
  assert.ok("autoSinkTodosOnEnd" in base && base.autoSinkTodosOnEnd === true);
  assert.ok("autoWebCompaction" in base && base.autoWebCompaction === true);

  // the schemastery schema exposes both fields with the right defaults
  const schema = makeSettingsSchema(defaults);
  assert.equal(schema.dict.autoSupersede.type, "boolean");
  assert.equal(schema.dict.autoSupersede.meta.default, false);
  assert.equal(schema.dict.verifyArtifact.type, "boolean");
  assert.equal(schema.dict.verifyArtifact.meta.default, true);
  assert.equal(schema.dict.autoSinkTodosOnEnd.type, "boolean");
  assert.equal(schema.dict.autoSinkTodosOnEnd.meta.default, true);
  assert.equal(schema.dict.autoWebCompaction.type, "boolean");
  assert.equal(schema.dict.autoWebCompaction.meta.default, true);

  // the onChange propagation loop iterates SETTINGS_KEYS — any GUI knob that
  // is not listed there writes to storage without ever reaching live config.
  assert.ok(SETTINGS_KEYS.includes("autoSupersede"), "autoSupersede propagates to live");
  assert.ok(SETTINGS_KEYS.includes("verifyArtifact"), "verifyArtifact propagates to live");
  assert.ok(SETTINGS_KEYS.includes("autoSinkTodosOnEnd"), "autoSinkTodosOnEnd propagates to live");
  assert.ok(SETTINGS_KEYS.includes("autoWebCompaction"), "autoWebCompaction propagates to live");
});

test("settingsBaseFrom picks exactly the curated keys", () => {
  const defaults = resolveConfig({});
  const base = settingsBaseFrom(defaults);
  assert.deepEqual(Object.keys(base).sort(), [...SETTINGS_KEYS].sort());
  for (const key of SETTINGS_KEYS) {
    assert.equal(base[key], defaults[key], `${key} mirrors defaults`);
  }
});
