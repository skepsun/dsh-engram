/**
 * dsh-engram client: self-sufficient settings scope for the config card.
 *
 * The card reads and writes the `dsh-engram` settings namespace through OUR
 * OWN `/api/dsh-engram/settings` HTTP route (plain same-origin fetch, like the
 * memory viewer) instead of the host's connection/remote settings RPC.
 *
 * Why: making the transport the plugin owns keeps the card
 * DSH-generation-agnostic — the host settings API family changed wholesale at
 * DSH `0.1.2-alpha.2` (the connection transport was removed), while this
 * route speaks the same shape on every generation because the host-side seam
 * (lib/settings.js `service.settings`) adapts for it. It also keeps the card
 * usable off-loopback the same way the memory viewer is (the same
 * loopback/trustedHosts fence, with the same documented opt-in).
 *
 * Values are plain JSON; we skip schemastery validation to keep the bundle's
 * value-import surface to React only — the host provider validates on write.
 */

import type { EngramApi, SettingsMutation, SettingsNamespaceView } from "./api";

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

  constructor(private api: EngramApi, private ns: string, private opts: { writable: boolean } = { writable: true }) {}

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
      const payload = await this.api.getSettings();
      const view: SettingsNamespaceView | undefined = payload.namespaces?.find((n) => n.ns === this.ns);
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
        writable: this.opts.writable !== false && applied,
      };
      this.notify();
    } catch (error) {
      this.fail(`settings fetch failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private async mutate(op: SettingsMutation): Promise<void> {
    const revision = this.snapshot.revision;
    await this.api.updateSettings([op], revision > 0 ? revision : undefined);
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
