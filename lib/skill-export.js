/**
 * v0.8-B: export evidence-backed procedures as standard DSH Skills.
 *
 * Why this exists: the [ENGRAM] index line is a prompt hint — it disappears when
 * a session compacts and it never leaves this machine's memory store. A DSH
 * Skill is a different surface: the host discovers it from `.dsh/skills`,
 * advertises it in the session catalog, and any agent (or subagent) can load the
 * FULL text on demand. So a procedure that has proven itself 3 times deserves to
 * exist as a real artifact, not just a line of recalled text.
 *
 * The contract with the host is verified, not assumed
 * (`@deepseek-ai/dsh-skill-filesystem`):
 *   - roots: `<project>/.dsh/skills` (rank 100), `<project>/.agents/skills`,
 *     `$DSH_HOME/skills`, `$AGENTS_HOME/skills`;
 *   - a skill is a DIRECTORY containing `SKILL.md` (or a flat `*.md`);
 *   - frontmatter MUST carry `name` and `description`, `name` matching
 *     /^[a-z0-9]+(?:-[a-z0-9]+)*$/; `whenToUse` and `disable-model-invocation` /
 *     `user-invocable` are optional.
 *
 * Two safety rules, because this module writes into a directory the host reads:
 *   1. only files carrying SKILL_MARKER are ever rewritten or deleted — a
 *      hand-written skill in the same root is never touched;
 *   2. nothing is exported until it passes the v0.8-A evidence gate
 *      (≥3 verified successes, verified within 14 days, not invalidated).
 */
import fs from "node:fs";
import path from "node:path";

import { isProvenProcedure, procedureInvalidated } from "./index-block.js";
import { fmtDate, shortId } from "./util.js";

/** Written into every generated SKILL.md; the ownership marker for safe cleanup. */
export const SKILL_MARKER = "<!-- generated-by: dsh-engram skill-export -->";

/** Where DSH's filesystem provider looks, highest precedence first. */
export function defaultSkillDir(projectRoot) {
  return path.join(projectRoot, ".dsh", "skills");
}

/** Fold arbitrary text into the host's kebab-case skill-name grammar. */
export function kebab(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * `cmd:npm_test` → `npm-test`; the `cmd:` prefix is dropped because every
 * exported skill is a command fix. Falls back to the memory id so the slug is
 * never empty (an empty slug would produce an invalid skill name).
 */
export function skillSlug(row) {
  const tag = (row?.tags ?? []).find((t) => typeof t === "string" && t.startsWith("cmd:"));
  const base = kebab(tag !== undefined ? tag.slice(4) : row?.id ?? "");
  const trimmed = base.slice(0, 48).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : `mem-${shortId(row?.id ?? "0")}`;
}

/** Host-legal skill name (regex from @deepseek-ai/dsh-skill). */
export function skillName(row) {
  return `engram-fix-${skillSlug(row)}`;
}

/** The command a procedure is about: its `cmd:` tag decoded, else the row text. */
export function procedureCommand(row) {
  const tag = (row?.tags ?? []).find((t) => typeof t === "string" && t.startsWith("cmd:"));
  if (tag === undefined) return String(row?.text ?? "");
  return tag.slice(4).replace(/_/g, " ");
}

/** One line for the host catalog: what it is, and how well it is attested. */
export function skillDescription(row, now = Date.now()) {
  const command = procedureCommand(row);
  const count = row?.evidenceCount ?? 0;
  const verified = row?.lastVerifiedAt !== null && row?.lastVerifiedAt !== undefined
    ? fmtDate(row.lastVerifiedAt)
    : "unknown";
  return `Verified fix for \`${command}\` — held ${count}×, last verified ${verified}; engram procedure #${shortId(row?.id ?? "")}.`;
}

export function skillWhenToUse(row) {
  const command = procedureCommand(row);
  return `When \`${command}\` fails again and you want the fix that already held repeatedly on this machine.`;
}

/** Newest resolved error for the same command — the failure signature. */
export function failureSignature(rows, row) {
  const tag = (row?.tags ?? []).find((t) => typeof t === "string" && t.startsWith("cmd:"));
  if (tag === undefined) return null;
  const error = (rows ?? [])
    .filter(
      (m) =>
        m?.kind === "error" &&
        (m.tags ?? []).includes(tag) &&
        (m.tags ?? []).includes("resolved") &&
        m.id !== row.id,
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  if (error === undefined) return null;
  return String(error.text ?? "").split("\n").slice(0, 3).join("\n").slice(0, 300);
}

/** Deterministic SKILL.md for one promoted procedure. */
export function renderSkill(row, rows, { now = Date.now() } = {}) {
  const command = procedureCommand(row);
  const count = row?.evidenceCount ?? 0;
  const first = row?.createdAt ?? null;
  const last = row?.lastVerifiedAt ?? null;
  const signature = failureSignature(rows, row);
  const lines = [
    "---",
    `name: ${skillName(row)}`,
    `description: ${JSON.stringify(skillDescription(row, now))}`,
    `whenToUse: ${JSON.stringify(skillWhenToUse(row))}`,
    "---",
    "",
    SKILL_MARKER,
    `<!-- evidence: ${count} verified successes · last ${last !== null ? new Date(last).toISOString() : "unknown"} · memory ${row?.id ?? ""} -->`,
    "",
    `# Fix that holds: \`${command}\``,
    "",
    "## Evidence",
    "",
    `- verified successes: **${count}**`,
    `- first captured: ${first !== null ? new Date(first).toISOString() : "unknown"}`,
    `- last verified: ${last !== null ? new Date(last).toISOString() : "unknown"}`,
    `- engram memory: \`${row?.id ?? ""}\``,
    "",
  ];
  if (signature !== null) {
    lines.push("## The failure it closes", "", "```", signature, "```", "");
  }
  lines.push(
    "## How to use this",
    "",
    `1. Run \`${command}\` in this workspace first — the skill is evidence of a past`,
    "   success, not a guarantee of the current state.",
    "2. If it passes, the procedure still holds; nothing else to do.",
    "3. If it fails, this skill is stale: dsh-engram invalidates the underlying",
    "   procedure on that failure (its `[ENGRAM]` line disappears), so treat the",
    "   fresh error as the truth and this note as history.",
    "",
    "## Provenance",
    "",
    "Generated by `dsh-engram skill export` from the memory store. Editing this",
    "file is fine, but the next export of the same procedure rewrites it while the",
    "marker above is present.",
    "",
  );
  return lines.join("\n");
}

/**
 * Pure planning step: which skills should exist, with what content. No I/O, so
 * the rules are testable without touching a filesystem.
 */
export function planSkillExport(rows, { config, now = Date.now(), dir, approved = null, requireApproval = false }) {
  const byName = new Map();
  for (const row of rows ?? []) {
    if (row === null || typeof row !== "object") continue;
    if ((row.kind ?? "") !== "procedure") continue;
    if (row.status === "archived") continue;
    if (procedureInvalidated(row)) continue;
    if (!isProvenProcedure(row, { ...config, nowMs: now })) continue;
    if (!(row.tags ?? []).includes("auto-captured")) continue;
    // v0.8-D: writing a file the host advertises needs a human yes, not only
    // three successful runs. `approved` is the set of ids the user confirmed.
    if (requireApproval && !(approved?.has?.(row.id) ?? false)) continue;
    const name = skillName(row);
    const previous = byName.get(name);
    if (previous !== undefined && (previous.lastVerifiedAt ?? 0) >= (row.lastVerifiedAt ?? 0)) continue;
    byName.set(name, row);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, row]) => ({
      name,
      slug: skillSlug(row),
      memoryId: row.id,
      content: renderSkill(row, rows, { now }),
      // Directory name is irrelevant to the host; using the skill name keeps
      // the tree readable and the sweep comparison trivial.
      // `dir` is optional: the GUI asks what WOULD be written without a target.
      dir: typeof dir === "string" && dir.length > 0 ? path.join(dir, name) : null,
    }));
}

