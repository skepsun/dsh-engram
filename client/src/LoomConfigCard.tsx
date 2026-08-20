/**
 * dsh-loom client: the Plugins → 配置 card (settings.plugin.item, keyed by the
 * `dsh-loom` namespace the host registers). Reads/writes the namespace through
 * LoomScope — a self-sufficient transport over the connection's settings RPCs
 * that keeps working when the GUI is reached through an operator-authorized
 * tunnel (DSH's own settingsScope binder hard-codes off-loopback browsers to
 * read-only memory persistence for every plugin card). The host applies
 * changes to the live config for new sessions (already-frozen [LOOM] blocks
 * are stable by design).
 *
 * Card chrome mirrors the built-in "Shell / Agent loop / Web search" plugin
 * cards in the same Plugins configuration tab: a header naming the plugin with
 * a one-line description, collapsed by default, whose click discloses the
 * settings in place. Inside the disclosure the settings render under four
 * labelled groups (capture & search / index / lifecycle & GC / security)
 * instead of a flat list. Self-rendered with plain React under the
 * bundle-purity gate (no ui-primitives import — the chevron is an inline SVG),
 * with toggles for booleans, number inputs for the integer knobs, per-field
 * reset (unset → composition layer), one Discard and one Save.
 */

import { useCallback, useEffect, useState } from "react";
import type { LoomScope, LoomScopeSnapshot } from "./scope";
import { useLoomTheme } from "./theme";

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
  gcEnabled?: boolean;
  gcStableRetentionDays?: number;
  /** Hostnames allowed past the /api/dsh-loom loopback fence (tunnel hosts). */
  trustedHosts?: string[];
}

export interface LoomConfigCardFace {
  scope: LoomScope<LoomConfigValue>;
}

type FieldKind = "bool" | "num" | "text";

export interface LoomConfigField {
  key: keyof LoomConfigValue;
  label: string;
  hint: string;
  kind: FieldKind;
  step?: number;
  min?: number;
  max?: number;
  width?: number;
}

export interface LoomConfigGroup {
  id: string;
  title: string;
  description?: string;
  fields: LoomConfigField[];
}

/**
 * A setting group rendered inside the card's disclosure. Reading the ~12
 * knobs as four labelled units is easier than one flat list.
 */
export const GROUPS: LoomConfigGroup[] = [
  {
    id: "capture",
    title: "捕获与检索",
    description: "零 LLM 自动捕获与跨会话搜索",
    fields: [
      { key: "autoCapture", label: "自动捕获", hint: "零 LLM 从工具结果提取记忆（git/关键文件/错误）", kind: "bool" },
      { key: "autoCapturePerSession", label: "每会话捕获上限", hint: "单会话自动捕获条数上限", kind: "num", min: 0, max: 1000 },
      { key: "sessionSearch", label: "会话历史搜索", hint: "loom_recall 支持跨会话 FTS 兜底", kind: "bool" },
    ],
  },
  {
    id: "index",
    title: "索引",
    description: "[LOOM] 块的内容预算与晋升规则",
    fields: [
      { key: "indexMaxLines", label: "索引最大行数", hint: "[LOOM] 块最多显示的条目行数", kind: "num", min: 0, max: 50 },
      { key: "indexMaxChars", label: "索引字符上限", hint: "[LOOM] 块 token 预算", kind: "num", min: 0, max: 4000 },
      { key: "minIndexSignal", label: "入索引信号阈值", hint: "signal ≥ 此值的自动捕获才进索引", kind: "num", min: 0, max: 1, step: 0.05 },
      { key: "promoteHits", label: "晋升命中数", hint: "hit 数达此值的低信号条目进索引", kind: "num", min: 0, max: 20 },
    ],
  },
  {
    id: "retention",
    title: "生命周期与 GC",
    description: "过期、容量上限与定期回收",
    fields: [
      { key: "expireDays", label: "TTL（天）", hint: "0 = 不过期", kind: "num", min: 0, max: 3650 },
      { key: "maxMemoriesPerWorkspace", label: "工作区记忆上限", kind: "num", min: 0, max: 10000 },
      { key: "gcEnabled", label: "记忆 GC", hint: "定时回收（过期/超容量/stable 超窗/悬空链接）", kind: "bool" },
      { key: "gcStableRetentionDays", label: "stable 任务保留（天）", hint: "超窗后由 GC 归档、离开 [ESR] 表面", kind: "num", min: 0, max: 3650 },
    ],
  },
  {
    id: "security",
    title: "安全",
    description: "访问围栏与隧道授权",
    fields: [
      { key: "trustedHosts", label: "受信隧道域名", hint: "允许经隧道访问记忆查看器的域名，逗号分隔；留空 = 仅本机。改后需重启 dsh web 生效", kind: "text", width: 260 },
    ],
  },
];

