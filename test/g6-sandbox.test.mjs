/**
 * The G6 fence (eval/g6/sandbox-profile.mjs) — the OS-level claim that an arm
 * cannot read the experiment around it.
 *
 * Round 6's controls listed `/private/tmp/g6r14` and saw `runs.json`, `arm-a`
 * and `arm-b`: ancestor directories were allowed with `file-read*`, which is
 * permission to enumerate. They could not open anything, but 10 of 20 reasoned
 * about the A/B matrix they had just discovered. The fence now grants metadata
 * only on ancestors — and this test pins both halves of that line: the arm must
 * still start (getcwd/realpath need the metadata) while the tree stays hidden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildConfinedProfile } from "../eval/g6/sandbox-profile.mjs";

const darwin = process.platform === "darwin";

test("the fence hides the experiment tree and still lets the arm run", { skip: darwin ? false : "seatbelt is macOS-only" }, () => {
  const root = fs.mkdtempSync("/tmp/g6-fence-");
  const ws = path.join(root, "arm-b", "codec", "seed-0", "ws");
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "README.md"), "inside\n");
  fs.writeFileSync(path.join(root, "runs.json"), '{"armLabels":{"arm-a":"on","arm-b":"off"}}\n');
  fs.mkdirSync(path.join(root, "arm-a"), { recursive: true });
  fs.writeFileSync(path.join(root, "arm-a", "answer.txt"), "the answer\n");

  const profile = path.join(root, "fence.sb");
  fs.writeFileSync(
    profile,
    buildConfinedProfile({
      home: os.homedir(),
      nodeDir: path.dirname(path.dirname(process.execPath)),
      dshHome: path.join(root, "home", "profiles", "arm-b"),
      ws,
      otherArmProfile: path.join(root, "home", "profiles", "arm-a"),
      sessionsDir: path.join(root, "home", "sessions"),
      credentials: path.join(os.homedir(), ".dsh", ".credentials.yaml"),
    }),
  );

  const inside = (command) =>
    spawnSync("/usr/bin/sandbox-exec", ["-f", profile, "/bin/bash", "-c", command], { cwd: ws, encoding: "utf8" });

  assert.equal(inside("cat README.md").stdout.trim(), "inside", "the arm reads its own workspace");
  // The startup path: node calls getcwd(2) and realpath(3) before any user code.
  const cwd = inside(`"${process.execPath}" -e "console.log(process.cwd())"`);
  assert.equal(cwd.status, 0, `node must start inside the fence (getcwd/realpath): ${cwd.stderr}`);
  assert.equal(cwd.stdout.trim(), fs.realpathSync(ws), "and sees the arm's own cwd");

  assert.notEqual(inside(`ls ${root}`).status, 0, "the experiment root cannot be enumerated");
  assert.notEqual(inside(`cat ${root}/runs.json`).status, 0, "the artifact is unreadable");
  assert.notEqual(inside(`cat ${root}/arm-a/answer.txt`).status, 0, "the sibling arm's tree is unreadable");

  fs.rmSync(root, { recursive: true, force: true });
});
