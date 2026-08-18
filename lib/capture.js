/**
 * dsh-loom: zero-LLM auto-capture from tool results.
 *
 * Watches `tools/result` (the DSH-native equivalent of pi-loom's PostToolUse
 * hook) and extracts meaningful events by pure pattern matching on tool name +
 * arguments. No model call, no embeddings — just deterministic extractors,
 * in-memory rate limiting, and exact-duplicate dedup at the store layer.
 *
 * Extractors (default on):
 *   - git operations via bash (commit / merge / rebase / branch / push /
 *     tag / cherry-pick / stash)
 *   - writes/edits to significant config & doc paths
 *   - repeated tool errors (error signal, deduped by message)
 * pi-loom's own insight: one file edit is noise; accumulated edits and rare
 * git milestones are signal. Low-signal entries stay out of the [LOOM] index
 * until they accumulate recall hits.
 */

import { workspaceKey as workspaceKeyOf } from "./util.js";

const GIT_OPS = [
  { pattern: /\bgit\s+commit\b/, text: (cmd) => gitSubject(cmd) },
  { pattern: /\bgit\s+merge\b/, text: (cmd) => `git merge: ${headLine(cmd)}` },
  { pattern: /\bgit\s+rebase\b/, text: (cmd) => `git rebase: ${headLine(cmd)}` },
  { pattern: /\bgit\s+cherry-pick\b/, text: (cmd) => `git cherry-pick: ${headLine(cmd)}` },
  { pattern: /\bgit\s+tag\b/, text: (cmd) => `git tag: ${headLine(cmd)}` },
  { pattern: /\bgit\s+checkout\s+-b\s+(\S+)/, text: (_cmd, m) => `git branch created: ${m[1]}` },
  { pattern: /\bgit\s+push\b/, text: (cmd) => `git push: ${headLine(cmd)}` },
  { pattern: /\bgit\s+stash\b/, text: (cmd) => `git stash: ${headLine(cmd)}` },
];

/** Extract `-m "subject"` (or -m 'subject') from a commit command. */
function gitSubject(cmd) {
  const m = cmd.match(/-m\s+["']([^"']{0,64})["']/i);
  if (m) return `git commit: ${m[1]}`;
  return `git commit: ${headLine(cmd)}`;
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
 */
export function makeCaptureHandler(store, config, log) {
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
      const text = extractGit(name, args.command);
      let entry = null;

      if (text !== null) {
        const matched = text;
        entry = { kind: "decision", text: matched, signal: 0.6, tags: ["git", "auto-captured"] };
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
        return op.text(command, m) ?? null;
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
