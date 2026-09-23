/**
 * dsh-engram ResultPack L2 (PROPOSAL-resultpack §L2): archive pruned tool-result
 * middles + `result_recall` paged recall — the ObservationPack pattern SoL-Pi
 * mechanism ③ (load archived, keep a handle + digest on the surface, page back
 * on demand; its paired EdgeBench: bill −23.58%).
 *
 * L1 (lib/boundary-prune.js) prunes over-threshold tool results at todo/goal
 * boundaries through DSH's own deterministic `toolResultPruner`. The L1 pruned
 * middle was simply gone — the model could not reach it again. L2 makes the
 * prune lossless:
 *
 *   1. When L1 fires, we read the ORIGINAL result from the session log
 *      (`session.eventAt(originalSeq)` + `deriveEventMessage`), extract the
 *      removed middle span, redact secrets (same rules as the memory write
 *      path), and archive it to a per-callId JSON file under
 *      `~/.dsh/engram/resultpack/`.
 *   2. We append a tail handle to the pruned surface node via the host's own
 *      surface-replace protocol (append tool/result + surfaceOp replace,
 *      replay-safe): `[middle archived: result_recall(<callId>) 可取]`.
 *      The model decides whether to drill down — the same progressive
 *      disclosure philosophy as [ENGRAM] → engram_detail.
 *   3. `result_recall(callId, offset?)` returns the archived middle in paged
 *      text blocks, so a very large result is never re-materialized whole.
 *
 * Zero-LLM, deterministic, fail-contained (never throws into the session
 * pipeline); every write is atomic temp-file + rename. Retention is a simple
 * mtime sweep (`sweepExpired`), wired to the same GC cadence as memory GC.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { redactText } from "./redact.js";
import { hashText, workspaceKey as wk, truncate } from "./util.js";

/** Default page budget for result_recall (chars per page). */
export const DEFAULT_PAGE_CHARS = 4000;
/** Default retention for archived results (mtime-based sweep). */
export const DEFAULT_RETENTION_DAYS = 7;
/** Handle line appended to the pruned surface node. */
const HANDLE_PREFIX = "[middle archived: result_recall(";

/** Archived-result directory under the engram home (~/.dsh/engram/resultpack). */
export function resultPackDir(home = path.join(os.homedir(), ".dsh", "engram")) {
  return path.join(home, "resultpack");
}

/** Stable, path-safe archive id derived from the tool callId. */
export function archiveId(callId) {
  return `${hashText(String(callId))}`;
}

/** Read one archived result back (parsed), or undefined when absent/broken. */
export function readArchived(dir, callId) {
  try {
    const file = path.join(dir, `${archiveId(callId)}.json`);
    if (!fs.existsSync(file)) return void 0;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return void 0;
  }
}

/**
 * Extract the removed middle text from an original tool-result content and the
 * host pruner budgets. Mirrors host arithmetic (code-point slicing across text
 * blocks: everything between headChars and total-tailChars is the middle).
 * @param blocks - original message content (blocks with `.type`/`.text`).
 * @param headChars - pruner head budget.
 * @param tailChars - pruner tail budget.
 * @returns { removed: string, head: string, tail: string } or null when nothing removed.
 */
export function extractMiddle(blocks, headChars, tailChars) {
  if (!Array.isArray(blocks)) return null;
  const total = blocks.reduce((n, b) => (b && b.type === "text" ? n + Array.from(String(b.text)).length : n), 0);
  const removedStart = headChars;
  const removedEnd = total - tailChars;
  if (total <= removedStart + tailChars || removedEnd <= removedStart) return null;
  const removed = [];
  const head = [];
  const tail = [];
  let consumed = 0;
  for (const block of blocks) {
    if (!block || block.type !== "text") continue;
    const points = Array.from(String(block.text));
    const blockStart = consumed;
    const blockEnd = blockStart + points.length;
    const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
    head.push(points.slice(0, headEnd).join(""));
    if (tailStart > headEnd) removed.push(points.slice(headEnd, tailStart).join(""));
    tail.push(points.slice(tailStart).join(""));
    consumed = blockEnd;
  }
  return {
    removed: removed.join(""),
    head: head.join(""),
    tail: tail.join(""),
  };
}

/**
 * Archive the pruned middles from one L1 prune report, appending a tail handle
 * on each pruned surface node. Returns the count archived. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.dir archive directory
 * @param {object} opts.session the session being pruned (eventAt + deriveEventMessage)
 * @param {object} opts.report the host pruner's return `{ pruned, charsRemoved }`
 * @param {string} [opts.workspace] workspace key used on the archive metadata
 * @param {object} [opts.log]
 * @returns {number} archives written
 */
