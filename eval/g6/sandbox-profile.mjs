/**
 * macOS seatbelt profile — and, since round 6 could not be finished on macOS,
 * the same fence in bubblewrap for Linux.
 *
 * Three isolation bugs in a row (renamed store, sibling run.log, harness docs
 * inside the plugin package) had the same shape: the control arm has a shell and
 * the whole machine is readable. Moving files around is not isolation — an
 * OS-enforced fence is. This is that fence, kept deliberately as a DENY list of
 * every channel a run could learn the answer through, because a full whitelist
 * (`deny default`) also blocks the terminal and process startup on the DSH
 * runtime.
 *
 * `sandbox-exec` is deprecated but present and enforcing on macOS: a denied read
 * comes back as EPERM, which is exactly what the contamination check wants to
 * be able to say.
 *
 * Two mechanisms, one contract: whatever the OS, an arm can read its own
 * workspace and its own profile, and nothing of the experiment around it. The
 * seatbelt side is a rule list resolved last-match-wins; the bwrap side is a
 * mount list resolved first-mount-wins (a later `--tmpfs` is what makes a path
 * disappear, a later `--bind` is what gives it back). They are not the same
 * code, so `test/g6-sandbox.test.mjs` runs the SAME assertions against `fenceCommand()`
 * on either platform — the claim under test is the fence, not the syscall.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHANNELS = {
  /** The repo: fixtures, oracles, seed memories, docs, git history. */
  repo: (repo) => [repo],
  /** Every earlier run's workspace/logs (solutions from previous rounds). */
  artifacts: (dirs) => dirs,
  /** The host's own memory store + session logs (this very conversation). */
  hostState: (home) => [`${home}/.dsh/storages`, `${home}/.dsh/sessions`, `${home}/.dsh/engram`, `${home}/.dsh/vendor`],
  /** The live plugin package (its docs describe the corpus). */
  liveProfile: (home) => [`${home}/.dsh/profiles`],
  /** The other arm's profile: it carries the seeded store. */
  otherArm: (home, arm) => [`${home}/.dsh/quality-ab/profiles/${arm}`],
  /** The plugin's own docs inside a profile. */
  abDocs: (home, arm) => [`${home}/.dsh/quality-ab/profiles/${arm}/node_modules/dsh-engram/docs`],
};

/**
 * macOS resolves `/tmp` to `/private/tmp` before the profile is matched, so a
 * deny entry spelled `/tmp/g6z` does NOT cover `/private/tmp/g6z/...`. Round 4
 * leaked the oracle through exactly that gap (`/tmp` vs `/private/tmp`), which is
 * why every entry is emitted both as given and as its realpath.
 */
function variants(entry) {
  const out = new Set([entry]);
  try {
    out.add(fs.realpathSync(entry));
  } catch {
    // Not on disk any more — the spelled path is all there is.
  }
  if (entry.startsWith("/tmp/")) out.add(`/private${entry}`);
  if (entry.startsWith("/private/tmp/")) out.add(entry.slice("/private".length));
  return [...out];
}

/**
 * The network half of the fence (docs §16).
 *
 * bwrap fences the filesystem and nothing else: round 7's controls answered
 * ledger questions after `git clone`-ing the public repo, because a blind arm
 * with a shell still has a socket. This is the other half, and it costs a uid.
 *
 * The shape: the arm runs as a dedicated uid (`g6arm`), and iptables REJECTs
 * egress from that uid except loopback and one endpoint. Nothing else on the
 * host is touched — the rules carry `--uid-owner`, so the operator's own shell,
 * the harness and the concurrent web GUI keep their network.
 *
 * Two consequences worth knowing before reading the code:
 *
 *  - The rules must be installed as root (`sudo -n iptables`). A fence that
 *    silently did not apply would produce the most dangerous artifact of all:
 *    a matrix that LOOKS blind. So `applyEgress()` verifies itself with
 *    `probeEgress()` and the harness refuses to score rows if the probe does
 *    not agree (endpoint reachable, github unreachable, DNS dead).
 *  - Dropping the uid breaks the old mount plan: `$HOME` is 0700, so the arm
 *    could not read its own profile. Every path the arm needs is therefore
 *    re-bound at a neutral root (`NEUTRAL_ROOT`) that the dropped uid can
 *    traverse, and the real home is tmpfs'd away exactly as before.
 */
