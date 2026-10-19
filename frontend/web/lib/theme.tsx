"use client";

import { type ReactNode, useEffect } from "react";
import { apiGet } from "@/lib/api";

export interface ThemeFile {
  name?: string;
  version?: string;
  description?: string;
  mode?: string;
  effects?: string;
  colors?: Record<string, string>;
  // Arbitrary CSS custom properties. Escape hatch for anything the fixed
  // color/radius/shadow tables below do not cover (e.g. seasonal scene tokens).
  vars?: Record<string, string>;
  fonts?: { display?: string[]; body?: string[]; mono?: string[] };
  radius?: Record<string, string>;
  shadows?: Record<string, string>;
  titlebar?: { bg?: string; closeBg?: string; closeText?: string };
  custom_css?: string;
}

// Theme JSON keys -> CSS variables in globals.css
const COLOR_TO_VAR: Record<string, string> = {
  primary: "--accent",
  primarySoft: "--accent-soft",
  background: "--bg",
  surface: "--surface",
  surfaceDim: "--input-bg",
  panel: "--panel",
  border: "--border",
  text: "--text",
  heading: "--heading",
  muted: "--muted",
  ctaBg: "--cta-bg",
  ctaText: "--cta-text",
  buttonBg: "--button-bg",
  buttonBgHover: "--button-bg-hover",
  buttonTextHover: "--button-text-hover",
  buttonGhostText: "--button-ghost-text",
  buttonGhostBorder: "--button-ghost-border",
  buttonGhostBorderHover: "--button-ghost-border-hover",
  sliderTrack: "--slider-track",
  sliderThumb: "--slider-thumb",
  checkboxBorder: "--checkbox-border",
  checkboxBorderHover: "--checkbox-border-hover",
  checkboxChecked: "--checkbox-checked",
  checkboxCheck: "--checkbox-check",
  fileButtonBg: "--file-button-bg",
  fileButtonBorder: "--file-button-border",
  fileButtonText: "--file-button-text",
  fileButtonBgHover: "--file-button-bg-hover",
  focusBorder: "--focus-border",
  selectionBg: "--selection-bg",
  selectionText: "--selection-text",
  logBg: "--log-bg",
  ok: "--ok",
  warn: "--warn",
  err: "--err",
  dangerBg: "--danger-bg",
  dangerBorder: "--danger-border",
  dangerText: "--danger-text",
  dangerBgHover: "--danger-bg-hover",
  dangerBorderHover: "--danger-border-hover",
  dangerTextHover: "--danger-text-hover",
};

const RADIUS_TO_VAR: Record<string, string> = {
  card: "--radius-card",
  input: "--radius-input",
  button: "--radius-button",
  pill: "--radius-pill",
};

const SHADOW_TO_VAR: Record<string, string> = {
  card: "--shadow-card",
  button: "--shadow-button",
};

// A theme file may set any CSS custom property. Applied names are tracked so
// switching themes clears the previous theme's values instead of leaking them.
const appliedVars = new Set<string>();
const CSS_VAR_NAME = /^--[a-z0-9][a-z0-9-]*$/i;
const EFFECT_NAME = /^[a-z][a-z0-9-]*$/i;

// Families prefixed with "google:" are loaded from Google Fonts on demand
// (Gradio GoogleFont parity). Everything else is used as a system stack.
function fontStack(families: string[] | undefined): { css: string; google: string[] } {
  if (!families || families.length === 0) return { css: "", google: [] };
  const google: string[] = [];
  const stack = families
    .map((f) => {
      if (f === "google:Syne" || f === "Syne") return "var(--font-syne)";
      if (f.startsWith("google:")) {
        const name = f.slice("google:".length);
        google.push(name);
        return `"${name}"`;
      }
      return f.includes(" ") && !f.startsWith('"') ? `"${f}"` : f;
    })
    .join(", ");
  return { css: stack, google };
}

