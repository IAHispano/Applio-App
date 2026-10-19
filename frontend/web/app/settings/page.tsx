"use client";

import {
  Activity,
  Check,
  Cpu,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  LogOut,
  Palette,
  Power,
  RefreshCw,
  Sliders,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import ReleaseChanges from "@/components/ReleaseChanges";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  FormField,
  SegmentedControl,
  SliderField,
  StatTile,
  ToggleField,
} from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, clearApiCache, displayVersion, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { createSettingsSaveQueue, restartApiAndWait } from "@/lib/settings-actions";
import { applyTheme, fontCss, type ThemeFile } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { type DesktopUpdaterState, desktopUpdater, type VersionCheckData } from "@/lib/update-policy";
import { useWorkspaceState } from "@/lib/workspace-state";

interface FontOption {
  id: string;
  label: string;
  families: string[];
}

// Interface font override: layers over any theme's body/display slots
// server-side (see /api/settings/theme), so it survives theme switches.
const BASE_FONT_OPTIONS: FontOption[] = [
  { id: "", label: "Theme default", families: [] },
  {
    id: "system",
    label: "System UI",
    families: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
  },
  { id: "syne", label: "Syne", families: ["google:Syne", "system-ui", "sans-serif"] },
  {
    id: "georgia",
    label: "Georgia (serif)",
    families: ["Georgia", "Times New Roman", "serif"],
  },
];

interface ThemePreset {
  id: string;
  name: string;
  subtitle: string;
  bg: string;
  surface: string;
  accent: string;
  border?: string;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "",
    name: "Default",
    subtitle: "Dark Slate",
    bg: "#060606",
    surface: "#141414",
    accent: "#ffffff",
    border: "rgba(255, 255, 255, 0.12)",
  },
  {
    id: "applio.json",
    name: "OG",
    subtitle: "Classic Applio",
    bg: "#110f0f",
    surface: "#262626",
    accent: "#9e9e9e",
    border: "#404040",
  },
  {
    id: "midnight.json",
    name: "Midnight",
    subtitle: "Navy & Cyan",
    bg: "#05080f",
    surface: "#0b1322",
    accent: "#7dd3fc",
    border: "#1a2540",
  },
  {
    id: "cyberpunk.json",
    name: "Cyberpunk",
    subtitle: "Neo-Tokyo Neon",
    bg: "#080512",
    surface: "#130b2e",
    accent: "#ff3d81",
    border: "#2c1656",
  },
  {
    id: "emerald.json",
    name: "Emerald",
    subtitle: "Botanical Jade",
    bg: "#031009",
    surface: "#0a231a",
    accent: "#34d399",
    border: "#16382c",
  },
  {
    id: "amethyst.json",
    name: "Amethyst",
    subtitle: "Obsidian Violet",
    bg: "#0b0716",
    surface: "#16102c",
    accent: "#c084fc",
    border: "#2c2150",
  },
  {
    id: "sunset.json",
    name: "Sunset",
    subtitle: "Espresso & Amber",
    bg: "#140c06",
    surface: "#29190d",
    accent: "#f59e0b",
    border: "#3d2514",
  },
  {
    id: "crimson.json",
    name: "Crimson",
    subtitle: "Ruby Obsidian",
    bg: "#140709",
    surface: "#290f13",
    accent: "#ef4444",
    border: "#3d171d",
  },
  {
    id: "halloween.json",
    name: "Halloween",
    subtitle: "Pumpkin & Midnight",
    bg: "#0c0811",
    surface: "#24172f",
    accent: "#ff9b42",
    border: "#4b355b",
  },
];

const SETTINGS_SECTIONS = [
  { value: "settings-general", label: "Preferences", icon: Sliders },
  { value: "settings-appearance", label: "Appearance", icon: Palette },
  { value: "settings-audio", label: "Audio engine", icon: Activity },
  { value: "settings-storage", label: "Storage", icon: HardDrive },
  { value: "settings-updates", label: "Updates", icon: RefreshCw },
  { value: "settings-application", label: "Application", icon: Power },
] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["value"];

interface AppConfig {
  logs_dir?: string;
  model_index_filter?: boolean;
  discord_presence?: boolean;
  lang?: { override: boolean; selected_lang: string };
  model_author?: string | null;
  precision?: string;
  rmvpe_high_register?: { enabled: boolean; mode: string; f0_ceil: number };
  version?: string;
  [key: string]: unknown;
}

type VersionCheck = Partial<VersionCheckData> & { error?: string };

