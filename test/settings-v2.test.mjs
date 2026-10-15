/**
 * dsh-engram settings v2 (DSH ≥0.1.7 / 0.2.x) tests — the volatile Config +
 * entry-keyed settings model this plugin migrated to (the old installSection
 * API was removed in dsh-settings 0.1.7). Locks in:
 *   - `Config` (makeEngineConfigSchema) validates the full DEFAULTS surface,
 *     exposes the curated SETTINGS_KEYS as volatile references and keeps every
 *     other knob as a plain declared field (so profile-patch config survives
 *     schema validation);
 *   - `resolveConfig` unwraps volatile references into plain values, incl. the
 *     schemastery null-default sentinel → DEFAULTS fallback;
 *   - `collectVolatileRefs` + `syncVolatileRefs` re-sync a resolved config when
 *     the loader commits a settings-card edit into the same references in
 *     place (`loader/volatile-update`);
 *   - `installEngramSettings` feature-detects the generation: new DSH
 *     (configure, no installSection) → seam ns `engram`; legacy (installSection)
 *     → registers the `dsh-engram` namespace and merges stored values onto live.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createVolatile, isVolatile, updateVolatile } from "@deepseek-ai/cosmokit";

import { Config, resolveConfig, collectVolatileRefs, syncVolatileRefs } from "../lib/index.js";
import { SETTINGS_NS, SETTINGS_KEYS, installEngramSettings } from "../lib/settings.js";

/** DEFAULTS snapshot — resolveConfig(undefined) is the plain defaults object. */
const DEFAULTS = resolveConfig(undefined);
const DEFAULTS_KEYS = Object.keys(DEFAULTS);

test("Config validates the full default surface; curated knobs come back as volatile refs", () => {
  const res = Config["~standard"].validate({});
  assert.ok(res.issues === undefined || res.issues.length === 0, "empty row config validates");
  const cfg = res.value;
  // every DEFAULTS key is declared; nothing is stripped
  assert.deepEqual(Object.keys(cfg).sort(), [...DEFAULTS_KEYS].sort());
  // curated knobs → volatile references
  for (const key of SETTINGS_KEYS) {
    assert.ok(isVolatile(cfg[key]), `${key} is a volatile reference`);
  }
  // non-curated internal knobs stay plain declared fields
  for (const key of DEFAULTS_KEYS) {
    if (!SETTINGS_KEYS.includes(key)) assert.ok(!isVolatile(cfg[key]), `${key} stays plain`);
  }
  // defaults applied through the validator
  assert.equal(cfg.autoCapture.get(), DEFAULTS.autoCapture);
  assert.equal(cfg.recallScope.get(), DEFAULTS.recallScope);
  assert.deepEqual(cfg.trustedHosts.get(), DEFAULTS.trustedHosts);
  assert.equal(cfg.gcIntervalHours, DEFAULTS.gcIntervalHours);
  assert.equal(cfg.enabled, DEFAULTS.enabled);
  // profile-patch overrides land on the refs / plain fields
  const patched = Config["~standard"].validate({ autoCapture: false, gcIntervalHours: 6, recallScope: "global" }).value;
  assert.equal(patched.autoCapture.get(), false);
  assert.equal(patched.recallScope.get(), "global");
  assert.equal(patched.gcIntervalHours, 6);
  // unknown profile keys are preserved (schemastery objects are non-strict)
  const withExtra = Config["~standard"].validate({ futureKey: 1 }).value;
  assert.equal(withExtra.futureKey, 1);
});

test("resolveConfig unwraps refs to plain DEFAULTS; nullish volatile falls back", () => {
  const cfg = Config["~standard"].validate({}).value;
  const resolved = resolveConfig(cfg);
  assert.deepEqual(resolved, { ...DEFAULTS }, "unwrapped equals DEFAULTS");
  assert.equal(typeof resolved.autoCapture, "boolean");
  assert.deepEqual(resolved.trustedHosts, []);
  // overrides survive unwrap
  const override = resolveConfig(
    Config["~standard"].validate({ autoCapture: false, boundaryPruneThresholdChars: 2048 }).value,
  );
  assert.equal(override.autoCapture, false);
  assert.equal(override.boundaryPruneThresholdChars, 2048);
  // null override for the nullable knob is coerced to the 0 default
  // (0/absent both mean "host threshold"; the card always used 0)
  const blank = resolveConfig(Config["~standard"].validate({ boundaryPruneThresholdChars: null }).value);
  assert.equal(blank.boundaryPruneThresholdChars, 0);
  // legacy plain-object input still works (no refs present)
  assert.equal(resolveConfig({ autoCapture: false }).autoCapture, false);
  assert.equal(resolveConfig(undefined).enabled, DEFAULTS.enabled);
});

