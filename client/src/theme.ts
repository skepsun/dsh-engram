/**
 * dsh-engram client theme adapter.
 *
 * The DSH shell signals its theme only through the `color-scheme` CSS value
 * on <html> (e.g. `style="color-scheme: dark;"`); it does NOT expose any
 * `--dsh-color-*` design tokens. So this plugin defines its own small palette
 * and re-publishes it as scoped `--dsh-color-*` custom properties on the
 * section root. All the inline `var(--dsh-color-*, <fallback>)` styles in the
 * components then resolve against this scoped palette and adapt to the shell
 * theme (light/dark) automatically.
 *
 * `color-scheme` changes are observed (attribute mutations + media query) so
 * toggling Appearance in the shell re-themes the panel live, no reload needed.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export interface EngramPalette {
  text: string;
  surface: string;
  border: string;
  muted: string;
  mutedStrong: string;
  mutedWeak: string;
  hoverBg: string;
  primary: string;
}

const LIGHT: EngramPalette = {
  text: "#111827",
  surface: "#ffffff",
  border: "#e5e7eb",
  muted: "#6b7280",
  mutedStrong: "#4b5563",
  mutedWeak: "#9ca3af",
  hoverBg: "#f3f4f6",
  primary: "#2563eb",
};

const DARK: EngramPalette = {
  text: "#e6e9ef",
  surface: "#1c222b",
  border: "#37404e",
  muted: "#9aa4b5",
  mutedStrong: "#c9d0dc",
  mutedWeak: "#7d8796",
  hoverBg: "rgba(255,255,255,0.07)",
  primary: "#5b8cff",
};

function detectDark(): boolean {
  if (typeof window === "undefined") return false;
  const cs = getComputedStyle(document.documentElement).colorScheme;
  if (cs === "dark") return true;
  if (cs === "light") return false;
  // Fallback when the shell leaves color-scheme unset ("normal"):
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useEngramTheme(): { dark: boolean; vars: CSSProperties } {
  const [dark, setDark] = useState<boolean>(detectDark);

  useEffect(() => {
    const apply = () => setDark(detectDark());
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", apply);
    apply();
    return () => {
      mo.disconnect();
      mq.removeEventListener?.("change", apply);
    };
  }, []);

  const p = dark ? DARK : LIGHT;
  const vars = {
    color: p.text,
    "--dsh-color-surface": p.surface,
    "--dsh-color-border": p.border,
    "--dsh-color-muted": p.muted,
    "--dsh-color-muted-strong": p.mutedStrong,
    "--dsh-color-muted-weak": p.mutedWeak,
    "--dsh-color-hover-bg": p.hoverBg,
    "--dsh-color-primary": p.primary,
  } as CSSProperties;
  return { dark, vars };
}
