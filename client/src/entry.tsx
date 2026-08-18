/**
 * dsh-loom: browser-half entry — renders the Settings "Loom 记忆" page and the
 * Plugins configuration card through DSH's native slot system.
 *
 * Zero direct imports of other plugins at runtime (bundle-purity gate): slots
 * and settingsScope come through the injected client context; the only value
 * imports are react/react-dom. `settings.section` and `settings.plugin.item`
 * declarations are pulled in type-only, so the compiled bundle stays clean.
 */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { LoomApi } from "./api";
import { LoomSection, type LoomSectionFace } from "./LoomSection";
import { LoomConfigCard, type LoomConfigCardFace, type LoomConfigValue } from "./LoomConfigCard";

/** Locale namespace this plugin owns. */
const NS = "dsh-loom";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** dsh-loom surface copy. */
    "dsh-loom": LoomKey;
  }
}

interface LoomKey {
  nav: string;
  refresh: string;
  error: string;
}

export const zh: LoomKey = {
  nav: "Loom 记忆",
  refresh: "刷新",
  error: "读取失败",
};

export const en: LoomKey = {
  nav: "Loom Memory",
  refresh: "Refresh",
  error: "Load failed",
};

export const inject = ["slots", "locale", "settingsScope"];

/**
 * Mount the two native surfaces. A failure here must never take the GUI down —
 * wrap registrations so a slot absence degrades instead of breaking boot.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-loom: dictionaries");

  const api = new LoomApi();
  const t = ctx.locale.bind(NS) as (key: string) => string;
  const sectionInjected = (): LoomSectionFace => ({ api, t });

  try {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "loom",
          order: 30,
          label: () => t("nav"),
          locale: NS,
          inject: sectionInjected,
        },
        LoomSection,
      ),
    );
  } catch (error) {
    console.warn("[dsh-loom] settings.section registration failed:", error);
  }

  const scope = ctx.settingsScope.bind<LoomConfigValue>({ namespace: "dsh-loom" });
  const cardInjected = (): LoomConfigCardFace => ({ scope });
  try {
    ctx.slots.inject("settings.plugin.item", () =>
      ctx.slots.register(
        {
          name: "settings.plugin.item",
          key: "dsh-loom",
          locale: NS,
          inject: cardInjected,
        },
        LoomConfigCard,
      ),
    );
  } catch (error) {
    console.warn("[dsh-loom] settings.plugin.item registration failed:", error);
  }
}
