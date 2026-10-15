import { spawn } from "node:child_process";
import { rustEnvironment } from "./rust-env.mjs";
const child = spawn("cargo", process.argv.slice(2), { stdio: "inherit", env: rustEnvironment(), windowsHide: true });
child.on("error", error => { console.error(`Rust toolchain unavailable: ${error.message}`); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
