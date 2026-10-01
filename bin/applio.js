#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function findPython() {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return { bin: process.env.PYTHON_BIN, args: [] };
  }

  const isWin = process.platform === "win32";
  const venvs = [".venv", "venv", "env"];

  for (const venv of venvs) {
    const cand = isWin
      ? path.join(repoRoot, venv, "Scripts", "python.exe")
      : path.join(repoRoot, venv, "bin", "python");
    if (fs.existsSync(cand)) {
      return { bin: cand, args: [] };
    }
  }

  // Windows: check standard paths and py launcher
  if (isWin) {
    const stdPaths = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312-64", "python.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Python312", "python.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Python312", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311-64", "python.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Python311", "python.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Python311", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Launcher", "py.exe"),
    ];
    for (const sp of stdPaths) {
      if (fs.existsSync(sp)) {
        if (sp.toLowerCase().endsWith("py.exe")) {
          return { bin: sp, args: ["-3.12"] };
        }
        return { bin: sp, args: [] };
      }
    }
    for (const ver of ["-3.12", "-3.11"]) {
      try {
        const probe = spawnSync("py", [ver, "-c", "import sys; print(sys.executable)"], {
          encoding: "utf-8",
          windowsHide: true,
        });
        if (probe.status === 0 && probe.stdout.trim()) {
          return { bin: "py", args: [ver] };
        }
      } catch {
        // py launcher not available
      }
    }
  }

  return { bin: isWin ? "python" : "python3", args: [] };
}

const args = process.argv.slice(2);
const firstArg = (args[0] || "").toLowerCase();

if (firstArg === "web" || firstArg === "server" || firstArg === "serve") {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpmCmd, ["dev"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
} else if (firstArg === "desktop") {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpmCmd, ["desktop:dev"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
} else if (firstArg === "clean" || firstArg === "purge" || firstArg === "uninstall") {
  const os = require("node:os");
  console.log("Cleaning Applio traces, caches, and temporary files...\n");
  let removedCount = 0;

  const targets = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    const localAppData = process.env.LOCALAPPDATA || "";
    if (appData) {
      targets.push(path.join(appData, "Applio"));
      targets.push(path.join(appData, "applio"));
      targets.push(path.join(appData, "@applio"));
      targets.push(path.join(appData, "AI Hispano", "Applio"));
    }
    if (localAppData) {
      targets.push(path.join(localAppData, "Applio"));
      targets.push(path.join(localAppData, "applio"));
      targets.push(path.join(localAppData, "applio-updater"));
      targets.push(path.join(localAppData, "Applio-updater"));
    }
  } else if (process.platform === "darwin") {
    const home = os.homedir();
    targets.push(path.join(home, "Library", "Application Support", "Applio"));
    targets.push(path.join(home, "Library", "Caches", "Applio"));
    targets.push(path.join(home, "Library", "Logs", "Applio"));
  } else {
    const home = os.homedir();
    targets.push(path.join(home, ".config", "Applio"));
    targets.push(path.join(home, ".cache", "Applio"));
  }

  const home = os.homedir();
  targets.push(path.join(home, ".applio"));
  targets.push(path.join(home, ".cache", "applio"));

  try {
    const tmpDir = os.tmpdir();
    for (const f of fs.readdirSync(tmpDir)) {
      if (/^applio/i.test(f) || f === "VC_redist.x64.exe" || f === "python-3.12.9-installer.exe") {
        targets.push(path.join(tmpDir, f));
      }
    }
  } catch {
    /* ignore unreadable tmp */
  }

  if (process.platform === "win32") {
    try {
      const psCmd = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*Applio*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCmd], { windowsHide: true });
    } catch {
      /* ignore */
    }
  }

  for (const target of targets) {
    if (fs.existsSync(target)) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`  ✓ Removed: ${target}`);
        removedCount++;
      } catch (err) {
        console.warn(`  ! Could not remove ${target}: ${err.message}`);
      }
    }
  }

  if (removedCount === 0) {
    console.log("No lingering Applio traces found. System is clean!");
  } else {
    console.log(`\nSuccessfully cleaned ${removedCount} Applio trace path(s).`);
  }
  process.exit(0);
} else {
  const py = findPython();
  const corePy = path.join(repoRoot, "core.py");
  const spawnArgs = [...py.args, corePy, ...args];

  const child = spawn(py.bin, spawnArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
