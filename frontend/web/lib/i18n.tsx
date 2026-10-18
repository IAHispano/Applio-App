"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

// The API resolves the active language from settings or the OS locale and
// serves desktop dictionaries from assets/i18n/languages/*.json.
// Missing keys fall back to English.
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

let globalDict: Record<string, string> = {};

export function translate(key: string, vars?: Record<string, string | number>): string {
  if (typeof window !== "undefined" && Object.keys(globalDict).length === 0) {
    try {
      const raw = localStorage.getItem(I18N_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as CachedI18n;
        if (cached?.dict) globalDict = cached.dict;
      }
    } catch {
      /* non-fatal */
    }
  }
  return interpolate(globalDict[key] ?? key, vars);
}

const I18nCtx = createContext<{ t: TFn; code: string; loaded: boolean }>({
  t: (k, vars) => translate(k, vars),
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
          globalDict = cached.dict;
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
          globalDict = r.dict || {};
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

  const t = useCallback<TFn>((key, vars) => interpolate(dict[key] ?? key, vars), [dict]);
  const value = useMemo(() => ({ t, code, loaded }), [t, code, loaded]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}
