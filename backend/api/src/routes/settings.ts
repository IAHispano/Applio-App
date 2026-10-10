import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { cleanStorage, getStorageStats } from "@/cleaner";
import { deepMerge, loadConfig, saveConfig } from "@/config";
import { errMsg } from "@/errors";
import {
  detectSystemLocale,
  getAvailableLanguages,
  LANGUAGE_DISPLAY_NAMES,
  loadLanguageDictionary,
  resolveSupportedLanguage,
} from "@/i18n";
import { validateLogsMove } from "@/logs-storage";
import {
  getAppVersion,
  getLogsDir,
  getLogsMoveError,
  getPythonGuiBin,
  getRepoRoot,
  getUploadsDir,
  noEnv,
  pythonEnv,
  validateLogsDir,
} from "@/python";
import { getStatus } from "@/setup";

const router = Router();

const settingsSchema = z.object({
  logs_dir: z.string().optional(),
  model_index_filter: z.boolean().optional(),
  discord_presence: z.boolean().optional(),
  lang: z.object({ override: z.boolean(), selected_lang: z.string().min(1) }).optional(),
  model_author: z.string().nullable().optional(),
  precision: z.enum(["fp32", "fp16", "bf16"]).optional(),
  rmvpe_high_register: z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["true_pitch", "fold"]),
      f0_ceil: z.number().min(1000).max(2000),
    })
    .optional(),
  realtime: z.record(z.unknown()).optional(),
  theme: z.object({ file: z.string(), font: z.array(z.string()).optional() }).optional(),
});

