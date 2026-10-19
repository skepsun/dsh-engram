/**
 * dsh-engram entity pages (PROPOSAL-evolution §4 v0.7-B).
 *
 * `esr_node` used to be a dot on the graph: a name, a kind, edges. An entity
 * PAGE is the readable projection of everything the workspace knows about that
 * thing:
 *
 *   truth      — current claims (superseded rows excluded), preference first
 *   timeline   — newest anchored memories
 *   open loops — active ESR tasks hanging on the entity
 *   conflicts  — rows contradicted by / contradicting another row
 *   relations  — typed links in and out
 *
 * Two renderings:
 *   - `renderEntityCard` — ONE line for the [ENGRAM] index (the model sees it
 *     every session and drills with `engram_detail(entity=…)`);
 *   - `renderEntityPage` — the full page returned by that drill / the GUI.
 *
 * Pure functions over the store; zero LLM, deterministic ordering.
 */

import { escapeLt, fmtDate, shortId, truncate } from "./util.js";
import { evidenceGaps } from "./index-block.js";
import { memoryIsStale } from "./anchor.js";

const TRUTH_KINDS = new Set(["preference", "decision", "fact", "insight", "procedure"]);

/** Find an entity by id or name (case-insensitive), or return a virtual one. */
export function resolveEntity(store, workspace, key) {
  const raw = String(key ?? "").trim();
  if (raw.length === 0) return null;
  const entities = typeof store?.listEntities === "function" ? store.listEntities(workspace) : [];
  const lower = raw.toLowerCase();
  const found = entities.find(
    (entity) => String(entity.id).toLowerCase() === lower || String(entity.name).toLowerCase() === lower,
  );
  if (found !== void 0) return found;
  // A name that has memories/tasks anchored but no registered node still
  // deserves a page — the anchor itself is the identity.
  return { id: raw, workspace, name: raw, kind: "", description: "", createdAt: 0, updatedAt: 0, sessionId: "" };
}

function byUpdatedDesc(a, b) {
  return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0);
}

function matchesAnchor(memory, entity, key) {
  const anchor = memory?.entity;
  if (typeof anchor !== "string" || anchor.length === 0) return false;
  return anchor === entity.id || anchor === entity.name || anchor === key;
}

/**
 * Build the page projection for one entity.
 *
 * @param {object} store opened engram domain
 * @param {string} workspace normalized workspace key
 * @param {string} key entity id or display name
 */
export function buildEntityPage(store, workspace, key, { timelineLimit = 8 } = {}) {
  const entity = resolveEntity(store, workspace, key);
  if (entity === null) return null;
  const anchored = (store.timeline?.(workspace, entity.name || key, 100) ?? [])
    .filter((memory) => matchesAnchor(memory, entity, String(key).trim()));
  const relations = store.memoryRelations?.(workspace) ?? { supersededBy: new Map(), contradictedBy: new Map() };
  const supersededBy = relations.supersededBy ?? new Map();
  const contradictedBy = relations.contradictedBy ?? new Map();
  const fresh = anchored.filter((memory) => !supersededBy.has(memory.id));

  const truth = fresh
    .filter((memory) => TRUTH_KINDS.has(memory.kind))
    .filter((memory) => !memoryIsStale(memory))
    .sort((a, b) => (Number(b.kind === "preference") - Number(a.kind === "preference")) || byUpdatedDesc(a, b))
    .slice(0, 6);
  const timeline = fresh.slice().sort(byUpdatedDesc).slice(0, timelineLimit);
  const openTasks = (store.listTasks?.(workspace) ?? []).filter(
    (task) => task.entity === entity.id || task.entity === entity.name || task.entity === String(key).trim(),
  );
  const links = [];
  const seen = new Set();
  for (const relation of [
    ...(store.linksFor?.(workspace, entity.id) ?? []),
    ...(entity.name !== entity.id ? store.linksFor?.(workspace, entity.name) ?? [] : []),
  ]) {
    if (seen.has(relation.id)) continue;
    seen.add(relation.id);
    links.push(relation);
  }
  const conflictSeen = new Set();
  const conflicts = [];
  for (const memory of anchored) {
    const contradicted = contradictedBy.get(memory.id)?.[0]?.id ?? null;
    const contradicts = typeof memory.contradicts === "string" && memory.contradicts.length > 0 ? memory.contradicts : null;
    const other = contradicted ?? contradicts;
    if (other === null) continue;
    const pair = [memory.id, other].sort().join("|");
    if (conflictSeen.has(pair)) continue;
    conflictSeen.add(pair);
    conflicts.push({ memory, contradictedById: contradicted, contradictsId: contradicts });
  }

  const updatedAt = Math.max(
    entity.updatedAt ?? 0,
    ...anchored.map((memory) => memory.updatedAt ?? memory.createdAt ?? 0),
    ...openTasks.map((task) => task.updatedAt ?? 0),
    0,
  );

  return {
    entity,
    anchored,
    truth,
    timeline,
    openTasks,
    links,
    conflicts,
    counts: {
      memories: fresh.length,
      openTasks: openTasks.filter((task) => task.state === "active").length,
      conflicts: conflicts.length,
      links: links.length,
    },
    updatedAt,
  };
}

