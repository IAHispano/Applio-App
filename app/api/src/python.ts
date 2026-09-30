import { type ChildProcess, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function refreshWindowsEnv(): void {
  if (process.platform !== "win32") return;
  try {
    const currentPath = process.env.PATH || "";
    const parts = currentPath.split(path.delimiter).filter(Boolean);
    const keys = [
      { key: "HKCU\\Environment", val: "Path" },
      { key: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", val: "Path" },
    ];
    for (const { key, val } of keys) {
      try {
        const out = execSync(`reg query "${key}" /v ${val}`, {
          encoding: "utf-8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
        for (const line of out.split("\r\n")) {
          const match = line.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i);
          if (match) {
            const raw = match[1].trim();
            for (const item of raw.split(";")) {
              const trimmed = item.trim();
              if (!trimmed) continue;
              const expanded = trimmed.replace(/%([^%]+)%/g, (_, n) => process.env[n] || `%${n}%`);
              if (fs.existsSync(expanded) && !parts.some((p) => p.toLowerCase() === expanded.toLowerCase())) {
                parts.unshift(expanded);
              }
            }
          }
        }
      } catch {
        /* key not present */
      }
    }

    // Also include standard Python installation directories if present
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const standardDirs = [
      path.join(localAppData, "Programs", "Python", "Python312"),
      path.join(localAppData, "Programs", "Python", "Python312", "Scripts"),
      path.join(localAppData, "Programs", "Python", "Launcher"),
      path.join(programFiles, "Python312"),
      path.join(programFiles, "Python312", "Scripts"),
    ];
    for (const dir of standardDirs) {
      if (fs.existsSync(dir) && !parts.some((p) => p.toLowerCase() === dir.toLowerCase())) {
        parts.unshift(dir);
      }
    }

    process.env.PATH = parts.join(path.delimiter);
  } catch {
    /* non-fatal */
  }
}

export function getWindowsPythonCandidates(): Array<{ cmd: string[]; source: string }> {
  if (process.platform !== "win32") return [];
  const results: Array<{ cmd: string[]; source: string }> = [];
  const seen = new Set<string>();

  const addExe = (exePath: string, source: string) => {
    try {
      const norm = path.resolve(exePath).toLowerCase();
      if (!seen.has(norm) && fs.existsSync(exePath)) {
        seen.add(norm);
        results.push({ cmd: [exePath], source });
      }
    } catch {
      /* ignore invalid path */
    }
  };

  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const systemDrive = process.env.SystemDrive || "C:";
  const userProfile = process.env.USERPROFILE || "";
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";

  // 1. Well-known Python 3.12 install paths
  const knownExePaths = [
    // Standard user-scope (default for winget / silent install)
    path.join(localAppData, "Programs", "Python", "Python312", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python312-64", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python312-32", "python.exe"),
    path.join(localAppData, "Programs", "Python", "Python312-arm64", "python.exe"),
    path.join(localAppData, "Python", "pythoncore-3.12-64", "python.exe"),
    // Standard machine-scope
    path.join(programFiles, "Python312", "python.exe"),
    path.join(programFilesX86, "Python312", "python.exe"),
    path.join(systemDrive, "Python312", "python.exe"),
    // WindowsApps
    path.join(localAppData, "Microsoft", "WindowsApps", "python3.12.exe"),
    path.join(localAppData, "Microsoft", "WindowsApps", "python.exe"),
    // Scoop / pyenv-win / Chocolatey
    path.join(userProfile, "scoop", "apps", "python", "current", "python.exe"),
    path.join(userProfile, "scoop", "shims", "python.exe"),
    path.join(userProfile, ".pyenv", "pyenv-win", "shims", "python.exe"),
    path.join(systemDrive, "tools", "python312", "python.exe"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "chocolatey", "bin", "python.exe"),
  ];

  for (const p of knownExePaths) {
    if (p) addExe(p, "standard path");
  }

  // 2. Query Windows Registry for Python 3.12
  try {
    const regKeys = [
      "HKCU\\Software\\Python\\PythonCore\\3.12\\InstallPath",
      "HKLM\\Software\\Python\\PythonCore\\3.12\\InstallPath",
      "HKCU\\Software\\Python\\PythonCore\\3.12-64\\InstallPath",
      "HKLM\\Software\\Python\\PythonCore\\3.12-64\\InstallPath",
      "HKCU\\Software\\Python\\PythonCore\\3.12-arm64\\InstallPath",
      "HKLM\\Software\\Python\\PythonCore\\3.12-arm64\\InstallPath",
      "HKLM\\SOFTWARE\\WOW6432Node\\Python\\PythonCore\\3.12\\InstallPath",
      "HKCU\\Software\\Python\\PythonCore",
      "HKLM\\Software\\Python\\PythonCore",
    ];
    for (const rk of regKeys) {
      try {
        const out = execSync(`reg query "${rk}" /s`, {
          encoding: "utf-8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
        for (const line of out.split("\r\n")) {
          const match = line.match(/\s+REG_SZ\s+(.*)$/i);
          if (match) {
            const rawVal = match[1].trim();
            if (rawVal.toLowerCase().endsWith("python.exe") && fs.existsSync(rawVal)) {
              addExe(rawVal, "registry");
            } else if (fs.existsSync(path.join(rawVal, "python.exe"))) {
              addExe(path.join(rawVal, "python.exe"), "registry");
            }
          }
        }
      } catch {
        /* key not present */
      }
    }
  } catch {
    /* non-fatal */
  }

  // 3. Py launcher (py.exe) candidates
  const pyLaunchers = [
    path.join(localAppData, "Programs", "Python", "Launcher", "py.exe"),
    path.join(windir, "py.exe"),
    path.join(windir, "System32", "py.exe"),
    "py",
  ];
  for (const pyExe of pyLaunchers) {
    if (pyExe === "py" || fs.existsSync(pyExe)) {
      results.push({ cmd: [pyExe, "-V:3.12"], source: "py manager" });
      results.push({ cmd: [pyExe, "-3.12"], source: "py launcher" });
    }
  }

  return results;
}

if (process.platform === "darwin") {
  const extraPaths = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/opt/local/bin",
    "/opt/local/sbin",
  ];
  const currentPath = process.env.PATH || "";
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  for (const p of extraPaths) {
    if (!parts.includes(p) && fs.existsSync(p)) {
      parts.unshift(p);
    }
  }
  process.env.PATH = parts.join(path.delimiter);
} else if (process.platform === "win32") {
  refreshWindowsEnv();
  try {
    const { applyAmdZludaEnv } = require("@/zluda");
    applyAmdZludaEnv();
  } catch {
    /* ignore during early bootstrap */
  }
}

// app/api is two levels below the repo root, both as source and compiled.
export function getRepoRoot(): string {
  if (process.env.APPLIO_ROOT && fs.existsSync(process.env.APPLIO_ROOT)) {
    return path.resolve(process.env.APPLIO_ROOT);
  }
  return path.resolve(__dirname, "..", "..", "..");
}

// Read-only code dir in the packaged app (resources/app). main.ts exports it
// as APPLIO_CODE_ROOT while APPLIO_ROOT points at the writable user data dir.
// In dev there is no such var and the code root is the repo root.
export function getCodeRoot(): string {
  const code = process.env.APPLIO_CODE_ROOT;
  if (code && fs.existsSync(code)) {
    return path.resolve(code);
  }
  return getRepoRoot();
}

// Single source of truth for the installed app version. Tries the code root
// first (packaged app), then the repo/data root (dev), then the bundled
// sub-packages, then config_template.json (kept in sync by sync-version.mjs).
// Never reads the mutable assets/config.json "version" field — user values
// override the template merge there so it goes stale and must not drive
// update comparisons.
export function getAppVersion(): string {
  const codeRoot = getCodeRoot();
  const repoRoot = getRepoRoot();
  const candidates = [
    path.join(codeRoot, "package.json"),
    path.join(repoRoot, "package.json"),
    path.join(codeRoot, "app", "desktop", "package.json"),
    path.join(repoRoot, "app", "desktop", "package.json"),
    path.join(codeRoot, "app", "api", "package.json"),
    path.join(repoRoot, "app", "api", "package.json"),
  ];
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const pkg = JSON.parse(fs.readFileSync(f, "utf-8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        const v = pkg.version.trim();
        if (v.toLowerCase() === "unknown") continue;
        return v;
      }
    } catch {
      /* try next candidate */
    }
  }
  for (const base of [codeRoot, repoRoot]) {
    try {
      const f = path.join(base, "assets", "config_template.json");
      if (!fs.existsSync(f)) continue;
      const cfg = JSON.parse(fs.readFileSync(f, "utf-8")) as { version?: unknown };
      if (typeof cfg.version === "string" && cfg.version.trim()) {
        const v = cfg.version.trim();
        if (v.toLowerCase() === "unknown") continue;
        return v;
      }
    } catch {
      /* ignore */
    }
  }
  return "unknown";
}

// Inspects pyvenv.cfg without spawning a process.
export function resolveBasePythonFromCfg(venvDir: string): string | null {
  try {
    const cfgPath = path.join(venvDir, "pyvenv.cfg");
    if (!fs.existsSync(cfgPath)) return null;
    const content = fs.readFileSync(cfgPath, "utf-8");
    let home: string | null = null;
    let executable: string | null = null;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("executable =") || line.startsWith("executable=")) {
        executable = line.replace(/^executable\s*=\s*/, "").trim();
      }
      if (line.startsWith("home =") || line.startsWith("home=")) {
        home = line.replace(/^home\s*=\s*/, "").trim();
      }
    }
    if (executable && fs.existsSync(executable)) {
      return executable;
    }
    if (home) {
      for (const sub of ["python.exe", path.join("Scripts", "python.exe"), path.join("bin", "python.exe")]) {
        const cand = path.join(home, sub);
        if (fs.existsSync(cand)) return cand;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Windows venv python.exe is a shim that flashes a terminal; use the real binary.
export function ensureWindowsRealPythonSync(venvDir: string): string | null {
  if (process.platform !== "win32") return null;
  const probe = path.join(venvDir, "Scripts", "python.exe");
  if (!fs.existsSync(probe)) return null;

  const realTarget = path.join(venvDir, "Scripts", "python.real.exe");
  const base = resolveBasePythonFromCfg(venvDir);
  if (!base || !fs.existsSync(base)) {
    return fs.existsSync(realTarget) ? realTarget : probe;
  }

  const baseDir = path.dirname(base);

  // 1. Replace the venv shim with the real interpreter.
  let probeReplaced = false;
  try {
    const probeStat = fs.statSync(probe);
    const baseStat = fs.statSync(base);
    if (probeStat.size !== baseStat.size) {
      fs.copyFileSync(base, probe);
    }
    probeReplaced = true;
  } catch {
    // If probe is currently running or locked by Windows (EBUSY/EPERM), fall back to staging python.real.exe
  }

  try {
    let stale = !fs.existsSync(realTarget);
    if (!stale) {
      const ts = fs.statSync(realTarget);
      const bs = fs.statSync(base);
      stale = ts.size !== bs.size || ts.mtimeMs < bs.mtimeMs - 1000;
    }
    if (stale) {
      fs.copyFileSync(base, realTarget);
    }
  } catch {
    /* non-fatal */
  }

  try {
    const basePythonw = path.join(baseDir, "pythonw.exe");
    const targetPythonw = path.join(venvDir, "Scripts", "pythonw.exe");
    if (fs.existsSync(basePythonw) && fs.existsSync(targetPythonw)) {
      if (fs.statSync(basePythonw).size !== fs.statSync(targetPythonw).size) {
        fs.copyFileSync(basePythonw, targetPythonw);
      }
    }
  } catch {
    /* non-fatal */
  }

  // Real Windows Python binaries depend on companion DLLs (e.g. python312.dll, python3.dll, vcruntime140.dll).
  // When copying python.exe into Scripts, Windows fails with STATUS_DLL_NOT_FOUND (code 3221225781 / 0xC0000135)
  // unless those DLLs are in Scripts alongside the executable or baseDir is in PATH.
  try {
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
        const src = path.join(baseDir, entry.name);
        const dst = path.join(venvDir, "Scripts", entry.name);
        try {
          if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
            fs.copyFileSync(src, dst);
          }
        } catch {
          /* non-fatal */
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  // Prepend venv Scripts and base interpreter paths to process.env.PATH so any child process finds DLLs
  try {
    const currentPath = process.env.PATH || "";
    const parts = currentPath.split(path.delimiter).filter(Boolean);
    const toAdd = [path.join(venvDir, "Scripts"), baseDir, path.join(baseDir, "Scripts")];
    let changed = false;
    for (const p of toAdd) {
      if (fs.existsSync(p) && !parts.some((existing) => existing.toLowerCase() === p.toLowerCase())) {
        parts.unshift(p);
        changed = true;
      }
    }
    if (changed) {
      process.env.PATH = parts.join(path.delimiter);
    }
  } catch {
    /* non-fatal */
  }

  // Prefer python.exe when it matches the base interpreter size to keep multiprocessing child spawning working
  if (probeReplaced && fs.existsSync(probe)) {
    try {
      if (fs.statSync(probe).size === fs.statSync(base).size) {
        return probe;
      }
    } catch {
      /* fallback */
    }
  }

  return fs.existsSync(realTarget) ? realTarget : probe;
}

export function getPythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const root = getRepoRoot();
  if (process.platform === "win32") {
    for (const sub of [".venv", "venv", "env"]) {
      ensureWindowsRealPythonSync(path.join(root, sub));
    }
    const venvCandidates = [
      // NOTE: prefer python.exe over python.real.exe. ensureWindowsRealPythonSync
      // keeps python.exe synced to the real binary, and multiprocessing on
      // Windows relaunches sys._base_executable (derived from the exe
      // basename): renamed copies like python.real.exe resolve to a
      // non-existent base path and child spawning fails with FileNotFoundError.
      path.join(root, ".venv", "Scripts", "python.exe"),
      path.join(root, ".venv", "Scripts", "pythonw.exe"),
      path.join(root, ".venv", "Scripts", "python.real.exe"),
      path.join(root, "venv", "Scripts", "python.exe"),
      path.join(root, "venv", "Scripts", "pythonw.exe"),
      path.join(root, "venv", "Scripts", "python.real.exe"),
      path.join(root, "env", "Scripts", "python.exe"),
      path.join(root, "env", "Scripts", "pythonw.exe"),
      path.join(root, "env", "Scripts", "python.real.exe"),
    ];
    for (const candidate of venvCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    for (const cand of getWindowsPythonCandidates()) {
      if (cand.cmd.length === 1 && fs.existsSync(cand.cmd[0])) {
        return cand.cmd[0];
      }
    }
    return "python";
  }
  const venvCandidates = [
    path.join(root, ".venv", "bin", "python"),
    path.join(root, "venv", "bin", "python"),
    path.join(root, "env", "bin", "python"),
  ];
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python3";
}

// For pure background services that run daemons/servers (TensorBoard, Discord presence)
// where a GUI subsystem binary (pythonw.exe on Windows) is preferred to guarantee
// no console window is ever opened.
export function getPythonGuiBin(): string {
  const py = getPythonBin();
  if (process.platform === "win32") {
    const pw = path.join(path.dirname(py), "pythonw.exe");
    if (fs.existsSync(pw)) return pw;
  }
  return py;
}

// Base environment for every spawned Python process. On Apple Silicon,
// PyTorch MPS needs fallback enabled and the memory high-watermark
// disabled, otherwise inference crashes on unsupported ops. ??= respects
// values the user already exported.
//
// PYTHONUNBUFFERED is critical: piped stdout is block-buffered by default,
// so epoch/progress print() lines would sit in the buffer for minutes and
// the UI consoles would look dead (then burst). Unbuffered keeps every
// spawned tool's logs live.
export function pythonEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8", ...extra };
  env.PYTHONUNBUFFERED ??= "1";
  if (process.platform === "darwin") {
    env.PYTORCH_ENABLE_MPS_FALLBACK ??= "1";
    env.PYTORCH_MPS_HIGH_WATERMARK_RATIO ??= "0.0";
    env.OMP_NUM_THREADS ??= "1";
  } else if (process.platform === "win32") {
    try {
      const { applyAmdZludaEnv } = require("@/zluda");
      applyAmdZludaEnv();
    } catch {
      /* ignore */
    }
    if (process.env.HIP_VISIBLE_DEVICES) env.HIP_VISIBLE_DEVICES = process.env.HIP_VISIBLE_DEVICES;
    if (process.env.ZLUDA_COMGR_LOG_LEVEL) env.ZLUDA_COMGR_LOG_LEVEL = process.env.ZLUDA_COMGR_LOG_LEVEL;
    if (process.env.DISABLE_ADDMM_CUDA_LT) env.DISABLE_ADDMM_CUDA_LT = process.env.DISABLE_ADDMM_CUDA_LT;
  }
  return env;
}

export function noEnv(): boolean {
  return process.argv.includes("--no-env") || process.env.APPLIO_NO_ENV === "1";
}

export function getUploadsDir(): string {
  const dir = process.env.UPLOADS_DIR || path.join(getRepoRoot(), "assets", "audios", "_uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getOutputsDir(): string {
  const dir = process.env.OUTPUTS_DIR || path.join(getRepoRoot(), "assets", "audios");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Spawns a Python child process, automatically using the ZLUDA launcher
 * wrapper on Windows when an AMD GPU and ZLUDA are detected.
 */
export function spawnPython(
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
  } = {},
): ChildProcess {
  const cwd = opts.cwd || getRepoRoot();
  const py = getPythonBin();
  let zluda: { exe: string } | null = null;
  if (process.platform === "win32") {
    try {
      const { getZludaLauncher } = require("@/zluda");
      zluda = getZludaLauncher();
    } catch {
      /* ignore */
    }
  }

  const cmd = zluda ? zluda.exe : py;
  const finalArgs = zluda ? ["--", py, ...args] : args;
  const pathEnv = `${cwd}${path.delimiter}${process.env.PATH || ""}`;

  return spawn(cmd, finalArgs, {
    cwd,
    detached: opts.detached ?? false,
    env: opts.env || pythonEnv({ PATH: pathEnv }),
    windowsHide: true,
  });
}

export function runPythonModule(
  args: string[],
  opts: {
    cwd?: string;
    // Unix only: new process group so the whole tree can be signaled.
    // Never enable on Windows — a detached console binary pops its own window.
    detached?: boolean;
    onData?: (chunk: string, stream: "stdout" | "stderr") => void;
    onSpawn?: (pid?: number) => void;
  } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawnPython(args, {
      cwd: opts.cwd,
      detached: opts.detached,
    });
    opts.onSpawn?.(child.pid);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onData?.(s, "stdout");
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      opts.onData?.(s, "stderr");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

export function resolveInsideRepo(p: string): string {
  const root = getRepoRoot();
  const resolved = path.resolve(root, p);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || rel.includes("..")) {
    throw new Error(`Path escapes repo root: ${p}`);
  }
  return resolved;
}

export function resolveUserPath(p: string): string {
  if (!p) return "";
  const cleaned = p.trim().replace(/^["']|["']$/g, "");
  if (path.isAbsolute(cleaned)) {
    if (!fs.existsSync(cleaned)) throw new Error(`File not found: ${cleaned}`);
    return cleaned;
  }
  return resolveInsideRepo(cleaned);
}
