/**
 * macOS seatbelt profile for one G6 run.
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
 */
import fs from "node:fs";
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

export function buildConfinedProfile({ home, nodeDir, dshHome, ws, otherArmProfile, sessionsDir, credentials }) {
  const lines = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath "/private/tmp") (subpath "/tmp") (subpath ${JSON.stringify(home)}))`,
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
    "",
  ];
  return lines.join("\n");
}
