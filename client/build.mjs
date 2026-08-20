/**
 * dsh-engram: client bundle build — produce `lib/client.js` in the client-module
 * loader's lazy-CJS factory format.
 *
 * The loader (`window.__ModuleLoader__.load({ id, factory })`) only registers
 * the factory; the browser materializes it by calling `factory(require)`, and
 * the loader's own `require` resolves `react` / `react-dom/client` from its
 * registry. So we bundle our TSX to CJS with those two marked external, then
 * wrap the esbuild output in the factory closure (mirroring the format the
 * shipped bundles use).
 *
 * This is a DEV tool for the external dsh-engram repo; it resolves esbuild from
 * the harness checkout (the only place it is installed locally).
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// esbuild is a transitive dep of the harness, stored in its pnpm store —
// anchor the require at its virtual-store entry rather than the root.
const require = createRequire(
  "/d1/chuxiong/code/deepseek-harness/node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/package.json",
);
const esbuild = require("esbuild");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ID = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;

const result = await esbuild.build({
  entryPoints: [resolve(HERE, "src/entry.tsx")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  // Automatic JSX runtime, matching the harness platform: the loader's module
  // table (packages/client/web/src/platform.ts) resolves react/jsx-runtime,
  // so JSX compiles to require("react/jsx-runtime").jsx(...) instead of bare
  // React.createElement with an undefined `React` (classic mode left `React`
  // unresolved because no source file imports it as a value).
  jsx: "automatic",
  external: ["react", "react-dom/client", "react/jsx-runtime"],
  write: false,
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

const code = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
\t\treturn module.exports;
\t}
});
`;

mkdirSync(resolve(ROOT, "lib"), { recursive: true });
const outPath = resolve(ROOT, "lib/client.js");
writeFileSync(outPath, wrapped);
console.log(`wrote ${outPath} (${wrapped.length} bytes)`);
