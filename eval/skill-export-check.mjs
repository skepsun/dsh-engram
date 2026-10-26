#!/usr/bin/env node
/**
 * v0.8-B seam check: does DSH actually LOAD what `skill export` writes?
 *
 * The claim "exported procedures are loadable skills" is a claim about the host,
 * so the check runs the host's own discovery code — not a copy of it:
 *
 *   @deepseek-ai/dsh-skill-filesystem  →  FileSystemSkillProvider.list({cwd})
 *                                        → .get(candidate)   (full body)
 *
 * A temp project (with a `.git` marker, which is how the provider finds the
 * project root) is seeded with:
 *   - one real promoted procedure  → must appear in the catalog;
 *   - one hand-written skill       → must survive untouched (no marker);
 *   - one stale generated skill    → must be swept by the next export.
 *
 *   node eval/skill-export-check.mjs [--json]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { SKILL_MARKER, exportSkills, skillName } from "../lib/skill-export.js";

const CONFIG = { procedureMinEvidence: 3, procedureMaxAgeDays: 14, promoteHits: 3, indexMaxSignal: 1 };
const DAY = 24 * 60 * 60 * 1000;

/** Resolve the installed DSH package root from the `dsh` binary itself. */
function dshPackageRoot() {
  if (process.env.DSH_PACKAGE_ROOT !== undefined) return process.env.DSH_PACKAGE_ROOT;
  const bin = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
  // <root>/lib/bin.js → <root>
  return path.dirname(path.dirname(fs.realpathSync(bin)));
}

const DSH_SKILL_FS = path.join(
  dshPackageRoot(),
  "node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js",
);

function fakeCtx() {
  const registrations = [];
  const ctx = {
    skills: { registerProvider: (factory) => registrations.push(factory) },
    effect: () => {},
    on: () => {},
    get: () => undefined,
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
  };
  return { ctx, registrations };
}

function row(id, overrides = {}) {
  const now = Date.now();
  return {
    id,
    workspace: "/tmp/ws",
    kind: "procedure",
    text: "fixed: npm test — 2 earlier failing runs now succeed",
    tags: ["procedure", "auto-captured", "fix", "cmd:npm_test"],
    status: "active",
    signal: 0.45,
    hits: 0,
    createdAt: now - 3 * DAY,
    updatedAt: now - 2 * DAY,
    evidenceCount: 3,
    lastVerifiedAt: now - 2 * DAY,
    lastFailedAt: null,
    invalidatedBy: null,
    ...overrides,
  };
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), "engram-skill-"));
fs.mkdirSync(path.join(project, ".git"), { recursive: true });
const skillsDir = path.join(project, ".dsh", "skills");

const promoted = row("mem-promoted");
const rows = [
  promoted,
  { ...row("mem-err"), kind: "error", text: "bash failed (exit 1):\nnot ok 1 - recall ranks recency", tags: ["error", "auto-captured", "cmd:npm_test", "resolved"], evidenceCount: 0, lastVerifiedAt: null },
  // Unproven (n=1) and invalidated rows must NOT be exported.
  row("mem-unproven", { evidenceCount: 1 }),
  row("mem-invalid", { lastFailedAt: Date.now(), invalidatedBy: "mem-err" }),
];

// A hand-written skill in the same root: the export must not touch it.
const humanDir = path.join(skillsDir, "hand-written");
fs.mkdirSync(humanDir, { recursive: true });
fs.writeFileSync(path.join(humanDir, "SKILL.md"), "---\nname: hand-written\ndescription: written by a human\n---\n\nkeep me\n");

// A generated skill whose procedure no longer qualifies: next export must sweep it.
const staleDir = path.join(skillsDir, "engram-fix-gone");
fs.mkdirSync(staleDir, { recursive: true });
fs.writeFileSync(
  path.join(staleDir, "SKILL.md"),
  `---\nname: engram-fix-gone\ndescription: stale\n---\n\n${SKILL_MARKER}\n`,
);

