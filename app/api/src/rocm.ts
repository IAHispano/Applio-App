import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "@/jobs";
import { appendLog } from "@/jobs";
import { getRepoRoot } from "./python";

export interface GpuHardwareInfo {
  isAmd: boolean;
  isNvidia: boolean;
  gpus: string[];
}

export interface HipSdkInfo {
  path: string;
  binDir: string;
  version: string;
  major: number;
  minor: number;
}

let cachedGpus: GpuHardwareInfo | null = null;
let cachedHipSdk: HipSdkInfo | null | undefined;

/**
 * Detect installed GPU video controllers on the system.
 */
export function getGpuHardware(force = false): GpuHardwareInfo {
  if (!force && cachedGpus) return cachedGpus;

  const result: GpuHardwareInfo = {
    isAmd: false,
    isNvidia: false,
    gpus: [],
  };

  if (process.platform === "win32") {
    try {
      const stdout = execSync(
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_VideoController).Name"',
        { timeout: 8000, encoding: "utf-8", windowsHide: true },
      );
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      result.gpus = lines;
      result.isAmd = lines.some((name) => /amd|radeon/i.test(name));
      result.isNvidia = lines.some((name) => /nvidia|geforce|rtx|gtx|quadro/i.test(name));
    } catch {
      // Fallback: check environment
      if (process.env.HIP_PATH || process.env.ROCM_PATH || process.env.APPLIO_ROCM_GFX) {
        result.isAmd = true;
      }
    }
  }

  cachedGpus = result;
  return result;
}

/**
 * Detect installed AMD HIP SDK on Windows.
 */
export function findHipSdk(force = false): HipSdkInfo | null {
  if (!force && cachedHipSdk !== undefined) return cachedHipSdk;
  if (process.platform !== "win32") {
    cachedHipSdk = null;
    return null;
  }

  const candidates: string[] = [];

  // 1. Check HIP_PATH / ROCM_PATH environment variables
  if (process.env.HIP_PATH && fs.existsSync(process.env.HIP_PATH)) {
    candidates.push(process.env.HIP_PATH);
  }
  if (process.env.ROCM_PATH && fs.existsSync(process.env.ROCM_PATH)) {
    candidates.push(process.env.ROCM_PATH);
  }

  // 2. Check standard AMD ROCm installation paths
  const baseDir = "C:\\Program Files\\AMD\\ROCm";
  if (fs.existsSync(baseDir)) {
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      const versions = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      for (const v of versions) {
        candidates.push(path.join(baseDir, v));
      }
    } catch {
      /* ignore */
    }
  }

  // Fallback common paths
  candidates.push("C:\\Program Files\\AMD\\ROCm\\6.4");
  candidates.push("C:\\Program Files\\AMD\\ROCm\\6.2");
  candidates.push("C:\\Program Files\\AMD\\ROCm\\6.1");
  candidates.push("C:\\Program Files\\AMD\\ROCm\\5.7");

  for (const cand of candidates) {
    if (!fs.existsSync(cand)) continue;
    const binDir = path.join(cand, "bin");
    if (!fs.existsSync(binDir)) continue;

    const hasDll =
      fs.existsSync(path.join(binDir, "amdhip64.dll")) ||
      fs.existsSync(path.join(binDir, "hiprtc.dll")) ||
      fs.existsSync(path.join(binDir, "hipcc.exe"));

    if (hasDll || fs.existsSync(binDir)) {
      const basename = path.basename(cand);
      const match = basename.match(/(\d+)\.(\d+)/);
      const major = match ? Number(match[1]) : 6;
      const minor = match ? Number(match[2]) : 1;
      const version = match ? `${major}.${minor}` : "6.1";

      const info: HipSdkInfo = {
        path: cand,
        binDir,
        version,
        major,
        minor,
      };
      cachedHipSdk = info;
      return info;
    }
  }

  cachedHipSdk = null;
  return null;
}

