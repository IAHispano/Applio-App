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
  pnpIds: string[];
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
    pnpIds: [],
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
      try {
        const pnpOut = execSync(
          'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_VideoController).PNPDeviceID"',
          { timeout: 8000, encoding: "utf-8", windowsHide: true },
        );
        result.pnpIds = pnpOut
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
      } catch {
        /* PNPDeviceID unavailable: name matching still applies */
      }
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

export interface MsvcToolchainInfo {
  vsPath: string;
  binDir: string;
  includeDirs: string[];
}

let cachedMsvcToolchain: MsvcToolchainInfo | null | undefined;

/**
 * Detect installed Microsoft Visual C++ Build Tools (MSVC) on Windows.
 * Required by MIOpen / hiprtc for runtime kernel JIT compilation (e.g. batch_norm) on AMD GPUs.
 */
export function findMsvcToolchain(force = false): MsvcToolchainInfo | null {
  if (!force && cachedMsvcToolchain !== undefined) return cachedMsvcToolchain;
  if (process.platform !== "win32") {
    cachedMsvcToolchain = null;
    return null;
  }

  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!fs.existsSync(vswhere)) {
    cachedMsvcToolchain = null;
    return null;
  }

  try {
    const vsPath = execSync(
      `"${vswhere}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`,
      { encoding: "utf-8", windowsHide: true, timeout: 5000 },
    ).trim();

    if (!vsPath || !fs.existsSync(vsPath)) {
      cachedMsvcToolchain = null;
      return null;
    }

    const msvcBase = path.join(vsPath, "VC", "Tools", "MSVC");
    if (!fs.existsSync(msvcBase)) {
      cachedMsvcToolchain = null;
      return null;
    }

    const versions = fs
      .readdirSync(msvcBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    if (versions.length === 0) {
      cachedMsvcToolchain = null;
      return null;
    }

    const latestVer = versions[0];
    const binDir = path.join(msvcBase, latestVer, "bin", "Hostx64", "x64");
    const msvcInc = path.join(msvcBase, latestVer, "include");

    const includeDirs: string[] = [];
    if (fs.existsSync(msvcInc)) includeDirs.push(msvcInc);

    const sdkIncBase = path.join(pf86, "Windows Kits", "10", "Include");
    if (fs.existsSync(sdkIncBase)) {
      try {
        const sdkVersions = fs
          .readdirSync(sdkIncBase, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        if (sdkVersions.length > 0) {
          const latestSdk = sdkVersions[0];
          for (const sub of ["ucrt", "shared", "um"]) {
            const p = path.join(sdkIncBase, latestSdk, sub);
            if (fs.existsSync(p)) includeDirs.push(p);
          }
        }
      } catch {
        /* ignore */
      }
    }

    const info: MsvcToolchainInfo = {
      vsPath,
      binDir,
      includeDirs,
    };
    cachedMsvcToolchain = info;
    return info;
  } catch {
    cachedMsvcToolchain = null;
    return null;
  }
}

export interface AmdGpuArch {
  name: string;
  gfx: string;
  devicePackage: string;
  architecture: string;
  hsaVersion: string;
}

/**
 * Known AMD GPU architectures supported by ROCm wheels (e.g. from https://stable.repo.amd.com/rocm/whl-next/).
 */
export const AMD_GPU_ARCH_LIST: readonly AmdGpuArch[] = [
  {
    name: "AMD Radeon RX 9070 / XT",
    gfx: "gfx1201",
    devicePackage: "device-gfx1201",
    architecture: "RDNA 4 (Navi 48)",
    hsaVersion: "12.0.1",
  },
  {
    name: "AMD Radeon RX 9060 / XT",
    gfx: "gfx1200",
    devicePackage: "device-gfx1200",
    architecture: "RDNA 4 (Navi 44)",
    hsaVersion: "12.0.0",
  },
  {
    name: "AMD Radeon 820M iGPU",
    gfx: "gfx1153",
    devicePackage: "device-gfx1153",
    architecture: "RDNA 3.5 (Krackan Point 2 / Radeon 820M)",
    hsaVersion: "11.5.3",
  },
  {
    name: "AMD Ryzen AI 7 350",
    gfx: "gfx1152",
    devicePackage: "device-gfx1152",
    architecture: "RDNA 3.5 (Krackan Point)",
    hsaVersion: "11.5.2",
  },
  {
    name: "AMD Ryzen AI Max+ PRO 395",
    gfx: "gfx1151",
    devicePackage: "device-gfx1151",
    architecture: "RDNA 3.5 (Strix Halo)",
    hsaVersion: "11.5.1",
  },
  {
    name: "AMD Ryzen AI 9 HX 375",
    gfx: "gfx1150",
    devicePackage: "device-gfx1150",
    architecture: "RDNA 3.5 (Strix Point)",
    hsaVersion: "11.5.0",
  },
  {
    name: "AMD Ryzen 7 7840U",
    gfx: "gfx1103",
    devicePackage: "device-gfx1103",
    architecture: "RDNA 3 (Phoenix / Hawk Point)",
    hsaVersion: "11.0.3",
  },
  {
    name: "AMD Radeon RX 7600",
    gfx: "gfx1102",
    devicePackage: "device-gfx1102",
    architecture: "RDNA 3 (Navi 33)",
    hsaVersion: "11.0.2",
  },
  {
    name: "AMD Radeon RX 7800/7700 XT",
    gfx: "gfx1101",
    devicePackage: "device-gfx1101",
    architecture: "RDNA 3 (Navi 32)",
    hsaVersion: "11.0.1",
  },
  {
    name: "AMD Radeon RX 7900 XTX/XT",
    gfx: "gfx1100",
    devicePackage: "device-gfx1100",
    architecture: "RDNA 3 (Navi 31)",
    hsaVersion: "11.0.0",
  },
  {
    name: "AMD Radeon RX 6900/6800 XT",
    gfx: "gfx1030",
    devicePackage: "device-gfx1030",
    architecture: "RDNA 2 (Navi 21)",
    hsaVersion: "10.3.0",
  },
  {
    name: "AMD Radeon RX 6750/6700 XT",
    gfx: "gfx1031",
    devicePackage: "device-gfx1031",
    architecture: "RDNA 2 (Navi 22)",
    hsaVersion: "10.3.1",
  },
  {
    name: "AMD Radeon RX 6600 XT",
    gfx: "gfx1032",
    devicePackage: "device-gfx1032",
    architecture: "RDNA 2 (Navi 23)",
    hsaVersion: "10.3.2",
  },
  {
    name: "AMD Radeon RX 6500 XT",
    gfx: "gfx1034",
    devicePackage: "device-gfx1034",
    architecture: "RDNA 2 (Navi 24)",
    hsaVersion: "10.3.4",
  },
  {
    name: "AMD Radeon 680M iGPU",
    gfx: "gfx1035",
    devicePackage: "device-gfx1035",
    architecture: "RDNA 2 (Rembrandt)",
    hsaVersion: "10.3.5",
  },
  {
    name: "AMD Raphael iGPU",
    gfx: "gfx1036",
    devicePackage: "device-gfx1036",
    architecture: "RDNA 2 (Raphael / Mendocino)",
    hsaVersion: "10.3.6",
  },
  {
    name: "AMD Radeon RX 5700 / XT",
    gfx: "gfx1010",
    devicePackage: "device-gfx1010",
    architecture: "RDNA 1 (Navi 10)",
    hsaVersion: "10.1.0",
  },
];

/**
 * Maps AMD GPU name or environment to ROCm gfx target architecture for AMD wheels.
 * Supported targets in AMD index:
 * gfx1010, gfx1011, gfx1012, gfx1030, gfx1031, gfx1032, gfx1034, gfx1035, gfx1036,
 * gfx1100, gfx1101, gfx1102, gfx1103, gfx1150, gfx1151, gfx1152, gfx1153, gfx1200, gfx1201,
 * gfx908, gfx90a, gfx942
 */
export function getAmdGfxTarget(customGpuName?: string): string {
  // 1. Check explicit override environment variables
  if (process.env.APPLIO_ROCM_GFX) {
    const raw = process.env.APPLIO_ROCM_GFX.trim()
      .toLowerCase()
      .replace(/^device-/, "");
    return raw.startsWith("gfx") ? raw : `gfx${raw}`;
  }
  if (process.env.HSA_OVERRIDE_GFX_VERSION) {
    const raw = process.env.HSA_OVERRIDE_GFX_VERSION.trim()
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/^device-/, "");
    return raw.startsWith("gfx") ? raw : `gfx${raw}`;
  }

  // 2. Detect from detected GPU marketing name
  const hw = getGpuHardware();
  const gpus = customGpuName ? [customGpuName] : hw.gpus;
  const gpuStr = gpus.join(" ").toLowerCase();

  // 2a. Direct gfx or device-gfx string match
  const directMatch = gpuStr.match(/\b(?:device-)?(gfx\d{3,4}[a-z]?)\b/i);
  if (directMatch) {
    return directMatch[1].toLowerCase();
  }

  // RDNA 4
  if (/9070|r9700|r9600/i.test(gpuStr)) return "gfx1201";
  if (/9060|9050/i.test(gpuStr)) return "gfx1200";

  // RDNA 3.5 (Halo first: it also matches /strix/)
  if (/8065s|8060s|8050s|8040s|strix\s*halo|ai\s*max/i.test(gpuStr)) return "gfx1151";
  if (/890m|880m/i.test(gpuStr)) return "gfx1150";
  if (/860m|840m/i.test(gpuStr)) return "gfx1152";
  if (/820m/i.test(gpuStr)) return "gfx1153";
  if (/strix/i.test(gpuStr)) return "gfx1150";
  if (/krackan/i.test(gpuStr)) return "gfx1152";

  // Ryzen AI CPU names: every SKU in each AI family shares its gfx target
  // (AI 9 -> 1150, AI 7 -> 1152, AI 5 -> 1152 except 330 -> 1153), so matching
  // by family is exact. The Ryzen/AI context is required: bare numbers like
  // 350 also match unrelated cards such as Radeon RX 350.
  if (/ryzen\s+ai\s+9\b/i.test(gpuStr)) return "gfx1150";
  if (/ryzen\s+ai\s+7\b/i.test(gpuStr)) return "gfx1152";
  if (/ryzen\s+ai\s+5\s+330/i.test(gpuStr)) return "gfx1153";
  if (/ryzen\s+ai\s+5\b/i.test(gpuStr)) return "gfx1152";
  if (/ryzen\s+7\s+7840/i.test(gpuStr)) return "gfx1103";

  // RDNA 3
  if (/7900|w7900|w7800/i.test(gpuStr)) return "gfx1100";
  if (/7700s|7600s|7600m/i.test(gpuStr)) return "gfx1102";
  if (/7800|7700|w7700|v710/i.test(gpuStr)) return "gfx1101";
  if (/7600|7650|w7600|w7500/i.test(gpuStr)) return "gfx1102";
  if (/780m|760m|740m|phoenix|hawk\s*point/i.test(gpuStr)) return "gfx1103";

  // RDNA 2
  if (/6800m/i.test(gpuStr)) return "gfx1031";
  if (/6800s|6700s/i.test(gpuStr)) return "gfx1032";
  if (/6950|6900|6800|w6800/i.test(gpuStr)) return "gfx1030";
  if (/6750|6700|6850/i.test(gpuStr)) return "gfx1031";
  if (/6650|6600/i.test(gpuStr)) return "gfx1032";
  if (/6500|6400/i.test(gpuStr)) return "gfx1034";
  if (/6550|6450|6300/i.test(gpuStr)) return "gfx1034";
  if (/680m|660m|rembrandt/i.test(gpuStr)) return "gfx1035";
  if (/610m|mendocino|raphael|granite\s*ridge/i.test(gpuStr)) return "gfx1036";

  // RDNA 1
  if (/pro\s*5600m/i.test(gpuStr)) return "gfx1011";
  if (/5700|5600/i.test(gpuStr)) return "gfx1010";
  if (/5500|5300/i.test(gpuStr)) return "gfx1012";

  // CDNA
  if (/mi300|mi325/i.test(gpuStr)) return "gfx942";
  if (/mi250|mi210|mi200/i.test(gpuStr)) return "gfx90a";
  if (/mi100/i.test(gpuStr)) return "gfx908";

  // 3. Fallback: generic names ("AMD Radeon Graphics") carry no model token.
  // PCI device IDs are unambiguous: Strix 150E, Krackan 1114, Phoenix 15BF,
  // Hawk 1900, Rembrandt 1681, Mendocino 1506, Raphael 164E, Granite Ridge 13C0.
  if (!customGpuName) {
    const pciGfx: Record<string, string> = {
      "150e": "gfx1150",
      "1114": "gfx1152",
      "15bf": "gfx1103",
      "1900": "gfx1103",
      "1681": "gfx1035",
      "1506": "gfx1036",
      "164e": "gfx1036",
      "13c0": "gfx1036",
    };
    for (const id of hw.pnpIds) {
      const dev = /DEV_([0-9A-Fa-f]{4})/.exec(id)?.[1]?.toLowerCase();
      if (dev && pciGfx[dev]) return pciGfx[dev];
    }
  }

  // Default desktop target for RDNA 3
  return "gfx1100";
}

