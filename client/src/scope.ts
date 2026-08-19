/**
 * dsh-loom client: self-sufficient settings scope for the config card.
 *
 * DSH's blessed `settingsScope` binder hard-codes persistence to `memory`
 * (status forever `unavailable`) whenever the browser is NOT reachable over a
 * loopback-origin connection — e.g. the GUI opened through an
 * operator-authorized cloudflare tunnel. That makes every plugin's config
 * card render empty and gray off-loopback, a DSH design decision dsh-loom
 * cannot change. But the underlying RPCs (`connection.api.settings.describe` /
 * `.mutate`) DO work over a trusted host, which is exactly how the card gets
 * dispatched at all. So this controller drives the same namespace through the
 * connection's API client directly — same persistence (the host's settings
 * document), no isLoopback gate. Values are plain JSON; we skip schemastery
 * validation to keep the bundle's value-import surface to react only.
 */

import type { IApiClient } from "@deepseek-ai/dsh-client-connection/api";

export type LoomScopeStatus = "loading" | "ready" | "unavailable" | "error";

export interface LoomScopeSnapshot<T> {
  status: LoomScopeStatus;
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

export interface LoomScope<T> {
  load(): Promise<void>;
  getSnapshot(): LoomScopeSnapshot<T>;
  subscribe(listener: () => void): () => void;
  set<U extends keyof T>(key: U, value: T[U]): Promise<void>;
  unset<U extends keyof T>(key: U): Promise<void>;
}

interface NamespaceView {
  ns: string;
  value?: unknown;
  base?: unknown;
  user?: unknown;
  revision?: number;
  applies?: "live" | "restart";
}

/** Snapshot while the first read is still in flight. */
const LOADING: LoomScopeSnapshot<unknown> = {
  status: "loading",
  value: undefined,
  base: undefined,
  user: undefined,
  revision: 0,
  writable: false,
};

export class LoomScopeImpl<T> implements LoomScope<T> {
  private listeners = new Set<() => void>();
  private snapshot: LoomScopeSnapshot<T> = LOADING as LoomScopeSnapshot<T>;
  private disposed = false;

  constructor(private api: IApiClient, private ns: string, private opts: { writable: boolean } = { writable: true }) {}

  getSnapshot(): LoomScopeSnapshot<T> {
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
    this.snapshot = LOADING as LoomScopeSnapshot<T>;
    this.notify();
    try {
      const response = await this.api.settings.describe({});
      const result = response?.result;
      if (!result || result.ok !== true) {
        const err = result && "error" in result ? result.error : { code: "settings.describe", message: "unreachable" };
        this.fail(`settings.describe failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
        return;
      }
      const payload = result.value as { namespaces?: NamespaceView[]; writable?: boolean };
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
    const response = await this.api.settings.mutate({
      ns: this.ns,
      ops: [op],
      ...(revision ? { expectedRevision: revision } : {}),
    });
    const result = response?.result;
    if (!result || result.ok !== true) {
      const err = result && "error" in result ? result.error : { code: "settings.mutate", message: "unreachable" };
      throw new Error(`settings.mutate failed: ${String(err?.code ?? err)}: ${String(err?.message ?? "")}`);
    }
    const view = result.value as NamespaceView | undefined;
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