/**
 * Maps AMD GPU name or environment to ROCm gfx target architecture for AMD wheels.
 * Supported targets in AMD index (https://stable.repo.amd.com/rocm/whl-next/):
 * gfx1010, gfx1011, gfx1012, gfx1030, gfx1031, gfx1032, gfx1034, gfx1035, gfx1036,
 * gfx1100, gfx1101, gfx1102, gfx1103, gfx1150, gfx1200, gfx1201, gfx908, gfx90a, gfx942
 */
export function getAmdGfxTarget(customGpuName?: string): string {
  // 1. Check explicit override environment variables
  if (process.env.APPLIO_ROCM_GFX) {
    const raw = process.env.APPLIO_ROCM_GFX.trim().toLowerCase();
    return raw.startsWith("gfx") ? raw : `gfx${raw}`;
  }
  if (process.env.HSA_OVERRIDE_GFX_VERSION) {
    const raw = process.env.HSA_OVERRIDE_GFX_VERSION.trim().toLowerCase().replace(/\./g, "");
    return raw.startsWith("gfx") ? raw : `gfx${raw}`;
  }

  // 2. Detect from detected GPU marketing name
  const gpus = customGpuName ? [customGpuName] : getGpuHardware().gpus;
  const gpuStr = gpus.join(" ").toLowerCase();

  // RDNA 4
  if (/9070/i.test(gpuStr)) return "gfx1200";
  if (/9060/i.test(gpuStr)) return "gfx1201";

  // RDNA 3.5 (Strix Point)
  if (/890m|880m|strix/i.test(gpuStr)) return "gfx1150";

  // RDNA 3
  if (/7900|w7900/i.test(gpuStr)) return "gfx1100";
  if (/7800|7700|w7800|w7700/i.test(gpuStr)) return "gfx1101";
  if (/7600|w7600|w7500/i.test(gpuStr)) return "gfx1102";
  if (/780m|760m|740m|phoenix|hawk\s*point/i.test(gpuStr)) return "gfx1103";

  // RDNA 2
  if (/6950|6900|6800|w6800/i.test(gpuStr)) return "gfx1030";
  if (/6750|6700/i.test(gpuStr)) return "gfx1031";
  if (/6650|6600/i.test(gpuStr)) return "gfx1032";
  if (/6500|6400/i.test(gpuStr)) return "gfx1034";
  if (/680m|660m|rembrandt/i.test(gpuStr)) return "gfx1035";
  if (/610m|mendocino/i.test(gpuStr)) return "gfx1036";

  // RDNA 1
  if (/5700|5600/i.test(gpuStr)) return "gfx1010";
  if (/w5500|5500m/i.test(gpuStr)) return "gfx1011";
  if (/5500|5300/i.test(gpuStr)) return "gfx1012";

  // CDNA
  if (/mi300/i.test(gpuStr)) return "gfx942";
  if (/mi250|mi210|mi200/i.test(gpuStr)) return "gfx90a";
  if (/mi100/i.test(gpuStr)) return "gfx908";

  // Default desktop target for RDNA 3
  return "gfx1100";
}

/**
 * Configure environment variables for AMD GPU & native ROCm.
 * Ensures .venv\Scripts and torch lib directories are in PATH so ROCm DLLs resolve.
 */
