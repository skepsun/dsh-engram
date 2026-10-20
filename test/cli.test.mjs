/**
 * CLI integration: the shipped `dsh-engram` bin against a sandboxed DSH home
 * and a declarative preset directory (DSH ≥ 0.2.0 layout).
 *
 * Every run points `DSH_WEB_PRESETS_DIR` at a decoy directory (or at the
 * sandbox itself for the env-discovery case), so the tests can never read or
 * rewrite the presets of the real `dsh` installation on the machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DECLARATIVE_MINIMAL, DECLARATIVE_STOCK } from "./fixtures/declarative-preset.mjs";
import { compactionWireStatus } from "../lib/web-provision.js";

const exec = promisify(execFile);
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "dsh-engram.mjs");

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "engram-cli-"));
  const home = join(root, "home");
  const presets = join(root, "presets");
  const decoy = join(root, "decoy-presets");
  await mkdir(home, { recursive: true });
  await mkdir(presets, { recursive: true });
  await mkdir(decoy, { recursive: true });
  await writeFile(join(presets, "standard.patch.yml"), DECLARATIVE_STOCK);
  await writeFile(join(presets, "minimal.patch.yml"), DECLARATIVE_MINIMAL);
  const env = { ...process.env, DSH_HOME: home, DSH_WEB_PRESETS_DIR: decoy };
  const run = (...args) => exec(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const writeStatus = async (configSource, web = { action: "swapped", presets: [] }) => {
    await mkdir(join(home, "engram"), { recursive: true });
    await writeFile(
      join(home, "engram", "context-gc.status.json"),
      JSON.stringify({
        version: 1,
        writtenAt: Date.now(),
        host: "context-gc",
        web,
        configSource,
      }),
    );
  };
  return { root, home, presets, env, run, writeStatus, close: () => rm(root, { recursive: true, force: true }) };
}

test("cli status: declarative layout is discovered and classified", async () => {
  const box = await sandbox();
  try {
    const { stdout } = await box.run("status", "--presets-dir", box.presets);
    assert.match(stdout, /预设布局：声明式/);
    assert.match(stdout, /standard: stock/);
    assert.match(stdout, /minimal: custom/);
    assert.match(stdout, /尚无状态文件/);
  } finally {
    await box.close();
  }
});

test("cli enable → already → status wired → revert (flag discovery)", async () => {
  const box = await sandbox();
  try {
    const first = await box.run("enable", "--presets-dir", box.presets);
    assert.match(first.stdout, /standard: swapped/);
    assert.equal(compactionWireStatus(await readFile(join(box.presets, "standard.patch.yml"), "utf8")), "wired");
    assert.equal(await readFile(join(box.presets, "standard.patch.yml.engram.bak"), "utf8"), DECLARATIVE_STOCK);

    const second = await box.run("enable", "--presets-dir", box.presets);
    assert.match(second.stdout, /standard: already/);

    const status = await box.run("status", "--presets-dir", box.presets);
    assert.match(status.stdout, /standard: wired/);

    const revert = await box.run("revert", "--presets-dir", box.presets);
    assert.match(revert.stdout, /standard: reverted/);
    assert.equal(await readFile(join(box.presets, "standard.patch.yml"), "utf8"), DECLARATIVE_STOCK);
  } finally {
    await box.close();
  }
});

test("cli discovery: DSH_WEB_PRESETS_DIR is honored when no flag is given", async () => {
  const box = await sandbox();
  try {
    const env = { ...box.env, DSH_WEB_PRESETS_DIR: box.presets };
    const { stdout } = await exec(process.execPath, [CLI, "status"], { env, encoding: "utf8" });
    assert.match(stdout, /standard: stock/);
    assert.match(stdout, /预设布局：声明式/);
  } finally {
    await box.close();
  }
});

test("cli --file: one composition is targeted even when discovery would find more", async () => {
  const box = await sandbox();
  try {
    const target = join(box.presets, "standard.patch.yml");
    const { stdout } = await box.run("enable", "--file", target);
    assert.match(stdout, /1 个预设/);
    assert.match(stdout, /standard: swapped/);
    assert.equal(compactionWireStatus(await readFile(target, "utf8")), "wired");
    // the sibling file was not touched
    assert.equal(await readFile(join(box.presets, "minimal.patch.yml"), "utf8"), DECLARATIVE_MINIMAL);
  } finally {
    await box.close();
  }
});

test("cli doctor: opt-in off is surfaced, opt-in on does not warn", async () => {
  const box = await sandbox();
  try {
    await box.writeStatus({ autoWebCompaction: false, gcReplacesCompaction: true, gcNarrative: true });
    const off = await box.run("doctor", "--presets-dir", box.presets);
    assert.match(off.stdout, /autoWebCompaction=false/);
    assert.match(off.stdout, /web 平面不会自动接管/);

    await box.writeStatus({ autoWebCompaction: true, gcReplacesCompaction: true, gcNarrative: true });
    const on = await box.run("doctor", "--presets-dir", box.presets);
    assert.doesNotMatch(on.stdout, /web 平面不会自动接管/);
  } finally {
    await box.close();
  }
});

test("cli status: opt-in off reads as disabled, not as a stalled pending", async () => {
  const box = await sandbox();
  try {
    await box.writeStatus({ autoWebCompaction: false, gcReplacesCompaction: true, gcNarrative: true }, { action: "pending", presets: [] });
    const { stdout } = await box.run("status", "--presets-dir", box.presets);
    assert.match(stdout, /web 平面：未启用（autoWebCompaction=false/);
    assert.doesNotMatch(stdout, /启动中/);
    assert.match(stdout, /⚠ autoWebCompaction=false/);
  } finally {
    await box.close();
  }
});

test("cli: unknown command exits non-zero with a hint", async () => {
  const box = await sandbox();
  try {
    await assert.rejects(
      () => box.run("frobnicate"),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(String(error.stderr), /未知命令/);
        return true;
      },
    );
  } finally {
    await box.close();
  }
});