export const NEUTRAL_ROOT = "/srv/g6";
export const NETFENCE_UID = "g6arm";
/**
 * Where the per-run secret env file appears inside the fence.
 *
 * Not in $HOME: a control that lists its home directory sees every entry there,
 * and one of them literally read `.netenv` and reasoned about "the harness".
 * A dedicated read-only bind keeps $HOME empty and gives the arm no signboard.
 */
export const NET_ENV_FILE = "/srv/g6/env";

/** Where a path the arm may read/write lives once the uid has been dropped. */
export function neutralPath(kind) {
  return `${NEUTRAL_ROOT}/${kind}`;
}

/**
 * The iptables rules, in insertion order.
 *
 * `-I OUTPUT` prepends, so the REJECT goes in FIRST and the two allows go in
 * after it — otherwise the allows would sit below the reject and never match.
 * Each rule is scoped to the arm's uid, which is the whole point: the same
 * endpoint stays reachable from the harness and from this session.
 */
export function egressRules({ uid, endpointHost, endpointPort }) {
  const owner = ["-m", "owner", "--uid-owner", String(uid)];
  const rules = [
    // Everything not explicitly allowed, for this uid only.
    { why: "default deny for the arm uid", spec: [...owner, "-j", "REJECT"] },
    // The model endpoint. Without it the arm cannot answer at all.
    {
      why: "the model endpoint",
      spec: [...owner, "-p", "tcp", "-d", `${endpointHost}/32`, "--dport", String(endpointPort), "-j", "ACCEPT"],
    },
    // Loopback: local sockets the runtime needs, and nothing that leaves.
    { why: "loopback", spec: [...owner, "-o", "lo", "-j", "ACCEPT"] },
  ];
  return rules.map((rule) => ({ ...rule, add: ["-I", "OUTPUT", ...rule.spec], del: ["-D", "OUTPUT", ...rule.spec] }));
}

export function buildProfile({ denyRead }) {
  const flat = [...new Set(denyRead.filter((p) => typeof p === "string" && p.length > 0).flatMap(variants))];
  return ["(version 1)", "(allow default)", `(deny file-read* ${flat.map((p) => `(subpath ${JSON.stringify(p)})`).join(" ")} fit)`.replace(" fit", ""), ""].join("\n");
}

/** Deny list for one specific run: everything a blind run must not see. */
/**
 * Session logs under the experiment home are NOT denied: a run has to write its
 * own. They are deleted before the matrix instead — with `--control-first`, no
 * treatment session exists yet when the control runs.
 */
export function denyFor({ repo, home, arm, otherArm, artifacts }) {
  return [
    ...CHANNELS.repo(repo),
    ...CHANNELS.artifacts(artifacts),
    ...CHANNELS.hostState(home),
    ...CHANNELS.liveProfile(home),
    ...(otherArm === null || otherArm === void 0 ? [] : CHANNELS.otherArm(home, otherArm)),
    ...CHANNELS.abDocs(home, "ab-engram"),
  ];
}

/**
 * Whitelist profile: `(allow default)` keeps process/network sane, then
 * `(deny file-read*)` takes the whole filesystem away and the allows that FOLLOW
 * give back exactly what a run needs.
 *
 * Rule order is the load-bearing detail: seatbelt resolves overlapping rules
 * last-match-wins, so a later `allow` does override an earlier broad `deny`. That
 * is what makes a real whitelist possible here at all — round 5's deny list lost
 * because agents write scratch files into `/tmp` and read each other's.
 */
