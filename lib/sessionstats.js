/**
 * dsh-engram: cheap usage rollup over the real session log stream.
 *
 * The `usage` rollup (lib/usage.js) only ever sees tools this plugin owns
 * (engram_* / esr_* / loom_*); the built-in todo tool never passes through
 * it. To answer "todo vs esr vs memory" honestly this module reads the
 * canonical tool-call stream — `~/.dsh/sessions/<bucket>/<sid>/session.jsonl.zstd`
 * — and counts `type:"tool/call"` events by tool name (the same methodology
 * used for the earlier telemetry analysis). Files are filtered by mtime to a
 * recent window; results are cached for a short TTL because decompressing
 * many session files on every poll would be wasteful.
 *
 * Zero-dependency: the host already carries the `zstd` CLI.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A big session log far exceeds Node's 1MB default exec buffer. */
const MAX_BYTES = 300 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

const cache = new Map(); // `${root}|${days}` -> { at, payload }

/** Default session-log root (the same tree the session index reads). */
export function sessionsRoot() {
  return path.join(os.homedir(), ".dsh", "sessions");
}

function decodeZstd(file) {
  try {
    return execFileSync("zstd", ["-dc", file], { maxBuffer: MAX_BYTES }).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Count tool calls across recent session logs.
 * @param opts - { root, days, now } — root is injectable for tests.
 * @returns { days, files, events, tools, buckets, cachedAt }
 *   `tools` = tool name -> call count (most active first, across all buckets),
 *   `buckets` = bucket dir -> per-tool counts.
 */
export function collectToolCounts({ root = sessionsRoot(), days = 14, now = Date.now() } = {}) {
  const cacheKey = `${root}|${days}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;

  const byTool = new Map();
  const byBucket = new Map();
  const cutoff = now - days * DAY_MS;
  let files = 0;
  let events = 0;

  let buckets = [];
  try {
    buckets = fs.readdirSync(root);
  } catch {
    /* no sessions dir yet — empty result is correct */
  }
  for (const bucket of buckets) {
    if (!bucket.startsWith("--")) continue;
    const bdir = path.join(root, bucket);
    let sids = [];
    try {
      sids = fs.readdirSync(bdir);
    } catch {
      continue;
    }
    for (const sid of sids) {
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
        if (line.length === 0 || !line.includes('"tool/call"')) continue;
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