/**
 * ONE index line for an entity with something worth surfacing. The drill
 * pointer is never truncated away: the head (and truth excerpt) shrink first.
 */
export function renderEntityCard(page, { maxChars = 160 } = {}) {
  if (page === null) return "";
  const name = page.entity.name || page.entity.id;
  const pointer = ` · page: engram_detail(entity="${escapeLt(name)}")`;
  const kind = page.entity.kind ? ` · ${page.entity.kind}` : "";
  let head = `[ENT] ${escapeLt(truncate(name, 40))}${kind} · ${page.counts.memories} mem · ${page.counts.openTasks} open`;
  if (head.length + pointer.length > maxChars) {
    head = truncate(head, Math.max(12, maxChars - pointer.length - 1));
  }
  const truth = page.truth[0];
  if (truth !== void 0) {
    const room = maxChars - head.length - pointer.length - " · truth: ".length - 9;
    if (room >= 12) {
      const text = truncate(String(truth.text).replace(/\s+/g, " ").trim(), room);
      head += ` · truth: ${text} #${shortId(truth.id)}`;
    }
  }
  return `${head}${pointer}`;
}

/** Full page text (engram_detail drill / GUI later). */
export function renderEntityPage(page, { maxChars = 2400 } = {}) {
  if (page === null) return "no such entity";
  const name = page.entity.name || page.entity.id;
  const lines = [];
  const header = [`ent:${name}`, page.entity.kind, `${page.counts.memories} memory`, `${page.counts.openTasks} open`]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" · ");
  lines.push(`${header} · updated ${fmtDate(page.updatedAt)} #${page.entity.id}`);
  if (typeof page.entity.description === "string" && page.entity.description.length > 0) {
    lines.push(`description: ${truncate(page.entity.description, 200)}`);
  }
  if (page.truth.length > 0) {
    lines.push("truth:");
    for (const memory of page.truth) {
      lines.push(`- [${memory.kind}] ${truncate(String(memory.text).replace(/\s+/g, " "), 180)} #${shortId(memory.id)}`);
    }
  }
  if (page.timeline.length > 0) {
    lines.push("timeline:");
    for (const memory of page.timeline) {
      const stale = memoryIsStale(memory) ? " · stale" : "";
      lines.push(`- ${fmtDate(memory.createdAt)} [${memory.kind}] ${truncate(String(memory.text).replace(/\s+/g, " "), 120)} #${shortId(memory.id)}${stale}`);
    }
  }
  if (page.openTasks.length > 0) {
    lines.push("open loops:");
    for (const task of page.openTasks) {
      const gaps = evidenceGaps(task);
      const state = task.state === "stable" ? "STABLE" : gaps.length === 0 ? "READY" : `gap: ${gaps.join(", ")}`;
      lines.push(`- ${task.id} ${truncate(String(task.name), 80)} — ${state}`);
    }
  }
  if (page.links.length > 0) {
    lines.push("relations:");
    for (const relation of page.links.slice(0, 10)) {
      lines.push(`- ${relation.source} --${relation.relation}--> ${relation.target} (${Math.round((relation.confidence ?? 1) * 100)}%)`);
    }
  }
  if (page.conflicts.length > 0) {
    lines.push("conflicts:");
    for (const conflict of page.conflicts) {
      const other = conflict.contradictedById ?? conflict.contradictsId;
      lines.push(`- #${shortId(conflict.memory.id)} ${other === null ? "(unresolved)" : `vs #${shortId(other)}`}`);
    }
  }
  lines.push("drill: engram_detail(id=…) · engram_recall(query) · esr_status");
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}
