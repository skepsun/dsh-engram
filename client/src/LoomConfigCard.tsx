/**
 * dsh-loom client: the Plugins → 配置 card (settings.plugin.item, keyed by the
 * `dsh-loom` namespace the host registers). Reads/writes the namespace through
 * ctx.settingsScope — the host applies changes to the live config for new
 * sessions (already-frozen [LOOM] blocks are stable by design).
 *
 * Self-rendered with plain React: toggles for booleans, number inputs for the
 * integer knobs, per-field reset (unset → composition layer) and one Save.
 */

import { useCallback, useEffect, useState } from "react";
import type { SettingsScope, SettingsScopeSnapshot } from "@deepseek-ai/dsh-client-ui-settings/types";

export interface LoomConfigValue {
  autoCapture?: boolean;
  sessionSearch?: boolean;
  autoCapturePerSession?: number;
  indexMaxLines?: number;
  indexMaxChars?: number;
  minIndexSignal?: number;
  promoteHits?: number;
  expireDays?: number;
  maxMemoriesPerWorkspace?: number;
}

export interface LoomConfigCardFace {
  scope: SettingsScope<LoomConfigValue>;
}

const FIELDS: Array<{ key: keyof LoomConfigValue; label: string; hint: string; kind: "bool" | "num"; step?: number; min?: number; max?: number }> = [
  { key: "autoCapture", label: "自动捕获", hint: "零 LLM 从工具结果提取记忆（git/关键文件/错误）", kind: "bool" },
  { key: "sessionSearch", label: "会话历史搜索", hint: "loom_recall 支持跨会话 FTS 兜底", kind: "bool" },
  { key: "autoCapturePerSession", label: "每会话捕获上限", hint: "单会话自动捕获条数上限", kind: "num", min: 0, max: 1000 },
  { key: "indexMaxLines", label: "索引最大行数", hint: "[LOOM] 块最多显示的条目行数", kind: "num", min: 0, max: 50 },
  { key: "indexMaxChars", label: "索引字符上限", hint: "[LOOM] 块 token 预算", kind: "num", min: 0, max: 4000 },
  { key: "minIndexSignal", label: "入索引信号阈值", hint: "signal ≥ 此值的自动捕获才进索引", kind: "num", min: 0, max: 1, step: 0.05 },
  { key: "promoteHits", label: "晋升命中数", hint: "hit 数达此值的低信号条目进索引", kind: "num", min: 0, max: 20 },
  { key: "expireDays", label: "TTL（天）", hint: "0 = 不过期", kind: "num", min: 0, max: 3650 },
  { key: "maxMemoriesPerWorkspace", label: "工作区记忆上限", kind: "num", min: 0, max: 10000 },
];

const s = {
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
    color: "inherit",
  },
  actions: { display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" },
  btn: { border: "1px solid var(--dsh-color-border, #d1d5db)", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  btnPrimary: { border: "1px solid var(--dsh-color-primary, #2563eb)", background: "var(--dsh-color-primary, #2563eb)", color: "#fff", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  note: { fontSize: 11.5, color: "var(--dsh-color-muted, #9ca3af)", marginTop: 8 },
};

export function LoomConfigCard({ scope }: LoomConfigCardFace) {
  const [snap, setSnap] = useState<SettingsScopeSnapshot<LoomConfigValue> | null>(null);
  const [draft, setDraft] = useState<LoomConfigValue>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void scope.load();
    const off = scope.subscribe(() => {
      const next = scope.getSnapshot();
      setSnap(next);
      const value = (next.value ?? next.base) as LoomConfigValue | undefined;
      if (value) setDraft((prev) => ({ ...value, ...prev }));
    });
    setSnap(scope.getSnapshot());
    return off;
  }, [scope]);

  const setField = useCallback((key: keyof LoomConfigValue, value: boolean | number | undefined) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      for (const field of FIELDS) {
        const value = draft[field.key];
        if (value !== undefined) {
          if (typeof value === "number" && Number.isNaN(value)) continue;
          await scope.set(field.key, value);
        }
      }
      await scope.load();
    } finally {
      setSaving(false);
    }
  }, [draft, scope]);

  const resetField = useCallback(async (key: keyof LoomConfigValue) => {
    await scope.unset(key);
    await scope.load();
    setDraft((prev) => ({ ...prev, [key]: undefined }));
  }, [scope]);

  const value: LoomConfigValue = { ...((snap?.base as LoomConfigValue) ?? {}), ...draft };
  const writable = snap?.writable !== false && snap?.status !== "unavailable";

  return (
    <div>
      {FIELDS.map((field) => {
        const raw = value[field.key];
        const overridden = snap?.user !== undefined && field.key in (snap.user as object);
        return (
          <div key={field.key} style={s.row}>
            <div>
              <div style={s.label}>{field.label}</div>
              <div style={s.hint}>{field.hint}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {field.kind === "bool" ? (
                <input
                  type="checkbox"
                  checked={raw === true}
                  disabled={!writable}
                  onChange={(e) => setField(field.key, e.target.checked)}
                />
              ) : (
                <input
                  type="number"
                  style={s.input}
                  step={field.step ?? 1}
                  min={field.min}
                  max={field.max}
                  value={raw === undefined ? "" : String(raw)}
                  disabled={!writable}
                  onChange={(e) => setField(field.key, e.target.value === "" ? undefined : Number(e.target.value))}
                />
              )}
              <button
                style={{ ...s.btn, color: overridden ? "#2563eb" : "#9ca3af" }}
                title="重置为默认"
                disabled={!writable || !overridden}
                onClick={() => void resetField(field.key)}
              >
                重置
              </button>
            </div>
          </div>
        );
      })}
      <div style={s.actions}>
        <button style={s.btn} onClick={save} disabled={!writable || saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      <div style={s.note}>
        {snap?.status === "unavailable"
          ? "远程浏览器不可持久化设置（loopback-only）。"
          : "设置对新建会话即时生效；已冻结的 [LOOM] 块保持前缀稳定。"}
      </div>
    </div>
  );
}
