/**
 * dsh-engram: user settings binding (host half).
 *
 * Two DSH settings generations are in the wild:
 *  - ≤0.1.5 `settings.installSection(ctx, ns, schema, base, hooks)` mounts a
 *    free-form namespace (`dsh-engram`) with its own storage + change hooks.
 *  - ≥0.1.7 (and 0.2.x) forms are keyed by PROFILE ENTRY ID; editable fields
 *    are `.volatile()` fields of the plugin's own `Config` schema, values live
 *    in the profile row and hot-commit into the running volatile references
 *    (`loader/volatile-update`), so the GUI card needs no separate mount call.
 *
 * This module therefore:
 *  - exports `makeEngineConfigSchema(defaults)` — the plugin `Config`: every
 *    DEFAULTS key so pre-existing profile-patch config survives schema
 *    validation, with the curated SETTINGS_KEYS marked `.volatile()` so the
 *    settings service exposes exactly the card's knobs as a form;
 *  - `installEngramSettings` feature-detects the generation and exposes the
 *    single `service.settings` seam `{ ns, describe, mutate, update }` the
 *    `/api/dsh-engram/settings` routes use. The seam's `ns` is the ACTIVE
 *    namespace — entry id `engram` on new DSH, legacy `dsh-engram` on old —
 *    so the API layer never needs to know which generation it talks to.
 *
 * The client level keeps a stable wire label `dsh-engram`: api.js re-labels
 * the describe view onto that label and lets the seam's active `ns` drive
 * mutations, so the shipped client bundle works unchanged on both generations.
 */

import z from "@deepseek-ai/schemastery";

/** Active settings namespace on DSH ≥0.1.7 / 0.2.x — the profile ENTRY ID of
 *  the plugin row (`id: engram` in cordis.patch.yml). Must match plugin name. */
export const SETTINGS_NS = "engram";
/** Legacy (≤0.1.5) free-form namespace, when installSection is present. */
export const LEGACY_SETTINGS_NS = "dsh-engram";
/** Stable wire label the client card filters on (unchanged across generations;
 *  api.js re-labels the describe view onto it). */
export const WIRE_SETTINGS_NS = "dsh-engram";
/** Back-compat alias some call sites used for the old namespace constant. */
export const SETTINGS_NS_NAME = "dsh-engram";

