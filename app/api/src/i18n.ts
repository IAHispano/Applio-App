import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getCodeRoot, getRepoRoot } from "@/python";

// Supported interface language codes shipped with full translation files.
export const SUPPORTED_LANGUAGES = [
  "ar_AR",
  "de_DE",
  "en_US",
  "es_ES",
  "fr_FR",
  "hi_IN",
  "id_ID",
  "it_IT",
  "ja_JA",
  "ko_KO",
  "pt_BR",
  "ru_RU",
  "tr_TR",
  "vi_VI",
  "zh_CN",
] as const;

// Native display names for locales in Applio settings
export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  af_AF: "Afrikaans",
  am_AM: "አማርኛ",
  ar_AR: "العربية",
  az_AZ: "Azərbaycan",
  ba_BA: "Башҡортса",
  be_BE: "Беларуская",
  bn_BN: "বাংলা",
  bs_BS: "Bosanski",
  ca_CA: "Català",
  ceb_CEB: "Cebuano",
  cs_CS: "Čeština",
  de_DE: "Deutsch",
  el_EL: "Ελληνικά",
  en_US: "English",
  es_ES: "Español",
  eu_EU: "Euskara",
  fa_FA: "فارسی",
  fj_FJ: "Na Vosa Vakaviti",
  fr_FR: "Français",
  ga_GA: "Gaeilge",
  gu_GU: "ગુજરાતી",
  he_HE: "עברית",
  hi_IN: "हिन्दी",
  hr_HR: "Hrvatski",
  ht_HT: "Kreyòl Ayisyen",
  hu_HU: "Magyar",
  id_ID: "Bahasa Indonesia",
  it_IT: "Italiano",
  ja_JA: "日本語",
  jv_JV: "Basa Jawa",
  ko_KO: "한국어",
  lt_LT: "Lietuvių",
  lv_LV: "Latviešu",
  mg_MG: "Malagasy",
  ml_IN: "മലയാളം",
  mr_MR: "मराठी",
  ms_MS: "Bahasa Melayu",
  mt_MT: "Malti",
  nl_NL: "Nederlands",
  otq_OTQ: "Hñähñu",
  pa_PA: "ਪੰਜਾਬੀ",
  pl_PL: "Polski",
  pt_BR: "Português (Brasil)",
  pt_PT: "Português (Portugal)",
  ro_RO: "Română",
  ru_RU: "Русский",
  sk_SK: "Slovenčina",
  sm_SM: "Gagana Sāmoa",
  sr_RS: "Српски",
  sw_SW: "Kiswahili",
  ta_IN: "தமிழ்",
  te_TE: "తెలుగు",
  th_TH: "ไทย",
  to_TO: "Lea faka-Tonga",
  tr_TR: "Türkçe",
  uk_UK: "Українська",
  ur_UR: "اردو",
  vi_VI: "Tiếng Việt",
  wu_WU: "吴语",
  zh_CN: "简体中文",
};

export function getLanguagesDir(): string {
  const codeDir = path.join(getCodeRoot(), "assets", "i18n", "languages");
  if (fs.existsSync(codeDir)) return codeDir;
  return path.join(getRepoRoot(), "assets", "i18n", "languages");
}

export function getAvailableLanguages(): string[] {
  const dir = getLanguagesDir();
  try {
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""));
      if (files.length > 0) return files.sort();
    }
  } catch {
    /* fallback to known list */
  }
  return [...SUPPORTED_LANGUAGES].sort();
}

let cachedSystemLocale: string | null = null;

/**
 * Detect the host operating system's display language / locale.
 */
