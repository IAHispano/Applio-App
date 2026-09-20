"use client";

import { Activity, Check, Cpu, Palette, Power, RefreshCw, Sliders } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  FormField,
  SliderField,
  ToggleField,
} from "@/components/ui";
import { apiGet, apiSend, displayVersion, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { applyTheme, type ThemeFile } from "@/lib/theme";

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
    bg: "#0b0f19",
    surface: "#131c2e",
    accent: "#38bdf8",
    border: "#1e293b",
  },
  {
    id: "cyberpunk.json",
    name: "Cyberpunk",
    subtitle: "Neon Magenta",
    bg: "#0d0221",
    surface: "#1d0838",
    accent: "#f43f5e",
    border: "#31115e",
  },
  {
    id: "emerald.json",
    name: "Emerald",
    subtitle: "Botanical Jade",
    bg: "#05140f",
    surface: "#0c2b21",
    accent: "#10b981",
    border: "#134233",
  },
  {
    id: "amethyst.json",
    name: "Amethyst",
    subtitle: "Obsidian Violet",
    bg: "#0e0918",
    surface: "#1e1333",
    accent: "#a855f7",
    border: "#2e1e4f",
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
];

interface AppConfig {
  model_index_filter?: boolean;
  discord_presence?: boolean;
  lang?: { override: boolean; selected_lang: string };
  model_author?: string | null;
  precision?: string;
  rmvpe_high_register?: { enabled: boolean; mode: string; f0_ceil: number };
  version?: string;
  [key: string]: unknown;
}

interface VersionCheck {
  local?: string;
  latest?: string;
  status?: string;
  error?: string;
}

