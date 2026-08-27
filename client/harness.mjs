/**
 * dsh-engram dev toolchain resolver — locate the harness checkout and its
 * pnpm-store packages (esbuild / typescript / @types/react) for the client
 * build and typecheck.
 *
 * The external repo has none of these as dependencies: esbuild and typescript
 * live in the DeepSeek Harness checkout's pnpm virtual store, and @types/react
 * is only needed at typecheck time. Resolution order:
 *
 *   1. `$DSH_CHECKOUT` — the root of a harness checkout (what the plugin
 *      scaffold's build.sh already uses).
 *   2. Repo-adjacent `../deepseek-harness` (the conventional sibling layout).
 *   3. The legacy absolute checkout this repo was born next to (last resort —
 *      kept so an unset env still works on the original machine).
 *
 * The pnpm store can hold several esbuild/typescript versions (peer-dep
 * installs); the newest match wins.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of this repo's root (parent of client/). */
export const REPO_ROOT = resolve(HERE, "..");

function tryResolve(candidates) {
  for (const p of candidates) if (p && existsSync(p)) return p;
  return null;
}

/** Root of a harness checkout, or null. */
export function findHarnessRoot() {
  const env = process.env.DSH_CHECKOUT?.trim();
  if (env) return env;
  return tryResolve([
    resolve(HERE, "..", "..", "deepseek-harness"),
    "/d1/chuxiong/code/deepseek-harness",
  ]);
}

/**
 * Find a package in the harness pnpm virtual store.
 * @param {string} storeDir - `<harness>/node_modules/.pnpm`
 * @param {string} name - store dir prefix, e.g. `"esbuild"` or `"@types+react"`.
 * @returns {string|null} the package dir (contains package.json), or null.
 */
export function findInStore(storeDir, name) {
  if (!existsSync(storeDir)) return null;
  let entries;
  try {
    entries = readdirSync(storeDir);
  } catch {
    return null;
  }
  const matches = entries
    .filter((e) => e.startsWith(`${name}@`))
    // Newest version suffix first; ties stay stable (localeCompare).
    .sort((a, b) => b.localeCompare(a, "en"));
  for (const entry of matches) {
    const pkg = resolve(storeDir, entry, "node_modules", name.replace("+", "/"));
    if (existsSync(join(pkg, "package.json"))) return pkg;
  }
  return null;
}

function storeDir() {
  const root = findHarnessRoot();
  return root === null ? null : join(root, "node_modules", ".pnpm");
}

const LOCAL_NODE_MODULES = resolve(REPO_ROOT, "node_modules");

/** Package dir containing the `esbuild` binary/module (harness store first,
 *  repo-local node_modules as fallback), or null. */
export function esbuildPkg() {
  const fromStore = findInStore(storeDir(), "esbuild");
  if (fromStore !== null) return fromStore;
  return tryResolve([join(LOCAL_NODE_MODULES, "esbuild")]);
}

/** Package dir containing `bin/tsc` (harness store first, repo-local
 *  node_modules as fallback), or null. */
export function typescriptPkg() {
  const fromStore = findInStore(storeDir(), "typescript");
  if (fromStore !== null) return fromStore;
  return tryResolve([join(LOCAL_NODE_MODULES, "typescript")]);
}

/** @types/react package dir for typecheck path-mapping, or null. */
export function reactTypesPkg() {
  const fromStore = findInStore(storeDir(), "@types+react");
  if (fromStore !== null) return fromStore;
  return tryResolve([join(LOCAL_NODE_MODULES, "@types", "react")]);
}

/** @types/react-dom package dir for typecheck path-mapping, or null. */
export function reactDomTypesPkg() {
  const fromStore = findInStore(storeDir(), "@types+react-dom");
  if (fromStore !== null) return fromStore;
  return tryResolve([join(LOCAL_NODE_MODULES, "@types", "react-dom")]);
}
