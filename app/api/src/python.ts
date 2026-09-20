import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// app/api is two levels below the repo root, both as source and compiled.
export function getRepoRoot(): string {
  if (process.env.APPLIO_ROOT && fs.existsSync(process.env.APPLIO_ROOT)) {
    return path.resolve(process.env.APPLIO_ROOT);
  }
  return path.resolve(__dirname, "..", "..", "..");
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

  // 1. Replace the venv shim with the real interpreter.
  try {
    const probeStat = fs.statSync(probe);
    const baseStat = fs.statSync(base);
    if (probeStat.size !== baseStat.size) {
      fs.copyFileSync(base, probe);
    }
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
    const baseDir = path.dirname(base);
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
export function pythonEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8", ...extra };
  if (process.platform === "darwin") {
    env.PYTORCH_ENABLE_MPS_FALLBACK ??= "1";
    env.PYTORCH_MPS_HIGH_WATERMARK_RATIO ??= "0.0";
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
  const cwd = opts.cwd || getRepoRoot();
  return new Promise((resolve, reject) => {
    const pathEnv = `${cwd}${path.delimiter}${process.env.PATH || ""}`;
    const child: ChildProcess = spawn(getPythonBin(), args, {
      cwd,
      detached: opts.detached ?? false,
      env: pythonEnv({ PATH: pathEnv }),
      windowsHide: true,
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