interface DesktopUpdaterState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "dev-mode";
  version?: string;
  percent?: number;
  message?: string;
  releaseNotes?: string;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
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
  const [ver, setVer] = useState<VersionCheck | null>(null);
  const [updaterState, setUpdaterState] = useState<DesktopUpdaterState | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [presenceRunning, setPresenceRunning] = useState<boolean | null>(null);
  const [restartMsg, setRestartMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await apiGet<{ config: AppConfig }>("/api/settings");
      setCfg(c.config);
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
  }, []);

  const checkVersion = useCallback(async () => {
    setError("");
    const bridge =
      typeof window !== "undefined"
        ? (
            window as unknown as {
              applio?: {
                updater?: { check: () => Promise<{ status?: string }>; quitAndInstall: () => void };
              };
            }
          ).applio
        : undefined;

    if (bridge?.updater) {
      setVer(null);
      setUpdaterState({ status: "checking" });
      try {
        const res = await bridge.updater.check();
        if (res?.status === "dev-mode") {
          const v = await apiGet<VersionCheck>("/api/settings/version-check");
          setVer(v);
        }
      } catch (e) {
        setUpdaterState({ status: "error", message: errMsg(e) });
      }
      return;
    }

    try {
      setVer(await apiGet<VersionCheck>("/api/settings/version-check"));
    } catch (e) {
      setVer({ error: errMsg(e) });
    }
  }, []);

  useEffect(() => {
    load();
    checkVersion();
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
  }, [load, checkVersion]);

  async function save(patch: unknown) {
    setError("");
    setSaved("");
    try {
      const r = await apiSend<{ config: AppConfig }>("/api/settings", "PUT", patch);
      setCfg(r.config);
      if (typeof (patch as Record<string, unknown>).lang !== "undefined") {
        window.dispatchEvent(new Event("applio:language-changed"));
      }
      if (typeof (patch as Record<string, unknown>).discord_presence === "boolean") {
        try {
          const p = await apiSend<{ running: boolean }>("/api/settings/presence", "POST", {
            enabled: (patch as Record<string, unknown>).discord_presence,
          });
          setPresenceRunning(p.running);
        } catch (e) {
          setError(errMsg(e));
          return;
        }
      }
      setSaved(t("Saved"));
      setTimeout(() => setSaved(""), 2000);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function restartApi() {
    setRestartMsg("");
    setError("");
    try {
      const r = await apiSend<{ message: string }>("/api/settings/restart", "POST");
      setRestartMsg(r.message);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!cfg)
    return (
      <div className="w-full max-w-[1920px] mx-auto space-y-6">
        <div className="card">
          <p className="text-neutral-400">{t("Loading settings…")}</p>
          {error && <p className="text-neutral-300">{error}</p>}
        </div>
      </div>
    );

  const set = (path: string[], value: unknown) => {
    const next = structuredClone(cfg);
    let o: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] as Record<string, unknown>;
    o[path[path.length - 1]] = value;
    setCfg(next);
  };

  const handleSelectTheme = async (themeId: string) => {
    set(["theme", "file"], themeId);

    // Instant DOM visual update
    if (!themeId) {
      applyTheme({ name: "Default", colors: {}, radius: {}, shadows: {} });
    } else {
      try {
        const res = await apiGet<{ id: string; theme: ThemeFile }>(
          `/api/settings/theme?file=${encodeURIComponent(themeId)}`,
          { force: true },
        );
        if (res.theme) {
          applyTheme(res.theme);
        }
      } catch (err) {
        console.warn("Could not preview theme instantly:", err);
      }
    }

    try {
      await save({ theme: { file: themeId } });
      window.dispatchEvent(new Event("applio:theme-changed"));
    } catch (e) {
      setError(errMsg(e));
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

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      <PageHeader
        title={t("Settings")}
        description={t("Configure application preferences, audio engine settings, precision, and language.")}
      />

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3.5 rounded-xl border border-white/10 text-neutral-200 bg-white/5 text-sm"
        >
          {error}
        </div>
      )}
      {saved && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-xl border border-[var(--border)] text-[var(--heading)] bg-[var(--surface)] backdrop-blur-md text-xs font-medium shadow-xl flex items-center gap-2"
        >
          <Check size={14} className="text-emerald-400" />
          <span>{saved}</span>
        </div>
      )}

      {/* 1. General Preferences */}
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

      {/* 2. Appearance & Themes */}
      <Card>
        <CardHeader
          icon={<Palette size={18} />}
          title={t("Appearance & Themes")}
          description={t(
            "Choose your visual palette. Clicking any theme immediately transforms the interface.",
          )}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          {allThemes.map((opt) => {
            const isSelected = selectedThemeFile === opt.id;
            return (
              <button
                key={opt.id || "default"}
                type="button"
                onClick={() => handleSelectTheme(opt.id)}
                className={`group relative flex flex-col p-3 rounded-xl text-left transition-all duration-150 cursor-pointer !shadow-none ${
                  isSelected
                    ? "border-2 border-[var(--accent,#ffffff)] !bg-[var(--accent-soft,rgba(255,255,255,0.12))] ring-1 ring-[var(--accent,#ffffff)]/40"
                    : "border border-white/10 hover:border-white/25 !bg-transparent hover:!bg-white/[0.04]"
                }`}
                aria-pressed={isSelected}
                title={`${opt.name} — ${opt.subtitle}`}
              >
                {/* Clean 3-dot palette indicator preview */}
                <div className="flex items-center gap-1.5 mb-2.5 w-full">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs shrink-0"
                    style={{ backgroundColor: opt.bg }}
                    title={`Background: ${opt.bg}`}
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs shrink-0"
                    style={{ backgroundColor: opt.surface }}
                    title={`Surface: ${opt.surface}`}
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs shrink-0"
                    style={{ backgroundColor: opt.accent }}
                    title={`Accent: ${opt.accent}`}
                  />
                  {isSelected && (
                    <span
                      className="ml-auto w-4 h-4 rounded-full flex items-center justify-center shadow-xs shrink-0"
                      style={{
                        backgroundColor: opt.accent,
                        color: opt.accent === "#ffffff" ? "#000000" : "#ffffff",
                      }}
                    >
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>

                {/* Theme text info */}
                <div className="flex items-center justify-between gap-1 w-full">
                  <span
                    className={`text-xs tracking-tight truncate ${
                      isSelected
                        ? "font-bold text-white"
                        : "font-medium text-neutral-300 group-hover:text-white"
                    }`}
                  >
                    {opt.name}
                  </span>
                  {isSelected && (
                    <span className="text-[9px] font-bold text-[var(--accent,#ffffff)] uppercase tracking-wider shrink-0">
                      {t("Active")}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-neutral-400 truncate mt-0.5 w-full">{opt.subtitle}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* 3. Training Engine */}
      <Card>
        <CardHeader
          icon={<Cpu size={18} />}
          title={t("Training Engine")}
          description={t(
            "Set default model author metadata and floating-point computation precision for training.",
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <FormField label={t("Model Author Name")} htmlFor="settings-model-author">
            <input
              id="settings-model-author"
              type="text"
              value={cfg.model_author || ""}
              onChange={(e) => set(["model_author"], e.target.value || null)}
              onBlur={(e) => save({ model_author: e.target.value || null })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Applio"
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

      {/* 4. RMVPE High Register */}
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
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 5. Version & Updates */}
      <Card>
        <CardHeader
          icon={<RefreshCw size={18} />}
          title={
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white m-0">{t("Version & Updates")}</h2>
              <Badge variant="neutral">{displayVersion(cfg.version)}</Badge>
            </div>
          }
          description={t("Check for official Applio updates and apply package releases.")}
          action={
            <div className="flex items-center gap-2">
              {updaterState?.status === "downloaded" && (
                <Button
                  size="md"
                  onClick={() => {
                    (
                      window as unknown as { applio?: { updater?: { quitAndInstall: () => void } } }
                    ).applio?.updater?.quitAndInstall();
                  }}
                  icon={<RefreshCw size={14} />}
                >
                  {t("Restart and Update")}
                </Button>
              )}

              <Button
                size="md"
                variant="ghost"
                onClick={checkVersion}
                disabled={updaterState?.status === "checking" || updaterState?.status === "downloading"}
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
                <span>{updaterState.percent ?? 0}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-300"
                  style={{ width: `${updaterState.percent ?? 0}%` }}
                />
              </div>
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
              {t("Applio is up to date (")}
              {displayVersion(updaterState.version || cfg.version)}
              {")"}
            </p>
          )}

          {updaterState?.status === "error" && (
            <p className="text-xs text-neutral-300 m-0" role="status" aria-live="polite">
              {updaterState.message}
            </p>
          )}

          {updaterState?.status === "downloaded" && updaterState.releaseNotes && (
            <div className="max-w-xl p-3 rounded-xl bg-black/30 border border-white/5 space-y-1">
              <p className="text-xs text-neutral-400 font-medium m-0">
                {t("What's new in")} {displayVersion(updaterState.version)}
              </p>
              <p className="text-xs text-neutral-300 leading-relaxed m-0 whitespace-pre-wrap">
                {updaterState.releaseNotes}
              </p>
            </div>
          )}

          {ver && (!updaterState || updaterState.status === "dev-mode") && (
            <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
              {ver.error || `${displayVersion(ver.latest)} — ${ver.status}`}
            </p>
          )}

          {!updaterState && !ver && (
            <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
              {t("Checking for updates…")}
            </p>
          )}
        </div>
      </Card>

      {/* 6. Restart API */}
      <Card>
        <CardHeader
          icon={<Power size={18} />}
          title={t("Restart API")}
          description={t("Restarts the backend API service to apply system changes.")}
        />

        <div className="pt-1 flex items-center justify-between gap-4">
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
            icon={<Power size={14} className="text-white" />}
          >
            {t("Restart API")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
