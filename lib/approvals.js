/**
 * v0.8-D: the approval gate for artifacts that leave the memory store.
 *
 * Why this exists: v0.8-A made a procedure promotable by evidence, and v0.8-B
 * turns promoted procedures into files in `.dsh/skills` that the host
 * advertises to every agent. Evidence proves a command *worked*; it does not
 * prove the instruction is *sound* — three successful runs of a harmful recipe
 * are still three successful runs. So the two surfaces are gated differently on
 * purpose:
 *
 *   - the [ENGRAM] index line is cheap, reversible and private → evidence gate
 *     (automatic, v0.8-A);
 *   - a skill file is durable, discoverable and shared → evidence gate **plus**
 *     an explicit human yes (this module).
 *
 * The record lives next to the ledger, not inside the memory store: an approval
 * is a human act, and mixing it into the pool would let the same pool "approve"
 * itself. Shape:
 *
 *   { "version": 1, "workspaces": { "<ws>": { "<memoryId>": { at, note } } } }
 */
import fs from "node:fs";
import path from "node:path";

export const APPROVALS_VERSION = 1;

export function approvalsPath(home) {
  return path.join(home, "playbook-approvals.json");
}

/** Read the approval file; a missing or corrupt file means "nothing approved". */
export function loadApprovals(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(approvalsPath(home), "utf8"));
    if (parsed === null || typeof parsed !== "object") return empty();
    return {
      version: APPROVALS_VERSION,
      workspaces: parsed.workspaces !== null && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
    };
  } catch {
    return empty();
  }
}

function empty() {
  return { version: APPROVALS_VERSION, workspaces: {} };
}

/** Approved ids for one workspace (empty when the workspace has none). */
export function approvedIds(state, workspace) {
  const bucket = state?.workspaces?.[workspace];
  return bucket !== null && typeof bucket === "object" ? Object.keys(bucket) : [];
}

export function isApproved(state, workspace, memoryId) {
  return state?.workspaces?.[workspace]?.[memoryId] !== undefined;
}

function save(home, state) {
  const file = approvalsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return state;
}

export function recordApproval(home, workspace, memoryId, { note = null, at = Date.now() } = {}) {
  if (typeof memoryId !== "string" || memoryId.length === 0) throw new Error("approve needs a memory id");
  const state = loadApprovals(home);
  state.workspaces[workspace] = state.workspaces[workspace] ?? {};
  state.workspaces[workspace][memoryId] = { at, note };
  return save(home, state);
}

export function revokeApproval(home, workspace, memoryId) {
  const state = loadApprovals(home);
  const bucket = state.workspaces[workspace];
  if (bucket !== undefined) {
    delete bucket[memoryId];
    if (Object.keys(bucket).length === 0) delete state.workspaces[workspace];
  }
  return save(home, state);
}
