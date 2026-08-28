/**
 * dsh-engram: user settings binding (host half).
 *
 * Registers the `dsh-engram` settings namespace through DSH's own settings
 * service so the web GUI's Plugins configuration tab pairs the namespace with
 * the plugin's card automatically. Changes land live on `service.config`
 * (new sessions pick them up; blocks already frozen for a session stay frozen
 * by design — prefix stability wins over mid-session knobs).
 *
 * The schema is schemastery (DSH's own schema engine), not zod: the settings
 * transport and the form renderers are all schemastery-native.
 */

import z from "@deepseek-ai/schemastery";
import { settingsNamespace, installSettingsSection } from "@deepseek-ai/dsh-settings";

/** Namespace join key — must match the client card's `key`. */
export const SETTINGS_NS_NAME = "dsh-engram";
export const SETTINGS_NS = settingsNamespace(SETTINGS_NS_NAME);

/** Fields the GUI exposes (a curated subset of the plugin DEFAULTS). */
export const SETTINGS_KEYS = [
  "autoCapture",
  "sessionSearch",
  "maxRecallPerSession",
  "autoCapturePerSession",
  "indexMaxLines",
  "indexMaxChars",
  "minIndexSignal",
  "promoteHits",
  "expireDays",
  "maxMemoriesPerWorkspace",
  "gcEnabled",
  "gcStableRetentionDays",
  "gcReplacesCompaction",
  "gcNarrative",
  "verifyArtifact",
  "autoSupersede",
  "autoSinkTodosOnEnd",
  "autoWebCompaction",
  "trustedHosts",
];

/** Base (composition) layer for the settings section, from plugin defaults. */
export function settingsBaseFrom(defaults) {
  const base = {};
  for (const key of SETTINGS_KEYS) {
    if (defaults[key] !== void 0) base[key] = defaults[key];
  }
  return base;
}

/** schemastery schema describing the GUI-editable fields. */
export function makeSettingsSchema(defaults) {
  return z.object({
    autoCapture: z.boolean().default(defaults.autoCapture),
    sessionSearch: z.boolean().default(defaults.sessionSearch),
    maxRecallPerSession: z.natural().min(1).max(10).default(defaults.maxRecallPerSession),
    autoCapturePerSession: z.natural().max(1000).default(defaults.autoCapturePerSession),
    indexMaxLines: z.natural().max(50).default(defaults.indexMaxLines),
    indexMaxChars: z.natural().max(4000).default(defaults.indexMaxChars),
    minIndexSignal: z.percent().default(defaults.minIndexSignal),
    promoteHits: z.natural().max(20).default(defaults.promoteHits),
    expireDays: z.natural().max(3650).default(defaults.expireDays),
    maxMemoriesPerWorkspace: z.natural().max(10000).default(defaults.maxMemoriesPerWorkspace),
    gcEnabled: z.boolean().default(defaults.gcEnabled),
    gcStableRetentionDays: z.natural().max(3650).default(defaults.gcStableRetentionDays),
    gcReplacesCompaction: z.boolean().default(defaults.gcReplacesCompaction),
    gcNarrative: z.boolean().default(defaults.gcNarrative),
    verifyArtifact: z.boolean().default(defaults.verifyArtifact).description("ESR 闭环时校验 artifact 路径真实存在"),
    autoSupersede: z.boolean().default(defaults.autoSupersede).description("实体锚定 + 替换式更新（改用/不再…）自动把旧记忆标为 superseded（默认关）"),
    autoSinkTodosOnEnd: z.boolean().default(defaults.autoSinkTodosOnEnd).description("会话结束时把仍 pending 的 todo 自动沉淀为 ESR draft 任务（去重、受容量上限约束；关掉=会话结束即弃）"),
    autoWebCompaction: z.boolean().default(defaults.autoWebCompaction).description("web 面启动时把全部 stock 布局的 agent 预设（shipped + 用户根）的 compaction 组自动换成 dsh-engram/compaction（带备份、幂等、不碰自定义/无 compaction 预设；关掉=不再自动接管，已接管的预设保持 Context GC、需 npm run web-compaction:revert 还原，host 面不受影响）"),
    // Security knob, not rendered in the card: hostnames allowed past the
    // loopback fence for /api/dsh-engram (operator-authorized tunnel hosts).
    trustedHosts: z.array(z.string()).default([]),
  });
}

/**
 * Wire the settings section into `ctx` and keep `live` (the plugin's mutable
 * config object) merged with what the user stored. Called from `apply()`.
 */
export function installEngramSettings(ctx, defaults, live) {
  const base = settingsBaseFrom(defaults);
  const schema = makeSettingsSchema(defaults);
  let source = () => base;
  installSettingsSection(ctx, SETTINGS_NS, schema, base, {
    setSource(current) {
      source = current;
    },
    onChange() {
      let value;
      try {
        value = source();
      } catch {
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const key of SETTINGS_KEYS) {
        if (value[key] !== void 0 && live[key] !== value[key]) live[key] = value[key];
      }
    },
    validate(value) {
      // The schema already constrains every exposed field; refuse nothing here.
      void value;
    },
  });
}
