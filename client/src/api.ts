/**
 * dsh-loom client: browser API client for the /api/dsh-loom route family.
 * Plain same-origin fetch (the SSH panel's proven pattern) — no RPC, no
 * WebSocket. Every endpoint is loopback-fenced on the host side.
 */

export const API_PREFIX = "/api/dsh-loom";

export interface MemoryRecord {
  id: string;
  workspace: string;
  kind: string;
  text: string;
  tags: string[];
  entity: string | null;
  sessionId: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  hits: number;
  signal: number;
  status: "active" | "archived";
  expiresAt: number | null;
}

export interface TaskRecord {
  id: string;
  workspace: string;
  name: string;
  description: string;
  state: "draft" | "active" | "stable";
  artifact: string | null;
  evaluation: string | null;
  memoryRefs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LinkRecord {
  id: string;
  workspace: string;
  source: string;
  relation: string;
  target: string;
  confidence: number;
  createdAt: number;
}

export interface WorkspaceCounts {
  memories: number;
  tasks: number;
  links: number;
}

export interface LoomConfig {
  autoCapture: boolean;
  sessionSearch: boolean;
  autoCapturePerSession: number;
  indexMaxLines: number;
  indexMaxChars: number;
  minIndexSignal: number;
  promoteHits: number;
  expireDays: number;
  maxMemoriesPerWorkspace: number;
  gcEnabled: boolean;
  gcStableRetentionDays: number;
}

export interface GcStats {
  lastRun: number;
  archivedMemories: number;
  archivedTasks: number;
  removedLinks: number;
}

export interface GcItem {
  id: string;
  workspace: string;
  reason: string;
  kind?: string;
  text?: string;
  name?: string;
  source?: string;
  relation?: string;
  target?: string;
}

export interface GcReport {
  dryRun: boolean;
  workspaces: string[];
  protectedMemories: number;
  archivedMemories: GcItem[];
  archivedTasks: GcItem[];
  removedLinks: GcItem[];
}

export interface IndexCost {
  chars: number;
  tokens: number;
  lines: number;
}

export interface LoomOverview {
  workspaces: Record<string, WorkspaceCounts>;
  kinds: Record<string, number>;
  totals: WorkspaceCounts;
  indexes: Record<string, IndexCost>;
  captures: { total: number; git: number; file: number; error: number };
  gc: GcStats;
  config: LoomConfig;
}

/** Error carrying the route's JSON error message. */
export class LoomApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoomApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LoomApiError(`HTTP ${response.status}: invalid JSON response`);
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new LoomApiError(message);
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

export class LoomApi {
  overview(): Promise<LoomOverview> {
    return readJson(fetch(`${API_PREFIX}/overview`));
  }

  memories(opts: { workspace?: string; q?: string; kind?: string; status?: string; limit?: number } = {}): Promise<{ items: MemoryRecord[] }> {
    return readJson(
      fetch(`${API_PREFIX}/memories${query({ workspace: opts.workspace, q: opts.q, kind: opts.kind, status: opts.status, limit: opts.limit })}`),
    );
  }

  tasks(workspace: string, includeStable = false): Promise<{ items: TaskRecord[] }> {
    return readJson(fetch(`${API_PREFIX}/tasks${query({ workspace, includeStable: includeStable ? "1" : undefined })}`));
  }

  links(workspace: string): Promise<{ items: LinkRecord[] }> {
    return readJson(fetch(`${API_PREFIX}/links${query({ workspace })}`));
  }

  config(): Promise<LoomConfig> {
    return readJson(fetch(`${API_PREFIX}/config`));
  }

  async archive(id: string, workspace: string): Promise<void> {
    await readJson(
      fetch(`${API_PREFIX}/memories/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace }),
      }),
    );
  }

  async remove(id: string, workspace: string): Promise<void> {
    await readJson(
      fetch(`${API_PREFIX}/memories/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, workspace }),
      }),
    );
  }

  gc(workspace: string | undefined, dryRun: boolean): Promise<{ report: GcReport }> {
    return readJson(
      fetch(`${API_PREFIX}/gc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(workspace ? { workspace } : {}),
          dryRun,
        }),
      }),
    );
  }
}
