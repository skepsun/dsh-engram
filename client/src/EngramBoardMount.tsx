/**
 * EngramBoardMount — mounts the ESR task-board surfaces at the DOM level.
 *
 * The `conversation` and `sidebar` slots are single-occupant (ui-conversation
 * / ui-sidebar) and external plugins cannot declare slots, so — following the
 * skin/task-board precedent — the board takes over the center column at the
 * DOM level:
 *   - a sidebar entry row `[data-dsh-engram-entry]` injected next to the
 *     sibling family block (task-board / ssh entries), with a live badge of
 *     active ESR tasks (polled from /overview);
 *   - a board container `[data-dsh-engram-board]` appended to the center
 *     column with its own React root; visibility is CSS-driven via
 *     `html[data-dsh-engram-board-active="on"]` so the conversation subtree stays
 *     mounted and stateful underneath;
 *   - cross-panel activation: opening evicts sibling panels (task-board /
 *     ssh), opening a sibling closes ours, and clicking a sidebar row hands
 *     the center column back to the conversation.
 *
 * Everything self-heals: a MutationObserver re-inserts the entry and mounts
 * the board once the shell frame exists (and re-mounts after a shell
 * re-render). Failure policy: DOM problems log, never throw.
 */
import { createRoot, type Root } from "react-dom/client";
import type { EngramApi } from "./api";
import { EngramBoard } from "./EngramBoard";

export { EngramBoard } from "./EngramBoard";

export const ENTRY_SELECTOR = "[data-dsh-engram-entry]";
export const BOARD_SELECTOR = "[data-dsh-engram-board]";
export const PANEL_NAME = "engram";
/** Rendered board root also carries a marker for tests/selectors. */
export const BOARD_ROOT_SELECTOR = "[data-engram-board]";
const ACTIVE_ATTR = "data-dsh-engram-board-active";
const ACTIVATE_EVENT = "dsh-panel-activate";
/** Sibling panels that take over the center column. */
const OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active"];
const CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
/** Rows whose click should hand the center column back to the conversation. */
const SIDEBAR_ROW_SELECTOR =
  '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
/** Sibling injected rows (keep relative order stable across re-renders). */
const FAMILY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-engram-entry]";

const ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M5.2 8.1l1.8 1.8 3.8-4"/></svg>';

let styleInjected = false;

function ensureBoardStyles(): void {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "engram-board-styles";
  style.textContent = `
[data-pane='conversation'], [class*='centerCol'] { position: relative; }
[data-dsh-engram-board] {
  position: absolute; inset: 0; z-index: 60; display: none;
  background: var(--dsw-alias-bg-base, #ffffff);
}
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-engram-board] { display: block; }
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-engram-board]),
html[data-dsh-engram-board-active="on"]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-engram-board]) { display: none !important; }
[data-dsh-engram-entry] {
  display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
  padding: 7px 10px; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, inherit); font-size: 12.5px; font-weight: 600; text-align: left;
  border-radius: 8px; transition: background .15s ease;
}
[data-dsh-engram-entry]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
[data-dsh-engram-entry] .engram-entry-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-engram-entry] .engram-entry-badge {
  flex: 0 0 auto; min-width: 18px; text-align: center; border-radius: 999px;
  padding: 0 6px; font-size: 10px; font-weight: 700; line-height: 16px;
  background: rgba(99,102,241,.14); color: var(--dsw-alias-label-primary-bluish, #4338ca);
}
[data-dsh-engram-entry][data-dsh-engram-idle] .engram-entry-badge { display: none; }
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-engram-entry] .engram-entry-label,
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-engram-entry] .engram-entry-badge { display: none; }
`;
  document.head.appendChild(style);
  styleInjected = true;
}

/** The sidebar shell root (element owning the logo row). */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return undefined;
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined);
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of root.children) {
    if (child.tagName === "BUTTON") return child as HTMLButtonElement;
  }
  return undefined;
}

function centerColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CENTER_COLUMN_SELECTOR) ?? undefined;
}

/**
 * Mount the ESR board surfaces. Returns a disposer.
 * @param api - the loopback-fenced EngramApi used for data + mutations.
 */