/** Flat field ledger — save/reset iterate every group's fields in order. */
export const FIELDS: LoomConfigField[] = GROUPS.flatMap((group) => group.fields);

/** One-line description under the card's name, mirroring the built-in cards. */
const CARD_DESCRIPTION = "控制 loom 记忆的捕获、索引、保留与隧道访问";

// The built-in plugin cards are styled with the platform's dsw-alias design
// tokens; mirroring them here makes dsh-loom read as a sibling of the Shell /
// Agent loop / Web search cards in the same tab.
const s = {
  card: {
    listStyle: "none",
    border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    borderRadius: 12,
    background: "var(--dsw-alias-bg-layer-3, #ffffff)",
    transition: "border-color .16s, background .16s",
  },
  cardOpen: {
    background: "var(--dsw-alias-bg-layer-2, #ffffff)",
    borderColor: "var(--dsw-alias-label-dimmed, #9ca3af)",
  },
  header: {
    width: "100%",
    appearance: "none",
    border: 0,
    background: "none",
    font: "inherit",
    color: "inherit",
    textAlign: "left" as const,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 12,
  },
  headText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: "var(--dsw-alias-label-primary, #111827)" },
  description: { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  pending: {
    flex: "none",
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    lineHeight: "17px",
    fontWeight: 500,
    whiteSpace: "nowrap" as const,
    background: "var(--dsw-alias-bg-module-platform, #f3f4f6)",
    color: "var(--dsw-alias-label-secondary, #4b5563)",
  },
  body: {
    borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    margin: "0 16px",
    paddingBottom: 8,
  },
  readOnly: { margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  groupPanel: {
    marginTop: 10,
    border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
    borderRadius: 10,
    padding: "8px 12px 2px",
    background: "var(--dsw-alias-bg-layer-3, #ffffff)",
  },
  groupHead: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 },
  groupTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 0.2, color: "var(--dsw-alias-label-primary, #111827)" },
  groupDesc: { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #6b7280)" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid var(--dsw-alias-border-l1, #f3f4f6)",
  },
  label: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #111827)" },
  hint: { fontSize: 11.5, lineHeight: 1.4, color: "var(--dsw-alias-label-tertiary, #6b7280)", marginTop: 2 },
  input: {
    width: 90,
    border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
    borderRadius: 6,
    padding: "4px 7px",
    fontSize: 12.5,
    background: "var(--dsw-alias-bg-layer-3, #fff)",
    color: "inherit",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 0 4px",
    borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
  },
  reset: {
    appearance: "none",
    border: 0,
    background: "none",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
    color: "var(--dsw-alias-label-tertiary, #6b7280)",
  },
  discard: {
    appearance: "none",
    border: "1px solid var(--dsw-alias-border-l2, #d1d5db)",
    borderRadius: 8,
    padding: "5px 14px",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    cursor: "pointer",
    background: "none",
    color: "var(--dsw-alias-label-secondary, #4b5563)",
  },
  save: {
    appearance: "none",
    border: "1px solid transparent",
    borderRadius: 8,
    padding: "5px 14px",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    cursor: "pointer",
    background: "var(--dsw-alias-label-primary, #111827)",
    color: "var(--dsw-alias-bg-layer-3, #ffffff)",
  },
  disabled: { opacity: 0.4, cursor: "default" },
  failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: "#dc2626" },
  note: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)", marginTop: 8 },
};

