/**
 * Typecheck-time ambient shims for the DSH web-shell slot modules.
 *
 * The client bundle never imports these at runtime — they are type-only,
 * injected into the browser by the shell (see entry.tsx's bundle-purity
 * note). The external repo has no install of them, so we declare just enough
 * surface for `npm run typecheck` to verify OUR code's own types (strict
 * mode, unused locals/params) without pulling the shell's declarations.
 *
 * Keep this file honest: if a view starts relying on shell typing that the
 * real shell guarantees, extend the shim rather than widening it to `any`.
 */

declare module "@deepseek-ai/dsh-client-runtime/client" {
  /** Runtime client context injected by the shell; resolved types come from
   *  the real package in a full harness typecheck. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ClientContext = any;
}

declare module "@deepseek-ai/dsh-client-connection/api" {
  /** Minimal surface used by scope.ts (settings describe/mutate RPCs). */
  interface SettingsResult {
    ok?: boolean;
    value?: unknown;
    error?: { code?: string; message?: string };
  }
  export interface IApiClient {
    settings: {
      describe(opts?: unknown): Promise<{ result?: SettingsResult }>;
      mutate(opts: unknown): Promise<{ result?: SettingsResult }>;
    };
    [key: string]: unknown;
  }
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    [ns: string]: unknown;
  }
}

/* Side-effect slot registrations — the declared module only needs to exist
   for the type-only imports in entry.tsx to resolve. */
declare module "@deepseek-ai/dsh-client-ui-settings" {
  export {};
}
declare module "@deepseek-ai/dsh-client-ui-settings-plugins/client" {
  export {};
}
declare module "@deepseek-ai/dsh-client-ui-conversation/client" {
  export {};
}
declare module "@deepseek-ai/dsh-client-locale/client" {
  export {};
}
