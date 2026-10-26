/**
 * v0.8-B: exporting evidence-backed procedures as DSH Skills.
 *
 * Pure planning + disk application, no host needed here — the host seam itself
 * is proven end-to-end by `npm run skill:check` (it imports DSH's own
 * skill-filesystem provider and lists the exported skill).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SKILL_MARKER,
  exportSkills,
  kebab,
  planSkillExport,
  skillDescription,
  skillName,
  skillSlug,
} from "../lib/skill-export.js";

const CONFIG = { procedureMinEvidence: 3, procedureMaxAgeDays: 14, promoteHits: 3 };
const DAY = 24 * 60 * 60 * 1000;

function row(id, overrides = {}) {
  const now = Date.now();
  return {
    id,
    workspace: "/ws",
    kind: "procedure",
    text: "fixed: npm test — 1 earlier failing run now succeed",
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

const tmpSkillsDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "engram-skill-test-"));

test("skill names satisfy the host grammar (/^[a-z0-9]+(-[a-z0-9]+)*$/)", () => {
  assert.equal(kebab("NPM   RUN: build --watch!"), "npm-run-build-watch");
  assert.equal(kebab("中文"), "");
  assert.equal(skillSlug(row("x", { tags: ["cmd:npm_run_test"] })), "npm-run-test");
  const weird = skillName(row("3f8a9c11-aaaa", { tags: ["procedure"] }));
  assert.match(weird, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("only promoted, unexpired, non-invalidated auto-captures are planned", () => {
  const now = Date.now();
  const rows = [
    row("ok"),
    row("n1", { evidenceCount: 1 }),
    row("old", { lastVerifiedAt: now - 30 * DAY }),
    row("bad", { lastFailedAt: now, invalidatedBy: "e1" }),
    row("manual", { tags: ["procedure", "release"] }),
    row("archived", { status: "archived" }),
  ];
  const plan = planSkillExport(rows, { config: CONFIG, now, dir: "/skills" });
  assert.deepEqual(plan.map((s) => s.memoryId), ["ok"]);
});

test("a manual procedure with hits but no evidence is not exported as a skill", () => {
  const plan = planSkillExport([row("h", { tags: ["procedure", "cmd:npm_test"], hits: 5, evidenceCount: 0, lastVerifiedAt: null })], {
    config: CONFIG,
    dir: "/skills",
  });
  assert.equal(plan.length, 0, "hits are recall, not verification — not enough for an artifact");
});

test("frontmatter carries name/description/whenToUse and the ownership marker", () => {
  const [skill] = planSkillExport([row("ok")], { config: CONFIG, dir: "/skills" });
  assert.ok(skill.content.startsWith("---\nname: engram-fix-npm-test\n"));
  assert.match(skill.content, /\ndescription: "Verified fix for `npm test`/);
  assert.match(skill.content, /\nwhenToUse: "When `npm test` fails again/);
  assert.ok(skill.content.includes(SKILL_MARKER));
  assert.match(skillDescription(row("ok")), /held 3×/);
});

test("the failure signature comes from the newest resolved error for the same command", () => {
  const rows = [
    row("ok"),
    { ...row("e1"), kind: "error", text: "older failure", tags: ["error", "cmd:npm_test", "resolved"], createdAt: 1 },
    { ...row("e2"), kind: "error", text: "not ok 3 - recall ranks recency", tags: ["error", "cmd:npm_test", "resolved"], createdAt: 5 },
    { ...row("e3"), kind: "error", text: "unresolved", tags: ["error", "cmd:npm_test"], createdAt: 9 },
  ];
  const [skill] = planSkillExport(rows, { config: CONFIG, dir: "/skills" });
  assert.ok(skill.content.includes("## The failure it closes"));
  assert.ok(skill.content.includes("recall ranks recency"));
  assert.ok(!skill.content.includes("unresolved"), "unresolved errors are not the signature");
});

test("disk export: writes once, is idempotent, never touches a human SKILL.md", () => {
  const dir = tmpSkillsDir();
  const human = path.join(dir, "mine");
  fs.mkdirSync(human, { recursive: true });
  fs.writeFileSync(path.join(human, "SKILL.md"), "---\nname: mine\ndescription: hand made\n---\nbody\n");

  // One row, reused: content is a pure function of the memory, so a re-export
  // of the SAME row must be a byte-for-byte no-op.
  const ok = row("ok");
  const first = exportSkills([ok], { config: CONFIG, dir });
  assert.deepEqual(first.written, ["engram-fix-npm-test"]);
  assert.ok(fs.readFileSync(path.join(dir, "engram-fix-npm-test", "SKILL.md"), "utf8").includes(SKILL_MARKER));

  const second = exportSkills([ok], { config: CONFIG, dir });
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.unchanged, ["engram-fix-npm-test"]);

  // Claim the generated file as human-owned: the exporter must leave it alone.
  const generated = path.join(dir, "engram-fix-npm-test", "SKILL.md");
  fs.writeFileSync(generated, "---\nname: engram-fix-npm-test\ndescription: edited by hand\n---\ncustom\n");
  const third = exportSkills([{ ...ok, evidenceCount: 9 }], { config: CONFIG, dir });
  assert.equal(third.skipped.length, 1);
  assert.ok(fs.readFileSync(generated, "utf8").includes("edited by hand"));

  assert.equal(fs.readFileSync(path.join(human, "SKILL.md"), "utf8").includes("hand made"), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("disk export: a procedure that stops qualifying loses its skill file", () => {
  const dir = tmpSkillsDir();
  const ok = row("ok");
  exportSkills([ok], { config: CONFIG, dir });
  assert.ok(fs.existsSync(path.join(dir, "engram-fix-npm-test", "SKILL.md")));

  const report = exportSkills([{ ...ok, lastFailedAt: Date.now(), invalidatedBy: "e9" }], { config: CONFIG, dir });
  assert.deepEqual(report.removed, ["engram-fix-npm-test"]);
  assert.ok(!fs.existsSync(path.join(dir, "engram-fix-npm-test")), "empty directory is cleaned up too");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dry-run reports the plan without touching disk", () => {
  const dir = path.join(tmpSkillsDir(), "nested");
  const report = exportSkills([row("ok")], { config: CONFIG, dir, dryRun: true });
  assert.deepEqual(report.written, ["engram-fix-npm-test"]);
  assert.equal(fs.existsSync(dir), false);
});
