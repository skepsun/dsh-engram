// Oracle hardening: the agent must fix source, never the tests. This compares
// the test files against the manifest committed with the fixture and exits
// non-zero if any of them changed or disappeared.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts", "manifest.json"), "utf8"));
for (const [file, expected] of Object.entries(manifest)) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    console.error(`guard: ${file} is missing — the tests are the oracle, do not delete them`);
    process.exit(1);
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  if (actual !== expected) {
    console.error(`guard: ${file} was modified — fix src/, not the tests`);
    process.exit(1);
  }
}
