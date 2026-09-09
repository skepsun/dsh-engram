/**
 * dsh-engram client: self-sufficient settings scope for the config card.
 *
 * DSH's blessed `settingsScope` binder hard-codes persistence to `memory`
 * (status forever `unavailable`) whenever the browser is NOT reachable over a
 * loopback-origin connection — e.g. the GUI opened through an
 * operator-authorized cloudflare tunnel. That makes every plugin's config
 * card render empty and gray off-loopback, a DSH design decision dsh-engram
 * cannot change. The previous connection transport was removed in DSH 0.1.5;
 * the same host-backed calls now live on the typed `ctx.remote.settings`
 * namespace. This controller drives that namespace directly, preserving host
 * persistence without the `isLoopback` gate. Values are plain JSON; we skip
 * schemastery validation to keep the bundle's value-import surface to React
 * only.
 */

export interface SettingsNamespaceView {
  ns: string;
  value?: unknown;
  base?: unknown;
  user?: unknown;
  revision?: number;
  applies?: "live" | "restart";
}

export interface SettingsDescribeValue {
  namespaces?: SettingsNamespaceView[];
  writable?: boolean;
}

export interface SettingsMutation {
  op: "set" | "unset";
  path: string[];
  value?: unknown;
}

export interface SettingsRemoteResult<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

export interface SettingsRemote {
  describe(): Promise<SettingsRemoteResult<SettingsDescribeValue>>;
  mutate(
    ns: string,
    ops: SettingsMutation[],
    expectedRevision: number | undefined,
  ): Promise<SettingsRemoteResult<SettingsNamespaceView>>;
}

export type EngramScopeStatus = "loading" | "ready" | "unavailable" | "error";

export interface EngramScopeSnapshot<T> {
  status: EngramScopeStatus;
  /** Resolved value (composition base → user layer), or undefined before ready. */
  value: T | undefined;
  /** Composition base layer (plugin defaults), when served. */
  base: T | undefined;
  /** Raw user layer; a key present here marks it user-overridden. */
  user: T | undefined;
  /** Monotonic revision of the user section; send back on writes. */
  revision: number;
  /** Whether writes are permitted AND apply live. */
  writable: boolean;
  /** Human-readable reason when unavailable/error. */
  reason?: string;
}

export interface EngramScope<T> {
  load(): Promise<void>;
  getSnapshot(): EngramScopeSnapshot<T>;
  subscribe(listener: () => void): () => void;
  set<U extends keyof T>(key: U, value: T[U]): Promise<void>;
  unset<U extends keyof T>(key: U): Promise<void>;
}

/** Snapshot while the first read is still in flight. */
const LOADING: EngramScopeSnapshot<unknown> = {
  status: "loading",
  value: undefined,
  base: undefined,
  user: undefined,
  revision: 0,
  writable: false,
};

export class EngramScopeImpl<T> implements EngramScope<T> {
  private listeners = new Set<() => void>();
  private snapshot: EngramScopeSnapshot<T> = LOADING as EngramScopeSnapshot<T>;
  private disposed = false;

  constructor(private api: SettingsRemote, private ns: string, private opts: { writable: boolean } = { writable: true }) {}

  getSnapshot(): EngramScopeSnapshot<T> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private fail(reason: string, writable = false): void {
    this.snapshot = { status: "unavailable", value: undefined, base: undefined, user: undefined, revision: 0, writable, reason };
    this.notify();
  }

  async load(): Promise<void> {
    if (this.disposed) return;
    this.snapshot = LOADING as EngramScopeSnapshot<T>;
    this.notify();
    try {
      const result = await this.api.describe();
      if (!result || result.ok !== true) {
        const err = result?.error ?? { code: "settings.describe", message: "unreachable" };
        this.fail(`settings.describe failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
        return;
      }
      const payload = result.value ?? {};
      const view = payload.namespaces?.find((n) => n.ns === this.ns);
      if (!view) {
        this.fail(`the '${this.ns}' settings namespace is not served by this host.`);
        return;
      }
      const applied = view.applies === "live";
      const viewValue = (view.value ?? view.base) as T | undefined;
      this.snapshot = {
        status: "ready",
        value: viewValue,
        base: (view.base ?? view.value) as T | undefined,
        user: view.user as T | undefined,
        revision: view.revision ?? 0,
        writable: this.opts.writable !== false && payload.writable !== false && applied,
      };
      this.notify();
    } catch (error) {
      this.fail(`settings.describe threw: ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private async mutate(op: { op: "set" | "unset"; path: string[]; value?: unknown }): Promise<void> {
    const revision = this.snapshot.revision;
    const result = await this.api.mutate(this.ns, [op], revision);
    if (!result || result.ok !== true) {
      const err = result?.error ?? { code: "settings.mutate", message: "unreachable" };
      throw new Error(`settings.mutate failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
    }
    const view = result.value;
    if (view) this.snapshot = { ...this.snapshot, revision: view.revision ?? revision };
  }

  async set<U extends keyof T>(key: U, value: T[U]): Promise<void> {
    await this.mutate({ op: "set", path: [String(key)], value });
    this.notify();
  }

  async unset<U extends keyof T>(key: U): Promise<void> {
    await this.mutate({ op: "unset", path: [String(key)] });
    this.notify();
  }
}
