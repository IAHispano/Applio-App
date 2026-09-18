// Applio Electron shell (dev + packaged production).

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, nativeImage, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

// User data, logs and caches live under a clean app-scoped dir
// (~/.config/Applio on Linux) instead of the npm package name.
app.setName("Applio");

// PyTorch on Apple Silicon needs MPS fallback + uncapped memory pressure
// handling, otherwise inference crashes on unsupported ops. Set early so
// every child process (API, engine, setup) inherits it. ??= respects
// user-provided values.
if (process.platform === "darwin") {
  process.env.PYTORCH_ENABLE_MPS_FALLBACK ??= "1";
  process.env.PYTORCH_MPS_HIGH_WATERMARK_RATIO ??= "0.0";
}

const isDev: boolean = !app.isPackaged;
const API_PORT: string = process.env.API_PORT || "8000";
const WEB_PORT: string = process.env.WEB_PORT || "3000";
const WEB_URL: string = process.env.WEB_URL || `http://127.0.0.1:${WEB_PORT}/`;

let apiProc: ChildProcess | null = null;
let webProc: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; releaseDate?: string }
  | { status: "not-available"; version: string }
  | {
      status: "downloading";
      percent: number;
      bytesPerSecond: number;
      total: number;
      transferred: number;
    }
  | { status: "downloaded"; version: string; releaseNotes?: string }
  | { status: "error"; message: string }
  | { status: "dev-mode"; message: string };

let currentUpdateState: UpdateState = { status: "idle" };
// Version the "ready to install" prompt was already shown for (per session).
// Prevents stacked duplicate dialogs when `update-downloaded` fires twice.
let updatePromptVersion: string | null = null;

function repoRoot(): string {
  if (process.env.APPLIO_ROOT && fs.existsSync(process.env.APPLIO_ROOT)) {
    return path.resolve(process.env.APPLIO_ROOT);
  }
  if (isDev) return path.resolve(__dirname, "..", "..", "..");
  return path.resolve(__dirname, "..");
}

// Writable per-user data dir for the packaged app. The AppImage mount
// (resources/) is read-only, so the .venv, downloaded models (logs/),
// uploads and outputs cannot live next to the code — they live here.
function dataRoot(): string {
  if (isDev) return repoRoot();
  try {
    const dir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return repoRoot();
  }
}