const SYSTEM_READ = [
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library",
  "/private/etc",
  "/private/var/db",
  "/private/var/folders",
  "/private/var/run",
  "/opt/homebrew",
  "/Applications",
  "/dev",
];

export function buildWhitelistProfile({ nodeDir, dshHome, ws, extraRead = [] }) {
  const read = [...SYSTEM_READ, nodeDir, dshHome, ws, ...extraRead];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-read*)",
    "(allow file-read-metadata)",
    ...read.map((p) => `(allow file-read* (subpath ${JSON.stringify(p)}))`),
    // The provider key lives outside the run's DSH_HOME.
    `(allow file-read* (literal ${JSON.stringify(`${process.env.HOME}/.dsh/.credentials.yaml`)}))`,
    ...variants(ws).map((spelling) => `(allow file-write* (subpath ${JSON.stringify(spelling)}))`),
    ...variants(path.dirname(path.dirname(dshHome))).map((spelling) => `(allow file-write* (subpath ${JSON.stringify(spelling)}))`),
    `(allow file-write* (subpath "/private/var/folders"))`,
    `(allow file-write* (subpath "/dev"))`,
    "",
  ].join("\n");
}

/**
 * Confinement profile — the one that survived contact with an adversarial
 * control arm.
 *
 * Two facts from the failures: a global `(deny file-read*)` is REJECTED by
 * sandbox-exec (the launcher aborts), and when rules overlap the LAST match wins.
 * So the fence is two broad denials — all of `/tmp` (where agents write scratch
 * files for each other) and the whole home directory — with narrow allows after
 * them, and narrow denials after those to carve back out the things a run must
 * still not see (the other arm's profile, everyone's session logs).
 */
/** Ancestor directories of `target`, nearest last. */
function ancestorsOf(target) {
  const out = [];
  let current = path.dirname(path.resolve(target));
  while (current !== "/" && current !== ".") {
    out.unshift(current);
    current = path.dirname(current);
  }
  return out;
}

export function buildConfinedProfile({ home, nodeDir, dshHome, ws, otherArmProfile, sessionsDir, credentials, repo = null, docsToHide = [], hideStore = false, hideRunsRoot = null }) {
  const lines = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath "/private/tmp") (subpath "/tmp") (subpath ${JSON.stringify(home)})${repo !== null ? ` (subpath ${JSON.stringify(repo)})` : ""})`,
    // getcwd(2) and realpath(3) stat every ancestor of the cwd; without metadata
    // on those (literal, one level at a time) node dies at startup with
    // `uv_cwd EPERM` / `realpath EPERM`.
    //
    // METADATA only, deliberately: `file-read*` on a directory literal also lets
    // the arm LIST it, and round 6's controls did exactly that — `ls
    // /private/tmp/g6r14` showed them `runs.json`, `arm-a` and `arm-b`, and 10 of
    // 20 reasoned about the evaluation matrix they had just discovered (they
    // could not read any of it; the fence held). Siblings stay unreadable because
    // metadata on the directory is not permission to enumerate or open entries.
    ...[...ancestorsOf(ws), ...ancestorsOf(dshHome), ...ancestorsOf(nodeDir)]
      .flatMap((dir) => variants(dir))
      .map((dir) => `(allow file-read-metadata (literal ${JSON.stringify(dir)}))`),
    `(allow file-read* (subpath ${JSON.stringify(nodeDir)}))`,
    // The run root (which holds this run's logs and, one level up, other runs)
    // is denied first so the ws allow below wins for the workspace alone.
    ...(hideRunsRoot === null ? [] : variants(hideRunsRoot).map((spelling) => `(deny file-read* (subpath ${JSON.stringify(spelling)}))`)),
    ...variants(ws).map((spelling) => `(allow file-read* (subpath ${JSON.stringify(spelling)}))`),
    // The whole DSH_HOME of the experiment: profiles, storages and the session
    // dir the runtime scans at boot. It is one home for both arms, so the other
    // arm's profile is re-denied below — that is the only part that matters.
    ...variants(path.dirname(path.dirname(dshHome))).map((spelling) => `(allow file-read* (subpath ${JSON.stringify(spelling)}))`),
    // The seeded memory store of the OTHER arm is the answer key: re-deny it.
    ...(otherArmProfile ? [`(deny file-read* (subpath ${JSON.stringify(otherArmProfile)}))`] : []),
    // Session logs of every run so far carry the solutions in plain text.
    // Session logs of earlier runs are readable (they hold no answers — the
    // controls run first), but the host's own sessions are not in this home.
    // $HOME itself must be resolvable (lstat/realpath) even though everything
    // beneath it is denied.
    `(allow file-read-metadata (literal ${JSON.stringify(home)}))`,
    `(allow file-read* (literal ${JSON.stringify(credentials)}))`,
    ...variants(ws).map((spelling) => `(allow file-write* (subpath ${JSON.stringify(spelling)}))`),
    ...variants(path.dirname(path.dirname(dshHome))).map((spelling) => `(allow file-write* (subpath ${JSON.stringify(spelling)}))`),
    ...(sessionsDir ? [`(allow file-write* (subpath ${JSON.stringify(sessionsDir)}))`] : []),
    `(allow file-write* (subpath "/private/var/folders"))`,
    `(allow file-write* (subpath "/dev"))`,
    // Last-match-wins: a docs/ shipped inside an arm's own package states the
    // corpus outright, so it goes after every allow (round 6, seam #7).
    ...(docsToHide ?? []).map((docs) => `(deny file-read* (subpath ${JSON.stringify(docs)}))`),
    ...(hideStore
      ? [`(deny file-read* (subpath ${JSON.stringify(path.join(path.dirname(path.dirname(dshHome)), "storages"))}))`]
      : []),
    "",
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- *
 * Linux: the same fence, expressed as mounts
 * ------------------------------------------------------------------------- */

