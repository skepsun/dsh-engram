/**
 * Context GC durable status file: write/read round trip under a temp HOME.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeContextGcStatus, readContextGcStatus, contextGcStatusPath, engramHomeDir } from "../lib/status.js";

test("status: write then read round trips the snapshot (under $DSH_HOME)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engram-status-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    assert.equal(contextGcStatusPath(), join(dir, "engram", "context-gc.status.json"));
    const payload = {
      planes: ["host", "web"],
      host: "context-gc",
      web: { action: "swapped", presets: [{ presetId: "standard", path: "/x", action: "swapped" }] },
      config: { autoWebCompaction: true, gcReplacesCompaction: true, gcNarrative: true },
    };
    await writeContextGcStatus(payload);
    assert.ok(existsSync(contextGcStatusPath()), "snapshot file exists");
    const read = await readContextGcStatus();
    assert.equal(read.version, 1);
    assert.equal(read.host, "context-gc");
    assert.equal(read.web.action, "swapped");
    assert.equal(read.web.presets[0].presetId, "standard");
    assert.equal(read.planes.length, 2);
    assert.equal(typeof read.writtenAt, "number");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("status: no snapshot yet → undefined, never throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engram-status-missing-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    assert.equal(await readContextGcStatus(), undefined);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("status: default home falls back to ~/.dsh when DSH_HOME is unset", () => {
  const prev = process.env.DSH_HOME;
  try {
    delete process.env.DSH_HOME;
    assert.equal(engramHomeDir(), join(process.env.HOME ?? "", ".dsh"));
  } finally {
    if (prev !== undefined) process.env.DSH_HOME = prev;
  }
});
