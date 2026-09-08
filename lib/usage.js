/**
 * dsh-engram: agent-behaviour observability — computed ON DEMAND from the
 * session log stream, nothing recorded per tool call.
 *
 * Assessment P3 (2026-08-22): the old design had TWO observability stacks —
 * a write-path `UsageTracker` that bumped a per-(workspace,day) `usage` table
 * on every engram/esr tool call, and a separate session-log scan that counted
 * tool calls (to include the built-in `todo` tool). Both are now ONE module:
 * both /stats and /toolstats answer from the canonical log stream
 * `~/.dsh/sessions/<bucket>/<sid>/session.jsonl.zstd`, decompressed on demand
 * with a short TTL cache. No tool call pays a write anymore (pure GUI-side
 * observability), and the log stream is the single source of truth.
 *
 * Zero external dependency: Node >=22.19 provides the zstd codec in
 * `node:zlib`. Session logs are concatenated zstd frames (each append is an
 * independent frame), so we scan frame boundaries and reuse one decoder
 * handle across all frames instead of relying on a system `zstd` CLI (which
 * Windows hosts commonly lack) or the one-shot `zstdDecompressSync`, which
 * only decodes the FIRST frame of a multi-frame container.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { constants as bufferConstants } from "node:buffer";
import { createZstdDecompress, zstdDecompressSync } from "node:zlib";

import { workspaceKey as wk } from "./util.js";

/** Local YYYY-MM-DD, so daily rollups land on calendar days for the user. */
export function dayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const CACHE_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

const cache = new Map(); // `${root}|${days}|${kind}` -> { at, payload }

/** Default session-log root (the same tree the session index reads). */
export function sessionsRoot() {
  return path.join(os.homedir(), ".dsh", "sessions");
}

/** Byte range of one structurally complete zstd frame in a concatenated stream. */
function frameRanges(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== 0xfd2fb528) break; // ZSTD_MAGIC
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) break; // reserved frame-header bit
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) return frames; // reserved block type
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

/**
 * Node-private synchronous multi-frame zstd decoder. Node exposes synchronous
 * decoding only as a one-shot API that stops at the first frame of a
 * concatenated container (session logs append a fresh frame per batch).
 * Reusing one stream's `_handle.writeSync` across frames is the same
 * optimization the harness's own `NodePrivateZstdFrameDecoder` uses; when the
 * running Node release lacks that private shape we fall back to per-frame
 * `zstdDecompressSync` (correct, slower — fine for the occasional /stats poll).
 */
function createFrameDecoder() {
  const stream = createZstdDecompress({ chunkSize: 1024 * 1024 });
  const handle = stream._handle;
  const errorKey = Reflect.ownKeys(stream).find(
    (key) => typeof key === "symbol" && key.description === "kError",
  );
  if (
    typeof handle !== "object" || handle === null ||
    typeof handle?.writeSync !== "function" ||
    !(stream._writeState instanceof Uint32Array) ||
    stream._writeState.length < 2 ||
    typeof stream._defaultFlushFlag !== "number" ||
    errorKey === void 0 ||
    stream[errorKey] !== null
  ) {
    stream.close();
    return null;
  }
  const output = Buffer.allocUnsafe(1024 * 1024);
  let decoderError;
  stream.on("error", (error) => { decoderError ??= error; });
  return {
    decode(frame) {
      if (decoderError !== void 0) throw decoderError;
      let inputOffset = 0;
      let inputRemaining = frame.length;
      let outputBytes = 0;
      const fullChunks = [];
      for (;;) {
        handle.writeSync(
          stream._defaultFlushFlag,
          frame,
          inputOffset,
          inputRemaining,
          output,
          0,
          output.length,
        );
        if (decoderError !== void 0) throw decoderError;
        const internalError = stream[errorKey];
        if (internalError !== null) throw internalError;
        const outputAfter = stream._writeState[0];
        const inputAfter = stream._writeState[1];
        const consumed = inputRemaining - inputAfter;
        const produced = output.length - outputAfter;
        if (produced > 0) {
          outputBytes += produced;
          if (outputBytes > bufferConstants.MAX_LENGTH) throw new Error("frame output too large");
        }
        if (outputAfter !== 0) {
          if (inputAfter !== 0) throw new Error("decoder left trailing input");
          const finalChunk = output.subarray(0, produced);
          if (fullChunks.length === 0) return Buffer.from(finalChunk);
          if (produced > 0) fullChunks.push(Buffer.from(finalChunk));
          const onlyChunk = fullChunks[0];
          return fullChunks.length === 1 ? onlyChunk : Buffer.concat(fullChunks, outputBytes);
        }
        fullChunks.push(Buffer.from(output));
        inputOffset += consumed;
        inputRemaining = inputAfter;
      }
    },
    close() {
      stream.close();
    },
  };
}