// Seed the data dir from the read-only package on first run (and re-seed
// code files on version change). User-generated trees (assets/, logs/)
// are only created when missing, never overwritten.
function seedDataRoot(code: string, data: string): void {
  const marker = path.join(data, ".seed-version");
  const version = app.getVersion();
  let current = "";
  try {
    current = fs.readFileSync(marker, "utf-8").trim();
  } catch {
    /* first run */
  }
  const codeEntries = ["core.py", "requirements.txt", "LICENSE", "rvc", "plugins"];
  const dataEntries = ["assets"];
  const needsSeed = current !== version || !fs.existsSync(path.join(data, "core.py"));
  if (!needsSeed) {
    for (const entry of dataEntries) {
      if (!fs.existsSync(path.join(data, entry)) && fs.existsSync(path.join(code, entry))) {
        try {
          fs.cpSync(path.join(code, entry), path.join(data, entry), { recursive: true });
        } catch {
          /* non-fatal: the API surfaces a proper error later */
        }
      }
    }
    return;
  }
  for (const entry of codeEntries) {
    const src = path.join(code, entry);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, path.join(data, entry), { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }
  for (const entry of dataEntries) {
    const dest = path.join(data, entry);
    if (fs.existsSync(dest)) continue;
    if (!fs.existsSync(path.join(code, entry))) continue;
    try {
      fs.cpSync(path.join(code, entry), dest, { recursive: true });
    } catch {
      /* non-fatal */
    }
  }
  try {
    fs.mkdirSync(path.join(data, "logs"), { recursive: true });
    fs.writeFileSync(marker, `${version}\n`);
  } catch {
    /* non-fatal */
  }
}

function appIconPath(): string | undefined {
  const root = repoRoot();
  const candidates =
    process.platform === "win32"
      ? [path.join(root, "assets", "ICON.ico"), path.join(root, "assets", "icon.png")]
      : process.platform === "darwin"
        ? [path.join(root, "assets", "icon.icns"), path.join(root, "assets", "icon.png")]
        : [path.join(root, "assets", "icon.png"), path.join(root, "assets", "ICON.ico")];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function appNativeIcon(): Electron.NativeImage | undefined {
  const p = appIconPath();
  if (!p) return undefined;
  try {
    return nativeImage.createFromPath(p);
  } catch {
    return undefined;
  }
}

function startProdBackends(): void {
  const code = repoRoot();
  const data = isDev ? code : dataRoot();
  if (!isDev) seedDataRoot(code, data);
  const serverEntry = path.join(code, "app", "api", "dist", "index.js");
  const nextStandalone = path.join(code, "app", "web", ".next", "standalone", "server.js");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    API_PORT,
    APPLIO_ROOT: data,
    APPLIO_CODE_ROOT: code,
    ...(isDev ? {} : { PACKAGED: "1" }),
    PORT: WEB_PORT,
    HOSTNAME: "127.0.0.1",
  };
  if (fs.existsSync(serverEntry)) {
    apiProc = spawn(process.execPath, [serverEntry], {
      cwd: data,
      env,
      windowsHide: true,
    });
    pipeProcOutput(apiProc, "api");
  } else {
    console.warn("[electron] api bundle missing:", serverEntry);
    logToTailAndFile(`[electron] api bundle missing: ${serverEntry}`, "launcher.log");
  }
  if (fs.existsSync(nextStandalone)) {
    webProc = spawn(process.execPath, [nextStandalone], {
      cwd: path.dirname(nextStandalone),
      env,
      windowsHide: true,
    });
    pipeProcOutput(webProc, "web");
  } else {
    console.warn("[electron] web standalone missing:", nextStandalone);
    logToTailAndFile(`[electron] web standalone missing: ${nextStandalone}`, "launcher.log");
  }
}

function stopBackends(): void {
  for (const p of [apiProc, webProc]) {
    try {
      p?.kill();
    } catch {
      /* already gone */
    }
  }
  apiProc = null;
  webProc = null;
}

// Backend output goes to rotating log files AND an in-memory tail so the
// failure dialog can show paths, open the folder and copy diagnostics.
const bootLogTails: string[] = [];

function launcherLogDir(): string {
  // getPath('logs') throws unless setAppLogsPath() ran first: fall back to
  // userData so logging can never break the boot sequence.
  try {
    const dir = path.join(app.getPath("logs"), "applio");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const dir = path.join(app.getPath("userData"), "logs", "applio");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

function logToTailAndFile(entry: string, filename = "engine.log"): void {
  bootLogTails.push(entry);
  if (bootLogTails.length > 200) bootLogTails.splice(0, bootLogTails.length - 200);
  try {
    const file = path.join(launcherLogDir(), filename);
    fs.appendFileSync(file, `${new Date().toISOString()} ${entry}\n`);
  } catch {
    /* disk full / locked: console still has it */
  }
}

function pipeProcOutput(proc: ChildProcess, tag: "api" | "web"): void {
  const push = (line: string) => {
    logToTailAndFile(`[${tag}] ${line}`, `${tag}.log`);
  };
  proc.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    console.log(`[${tag}]`, text);
    for (const line of text.split("\n")) if (line.trim()) push(line.trim().slice(0, 1000));
  });
  proc.stderr?.on("data", (d: Buffer) => {
    const text = d.toString();
    console.error(`[${tag}]`, text);
    for (const line of text.split("\n")) if (line.trim()) push(`STDERR ${line.trim().slice(0, 1000)}`);
  });
  proc.on("error", (err: Error) => {
    console.error(`[${tag}] spawn error:`, err);
    push(`SPAWN ERROR: ${err.message}`);
  });
  proc.on("exit", (code: number | null, signal: string | null) => {
    console.log(`[${tag}] exited with code=${code} signal=${signal}`);
    push(`EXITED code=${code} signal=${signal}`);
  });
}

function findPythonBin(): { path: string; source: string; exists: boolean } {
  const root = repoRoot();
  const roots: Array<{ dir: string; label: string }> = [{ dir: root, label: "bundled .venv" }];
  if (!isDev) {
    const data = dataRoot();
    if (data !== root) roots.push({ dir: data, label: "app data .venv" });
  }
  const candidates: Array<{ path: string; source: string }> = [];
  if (process.env.PYTHON_BIN) {
    candidates.push({ path: process.env.PYTHON_BIN, source: "PYTHON_BIN env" });
  }
  if (process.platform === "win32") {
    candidates.push(
      { path: path.join(root, ".venv", "Scripts", "python.real.exe"), source: "bundled .venv (real)" },
      { path: path.join(root, ".venv", "Scripts", "python.exe"), source: "bundled .venv" },
      { path: path.join(root, "env", "python.exe"), source: "bundled env" },
    );
  } else {
    candidates.push(
      { path: path.join(root, ".venv", "bin", "python"), source: "bundled .venv" },
      { path: path.join(root, "env", "bin", "python"), source: "bundled env" },
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c.path)) return { path: c.path, source: c.source, exists: true };
  }
  const defaultPy = process.platform === "win32" ? "python" : "python3";
  return { path: defaultPy, source: "system PATH", exists: false };
}