const first = exportSkills(rows, { config: CONFIG, dir: skillsDir });
const second = exportSkills(rows, { config: CONFIG, dir: skillsDir });

// v0.8-D: the approval gate. Same evidence, no approval → nothing written; the
// row is reported as pending instead, so the user knows what to approve.
const gatedDir = path.join(project, ".dsh", "skills-gated");
const gated = exportSkills(rows, { config: CONFIG, dir: gatedDir, approved: new Set(), requireApproval: true });
const gatedFiles = fs.existsSync(gatedDir)
  ? fs.readdirSync(gatedDir).filter((name) => fs.existsSync(path.join(gatedDir, name, "SKILL.md")))
  : [];
const afterApprove = exportSkills(rows, {
  config: CONFIG,
  dir: gatedDir,
  approved: new Set([promoted.id]),
  requireApproval: true,
});
// A forced export is the audited escape hatch and must still write.
const forcedDir = path.join(project, ".dsh", "skills-forced");
const forced = exportSkills(rows, { config: CONFIG, dir: forcedDir, approved: new Set(), requireApproval: false });

const { ctx, registrations } = fakeCtx();
const mod = await import(DSH_SKILL_FS);
mod.apply(ctx, {
  providerName: "filesystem",
  includeDefaultRoots: true,
  dshHome: path.join(os.tmpdir(), "fake-dsh-home"),
  agentsHome: path.join(os.tmpdir(), "fake-agents-home"),
  watch: false,
  bundledSkillDir: undefined,
});
const provider = registrations[0]({ signal: new AbortController().signal, invalidate: () => {} });
const listed = await provider.list({ cwd: project });
const candidates = Array.isArray(listed) ? listed : listed.candidates;
const names = candidates.map((c) => c.name).sort();
const target = candidates.find((c) => c.name === skillName(promoted));
const body = target !== undefined ? await provider.get(target, {}) : undefined;

const checks = [
  ["promoted procedure is advertised by the host", names.includes(skillName(promoted))],
  ["unproven row is not exported", !names.some((n) => n.includes("unproven")) && !fs.existsSync(path.join(skillsDir, "engram-fix-unproven"))],
  ["invalidated row is not exported", !names.includes("engram-fix-invalid")],
  ["hand-written skill survives", fs.existsSync(path.join(humanDir, "SKILL.md")) && names.includes("hand-written")],
  ["stale generated skill was swept", first.removed.length === 1 && !fs.existsSync(path.join(staleDir, "SKILL.md"))],
  ["second export is a no-op", second.written.length === 0 && second.unchanged.length === 1],
  ["host parses description", typeof body?.description === "string" && body.description.includes("npm test")],
  ["host parses whenToUse", typeof body?.whenToUse === "string" && body.whenToUse.includes("npm test")],
  ["host loads the full body", typeof body?.content === "string" && body.content.includes("## Evidence")],
  ["name matches the host grammar", /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName(promoted))],
  ["model-invocable + user-invocable by default", body?.invocation?.modelInvocable === true && body?.invocation?.userInvocable === true],
  ["unapproved procedure writes no file", gatedFiles.length === 0 && gated.written.length === 0],
  ["unapproved procedure is reported as pending", gated.pending.length === 1 && gated.pending[0].id === promoted.id],
  ["approval unlocks the export", afterApprove.written.length === 1 && afterApprove.pending.length === 0],
  ["--force bypasses the gate", forced.written.length === 1],
];

const ok = checks.every(([, pass]) => pass);
const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ ok, checks: checks.map(([name, pass]) => ({ name, pass })), skillsDir, names }, null, 2));
} else {
  console.log("v0.8-B skill export seam check（用宿主自己的发现代码）");
  for (const [name, pass] of checks) console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  console.log(`\n  catalog: ${names.join(", ") || "(empty)"}`);
  console.log(`  verdict: ${ok ? "PASS" : "FAIL"}`);
}

fs.rmSync(project, { recursive: true, force: true });
process.exitCode = ok ? 0 : 1;
