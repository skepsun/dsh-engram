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
 *
 * Since round 6 had to be finished on Linux, the fence has two mechanisms —
 * macOS seatbelt and Linux bubblewrap — under one entry point,
 * `fenceCommand()`. This test asserts the CONTRACT against whichever one the
 * host has, so a loosened bwrap mount list fails exactly like a loosened
 * seatbelt rule does. A test that built its own profile would test the profile
 * and not the fence a run gets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildBwrapArgs, fenceCommand } from "../eval/g6/sandbox-profile.mjs";

const support =
  process.platform === "darwin"
    ? fs.existsSync("/usr/bin/sandbox-exec") || "sandbox-exec is missing"
    : process.platform === "linux"
      ? fs.existsSync("/usr/bin/bwrap") || fs.existsSync("/bin/bwrap") || "bubblewrap (bwrap) is not installed"
      : `${process.platform} has no OS-level fence in this tool`;

test("the fence hides the experiment tree and still lets the arm run", { skip: support === true ? false : support }, () => {
  const root = fs.mkdtempSync("/tmp/g6-fence-");
  // The layout a run really has: a neutral arm dir under the round root, the
  // sibling arm beside it, the artifact outside the run tree, one DSH_HOME for
  // both arms, and the credential file outside that home.
  const runRoot = path.join(root, "out", "runs", "a1b2c3d4");
  const ws = path.join(runRoot, "ws");
  const sibling = path.join(root, "out", "runs", "deadbeef", "ws");
  const home = path.join(root, "home");
  const logs = path.join(root, "logs");
  const creds = path.join(root, "creds", ".credentials.yaml");
  for (const dir of [ws, sibling, path.join(home, "profiles", "arm-b", "node_modules", "dsh-engram"), path.join(home, "sessions"), logs, path.dirname(creds)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(ws, "README.md"), "inside\n");
  // The row's own log sits beside ws inside the run root; it is not the arm's
  // business (a run.log holds the model's transcript, and this layout keeps
  // --log-dir outside the tree anyway).
  fs.writeFileSync(path.join(runRoot, "run.log"), "the answer is 42\n");
  fs.writeFileSync(path.join(sibling, "answer.txt"), "the other arm's answer\n");
  fs.writeFileSync(path.join(home, "profiles", "arm-b", "node_modules", "dsh-engram", "package.json"), '{"name":"dsh-engram"}\n');
  // The plugin ships this round's write-up inside docs/ — the treatment arm's own
  // package carried the codec formula in round 6 (seam #7).
  const ownDocs = path.join(home, "profiles", "arm-b", "node_modules", "dsh-engram", "docs");
  fs.mkdirSync(ownDocs, { recursive: true });
  fs.writeFileSync(path.join(ownDocs, "G6-quality-ab.zh.md"), "codec = charset[sum(digit*3+7) mod 36]\n");
  fs.mkdirSync(path.join(home, "profiles", "arm-a"), { recursive: true });
  fs.writeFileSync(path.join(home, "profiles", "arm-a", "seeded-store.json"), '{"memory":"the answer"}\n');
  fs.writeFileSync(path.join(logs, "runs.json"), '{"armLabels":{"arm-a":"on","arm-b":"off"}}\n');
  fs.writeFileSync(creds, "DEEPSEEK_API_KEY: test-only\n");

  const fences = [];
  const dims = {
    home: os.homedir(),
    nodeDir: path.dirname(path.dirname(process.execPath)),
    dshHome: path.join(home, "profiles", "arm-b"),
    ws,
    otherArmProfile: path.join(home, "profiles", "arm-a"),
    sessionsDir: path.join(home, "sessions"),
    credentials: creds,
    docsToHide: [ownDocs],
    hideRunsRoot: runRoot,
  };
  const inside = (command) => {
    // A fresh fence per command, from the same entry point a run uses.
    const fence = fenceCommand({ ...dims, cmd: "/bin/bash", argv: ["-c", command] });
    fences.push(fence);
    return spawnSync(fence.cmd, fence.argv, { cwd: ws, encoding: "utf8" });
  };
  try {
    assert.equal(inside("cat README.md").stdout.trim(), "inside", "the arm reads its own workspace");
    assert.equal(inside("echo scratch > scratch.txt && cat scratch.txt").stdout.trim(), "scratch", "and writes to it");

    // The startup path: node calls getcwd(2) and realpath(3) before any user code.
    const cwd = inside(`"${process.execPath}" -e "console.log(process.cwd())"`);
    assert.equal(cwd.status, 0, `node must start inside the fence (getcwd/realpath): ${cwd.stderr}`);
    assert.equal(cwd.stdout.trim(), fs.realpathSync(ws), "and sees the arm's own cwd");

    // dsh cannot boot without these two, so they are part of the contract.
    assert.equal(inside(`cat ${creds}`).stdout.trim(), "DEEPSEEK_API_KEY: test-only", "the provider key is readable");
    assert.match(inside(`cat ${home}/profiles/arm-b/node_modules/dsh-engram/package.json`).stdout, /dsh-engram/, "its own profile is readable");

    // …and everything that would answer the question is not.
    //
    // The round-6 lesson was "ancestors must not be enumerable": its controls ran
    // `ls /private/tmp/g6r14` and read `runs.json`, `arm-a`, `arm-b` off it. The
    // two mechanisms hide that differently — seatbelt denies the listing, bwrap
    // leaves a fabricated skeleton containing only the components of the arm's
    // own path — so the assertion pins the thing that matters: none of those
    // names is nameable from where the arm stands.
    const listed = (dir) => {
      const res = inside(`ls ${dir}`);
      return res.status === 0 ? res.stdout.trim().split("\n").filter(Boolean) : [];
    };
    const visible = new Set([
      ...listed(root),
      ...listed(path.join(root, "out")),
      ...listed(path.join(root, "out", "runs")),
      ...listed(runRoot),
      ...listed(logs),
    ]);
    // `home` and `creds` DO appear: they are the two trees a run is allowed to
    // need (its DSH_HOME and the provider key), so bwrap fabricates their mount
    // points. What must not appear is the artifact, the log dir, or the sibling
    // arm's run tree.
    // The arm's OWN run key is not a leak (it is its own cwd, fabricated as the
    // parent chain of the only mount it gets); the sibling's key is.
    for (const forbidden of ["runs.json", "arm-a", "logs", "deadbeef", "run.log"]) {
      assert.ok(!visible.has(forbidden), `${forbidden} must not be nameable from the round root (saw ${[...visible].join(", ")})`);
    }
    assert.equal(inside(`ls ${runRoot}`).stdout.trim(), "ws", "the run root contains the workspace and nothing else");
    assert.notEqual(inside(`cat ${logs}/runs.json`).status, 0, "the artifact is unreadable");
    assert.notEqual(inside(`cat ${path.join(sibling, "answer.txt")}`).status, 0, "the sibling arm's tree is unreadable");
    assert.notEqual(inside(`cat ${runRoot}/run.log`).status, 0, "the run's own log beside ws is unreadable");
    assert.notEqual(inside(`cat ${home}/profiles/arm-a/seeded-store.json`).status, 0, "the other arm's seeded store is unreadable");
    assert.notEqual(inside(`cat ${ownDocs}/G6-quality-ab.zh.md`).status, 0, "the corpus write-up inside the arm's OWN package is unreadable");
    assert.notEqual(inside(`ls ${path.join(os.homedir(), ".dsh")}`).status, 0, "the host's own DSH_HOME is unreadable");
    assert.notEqual(inside(`cat ${path.join(process.cwd(), "package.json")}`).status, 0, "the repo is unreadable");
  } finally {
    for (const fence of fences) fence.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the checkout is hidden explicitly, not by luck of being under $HOME", () => {
  // A checkout that exists (the tmpfs rule has to be able to name it) but does
  // not live under $HOME, which is the case the home tmpfs does not cover.
  const checkout = fs.mkdtempSync("/tmp/g6-checkout-");
  try {
    const dims = {
      home: "/home/tester",
      nodeDir: "/usr/local",
      dshHome: "/srv/g6/home/profiles/arm-b",
      ws: "/srv/g6/runs/a1b2c3d4/ws",
      repo: checkout,
    };
    const args = buildBwrapArgs(dims);
    const pairs = [];
    for (let i = 0; i < args.length - 1; i += 1) if (args[i].startsWith("--")) pairs.push([args[i], args[i + 1]]);
  assert.deepEqual(pairs.filter(([flag]) => flag === "--tmpfs").map(([, target]) => target), ["/home/tester", "/tmp", checkout], "three channels disappear, each by mount");
    assert.deepEqual(pairs.filter(([flag]) => flag === "--bind").map(([, target]) => target), ["/srv/g6/home", "/srv/g6/runs/a1b2c3d4/ws"], "and exactly two trees come back writable: the run's home and its workspace");
  // A checkout under $HOME is already gone with the home tmpfs; a second mount
  // for it would be harmless, but it is the sign someone stopped reading the rule.
    assert.equal(buildBwrapArgs({ ...dims, repo: "/home/tester/checkout" }).filter((entry) => entry === "/home/tester/checkout").length, 0);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test("a hidden store is hidden by the fence, not by a rename in the same directory", () => {
  const dims = { home: "/home/tester", nodeDir: "/usr/local", dshHome: "/srv/g6/home/profiles/arm-b", ws: "/srv/g6/runs/a1b2c3d4/ws" };
  const hidden = buildBwrapArgs({ ...dims, hideStore: true });
  assert.ok(hidden.includes("--tmpfs") && hidden.includes("/srv/g6/home/storages"), "storages/ is an empty mount, so a `ls` finds nothing to read");
  assert.ok(!buildBwrapArgs(dims).includes("/srv/g6/home/storages"), "and the arm that IS given the memory keeps the directory");
});

test("an unsupported platform refuses instead of running unfenced", () => {
  assert.throws(() => fenceCommand({ platform: "win32", cmd: "dsh", argv: [] }), /no OS-level fence/);
});

/**
 * The network half (docs §16). Cheap to test because the plan is pure: the
 * harness turns it into iptables calls and a `sudo bwrap … setpriv` argv, and
 * both are inspectable strings.
 */
test("the egress plan denies first and opens exactly two holes, all scoped to the arm uid", async () => {
  const { egressRules } = await import("../eval/g6/sandbox-profile.mjs");
  const rules = egressRules({ uid: 1016, endpointHost: "172.27.221.61", endpointPort: 8003 });
  // `-I OUTPUT` prepends, so insertion order IS final order: the REJECT goes in
  // first and the allows land above it. Get this backwards and the fence
  // silently allows everything, which is the failure mode nobody notices.
  assert.match(rules[0].add.join(" "), /-j REJECT$/, "the default deny must be inserted first");
  const endpointRule = rules[1].add.join(" ");
  for (const part of ["-m owner --uid-owner 1016", "-p tcp", "-d 172.27.221.61/32", "--dport 8003", "-j ACCEPT"]) {
    assert.ok(endpointRule.includes(part), `endpoint rule is missing ${part}: ${endpointRule}`);
  }
  assert.match(rules[2].add.join(" "), /-o lo -j ACCEPT/);
  for (const rule of rules) {
    assert.match(rule.add.join(" "), /-m owner --uid-owner 1016/, "every rule is scoped to the arm");
    assert.deepEqual(rule.del, rule.add.map((part, index) => (index === 0 ? "-D" : part)), "removal mirrors insertion");
  }
  // No DNS hole, no ICMP hole: resolving a name is how a control finds github.
  assert.ok(!rules.some((rule) => /--dport 53|icmp|--sport/.test(rule.add.join(" "))));
});

test("the net fence mounts one arm at a neutral root and drops the uid", async () => {
  const { fenceCommand, NEUTRAL_ROOT, NETFENCE_UID } = await import("../eval/g6/sandbox-profile.mjs");
  // A real directory for the toolchain: the plan refuses to bind a source that
  // does not exist, and a test that faked it would not catch that.
  const toolchain = fs.mkdtempSync("/tmp/g6-tc-");
  fs.mkdirSync(path.join(toolchain, "bin"));
  fs.writeFileSync(path.join(toolchain, "bin", "dsh"), "#!/bin/sh\n");
  const fence = fenceCommand({
    platform: "linux",
    cmd: `${toolchain}/bin/dsh`,
    argv: ["--profile", "p-a", "do the task"],
    home: "/home/op",
    // `dshHome` is the PROFILE (what the non-net plan mounts under the real
    // home); the neutral root is the ARM home, because DSH_HOME must contain
    // `profiles/<arm>` for `--profile` to resolve.
    dshHome: "/home/op/.dsh/quality-ab-r8/arms/p-a/profiles/p-a",
    armHome: "/home/op/.dsh/quality-ab-r8/arms/p-a",
    ws: "/home/op/code/repo/eval/g6/runs/abc/ws",
    sessionsDir: null,
    credentials: "/home/op/.dsh/.credentials.yaml",
    repo: "/home/op/code/repo",
    toolPaths: [],
    net: { uid: 1016, runTmp: "/home/op/code/repo/eval/g6/runs/abc/tmp", runHome: "/home/op/code/repo/eval/g6/runs/abc/home", envFile: "/home/op/code/repo/eval/g6/runs/abc/home/.netenv" },
    baseEnv: { LOCAL_VLLM_61_API_KEY: "k-123", PATH: "/home/op/.npm-global/bin:/usr/bin", DSH_SESSION_ID: "leak" },
  });
  assert.equal(fence.cmd, "/usr/bin/sudo");
  assert.equal(fence.argv[0], "-n", "the mount tree needs root; a prompt would hang a matrix");
  const line = fence.argv.join(" ");
  assert.match(line, new RegExp(`--reuid=1016 --regid=1016 --clear-groups`));
  assert.match(line, /--tmpfs \/home\/op( |$)/, "the host home must still disappear");
  assert.match(line, new RegExp(`--bind /home/op/.dsh/quality-ab-r8/arms/p-a ${NEUTRAL_ROOT}/arm`));
  assert.match(line, new RegExp(`--chdir ${NEUTRAL_ROOT}/ws`));
  // The launcher is exec'd from the neutral copy: the host one is unreadable to
  // the dropped uid, and an ENOENT there looks like a missing binary.
  assert.match(line, new RegExp(`${NEUTRAL_ROOT}/toolchain/bin/dsh --profile p-a do the task$`));
  // The credential FILE is gone (the uid cannot read it); the key travels in env
  // and the rest of the operator's environment does not.
  assert.ok(!line.includes(".credentials.yaml"), "net fenced runs must not mount the credentials file");
  // The environment travels in the argv, not through sudo: sudo's env_reset
  // drops what the harness passes (HOME→/root, DSH_HOME gone), which killed the
  // first fenced smoke in 0.1s. `env -i` inside the fence is the whole truth.
  assert.deepEqual(fence.env, {}, "sudo must receive no environment to leak");
  const at = fence.argv.indexOf("-i");
  assert.ok(at > 0 && fence.argv[at - 1] === "/usr/bin/env", "the fenced command sets its own environment");
  const pairs = fence.argv.slice(at + 1, fence.argv.indexOf("/bin/sh", at));
  const envOf = (name) => pairs.find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);
  assert.deepEqual(pairs.map((pair) => pair.split("=")[0]).sort(), ["DSH_HOME", "HOME", "LANG", "PATH", "TMPDIR"]);
  assert.equal(envOf("DSH_HOME"), `${NEUTRAL_ROOT}/arm`);
  assert.equal(envOf("HOME"), `${NEUTRAL_ROOT}/home`);
  assert.equal(envOf("DSH_SESSION_ID"), undefined, "the operator's DSH_* vars must not reach the arm");
  // The credential is NOT in the argv: `ps` shows every process's argv to every
  // user, so a key there is a key published. It is sourced from a 0600 file in
  // the run's own $HOME instead, and the wrapper proves it.
  assert.ok(!line.includes("k-123"), "the credential must never appear in argv");
  assert.ok(line.includes(". /srv/g6/home/.netenv;"), "the wrapper sources the secret file");
  const keys = (await import("../eval/g6/sandbox-profile.mjs")).netFenceSecretLines({ base: { LOCAL_VLLM_61_API_KEY: "k-123", DEEPSEEK_API_KEY: "paid" }, provider: "local-vllm-61" });
  assert.deepEqual(keys, ["LOCAL_VLLM_61_API_KEY=k-123"], "only the arm's own provider key travels — never the paid API's");
});

test("the neutral rewrite prefers the toolchain over the home it lives in", async () => {
  const { neutralizePath } = await import("../eval/g6/sandbox-profile.mjs");
  const props = { dshHome: "/home/op/.dsh/quality-ab-r8/arms/p-a", ws: "/home/op/run/ws", toolchain: "/home/op/.npm-global" };
  assert.equal(neutralizePath("/home/op/.npm-global/bin/dsh", { home: "/home/op", props }), "/srv/g6/toolchain/bin/dsh");
  assert.equal(neutralizePath("/home/op/.dsh/quality-ab-r8/arms/p-a/profiles/p-a", { home: "/home/op", props }), "/srv/g6/arm/profiles/p-a");
  assert.equal(neutralizePath("/home/op/run/ws/src/a.js", { home: "/home/op", props }), "/srv/g6/ws/src/a.js");
  // A path outside every known root is left alone: rewriting by guesswork would
  // hand an arm a path that does not exist.
  assert.equal(neutralizePath("/usr/local/bin/node", { home: "/home/op", props }), "/usr/local/bin/node");
});
