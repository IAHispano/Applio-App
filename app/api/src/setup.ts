import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendLog, createJob, getJob, type Job, setDone, setError, setRunning } from "@/jobs";
import {
  ensureWindowsRealPythonSync,
  getRepoRoot,
  getWindowsPythonCandidates,
  noEnv,
  refreshWindowsEnv,
  resolveBasePythonFromCfg,
} from "@/python";

// First-run setup engine: checks every dependency on startup and installs
// what's missing, streaming progress as a job.

export type CheckState = "ok" | "missing" | "warn";

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckState;
  detail: string;
}

export interface SetupStatus {
  ready: boolean;
  checks: SetupCheck[];
  python: string[] | null;
  checkedAt: string;
}

export interface PythonInfo {
  cmd: string[];
  version: string;
  source: string;
}

const MIN_NODE = 20;
const SLOW_CHECK_TTL_MS = 60 * 60 * 1000;

let cached: { at: number; status: SetupStatus } | null = null;
let activeInstallId: string | null = null;

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCmd(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; shell?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let done = false;
    const cwd = opts.cwd || getRepoRoot();
    const extraDirs: string[] = [cwd];
    if (path.isAbsolute(cmd)) {
      extraDirs.push(path.dirname(cmd));
      extraDirs.push(path.join(path.dirname(cmd), "Scripts"));
    }
    const currentPath = process.env.PATH || "";
    const parts = currentPath.split(path.delimiter).filter(Boolean);
    for (const d of extraDirs) {
      if (exists(d) && !parts.some((p) => p.toLowerCase() === d.toLowerCase())) {
        parts.unshift(d);
      }
    }
    const pathEnv = parts.join(path.delimiter);
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      shell: opts.shell || false,
      env: { ...process.env, PATH: pathEnv, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
      finish(124);
    }, opts.timeoutMs || 120000);
    timer.unref?.();
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code));
  });
}