export function archivePrunedResults({ dir, session, report, workspace, log }) {
  const pruned = report?.pruned;
  if (!Array.isArray(pruned) || pruned.length === 0) return 0;
  let archived = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    log?.warn?.(`engram result-pack: archive dir unavailable: ${String(error)}`);
    return 0;
  }
  for (const item of pruned) {
    try {
      const callId = item?.callId;
      if (typeof callId !== "string" || callId.length === 0) continue;
      const original = item.originalSeq !== void 0 ? session?.eventAt?.(item.originalSeq) : void 0;
      const message = original ? session?.deriveEventMessage?.(original) : void 0;
      const blocks = message?.content;
      // Fall back to a default budget when the report lacks head/tail (the host
      // report carries charsBefore/After only; budgets default to host DEFAULTS).
      const mine = extractMiddle(blocks, item.headChars ?? 4096, item.tailChars ?? 1024);
      const removed = mine?.removed ?? "";
      if (removed.length === 0) continue;
      const record = {
        v: 1,
        callId,
        workspace: workspace ?? wk(message?.source?.workspace ?? ""),
        sessionId: item.sessionId ?? session?.id ?? null,
        originalSeq: item.originalSeq ?? null,
        createdAt: Date.now(),
        headChars: item.headChars ?? 4096,
        tailChars: item.tailChars ?? 1024,
        charsBefore: item.charsBefore ?? removed.length,
        charsAfter: item.charsAfter ?? (item.headChars ?? 4096) + (item.tailChars ?? 1024),
        head: truncate(mine?.head ?? "", 2000),
        tail: truncate(mine?.tail ?? "", 2000),
        // Redacted before persistence — the memory path's guarantee holds here.
        removed: redactText(removed),
      };
      const file = path.join(dir, `${archiveId(callId)}.json`);
      const tmp = `${file}.${hashText(String(Date.now() + Math.random()))}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
      fs.renameSync(tmp, file);
      archived += 1;
      appendHandle({ session, callId, replacementSeq: item.replacementSeq, log });
    } catch (error) {
      log?.warn?.(`engram result-pack: archive failed: ${String(error)}`);
    }
  }
  return archived;
}

/**
 * Append a `[middle archived: result_recall(callId) 可取]` tail to one pruned
 * surface node using the host's own surface-replace protocol (append a
 * tool/result +++ surfaceOp replace; replay-safe, zero-LLM). Never throws.
 */
export function appendHandle({ session, callId, replacementSeq, log }) {
  try {
    if (!session || typeof session.append !== "function") return;
    const seq = replacementSeq;
    if (seq === void 0) return;
    const node = session.eventAt?.(seq);
    if (!node || node.type !== "tool/result") return;
    const current = session.deriveEventMessage?.(node);
    if (!current) return;
    const handleText = `${HANDLE_PREFIX}${callId}) 可取]`;
    const content = Array.isArray(current.content) ? [...current.content] : [];
    // Avoid stacking duplicate handles on repeated prunes of the same node.
    if (content.some((b) => b && typeof b.text === "string" && b.text.includes(HANDLE_PREFIX))) return;
    content.push({ type: "text", text: handleText });
    const message = { ...current, content };
    session.append("tool/result", { ...node.data, message }, {
      surfaceOp: { op: "replace", startSeq: seq, endSeq: seq },
      sourceEventSeqs: [seq],
    });
  } catch (error) {
    log?.warn?.(`engram result-pack: handle append failed: ${String(error)}`);
  }
}

/**
 * Page out one archived middle. Pure + deterministic.
 * @param {object} archived parsed archive record
 * @param {number} [offset] zero-based page index
 * @param {number} [pageChars] chars per page
 * @returns {{ total, totalChars, offset, page, hasMore, text, callId }}
 */
export function pageArchived(archived, offset = 0, pageChars = DEFAULT_PAGE_CHARS) {
  const totalChars = Array.from(String(archived?.removed ?? "")).length;
  const total = Math.max(1, Math.ceil(totalChars / pageChars));
  const idx = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  const p = Math.min(idx, total - 1);
  const chars = Array.from(String(archived?.removed ?? ""));
  const text = chars.slice(p * pageChars, (p + 1) * pageChars).join("");
  return {
    callId: archived?.callId ?? null,
    total,
    totalChars,
    offset: p,
    page: p + 1,
    hasMore: p + 1 < total,
    text,
  };
}

/**
 * Sweep archives whose mtime is older than `retentionDays`. Returns deleted
 * count. Never throws.
 */
export function sweepExpired(dir, retentionDays = DEFAULT_RETENTION_DAYS) {
  let deleted = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) {
          fs.unlinkSync(file);
          deleted += 1;
        }
      } catch { /* racing removal — ignore */ }
    }
  } catch { /* unreadable dir — ignore */ }
  return deleted;
}

/**
 * The model-facing tool definition: `result_recall(callId, offset?)`.
 * Independent of the memory domain (archives live on the filesystem). Reads
 * are workspace-sandboxed by callerOf-style cwd resolution, but the archive is
 * keyed by globally-unique callId, so we just return the archive when found.
 */
export function resultRecallTool(dir, pageChars = DEFAULT_PAGE_CHARS) {
  return {
    name: "result_recall",
    description: "Retrieve an archived pruned tool-result middle by its callId (page 1 by default). The handle line inside a pruned result names the callId. Returns one page of the original middle text; paging is 0-based via offset.",
    parameters: {
      type: "object",
      properties: {
        callId: { type: "string", description: "callId from a `[middle archived: result_recall(<callId>) 可取]` handle (required)" },
        offset: { type: "number", description: "Zero-based page index to return (default 0)", minimum: 0 },
      },
      required: ["callId"],
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    execute: async (raw) => {
      const callId = typeof raw?.callId === "string" ? raw.callId.trim() : "";
      if (callId.length === 0) return "result_recall: callId is required";
      const offset = Number.isFinite(raw?.offset) ? Math.floor(raw.offset) : 0;
      const archived = readArchived(dir, callId);
      if (archived === void 0) return `result_recall: no archived middle for callId ${callId} (expired or never archived)`;
      const page = pageArchived(archived, offset, pageChars);
      const header = `result_recall ${callId} · page ${page.page}/${page.total} · ${page.totalChars} chars archived${page.hasMore ? ` · offset=${page.offset + 1} 取下一页` : ""}\n\n`;
      return header + page.text;
    },
  };
}
