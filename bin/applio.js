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

  // Windows: check for py launcher
  if (isWin) {
    try {
      const probe = spawnSync("py", ["-3.12", "-c", "import sys; print(sys.executable)"], {
        encoding: "utf-8",
        windowsHide: true,
      });
      if (probe.status === 0 && probe.stdout.trim()) {
        return { bin: "py", args: ["-3.12"] };
      }
    } catch {
      // py launcher not available
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