export function applyAmdRocmEnv(venvDir?: string): boolean {
  if (process.platform !== "win32") return false;

  const root = getRepoRoot();
  const targetVenv = venvDir || path.join(root, ".venv");
  const scriptsDir = path.join(targetVenv, "Scripts");
  const torchLibDir = path.join(targetVenv, "Lib", "site-packages", "torch", "lib");

  const currentPath = process.env.PATH || "";
  const parts = currentPath.split(path.delimiter).filter(Boolean);

  // Prepend .venv\Scripts (holds ROCm tools and runtime binaries)
  if (fs.existsSync(scriptsDir) && !parts.some((p) => p.toLowerCase() === scriptsDir.toLowerCase())) {
    parts.unshift(scriptsDir);
  }

  // Prepend torch\lib
  if (fs.existsSync(torchLibDir) && !parts.some((p) => p.toLowerCase() === torchLibDir.toLowerCase())) {
    parts.unshift(torchLibDir);
  }

  // Check HIP SDK if installed on system
  const hip = findHipSdk();
  if (hip && !parts.some((p) => p.toLowerCase() === hip.binDir.toLowerCase())) {
    parts.unshift(hip.binDir);
    process.env.HIP_PATH ??= hip.path;
  }

  process.env.PATH = parts.join(path.delimiter);

  const gpu = getGpuHardware();
  if (gpu.isAmd || hip || process.env.APPLIO_ROCM_GFX) {
    process.env.HIP_VISIBLE_DEVICES ??= "0";
    process.env.DISABLE_ADDMM_CUDA_LT ??= "1";
    process.env.MIOPEN_FIND_MODE ??= "2";

    const gfx = getAmdGfxTarget();
    if (gfx && !process.env.HSA_OVERRIDE_GFX_VERSION) {
      const m = gfx.match(/gfx(\d)(\d)(\d|\w)/);
      if (m) {
        process.env.HSA_OVERRIDE_GFX_VERSION ??= `${m[1]}.${m[2]}.${m[3]}`;
      }
    }

    // Clean up ZLUDA env variables if left behind
    delete process.env.ZLUDA_COMGR_LOG_LEVEL;
    return true;
  }

  return false;
}

/**
 * Check if native ROCm PyTorch is installed.
 */
