/**
 * dsh-engram: real typecheck for client/src (replaces the old `echo ok`).
 *
 * Resolves tsc + @types/react(@dom) from the harness checkout via
 * client/harness.mjs (env DSH_CHECKOUT overrides), writes a generated
 * tsconfig `client/tsconfig.build.json` that maps react/react-dom onto the
 * resolved @types packages, then runs `tsc --noEmit -p`.
 *
 * Fails non-zero on any type error — wire into CI/pre-publish.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reactDomTypesPkg,
  reactTypesPkg,
  typescriptPkg,
} from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const ts = typescriptPkg();
const reactTypes = reactTypesPkg();
const reactDomTypes = reactDomTypesPkg();

if (ts === null || reactTypes === null || reactDomTypes === null) {
  const missing = [
    ts === null ? "typescript" : null,
    reactTypes === null ? "@types/react" : null,
    reactDomTypes === null ? "@types/react-dom" : null,
  ].filter(Boolean);
  console.error(
    `[dsh-engram typecheck] missing from the harness pnpm store: ${missing.join(", ")}. ` +
      "Set DSH_CHECKOUT to a DeepSeek Harness checkout.",
  );
  process.exit(1);
}

// Generated overlay: extends the committed base tsconfig and maps the react
// family onto the discovered @types packages. Committed base stays machine-free;
// this file is ephemeral (gitignored).
const generated = {
  extends: "./tsconfig.json",
  compilerOptions: {
    // Absolute path values — TS 4.1+ resolves `paths` without `baseUrl`.
    paths: {
      "react": [reactTypes],
      "react/jsx-runtime": [join(reactTypes, "jsx-runtime")],
      "react/jsx-dev-runtime": [join(reactTypes, "jsx-dev-runtime")],
      "react-dom": [reactDomTypes],
      "react-dom/client": [join(reactDomTypes, "client")],
    },
  },
};

const genPath = join(HERE, "tsconfig.build.json");
mkdirSync(HERE, { recursive: true });
writeFileSync(genPath, `${JSON.stringify(generated, null, 2)}\n`);

const tscBin = join(ts, "bin", "tsc");
if (!existsSync(tscBin)) {
  console.error(`[dsh-engram typecheck] tsc not found at ${tscBin}`);
  process.exit(1);
}

const res = spawnSync(process.execPath, [tscBin, "-p", genPath], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