/**
 * Bubblewrap fence for one run.
 *
 * The seatbelt profile above is a DENY list evaluated last-match-wins. bwrap has
 * no rule language, so the same contract becomes a mount list evaluated
 * first-mount-wins: start from the whole filesystem read-only, cover the two
 * channels that were the actual bugs with an empty tmpfs (they cease to exist
 * rather than being denied one path at a time), then bind back exactly what a
 * blind arm needs.
 *
 * Why start from `--ro-bind / /` and not `--unshare-all`: an arm is a coding
 * agent with a shell — it needs /usr, /bin, the toolchain and the network, and
 * the fence that survived contact with a real control arm is the one that hides
 * what the ANSWER is, not the one that hides the machine. What it must not see:
 *
 *   $HOME  — host store, host sessions (this very conversation), the live
 *            profiles, and the repo itself (fixtures, oracles, seed memories,
 *            git history) whenever the checkout lives under $HOME.
 *   /tmp   — scratch space agents write into for each other, plus this round's
 *            log dir and every previous round's artifacts. A private empty
 *            tmpfs is stronger than a deny list: the arm keeps a writable /tmp
 *            and still cannot name anything in the host's.
 *
 * What it gets back: its own workspace (rw), its own DSH_HOME (rw — dsh cannot
 * boot without it: profiles and sessions live there), the credential file (ro),
 * the node/dsh install if it happens to sit under $HOME, and a fresh
 * /dev + /proc. Nothing else, and the run root around `ws` is taken away too
 * (`hideRunsRoot`), so even this run's own log is unreadable from inside.
 *
 * The path string is now opaque as well: a run lives at `runs/<sha1>/ws`, so the
 * cwd no longer spells the arm, the task, the seed, or that a matrix is running
 * (docs/G6-quality-ab.zh.md §13.5 — this was the last residue of round 6).
 */