function diagnosticsReport(): string {
  const py = findPythonBin();
  return [
    `Applio ${app.getVersion()} · ${process.platform} ${process.arch}`,
    `Electron ${process.versions.electron} · Node ${process.versions.node}`,
    `Python: ${py.path} (${py.exists ? `found: ${py.source}` : "system PATH fallback"})`,
    `Ports: API=${API_PORT} WEB=${WEB_PORT}`,
    `Logs: ${launcherLogDir()}`,
    `--- backend tail ---`,
    ...(bootLogTails.length > 0 ? bootLogTails.slice(-15) : ["(no backend output captured)"]),
  ].join("\n");
}

async function reportBootFailure(): Promise<"retry" | "quit"> {
  const py = findPythonBin();
  const nativeIcon = appNativeIcon();
  const detail = [
    "The Applio backend server did not respond within 60s.",
    "",
    "Checklist:",
    `• Ports ${API_PORT}/${WEB_PORT} free (make sure no other Applio or dev server is running)`,
    `• Python: ${py.path} (${py.exists ? py.source : "in-app setup will configure packages on first run"})`,
    `• Logs: ${launcherLogDir()}`,
    "",
    "Recent backend output:",
    ...(bootLogTails.length > 0
      ? bootLogTails.slice(-8).map((l) => `• ${l}`)
      : ["• No backend logs captured yet"]),
  ].join("\n");
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Applio failed to start",
      message: "Applio failed to start",
      detail,
      buttons: ["Retry", "Copy diagnostics", "Open log folder", "Quit"],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
      ...(nativeIcon ? { icon: nativeIcon } : {}),
    });
    if (response === 0) return "retry";
    if (response === 1) {
      clipboard.writeText(diagnosticsReport());
      continue;
    }
    if (response === 2) {
      void shell.openPath(launcherLogDir());
      continue;
    }
    return "quit";
  }
}

