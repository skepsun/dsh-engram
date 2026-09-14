/**
 * dsh-engram: behavioral regression test for the Plugins config card render
 * (client/src/EngramConfigCard.tsx) — issue #7.
 *
 * The bug: while the settings scope wasn't `ready` the card hid its root with
 * an inline `display: "none"`. The kernel's slot anchor is `display: contents`
 * (dsh-client-ui-renderer's SlotOutlet), so the card's own root was the flex
 * item of the Plugins card list (flex column, gap 10px) — a 0-height ghost
 * slot that doubled the gap between the neighboring cards.
 *
 * The fix under test: the card renders `null` while the scope isn't ready
 * (no box at all → no flex item → no gap), stays subscribed (the card appears
 * the moment the scope turns ready), and leaves a console breadcrumb when the
 * scope is unavailable.
 *
 * Test strategy: compile the actual TSX with esbuild against a stub `react`
 * (the repo deliberately ships no React toolchain as a dependency), then
 * drive the component through a minimal index-addressed hook renderer — the
 * same rules-of-hooks contract React enforces. Skips itself when esbuild
 * cannot be resolved (bare `npm install` environments without the client
 * toolchain; CI installs esbuild explicitly).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { esbuildPkg } from "../client/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const esbuildDir = esbuildPkg();
if (esbuildDir === null) {
  // No client toolchain in this environment — the bundle/typecheck CI jobs
  // cover the source; this test needs esbuild to compile the TSX on the fly.
  test("client-card: esbuild unavailable — skipping (install the client toolchain to run)", { skip: true }, () => {});
} else {
  const require = createRequire(join(esbuildDir, "package.json"));
  const esbuild = require("esbuild");

  // ---- minimal react stub (bundled INTO the test bundle by the alias plugin)
  const STUB_REACT = `
export function useState(initial) {
  return globalThis.__engramCardTestRenderer.useState(initial);
}
export function useEffect(fn) {
  globalThis.__engramCardTestRenderer.useEffect(fn);
}
export function useCallback(fn) {
  return globalThis.__engramCardTestRenderer.useCallback(fn);
}
`;
  const STUB_JSX_RUNTIME = `
export const Fragment = Symbol.for("react.fragment");
export function jsx(type, props) { return { type, props, key: props?.key ?? null }; }
export function jsxs(type, props) { return { type, props, key: props?.key ?? null }; }
`;

  // ---- browser surface the card's render path touches (theme detection).
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.getComputedStyle = () => ({ colorScheme: "light" });
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.document = { documentElement: { getAttribute: () => null, style: {} } };

  /**
   * Index-addressed single-owner hook renderer: enough React semantics for
   * this component (all hooks unconditional, in fixed order — which is
   * exactly what the fix must preserve). setState re-renders synchronously,
   * effects run once after mount (deps never change within a test).
   */
  function createRenderer(Comp, props) {
    const r = {
      node: undefined,
      slots: [],
      index: 0,
      pendingEffects: [],
      render() {
        r.index = 0;
        r.node = Comp(props);
      },
      useState(initial) {
        const i = r.index++;
        if (!(i in r.slots)) {
          r.slots[i] = { value: typeof initial === "function" ? initial() : initial };
        }
        const slot = r.slots[i];
        return [slot.value, (update) => {
          const next = typeof update === "function" ? update(slot.value) : update;
          if (Object.is(next, slot.value)) return;
          slot.value = next;
          r.render();
        }];
      },
      useEffect(fn) {
        const i = r.index++;
        if (!(i in r.slots)) {
          r.slots[i] = { effect: true };
          r.pendingEffects.push(fn);
        }
      },
      useCallback(fn) {
        const i = r.index++;
        if (!(i in r.slots)) r.slots[i] = { fn };
        return r.slots[i].fn;
      },
    };
    return r;
  }

  function mountCard(EngramConfigCard, props) {
    const r = createRenderer(EngramConfigCard, props);
    globalThis.__engramCardTestRenderer = r;
    r.render();
    while (r.pendingEffects.length > 0) r.pendingEffects.shift()();
    return r;
  }

  /** Scope stub: the card only touches load/getSnapshot/subscribe (+set/unset on edits). */
  function stubScope(initialSnapshot) {
    const listeners = new Set();
    let snap = initialSnapshot;
    return {
      load: async () => {},
      getSnapshot: () => snap,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set: async () => {},
      unset: async () => {},
      /** Flip the served snapshot and notify, like a real reload would. */
      __flip(next) {
        snap = next;
        for (const listener of listeners) listener();
      },
    };
  }

  const LOADING = { status: "loading", value: undefined, base: undefined, user: undefined, revision: 0, writable: false };
  const UNAVAILABLE = { status: "unavailable", value: undefined, base: undefined, user: undefined, revision: 0, writable: false, reason: "settings fetch failed: test stub" };
  const READY = { status: "ready", value: { autoCapture: true }, base: { autoCapture: true }, user: undefined, revision: 1, writable: true };

  // ---- tree helpers over the stub JSX output
  function collectText(node, out = []) {
    if (node == null) return out;
    if (typeof node === "string") { out.push(node); return out; }
    if (typeof node === "number" || typeof node === "boolean" || node === Symbol.for("react.fragment")) return out;
    if (Array.isArray(node)) { for (const child of node) collectText(child, out); return out; }
    collectText(node.props?.children, out);
    return out;
  }
  function collectStyles(node, out = []) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) return out;
    if (node.props?.style) out.push(node.props.style);
    return collectStyles(node.props?.children, out);
  }

  async function compileCard() {
    const tmp = mkdtempSync(join(tmpdir(), "engram-card-test-"));
    try {
      mkdirSync(join(tmp, "react-stub"));
      writeFileSync(join(tmp, "react-stub", "index.mjs"), STUB_REACT);
      writeFileSync(join(tmp, "react-stub", "jsx-runtime.mjs"), STUB_JSX_RUNTIME);
      const aliasReact = {
        name: "engram-test-react-stub",
        setup(build) {
          build.onResolve({ filter: /^react$/ }, () => ({ path: join(tmp, "react-stub", "index.mjs") }));
          build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: join(tmp, "react-stub", "jsx-runtime.mjs") }));
        },
      };
      const result = await esbuild.build({
        entryPoints: [join(ROOT, "client", "src", "EngramConfigCard.tsx")],
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        jsx: "automatic",
        plugins: [aliasReact],
        write: false,
        logLevel: "warning",
      });
      const outFile = join(tmp, "card-bundle.mjs");
      writeFileSync(outFile, result.outputFiles[0].text);
      return await import(`file://${outFile}`);
    } finally {
      // Best-effort cleanup; an open ESM handle on some platforms may defer
      // removal to process exit — harmless in a test-owned temp dir.
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  test("client-card: scope unavailable renders NOTHING — no 0-height flex item for the Plugins list (issue #7)", async () => {
    const { EngramConfigCard } = await compileCard();
    const r = mountCard(EngramConfigCard, { scope: stubScope(UNAVAILABLE) });
    // The old code returned a theme-vars div wrapping a display:none card
    // root — a 0-height flex item that doubled the neighbors' gap.
    assert.equal(r.node, null, "unavailable scope must render null, not a hidden div");
  });

  test("client-card: initial loading state also renders null (no flash-in, no ghost)", async () => {
    const { EngramConfigCard } = await compileCard();
    const r = mountCard(EngramConfigCard, { scope: stubScope(LOADING) });
    assert.equal(r.node, null);
  });

  test("client-card: ready scope renders the card with no display:none anywhere in the tree", async () => {
    const { EngramConfigCard } = await compileCard();
    const r = mountCard(EngramConfigCard, { scope: stubScope(READY) });
    assert.ok(r.node && typeof r.node === "object", "ready scope must render the card");
    const text = collectText(r.node).join(" ");
    assert.match(text, /dsh-engram/, "card header names the plugin");
    for (const style of collectStyles(r.node)) {
      assert.notEqual(style.display, "none", "no node in the ready card may hide via display:none");
    }
  });

  test("client-card: hidden card stays subscribed — appears when the scope flips to ready, disappears when it flips away", async () => {
    const { EngramConfigCard } = await compileCard();
    const scope = stubScope(UNAVAILABLE);
    const r = mountCard(EngramConfigCard, { scope });
    assert.equal(r.node, null);
    scope.__flip(READY);
    assert.ok(r.node && typeof r.node === "object", "card must appear once the scope turns ready (subscription alive across the null render)");
    scope.__flip(UNAVAILABLE);
    assert.equal(r.node, null, "card must vanish again without leaving a hidden root");
  });

  test("client-card: unavailable scope leaves a console breadcrumb with the reason", async () => {
    const { EngramConfigCard } = await compileCard();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
    try {
      mountCard(EngramConfigCard, { scope: stubScope(UNAVAILABLE) });
      const scope = stubScope(READY);
      const r = mountCard(EngramConfigCard, { scope });
      scope.__flip(UNAVAILABLE);
      assert.equal(r.node, null);
    } finally {
      console.warn = originalWarn;
    }
    const breadcrumb = warnings.find((w) => w.includes("settings scope unavailable"));
    assert.ok(breadcrumb, "an unavailable scope must warn exactly once per failed load");
    assert.match(breadcrumb, /settings fetch failed: test stub/, "the breadcrumb carries the scope's reason");
  });
}
