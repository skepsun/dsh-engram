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

export function buildProfile({ denyRead }) {
  const flat = [...new Set(denyRead.filter((p) => typeof p === "string" && p.length > 0))];
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