export default function SettingsPage() {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useWorkspaceState<SettingsSection>(
    "page:settings:section",
    "settings-general",
  );
  const [cfg, setCfg] = useWorkspaceState<AppConfig | null>("page:settings:cfg", null);
  useEffect(() => {
    const synchronizeTheme = (event: Event) => {
      const file = (event as CustomEvent<{ file?: string }>).detail?.file;
      if (typeof file !== "string") return;
      setCfg((current) =>
        current
          ? {
              ...current,
              theme: {
                ...(typeof current.theme === "object" && current.theme !== null ? current.theme : {}),
                file,
              },
            }
          : current,
      );
    };
    window.addEventListener("applio:theme-changed", synchronizeTheme);
    return () => window.removeEventListener("applio:theme-changed", synchronizeTheme);
  }, [setCfg]);
  const [langs, setLangs] = useState<Array<{ code: string; name: string }>>([]);
  const [themes, setThemes] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      colors?: Record<string, string>;
      example: boolean;
    }>
  >([]);
  const [ver, setVer] = useWorkspaceState<VersionCheck | null>("page:settings:ver", null);
  const [localVer, setLocalVer] = useWorkspaceState("page:settings:localVer", "");
  const [updaterState, setUpdaterState] = useState<DesktopUpdaterState | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const saveSequence = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themePreview = useRef(0);
  const mounted = useRef(true);
  const [authorDraft, setAuthorDraft] = useWorkspaceState<string | null>("page:settings:authorDraft", null);
  const writeSettings = useMemo(
    () =>
      createSettingsSaveQueue(async (patch: Record<string, unknown>) => {
        const response = await apiSend<{ config: AppConfig }>("/api/settings", "PUT", patch);
        let presence: boolean | undefined;
        if (typeof patch.discord_presence === "boolean") {
          const result = await apiSend<{ running: boolean }>("/api/settings/presence", "POST", {
            enabled: patch.discord_presence,
          });
          presence = result.running;
        }
        return { config: response.config, presence };
      }),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);
  const [presenceRunning, setPresenceRunning] = useState<boolean | null>(null);
  const [restartMsg, setRestartMsg] = useState("");
  const [storageStats, setStorageStats] = useState<{
    uploadsBytes: number;
    uploadsCount: number;
    outputsBytes: number;
    outputsCount: number;
    totalBytes: number;
    totalFiles: number;
  } | null>(null);
  const [storageError, setStorageError] = useState("");
  const [storageLoading, setStorageLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [logsDirInput, setLogsDirInput] = useWorkspaceState<string | null>(
    "page:settings:logsDirInput",
    null,
  );
  const [activeLogsDir, setActiveLogsDir] = useWorkspaceState("page:settings:activeLogsDir", "");
  const [defaultLogsDir, setDefaultLogsDir] = useWorkspaceState("page:settings:defaultLogsDir", "");
  const [savingLogsDir, setSavingLogsDir] = useState(false);
  const [logsDirMessage, setLogsDirMessage] = useState("");
  const [canPickFolder, setCanPickFolder] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [canQuit, setCanQuit] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  useEffect(() => {
    setCanPickFolder(
      typeof (window as unknown as { applio?: { chooseFolder?: unknown } }).applio?.chooseFolder ===
        "function",
    );
    setCanQuit(typeof (window as unknown as { applio?: { quit?: unknown } }).applio?.quit === "function");
  }, []);

  async function chooseLogsFolder() {
    const bridge = (
      window as unknown as {
        applio?: { chooseFolder?: (defaultPath?: string) => Promise<string | null> };
      }
    ).applio;
    if (!bridge?.chooseFolder) return;
    setPickingFolder(true);
    setError("");
    try {
      const selected = await bridge.chooseFolder(logsDirInput || activeLogsDir || defaultLogsDir);
      if (selected) {
        setLogsDirInput(selected);
        setLogsDirMessage("");
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPickingFolder(false);
    }
  }

  async function saveLogsDir() {
    setSavingLogsDir(true);
    setLogsDirMessage("");
    setError("");
    try {
      const config = await save({ logs_dir: (logsDirInput ?? "").trim() });
      if (config) {
        setLogsDirInput(config.logs_dir || "");
        setLogsDirMessage(t("Saved. Restart Applio to move your files."));
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSavingLogsDir(false);
    }
  }

  const fetchStorage = useCallback(async () => {
    setStorageLoading(true);
    setStorageError("");
    try {
      const res = await apiGet<{
        stats: {
          uploadsBytes: number;
          uploadsCount: number;
          outputsBytes: number;
          outputsCount: number;
          totalBytes: number;
          totalFiles: number;
        };
      }>("/api/settings/storage", { force: true, ttlMs: 0 });
      setStorageStats(res.stats);
    } catch (cause) {
      setStorageError(errMsg(cause));
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const handleCleanStorage = async () => {
    setCleaning(true);
    setCleanMsg(null);
    try {
      const res = await apiSend<{ ok: boolean; result: { deletedFiles: number; freedBytes: number } }>(
        "/api/settings/storage/clean",
        "POST",
        { maxAgeMs: 0 },
      );
      const mb = (res.result.freedBytes / (1024 * 1024)).toFixed(1);
      setCleanMsg(t("Freed {mb} MB across {count} temporary files.", { mb, count: res.result.deletedFiles }));
      await fetchStorage();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCleaning(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const c = await apiGet<{
        config: AppConfig;
        logsDir: string;
        defaultLogsDir: string;
        logsMoveError?: string;
      }>("/api/settings");
      setCfg(c.config);
      setLogsDirInput((draft) => draft ?? c.config.logs_dir ?? "");
      setActiveLogsDir(c.logsDir);
      setDefaultLogsDir(c.defaultLogsDir);
      if (c.logsMoveError) setError(c.logsMoveError);
      const l = await apiGet<{ languages: string[]; named?: Array<{ code: string; name: string }> }>(
        "/api/settings/languages",
      );
      const named = l.named || l.languages.map((code) => ({ code, name: code }));
      setLangs(named);
      try {
        const th = await apiGet<{
          themes: Array<{
            id: string;
            name: string;
            description: string;
            colors?: Record<string, string>;
            example: boolean;
          }>;
        }>("/api/settings/themes");
        setThemes(th.themes);
      } catch {
        /* themes unavailable */
      }
      try {
        const p = await apiGet<{ running: boolean }>("/api/settings/presence");
        setPresenceRunning(p.running);
      } catch {
        /* presence unavailable (Discord closed?) */
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [setLogsDirInput, setDefaultLogsDir, setCfg, setActiveLogsDir]);

  const checkVersion = useCallback(async () => {
    setError("");
    const updater = desktopUpdater();
    if (updater) setUpdaterState({ status: "checking" });
    const [metadata, native] = await Promise.allSettled([
      apiGet<VersionCheck>("/api/settings/version-check?refresh=1", { ttlMs: 0 }),
      updater?.check(),
    ]);
    if (metadata.status === "fulfilled") setVer(metadata.value);
    else setVer({ error: errMsg(metadata.reason) });
    if (native.status === "fulfilled" && native.value) setUpdaterState(native.value);
    else if (native.status === "rejected")
      setUpdaterState({ status: "error", message: errMsg(native.reason) });
  }, [setVer]);

  async function installUpdate() {
    setInstallingUpdate(true);
    setError("");
    try {
      const updater = desktopUpdater();
      if (!updater) throw new Error(t("Desktop updater is unavailable."));
      await updater.quitAndInstall();
    } catch (cause) {
      setError(errMsg(cause));
      toast(errMsg(cause), "error");
    } finally {
      setInstallingUpdate(false);
    }
  }

  useEffect(() => {
    load();
    checkVersion();
    apiGet<{ version: string }>("/api/settings/version")
      .then((v) => setLocalVer(v.version))
      .catch(() => {});
    if (typeof window !== "undefined") {
      const bridge = (
        window as unknown as {
          applio?: {
            updater?: {
              getStatus: () => Promise<DesktopUpdaterState>;
              onStatusChange: (cb: (s: DesktopUpdaterState) => void) => () => void;
            };
          };
        }
      ).applio;
      if (bridge?.updater) {
        bridge.updater
          .getStatus()
          .then((st) => {
            if (st && st.status !== "idle") setUpdaterState(st);
          })
          .catch(() => {});
        const unsub = bridge.updater.onStatusChange((st) => {
          setUpdaterState(st);
        });
        return unsub;
      }
    }
  }, [load, checkVersion, setLocalVer]);

  useEffect(() => {
    if (activeSection === "settings-storage") void fetchStorage();
  }, [activeSection, fetchStorage]);

  async function save(patch: Record<string, unknown>): Promise<AppConfig | null> {
    const sequence = ++saveSequence.current;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setError("");
    setSaved("");
    setSaving(true);
    try {
      const result = await writeSettings(patch);
      if (typeof patch.lang !== "undefined") {
        window.dispatchEvent(new Event("applio:language-changed"));
      }
      if (mounted.current && sequence === saveSequence.current) {
        setCfg(result.config);
        setSaved(t("Saved"));
        savedTimer.current = setTimeout(() => setSaved(""), 2000);
      }
      if (mounted.current && result.presence !== undefined) setPresenceRunning(result.presence);
      return result.config;
    } catch (cause) {
      if (mounted.current) setError(errMsg(cause));
      return null;
    } finally {
      if (mounted.current && sequence === saveSequence.current) setSaving(false);
    }
  }

  async function restartApi() {
    if (restarting || quitting) return;
    setRestarting(true);
    setRestartMsg(t("API is restarting."));
    setError("");
    toast(t("API is restarting."), "info", { id: "settings-restart", duration: 45000 });
    try {
      await restartApiAndWait();
      clearApiCache();
      setRestartMsg(t("API restarted."));
      toast(t("API restarted."), "success", { id: "settings-restart" });
      await load();
    } catch (e) {
      setError(errMsg(e));
      setRestartMsg(t(errMsg(e)));
      toast(t(errMsg(e)), "error", { id: "settings-restart" });
    } finally {
      setRestarting(false);
    }
  }

  async function quitApplio() {
    if (quitting || restarting) return;
    setQuitting(true);
    setError("");
    toast(t("Quitting Applio…"), "info", { id: "settings-quit", duration: 30000 });
    try {
      const quit = (window as unknown as { applio?: { quit?: () => Promise<void> } }).applio?.quit;
      if (!quit) throw new Error(t("Desktop quit is unavailable."));
      await quit();
    } catch (e) {
      setQuitting(false);
      setError(errMsg(e));
      toast(errMsg(e), "error", { id: "settings-quit" });
    }
  }

  // Full Google Fonts catalog (~1900 entries): split out of the initial
  // bundle via dynamic import; the dropdown fills in once loaded.
  const [catalogFonts, setCatalogFonts] = useWorkspaceState<FontOption[]>("page:settings:catalogFonts", []);
  useEffect(() => {
    if (activeSection !== "settings-appearance" || catalogFonts.length > 0) return;
    let live = true;
    import("@/lib/google-fonts")
      .then((m) => {
        if (!live) return;
        setCatalogFonts(
          m.GOOGLE_FONT_FAMILIES.map((name: string) => ({
            id: `google:${name}`,
            label: name,
            families: [`google:${name}`, "system-ui", "sans-serif"],
          })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeSection, catalogFonts.length, setCatalogFonts]);
  const fontOptions = useMemo(() => [...BASE_FONT_OPTIONS, ...catalogFonts], [catalogFonts]);

  if (!cfg)
    return (
      <div className="w-full max-w-[1280px] mx-auto page-stack">
        <Card>
          <p className="field-help m-0" role="status">
            {t("Loading settings…")}
          </p>
          {error && <Alert variant="error">{error}</Alert>}
        </Card>
      </div>
    );

  const set = (path: string[], value: unknown) => {
    const next = structuredClone(cfg);
    let o: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i++) {
      if (!o[path[i]] || typeof o[path[i]] !== "object") o[path[i]] = {};
      o = o[path[i]] as Record<string, unknown>;
    }
    o[path[path.length - 1]] = value;
    setCfg(next);
  };

  const handleSelectTheme = async (themeId: string) => {
    const preview = ++themePreview.current;
    set(["theme", "file"], themeId);
    const persisted = save({ theme: { file: themeId } });
    if (!themeId) {
      applyTheme({
        name: "Default",
        colors: {},
        radius: {},
        shadows: {},
        fonts:
          selectedFontFamilies.length > 0
            ? { body: selectedFontFamilies, display: selectedFontFamilies }
            : {},
      });
    } else {
      try {
        const response = await apiGet<{ id: string; theme: ThemeFile }>(
          `/api/settings/theme?file=${encodeURIComponent(themeId)}`,
          { force: true },
        );
        if (mounted.current && preview === themePreview.current && response.theme) {
          applyTheme(response.theme, response.id);
        }
      } catch {
        // The persisted theme is loaded by the shared theme provider after saving.
      }
    }
    if ((await persisted) && preview === themePreview.current) {
      window.dispatchEvent(new Event("applio:theme-changed"));
    }
  };

  const customThemes: ThemePreset[] = themes
    .filter((th) => !th.example && !THEME_PRESETS.some((p) => p.id === th.id))
    .map((th) => ({
      id: th.id,
      name: th.name,
      subtitle: th.description ? th.description.slice(0, 24) : th.id.replace(/\.json$/, ""),
      bg: th.colors?.background || "#111",
      surface: th.colors?.surface || "#222",
      accent: th.colors?.primary || "#3b82f6",
      border: th.colors?.border || "rgba(255,255,255,0.12)",
    }));

  const allThemes = [...THEME_PRESETS, ...customThemes];
  const selectedThemeFile = (cfg.theme as { file?: string } | undefined)?.file || "";
  const selectedFontFamilies = (() => {
    const stored = (cfg.theme as { font?: unknown } | undefined)?.font;
    const match = fontOptions.find((o) => JSON.stringify(o.families) === JSON.stringify(stored));
    return match ? match.families : [];
  })();
  const selectedFontId =
    fontOptions.find((o) => JSON.stringify(o.families) === JSON.stringify(selectedFontFamilies))?.id ?? "";

  const handleSelectFont = async (id: string) => {
    const families = fontOptions.find((option) => option.id === id)?.families ?? [];
    set(["theme", "font"], families);
    if (await save({ theme: { file: selectedThemeFile, font: families } })) {
      window.dispatchEvent(new Event("applio:theme-changed"));
    }
  };

  return (
    <div className="w-full max-w-[1280px] mx-auto page-stack">
      <PageHeader
        title={t("Settings")}
        description={t("Configure application preferences, audio engine settings, precision, and language.")}
      >
        {(saving || saved) && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]"
            role="status"
            aria-live="polite"
          >
            {saving ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Check size={13} className="text-emerald-400" />
            )}
            {saving ? t("Saving…") : saved}
          </span>
        )}
        <Badge variant="neutral">{displayVersion(localVer || ver?.local || cfg.version)}</Badge>
      </PageHeader>

      <div className="flex flex-wrap items-center">
        <SegmentedControl
          value={activeSection}
          onChange={setActiveSection}
          ariaLabel={t("Settings sections")}
          tabPanels
          options={SETTINGS_SECTIONS.map((section) => ({ ...section, label: t(section.label) }))}
        />
      </div>

      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      <section
        id="panel-settings-general"
        role="tabpanel"
        aria-labelledby="tab-settings-general"
        hidden={activeSection !== "settings-general"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-general" && (
          <Card>
            <CardHeader
              icon={<Sliders size={18} />}
              title={t("General Preferences")}
              description={t("Configure search filter visibility, Discord Rich Presence, and UI locale.")}
            />

            <div className="space-y-3.5">
              <ToggleField
                id="settings-filter-checkbox"
                label={t("Model & index filter box")}
                checked={!!cfg.model_index_filter}
                onChange={(v) => {
                  set(["model_index_filter"], v);
                  save({ model_index_filter: v });
                }}
                description={t(SETTING_HELP.filterBox)}
              />

              <ToggleField
                id="settings-discord-checkbox"
                label={t("Discord Rich Presence")}
                checked={!!cfg.discord_presence}
                badge={
                  presenceRunning !== null && (
                    <span className="text-xs text-neutral-400" role="status">
                      ({presenceRunning ? t("running") : t("stopped")})
                    </span>
                  )
                }
                onChange={(v) => {
                  set(["discord_presence"], v);
                  save({ discord_presence: v });
                }}
                description={t(SETTING_HELP.discord)}
              />

              <div className="max-w-md 2xl:max-w-lg pt-1">
                <FormField
                  label={`${t("Interface Language")} (${langs.length} ${t("available")})`}
                  htmlFor="settings-lang"
                >
                  <CustomSelect
                    id="settings-lang"
                    value={cfg.lang?.override ? cfg.lang.selected_lang : ""}
                    searchable
                    searchPlaceholder={t("Search languages…")}
                    onChange={(e) => {
                      const nextLang = !e.target.value
                        ? { override: false, selected_lang: cfg.lang?.selected_lang || "en_US" }
                        : { override: true, selected_lang: e.target.value };
                      setCfg({ ...cfg, lang: nextLang });
                      save({ lang: nextLang });
                    }}
                    description={t(SETTING_HELP.language)}
                  >
                    <option value="">{t("Language automatically detected…")}</option>
                    {langs.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name} ({l.code})
                      </option>
                    ))}
                  </CustomSelect>
                </FormField>
              </div>
            </div>
          </Card>
        )}
      </section>

      <section
        id="panel-settings-appearance"
        role="tabpanel"
        aria-labelledby="tab-settings-appearance"
        hidden={activeSection !== "settings-appearance"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-appearance" && (
          <Card>
            <CardHeader
              icon={<Palette size={18} />}
              title={t("Appearance & Themes")}
              description={t(
                "Choose your visual palette and interface font. Clicking any theme immediately transforms the interface.",
              )}
            />

            <fieldset
              aria-label={t("Theme selection")}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-0 p-0 m-0"
            >
              {allThemes.map((opt) => {
                const isSelected = selectedThemeFile === opt.id;
                return (
                  <button
                    key={opt.id || "default"}
                    type="button"
                    onClick={() => handleSelectTheme(opt.id)}
                    className={`group relative flex flex-col p-3 rounded-xl text-left transition-all duration-150 cursor-pointer !shadow-none ${
                      isSelected
                        ? "border border-[var(--accent)] !bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                        : "border border-[var(--border)] hover:border-[var(--accent)] !bg-[var(--input-bg)]"
                    }`}
                    aria-pressed={isSelected}
                    title={`${t(opt.name)} — ${t(opt.subtitle)}`}
                  >
                    <div
                      aria-hidden="true"
                      className="w-full h-20 rounded-lg mb-3 p-2 flex gap-2 overflow-hidden border border-black/10"
                      style={{ backgroundColor: opt.bg }}
                    >
                      <span
                        className="w-1/4 rounded-md flex flex-col gap-1.5 p-1.5"
                        style={{ backgroundColor: opt.surface }}
                      >
                        <span className="h-1 rounded-full w-3/4" style={{ backgroundColor: opt.accent }} />
                        <span
                          className="h-1 rounded-full w-full opacity-20"
                          style={{ backgroundColor: opt.accent }}
                        />
                        <span
                          className="h-1 rounded-full w-2/3 opacity-20"
                          style={{ backgroundColor: opt.accent }}
                        />
                      </span>
                      <span className="flex-1 flex flex-col gap-2 py-1">
                        <span
                          className="h-1.5 w-2/3 rounded-full opacity-70"
                          style={{ backgroundColor: opt.accent }}
                        />
                        <span
                          className="flex-1 rounded-md"
                          style={{
                            backgroundColor: opt.surface,
                            border: `1px solid ${opt.border || opt.accent}`,
                          }}
                        />
                        <span
                          className="h-2 w-1/3 rounded-full self-end"
                          style={{ backgroundColor: opt.accent }}
                        />
                      </span>
                    </div>

                    {/* Theme text info */}
                    <div className="flex flex-wrap items-center justify-between gap-1 w-full">
                      <span
                        className={`text-xs tracking-tight truncate ${
                          isSelected
                            ? "font-bold text-[var(--heading)]"
                            : "font-medium text-[var(--muted)] group-hover:text-[var(--heading)]"
                        }`}
                      >
                        {t(opt.name)}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-bold text-[var(--accent,#ffffff)] shrink-0">
                          {t("Active")}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--muted)] truncate mt-0.5 w-full">
                      {t(opt.subtitle)}
                    </span>
                  </button>
                );
              })}
            </fieldset>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-1.5">
                <label htmlFor="theme-font">{t("Interface font")}</label>
                <CustomSelect
                  id="theme-font"
                  value={selectedFontId}
                  onValueChange={handleSelectFont}
                  className="w-64 max-w-full"
                  options={fontOptions.map((o) => ({
                    value: o.id,
                    label: o.id === "" ? t(o.label) : o.label,
                  }))}
                  description={t(SETTING_HELP.font)}
                />
              </div>
              <p
                className="text-sm text-[var(--muted)] m-0 pb-2 break-words min-w-0"
                style={
                  selectedFontFamilies.length > 0 ? { fontFamily: fontCss(selectedFontFamilies) } : undefined
                }
              >
                {t("The quick brown fox jumps over the lazy dog 0123456789")}
              </p>
            </div>
          </Card>
        )}
      </section>

      <section
        id="panel-settings-audio"
        role="tabpanel"
        aria-labelledby="tab-settings-audio"
        hidden={activeSection !== "settings-audio"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-audio" && (
          <>
            <Card>
              <CardHeader
                icon={<Cpu size={18} />}
                title={t("Training Engine")}
                description={t(
                  "Set default model author metadata and floating-point computation precision for training.",
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <FormField
                  label={t("Model Author Name")}
                  htmlFor="settings-model-author"
                  description={t(SETTING_HELP.author)}
                >
                  <input
                    id="settings-model-author"
                    type="text"
                    value={authorDraft ?? (cfg.model_author === "None" ? "" : cfg.model_author || "")}
                    onChange={(event) => setAuthorDraft(event.target.value)}
                    onBlur={async (event) => {
                      const value = event.target.value;
                      set(["model_author"], value || null);
                      if (await save({ model_author: value || null })) {
                        setAuthorDraft((current) => (current === value ? null : current));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder={t("None")}
                    aria-describedby={`${"settings-model-author"}-desc`}
                  />
                </FormField>
                <FormField label={t("Precision")} htmlFor="settings-precision">
                  <CustomSelect
                    id="settings-precision"
                    value={cfg.precision}
                    onChange={(e) => {
                      const v = e.target.value;
                      set(["precision"], v);
                      save({ precision: v });
                    }}
                    description={t(SETTING_HELP.precision)}
                  >
                    {["fp32", "fp16", "bf16"].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </CustomSelect>
                </FormField>
              </div>
            </Card>

            <Card>
              <CardHeader
                icon={<Activity size={18} />}
                title={t("RMVPE High Register")}
                description={t(
                  "Adjust pitch detection algorithm behavior and frequency ceiling for higher vocal registers.",
                )}
              />

              <div className="space-y-4">
                <ToggleField
                  id="settings-rmvpe-enabled"
                  label={t("Enable High Register")}
                  checked={!!cfg.rmvpe_high_register?.enabled}
                  onChange={(v) => {
                    const next = {
                      enabled: v,
                      mode: cfg.rmvpe_high_register?.mode || "true_pitch",
                      f0_ceil: cfg.rmvpe_high_register?.f0_ceil || 1250,
                    };
                    set(["rmvpe_high_register"], next);
                    save({ rmvpe_high_register: next });
                  }}
                  description={t(SETTING_HELP.highRegister)}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <FormField label={t("Mode")} htmlFor="settings-rmvpe-mode">
                    <CustomSelect
                      id="settings-rmvpe-mode"
                      value={cfg.rmvpe_high_register?.mode}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = {
                          enabled: !!cfg.rmvpe_high_register?.enabled,
                          mode: v,
                          f0_ceil: cfg.rmvpe_high_register?.f0_ceil || 1250,
                        };
                        set(["rmvpe_high_register"], next);
                        save({ rmvpe_high_register: next });
                      }}
                      description={t(SETTING_HELP.highMode)}
                    >
                      <option value="true_pitch">true_pitch</option>
                      <option value="fold">fold</option>
                    </CustomSelect>
                  </FormField>
                  <div>
                    <SliderField
                      id="settings-rmvpe-ceil"
                      label={t("F0 ceiling")}
                      value={cfg.rmvpe_high_register?.f0_ceil || 1250}
                      min={1000}
                      max={2000}
                      step={10}
                      unit="Hz"
                      onChange={(v) => {
                        const next = {
                          enabled: !!cfg.rmvpe_high_register?.enabled,
                          mode: cfg.rmvpe_high_register?.mode || "true_pitch",
                          f0_ceil: v,
                        };
                        set(["rmvpe_high_register"], next);
                        save({ rmvpe_high_register: next });
                      }}
                      description={t(SETTING_HELP.ceiling)}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </section>

      <section
        id="panel-settings-storage"
        role="tabpanel"
        aria-labelledby="tab-settings-storage"
        hidden={activeSection !== "settings-storage"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-storage" && (
          <Card>
            <CardHeader
              icon={<HardDrive size={18} />}
              title={t("Disk & Cache Storage")}
              description={t(
                "Choose where training data is stored, and manage temporary audio outputs, cached files, and upload storage to free up disk space.",
              )}
            />

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 items-start">
              <div className="space-y-3">
                <FormField
                  label={t("Training Data Folder")}
                  htmlFor="settings-logs-dir"
                  description={t(SETTING_HELP.storage)}
                >
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="settings-logs-dir"
                      type="text"
                      value={logsDirInput ?? ""}
                      onChange={(e) => setLogsDirInput(e.target.value)}
                      placeholder={defaultLogsDir}
                      readOnly={canPickFolder}
                      className="min-w-0 flex-1"
                      disabled={savingLogsDir || pickingFolder}
                      aria-describedby="settings-logs-dir-help"
                    />
                    {canPickFolder && (
                      <Button
                        size="md"
                        variant="ghost"
                        icon={<FolderOpen size={14} />}
                        onClick={chooseLogsFolder}
                        disabled={savingLogsDir || pickingFolder}
                      >
                        {t("Choose Folder")}
                      </Button>
                    )}
                  </div>
                </FormField>
                <p
                  id="settings-logs-dir-help"
                  className="text-xs text-neutral-400 m-0"
                  role="status"
                  aria-live="polite"
                >
                  {logsDirMessage ||
                    ((cfg.logs_dir || defaultLogsDir) !== activeLogsDir
                      ? t("Restart Applio to move your files.")
                      : t("Files move automatically after restarting Applio."))}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={saveLogsDir}
                    disabled={
                      savingLogsDir || pickingFolder || (logsDirInput ?? "").trim() === (cfg.logs_dir || "")
                    }
                  >
                    {savingLogsDir ? t("Saving…") : t("Save Folder")}
                  </Button>
                  <Button
                    size="md"
                    variant="ghost"
                    disabled={savingLogsDir || pickingFolder || !logsDirInput}
                    onClick={() => {
                      setLogsDirInput("");
                      setLogsDirMessage("");
                    }}
                  >
                    {t("Use Default")}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-4 space-y-4 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[var(--heading)]">{t("temporary files")}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={fetchStorage}
                    disabled={storageLoading || cleaning}
                    icon={<RefreshCw size={13} className={storageLoading ? "animate-spin" : ""} />}
                  >
                    {t("Refresh")}
                  </Button>
                </div>
                {storageError && <Alert variant="error">{storageError}</Alert>}
                {storageStats ? (
                  <>
                    <p className="text-2xl font-semibold tabular-nums text-[var(--heading)] m-0">
                      {(storageStats.totalBytes / (1024 * 1024)).toFixed(1)}{" "}
                      <span className="text-sm text-[var(--muted)]">MB</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <StatTile
                        label={t("uploads")}
                        value={`${(storageStats.uploadsBytes / (1024 * 1024)).toFixed(1)} MB`}
                        subtext={`${storageStats.uploadsCount} ${t("temporary files")}`}
                      />
                      <StatTile
                        label={t("temporary outputs")}
                        value={`${(storageStats.outputsBytes / (1024 * 1024)).toFixed(1)} MB`}
                        subtext={`${storageStats.outputsCount} ${t("temporary files")}`}
                      />
                    </div>
                  </>
                ) : (
                  !storageError && (
                    <p role="status" className="field-help m-0">
                      {t("Calculating disk usage…")}
                    </p>
                  )
                )}
                {cleanMsg && (
                  <p className="text-xs text-emerald-400 m-0" role="status">
                    {cleanMsg}
                  </p>
                )}
                <Button
                  size="md"
                  variant="ghost"
                  onClick={handleCleanStorage}
                  disabled={cleaning || storageLoading || !storageStats || storageStats.totalFiles === 0}
                  icon={<Trash2 size={14} />}
                  className="w-full"
                >
                  {cleaning ? t("Cleaning…") : t("Clean Temporary Files")}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </section>

      <section
        id="panel-settings-updates"
        role="tabpanel"
        aria-labelledby="tab-settings-updates"
        hidden={activeSection !== "settings-updates"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-updates" && (
          <Card>
            <CardHeader
              icon={<RefreshCw size={18} />}
              title={
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white m-0">{t("Version & Updates")}</h2>
                  <Badge variant="neutral">{displayVersion(localVer || ver?.local || cfg.version)}</Badge>
                </div>
              }
              description={t("Check for official Applio updates and apply package releases.")}
              action={
                <div className="flex items-center gap-2">
                  {(updaterState?.status === "available" ||
                    ((!updaterState || updaterState.status === "dev-mode") && ver?.status === "behind")) && (
                    <Button size="md" onClick={() => window.dispatchEvent(new Event("applio:show-update"))}>
                      {t("Update")}
                    </Button>
                  )}
                  {updaterState?.status === "downloaded" && (
                    <Button
                      size="md"
                      onClick={installUpdate}
                      loading={installingUpdate}
                      icon={<RefreshCw size={14} />}
                    >
                      {t("Restart and Update")}
                    </Button>
                  )}

                  <Button
                    size="md"
                    variant="ghost"
                    onClick={checkVersion}
                    disabled={
                      installingUpdate ||
                      updaterState?.status === "checking" ||
                      updaterState?.status === "downloading"
                    }
                    icon={
                      <RefreshCw
                        size={14}
                        className={`text-white ${updaterState?.status === "checking" ? "animate-spin" : ""}`}
                      />
                    }
                  >
                    {updaterState?.status === "checking" ? t("Checking…") : t("Check for Updates")}
                  </Button>
                </div>
              }
            />

            {/* Status display section */}
            <div className="space-y-3 pt-0.5">
              {updaterState && updaterState.status === "downloading" && (
                <div className="max-w-md space-y-1.5">
                  <div className="flex justify-between text-xs text-neutral-400 tabular-nums">
                    <span>{t("Downloading update…")}</span>
                  </div>
                  <ProgressBar
                    progress={updaterState.percent}
                    label={t("Downloading update…")}
                    activity={t("Downloading update…")}
                  />
                </div>
              )}

              {updaterState?.status === "available" && (
                <p className="text-xs text-neutral-300 m-0" role="status" aria-live="polite">
                  {t("Update available:")} {displayVersion(updaterState.version)}
                  {t(". Ready to download.")}
                </p>
              )}

              {updaterState?.status === "not-available" && (
                <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
                  {t("Applio is up to date")} ({displayVersion(updaterState.version || cfg.version)})
                </p>
              )}

              {updaterState?.status === "error" && (
                <p className="text-xs text-neutral-300 m-0" role="status" aria-live="polite">
                  {updaterState.message}
                </p>
              )}

              {(updaterState?.version || ver?.latest) && (
                <ReleaseChanges
                  local={localVer || ver?.local || String(cfg.version || "")}
                  latest={updaterState?.version || ver?.latest || ""}
                  notes={updaterState?.releaseNotes || ver?.releaseNotes}
                />
              )}

              {ver && (!updaterState || updaterState.status === "dev-mode") && (
                <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
                  {ver.error ||
                    `${displayVersion(ver.latest)} — ${
                      ver.status === "up-to-date"
                        ? t("Up to date")
                        : ver.status === "behind"
                          ? t("Update available")
                          : ver.status === "ahead"
                            ? t("Ahead of release")
                            : ver.status
                              ? t(ver.status)
                              : ""
                    }`}
                </p>
              )}

              {!updaterState && !ver && (
                <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
                  {t("Checking for updates…")}
                </p>
              )}
            </div>
          </Card>
        )}
      </section>

      <section
        id="panel-settings-application"
        role="tabpanel"
        aria-labelledby="tab-settings-application"
        hidden={activeSection !== "settings-application"}
        className="space-y-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {activeSection === "settings-application" && (
          <>
            <Card>
              <CardHeader
                icon={<Power size={18} />}
                title={t("Restart API")}
                description={t("Restarts the backend API service to apply system changes.")}
              />

              <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  {restartMsg && (
                    <span className="text-xs text-neutral-300" role="status" aria-live="polite">
                      {restartMsg}
                    </span>
                  )}
                </div>

                <Button
                  size="md"
                  variant="ghost"
                  onClick={restartApi}
                  loading={restarting}
                  disabled={quitting}
                  icon={<Power size={14} className="text-white" />}
                  className="w-full sm:w-auto"
                >
                  {restarting ? t("Restarting…") : t("Restart API")}
                </Button>
              </div>
            </Card>

            {canQuit && (
              <Card>
                <CardHeader
                  icon={<LogOut size={18} />}
                  title={t("Quit Applio")}
                  description={t("Fully exits Applio, including the tray icon and the background services.")}
                />

                <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <p className="text-xs text-[var(--muted)] m-0 leading-relaxed">
                    {t(
                      "Closing the window keeps Applio running in the system tray. Choose Quit Applio to exit completely.",
                    )}
                  </p>

                  <Button
                    size="md"
                    variant="ghost"
                    onClick={quitApplio}
                    loading={quitting}
                    disabled={restarting}
                    icon={<LogOut size={14} className="text-white" />}
                    className="w-full sm:w-auto"
                  >
                    {quitting ? t("Quitting Applio…") : t("Quit Applio")}
                  </Button>
                </div>
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}