export function buildBwrapArgs({
  home = os.homedir(),
  nodeDir,
  dshHome,
  ws,
  otherArmProfile = null,
  sessionsDir = null,
  credentials = null,
  toolPaths = [],
  repo = null,
  docsToHide = [],
  hideStore = false,
  hideRunsRoot = null,
}) {
  const experimentHome = path.dirname(path.dirname(dshHome));
  const exists = (entry) => entry !== null && entry !== undefined && entry !== "" && fs.existsSync(entry);
  const args = [
    // The host, read-only. Nothing is writable until a later mount says so.
    "--ro-bind", "/", "/",
    // A fresh device tree (an arm needs /dev/null) and its own pids.
    "--dev", "/dev",
    "--proc", "/proc",
    // The fences. Order matters: whatever is tmpfs'd here disappears, and only
    // the explicit binds below can bring a path back.
    "--tmpfs", home,
    "--tmpfs", "/tmp",
    // The checkout, spelled out rather than inferred from where it happens to
    // live: on this host it sits under $HOME and the home tmpfs covers it, but a
    // checkout at /srv/… would otherwise be readable read-only through `--ro-bind / /` —
    // fixtures, oracles and seed memories included.
    ...(exists(repo) && !repo.startsWith(`${home}${path.sep}`) && repo !== home ? ["--tmpfs", repo] : []),
  ];
  // Give back what the run legitimately needs, most specific last.
  if (exists(nodeDir)) args.push("--ro-bind", nodeDir, nodeDir);
  for (const tool of toolPaths) if (exists(tool)) args.push("--ro-bind", tool, tool);
  // dsh boots out of this home: profiles/ (the mounted plugin) and sessions/.
  args.push("--bind", experimentHome, experimentHome);
  // The run's own root holds `ws` plus that run's logs. Take the root away and
  // give back only the workspace: an arm then cannot read its own run.log, and a
  // layout change that put siblings one level up cannot silently expose them.
  if (exists(hideRunsRoot) && hideRunsRoot !== ws) args.push("--tmpfs", hideRunsRoot);
  // The workspace is the only tree the arm may also WRITE, besides its tmp.
  args.push("--bind", ws, ws);
  if (exists(sessionsDir) && !sessionsDir.startsWith(`${experimentHome}${path.sep}`)) args.push("--bind", sessionsDir, sessionsDir);
  // The provider key lives outside the run's DSH_HOME; bind the file, not the dir.
  if (exists(credentials)) args.push("--ro-bind", credentials, credentials);
  // Re-deny inside the allowed home: the other arm's profile carries the seed.
  if (exists(otherArmProfile)) args.push("--tmpfs", otherArmProfile);
  // Every `docs/` shipped inside an arm's own plugin package. The package ships
  // this round's write-up with it, and that file states the codec formula
  // outright — a treatment arm that reads its own package could solve a task
  // without the memory the run is supposed to measure (round 6, seam #7).
  for (const docs of [CHANNELS.abDocs(home, "ab-engram")[0], ...(docsToHide ?? [])]) if (exists(docs)) args.push("--tmpfs", docs);
  // The seeded store, when this arm must not have it: the rename that hides it
  // stays on the same filesystem, so the fence has to make the directory itself
  // unreachable (an empty mount, not a missing one).
  if (hideStore) args.push("--tmpfs", path.join(experimentHome, "storages"));
  args.push("--unshare-pid", "--unshare-ipc", "--die-with-parent", "--chdir", ws);
  return args;
}

/**
 * The bwrap plan for a NET-FENCED run: same deny-by-hiding logic, one extra
 * constraint. The arm is about to drop to an unprivileged uid, and `$HOME` is
 * 0700, so the real paths are unusable to it. Everything it may touch is bound
 * at NEUTRAL_ROOT instead, and the real home is tmpfs'd away as before — which
 * also means the sibling arm's home is not merely hidden but absent.
 */
