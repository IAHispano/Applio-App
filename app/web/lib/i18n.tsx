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

const I18N_STORAGE_KEY = "applio:i18n-cache";

interface CachedI18n {
  code: string;
  dict: Record<string, string>;
}

const I18nCtx = createContext<{ t: TFn; code: string; loaded: boolean }>({
  t: (k, vars) => interpolate(k, vars),
  code: "en_US",
  loaded: false,
});

export function useI18n(): { t: TFn; code: string; loaded: boolean } {
  return useContext(I18nCtx);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [dict, setDict] = useState<Record<string, string>>({});
  const [code, setCode] = useState("en_US");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;

    // Instant local cache restore
    try {
      const raw = localStorage.getItem(I18N_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as CachedI18n;
        if (cached?.code && cached?.dict) {
          setCode(cached.code);
          setDict(cached.dict);
          setLoaded(true);
          if (typeof document !== "undefined") {
            const shortCode = cached.code.split("_")[0] || "en";
            document.documentElement.lang = shortCode;
          }
        }
      }
    } catch {
      /* non-fatal */
    }

    const load = () => {
      const clientLang =
        typeof navigator !== "undefined" ? navigator.languages?.join(",") || navigator.language || "" : "";
      const query = clientLang ? `?clientLang=${encodeURIComponent(clientLang)}` : "";

      apiGet<{ code: string; dict: Record<string, string> }>(`/api/settings/language${query}`, {
        force: true,
      })
        .then((r) => {
          if (!live) return;
          const langCode = r.code || "en_US";
          setCode(langCode);
          setDict(r.dict || {});
          setLoaded(true);
          if (typeof document !== "undefined") {
            const shortCode = langCode.split("_")[0] || "en";
            document.documentElement.lang = shortCode;
          }
          try {
            localStorage.setItem(I18N_STORAGE_KEY, JSON.stringify({ code: langCode, dict: r.dict || {} }));
          } catch {
            /* ignore storage errors */
          }
        })
        .catch(() => {
          if (live) setLoaded(true);
        });
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

  return <I18nCtx.Provider value={{ t, code, loaded }}>{children}</I18nCtx.Provider>;
}