async function waitFor(
  url: string,
  timeoutSeconds = 60,
  onTick?: (progressRatio: number) => void,
  intervalMs = 150,
): Promise<boolean> {
  const maxAttempts = Math.max(1, Math.floor((timeoutSeconds * 1000) / intervalMs));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    onTick?.(i / maxAttempts);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function getSplashHtml(version: string): string {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  margin: 0;
  height: 100%;
  width: 100%;
  background: transparent;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 0.18s ease-out;
}
.card {
  width: 320px;
  background: #141414;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: #f5f5f5;
  line-height: 1;
}
.badge {
  font-size: 10px;
  font-weight: 500;
  color: #a3a3a3;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 1px 5px;
  line-height: 1.3;
}
#pct {
  font-size: 11px;
  color: #a3a3a3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  overflow: hidden;
  position: relative;
}
.bar {
  height: 100%;
  width: 15%;
  background: #ffffff;
  border-radius: 999px;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
#st {
  font-size: 12px;
  color: #a3a3a3;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">
        <span class="title">Applio</span>
        <span class="badge">v${version}</span>
      </div>
      <span id="pct">15%</span>
    </div>
    <div class="track">
      <div id="pb" class="bar"></div>
    </div>
    <div id="st">Starting…</div>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showSplash(): void {
  if (splash && !splash.isDestroyed()) return;
  const icon = appIconPath();
  const version = app.getVersion();
  splash = new BrowserWindow({
    width: 380,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    transparent: true,
    center: true,
    show: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    skipTaskbar: false,
    ...(icon ? { icon } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void splash.loadURL(getSplashHtml(version));
  splash.once("ready-to-show", () => {
    splash?.show();
  });
  splash.on("closed", () => {
    splash = null;
  });
}

function setSplashStatus(text: string, percent?: number): void {
  if (!splash || splash.isDestroyed()) return;
  const esc = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
  const clamped = typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null;
  const progJs =
    clamped !== null
      ? `var p=document.getElementById('pb');if(p)p.style.width='${clamped}%';var pc=document.getElementById('pct');if(pc)pc.textContent='${clamped}%';`
      : "";
  void splash.webContents
    .executeJavaScript(
      `(function(){var el=document.getElementById('st');if(el)el.textContent='${esc}';${progJs}})()`,
    )
    .catch(() => {});
}

function closeSplash(): void {
  if (!splash || splash.isDestroyed()) {
    splash = null;
    return;
  }
  const s = splash;
  splash = null;
  try {
    void s.webContents
      .executeJavaScript(`document.body.style.opacity = '0';`)
      .catch(() => {});
    setTimeout(() => {
      try {
        if (!s.isDestroyed()) s.close();
      } catch {
        /* ignore */
      }
    }, 180);
  } catch {
    try {
      if (!s.isDestroyed()) s.close();
    } catch {
      /* ignore */
    }
  }
}

interface SavedWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): SavedWindowState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(), "utf-8")) as Partial<SavedWindowState>;
    if (
      typeof raw.width !== "number" ||
      typeof raw.height !== "number" ||
      raw.width < 960 ||
      raw.height < 640 ||
      raw.width > 7680 ||
      raw.height > 4320
    ) {
      return null;
    }
    const state: SavedWindowState = {
      width: Math.round(raw.width),
      height: Math.round(raw.height),
      isMaximized: typeof raw.isMaximized === "boolean" ? raw.isMaximized : false,
    };
    if (typeof raw.x === "number" && typeof raw.y === "number") {
      state.x = Math.round(raw.x);
      state.y = Math.round(raw.y);
    }
    return state;
  } catch {
    return null;
  }
}

function saveWindowState(): void {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMax = mainWindow.isMaximized();
    if (isMax) {
      const existing = loadWindowState();
      const state: SavedWindowState = {
        width: existing?.width ?? 1280,
        height: existing?.height ?? 860,
        x: existing?.x,
        y: existing?.y,
        isMaximized: true,
      };
      fs.writeFileSync(windowStatePath(), JSON.stringify(state));
      return;
    }
    const [width, height] = mainWindow.getSize();
    const [x, y] = mainWindow.getPosition();
    const state: SavedWindowState = { width, height, x, y, isMaximized: false };
    fs.writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

function notifyUpdateState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", currentUpdateState);
  }
}