function buildNetBwrapArgs({ home, toolchain, armHome, ws, runTmp, runHome, envFile = null, repo = null, docsToHide = [] }) {
  const exists = (entry) => entry !== null && entry !== undefined && entry !== "" && fs.existsSync(entry);
  return [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    // The host's home disappears, and the neutral root is a fresh tmpfs that
    // only the binds below can populate. The sibling arm's home is not hidden
    // here — it is absent, because nothing under it is mounted at all.
    "--tmpfs", home,
    "--tmpfs", "/srv",
    "--dir", NEUTRAL_ROOT,
    // A fresh /tmp and $HOME per run: the arm keeps a writable scratch space and
    // cannot hand a file to the next row through either.
    "--bind", runTmp, "/tmp",
    "--bind", runHome, neutralPath("home"),
    // The toolchain (read-only) — never the experiment around it.
    ...(exists(toolchain) ? ["--ro-bind", toolchain, neutralPath("toolchain")] : []),
    // This arm's own DSH_HOME (the ARM HOME, which holds profiles/<arm>), and
    // only this one: dsh resolves `--profile` under it.
    "--bind", armHome, neutralPath("arm"),
    // The one credential, as a read-only single-file bind outside $HOME.
    ...(typeof envFile === "string" && envFile !== "" && fs.existsSync(envFile) ? ["--ro-bind", envFile, NET_ENV_FILE] : []),
    // The workspace is the only tree the arm may also write.
    "--bind", ws, neutralPath("ws"),
    ...(exists(repo) && !repo.startsWith(`${home}${path.sep}`) ? ["--tmpfs", repo] : []),
    // `--tmpfs` takes ONE path: a nested array here becomes "--tmpfs,a,b" in the
    // argv and bwrap rejects the whole plan (it did, in the first fenced smoke).
    ...docsToHide.filter(exists).flatMap((docs) => ["--tmpfs", docs]),
    "--unshare-pid", "--unshare-ipc", "--die-with-parent",
    "--chdir", neutralPath("ws"),
  ];
}

/**
 * The install root to bind read-only: `/…/lib/node_modules/@scope/pkg/lib/bin.js`
 * means `/…` is the prefix whose `bin/` and `lib/node_modules/` the launcher
 * needs. Walking to the `lib/node_modules` marker is the mechanical version of
 * "the toolchain, not the experiment" — a global prefix also holds other
 * people's packages, so only the prefix itself is mounted and only read-only.
 */
export function installRootOf(dshBin) {
  let real = dshBin;
  try {
    real = fs.realpathSync(dshBin);
  } catch {
    // not on disk: the spelled path is all there is
  }
  const marker = `${path.sep}lib${path.sep}node_modules${path.sep}`;
  const at = real.indexOf(marker);
  return at === -1 ? path.dirname(path.dirname(real)) : real.slice(0, at);
}

/**
 * Rewrite a host path into the namespace the net fence builds.
 *
 * The launcher is the one path this has to get right: `~/.npm-global/bin/dsh` is
 * unreadable to the dropped uid, so exec must name the neutral copy or the run
 * dies with ENOENT that looks like a missing binary.
 */
export function neutralizePath(target, { home = os.homedir(), props = {} } = {}) {
  const rules = [
    // Most specific first: the toolchain normally lives UNDER $HOME, so a rule
    // keyed on $HOME would rewrite the launcher into a path that does not exist.
    [props.toolchain ?? installRootOf(props.dshBin ?? target), neutralPath("toolchain")],
    [props.dshHome, neutralPath("arm")],
    [props.ws, neutralPath("ws")],
    [home, neutralPath("home")],
  ];
  for (const [from, to] of rules) {
    if (typeof from !== "string" || from === "") continue;
    if (target === from) return to;
    if (target.startsWith(`${from}${path.sep}`)) return `${to}${target.slice(from.length)}`;
  }
  return target;
}

/**
 * The environment the fenced arm gets.
 *
 * Deliberately a fresh, small environment rather than the operator's: the old
 * plan handed the arm `process.env` (a channel in its own right — DSH_* vars
 * name the experiment), and the credential file cannot be mounted any more
 * because the uid cannot read it. The keys travel in memory, from the parent's
 * already-lifted environment, and nothing else does.
 */
