/**
 * dsh-engram: browser-half entry — mounts three native surfaces:
 *   1. the unified "任务" dock strip above the composer
 *      (`conversation.input.dock`, shadowing the built-in todo cell and
 *      merging the session plan with the workspace's ESR tasks + relations);
 *   2. a standalone "Engram 记忆" settings section (memory viewer / ESR board /
 *      GC);
 *   3. the plugins configuration card.
 *
 * The rich page mounts as a first-class `settings.section` (设置 → Engram 记忆),
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
// Type-only: pulls the ui-conversation SlotMap merge so the
// 'conversation.input.dock' dock entry typechecks against PropsRuntime.
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { EngramApi } from "./api";
import { EngramTaskDock } from "./EngramTaskDock";
import { EngramSection, type EngramSectionFace } from "./EngramSection";
import { EngramConfigCard, type EngramConfigCardFace, type EngramConfigValue } from "./EngramConfigCard";
import { EngramScopeImpl } from "./scope";
import { mountEngramBoard } from "./EngramBoardMount";

/** Locale namespace this plugin owns. */
const NS = "dsh-engram";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** dsh-engram surface copy. */
    "dsh-engram": EngramKey;
  }
}

interface EngramKey {
  nav: string;
  refresh: string;
  error: string;
}

export const zh: EngramKey = {
  nav: "Engram 记忆",
  refresh: "刷新",
  error: "读取失败",
};

export const en: EngramKey = {
  nav: "Engram Memory",
  refresh: "Refresh",
  error: "Load failed",
};

export const inject = ["slots", "locale", "connection", "sessions", "workspaces"];

/**
 * Mount the ESR surfaces. A failure here must never take the GUI down —
 * wrap registrations so a slot absence degrades instead of breaking boot.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-engram: dictionaries");

  const api = new EngramApi();
  const t = ctx.locale.bind(NS) as (key: string) => string;
  const sectionInjected = (): EngramSectionFace => ({ api, t });

  // Unified task strip above the composer: takes over the SAME
  // 'conversation.input.dock' cell as the built-in todo strip (id 'todo',
  // lower priority => the cell's winner) and merges the session plan
  // (todo_write's `todos` projection) with the workspace's ESR tasks and
  // relations into one control — the built-in TodoPanel stays shadowed so
  // the two task planes never show as separate strips.
  try {
    ctx.slots.inject("conversation.input.dock", () =>
      ctx.slots.register(
        {
          name: "conversation.input.dock",
          id: "todo",
          order: 0,
          priority: -1,
          inject: () => ({ api }),
        },
        EngramTaskDock,
      ),
    );
  } catch (error) {
    console.warn("[dsh-engram] conversation.input.dock registration failed:", error);
  }

  // Rich viewer as a standalone first-class settings section (设置 → Engram 记忆),
  // no longer a tab inside the Plugins section. The slot is list-kind; the
  // settings shell hands the component its inject face plus the locale bound
  // to our NS. Sits right after the Plugins section (order 15) in the ledger.
  try {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "engram",
          order: 16,
          label: () => t("nav"),
          locale: NS,
          inject: sectionInjected,
        },
        EngramSection,
      ),
    );
  } catch (error) {
    console.warn("[dsh-engram] settings.section registration failed:", error);
  }

  // Config card: drive the `dsh-engram` settings namespace through the
  // connection's own settings RPCs. DSH's blessed settingsScope binder pins
  // non-loopback browsers (e.g. the GUI reached through an authorized tunnel)
  // to memory persistence — every plugin card renders empty and gray there.
  // A self-sufficient transport keeps this card usable regardless of how the
  // GUI is reached, while still persisting into the same settings document.
  const connection = ctx.get("connection");
  const scope = new EngramScopeImpl<EngramConfigValue>(connection.api, "dsh-engram");
  const cardInjected = (): EngramConfigCardFace => ({ scope });
  try {
    // The card is dispatched by the configurable-plugins tab only when the
    // host serves the `dsh-engram` namespace (key = namespace), so a host that
    // never serves it simply shows no card instead of a dead one.
    ctx.slots.inject("settings.plugin.item", () =>
      ctx.slots.register(
        {
          name: "settings.plugin.item",
          id: "dsh-engram",
          key: "dsh-engram",
          locale: NS,
          inject: cardInjected,
        },
        EngramConfigCard,
      ),
    );
  } catch (error) {
    console.warn("[dsh-engram] settings.plugin.item registration failed:", error);
  }

  // Full-screen ESR kanban: sidebar entry (with live active-task badge) +
  // center-column board, DOM-mounted (the conversation/sidebar slots are
  // single-occupant). Guarded: a mount problem must never take the GUI down.
  try {
    ctx.effect(
      () => mountEngramBoard(api),
      "dsh-engram: ESR task board mount",
    );
  } catch (error) {
    console.warn("[dsh-engram] ESR task board mount setup failed:", error);
  }
}
