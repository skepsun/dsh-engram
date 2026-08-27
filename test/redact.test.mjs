/**
 * dsh-engram redact tests — deterministic secret redaction on the memory
 * write path: rule behavior, determinism, prose safety, and store integration
 * (secret never persisted, dedup still consistent).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { redactText } from "../lib/redact.js";
import { openEngramDomain } from "../lib/store.js";

const CONFIG = {
  autoCapture: true,
  autoCapturePerSession: 40,
  autoCaptureGlobalCap: 500,
  sessionSearch: true,
  maxRecallPerSession: 3,
  indexMaxLines: 12,
  indexMaxChars: 700,
  minIndexSignal: 0.4,
  promoteHits: 3,
  expireDays: 180,
  maxMemoriesPerWorkspace: 2000,
  maxMemoryChars: 1600,
  maxTasksPerWorkspace: 40,
};

function fakeFacility() {
  const tables = new Map();
  return {
    open(spec) {
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map());
      return Promise.resolve({
        table(name) {
          const map = tables.get(name);
          return {
            get: (k) => map.get(k),
            put: (k, v) => Promise.resolve(map.set(k, v)),
            delete: (k) => Promise.resolve(map.delete(k)),
            entries: () => map.entries(),
          };
        },
        close: () => Promise.resolve(),
      });
    },
    // expose for direct assertions
    _tables: tables,
  };
}

test("redactText removes the common secret shapes", () => {
  assert.equal(redactText("key is \x73\x6B\x2D\x61\x62\x63\x31\x32\x33\x44\x45\x46\x34\x35\x36\x67\x68\x69\x37\x38\x39\x6A\x6B\x6C\x30\x31\x32\x6D\x6E\x6F\x33\x34\x35"), "key is <REDACTED:sk>");
  assert.equal(redactText("token \x67\x68\x70\x5F\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4A\x4B\x4C\x4D\x4E\x4F\x50\x51\x52\x53\x54\x55\x56\x57\x58\x59\x5A\x31\x32\x33\x34 rest"), "token <REDACTED:github> rest");
  assert.equal(redactText("aws \x41\x4B\x49\x41\x49\x4F\x53\x46\x4F\x44\x4E\x4E\x37\x45\x58\x41\x4D\x50\x4C\x45 in text"), "aws <REDACTED:aws> in text");
  assert.equal(redactText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"),
    "jwt <REDACTED:jwt>");
  assert.equal(redactText("\x73\x6B\x5F\x6C\x69\x76\x65\x5F\x35\x31\x48\x78\x59\x38\x74\x50\x4C\x55\x53\x30\x30\x30\x30\x61\x62\x63\x64\x65\x66\x67\x68\x69\x6A\x6B\x6C\x6D\x6E\x6F\x70\x71\x72\x73\x74\x75\x76\x77\x78\x79\x7A\x31\x32\x33\x34\x35\x36"), "<REDACTED:stripe>");
  assert.equal(redactText("Authorization: Bearer \x61\x62\x63\x64\x65\x66\x67\x68\x69\x6A\x6B\x6C\x6D\x6E\x6F\x70\x71\x72\x73\x74\x75\x76\x77\x78\x79\x7A\x31\x32\x33\x34"), "Authorization: <REDACTED:bearer>");
  assert.equal(redactText("token=gHxY8tPLUS0000abcdefghij"), "<REDACTED:key>");
  assert.equal(redactText("API_KEY: superSecretValue123!"), "<REDACTED:key>!");
  assert.equal(redactText("password=hunter22x"), "<REDACTED:key>");
  assert.equal(redactText("http://user:sekrit@example.com/x"), "http://<REDACTED>@example.com/x");
  assert.equal(redactText("\x2D\x2D\x2D\x2D\x2D\x42\x45\x47\x49\x4E\x20\x52\x53\x41\x20\x50\x52\x49\x56\x41\x54\x45\x20\x4B\x45\x59\x2D\x2D\x2D\x2D\x2D\x4D\x49\x49\x45\x6F\x77\x49\x42\x41\x41\x4B\x43\x41\x51\x45\x41\x2D\x2D\x2D\x2D\x2D\x45\x4E\x44\x20\x52\x53\x41\x20\x50\x52\x49\x56\x41\x54\x45\x20\x4B\x45\x59\x2D\x2D\x2D\x2D\x2D key"),
    "<REDACTED:private-key> key");
});

test("redactText leaves ordinary prose untouched", () => {
  const prose = "修复了编译器的中间表示生成；检查流水线的数据一致性；token 指的是用词；version: 1.2.3 已发布；secret garden 很漂亮。";
  assert.equal(redactText(prose), prose);
  const ascii = "the build failed at step 3 — check the log for details; read the docs at https://github.com/skepsun/dsh-engram";
  assert.equal(redactText(ascii), ascii);
});

test("redactText is deterministic", () => {
  const input = "key \x73\x6B\x2D\x61\x62\x63\x31\x32\x33\x44\x45\x46\x34\x35\x36\x67\x68\x69\x37\x38\x39\x6A\x6B\x6C\x30\x31\x32\x6D\x6E\x6F\x33\x34\x35; token \x67\x68\x70\x5F\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4A\x4B\x4C\x4D\x4E\x4F\x50\x51\x52\x53\x54\x55\x56\x57\x58\x59\x5A\x31\x32\x33\x34";
  assert.equal(redactText(input), redactText(input));
});

test("storeMemory redacts secrets before persist and keeps dedup consistent", async () => {
  const facility = fakeFacility();
  const domain = await openEngramDomain(facility);
  const secret = "\x67\x68\x70\x5F\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4A\x4B\x4C\x4D\x4E\x4F\x50\x51\x52\x53\x54\x55\x56\x57\x58\x59\x5A\x31\x32\x33\x34";
  const a = await domain.storeMemory(
    { workspace: "/ws", kind: "decision", text: `deploy token ${secret} used`, sessionId: "s1", seq: 1 },
    CONFIG,
  );
  const stored = domain.getMemory("/ws", a.id);
  assert.ok(!stored.text.includes(secret), "secret must not be persisted");
  assert.match(stored.text, /<REDACTED:github>/);

  // A second identical secret-bearing text must dedup against the first
  // (redaction happens before the hash), not create a new row.
  const b = await domain.storeMemory(
    { workspace: "/ws", kind: "decision", text: `deploy token ${secret} used`, sessionId: "s2", seq: 2 },
    CONFIG,
  );
  assert.equal(b.duplicated, true);
  assert.equal(b.id, a.id);
  assert.equal(domain.listMemories("/ws", 10).length, 1);
});

test("a secret-only text still stores (redacted), never empty", async () => {
  const facility = fakeFacility();
  const domain = await openEngramDomain(facility);
  const a = await domain.storeMemory(
    { workspace: "/ws", kind: "decision", text: "\x73\x6B\x2D\x61\x62\x63\x31\x32\x33\x44\x45\x46\x34\x35\x36\x67\x68\x69\x37\x38\x39\x6A\x6B\x6C\x30\x31\x32\x6D\x6E\x6F\x33\x34\x35", sessionId: "s1", seq: 1 },
    CONFIG,
  );
  const stored = domain.getMemory("/ws", a.id);
  assert.equal(stored.text, "<REDACTED:sk>");
});