function decodeZstd(file) {
  try {
    const buffer = fs.readFileSync(file);
    const frames = frameRanges(buffer);
    if (frames.length === 0) return "";
    const decoder = createFrameDecoder();
    if (decoder !== null) {
      try {
        let out = "";
        for (const frame of frames) out += decoder.decode(buffer.subarray(frame.start, frame.end)).toString("utf8");
        return out;
      } finally {
        decoder.close();
      }
    }
    // Public fallback: one zstdDecompressSync per frame (correct, slower).
    let out = "";
    for (const frame of frames) out += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString("utf8");
    return out;
  } catch {
    return "";
  }
}
export { decodeZstd };

function listDirOrEmpty(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Count recalled memory rows from a engram_recall output string. The tool
 * renders one `- <id> …` line per item (or a `no active memories…` / `no
 * memories for entity…` message on zero hits); we parse that shape.
 */
export function recallStatsFromOutput(out) {
  const s = String(out ?? "");
  if (/^\s*(no active memories|no memories for entity)/i.test(s)) {
    return { withHits: 0, hitsTotal: 0 };
  }
  const hitsTotal = (s.match(/\n- /g) ?? []).length + (s.startsWith("- ") ? 1 : 0);
  return { withHits: hitsTotal > 0 ? 1 : 0, hitsTotal };
}

/** Concatenate all text blocks of a `tool-result` content array. */
function blockText(content) {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const c of content) {
    if (typeof c?.text === "string") out += c.text;
  }
  return out;
}

/**
 * Count tool calls across recent session logs.
 * @param opts - { root, days, now } — root is injectable for tests.
 * @returns { days, files, events, tools, buckets, cachedAt }
 *   `tools` = tool name -> call count (most active first, across all buckets),
 *   `buckets` = bucket dir -> per-tool counts.
 */
export function collectToolCounts({ root = sessionsRoot(), days = 14, now = Date.now() } = {}) {
  const cacheKey = `${root}|${days}|tools`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;

  const byTool = new Map();
  const byBucket = new Map();
  const cutoff = now - days * DAY_MS;
  let files = 0;
  let events = 0;

  const buckets = listDirOrEmpty(root).filter((b) => b.startsWith("--"));
  for (const bucket of buckets) {
    const bdir = path.join(root, bucket);
    for (const sid of listDirOrEmpty(bdir)) {
      const file = path.join(bdir, sid, "session.jsonl.zstd");
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      files += 1;
      const raw = decodeZstd(file);
      const bucketCounts = byBucket.get(bucket) ?? new Map();
      for (const line of raw.split("\n")) {
        if (line.length === 0) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j?.type !== "tool/call") continue;
        const name = j.data?.name;
        if (typeof name !== "string" || name.length === 0) continue;
        events += 1;
        byTool.set(name, (byTool.get(name) ?? 0) + 1);
        bucketCounts.set(name, (bucketCounts.get(name) ?? 0) + 1);
      }
      if (bucketCounts.size > 0) byBucket.set(bucket, bucketCounts);
    }
  }

  const tools = Object.fromEntries([...byTool.entries()].sort((a, b) => b[1] - a[1]));
  const bucketsOut = {};
  for (const [b, m] of byBucket) {
    bucketsOut[b] = Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  }

  const payload = { days, files, events, tools, buckets: bucketsOut, cachedAt: now };
  cache.set(cacheKey, { at: now, payload });
  return payload;
}

