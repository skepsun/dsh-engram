/**
 * Where the injected sidebar entry row goes — the DOM-shape decision, isolated.
 *
 * The sidebar is not a slot this plugin may register into (see the header of
 * `EngramBoardMount`), so the entry is injected next to the sibling family
 * block, or next to the row that owns the new-session button. Both anchors are
 * guesses about a shell we do not control, and DSH 0.2.2-rc.3 moved that button
 * inside a nested block: the previous code passed `button.nextSibling` straight
 * to `insertBefore` even when that node belonged to another parent, which throws
 * `NotFoundError`. Because the call happens inside a `MutationObserver`, the
 * throw repeated on every DOM mutation — 500+ console errors in one session —
 * and the entry never landed (issue #14).
 *
 * The invariant this module exists to keep: **the node handed to `insertBefore`
 * is always a child of the root, or `null`** (meaning "append"). Anything else
 * is a guess that can throw, so it is turned into a safe edge instead.
 */
export const FAMILY_SELECTOR =
  "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-engram-entry]";

/** The direct child of `root` that contains `node` (`node` itself when it is one). */
function directChildOf(root: HTMLElement, node: Element): Element | undefined {
  let current: Element | null = node;
  while (current !== null && current.parentElement !== root) current = current.parentElement;
  return current ?? undefined;
}

/**
 * Insert `entry` into `root`: after the sibling family block when the shell
 * renders one, else after the block that owns `base`.
 *
 * The preference order is the one the mount has always used. The old code
 * anchored on `logoRow` or the new-session button *itself*; resolving the
 * direct child that contains `base` yields the same element whenever the button
 * sits inside a direct-child logo row — the shape where the old code worked —
 * and a meaningful one where it did not.
 *
 * @returns whether the entry is now a child of `root`.
 */
export function placeEntryRow(root: HTMLElement, entry: HTMLElement, base: Element): boolean {
  const family = Array.from(root.children).filter((el) => el !== entry && el.matches(FAMILY_SELECTOR));
  const anchor = family[family.length - 1] ?? directChildOf(root, base);
  if (anchor === undefined) {
    // `base` is not inside `root` at all — the shell moved it somewhere else.
    // Inserting relative to it is meaningless; the end of the sidebar is a
    // worse position than the intent, and the only alternative is throwing on
    // every mutation. Take the edge.
    root.appendChild(entry);
    return true;
  }
  // `anchor` is a child of `root`, so `anchor.nextSibling` is one too (or null).
  root.insertBefore(entry, anchor.nextSibling);
  return true;
}
