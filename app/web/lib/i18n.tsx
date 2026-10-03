"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

// Minimal Gradio I18nAuto parity: the API resolves the active language
// (settings override, else OS locale) and serves its dictionary from
// assets/i18n/languages/*.json. t(key) falls back to the key itself,
// which is English by convention — exactly like i18n("...") in app.py.
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}|\$\{(\w+)\}/g, (match, k1, k2) => {
    const key = k1 || k2;
    return key in vars ? String(vars[key]) : match;
  });
}

const I18nCtx = createContext<{ t: TFn; code: string }>({
  t: (k, vars) => interpolate(k, vars),
  code: "en_US",
});

export function useI18n(): { t: TFn; code: string } {
  return useContext(I18nCtx);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [dict, setDict] = useState<Record<string, string>>({});
  const [code, setCode] = useState("en_US");
  useEffect(() => {
    let live = true;
    const load = () => {
      apiGet<{ code: string; dict: Record<string, string> }>("/api/settings/language", { force: true })
        .then((r) => {
          if (!live) return;
          const langCode = r.code || "en_US";
          setCode(langCode);
          setDict(r.dict || {});
          if (typeof document !== "undefined") {
            const shortCode = langCode.split("_")[0] || "en";
            document.documentElement.lang = shortCode;
          }
        })
        .catch(() => {});
    };
    load();
    // Refetch when Settings saves a new language (no full reload needed).
    window.addEventListener("applio:language-changed", load);
    return () => {
      live = false;
      window.removeEventListener("applio:language-changed", load);
    };
  }, []);
  const t: TFn = (key, vars) => {
    const raw = dict[key] ?? key;
    return interpolate(raw, vars);
  };
  return <I18nCtx.Provider value={{ t, code }}>{children}</I18nCtx.Provider>;
}