/**
 * Retrieve GPU architecture details for a detected or specified AMD GPU.
 */
export function getAmdGpuArchInfo(customGpuName?: string): AmdGpuArch | undefined {
  const gfx = getAmdGfxTarget(customGpuName);
  return AMD_GPU_ARCH_LIST.find((item) => item.gfx === gfx);
}

/**
 * gfx target (e.g. gfx1100) -> HSA version triplet (11.0.0). Returns null
 * when unknown (e.g. gfx90a): never set a malformed override.
 */
export function gfxToHsaVersion(gfx: string): string | null {
  const full = gfx.match(/^gfx(\d{2})(\d)(\d)$/);
  if (full) return `${full[1]}.${full[2]}.${full[3]}`;
  const short = gfx.match(/^gfx(\d)(\d)(\d)$/);
  if (short) return `${short[1]}.${short[2]}.${short[3]}`;
  return null;
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

  // Check MSVC toolchain if installed on system (for MIOpen / hiprtc runtime JIT compilation)
  const msvc = findMsvcToolchain();
  if (msvc) {
    if (fs.existsSync(msvc.binDir) && !parts.some((p) => p.toLowerCase() === msvc.binDir.toLowerCase())) {
      parts.push(msvc.binDir);
    }
    if (msvc.includeDirs.length > 0) {
      const currentInc = process.env.INCLUDE || "";
      const incParts = currentInc.split(path.delimiter).filter(Boolean);
      for (const inc of msvc.includeDirs) {
        if (!incParts.some((p) => p.toLowerCase() === inc.toLowerCase())) {
          incParts.push(inc);
        }
      }
      process.env.INCLUDE = incParts.join(path.delimiter);
    }
  }

  process.env.PATH = parts.join(path.delimiter);

  const gpu = getGpuHardware();
  if (gpu.isAmd || hip || process.env.APPLIO_ROCM_GFX) {
    process.env.HIP_VISIBLE_DEVICES ??= "0";
    process.env.DISABLE_ADDMM_CUDA_LT ??= "1";
    process.env.MIOPEN_FIND_MODE ??= "2";
    process.env.MIOPEN_DEBUG_DISABLE_FIND_DB ??= "1";
    process.env.MIOPEN_LOG_LEVEL ??= "0";
    process.env.MIOPEN_ENABLE_LOGGING ??= "0";
    process.env.AMD_COMGR_CACHE ??= "0";
    process.env.TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL ??= "0";

    const gfx = getAmdGfxTarget();
    if (gfx && !process.env.HSA_OVERRIDE_GFX_VERSION) {
      const ver = gfxToHsaVersion(gfx);
      if (ver) process.env.HSA_OVERRIDE_GFX_VERSION = ver;
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
  const torchvisionPkg = `torchvision[device-${gfxTarget}]`;
  log(`Installing ${torchPkg}, ${torchvisionPkg}, and torchaudio from AMD ROCm index…`);

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
          torchvisionPkg,
          "torchaudio",
        ],
        root,
        job,
      );
      installed = true;
    } catch (uvErr) {
      log(`uv install with ${torchvisionPkg} failed (${uvErr}); trying without torchvision device tag…`);
      try {
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
            "torchvision",
            "torchaudio",
          ],
          root,
          job,
        );
        installed = true;
      } catch (uvFallbackErr) {
        log(`uv fallback failed (${uvFallbackErr}); falling back to pip…`);
      }
    }
  }

  if (!installed) {
    try {
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
          torchvisionPkg,
          "torchaudio",
        ],
        root,
        job,
      );
    } catch (pipErr) {
      log(
        `pip install with ${torchvisionPkg} failed (${pipErr}); trying fallback without torchvision device tag…`,
      );
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
          "torchvision",
          "torchaudio",
        ],
        root,
        job,
      );
    }
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
