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

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    [ns: string]: unknown;
  }
}

/* Side-effect client contracts — these modules contribute Context/SlotMap
   declarations in a full DSH install. The shims keep the standalone client
   typecheck independent of the harness checkout's package links. */
declare module "@deepseek-ai/dsh-api-remotes/client" {
  export {};
}
declare module "@deepseek-ai/dsh-client-ui-renderer/client" {
  export {};
}
declare module "@deepseek-ai/dsh-client-ui-settings/client" {
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
