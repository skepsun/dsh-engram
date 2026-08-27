/**
 * dsh-engram session-cjk tests — CJK detection, bucket mapping, and the
 * bounded substring scan that supplements the tokenizer-blind cross-session
 * FTS fallback for Chinese queries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hasCJK,
  bucketFromCwd,
  countMatches,
  searchSessionsCJK,
} from "../lib/session-cjk.js";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cjk-"));
}

/** Write one zstd-compressed session log under root/<bucket>/<sid>/. */
function writeSession(root, bucket, sid, lines, mtimeMs = Date.now()) {
  const dir = path.join(root, bucket, sid);
  fs.mkdirSync(dir, { recursive: true });
  const plain = path.join(dir, "session.jsonl");
  fs.writeFileSync(plain, lines.join("\n") + "\n");
  const out = path.join(dir, "session.jsonl.zstd");
  execFileSync("zstd", ["-q", "-f", plain, "-o", out]);
  const st = fs.statSync(out);
  fs.utimesSync(out, new Date(mtimeMs), new Date(mtimeMs));
  void st;
}

test("hasCJK detects CJK ideographs and ignores ASCII-only text", () => {
  assert.equal(hasCJK("中间表示"), true);
  assert.equal(hasCJK("编译器 流水线"), true);
  assert.equal(hasCJK("KV-cache reuse"), false);
  assert.equal(hasCJK(""), false);
  assert.equal(hasCJK(null), false);
});

test("bucketFromCwd flattens the absolute cwd into the sessions bucket name", () => {
  assert.equal(bucketFromCwd("/d1/chuxiong/code/dsh-loom"), "--d1-chuxiong-code-dsh-loom--");
  assert.equal(bucketFromCwd("/a/b/"), "--a-b--");
  assert.equal(bucketFromCwd("/a/b/c/"), "--a-b-c--");
});

test("countMatches counts contiguous occurrences, case-folding only ASCII", () => {
  assert.equal(countMatches("编译器遇错，修复编译器", "编译器"), 2);
  assert.equal(countMatches("alpha BETA gamma", "beta"), 1); // ASCII case-insensitive
  assert.equal(countMatches("abc", "xyz"), 0);
  assert.equal(countMatches("", "x"), 0);
  assert.equal(countMatches("abc", ""), 0);
});

test("searchSessionsCJK finds a mid-run Chinese substring the FTS cannot", () => {
  const root = tmpRoot();
  const cwd = path.join(root, "ws", "proj");
  const bucket = bucketFromCwd(cwd);
  writeSession(root, bucket, "s1", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/call","data":{"name":"read","arguments":{"path":"x.ts"}}}',
    '{"type":"tool/result","data":{"name":"read","output":"深入理解编译器的中间表示生成"}',
  ], Date.now() - 2000);
  writeSession(root, bucket, "s2", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/call","data":{"name":"bash"}}',
    '{"type":"tool/result","data":{"name":"bash","output":"npm test 全部通过"}',
  ], Date.now() - 1000);

  const hits = searchSessionsCJK({ cwd, query: "中间表示", root });
  assert.equal(hits.length >= 1, true);
  assert.equal(hits[0].sessionId, "s1");
  assert.match(hits[0].snippet, /中间表示/);
  assert.ok(hits[0].hits >= 1);
});

test("searchSessionsCJK orders by match count then recency, and respects limit", () => {
  const root = tmpRoot();
  const cwd = path.join(root, "p");
  const bucket = bucketFromCwd(cwd);
  // sA: three occurrences but older; sB: one occurrence but newer.
  writeSession(root, bucket, "sA", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/result","data":{"name":"x","output":"缓存命中 缓存失效 缓存回填"}',
  ], Date.now() - 5000);
  writeSession(root, bucket, "sB", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/result","data":{"name":"x","output":"仅一次缓存"}',
  ], Date.now() - 1000);

  assert.deepEqual(
    searchSessionsCJK({ cwd, query: "缓存", root, limit: 1 }).map((h) => h.sessionId),
    ["sA"], // more matches wins over recency
  );
  assert.deepEqual(
    searchSessionsCJK({ cwd, query: "缓存", root, limit: 2 }).map((h) => h.sessionId),
    ["sA", "sB"],
  );
});

test("searchSessionsCJK bounds the scan to the newest maxFiles", () => {
  const root = tmpRoot();
  const cwd = path.join(root, "bound");
  const bucket = bucketFromCwd(cwd);
  for (let i = 0; i < 5; i += 1) {
    writeSession(root, bucket, `s${i}`, [
      `{"type":"session","cwd":"${cwd}"}`,
      `{"type":"tool/result","data":{"name":"x","output":"命中词 ${i}"}`,
    ], Date.now() - (5 - i) * 1000); // s4 newest
  }
  const one = searchSessionsCJK({ cwd, query: "命中词", root, maxFiles: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0].sessionId, "s4");
  const more = searchSessionsCJK({ cwd, query: "命中词", root, maxFiles: 3 });
  assert.equal(more.length, 3);
});

test("searchSessionsCJK returns [] for non-CJK queries, missing buckets and empty hits", () => {
  const root = tmpRoot();
  const cwd = path.join(root, "empty");
  assert.deepEqual(searchSessionsCJK({ cwd, query: "build", root }), []); // ASCII → skip
  assert.deepEqual(searchSessionsCJK({ cwd, query: "构建", root }), []); // no bucket yet
  const bucket = bucketFromCwd(cwd);
  writeSession(root, bucket, "s1", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/result","data":{"name":"x","output":"只有英文 build"}}',
  ]);
  assert.deepEqual(searchSessionsCJK({ cwd, query: "中间表示", root }), []); // no match
});

test("searchSessionsCJK redacts secrets from raw-log snippets", () => {
  const root = tmpRoot();
  const cwd = path.join(root, "redact");
  const bucket = bucketFromCwd(cwd);
  writeSession(root, bucket, "s1", [
    '{"type":"session","cwd":"' + cwd + '"}',
    '{"type":"tool/result","data":{"name":"x","output":"配置 API_KEY: superSecretZebra123 缓存命中"}}',
  ]);
  const hits = searchSessionsCJK({ cwd, query: "缓存", root, limit: 1 });
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].snippet.includes("superSecretZebra123"), "raw secret never reaches the snippet");
  assert.match(hits[0].snippet, /<REDACTED/);
  assert.ok(hits[0].snippet.includes("缓存"), "matched CJK region is still visible");
});
