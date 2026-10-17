// Development launcher; production serves the exported UI directly from Rust.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rustEnvironment } from "./rust-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
const config =
  process.env.APPLIO_CONFIG_DIR ||
  (process.platform === "win32"
    ? path.join(process.env.APPDATA, "Applio")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support/Applio")
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Applio"));
const env = {
  ...rustEnvironment(),
  APPLIO_CODE_ROOT: root,
  APPLIO_ROOT: process.env.APPLIO_ROOT || root,
  APPLIO_CONFIG_DIR: config,
  API_PORT: process.env.API_PORT || "8000",
  NODE_ENV: production ? "production" : "development",
  APPLIO_SERVE_WEB: production && !process.argv.includes("--no-web") ? "1" : "0",
  WEB_PORT: process.env.WEB_PORT || "3000",
};
const executable = path.join(
  root,
  "target",
  production ? "release" : "debug",
  process.platform === "win32" ? "applio-api.exe" : "applio-api",
);
if (!production) {
  const build = spawn("cargo", ["build", "-p", "applio-api"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const status = await new Promise((resolve, reject) => {
    build.once("exit", resolve);
    build.once("error", reject);
  });
  if (status !== 0) process.exit(status ?? 1);
}
const api = spawn(executable, ["--shutdown-on-stdin-eof"], {
  cwd: root,
  env,
  stdio: ["pipe", "inherit", "inherit"],
  windowsHide: true,
});
const children = [api];
if (!production && !process.argv.includes("--no-web")) {
  const web = path.join(root, "frontend/web");
  const entry = createRequire(path.join(web, "package.json")).resolve("next/dist/bin/next");
  children.push(
    spawn(process.execPath, [entry, "dev", "-p", env.WEB_PORT, "-H", "127.0.0.1"], {
      cwd: web,
      windowsHide: true,
      stdio: "inherit",
      env: {
        ...env,
        PORT: process.env.WEB_PORT || "3000",
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${env.API_PORT}`,
      },
    }),
  );
}
let stopping = false;
async function terminate(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32")
    await new Promise((resolve) => {
      const kill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      kill.once("exit", resolve);
      kill.once("error", resolve);
    });
  else child.kill("SIGTERM");
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const closed = Promise.all(
    children.map((child) =>
      child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("close", resolve)),
    ),
  );
  api.stdin.end();
  await Promise.all(children.slice(1).map(terminate));
  const timer = setTimeout(() => {
    void Promise.all(children.map(terminate));
  }, 25000);
  await closed;
  clearTimeout(timer);
  process.exit(code);
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    void stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