function initAutoUpdater(): void {
  autoUpdater.logger = {
    info: (msg: unknown) => {
      console.log("[updater]", msg);
      logToTailAndFile(`[updater] ${String(msg)}`, "updater.log");
    },
    warn: (msg: unknown) => {
      console.warn("[updater]", msg);
      logToTailAndFile(`[updater WARN] ${String(msg)}`, "updater.log");
    },
    error: (msg: unknown) => {
      console.error("[updater]", msg);
      logToTailAndFile(`[updater ERR] ${String(msg)}`, "updater.log");
    },
    debug: (msg: unknown) => console.debug("[updater]", msg),
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for update…");
    currentUpdateState = { status: "checking" };
    notifyUpdateState();
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log(`[updater] Update available: v${info.version}`);
    currentUpdateState = {
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
    };
    notifyUpdateState();
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    console.log(`[updater] App is up to date: v${info.version}`);
    currentUpdateState = { status: "not-available", version: info.version };
    notifyUpdateState();
  });

  autoUpdater.on("download-progress", (progress) => {
    currentUpdateState = {
      status: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      total: progress.total,
      transferred: progress.transferred,
    };
    notifyUpdateState();
  });

  autoUpdater.on("update-downloaded", async (info: UpdateInfo) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    const notes = info.releaseNotes;
    currentUpdateState = {
      status: "downloaded",
      version: info.version,
      releaseNotes:
        typeof notes === "string"
          ? notes
          : Array.isArray(notes)
            ? notes.map((n) => n.note).join("\n")
            : undefined,
    };
    notifyUpdateState();

    // One prompt per version: `update-downloaded` can fire more than once
    // (background check + manual "Check for Updates"), and without this guard
    // the user gets stacked duplicate dialogs.
    if (updatePromptVersion === info.version) return;
    updatePromptVersion = info.version;

    const nativeIcon = appNativeIcon();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Applio Update Ready",
        message: `Applio v${info.version} is ready to install`,
        detail:
          "The new version of Applio has been downloaded. Restart now to apply the update, or install it automatically when you next exit Applio.",
        buttons: ["Restart and Update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        ...(nativeIcon ? { icon: nativeIcon } : {}),
      });

      if (response === 0) {
        stopBackends();
        autoUpdater.quitAndInstall(false, true);
      }
    } else if (Notification.isSupported()) {
      // No window to show the dialog in (e.g. macOS with all windows
      // closed but the app still running): fall back to a system
      // notification so the downloaded release is never missed.
      const notif = new Notification({
        title: "Applio Update Ready",
        body: `Applio v${info.version} has been downloaded and will install automatically when you exit.`,
        ...(nativeIcon ? { icon: nativeIcon } : {}),
      });
      notif.on("click", () => {
        app.focus({ steal: true });
      });
      notif.show();
    }
  });

  autoUpdater.on("error", (err: Error) => {
    console.error("[updater] Error:", err.message);
    currentUpdateState = { status: "error", message: err.message || "Update check failed" };
    notifyUpdateState();
  });

  // IPC Handlers
  ipcMain.handle("updater:get-status", () => currentUpdateState);

  ipcMain.handle("updater:check", async () => {
    if (isDev) {
      currentUpdateState = { status: "dev-mode", message: "Auto-updater is disabled in development mode." };
      return currentUpdateState;
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        status: "ok",
        version: result?.updateInfo?.version,
        updateInfo: result?.updateInfo,
      };
    } catch (err) {
      const message = (err as Error).message || String(err);
      currentUpdateState = { status: "error", message };
      return { status: "error", message };
    }
  });

  ipcMain.on("updater:quit-and-install", () => {
    stopBackends();
    autoUpdater.quitAndInstall(false, true);
  });
}