test("collectVolatileRefs/syncVolatileRefs re-sync resolved on a loader volatile commit", () => {
  const cfg = Config["~standard"].validate({}).value;
  const refs = collectVolatileRefs(cfg, SETTINGS_KEYS);
  assert.equal(Object.keys(refs).length, SETTINGS_KEYS.length);
  const resolved = resolveConfig(cfg);

  // the loader commits a card edit into the SAME references in place
  updateVolatile(cfg.autoCapture, createVolatile(false));
  updateVolatile(cfg.recallScope, createVolatile("global"));
  updateVolatile(cfg.promoteHits, createVolatile(7));

  const changed = syncVolatileRefs(refs, resolved);
  assert.deepEqual(changed.sort(), ["autoCapture", "promoteHits", "recallScope"].sort());
  assert.equal(resolved.autoCapture, false);
  assert.equal(resolved.recallScope, "global");
  assert.equal(resolved.promoteHits, 7);
  // untouched knobs unchanged
  assert.equal(resolved.resultPack, DEFAULTS.resultPack);
  // repeated sync with no new commit is a no-op
  assert.deepEqual(syncVolatileRefs(refs, resolved), []);
});

function settingsCtx(provider) {
  return {
    inject(deps, callback) {
      callback({ settings: provider, get: () => provider, logger: { info() {}, warn() {} } });
    },
  };
}

test("installEngramSettings: new generation (configure, no installSection) exposes seam ns=engram", () => {
  const calls = { describe: 0, mutate: null, update: null };
  const provider = {
    configure() {},
    describe(opts) {
      calls.describe++;
      return ["descriptor"];
    },
    async mutate(ns, ops, rev) {
      calls.mutate = { ns, ops, rev };
    },
    async update(ns, patch, rev) {
      calls.update = { ns, patch, rev };
    },
  };
  const service = {};
  const live = { autoCapture: true };
  installEngramSettings(settingsCtx(provider), DEFAULTS, live, service);
  assert.ok(service.settings, "seam exposed");
  assert.equal(service.settings.ns, SETTINGS_NS);
  assert.equal(service.settings.ns, "engram");
  // describe forwards (redactSecrets default true, like the card path)
  service.settings.describe();
  assert.equal(calls.describe, 1);
  // mutate / update forward args untouched
  service.settings.mutate("engram", [{ op: "set", path: ["autoCapture"], value: false }], 3);
  assert.equal(calls.mutate.ns, "engram");
  assert.deepEqual(calls.mutate.ops, [{ op: "set", path: ["autoCapture"], value: false }]);
  assert.equal(calls.mutate.rev, 3);
  service.settings.update("engram", { recallScope: "global" }, 1);
  assert.equal(calls.update.ns, "engram");
  assert.deepEqual(calls.update.patch, { recallScope: "global" });
  // installSection absent → the old path would have thrown; it must not be reached
  assert.equal(provider.installSection, undefined);
  // live roughness: legacy onChange would never fire (no source hook installed)
  assert.equal(live.autoCapture, true);
});

test("installEngramSettings: legacy (installSection) registers dsh-engram and merges onto live", () => {
  let captured;
  const live = { autoCapture: true, recallScope: "workspace" };
  const provider = {
    installSection(ctx, ns, schema, base, hooks) {
      captured = { ns, schema, base, hooks };
    },
    describe() {
      return [];
    },
    async mutate() {},
    async update() {},
  };
  const service = {};
  installEngramSettings(settingsCtx(provider), DEFAULTS, live, service);
  assert.equal(captured.ns, "dsh-engram");
  assert.deepEqual(Object.keys(captured.schema.dict).sort(), [...SETTINGS_KEYS].sort());
  // onChange merges stored values onto live
  captured.hooks.setSource(() => ({ autoCapture: false, recallScope: "global" }));
  captured.hooks.onChange();
  assert.equal(live.autoCapture, false);
  assert.equal(live.recallScope, "global");
  // seam ns is the legacy namespace (api.js lets the seam drive mutations)
  assert.equal(service.settings.ns, "dsh-engram");
});

test("installEngramSettings: no settings service → no seam, no throw", () => {
  const service = {};
  installEngramSettings({ inject() {} }, DEFAULTS, {}, service);
  assert.equal(service.settings, undefined);
});