/** Resolve the workspace key of a session from its `session` header event. */
function workspaceFromSession(raw) {
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type === "session" && typeof j.cwd === "string" && j.cwd.length > 0) {
      return wk(j.cwd);
    }
    return null; // session header is the first event
  }
  return null;
}

/** Session-local drill-through window: a engram_detail within N tool events of a hit recall counts as a follow-up. */
const DETAIL_FOLLOW_WINDOW = 8;

/**
 * Rebuild the per-(workspace, day) usage rollup straight from the session log
 * stream. Same shape as the old persisted rows, so the /stats aggregation is
 * unchanged: each row is { workspace, day, counts, failures, recall } where
 * `counts` = tool name -> calls, `failures` = errored results, `recall` =
 * { queries, withHits, hitsTotal, detailFollows }.
 *
 * Workspace is resolved from each session's `type:session` header cwd; day
 * from the file mtime (calendar-day granularity is all the GUI needs).
 */
export function collectUsageStats({ root = sessionsRoot(), days = 14, now = Date.now() } = {}) {
  const cacheKey = `${root}|${days}|usage`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;

  const rows = new Map(); // `${workspace}|${day}` -> row
  const cutoff = now - days * DAY_MS;
  let files = 0;
  let events = 0;
  let sessions = 0;

  const buckets = listDirOrEmpty(root).filter((b) => b.startsWith("--"));
  for (const bucket of buckets) {
    for (const sid of listDirOrEmpty(path.join(root, bucket))) {
      const file = path.join(root, bucket, sid, "session.jsonl.zstd");
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      const raw = decodeZstd(file);
      files += 1;
      const workspace = workspaceFromSession(raw) ?? "?";
      const day = dayKey(st.mtimeMs);
      sessions += 1;

      // Results come AFTER their call in the stream, so resolve them in a
      // first pass and walk the calls in a second (index keeps stream order).
      const results = new Map(); // callId -> { isError, text }
      for (const line of raw.split("\n")) {
        if (line.length === 0) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j?.type !== "tool/result") continue;
        const block = j.data?.message?.content?.find((c) => c?.type === "tool-result");
        if (block?.toolCallId) {
          results.set(block.toolCallId, { isError: block.isError === true, text: blockText(block.content) });
        }
      }
      let windowLeft = -1; // stream index of last hit-recall
      let idx = 0;
      for (const line of raw.split("\n")) {
        if (line.length === 0) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j?.type !== "tool/call") continue;
        const name = j.data?.name;
        if (typeof name !== "string" || name.length === 0) continue;
        idx += 1;
        events += 1;
        const result = j.data?.callId ? results.get(j.data.callId) : void 0;
        const key = `${workspace}|${day}`;
        const row = rows.get(key) ?? { workspace, day, counts: {}, failures: 0, recall: {} };
        row.counts[name] = (row.counts[name] ?? 0) + 1;
        if (result?.isError) row.failures += 1;
        if (name === "engram_recall") {
          row.recall.queries = (row.recall.queries ?? 0) + 1;
          const rs = recallStatsFromOutput(result ? result.text : "");
          row.recall.withHits = (row.recall.withHits ?? 0) + rs.withHits;
          row.recall.hitsTotal = (row.recall.hitsTotal ?? 0) + rs.hitsTotal;
          windowLeft = rs.withHits > 0 ? idx : -1;
        } else if (name === "engram_detail" && windowLeft >= 0 && idx - windowLeft <= DETAIL_FOLLOW_WINDOW) {
          row.recall.detailFollows = (row.recall.detailFollows ?? 0) + 1;
          windowLeft = -1;
        }
        rows.set(key, row);
      }
    }
  }

  const payload = { days, files, events, sessions, rows: [...rows.values()], cachedAt: now };
  cache.set(cacheKey, { at: now, payload });
  return payload;
}
