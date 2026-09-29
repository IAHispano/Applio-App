import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "@/jobs";
import { appendLog } from "@/jobs";

function getRepoRoot(): string {
  if (process.env.APPLIO_ROOT && fs.existsSync(process.env.APPLIO_ROOT)) {
    return path.resolve(process.env.APPLIO_ROOT);
  }
  return path.resolve(__dirname, "..", "..", "..");
}

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
      if (process.env.HIP_PATH) {
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
      // Sort versions descending (e.g. 6.4, 6.2, 6.1, 5.7)
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

    // Check for HIP dlls (e.g. amdhip64.dll or hiprtc.dll)
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
 * Configure environment variables for AMD GPU & ZLUDA.
 */
export function applyAmdZludaEnv(): boolean {
  if (process.platform !== "win32") return false;

  const hip = findHipSdk();
  if (hip) {
    const currentPath = process.env.PATH || "";
    const parts = currentPath.split(path.delimiter).filter(Boolean);
    if (!parts.some((p) => p.toLowerCase() === hip.binDir.toLowerCase())) {
      process.env.PATH = `${hip.binDir}${path.delimiter}${currentPath}`;
    }
    process.env.HIP_PATH ??= hip.path;
  }

  const gpu = getGpuHardware();
  if (gpu.isAmd || hip) {
    process.env.HIP_VISIBLE_DEVICES ??= "0";
    process.env.ZLUDA_COMGR_LOG_LEVEL ??= "1";
    process.env.DISABLE_ADDMM_CUDA_LT ??= "1";
    return true;
  }

  return false;
}

/**
 * Get the appropriate ZLUDA download URL based on HIP SDK version.
 */
export function getZludaDownloadUrl(hipVersion: string): {
  url: string;
  rocmVer: "5.7" | "6.1" | "6.2" | "6.4";
} {
  const parts = hipVersion.split(".").map(Number);
  const major = parts[0] || 6;
  const minor = parts[1] || 0;

  if (major > 6 || (major === 6 && minor >= 4)) {
    return {
      url: "https://github.com/lshqqytiger/ZLUDA/releases/download/rel.854c58e1565c3597e17046d7cc2b1eab96fcdf55/ZLUDA-windows-amd64.zip",
      rocmVer: "6.4",
    };
  }
  if (major === 6 && (minor === 2 || minor === 3)) {
    return {
      url: "https://github.com/lshqqytiger/ZLUDA/releases/download/rel.5e717459179dc272b7d7d23391f0fad66c7459cf/ZLUDA-windows-rocm6-amd64.zip",
      rocmVer: "6.2",
    };
  }
  if (major === 6) {
    return {
      url: "https://github.com/lshqqytiger/ZLUDA/releases/download/rel.c0804ca624963aab420cb418412b1c7fbae3454b/ZLUDA-windows-rocm6-amd64.zip",
      rocmVer: "6.1",
    };
  }
  return {
    url: "https://github.com/lshqqytiger/ZLUDA/releases/download/rel.c0804ca624963aab420cb418412b1c7fbae3454b/ZLUDA-windows-rocm5-amd64.zip",
    rocmVer: "5.7",
  };
}

/**
 * Check if ZLUDA is installed and PyTorch is patched.
 */
export function isZludaPatched(torchLibDir: string): boolean {
  if (process.platform !== "win32") return false;
  const root = getRepoRoot();
  const zludaExe = path.join(root, "zluda", "zluda.exe");
  if (!fs.existsSync(zludaExe)) return false;

  const marker = path.join(torchLibDir, ".zluda-patched");
  if (fs.existsSync(marker)) return true;

  // Check if cublas64_11 exists in torchLibDir
  const cublas = path.join(torchLibDir, "cublas64_11.dll");
  return fs.existsSync(cublas);
}

/**
 * Return ZLUDA launcher if present and active for AMD GPU.
 */
export function getZludaLauncher(): { exe: string } | null {
  if (process.platform !== "win32") return null;
  const root = getRepoRoot();
  const zludaExe = path.join(root, "zluda", "zluda.exe");
  if (!fs.existsSync(zludaExe)) return null;

  const gpu = getGpuHardware();
  const hip = findHipSdk();
  if (!gpu.isAmd && !hip) return null;

  return { exe: zludaExe };
}

/**
 * Download, extract, and patch PyTorch with ZLUDA for AMD GPU support.
 */
export async function installAndPatchZluda(venvDir: string, job?: Job): Promise<void> {
  const root = getRepoRoot();
  const log = (msg: string) => {
    if (job) appendLog(job, msg);
    else console.log(`[zluda] ${msg}`);
  };

  const hip = findHipSdk();
  const hipVer = hip ? hip.version : "6.1";
  const { url, rocmVer } = getZludaDownloadUrl(hipVer);

  log(`Configuring ZLUDA for AMD GPU (ROCm ${rocmVer}, HIP SDK ${hipVer})…`);

  const zludaDir = path.join(root, "zluda");
  const zipPath = path.join(root, "zluda.zip");

  // Clean prior zluda dir
  if (fs.existsSync(zludaDir)) {
    try {
      fs.rmSync(zludaDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  log(`Downloading ZLUDA from ${url}…`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ZLUDA: HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuf = await response.arrayBuffer();
  fs.writeFileSync(zipPath, Buffer.from(arrayBuf));

  log("Extracting ZLUDA…");
  fs.mkdirSync(zludaDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["-xf", zipPath], {
      cwd: root,
      windowsHide: true,
    });
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to extract ZLUDA archive (code ${code})`));
    });
  });

  try {
    fs.rmSync(zipPath, { force: true });
  } catch {
    /* ignore */
  }

  if (!fs.existsSync(path.join(zludaDir, "zluda.exe"))) {
    throw new Error("Extraction succeeded but zluda.exe was not found in zluda directory.");
  }

  // Patch torch library in the target venv
  const torchLibDir = path.join(venvDir, "Lib", "site-packages", "torch", "lib");
  if (!fs.existsSync(torchLibDir)) {
    log(`[!] Note: PyTorch library directory not found at ${torchLibDir}; skipping DLL replacement.`);
    return;
  }

  log(`Patching PyTorch DLLs in ${torchLibDir}…`);

  const copyDll = (srcName: string, dstName: string) => {
    const src = path.join(zludaDir, srcName);
    const dst = path.join(torchLibDir, dstName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  };

  // Base ZLUDA replacement DLLs
  copyDll("cublas.dll", "cublas64_11.dll");
  copyDll("cusparse.dll", "cusparse64_11.dll");
  copyDll("nvrtc.dll", "nvrtc64_112_0.dll");

  // ROCm 6.2+ and 6.4+ additional requirements
  if (rocmVer === "6.2" || rocmVer === "6.4") {
    const origNvrtc = path.join(torchLibDir, "nvrtc64_112_0.dll");
    const cudaNvrtc = path.join(torchLibDir, "nvrtc_cuda.dll");
    if (fs.existsSync(origNvrtc) && !fs.existsSync(cudaNvrtc)) {
      try {
        fs.copyFileSync(origNvrtc, cudaNvrtc);
      } catch {
        /* ignore */
      }
    }
    copyDll("cufft.dll", "cufft64_10.dll");
    copyDll("cufftw.dll", "cufftw64_10.dll");
  }

  // Write patch marker
  try {
    fs.writeFileSync(
      path.join(torchLibDir, ".zluda-patched"),
      JSON.stringify(
        { hipVersion: hipVer, rocmVersion: rocmVer, patchedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }

  applyAmdZludaEnv();

  log("✓ ZLUDA installed and PyTorch patched successfully for AMD GPU acceleration.");
  log(
    "NOTE: The first time voice conversion or model training runs, ZLUDA will compile GPU kernels (takes 15–20 minutes). The app may appear busy during this period.",
  );
}