function parsePyVersion(out: string): string | null {
  const m = out.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function pySupported(version: string): boolean {
  const m = version.match(/(\d+)\.(\d+)/);
  if (!m) return false;
  return Number(m[1]) === 3 && Number(m[2]) === 12;
}

export async function findPython(): Promise<PythonInfo | null> {
  const root = getRepoRoot();
  if (process.platform === "win32") {
    refreshWindowsEnv();
    for (const sub of [".venv", "venv", "env"]) {
      ensureWindowsRealPythonSync(path.join(root, sub));
    }
  }
  const candidates: Array<{ cmd: string[]; source: string }> = [];
  if (process.env.PYTHON_BIN) candidates.push({ cmd: [process.env.PYTHON_BIN], source: "PYTHON_BIN" });
  if (process.platform === "win32") {
    // NOTE: python.exe first — renamed copies (python.real.exe) break
    // multiprocessing child spawning (sys._base_executable mismatch).
    candidates.push({ cmd: [path.join(root, ".venv", "Scripts", "python.exe")], source: "app .venv" });
    candidates.push({
      cmd: [path.join(root, ".venv", "Scripts", "pythonw.exe")],
      source: "app .venv (pythonw)",
    });
    candidates.push({
      cmd: [path.join(root, ".venv", "Scripts", "python.real.exe")],
      source: "app .venv (real)",
    });
    candidates.push({ cmd: [path.join(root, "venv", "Scripts", "python.exe")], source: "app venv/" });
    candidates.push({
      cmd: [path.join(root, "venv", "Scripts", "pythonw.exe")],
      source: "app venv/ (pythonw)",
    });
    candidates.push({
      cmd: [path.join(root, "venv", "Scripts", "python.real.exe")],
      source: "app venv/ (real)",
    });
    candidates.push({ cmd: [path.join(root, "env", "Scripts", "python.exe")], source: "app env/" });
    candidates.push({
      cmd: [path.join(root, "env", "Scripts", "pythonw.exe")],
      source: "app env/ (pythonw)",
    });
    for (const cand of getWindowsPythonCandidates()) {
      candidates.push(cand);
    }
    candidates.push({ cmd: ["py", "-V:3.12"], source: "py manager" });
    candidates.push({ cmd: ["py", "-3.12"], source: "py launcher" });
    candidates.push({ cmd: ["python"], source: "PATH" });
  } else {
    candidates.push({ cmd: [path.join(root, "env", "bin", "python")], source: "app env/" });
    candidates.push({ cmd: [path.join(root, ".venv", "bin", "python")], source: "app .venv" });
    candidates.push({ cmd: [path.join(root, "venv", "bin", "python")], source: "app venv" });
    candidates.push({ cmd: ["python3.12"], source: "PATH" });
    candidates.push({ cmd: ["python3"], source: "PATH" });
    candidates.push({ cmd: ["python"], source: "PATH" });
  }
  for (const c of candidates) {
    if (path.isAbsolute(c.cmd[0]) && !exists(c.cmd[0])) continue;
    const r = await runCmd(c.cmd[0], [...c.cmd.slice(1), "--version"], { timeoutMs: 15000 });
    const version = parsePyVersion(r.stdout + r.stderr);
    if (r.code === 0 && version && pySupported(version)) {
      if (process.platform === "win32" && path.isAbsolute(c.cmd[0])) {
        try {
          const binDir = path.dirname(c.cmd[0]);
          const scriptsDir = path.join(binDir, "Scripts");
          const currentParts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
          for (const d of [binDir, scriptsDir]) {
            if (exists(d) && !currentParts.some((p) => p.toLowerCase() === d.toLowerCase())) {
              currentParts.unshift(d);
            }
          }
          process.env.PATH = currentParts.join(path.delimiter);
        } catch {
          /* non-fatal */
        }
      }
      return { cmd: c.cmd, version, source: c.source };
    }
  }
  return null;
}

export async function isWindowsVcRedistInstalled(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const sys32 = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32");
  const msvcp = path.join(sys32, "msvcp140.dll");
  const vcruntime = path.join(sys32, "vcruntime140_1.dll");
  if (exists(msvcp) && exists(vcruntime)) {
    return true;
  }
  try {
    const { execSync } = require("node:child_process");
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" /v Installed',
      {
        encoding: "utf-8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (out.includes("0x1")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export async function ensureWindowsVcRedist(job?: Job): Promise<boolean> {
  if (process.platform !== "win32") return true;
  if (await isWindowsVcRedistInstalled()) return true;

  const log = (m: string) => {
    if (job) appendLog(job, m);
    else console.log(`[setup] ${m}`);
  };

  log("Microsoft Visual C++ 2015-2022 Redistributable is required by PyTorch (c10.dll) but missing.");
  log("Installing Microsoft Visual C++ Redistributable…");

  // 1. Try winget
  try {
    const wingetRes = await runCmd(
      "winget",
      [
        "install",
        "-e",
        "--id",
        "Microsoft.VCRedist.2015+.x64",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
      { timeoutMs: 180000 },
    );
    if (wingetRes.code === 0 && (await isWindowsVcRedistInstalled())) {
      log("Microsoft Visual C++ Redistributable installed successfully via winget ✓");
      return true;
    }
  } catch (err) {
    log(`winget VCRedist note: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Direct download fallback
  try {
    log("Downloading VC++ Redistributable from https://aka.ms/vs/17/release/vc_redist.x64.exe…");
    const installerUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
    const tmpInstaller = path.join(process.env.TEMP || getRepoRoot(), "VC_redist.x64.exe");
    const res = await fetch(installerUrl, { signal: AbortSignal.timeout(120000), redirect: "follow" });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tmpInstaller, buf);
      log("Running VC++ Redistributable installer silently…");
      await runCmd(tmpInstaller, ["/quiet", "/norestart"], { timeoutMs: 180000 });
      try {
        fs.unlinkSync(tmpInstaller);
      } catch {}
      if (await isWindowsVcRedistInstalled()) {
        log("Microsoft Visual C++ Redistributable installed successfully ✓");
        return true;
      }
    }
  } catch (dlErr) {
    log(
      `VC++ Redistributable direct install note: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`,
    );
  }

  return await isWindowsVcRedistInstalled();
}

async function checkEngineDeps(py: string[]): Promise<{ ok: boolean; detail: string }> {
  const code = "import torch, uvicorn, librosa; print(torch.__version__)";
  const r = await runCmd(py[0], [...py.slice(1), "-c", code], { timeoutMs: 180000 });
  if (r.code === 0) return { ok: true, detail: `torch ${r.stdout.trim()}` };
  const errOutput = (r.stderr + "\n" + r.stdout).trim();
  if (
    errOutput.includes("126") ||
    errOutput.includes("c10.dll") ||
    errOutput.includes("VCRUNTIME") ||
    errOutput.includes("MSVCP") ||
    errOutput.includes("The specified module could not be found")
  ) {
    return {
      ok: false,
      detail:
        "Visual C++ Redistributable missing (PyTorch c10.dll failed to load). Install from https://aka.ms/vs/17/release/vc_redist.x64.exe and retry.",
    };
  }
  return {
    ok: false,
    detail: (r.stderr.trim().split("\n").pop() || "engine packages missing").slice(0, 300),
  };
}

async function checkFfmpeg(): Promise<{ ok: boolean; detail: string }> {
  const root = getRepoRoot();
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const localExe = path.join(root, exeName);
  let exe = exists(localExe) ? localExe : exeName;
  if (!exists(localExe) && process.platform === "darwin") {
    const candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"];
    for (const cand of candidates) {
      if (exists(cand)) {
        exe = cand;
        break;
      }
    }
  }
  const r = await runCmd(exe, ["-version"], { timeoutMs: 15000 });
  if (r.code === 0) {
    const detail = (r.stdout + r.stderr).split("\n")[0].trim().slice(0, 120);
    return { ok: true, detail: exists(localExe) ? `${detail} (bundled)` : detail };
  }
  return { ok: false, detail: "ffmpeg not on PATH" };
}

const WEB_PORT = process.env.WEB_PORT || "3000";

// A running `next dev` owns app/web/.next (it keeps .next/trace open), so a
// concurrent `next build` dies with EPERM on Windows. Probe the port instead
// of failing the whole install over a build dev mode does not need.
async function webDevServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}/`, {
      method: "HEAD",
      signal: AbortSignal.timeout(1500),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function checkWebBuild(): { ok: boolean; detail: string } {
  // In the packaged app APPLIO_ROOT points at the writable data dir
  // (~/.config/Applio/data), but the web bundle ships in the read-only code
  // dir (resources/app). main.ts exports it as APPLIO_CODE_ROOT; dev mode
  // has no such var and falls back to the repo root.
  const codeRoot = process.env.APPLIO_CODE_ROOT;
  const root = codeRoot && exists(codeRoot) ? path.resolve(codeRoot) : getRepoRoot();
  if (exists(path.join(root, "app", "web", ".next", "standalone", "server.js"))) {
    return { ok: true, detail: "production build ready" };
  }
  if (exists(path.join(root, "app", "web", ".next", "BUILD_ID"))) {
    return { ok: true, detail: "build ready" };
  }
  if (exists(path.join(root, "app", "web", "package.json"))) {
    return { ok: true, detail: "web source ready" };
  }
  return { ok: false, detail: "web bundle missing — run pnpm build" };
}

export async function getStatus(force = false): Promise<SetupStatus> {
  if (noEnv()) {
    const bypassed: SetupStatus = {
      ready: true,
      checks: [
        { id: "node", label: `Node.js ${process.version}`, status: "ok", detail: "runtime OK" },
        { id: "web", label: "Web interface build", status: "ok", detail: "checks bypassed with --no-env" },
        { id: "python", label: "Python 3.12", status: "ok", detail: "checks bypassed with --no-env" },
        {
          id: "engine",
          label: "Engine packages (torch, uvicorn, librosa)",
          status: "ok",
          detail: "checks bypassed with --no-env",
        },
        { id: "ffmpeg", label: "ffmpeg", status: "ok", detail: "checks bypassed with --no-env" },
        { id: "models", label: "Voice models", status: "ok", detail: "checks bypassed with --no-env" },
      ],
      python: ["no-env"],
      checkedAt: new Date().toISOString(),
    };
    cached = { at: Date.now(), status: bypassed };
    return bypassed;
  }
  if (!force && cached && Date.now() - cached.at < SLOW_CHECK_TTL_MS) return cached.status;

  const checks: SetupCheck[] = [];
  const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
  checks.push({
    id: "node",
    label: `Node.js ${process.version}`,
    status: nodeMajor >= MIN_NODE ? "ok" : "missing",
    detail: nodeMajor >= MIN_NODE ? "runtime OK" : `Node.js ${MIN_NODE}+ required: https://nodejs.org`,
  });

  const web = checkWebBuild();
  checks.push({
    id: "web",
    label: "Web interface build",
    status: web.ok ? "ok" : "missing",
    detail: web.detail,
  });

  const py = await findPython();
  checks.push({
    id: "python",
    label: "Python 3.12",
    status: py ? "ok" : "missing",
    detail: py ? `${py.version} (${py.source})` : "no suitable Python found",
  });

  if (py) {
    const deps = await checkEngineDeps(py.cmd);
    checks.push({
      id: "engine",
      label: "Engine packages (torch, uvicorn, librosa)",
      status: deps.ok ? "ok" : "missing",
      detail: deps.detail,
    });
  } else {
    checks.push({
      id: "engine",
      label: "Engine packages (torch, uvicorn, librosa)",
      status: "missing",
      detail: "needs Python first",
    });
  }

  const ff = await checkFfmpeg();
  checks.push({
    id: "ffmpeg",
    label: "ffmpeg",
    status: ff.ok ? "ok" : "warn",
    detail: ff.ok ? ff.detail : `${ff.detail} — some audio formats may fail`,
  });

  const logsDir = path.join(getRepoRoot(), "logs");
  let models = 0;
  try {
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".pth") && !e.name.startsWith("G_") && !e.name.startsWith("D_")) models++;
      }
    };
    if (exists(logsDir)) walk(logsDir);
  } catch {
    /* ignore */
  }
  checks.push({
    id: "models",
    label: "Voice models",
    status: "ok",
    detail: models > 0 ? `${models} model(s) in logs/` : "none yet — use the Download tab",
  });

  if (process.platform === "win32") {
    try {
      const { findHipSdk, getGpuHardware, isZludaPatched } = await import("@/zluda");
      const gpu = getGpuHardware();
      if (gpu.isAmd) {
        const hip = findHipSdk();
        const root = getRepoRoot();
        const torchLibDir = py
          ? path.join(path.dirname(py.cmd[0]), "..", "Lib", "site-packages", "torch", "lib")
          : path.join(root, ".venv", "Lib", "site-packages", "torch", "lib");
        const patched = isZludaPatched(torchLibDir);

        if (!hip) {
          checks.push({
            id: "zluda",
            label: "AMD GPU (HIP SDK)",
            status: "warn",
            detail: `${gpu.gpus.join(", ") || "AMD GPU"} detected, but AMD HIP SDK is missing. Install HIP SDK (5.7, 6.1, 6.2, or 6.4) from AMD to enable GPU acceleration.`,
          });
        } else if (!patched) {
          checks.push({
            id: "zluda",
            label: "AMD GPU Acceleration (ZLUDA)",
            status: "warn",
            detail: `HIP SDK ${hip.version} found — ZLUDA will be automatically configured during Install/Repair.`,
          });
        } else {
          const { isZludaCompiled } = await import("@/zluda");
          const compiled = isZludaCompiled(torchLibDir);
          checks.push({
            id: "zluda",
            label: "AMD GPU Acceleration (ZLUDA)",
            status: compiled ? "ok" : "warn",
            detail: compiled
              ? `${gpu.gpus[0] || "AMD GPU"} via ZLUDA (HIP SDK ${hip.version}, kernels precompiled) ✓`
              : `ZLUDA ready (HIP ${hip.version}) — Initial GPU kernel compilation pending (will compile during Install/Repair).`,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (process.platform === "win32") {
    const vcInstalled = await isWindowsVcRedistInstalled();
    if (!vcInstalled) {
      checks.push({
        id: "vcredist",
        label: "Visual C++ 2015-2022 Redistributable",
        status: "missing",
        detail: "Required for PyTorch (c10.dll): https://aka.ms/vs/17/release/vc_redist.x64.exe",
      });
    }
  }

  const ready = checks.every(
    (c) => c.status === "ok" || c.id === "ffmpeg" || c.id === "models" || c.id === "zluda",
  );
  const status: SetupStatus = {
    ready,
    checks,
    python: py ? py.cmd : null,
    checkedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), status };
  return status;
}

async function streamRun(
  job: Job,
  cmd: string,
  args: string[],
  opts: { shell?: boolean } = {},
): Promise<void> {
  appendLog(job, `$ ${cmd} ${args.join(" ")}`);
  const root = getRepoRoot();
  const extraDirs: string[] = [root];
  if (path.isAbsolute(cmd)) {
    extraDirs.push(path.dirname(cmd));
    extraDirs.push(path.join(path.dirname(cmd), "Scripts"));
  }
  const venvDir = path.join(root, ".venv");
  const basePy = resolveBasePythonFromCfg(venvDir);
  if (basePy) {
    extraDirs.push(path.dirname(basePy));
    extraDirs.push(path.join(path.dirname(basePy), "Scripts"));
  }
  const currentPath = process.env.PATH || "";
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  for (const d of extraDirs) {
    if (exists(d) && !parts.some((p) => p.toLowerCase() === d.toLowerCase())) {
      parts.unshift(d);
    }
  }
  const pathEnv = parts.join(path.delimiter);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      windowsHide: true,
      shell: opts.shell || false,
      env: { ...process.env, PATH: pathEnv, PYTHONIOENCODING: "utf-8", UV_HTTP_TIMEOUT: "300" },
    });
    child.stdout?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) appendLog(job, line.trim().slice(0, 500));
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) appendLog(job, line.trim().slice(0, 500));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start ${cmd}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function ensureUv(job: Job): Promise<string | null> {
  const uvCandidates = ["uv", path.join(process.env.HOME || "", ".local", "bin", "uv")];
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA || "";
    const userProf = process.env.USERPROFILE || "";
    uvCandidates.push(
      path.join(localApp, "uv", "uv.exe"),
      path.join(userProf, ".cargo", "bin", "uv.exe"),
      path.join(localApp, "Programs", "uv", "uv.exe"),
      path.join(userProf, ".local", "bin", "uv.exe"),
    );
  }
  for (const c of uvCandidates) {
    if (path.isAbsolute(c) && !exists(c)) continue;
    if ((await runCmd(c, ["--version"], { timeoutMs: 15000 })).code === 0) return c;
  }
  if (process.platform === "win32") {
    return null;
  }
  appendLog(job, "Installing uv…");
  await streamRun(job, "curl -LsSf https://astral.sh/uv/install.sh | sh", [], { shell: true });
  const localUv = path.join(process.env.HOME || "", ".local", "bin", "uv");
  if (process.env.HOME && exists(localUv)) {
    process.env.PATH = `${path.join(process.env.HOME, ".local", "bin")}${path.delimiter}${process.env.PATH || ""}`;
    return localUv;
  }
  return null;
}

async function bootstrapSystemPython(job: Job): Promise<string[]> {
  appendLog(job, "No system Python found — bootstrapping one…");
  if (process.platform === "win32") {
    // If uv is available, use it to create virtualenv with Python 3.12 directly
    const uvBin = await ensureUv(job);
    if (uvBin) {
      const venvDir = path.join(getRepoRoot(), ".venv");
      appendLog(job, "Creating app virtualenv with uv (downloads Python 3.12 if needed)…");
      try {
        await streamRun(job, uvBin, ["venv", venvDir, "--python", "3.12", "--seed"]);
        const venvPy = path.join(venvDir, "Scripts", "python.exe");
        if (exists(venvPy)) return [venvPy];
      } catch (uvErr) {
        appendLog(job, `uv note: ${uvErr instanceof Error ? uvErr.message : String(uvErr)}`);
      }
    }

    appendLog(job, "Installing Python 3.12 via winget (no admin needed)…");
    try {
      await streamRun(job, "winget", [
        "install",
        "-e",
        "--id",
        "Python.Python.3.12",
        "--scope",
        "user",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ]);
    } catch (wingetErr) {
      appendLog(job, `winget note: ${wingetErr instanceof Error ? wingetErr.message : String(wingetErr)}`);
      const msg = String(wingetErr);
      if (!msg.includes("ENOENT")) {
        try {
          await streamRun(job, "winget", [
            "install",
            "-e",
            "--id",
            "Python.Python.3.12",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
          ]);
        } catch (retryErr) {
          appendLog(
            job,
            `winget retry note: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
      }
    }

    refreshWindowsEnv();
    let retry = await findPython();
    if (retry) {
      return retry.cmd;
    }

    // Direct download fallback if winget didn't install or register Python 3.12
    appendLog(job, "winget did not yield Python 3.12 — attempting direct installer download…");
    try {
      const installerUrl = "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe";
      const tmpInstaller = path.join(process.env.TEMP || getRepoRoot(), "python-3.12.9-installer.exe");
      appendLog(job, "Downloading Python 3.12 installer from python.org…");
      const res = await fetch(installerUrl, { signal: AbortSignal.timeout(120000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tmpInstaller, buf);
        appendLog(job, "Running Python 3.12 installer silently…");
        await streamRun(job, tmpInstaller, [
          "/passive",
          "InstallAllUsers=0",
          "PrependPath=1",
          "SimpleInstall=1",
        ]);
        try {
          fs.unlinkSync(tmpInstaller);
        } catch {}
        refreshWindowsEnv();
        retry = await findPython();
        if (retry) return retry.cmd;
      }
    } catch (dlErr) {
      appendLog(job, `Direct download note: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`);
    }

    if (!retry) {
      throw new Error(
        "Python 3.12 install finished or was attempted, but no suitable Python 3.12 was found. Install Python 3.12 from https://www.python.org/downloads/ (ensure 'Add python.exe to PATH' is checked) and press Retry Automated Setup.",
      );
    }
    return retry.cmd;
  }
  if (process.platform === "darwin") {
    // Prefer a uv-managed Python: uv downloads a standalone 3.12 build
    // itself, so neither Homebrew nor python.org is required.
    const uvBin = await ensureUv(job);
    if (uvBin) {
      const venvDir = path.join(getRepoRoot(), ".venv");
      appendLog(job, "Creating app virtualenv with uv (downloads Python 3.12 if needed)…");
      await streamRun(job, uvBin, ["venv", venvDir, "--python", "3.12", "--seed"]);
      const venvPy = path.join(venvDir, "bin", "python");
      if (exists(venvPy)) return [venvPy];
      appendLog(job, "uv venv did not produce a Python, falling back to Homebrew…");
    }
    const brew = await runCmd("brew", ["--version"], { timeoutMs: 15000 });
    if (brew.code !== 0) {
      throw new Error(
        "Install Homebrew (https://brew.sh) or Python 3.12 from python.org, then press Install again.",
      );
    }
    await streamRun(job, "brew", ["install", "python@3.12"]);
    const retry = await findPython();
    if (!retry) throw new Error("brew install finished but no Python was found.");
    return retry.cmd;
  }
  const manual =
    "Install Python 3.12 (e.g. sudo apt install python3-venv python3-pip), then press Install again.";
  const uvBin = await ensureUv(job);
  if (uvBin) {
    const venvDir = path.join(getRepoRoot(), ".venv");
    appendLog(job, "Creating app virtualenv with uv…");
    await streamRun(job, uvBin, ["venv", venvDir, "--python", "3.12", "--seed"]);
    const venvPy = path.join(venvDir, "bin", "python");
    if (exists(venvPy)) return [venvPy];
  }
  throw new Error(manual);
}

// Windows-only: standard venv and uv venvs ship python.exe as a trampoline shim
// that re-execs the base interpreter WITHOUT hidden-console spawn
// flags, popping a visible terminal for every engine process. Replace it with
// the real base interpreter and stage python.real.exe next to it.
export async function ensureWindowsRealPython(venvDir: string, job?: Job): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const note = (m: string) => {
    if (job) appendLog(job, m);
    else console.warn(`[setup] ${m}`);
  };
  const fast = ensureWindowsRealPythonSync(venvDir);
  if (fast) return fast;

  // Fallback: if pyvenv.cfg was missing or didn't specify base, probe with pythonw.exe (to avoid popping a console) or python.exe
  const probeW = path.join(venvDir, "Scripts", "pythonw.exe");
  const probe = exists(probeW) ? probeW : path.join(venvDir, "Scripts", "python.exe");
  const target = path.join(venvDir, "Scripts", "python.real.exe");
  if (!exists(probe)) return null;
  try {
    const r = await runCmd(probe, ["-c", "import sys; print(sys._base_executable)"], { timeoutMs: 30000 });
    const base = (r.stdout.trim().split("\n").pop() || "").trim();
    if (r.code !== 0 || !base || !exists(base)) return exists(target) ? target : null;
    let stale = !exists(target);
    if (!stale) {
      try {
        const [ts, bs] = [fs.statSync(target), fs.statSync(base)];
        stale = ts.size !== bs.size || ts.mtimeMs < bs.mtimeMs - 1000;
      } catch {
        stale = true;
      }
    }
    if (stale) {
      note("Staging a real venv Python next to the launcher shim (stops popup terminals)…");
      fs.copyFileSync(base, target);
      try {
        const probeExe = path.join(venvDir, "Scripts", "python.exe");
        if (exists(probeExe)) fs.copyFileSync(base, probeExe);
      } catch {
        /* locked */
      }
    }
    const baseDir = path.dirname(base);
    try {
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
          const src = path.join(baseDir, entry.name);
          const dst = path.join(venvDir, "Scripts", entry.name);
          try {
            if (!exists(dst) || fs.statSync(src).size !== fs.statSync(dst).size) {
              fs.copyFileSync(src, dst);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    const probeExe = path.join(venvDir, "Scripts", "python.exe");
    if (exists(probeExe)) {
      try {
        if (fs.statSync(probeExe).size === fs.statSync(base).size) {
          return probeExe;
        }
      } catch {
        /* ignore */
      }
    }
    return target;
  } catch (err) {
    note(
      `Could not stage python.real.exe (${err instanceof Error ? err.message : err}); using venv python as-is.`,
    );
    return exists(target) ? target : null;
  }
}

export function startInstall(): Job {
  if (activeInstallId) {
    const existing = getJob(activeInstallId);
    if (existing && (existing.status === "queued" || existing.status === "running")) return existing;
  }
  const job = createJob("other", { setup: true });
  activeInstallId = job.id;
  void (async () => {
    setRunning(job);
    try {
      const root = getRepoRoot();
      const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      const pnpmShell = process.platform === "win32";

      let venvPy = venvPythonPath();
      const hasUv = (await runCmd("uv", ["--version"], { timeoutMs: 15000 })).code === 0;
      if (!exists(venvPy)) {
        appendLog(job, "Creating app virtualenv (.venv)…");
        if (hasUv) {
          await streamRun(job, "uv", ["venv", path.join(root, ".venv"), "--python", "3.12", "--seed"]);
        } else {
          // stdlib `venv` inherits the base interpreter version, and
          // findPython() only resolves 3.12, so this venv is 3.12.
          let py312 = await findPython();
          if (!py312) {
            await bootstrapSystemPython(job);
            py312 = await findPython();
          }
          if (!py312) {
            throw new Error(
              "Python 3.12 could not be found or installed. Install Python 3.12 from https://www.python.org/downloads/ and press Install again.",
            );
          }
          // bootstrap may have created the venv itself (macOS uv path).
          venvPy = venvPythonPath();
          if (!exists(venvPy)) {
            await streamRun(job, py312.cmd[0], [
              ...py312.cmd.slice(1),
              "-m",
              "venv",
              path.join(root, ".venv"),
            ]);
          }
        }
      } else {
        appendLog(job, "App virtualenv already exists ✓");
      }
      if (process.platform === "win32") {
        await ensureWindowsRealPython(path.join(root, ".venv"), job);
        // Re-resolve: the staging step may have just created python.real.exe.
        venvPy = venvPythonPath();
        await ensureWindowsVcRedist(job);
      }

      appendLog(job, "Installing engine packages (torch + requirements — this takes a while)…");
      await streamRun(job, venvPy, ["-m", "pip", "install", "-U", "pip"]);
      // NVIDIA GPU wheels live on the PyTorch index, not PyPI. Install the
      // whole requirements file against that index so torch/torchaudio resolve
      // to CUDA builds, e.g.:
      //   uv pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match
      // unsafe-best-match is required because the torch index also mirrors a
      // few PyPI packages at older versions.
      const torchIndex =
        process.platform === "darwin" ? [] : ["--extra-index-url", "https://download.pytorch.org/whl/cu128"];
      const reqFile = path.join(root, "requirements.txt");
      if (hasUv) {
        appendLog(job, "Using uv (fast installer)…");
        await streamRun(job, "uv", [
          "pip",
          "install",
          "--python",
          venvPy,
          "-r",
          reqFile,
          ...torchIndex,
          ...(torchIndex.length > 0 ? ["--index-strategy", "unsafe-best-match"] : []),
        ]);
      } else {
        // Single requirements install so the GPU index applies to torch AND
        // torchaudio (a separate `pip install torch` first would be
        // overwritten by the CPU wheel from PyPI on the second call).
        await streamRun(job, venvPy, ["-m", "pip", "install", "-r", reqFile, ...torchIndex]);
      }

      process.env.PYTHON_BIN = venvPy;
      appendLog(job, `Using Python env: ${venvPy}`);

      if (process.platform === "win32") {
        try {
          const { getGpuHardware, findHipSdk, installAndPatchZluda } = await import("@/zluda");
          const gpu = getGpuHardware();
          const hip = findHipSdk();

          if (gpu.isAmd) {
            appendLog(job, `Detected AMD GPU: ${gpu.gpus.join(", ") || "AMD Radeon"}`);
            if (hip) {
              appendLog(job, `Detected AMD HIP SDK at ${hip.path} (v${hip.version})`);
              try {
                await installAndPatchZluda(path.join(root, ".venv"), job);
              } catch (zludaErr) {
                appendLog(job, `[!] Warning: Failed to configure ZLUDA: ${zludaErr}`);
              }
            } else {
              appendLog(
                job,
                "[!] AMD GPU detected, but AMD HIP SDK was not found. To enable GPU acceleration with ZLUDA, install AMD HIP SDK (v5.7, 6.1, 6.2, or 6.4) and run Install/Repair again.",
              );
            }
          }
        } catch (e) {
          appendLog(job, `Note: ZLUDA detection step: ${e}`);
        }
      }

      appendLog(job, "Downloading base voice models and prerequisites (hubert, rmvpe)…");
      try {
        await streamRun(job, venvPy, [
          path.join("rvc", "lib", "tools", "prerequisites_download.py"),
          "--models",
          "--exe",
        ]);
      } catch (e) {
        appendLog(job, `Note: Prerequisites download step: ${e}`);
      }

      // If AMD GPU and ZLUDA are active, perform the initial GPU kernel pre-compilation
      // during setup so the user never experiences the 15-20 min freeze later during conversion.
      if (process.platform === "win32") {
        try {
          const { getGpuHardware, findHipSdk, isZludaPatched, compileZludaKernels } = await import("@/zluda");
          const gpu = getGpuHardware();
          const hip = findHipSdk();
          const torchLibDir = path.join(root, ".venv", "Lib", "site-packages", "torch", "lib");
          if (gpu.isAmd && hip && isZludaPatched(torchLibDir)) {
            await compileZludaKernels(venvPy, job);
          }
        } catch (e) {
          appendLog(job, `Note: ZLUDA kernel pre-compilation step: ${e}`);
        }
      }

      if (exists(path.join(root, "app", "api", "package.json"))) {
        appendLog(job, "Installing web dependencies…");
        await streamRun(job, pnpmCmd, ["install"], {
          shell: pnpmShell,
        });
        if (!exists(path.join(root, "app", "web", ".next", "standalone", "server.js"))) {
          if (await webDevServerRunning()) {
            appendLog(
              job,
              `! Skipping web build — a dev server is already serving port ${WEB_PORT}. ` +
                "Dev mode does not need the production bundle; to build it, stop `pnpm dev` and run `pnpm build`.",
            );
          } else {
            appendLog(job, "Building web interface…");
            try {
              await streamRun(job, pnpmCmd, ["run", "build"], { shell: pnpmShell });
            } catch (e) {
              appendLog(
                job,
                `! Web build failed (${e}) — everything else installed; run \`pnpm build\` manually.`,
              );
            }
          }
        }
      } else {
        appendLog(job, "Packaged app — web bundles already included ✓");
      }

      cached = null;
      let final = await getStatus(true);
      if (!final.ready && process.platform === "win32") {
        const engineCheck = final.checks.find((c) => c.id === "engine" || c.id === "vcredist");
        if (
          engineCheck &&
          engineCheck.status !== "ok" &&
          (engineCheck.detail.includes("Visual C++") ||
            engineCheck.detail.includes("126") ||
            engineCheck.detail.includes("c10.dll") ||
            engineCheck.detail.includes("The specified module could not be found"))
        ) {
          appendLog(job, "Engine check indicates Visual C++ Redistributable is needed. Installing…");
          await ensureWindowsVcRedist(job);
          cached = null;
          final = await getStatus(true);
        }
      }
      for (const c of final.checks) {
        appendLog(
          job,
          `${c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗"} ${c.label}: ${c.detail}`,
        );
      }
      if (!final.ready) throw new Error("Setup finished but some required checks still fail — see above.");
      setDone(job, { message: "Setup complete — Applio is ready.", ready: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(job, `ERROR: ${message}`);
      setError(job, message);
    } finally {
      activeInstallId = null;
    }
  })();
  return job;
}

export function startPrerequisites(py: string[] | null): Job {
  const job = createJob("other", { setup: "prerequisites" });
  void (async () => {
    setRunning(job);
    try {
      if (!py && process.platform === "win32") {
        await ensureWindowsRealPython(path.join(getRepoRoot(), ".venv"), job);
      }
      // Prefer the venv interpreter (staged real copy on win32) over a bare
      // system python; keep the system fallback when no venv exists yet.
      let exe = py ? py[0] : process.env.PYTHON_BIN || null;
      if (!exe) {
        const venvPy = venvPythonPath();
        exe = exists(venvPy) ? venvPy : process.platform === "win32" ? "python" : "python3";
      }
      const prefix = py ? py.slice(1) : [];
      await streamRun(job, exe, [
        ...prefix,
        path.join("rvc", "lib", "tools", "prerequisites_download.py"),
        "--pretraineds-hifigan",
        "--models",
        "--exe",
      ]);
      setDone(job, { message: "Engine models downloaded." });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(job, `ERROR: ${message}`);
      setError(job, message);
    }
  })();
  return job;
}

export function venvPythonPath(): string {
  const root = getRepoRoot();
  if (process.platform === "win32") {
    ensureWindowsRealPythonSync(path.join(root, ".venv"));
    const real = path.join(root, ".venv", "Scripts", "python.real.exe");
    if (exists(real)) return real;
    return path.join(root, ".venv", "Scripts", "python.exe");
  }
  return path.join(root, ".venv", "bin", "python");
}