/**
 * The names of the credentials an arm legitimately needs: exactly the one its
 * model provider names, derived the same way the profile config derives it
 * (`local-vllm-61` → `LOCAL_VLLM_61_API_KEY`).
 *
 * Not "every key in the operator's environment". A control arm has no business
 * holding the paid API's key, and on this host argv is world-readable through
 * `ps`, so a key that is not needed is a key that must not be handed over.
 */
export function netKeyNames({ provider }) {
  if (typeof provider !== "string" || provider === "") return [];
  return [`${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`];
}

/** The env-file body: one assignment per line, sourced by the fence wrapper. */
export function netFenceSecretLines({ base = process.env, provider }) {
  return netKeyNames({ provider })
    .filter((name) => typeof base[name] === "string" && base[name] !== "")
    .map((name) => `${name}=${base[name]}`);
}

export function netFenceEnv({ base = process.env } = {}) {
  const env = {
    PATH: `${neutralPath("toolchain")}/bin:/usr/local/bin:/usr/bin:/bin`,
    HOME: neutralPath("home"),
    DSH_HOME: neutralPath("arm"),
    TMPDIR: "/tmp",
    LANG: base.LANG ?? "C.UTF-8",
    LC_ALL: base.LC_ALL ?? "",
  };
  if (env.LC_ALL === "") delete env.LC_ALL;
  // No credentials here: `env` lands in argv, and argv is visible to every user
  // on the host via `ps`. The key travels in a 0600 file inside the run's own
  // $HOME instead, which the wrapper below sources and which is deleted with the
  // row.
  return env;
}

/**
 * The install roots an arm needs on PATH when they happen to live under $HOME —
 * `~/.npm-global/bin/dsh` is the normal case on a dev box, and the home tmpfs
 * would otherwise take the launcher with it.
 *
 * Nothing here can carry an answer: it is the toolchain, not the experiment. The
 * rule is mechanical (PATH + the resolved launcher's package root), so it cannot
 * drift into "just allow this one directory" the way a hand-written list does.
 */
export function toolReadPaths({ home = os.homedir(), dshBin = "dsh", searchPath = process.env.PATH ?? "" } = {}) {
  const out = new Set();
  const add = (entry) => {
    if (typeof entry !== "string" || entry === "") return;
    const real = path.resolve(entry);
    if (real === home || real.startsWith(`${home}${path.sep}`)) out.add(real);
  };
  for (const entry of searchPath.split(":")) add(entry);
  if (path.isAbsolute(dshBin)) {
    add(path.dirname(dshBin));
    // The launcher is usually a SYMLINK into the package (`…/bin/dsh` →
    // `…/lib/node_modules/@scope/pkg/lib/bin.js`), so binding the bin directory
    // alone leaves execvp with a dangling link ("bwrap: execvp …: No such file").
    let real = dshBin;
    try {
      real = fs.realpathSync(dshBin);
    } catch {
      // not on disk: the spelled path is all there is
    }
    add(path.dirname(real));
    // …/lib/node_modules/@scope/pkg/lib/bin.js → allow THAT package, not the whole
    // global prefix: a global prefix is a directory full of other people's docs,
    // and one of them only has to mention the corpus once.
    const marker = `${path.sep}node_modules${path.sep}`;
    const at = real.indexOf(marker);
    if (at !== -1) {
      const rest = real.slice(at + marker.length).split(path.sep);
      const name = rest.slice(0, rest[0].startsWith("@") ? 2 : 1).join(path.sep);
      add(`${real.slice(0, at)}${marker}${name}`);
    }
  }
  return [...out];
}

/**
 * The one entry point the harness and the fence test both call.
 *
 * Keeping this in one place is the point: a test that builds its own profile
 * tests the profile, not the fence a run actually gets.
 */
