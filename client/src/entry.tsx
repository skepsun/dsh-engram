/**
 * dsh-loom: browser-half entry — renders a standalone "Loom 记忆" settings
 * section (memory viewer / ESR board / GC) and the plugins configuration card
 * through DSH's native slot system.
 *
 * The rich page mounts as a first-class `settings.section` (设置 → Loom 记忆),
 * sitting right after the Plugins section in the settings sidebar; the config
 * card stays in the Plugins → 插件配置 tab as a collapsible card.
 *
 * Zero direct imports of other plugins at runtime (bundle-purity gate): slots
 * and settingsScope come through the injected client context; the only value
 * imports are react/react-dom. Slot declarations are pulled in type-only, so
 * the compiled bundle stays clean.
 */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { LoomApi } from "./api";
import { LoomSection, type LoomSectionFace } from "./LoomSection";
import { LoomConfigCard, type LoomConfigCardFace, type LoomConfigValue } from "./LoomConfigCard";
import { LoomScopeImpl } from "./scope";

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

export const inject = ["slots", "locale", "connection"];

/**
 * Mount the two native surfaces. A failure here must never take the GUI down —
 * wrap registrations so a slot absence degrades instead of breaking boot.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-loom: dictionaries");

  const api = new LoomApi();
  const t = ctx.locale.bind(NS) as (key: string) => string;
  const sectionInjected = (): LoomSectionFace => ({ api, t });

  // Rich viewer as a standalone first-class settings section (设置 → Loom 记忆),
  // no longer a tab inside the Plugins section. The slot is list-kind; the
  // settings shell hands the component its inject face plus the locale bound
  // to our NS. Sits right after the Plugins section (order 15) in the ledger.
  try {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "loom",
          order: 16,
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

  // Config card: drive the `dsh-loom` settings namespace through the
  // connection's own settings RPCs. DSH's blessed settingsScope binder pins
  // non-loopback browsers (e.g. the GUI reached through an authorized tunnel)
  // to memory persistence — every plugin card renders empty and gray there.
  // A self-sufficient transport keeps this card usable regardless of how the
  // GUI is reached, while still persisting into the same settings document.
  const connection = ctx.get("connection");
  const scope = new LoomScopeImpl<LoomConfigValue>(connection.api, "dsh-loom");
  const cardInjected = (): LoomConfigCardFace => ({ scope });
  try {
    // The card is dispatched by the configurable-plugins tab only when the
    // host serves the `dsh-loom` namespace (key = namespace), so a host that
    // never serves it simply shows no card instead of a dead one.
    ctx.slots.inject("settings.plugin.item", () =>
      ctx.slots.register(
        {
          name: "settings.plugin.item",
          id: "dsh-loom",
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