function ensureGoogleFont(name: string): void {
  const id = `applio-font-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

// Public CSS stack for a families array (used for the font picker preview).
export function fontCss(families: string[] | undefined): string {
  return fontStack(families).css;
}

export function applyTheme(theme: ThemeFile, file?: string): void {
  const root = document.documentElement;
  // A theme may declare any effect scene; unknown names simply render nothing.
  // Existing writable theme files can predate the effects marker in the bundle.
  const effect =
    typeof theme.effects === "string" && EFFECT_NAME.test(theme.effects)
      ? theme.effects
      : file === "halloween.json"
        ? "halloween"
        : "";
  root.dataset.themeEffects = effect;

  // Clear all previously applied theme CSS variables so switching cleanly resets
  for (const v of Object.values(COLOR_TO_VAR)) {
    root.style.removeProperty(v);
  }
  for (const v of Object.values(RADIUS_TO_VAR)) {
    root.style.removeProperty(v);
  }
  for (const v of Object.values(SHADOW_TO_VAR)) {
    root.style.removeProperty(v);
  }
  for (const name of appliedVars) {
    root.style.removeProperty(name);
  }
  appliedVars.clear();
  root.style.removeProperty("--titlebar-bg");
  root.style.removeProperty("--titlebar-close-bg");
  root.style.removeProperty("--titlebar-close-text");
  root.style.removeProperty("--font-display");
  root.style.removeProperty("--font-sans");
  root.style.removeProperty("--font-mono");
  document.body.style.fontFamily = "";
  root.dataset.themeMode = "dark";
  root.style.colorScheme = "dark";

  for (const [key, value] of Object.entries(theme.colors || {})) {
    const v = COLOR_TO_VAR[key];
    if (v && typeof value === "string") root.style.setProperty(v, value);
  }
  for (const [name, value] of Object.entries(theme.vars || {})) {
    if (!CSS_VAR_NAME.test(name) || typeof value !== "string") continue;
    root.style.setProperty(name, value);
    appliedVars.add(name);
  }
  if (theme.mode) {
    root.dataset.themeMode = theme.mode;
    root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
  }
  const fonts = theme.fonts || {};
  // A theme chooses one interface font for headings, controls and log output.
  const body = fontStack(fonts.body || fonts.display);
  for (const f of body.google) ensureGoogleFont(f);
  if (body.css) {
    root.style.setProperty("--font-sans", body.css);
    document.body.style.fontFamily = body.css;
  }
  for (const [key, value] of Object.entries(theme.radius || {})) {
    const v = RADIUS_TO_VAR[key];
    if (v && typeof value === "string") root.style.setProperty(v, value);
  }
  for (const [key, value] of Object.entries(theme.shadows || {})) {
    const v = SHADOW_TO_VAR[key];
    if (v && typeof value === "string") root.style.setProperty(v, value);
  }
  const titlebar = theme.titlebar || {};
  if (typeof titlebar.bg === "string") root.style.setProperty("--titlebar-bg", titlebar.bg);
  if (typeof titlebar.closeBg === "string") root.style.setProperty("--titlebar-close-bg", titlebar.closeBg);
  if (typeof titlebar.closeText === "string")
    root.style.setProperty("--titlebar-close-text", titlebar.closeText);
  // Gradio custom_css parity: raw CSS appended last, wins over tokens.
  let tag = document.getElementById("applio-theme-css");
  if (theme.custom_css) {
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "applio-theme-css";
      document.head.appendChild(tag);
    }
    tag.textContent = theme.custom_css;
  } else {
    tag?.remove();
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let live = true;
    const load = () => {
      apiGet<{ id: string; theme: ThemeFile }>("/api/settings/theme", { force: true })
        .then((r) => {
          if (live && r.theme) applyTheme(r.theme, r.id);
        })
        .catch(() => {});
    };
    load();
    // Re-apply when Settings saves a new theme (no reload needed).
    window.addEventListener("applio:theme-changed", load);
    return () => {
      live = false;
      window.removeEventListener("applio:theme-changed", load);
    };
  }, []);
  return <>{children}</>;
}