export function fenceCommand({ platform = process.platform, cmd, argv, ...dims }) {
  if (platform === "darwin") {
    const file = path.join(os.tmpdir(), `g6-sandbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sb`);
    fs.writeFileSync(file, buildConfinedProfile(dims));
    return {
      cmd: "/usr/bin/sandbox-exec",
      argv: ["-f", file, cmd, ...argv],
      cleanup: () => fs.rmSync(file, { force: true }),
    };
  }
  if (platform === "linux") {
    const bwrap = ["/usr/bin/bwrap", "/bin/bwrap"].find((candidate) => fs.existsSync(candidate));
    if (bwrap === undefined) {
      throw new Error(
        "G6 needs an OS-level fence: install bubblewrap (apt install bubblewrap) or run on macOS with sandbox-exec. A matrix without it measures nothing (docs/G6-quality-ab.zh.md §10).",
      );
    }
    if (dims.net === null || dims.net === undefined) {
      return { cmd: bwrap, argv: [...buildBwrapArgs(dims), "--", cmd, ...argv], cleanup: () => {} };
    }
    // Net fenced: bubblewrap runs with the privilege to build the mount tree,
    // then drops to the arm's own uid for the command itself. Both halves are
    // needed and neither is optional — bwrap alone cannot bind paths the
    // dropped uid may not read, and the uid alone could read the experiment.
    const { uid, gid = uid, runTmp, runHome } = dims.net;
    const toolchain = dims.net.toolchain ?? dims.toolchain ?? installRootOf(cmd);
    if (!fs.existsSync(toolchain)) {
      throw new Error(`net fence: toolchain root ${toolchain} does not exist — the arm would exec a path that is not mounted`);
    }
    const armHome = dims.armHome ?? path.dirname(path.dirname(dims.dshHome));
    const plan = buildNetBwrapArgs({ ...dims, toolchain, armHome, runTmp, runHome, envFile: dims.net.envFile });
    const neutralCmd = neutralizePath(cmd, {
      home: dims.home ?? os.homedir(),
      props: { armHome, dshHome: dims.dshHome, ws: dims.ws, toolchain },
    });
    return {
      cmd: "/usr/bin/sudo",
      argv: [
        "-n",
        bwrap,
        ...plan,
        "--",
        // setpriv is `util-linux`, present on any host that has iptables.
        "/usr/bin/setpriv",
        `--reuid=${uid}`,
        `--regid=${gid}`,
        "--clear-groups",
        "--",
        "/usr/bin/env",
        "-i",
        ...Object.entries(netFenceEnv({ base: dims.baseEnv ?? process.env })).map(([key, value]) => `${key}=${value}`),
        // umask 000 so everything the arm writes stays readable/deletable by the
        // harness afterwards; the arm's files are graded, not kept secret. The
        // secret env file is sourced here rather than exported above, because
        // argv is readable by every user on the host.
        "/bin/sh",
        "-c",
        // `set -a` is not decoration: sourcing a plain file ASSIGNS the variable
        // in this shell but does not export it, so dsh starts without the key
        // and dies with MISSING_CREDENTIAL (which is at least how it was found).
        (dims.net.envFile ? `set -a; . ${NET_ENV_FILE}; set +a; ` : "") + 'umask 000; exec "$0" "$@"',
        neutralCmd,
        ...argv,
      ],
      // The environment is baked into the argv, not handed to sudo: sudo's
      // env_reset drops everything the harness passes (HOME becomes /root and
      // DSH_HOME vanishes — the first fenced smoke died in 0.1s on exactly
      // that). `env -i` inside the fence makes the arm's environment explicit
      // and keeps the operator's out of it.
      env: {},
      cleanup: () => {},
    };
  }
  throw new Error(
    `G6 has no OS-level fence for ${platform}: the two implemented mechanisms are macOS seatbelt and Linux bubblewrap. Do not run the matrix unfenced — say so instead.`,
  );
}