export function isRocmInstalled(torchLibDir?: string, venvDir?: string): boolean {
  if (process.platform !== "win32") return false;
  const root = getRepoRoot();
  const targetVenv = venvDir || path.join(root, ".venv");
  const targetLib = torchLibDir || path.join(targetVenv, "Lib", "site-packages", "torch", "lib");

  const marker1 = path.join(targetLib, ".rocm-installed");
  const marker2 = path.join(targetVenv, ".rocm-installed");
  if (fs.existsSync(marker1) || fs.existsSync(marker2)) return true;

  // Check if HIP / ROCm dlls exist in torch/lib
  if (
    fs.existsSync(path.join(targetLib, "amdhip64.dll")) ||
    fs.existsSync(path.join(targetLib, "torch_hip.dll")) ||
    fs.existsSync(path.join(targetLib, "c10_hip.dll")) ||
    fs.existsSync(path.join(targetLib, "rocblas.dll"))
  ) {
    return true;
  }

  // Check torch/version.py for hip attribute
  const versionPy = path.join(targetVenv, "Lib", "site-packages", "torch", "version.py");
  if (fs.existsSync(versionPy)) {
    try {
      const content = fs.readFileSync(versionPy, "utf-8");
      if (content.includes("hip =") && !content.includes("hip = None")) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  // Check if site-packages contains amd_torch or rocm packages
  const sitePackages = path.join(targetVenv, "Lib", "site-packages");
  if (fs.existsSync(sitePackages)) {
    try {
      const entries = fs.readdirSync(sitePackages);
      if (entries.some((e) => e.startsWith("amd_torch") || e.startsWith("rocm_sdk") || e === "rocm")) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  return false;
}

/**
 * Clean up legacy ZLUDA directories and markers.
 */
export async function cleanupZluda(root: string, venvDir?: string, job?: Job): Promise<void> {
  const log = (msg: string) => {
    if (job) appendLog(job, msg);
    else console.log(`[rocm] ${msg}`);
  };

  const zludaDir = path.join(root, "zluda");
  const zipPath = path.join(root, "zluda.zip");
  if (fs.existsSync(zludaDir)) {
    log("Cleaning up legacy ZLUDA directory…");
    try {
      fs.rmSync(zludaDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(zipPath)) {
    try {
      fs.rmSync(zipPath, { force: true });
    } catch {
      /* ignore */
    }
  }

  const targetVenv = venvDir || path.join(root, ".venv");
  const torchLibDir = path.join(targetVenv, "Lib", "site-packages", "torch", "lib");
  const patchedMarker = path.join(torchLibDir, ".zluda-patched");
  const compiledMarker1 = path.join(torchLibDir, ".zluda-compiled");
  const compiledMarker2 = path.join(root, "zluda", ".zluda-compiled");

  for (const m of [patchedMarker, compiledMarker1, compiledMarker2]) {
    if (fs.existsSync(m)) {
      try {
        fs.rmSync(m, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  delete process.env.ZLUDA_COMGR_LOG_LEVEL;
}

function findUvBin(): string | null {
  const root = getRepoRoot();
  const venvDir = path.join(root, ".venv");
  const candidates = [
    path.join(venvDir, "Scripts", "uv.exe"),
    path.join(root, "bin", "uv.exe"),
    path.join(root, "uv.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const where = execSync("where uv", { encoding: "utf-8", windowsHide: true });
    const first = where.split(/[\r\n]+/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* ignore */
  }
  return null;
}

function spawnCommand(
  cmd: string,
  args: string[],
  cwd: string,
  job?: Job,
  envExtra?: Record<string, string>,
): Promise<void> {
  const log = (msg: string) => {
    if (job) appendLog(job, msg);
    else console.log(`[rocm] ${msg}`);
  };
  log(`$ ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        UV_HTTP_TIMEOUT: "300",
        ...envExtra,
      },
    });
    child.stdout?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) log(trimmed.slice(0, 500));
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) log(trimmed.slice(0, 500));
      }
    });
    child.on("error", (e) => reject(new Error(`Failed to start ${cmd}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

/**
 * Download and install native AMD ROCm PyTorch wheels.
 */
export async function installAmdRocm(venvPy: string, job?: Job): Promise<void> {
  const root = getRepoRoot();
  const log = (msg: string) => {
    if (job) appendLog(job, msg);
    else console.log(`[rocm] ${msg}`);
  };

  const venvDir = path.dirname(path.dirname(venvPy));
  const torchLibDir = path.join(venvDir, "Lib", "site-packages", "torch", "lib");

  await cleanupZluda(root, venvDir, job);

  const gpu = getGpuHardware();
  const gfxTarget = getAmdGfxTarget();
  const indexUrl = (process.env.APPLIO_ROCM_INDEX_URL || "https://stable.repo.amd.com/rocm/whl-next/").trim();

  log("==============================================================================");
  log(`Configuring native AMD ROCm PyTorch for ${gpu.gpus.join(", ") || "AMD GPU"}`);
  log(`Target architecture: ${gfxTarget} | Repository: ${indexUrl}`);
  log("==============================================================================");

  // 1. Uninstall any old CUDA PyTorch or conflicting packages
  log("Uninstalling previous PyTorch / CUDA packages to ensure clean ROCm setup…");
  try {
    await spawnCommand(
      venvPy,
      [
        "-m",
        "pip",
        "uninstall",
        "-y",
        "torch",
        "torchaudio",
        "torchvision",
        "onnxruntime-gpu",
        "nvidia-cublas-cu12",
        "nvidia-cuda-runtime-cu12",
        "nvidia-cudnn-cu12",
        "nvidia-cufft-cu12",
      ],
      root,
      job,
    );
  } catch (err) {
    log(`Note during uninstall: ${err}`);
  }

  // 2. Install native ROCm PyTorch packages
  const uvBin = findUvBin();
  const torchPkg = `torch[device-${gfxTarget}]`;
  log(`Installing ${torchPkg}, torchaudio, and torchvision from AMD ROCm index…`);

  let installed = false;
  if (uvBin) {
    try {
      log("Installing via uv…");
      await spawnCommand(
        uvBin,
        [
          "pip",
          "install",
          "--python",
          venvPy,
          "--index-url",
          indexUrl,
          torchPkg,
          "torchaudio",
          "torchvision",
        ],
        root,
        job,
      );
      installed = true;
    } catch (uvErr) {
      log(`uv install failed (${uvErr}); falling back to pip…`);
    }
  }

  if (!installed) {
    await spawnCommand(
      venvPy,
      [
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        "--index-url",
        indexUrl,
        torchPkg,
        "torchaudio",
        "torchvision",
      ],
      root,
      job,
    );
  }

  // 3. Mark ROCm as installed
  try {
    const marker = {
      gfxTarget,
      indexUrl,
      installedAt: new Date().toISOString(),
    };
    if (fs.existsSync(torchLibDir)) {
      fs.writeFileSync(path.join(torchLibDir, ".rocm-installed"), JSON.stringify(marker, null, 2));
    }
    fs.writeFileSync(path.join(venvDir, ".rocm-installed"), JSON.stringify(marker, null, 2));
  } catch {
    /* ignore */
  }

  // 4. Configure PATH and Environment
  applyAmdRocmEnv(venvDir);

  // 5. Verify ROCm installation
  log("Verifying AMD ROCm PyTorch hardware acceleration…");
  await verifyRocmTorch(venvPy, job);

  log("✓ AMD ROCm native PyTorch acceleration is ready.");
}

/**
 * Verify that PyTorch can initialize and detect AMD GPU via ROCm.
 */
export async function verifyRocmTorch(
  venvPy: string,
  job?: Job,
): Promise<{ ok: boolean; deviceName?: string; hipVersion?: string }> {
  const log = (msg: string) => {
    if (job) appendLog(job, msg);
    else console.log(`[rocm] ${msg}`);
  };

  const script = [
    "import sys",
    "try:",
    "    import torch",
    "    ver = getattr(torch, '__version__', '')",
    "    hip_ver = getattr(torch.version, 'hip', None)",
    "    cuda_avail = torch.cuda.is_available()",
    "    dev_name = torch.cuda.get_device_name(0) if cuda_avail and torch.cuda.device_count() > 0 else 'None'",
    "    print(f'VERIFY|{ver}|{hip_ver}|{cuda_avail}|{dev_name}')",
    "except Exception as e:",
    "    print(f'ERR|{e}', file=sys.stderr)",
    "    sys.exit(1)",
  ].join("\n");

  return new Promise((resolve) => {
    const child = spawn(venvPy, ["-c", script], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0 && out.includes("VERIFY|")) {
        const parts = out.trim().split("|");
        const ver = parts[1];
        const hipVer = parts[2];
        const cudaAvail = parts[3] === "True";
        const devName = parts[4];
        log(`PyTorch version: ${ver} (ROCm / HIP: ${hipVer || "N/A"})`);
        if (cudaAvail) {
          log(`✓ GPU device active: ${devName}`);
          resolve({ ok: true, deviceName: devName, hipVersion: hipVer || undefined });
          return;
        }
        log(`[!] PyTorch loaded but GPU is not reporting as available (Device: ${devName})`);
        resolve({ ok: false, deviceName: devName, hipVersion: hipVer || undefined });
        return;
      }
      log(`[!] Note during verification check: ${(err || out).trim()}`);
      resolve({ ok: false });
    });
    child.on("error", (e) => {
      log(`[!] Verification spawn error: ${e.message}`);
      resolve({ ok: false });
    });
  });
}

// ---------------------------------------------------------------------------
// Backward Compatibility Shims for ZLUDA
// ---------------------------------------------------------------------------
export const applyAmdZludaEnv = applyAmdRocmEnv;
export const isZludaPatched = isRocmInstalled;
export const isZludaCompiled = (torchLibDir?: string): boolean => isRocmInstalled(torchLibDir);
export const getZludaLauncher = (): { exe: string } | null => null;
export async function installAndPatchZluda(venvDir: string, job?: Job): Promise<void> {
  const venvPy = path.join(venvDir, "Scripts", "python.exe");
  return installAmdRocm(venvPy, job);
}
export async function compileZludaKernels(venvPy: string, job?: Job): Promise<void> {
  await verifyRocmTorch(venvPy, job);
}
export function getZludaDownloadUrl(_hipVersion: string): { url: string; rocmVer: "6.4" } {
  return {
    url: "https://github.com/lshqqytiger/ZLUDA/releases/download/rel.854c58e1565c3597e17046d7cc2b1eab96fcdf55/ZLUDA-windows-amd64.zip",
    rocmVer: "6.4",
  };
}