/** Fields the GUI exposes (a curated subset of the plugin DEFAULTS). */
export const SETTINGS_KEYS = [
  "autoCapture",
  "autoCapturePreferences",
  "boundaryPrune",
  "boundaryPruneThresholdChars",
  "boundaryPruneIdleCadence",
  "resultPack",
  "sessionSearch",
  "recallScope",
  "autoRecallOnStart",
  "autoRecallLimit",
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
    autoCapturePreferences: z.boolean().default(defaults.autoCapturePreferences).description("用户纠正/偏好学习（零 LLM）：检测用户消息里的显式 prefer/avoid/switch-to 句式，自动沉淀为 preference 记忆并置顶 [ENGRAM] 索引（correx/PAHF 式偏好提取；关掉=只靠手动 engram_store）"),
    boundaryPrune: z.boolean().default(defaults.boundaryPrune).description("ResultPack L1（BoundaryPrune 边界剪枝）：在 todo 完成推进 / goal 终态这些子任务边界，主动调用 DSH 的确定性 toolResultPruner 剪掉超阈值旧工具结果（SoL-Pi Online Context Compact；默认关）"),
    boundaryPruneThresholdChars: z.natural().default(0).description("边界剪枝阈值覆盖（字符）：宿主 pruner 固定 8192；设更低（如 2048）可更早开剪——L0 仿真显示 T2048 净收益最高（+61.6Mc），前提是 L2 归档已开启可找回被剪中段；0=用宿主 8192"),
    boundaryPruneIdleCadence: z.natural().default(0).description("空闲步数边界（请求计数）：最多每 N 个请求触发一次剪枝，覆盖无 todo/goal 的会话（约 62% 会话永不触发事件边界）；仍受偿还门约束；0=仅事件边界"),
    resultPack: z.boolean().default(defaults.resultPack).description("ResultPack L2（结果归档召回）：BoundaryPrune 剪掉的中段脱敏归档到本地，剪枝节点尾部追加 handle，模型可用 result_recall(callId) 按页召回（完整 ObservationPack；需与 boundaryPrune 一起开，L2 本身默认关）"),
    sessionSearch: z.boolean().default(defaults.sessionSearch),
    recallScope: z.union(["workspace", "global"]).default(defaults.recallScope ?? "workspace").description("召回范围：workspace=严格按当前工作区隔离（默认、token 纪律）；global=本工作区命中弱/空时，从其它工作区池按 recency/origin 加权召回并标 [W:<workspace>] 来源。开启会打破跨工作区隔离，请按需选用"),
    autoRecallOnStart: z.boolean().default(defaults.autoRecallOnStart).description("新会话开始时，宿主按首条消息对工作区做确定性召回，把命中记忆直接注入 [RECALL] 块（无需模型自己想起调 engram_recall；关掉=回到纯拉取）"),
    autoRecallLimit: z.natural().min(1).max(8).default(defaults.autoRecallLimit).description("[RECALL] 块最多注入的记忆条数（agentmemory 候选①：少而准）"),
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

/** schemastery prototype for ONE DEFAULTS entry, used for the plugin Config. */
function configFieldType(value) {
  if (typeof value === "boolean") return z.boolean();
  if (typeof value === "number") return z.number();
  if (typeof value === "string") return z.string();
  if (Array.isArray(value)) return z.array(z.string());
  return z.unknown();
}

/**
 * The plugin's full Config schema (schemastery), i.e. the schema DSH ≥0.1.7
 * validates the `engram` profile row against and projects the settings form
 * from.
 *
 * - EVERY DEFAULTS key is declared (non-volatile, with its default) so a
 *   profile patch that sets an internal knob (e.g. `gcIntervalHours`,
 *   `enabled`) survives schema validation instead of being stripped.
 * - The curated SETTINGS_KEYS are additionally `.volatile()` — the settings
 *   service then exposes exactly the card's knobs as an editable form keyed by
 *   the entry id, and writes hot-commit into the running volatile references.
 *
 * Exported as `Config` by lib/index.js (cordis reads `plugin.Config`).
 */
export function makeEngineConfigSchema(defaults) {
  const fields = {};
  for (const [key, value] of Object.entries(defaults)) {
    let field = configFieldType(value).default(value);
    if (SETTINGS_KEYS.includes(key)) field = field.volatile();
    fields[key] = field;
  }
  return z.object(fields);
}

/**
 * Wire the settings section into `ctx` and expose the normalized
 * `service.settings` seam ({ ns, describe, mutate, update }) for the web API.
 * Called from `apply()`.
 *
 * Generation-agnostic adapter (DSH ≥0.1.7 / 0.2.x on top):
 *  - new DSH (≥0.1.7): the form is entry-keyed (`engram`) and its fields are
 *    the plugin's volatile Config knobs — there is nothing to "mount":
 *    `apply()` already received the validated volatile references and
 *    re-syncs `live` on `loader/volatile-update`. The seam just forwards.
 *  - legacy DSH (≤0.1.5): `installSection` mounts the free-form `dsh-engram`
 *    namespace; the old onChange loop merges stored values onto `live`.
 *
 * When both APIs are absent (headless/other), the seam stays undefined and the
 * /api/dsh-engram/settings routes answer 503 — same as before.
 */
export function installEngramSettings(ctx, defaults, live, service) {
  ctx.inject(["settings"], (settingsCtx) => {
    const provider = settingsCtx.settings;
    if (!provider || typeof provider.describe !== "function") return;

    // New generation: `configure()` exists and `installSection` is gone.
    if (typeof provider.configure === "function") {
      if (service) {
        service.settings = {
          ns: SETTINGS_NS,
          describe: () => provider.describe({ redactSecrets: true }),
          mutate: (ns, ops, expectedRevision) => provider.mutate(ns, ops, expectedRevision),
          update: (ns, patch, expectedRevision) => provider.update(ns, patch, expectedRevision),
        };
      }
      return;
    }

    // Legacy generation: free-form namespace via installSection.
    if (typeof provider.installSection !== "function") return;
    const base = settingsBaseFrom(defaults);
    const schema = makeSettingsSchema(defaults);
    let source = () => base;
    const ns = LEGACY_SETTINGS_NS;
    provider.installSection(ctx, ns, schema, base, {
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
    if (service) {
      service.settings = {
        ns,
        describe: () => provider.describe({ redactSecrets: true }),
        mutate: (ns, ops, expectedRevision) => provider.mutate(ns, ops, expectedRevision),
        update: (ns, patch, expectedRevision) => provider.update(ns, patch, expectedRevision),
      };
    }
  });
}
