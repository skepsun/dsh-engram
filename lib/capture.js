/**
 * dsh-loom: zero-LLM auto-capture from tool results.
 *
 * Watches `tools/result` (the DSH-native equivalent of pi-loom's PostToolUse
 * hook) and extracts meaningful events by pure pattern matching on tool name +
 * arguments. No model call, no embeddings — just deterministic extractors,
 * in-memory rate limiting, and exact-duplicate dedup at the store layer.
 *
 * Extractors (default on):
 *   - git milestones via bash (commit with an -m subject / merge / rebase /
 *     branch / tag / cherry-pick). Pure plumbing (`push`, `stash`, `status`)
 *     is deliberately NOT captured: those are operational echoes, not lasting
 *     decisions, and would only drown the memory pool and the [LOOM] index.
 *   - writes/edits to significant config & doc paths
 *   - repeated tool errors (error signal, deduped by message)
 * pi-loom's own insight: one file edit is noise; accumulated edits and rare
 * git milestones are signal. Low-signal entries stay out of the [LOOM] index
 * until they accumulate recall hits.
 */

import { workspaceKey as workspaceKeyOf } from "./util.js";

const GIT_MILESTONE_SIGNAL = 0.5;
const GIT_COMMIT_SIGNAL = 0.55;

/** Git operations that carry lasting meaning (milestones). */
const GIT_OPS = [
  // commit: only with an explicit -m subject — that's the semantic content.
  { kind: "commit", pattern: /\bgit\s+commit\b/, text: (_cmd) => gitSubject(_cmd) },
  { kind: "milestone", pattern: /\bgit\s+merge\b/, text: (cmd) => `git merge: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+rebase\b/, text: (cmd) => `git rebase: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+cherry-pick\b/, text: (cmd) => `git cherry-pick: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+tag\b/, text: (cmd) => `git tag: ${headLine(cmd)}` },
  { kind: "milestone", pattern: /\bgit\s+checkout\s+-b\s+(\S+)/, text: (_cmd, m) => `git branch created: ${m[1]}` },
];

/**
 * Extract the `-m "subject"` (or -m 'subject') from a commit command.
 * Returns null when there is no written commit message — a `git commit` run
 * via an editor, `--amend`, or an un-messaged commit is an operational echo,
 * not a memory. (The --amend/-a case for an already-reworded subject still
 * carries its own -m, so it keeps working; silent commits are dropped.)
 */
function gitSubject(cmd) {
  const m = cmd.match(/-m\s+["']([^"']{0,64})["']/i);
  if (m) return `git commit: ${m[1]}`;
  return null;
}

function headLine(cmd) {
  return String(cmd).replace(/\s*\n+\s*/g, " ").trim().slice(0, 64);
}

/** Paths where a write is significant enough to remember (mirrors pi-loom). */
const SIGNIFICANT_PATH = [
  /(^|\/)(AGENTS|CLAUDE|README|CHANGELOG|CONTRIBUTING)\.md$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)tsconfig.*\.json$/i,
  /(^|\/)biome\.json$/i,
  /(^|\/)Dockerfile$/i,
  /(^|\/)\.esr/i,
  /(^|\/)\.loom/i,
  /(^|\/)\.pi-loom/i,
  /docs\/.*\.(md|rst)$/i,
];

const EDIT_TOOLS = new Set(["write", "str_replace_editor", "edit"]);
const READ_TOOLS = new Set(["read"]);
/** Never capture our own noise or the explicit memory tools. */
const OWN_TOOLS = new Set(["loom_store", "loom_recall", "loom_detail", "esr_task", "esr_close", "esr_link"]);

/**
 * Build the tools/result listener. `store` is the opened loom domain handle;
 * `config.autoCapture*` control rate. Returns a handler (exec, result) => void
 * (fire-and-forget — never blocks the tool pipeline, never throws).
 * `stats` (optional) is a mutable {total, git, file, error} counter the GUI
 * overview reads for capture observability.
 */
export function makeCaptureHandler(store, config, log, stats) {
  const recent = new Set();
  const perSession = new Map(); // sessionId -> count, to bound captures
  let captures = 0;

  return (exec, result) => {
    try {
      const name = String(exec?.name ?? "").toLowerCase();
      if (name.length === 0 || OWN_TOOLS.has(name)) return;
      const agent = exec?.agent;
      if (agent === void 0) return;
      const cwd = agent.session?.header?.cwd;
      const sessionId = agent.session?.id;
      if (cwd === void 0 || cwd.length === 0 || sessionId === void 0) return;

      // per-session rate limit
      const used = perSession.get(sessionId) ?? 0;
      if (used >= config.autoCapturePerSession) return;
      perSession.set(sessionId, used + 1);

      if (captures >= (config.autoCaptureGlobalCap ?? 500)) return;
      captures += 1;

      const args = (exec.arguments ?? {});
      const git = extractGit(name, args.command);
      let entry = null;

      if (git !== null) {
        entry = { kind: "decision", text: git.text, signal: git.signal, tags: git.tags };
      } else if (EDIT_TOOLS.has(name)) {
        const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
        if (path.length > 0 && SIGNIFICANT_PATH.some((re) => re.test(path))) {
          entry = { kind: "fact", text: `Edited ${path}`, signal: 0.3, tags: ["file", "edit", "auto-captured", `dir:${dirOf(path)}`] };
        }
      } else if (READ_TOOLS.has(name)) {
        const path = String(args.path ?? args.file_path ?? args.filePath ?? "");
        if (path.length > 0 && /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(path)) {
          entry = { kind: "fact", text: `Read ${path}`, signal: 0.3, tags: ["file", "read", "config", "auto-captured"] };
        }
      } else if (result?.isError === true) {
        const msg = errorHead(result);
        if (msg !== null) {
          entry = { kind: "error", text: `${name} failed: ${msg}`, signal: 0.25, tags: ["error", "auto-captured"] };
        }
      }

      if (entry === null) return;
      if (stats) {
        stats.total += 1;
        if (entry.kind === "decision") stats.git += 1;
        else if (entry.kind === "error") stats.error += 1;
        else stats.file += 1;
      }

      // exact-duplicate guard across the recent window (store re-dedups by hash anyway)
      const key = `${entry.kind}|${entry.text}`;
      if (recent.has(key)) return;
      recent.add(key);
      if (recent.size > 500) {
        const first = recent.values().next().value;
        recent.delete(first);
      }

      void store
        .storeMemory(
          {
            workspace: workspaceKeyOf(cwd),
            kind: entry.kind,
            text: entry.text,
            tags: entry.tags,
            signal: entry.signal,
            sessionId,
            seq: agent.session.events?.length ?? 0,
          },
          config,
        )
        .then(() => {})
        .catch((error) => log?.warn?.(`loom auto-capture failed: ${String(error)}`));
    } catch (error) {
      // fully contained — a capture bug must never disturb the tool pipeline
      log?.warn?.(`loom auto-capture threw: ${String(error)}`);
    }
  };
}

function extractGit(name, command) {
  if (name !== "bash") return null;
  if (typeof command !== "string" || command.length === 0) return null;
  for (const op of GIT_OPS) {
    const m = command.match(op.pattern);
    if (m) {
      try {
        const text = op.text(command, m);
        if (text === null) return null; // git commit without an -m subject: drop
        return {
          text,
          signal: op.kind === "commit" ? GIT_COMMIT_SIGNAL : GIT_MILESTONE_SIGNAL,
          tags: ["git", "auto-captured", op.kind],
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function errorHead(result) {
  // canonical value or rendered content
  const value = result?.value;
  if (typeof value === "string" && value.length > 0) return value.slice(0, 80);
  if (value !== null && typeof value === "object") {
    const first = value.error ?? value.stderr ?? value.message ?? value.stdout;
    if (typeof first === "string" && first.length > 0) return first.slice(0, 80);
  }
  const content = result?.content;
  if (Array.isArray(content) && content.length > 0) {
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) {
        return block.text.slice(0, 80);
      }
    }
  }
  return null;
}

function dirOf(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : ".";
}