async function createWindow(): Promise<void> {
  showSplash();

  if (isDev) {
    setSplashStatus("Connecting to dev environment…", 15);
    const apiHealthUrl = `http://127.0.0.1:${API_PORT}/api/health`;

    let webDone = false;
    let apiDone = false;

    const [webOk] = await Promise.all([
      waitFor(WEB_URL, 60, (ratio) => {
        if (!webDone && !apiDone) {
          setSplashStatus("Starting dev server…", 15 + Math.round(ratio * 35));
        }
      }).then((res) => {
        webDone = true;
        if (res && !apiDone) setSplashStatus("Dev server ready, waiting for engine…", 55);
        return res;
      }),
      waitFor(apiHealthUrl, 60, (ratio) => {
        if (webDone && !apiDone) {
          setSplashStatus("Starting engine…", 55 + Math.round(ratio * 30));
        }
      }).then((res) => {
        apiDone = true;
        return res;
      }),
    ]);

    if (!webOk) {
      closeSplash();
      console.error(`[electron] dev server at ${WEB_URL} did not respond within 60s`);
      const nativeIcon = appNativeIcon();
      await dialog.showMessageBox({
        type: "error",
        title: "Dev Server Unreachable",
        message: `Could not connect to Next.js dev server at ${WEB_URL}`,
        detail: `Make sure 'npm run dev' or 'npm run desktop:dev' is running.\n\nChecked: ${WEB_URL}`,
        ...(nativeIcon ? { icon: nativeIcon } : {}),
      });
      app.quit();
      return;
    }

    // Preload & prime engine data
    setSplashStatus("Loading Applio…", 88);
    await Promise.all([
      fetch(`http://127.0.0.1:${API_PORT}/api/setup/status`).catch(() => {}),
      fetch(`http://127.0.0.1:${API_PORT}/api/models`).catch(() => {}),
    ]);
  } else {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      stopBackends();
      setSplashStatus(attempt > 1 ? `Retrying… (attempt ${attempt})` : "Starting engine…", 20);
      startProdBackends();
      const apiHealthUrl = `http://127.0.0.1:${API_PORT}/api/health`;
      const webHealthUrl = `http://127.0.0.1:${WEB_PORT}/`;

      const [webOk] = await Promise.all([
        waitFor(webHealthUrl, 60, (ratio) =>
          setSplashStatus(`Starting Applio…`, 20 + Math.min(65, Math.round(ratio * 65))),
        ),
        waitFor(apiHealthUrl, 60),
      ]);

      if (webOk) {
        setSplashStatus("Loading Applio…", 88);
        await Promise.all([
          fetch(`http://127.0.0.1:${API_PORT}/api/setup/status`).catch(() => {}),
          fetch(`http://127.0.0.1:${API_PORT}/api/models`).catch(() => {}),
        ]);
        break;
      }
      const action = await reportBootFailure();
      if (action === "retry") continue;
      closeSplash();
      stopBackends();
      app.quit();
      return;
    }
  }

  setSplashStatus("Ready!", 95);

  const icon = appIconPath();
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    title: "Applio",
    frame: true,
    resizable: true,
    fullscreenable: true,
    titleBarStyle: "default",
    show: false,
    center: saved === null,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set macOS dock icon if supported
  if (process.platform === "darwin" && app.dock && icon) {
    try {
      app.dock.setIcon(icon);
    } catch {
      /* ignore */
    }
  }

  // Paint only when the first frame is ready, and ONLY then close the splash screen!
  let windowShown = false;
  const showMainWindow = () => {
    if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    windowShown = true;
    setSplashStatus("Ready!", 100);
    setTimeout(() => {
      closeSplash();
      if (saved?.isMaximized) {
        mainWindow?.maximize();
      }
      mainWindow?.show();
      mainWindow?.focus();
    }, 120);
  };
  mainWindow.once("ready-to-show", showMainWindow);
  setTimeout(showMainWindow, 5000);

  const target = isDev ? WEB_URL : `http://127.0.0.1:${WEB_PORT}/`;
  console.log("[electron] loading target:", target);

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[electron] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    if (isDev) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log("[electron] retrying load target:", target);
          mainWindow.loadURL(target).catch(() => {});
        }
      }, 1500);
    }
  });

  if (isDev) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  void mainWindow.loadURL(target).catch((err) => {
    console.error("[electron] loadURL error:", err);
  });

  // Notify the renderer of maximize state so its chrome never drifts
  // (Win+Arrow, snap layouts and the OS window menu bypass our IPC toggle).
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximize-changed", false);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", () => {
    saveWindowState();
  });

  // Check for updates in production
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn("[updater] Background check error:", err.message);
      });
    }, 15_000);

    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn("[updater] Periodic check error:", err.message);
        });
      },
      4 * 60 * 60 * 1000,
    );
  }
}

// Window control handlers
ipcMain.on("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  win?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on("window:toggle-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
});

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  win?.close();
});

ipcMain.handle("window:is-maximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return win?.isMaximized() ?? false;
});

ipcMain.handle("window:is-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return win?.isFullScreen() ?? false;
});

// One instance at a time: a second launch focuses the running window instead
// of fighting over ports with a duplicate backend stack.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  // Required before any getPath('logs') call (throws otherwise).
  try {
    app.setAppLogsPath();
  } catch {
    /* launcherLogDir falls back to userData */
  }
  app.whenReady().then(() => {
    initAutoUpdater();
    return createWindow();
  });
}

app.on("window-all-closed", () => {
  apiProc?.kill();
  webProc?.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  apiProc?.kill();
  webProc?.kill();
});
