/**
 * dsh-engram: regression test for the sidebar entry injection — issue #14.
 *
 * The bug (DSH 0.2.2-rc.3): the entry row `[data-dsh-engram-entry]` never
 * appeared, and the console grew one uncaught `NotFoundError` per DOM mutation
 * (500+ in a session). `placeEntry` resolved an anchor — the sibling family
 * block, else the logo row, else the new-session button — and then handed that
 * anchor's `nextSibling` to `insertBefore`. In rc.3 the button sits inside a
 * nested block, so its `nextSibling` belongs to another parent, which the DOM
 * rejects with `NotFoundError`. Thrown from inside a `MutationObserver`, that
 * repeats forever.
 *
 * Test strategy: the placement decision now lives in `client/src/sidebarEntry.ts`
 * (no React, no imports), so it can be driven directly. The stub tree implements
 * the two DOM rules that matter here — `nextSibling` follows the parent's child
 * list, and `insertBefore` throws `NotFoundError` when the reference node is not
 * a child — which is what makes the pre-fix behaviour a failure here rather than
 * a silent pass. Skips itself when esbuild cannot be resolved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { esbuildPkg } from "../client/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCE = join(ROOT, "client", "src", "sidebarEntry.ts");

const esbuildDir = esbuildPkg();
if (esbuildDir === null) {
  test("sidebar-entry: esbuild unavailable — skipping (install the client toolchain to run)", { skip: true }, () => {});
} else {
  const require = createRequire(join(esbuildDir, "package.json"));
  const esbuild = require("esbuild");
  const { code } = await esbuild.transform(readFileSync(SOURCE, "utf8"), { loader: "ts", format: "esm" });
  const { FAMILY_SELECTOR, placeEntryRow } = await import(`data:text/javascript,${encodeURIComponent(code)}`);

  /** Minimal element: parent/children/nextSibling + a literal DOM insertBefore. */
  function el({ family = false, tag = "div" } = {}) {
    const node = {
      tagName: tag.toUpperCase(),
      parentElement: null,
      children: [],
      isFamily: family,
      matches(selector) {
        if (selector === FAMILY_SELECTOR) return node.isFamily;
        // Keep the stub honest: a new selector in production must be taught here.
        throw new Error(`stub: unexpected selector ${selector}`);
      },
      get nextSibling() {
        const parent = node.parentElement;
        if (parent === null) return null;
        const index = parent.children.indexOf(node);
        return index < 0 ? null : parent.children[index + 1] ?? null;
      },
      appendChild(child) {
        insert(node, child, null);
        return child;
      },
      insertBefore(child, reference) {
        insert(node, child, reference);
        return child;
      },
    };
    return node;
  }

  function insert(parent, child, reference) {
    if (reference !== null && reference.parentElement !== parent) {
      // The browser's own rejection — the exact failure of issue #14.
      throw new Error("NotFoundError: the node before which the new node is to be inserted is not a child of this node");
    }
    if (child.parentElement !== null) {
      const siblings = child.parentElement.children;
      const at = siblings.indexOf(child);
      if (at >= 0) siblings.splice(at, 1);
    }
    child.parentElement = parent;
    if (reference === null) {
      parent.children.push(child);
      return;
    }
    parent.children.splice(parent.children.indexOf(reference), 0, child);
  }

  test("sidebar-entry: a button nested below the root never throws (DSH 0.2.2-rc.3)", () => {
    // The rc.3 shape: no logoRow, and the new-session button lives in a nested
    // block with something after it, so `button.nextSibling` is a real node that
    // is NOT a child of the sidebar root — the reference the old rule passed to
    // `insertBefore`, and the reason it threw.
    const root = el();
    const nested = el();
    root.appendChild(nested);
    const button = el({ tag: "button" });
    const separator = el({ tag: "span" });
    nested.appendChild(button);
    nested.appendChild(separator);
    assert.equal(button.parentElement, nested, "precondition: the button is nested, not a direct child");
    assert.equal(button.nextSibling, separator, "precondition: it has a following sibling");
    assert.notEqual(separator.parentElement, root, "precondition: that sibling is NOT a child of the sidebar root");

    const entry = el({ tag: "button", family: true });
    // A plain call: under the pre-fix anchor rule this line throws NotFoundError.
    assert.equal(placeEntryRow(root, entry, button), true);
    assert.equal(entry.parentElement, root, "the entry lands in the sidebar root");
    // Right after the block that owns the button — near the intent, not appended
    // at the far end of the sidebar.
    assert.deepEqual(root.children, [nested, entry]);
  });

  test("sidebar-entry: the sibling family block wins, and keeps its order", () => {
    const root = el();
    const taskBoard = el({ family: true });
    const ssh = el({ family: true });
    const trail = el();
    root.appendChild(taskBoard);
    root.appendChild(ssh);
    root.appendChild(trail);
    const button = el({ tag: "button" });
    root.appendChild(button);

    const entry = el({ tag: "button", family: true });
    placeEntryRow(root, entry, button);
    assert.deepEqual(root.children, [taskBoard, ssh, entry, trail, button], "after the last family row, before the rest");
  });

  test("sidebar-entry: a family block that is the last child means append", () => {
    const root = el();
    const only = el({ family: true });
    root.appendChild(only);

    const entry = el({ tag: "button", family: true });
    placeEntryRow(root, entry, only);
    assert.deepEqual(root.children, [only, entry], "nothing follows the family block, so the entry goes last");
  });

  test("sidebar-entry: a logo row holding the button keeps the old placement", () => {
    // The shape where the old code worked: the logo row is a direct child and
    // the new-session button lives inside it. The entry must still land right
    // after that row — the fix may not move an entry that already sat correctly.
    const root = el();
    const logoRow = el();
    const button = el({ tag: "button" });
    const trailing = el({ tag: "span" });
    logoRow.appendChild(button);
    logoRow.appendChild(trailing);
    root.appendChild(logoRow);

    const entry = el({ tag: "button", family: true });
    placeEntryRow(root, entry, button);
    assert.deepEqual(root.children, [logoRow, entry], "after the logo row, exactly as before the fix");
  });

  test("sidebar-entry: a button that IS a direct child is used as the anchor", () => {
    const root = el();
    const logoRow = el();
    root.appendChild(logoRow);
    const button = el({ tag: "button" });
    root.appendChild(button);
    const tail = el();
    root.appendChild(tail);

    const entry = el({ tag: "button", family: true });
    placeEntryRow(root, entry, button);
    assert.deepEqual(root.children, [logoRow, button, entry, tail]);
  });

  test("sidebar-entry: a button outside the root appends instead of throwing", () => {
    const root = el();
    const existing = el();
    root.appendChild(existing);
    const elsewhere = el();
    const button = el({ tag: "button" });
    elsewhere.appendChild(button);
    elsewhere.appendChild(el({ tag: "span" })); // a following sibling, so the old rule would throw

    const entry = el({ tag: "button", family: true });
    assert.equal(placeEntryRow(root, entry, button), true);
    assert.deepEqual(root.children, [existing, entry]);
  });

  test("sidebar-entry: re-placing an entry that is already a child does not duplicate it", () => {
    const root = el();
    const taskBoard = el({ family: true });
    root.appendChild(taskBoard);
    const entry = el({ tag: "button", family: true });
    root.appendChild(entry);
    const button = el({ tag: "button" });
    root.appendChild(button);

    placeEntryRow(root, entry, button);
    assert.equal(root.children.filter((child) => child.isFamily && child === entry).length, 1);
    assert.equal(root.children.length, 3);
  });
}