/** Chevron mirroring IconChevronDownOutline14 (bundle-purity: inline SVG). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={{
        flex: "none",
        color: "var(--dsw-alias-label-tertiary, #6b7280)",
        transition: "transform .16s",
        transform: open ? "rotate(180deg)" : undefined,
      }}
    >
      <path
        d="M3 5.5 L7 9 L11 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LoomConfigCard({ scope }: LoomConfigCardFace) {
  const [snap, setSnap] = useState<LoomScopeSnapshot<LoomConfigValue> | null>(null);
  const [draft, setDraft] = useState<LoomConfigValue>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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

  const setField = useCallback((key: keyof LoomConfigValue, value: boolean | number | string[] | undefined) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Effective stored values the draft is edited against. */
  const effective: LoomConfigValue = ((snap?.value ?? snap?.base) as LoomConfigValue | undefined) ?? {};
  const anyDirty = FIELDS.some((field) => {
    const staged = draft[field.key];
    return staged !== undefined && staged !== (effective as Record<string, unknown>)[field.key];
  });

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      for (const field of FIELDS) {
        const value = draft[field.key];
        if (value === undefined) continue;
        if (value === (effective as Record<string, unknown>)[field.key]) continue;
        if (typeof value === "number" && Number.isNaN(value)) continue;
        await scope.set(field.key, value);
      }
      await scope.load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }, [draft, scope, effective]);

  const discard = useCallback(() => {
    setError(null);
    const value: LoomConfigValue = ((snap?.value ?? snap?.base) as LoomConfigValue | undefined) ?? {};
    setDraft({ ...value });
  }, [snap]);

  const resetField = useCallback(async (key: keyof LoomConfigValue) => {
    setError(null);
    try {
      await scope.unset(key);
      await scope.load();
      setDraft((prev) => ({ ...prev, [key]: undefined }));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [scope]);

  const value: LoomConfigValue = { ...((snap?.base as LoomConfigValue) ?? {}), ...draft };
  const writable = snap?.writable !== false && snap?.status !== "unavailable";
  const available = snap?.status === "ready";
  const { vars } = useLoomTheme();

  return (
    <div style={vars}>
      <div style={available ? { ...s.card, ...(open ? s.cardOpen : undefined) } : { display: "none" }}>
        <button
          type="button"
          style={s.header}
          aria-expanded={open}
          aria-label={`${open ? "收起" : "展开"} dsh-loom 设置`}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span style={s.headText}>
            <span style={s.name}>dsh-loom</span>
            <span style={s.description}>{CARD_DESCRIPTION}</span>
          </span>
          {anyDirty && <span style={s.pending}>未保存</span>}
          <Chevron open={open} />
        </button>
        {open && (
          <div style={s.body}>
            {!writable && <p style={s.readOnly}>本部署的设置为只读（宿主未授权写入或需重启应用）。</p>}
            {GROUPS.map((group) => (
              <div key={group.id} style={s.groupPanel}>
                <div style={s.groupHead}>
                  <div style={s.groupTitle}>{group.title}</div>
                  {group.description && <div style={s.groupDesc}>{group.description}</div>}
                </div>
                {group.fields.map((field) => {
                  const raw = value[field.key];
                  const overridden = snap?.user !== undefined && field.key in (snap.user as object);
                  return (
                    <div key={field.key} style={s.row}>
                      <div>
                        <div style={s.label}>{field.label}</div>
                        <div style={s.hint}>{field.hint}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {field.kind === "bool" ? (
                          <input
                            type="checkbox"
                            checked={raw === true}
                            disabled={!writable}
                            onChange={(e) => setField(field.key, e.target.checked)}
                          />
                        ) : field.kind === "text" ? (
                          <input
                            type="text"
                            style={{ ...s.input, width: field.width ?? 180 }}
                            value={Array.isArray(raw) ? raw.join(", ") : raw === undefined ? "" : String(raw)}
                            disabled={!writable}
                            placeholder="host.domain, 另一域名…"
                            onChange={(e) => {
                              const tokens = e.target.value
                                .split(/[,\s]+/)
                                .map((x) => x.trim())
                                .filter(Boolean);
                              setField(field.key, tokens);
                            }}
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
                          type="button"
                          style={
                            overridden
                              ? { ...s.reset, color: "var(--dsw-alias-brand-primary, #2563eb)" }
                              : { ...s.reset, cursor: "default", opacity: 0.55 }
                          }
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
              </div>
            ))}
            <div style={s.note}>
              设置对新建会话即时生效；已冻结的 [LOOM] 块保持前缀稳定。
            </div>
            {error && <div style={s.failed}>{error}</div>}
            <div style={s.footer}>
              <button
                type="button"
                style={{ ...s.discard, ...(!anyDirty || saving ? s.disabled : undefined) }}
                disabled={!anyDirty || saving}
                onClick={discard}
              >
                放弃修改
              </button>
              <button
                type="button"
                style={{ ...s.save, ...((!anyDirty || saving) ? s.disabled : undefined) }}
                disabled={!anyDirty || saving}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
