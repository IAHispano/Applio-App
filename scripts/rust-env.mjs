import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// rustup may have just been installed while the desktop/terminal process still
// has its old PATH. Support the standard toolchain location without changing
// the user's system environment.
export function rustEnvironment() {
  const bin = path.join(process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"), "bin");
  const cargo = path.join(bin, process.platform === "win32" ? "cargo.exe" : "cargo");
  return { ...process.env, ...(fs.existsSync(cargo) ? { PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` } : {}) };
}