export function detectSystemLocale(): string {
  if (cachedSystemLocale) return cachedSystemLocale;

  // 1. Explicit environment variable (injected by Electron or launcher)
  if (process.env.APPLIO_LOCALE && process.env.APPLIO_LOCALE.trim()) {
    cachedSystemLocale = process.env.APPLIO_LOCALE.trim();
    return cachedSystemLocale;
  }

  // 2. Standard POSIX environment variables (macOS / Linux)
  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
  if (envLocale && envLocale.trim()) {
    cachedSystemLocale = envLocale.trim();
    return cachedSystemLocale;
  }

  // 3. Windows registry lookup for user display language
  if (process.platform === "win32") {
    try {
      const qLanguages = spawnSync(
        "reg",
        ["query", "HKCU\\Control Panel\\International\\User Profile", "/v", "Languages"],
        { encoding: "utf-8", windowsHide: true },
      );
      if (qLanguages.status === 0 && qLanguages.stdout) {
        const match = qLanguages.stdout.match(/Languages\s+REG_MULTI_SZ\s+([^\r\n]+)/i);
        if (match?.[1]) {
          const firstLang = match[1].split(/\\0|\s+/)[0]?.trim();
          if (firstLang) {
            cachedSystemLocale = firstLang;
            return cachedSystemLocale;
          }
        }
      }

      const qLocale = spawnSync("reg", ["query", "HKCU\\Control Panel\\International", "/v", "LocaleName"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (qLocale.status === 0 && qLocale.stdout) {
        const match = qLocale.stdout.match(/LocaleName\s+REG_SZ\s+([^\r\n]+)/i);
        if (match?.[1]?.trim()) {
          cachedSystemLocale = match[1].trim();
          return cachedSystemLocale;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 4. Node runtime Intl resolved locale
  try {
    const intlLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale && intlLocale !== "und") {
      cachedSystemLocale = intlLocale;
      return cachedSystemLocale;
    }
  } catch {
    /* ignore */
  }

  cachedSystemLocale = "en_US";
  return cachedSystemLocale;
}

/**
 * Matches candidate locale strings (from OS, browser, or headers) against
 * available language packs in Applio. If matched, returns the language code;
 * otherwise defaults to English ("en_US").
 */
export function resolveSupportedLanguage(candidates?: string | (string | undefined | null)[]): string {
  const available = getAvailableLanguages();
  const list = Array.isArray(candidates) ? candidates : [candidates];

  for (const raw of list) {
    if (!raw || typeof raw !== "string") continue;
    // Handle comma/semicolon-separated values such as "es-ES,es;q=0.9,en;q=0.8"
    for (const item of raw.split(/[,;]/)) {
      let part = item.trim().split(";")[0]?.trim();
      if (!part || part.startsWith("q=")) continue;
      // Strip encoding like .UTF-8
      part = part.replace(/\..*$/, "").trim();
      const normalized = part.replace(/-/g, "_");

      // 1. Direct exact match (e.g. es_ES, de_DE, zh_CN)
      const direct = available.find((c) => c.toLowerCase() === normalized.toLowerCase());
      if (direct) return direct;

      // 2. Primary language subtag prefix match (e.g. "es-419", "es-MX" or "es" -> "es_ES")
      const prefix = part.split(/[-_]/)[0]?.toLowerCase();
      if (prefix) {
        const prefixMatch = available.find((c) => c.toLowerCase().startsWith(`${prefix}_`));
        if (prefixMatch) return prefixMatch;
      }
    }
  }

  return "en_US";
}

const dictCache = new Map<string, Record<string, string>>();

/**
 * Loads the dictionary JSON file for a given language code.
 */
export function loadLanguageDictionary(code: string): { code: string; dict: Record<string, string> } {
  const dir = getLanguagesDir();
  let resolvedCode = code;
  let file = path.join(dir, `${resolvedCode}.json`);

  if (!fs.existsSync(file)) {
    resolvedCode = resolveSupportedLanguage(code);
    file = path.join(dir, `${resolvedCode}.json`);
  }

  if (!fs.existsSync(file)) {
    resolvedCode = "en_US";
    file = path.join(dir, "en_US.json");
  }

  if (dictCache.has(resolvedCode)) {
    return { code: resolvedCode, dict: dictCache.get(resolvedCode)! };
  }

  let dict: Record<string, string> = {};
  try {
    if (fs.existsSync(file)) {
      dict = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, string>;
      dictCache.set(resolvedCode, dict);
    }
  } catch {
    /* return empty dictionary on read error */
  }

  return { code: resolvedCode, dict };
}