router.get("/", (_req: Request, res: Response) => {
  try {
    res.json({
      config: loadConfig(),
      logsDir: getLogsDir(),
      logsMoveError: getLogsMoveError(),
      defaultLogsDir: path.join(getRepoRoot(), "logs"),
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

router.put("/", (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  try {
    const active = getLogsDir();
    if (parsed.data.logs_dir !== undefined) {
      try {
        parsed.data.logs_dir = validateLogsDir(parsed.data.logs_dir);
        validateLogsMove(active, parsed.data.logs_dir || path.join(getRepoRoot(), "logs"));
      } catch (err) {
        return res.status(400).json({ error: `Cannot use logs folder: ${errMsg(err)}` });
      }
    }
    const cfg = loadConfig();
    deepMerge(cfg, parsed.data);
    if (parsed.data.logs_dir !== undefined) {
      const destination = parsed.data.logs_dir || path.join(getRepoRoot(), "logs");
      cfg.logs_move_from = path.resolve(destination) === active ? "" : active;
    }
    saveConfig(cfg);
    res.json({ ok: true, config: cfg });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

router.get("/languages", (_req: Request, res: Response) => {
  try {
    const sorted = getAvailableLanguages();
    const cfg = loadConfig() as { lang?: { override?: boolean; selected_lang?: string } };
    const detected = resolveSupportedLanguage(detectSystemLocale());
    res.json({
      languages: sorted,
      named: sorted.map((code) => ({ code, name: LANGUAGE_DISPLAY_NAMES[code] || code })),
      selected: cfg.lang || { override: false, selected_lang: detected },
      detected,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Resolved UI language + its translation dictionary.
// If before first setup (or override is false), the host OS language is automatically
// established if available in the app (falling back to English if not available).
// If the user explicitly configured an override after setup, that choice is respected.
router.get("/language", async (req: Request, res: Response) => {
  try {
    const cfg = loadConfig() as { lang?: { override?: boolean; selected_lang?: string } };
    const setupStatus = await getStatus(false).catch(() => null);
    const isBeforeFirstSetup = !setupStatus?.ready;

    let code = "en_US";

    if (isBeforeFirstSetup || !cfg.lang?.override) {
      const clientLang = (req.query.clientLang as string) || undefined;
      const acceptLanguage = (req.headers["accept-language"] as string) || undefined;
      const systemLocale = detectSystemLocale();
      code = resolveSupportedLanguage([clientLang, acceptLanguage, systemLocale]);

      if (cfg.lang?.selected_lang !== code || (isBeforeFirstSetup && cfg.lang?.override)) {
        const nextCfg = {
          ...cfg,
          lang: {
            override: false,
            selected_lang: code,
          },
        };
        try {
          saveConfig(nextCfg);
        } catch {
          /* non-fatal */
        }
      }
    } else {
      code = resolveSupportedLanguage(cfg.lang.selected_lang);
    }

    const { dict } = loadLanguageDictionary(code);
    res.json({ code, dict });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Discord rich presence. The Gradio app started RPCManager in-process at boot;
// here the API owns it instead: a child python interpreter holds the
// pypresence connection open for as long as it lives (set_activity persists
// server-side until the connection closes).
let presenceProc: ChildProcess | null = null;
function presencePidFile(): string {
  const dir = getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "discord_presence.pid");
}
function presenceAlive(): boolean {
  if (noEnv()) return false;
  if (presenceProc && presenceProc.exitCode === null) return true;
  try {
    const pid = Number(fs.readFileSync(presencePidFile(), "utf-8"));
    if (pid > 0) {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    /* no pid file or stale */
  }
  return false;
}
export function startPresence(): boolean {
  if (noEnv()) return false;
  if (presenceAlive()) return true;
  try {
    const code = [
      "from assets.discord_presence import RPCManager",
      "RPCManager.start_presence()",
      "import threading; threading.Event().wait()",
    ].join("; ");
    presenceProc = spawn(getPythonGuiBin(), ["-c", code], {
      cwd: getRepoRoot(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: pythonEnv(),
    });
    presenceProc.unref();
    fs.writeFileSync(presencePidFile(), String(presenceProc.pid || ""));
    return true;
  } catch {
    presenceProc = null;
    return false;
  }
}
export function stopPresence(): void {
  try {
    const pid = Number(fs.readFileSync(presencePidFile(), "utf-8"));
    if (pid > 0) {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* noop */
  }
  try {
    presenceProc?.kill();
  } catch {
    /* noop */
  }
  presenceProc = null;
  fs.rmSync(presencePidFile(), { force: true });
}
export function autoStartPresence(): void {
  try {
    const cfg = loadConfig() as { discord_presence?: boolean };
    if (cfg.discord_presence) startPresence();
  } catch {
    /* presence is best-effort */
  }
}
router.get("/presence", (_req: Request, res: Response) => {
  res.json({ running: presenceAlive() });
});
router.post("/presence/stop", (_req: Request, res: Response) => {
  // Transient stop for app shutdown: kills the detached interpreter without
  // touching the saved discord_presence setting (it restarts on next boot).
  stopPresence();
  res.json({ ok: true });
});
router.post("/presence", (req: Request, res: Response) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
  try {
    const cfg = loadConfig();
    deepMerge(cfg, { discord_presence: parsed.data.enabled });
    saveConfig(cfg);
    if (parsed.data.enabled) {
      if (!startPresence())
        return res
          .status(502)
          .json({ error: "Could not start Discord presence (is Discord running? pypresence installed?)" });
    } else {
      stopPresence();
    }
    res.json({ ok: true, running: presenceAlive() });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Restart the API process (Gradio restart_applio parity). Under `dev` the
// file watcher respawns it; in production a supervisor (systemd/docker/pm2)
// must do the same — otherwise this is a plain shutdown.
router.post("/restart", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message:
      "API is restarting. If it does not come back, restart it manually (dev watcher, systemd, docker or pm2).",
  });
  setTimeout(() => process.exit(0), 500).unref?.();
});

// Storage and cache management
router.get("/storage", (_req: Request, res: Response) => {
  try {
    const stats = getStorageStats();
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

router.post("/storage/clean", (req: Request, res: Response) => {
  try {
    const maxAgeMs = typeof req.body?.maxAgeMs === "number" ? req.body.maxAgeMs : 0;
    const cleanUploads = req.body?.cleanUploads !== false;
    const cleanOutputs = req.body?.cleanOutputs !== false;
    const result = cleanStorage({ maxAgeMs, cleanUploads, cleanOutputs });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// Theme system (Gradio themes parity, ours is file-based: assets/themes/*.json).
// The built-in default lives in globals.css :root; selecting "" restores it.
function themesDir(): string {
  const dir = path.join(getRepoRoot(), "assets", "themes");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface ThemeListEntry {
  id: string;
  name: string;
  description: string;
  example: boolean;
}

router.get("/themes", (_req: Request, res: Response) => {
  try {
    const dir = themesDir();
    const entries: ThemeListEntry[] = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".example.json"))
      .sort()
      .map((f) => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as {
            name?: string;
            description?: string;
            colors?: Record<string, string>;
          };
          return {
            id: f,
            name: typeof raw.name === "string" && raw.name ? raw.name : f.replace(/\.json$/, ""),
            description: typeof raw.description === "string" ? raw.description : "",
            colors: raw.colors || {},
            example: f.endsWith(".example.json"),
          };
        } catch {
          return {
            id: f,
            name: f,
            description: "Invalid JSON — fix or remove this file.",
            colors: {},
            example: false,
          };
        }
      });
    res.json({
      themes: entries,
      selected: (loadConfig().theme as { file?: string } | undefined)?.file || "",
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

const BUILTIN_THEME_FALLBACK = { name: "Default", version: "1.0.0", colors: {}, fonts: {}, radius: {} };

router.get("/theme", (req: Request, res: Response) => {
  try {
    const file = String(req.query.file || (loadConfig().theme as { file?: string } | undefined)?.file || "");
    // User font override (families array) layers over any theme's body/display
    // slots, so one dropdown customizes every palette. Applied server-side so
    // initial load, ThemeProvider reloads, and instant previews all agree.
    const font = (loadConfig().theme as { font?: unknown } | undefined)?.font;
    const fontFamilies = Array.isArray(font) ? font.filter((f): f is string => typeof f === "string") : [];
    const withFont = (theme: Record<string, unknown>) => {
      if (fontFamilies.length === 0) return theme;
      const fonts =
        theme.fonts && typeof theme.fonts === "object" ? (theme.fonts as Record<string, unknown>) : {};
      return { ...theme, fonts: { ...fonts, body: fontFamilies, display: fontFamilies } };
    };
    // Legacy Gradio values (e.g. "Applio.py") and "" both mean the built-in default.
    if (!file?.endsWith(".json")) return res.json({ id: "", theme: withFont(BUILTIN_THEME_FALLBACK) });
    // Confine to the themes dir (no traversal).
    const abs = path.resolve(themesDir(), path.basename(file));
    if (!abs.startsWith(themesDir() + path.sep) || !abs.endsWith(".json")) {
      return res.status(403).json({ error: "Only assets/themes/*.json files." });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: `Theme not found: ${file}` });
    res.json({
      id: path.basename(file),
      theme: withFont(JSON.parse(fs.readFileSync(abs, "utf-8")) as Record<string, unknown>),
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

let versionCache: { at: number; data: Record<string, unknown> } | null = null;
const VERSION_TTL_MS = 60 * 60 * 1000;

router.get("/version-check", async (req: Request, res: Response) => {
  try {
    // Home + update modal + settings all hit this on app open; without a
    // cache every mount pays a GitHub round-trip (up to 8s offline). Cache
    // for an hour, bypassable with ?refresh=1.
    if (req.query.refresh !== "1" && versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) {
      return res.json(versionCache.data);
    }
    const send = (data: Record<string, unknown>) => {
      versionCache = { at: Date.now(), data };
      return res.json(data);
    };
    const local = getAppVersion();
    const headers: Record<string, string> = { "User-Agent": "Applio" };
    // Authenticated requests get 5k/hr instead of 60 — avoids the 403 wall.
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch("https://api.github.com/repos/IAHispano/Applio-App/releases?per_page=30", {
      headers,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const releases = (await r.json()) as Array<{
      tag_name: string;
      name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    }>;

    const isDev = process.env.NODE_ENV === "development" || process.env.APPLIO_DEV === "1";

    if (!releases || releases.length === 0) {
      return send({
        local,
        latest: local,
        status: "up-to-date",
        versionsBehind: 0,
        isOutdated: false,
        isDev,
      });
    }

    const latestRelease = releases[0];
    const rawLatest = latestRelease.tag_name || "";
    const cleanLatest = String(rawLatest).replace(/^v+/i, "");
    const rawLocal = String(local || "").trim();
    const isUnknownLocal =
      !rawLocal || rawLocal.toLowerCase() === "unknown" || rawLocal.toLowerCase() === "vunknown";
    const cleanLocal = isUnknownLocal ? "" : rawLocal.replace(/^v+/i, "");
    const latest = cleanLatest ? `v${cleanLatest}` : "unknown";
    const normalizedLocal = cleanLocal ? `v${cleanLocal}` : "unknown";

    const cmp = (a: string, b: string) => {
      const pa = String(a)
        .replace(/^v+/i, "")
        .split(".")
        .map((n) => Number(n) || 0);
      const pb = String(b)
        .replace(/^v+/i, "")
        .split(".")
        .map((n) => Number(n) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d > 0 ? 1 : -1;
      }
      return 0;
    };

    const winAsset = latestRelease.assets?.find((a) => a.name.toLowerCase().endsWith(".exe"));
    const downloadUrl =
      winAsset?.browser_download_url ||
      latestRelease.assets?.[0]?.browser_download_url ||
      latestRelease.html_url ||
      `https://github.com/IAHispano/Applio-App/releases/tag/${latest}`;

    // Local version could not be determined (e.g. missing package.json).
    // Never report "behind" with an inflated gap — that is how a fresh
    // install of the latest release ends up showing
    // "unknown → vX.Y.Z (N updates behind)". Surface status "unknown" so
    // the UI stays quiet instead of pushing a bogus update.
    if (isUnknownLocal) {
      return send({
        local: "unknown",
        latest,
        status: "unknown",
        versionsBehind: 0,
        isOutdated: false,
        isDev,
        releaseName: latestRelease.name || `Applio ${latest}`,
        releaseNotes: latestRelease.body || "",
        publishedAt: latestRelease.published_at || "",
        htmlUrl: latestRelease.html_url || `https://github.com/IAHispano/Applio-App/releases/tag/${latest}`,
        downloadUrl,
      });
    }

    const c = cmp(String(cleanLocal || local), String(cleanLatest || latest));
    const status = c === 0 ? "up-to-date" : c < 0 ? "behind" : "ahead";

    let versionsBehind = 0;
    if (status === "behind") {
      const newerCount = releases.filter((rel) => cmp(rel.tag_name, String(local)) > 0).length;
      const pa = String(cleanLocal || local)
        .split(".")
        .map((n) => Number(n) || 0);
      const pb = String(cleanLatest || latest)
        .split(".")
        .map((n) => Number(n) || 0);
      const majorDiff = Math.max(0, (pb[0] || 0) - (pa[0] || 0));
      const minorDiff = Math.max(0, (pb[1] || 0) - (pa[1] || 0));
      const patchDiff = Math.max(0, (pb[2] || 0) - (pa[2] || 0));
      const semverGap = majorDiff > 0 ? majorDiff * 10 : minorDiff > 0 ? minorDiff * 2 : patchDiff;
      versionsBehind = Math.max(newerCount, semverGap > 0 ? semverGap : 1);
    }

    // A few updates older (e.g. >= 2 versions behind) means outdated -> requires auto-update for security
    const isOutdated = status === "behind" && versionsBehind >= 2;

    return send({
      local: normalizedLocal,
      latest,
      status,
      versionsBehind,
      isOutdated,
      isDev,
      releaseName: latestRelease.name || `Applio ${latest}`,
      releaseNotes: latestRelease.body || "",
      publishedAt: latestRelease.published_at || "",
      htmlUrl: latestRelease.html_url || `https://github.com/IAHispano/Applio-App/releases/tag/${latest}`,
      downloadUrl,
    });
  } catch (err) {
    res.status(502).json({ error: errMsg(err) || "Version check failed (offline?)" });
  }
});

// Local installed version. Never touches the network, so the UI can always
// show the real version even when the GitHub comparison fails (offline,
// rate-limited).
router.get("/version", (_req: Request, res: Response) => {
  res.json({ version: getAppVersion() });
});

router.post("/apply-update", async (_req: Request, res: Response) => {
  try {
    const isGit = fs.existsSync(path.join(getRepoRoot(), ".git"));
    if (isGit) {
      const { runCmd } = await import("@/setup");
      const gitRes = await runCmd("git", ["pull", "--ff-only"], { cwd: getRepoRoot(), timeoutMs: 45000 });
      if (gitRes.code !== 0) {
        const fallbackRes = await runCmd("git", ["pull", "origin", "main"], {
          cwd: getRepoRoot(),
          timeoutMs: 45000,
        });
        if (fallbackRes.code !== 0) {
          throw new Error(`Git update failed: ${fallbackRes.stderr || gitRes.stderr}`);
        }
      }

      let newVersion = "";
      try {
        // Sync the (display-only) config version with the real installed
        // version so every surface agrees after an update.
        newVersion = getAppVersion();
        if (newVersion && newVersion !== "unknown") {
          const cfg = loadConfig();
          cfg.version = newVersion;
          saveConfig(cfg);
        }
      } catch {
        /* non-fatal */
      }

      return res.json({
        success: true,
        method: "git",
        version: newVersion,
        message: "Updated successfully via git.",
      });
    }

    res.json({
      success: false,
      method: "manual",
      message: "Not a git repository. Please download and run the latest installer.",
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

export default router;