export function mountEngramBoard(api: EngramApi): () => void {
  ensureBoardStyles();
  if (typeof document === "undefined") return () => {};

  // --- controller state (shared between entry + board) ---
  let open = false;
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let entry: HTMLButtonElement | undefined;
  let boardUnmounted = false;

  const close = (): void => {
    if (!open) return;
    open = false;
    document.documentElement.removeAttribute(ACTIVE_ATTR);
  };
  const openPanel = (): void => {
    if (open) return;
    open = true;
    for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr);
    document.documentElement.setAttribute(ACTIVE_ATTR, "on");
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
  };
  const toggle = (): void => (open ? close() : openPanel());

  // --- sidebar entry ---

  /** Build the entry row (plain DOM button; label + live badge). */
  const createEntryRow = (): HTMLButtonElement => {
    const row = document.createElement("button");
    row.type = "button";
    row.dataset.dshEngramEntry = "";
    row.setAttribute("aria-label", "ESR 看板");
    row.innerHTML = `<span style="display:inline-flex;flex:0 0 auto;color:var(--dsw-alias-label-primary-bluish,#4338ca);">${ICON}</span><span class="engram-entry-label">ESR 看板</span><span class="engram-entry-badge">0</span>`;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    return row;
  };
  entry = createEntryRow();

  const placeEntry = (rootEl: HTMLElement): boolean => {
    const button = newSessionButton(rootEl);
    if (button === undefined) return false;
    if (entry!.parentElement === rootEl) return true;
    const row = button.closest('[class*="logoRow"]');
    const base = row !== null && row.parentElement === rootEl ? row : button;
    const family = Array.from(rootEl.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches(FAMILY_SELECTOR),
    );
    const lastSibling = family[family.length - 1];
    if (lastSibling !== undefined && lastSibling.nextSibling !== null) {
      rootEl.insertBefore(entry!, lastSibling.nextSibling);
    } else {
      rootEl.insertBefore(entry!, base.nextSibling ?? null);
    }
    return true;
  };

  let entryRoot: HTMLElement | undefined;
  let entryPlaced = false;
  const tryPlaceEntry = (): void => {
    if (!entry) return;
    if (entryRoot !== undefined && !entryRoot.isConnected) {
      entryRoot = undefined;
      entryPlaced = false;
    }
    if (entryPlaced) {
      if (document.body.contains(entry)) return;
      entryRoot = undefined;
      entryPlaced = false;
    }
    entryRoot ??= sidebarRoot();
    if (entryRoot === undefined) return;
    entryPlaced = placeEntry(entryRoot);
  };
  const bodyObserver = new MutationObserver(() => tryPlaceEntry());
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  tryPlaceEntry();

  // --- live badge: total active tasks across workspaces ---
  let badgeTimer = 0;
  const pollBadge = async (): Promise<void> => {
    if (!entry || !entry.isConnected) return;
    try {
      const ov = await api.overview();
      const total = Object.values(ov.workspaces).reduce((a, w) => a + (w.tasks ?? 0), 0);
      const badge = entry.querySelector<HTMLElement>(".engram-entry-badge");
      if (badge) {
        badge.textContent = String(total);
        entry.toggleAttribute("data-dsh-engram-idle", total === 0);
        entry.title = `ESR 看板 · ${total} 个进行中任务`;
      }
    } catch {
      entry.toggleAttribute("data-dsh-engram-idle", true);
    }
  };
  void pollBadge();
  badgeTimer = window.setInterval(() => void pollBadge(), 30000);

  // --- board in the center column ---
  const ensureContainer = (): void => {
    if (container !== undefined || boardUnmounted) return;
    const column = centerColumn();
    if (column === undefined) return;
    container = document.createElement("div");
    container.dataset.dshEngramBoard = "";
    column.appendChild(container);
    root = createRoot(container);
    root.render(<EngramBoard api={api} onRequestClose={close} />);
  };
  const boardWatcher = new MutationObserver(() => ensureContainer());
  boardWatcher.observe(document.body, { childList: true, subtree: true });
  ensureContainer();

  // --- cross-panel + sidebar-row behavior ---
  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail !== PANEL_NAME && open) close();
  };
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!open) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && target.closest(SIDEBAR_ROW_SELECTOR) !== null) close();
  };
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  document.addEventListener("click", onClickSidebarRow, true);

  // --- disposer ---
  return () => {
    boardUnmounted = true;
    window.clearInterval(badgeTimer);
    bodyObserver.disconnect();
    boardWatcher.disconnect();
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    document.removeEventListener("click", onClickSidebarRow, true);
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    entry?.remove();
    entry = undefined;
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  };
}