/**
 * Apply a plan to disk.
 *
 * - writes only when the bytes differ (repeated exports are no-ops, so the
 *   host's watcher does not churn);
 * - refuses to touch a SKILL.md without SKILL_MARKER (human-owned);
 * - deletes generated SKILL.md files whose procedure no longer qualifies —
 *   a broken procedure must not keep advertising itself as a skill.
 */
export function exportSkills(rows, { config, dir, now = Date.now(), dryRun = false, approved = null, requireApproval = false } = {}) {
  const plan = planSkillExport(rows, { config, now, dir, approved, requireApproval });
  const report = { written: [], unchanged: [], removed: [], skipped: [], pending: [], errors: [] };
  // What an approval prompt would offer: proven, auto-captured, not yet approved.
  if (requireApproval) {
    for (const row of rows ?? []) {
      if (row === null || typeof row !== "object") continue;
      if ((row.kind ?? "") !== "procedure") continue;
      if (row.status === "archived" || procedureInvalidated(row)) continue;
      if (!isProvenProcedure(row, { ...config, nowMs: now })) continue;
      if (!(row.tags ?? []).includes("auto-captured")) continue;
      if (approved?.has?.(row.id) ?? false) continue;
      report.pending.push({ id: row.id, name: skillName(row), description: skillDescription(row, now) });
    }
  }
  const wanted = new Set(plan.map((skill) => skill.name));

  if (!dryRun) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      report.errors.push(`mkdir ${dir}: ${String(error)}`);
      return report;
    }
  }

  for (const skill of plan) {
    const file = path.join(skill.dir, "SKILL.md");
    let existing = null;
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      existing = null;
    }
    if (existing !== null && !existing.includes(SKILL_MARKER)) {
      report.skipped.push(`${skill.name} (human-owned SKILL.md at ${file})`);
      continue;
    }
    if (existing === skill.content) {
      report.unchanged.push(skill.name);
      continue;
    }
    if (!dryRun) {
      try {
        fs.mkdirSync(skill.dir, { recursive: true });
        fs.writeFileSync(file, skill.content, "utf8");
      } catch (error) {
        report.errors.push(`${skill.name}: ${String(error)}`);
        continue;
      }
    }
    report.written.push(skill.name);
  }

  // Stale sweep: only our own marker files, only when their skill is not wanted
  // any more (invalidated, expired, or the row was archived).
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    let content = null;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!content.includes(SKILL_MARKER)) continue;
    const name = /^name:\s*(.+)$/m.exec(content)?.[1]?.trim();
    if (name !== undefined && wanted.has(name)) continue;
    if (!dryRun) {
      try {
        fs.rmSync(file);
        // Remove the directory too, but only when it holds nothing else.
        if (fs.readdirSync(path.join(dir, entry.name)).length === 0) fs.rmdirSync(path.join(dir, entry.name));
      } catch (error) {
        report.errors.push(`remove ${entry.name}: ${String(error)}`);
        continue;
      }
    }
    report.removed.push(name ?? entry.name);
  }

  return report;
}
