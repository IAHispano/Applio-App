import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const destination = path.join(desktop, "resources");
// This directory is generated exclusively by this script.
if (path.dirname(destination) !== desktop) throw new Error("Invalid staging destination");
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, ".gitkeep"), "");

const excluded = new Set([".venv", "venv", "__pycache__", ".git"]);
function copy(relative, optional = false, filter = () => true) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) {
    if (optional) return;
    throw new Error(`Required release resource is missing: ${relative}`);
  }
  fs.cpSync(source, path.join(destination, relative), {
    recursive: true,
    dereference: true,
    filter: (source) =>
      !source.split(path.sep).some((part) => excluded.has(part)) &&
      !(path.basename(source) === "env" && fs.existsSync(path.join(source, "pyvenv.cfg"))) &&
      !source.endsWith(".pyc") &&
      filter(path.relative(root, source).replaceAll("\\", "/")),
  });
}
for (const file of [
  "requirements.txt",
  "requirements-uvr.txt",
  "LICENSE",
  "core.py",
  "backend/revision.json",
])
  copy(file);
copy("package.json");
copy("backend/applio/core.py");
copy("backend/applio/requirements-engine.txt");
copy("backend/applio/LICENSE");
copy("backend/applio/assets/config_template.json");
copy("backend/applio/rvc", false, (file) => !file.startsWith("backend/applio/rvc/models/"));
copy("uvr", false, (file) => !/\.(pth|pt|ckpt|onnx)$/.test(file));
copy("tools");
copy("plugins", true);
copy(
  "assets",
  false,
  (file) =>
    !/^assets\/(audios|datasets|curated-datasets|uvr-models)(\/|$)/.test(file) &&
    !/^assets\/(config\.json|demo\.)/.test(file),
);
for (const folder of ["mute", "mute_spin", "mute_spin-v2", "reference"]) copy(`logs/${folder}`, true);
for (const file of ["ffmpeg.exe", "ffprobe.exe", "ffmpeg", "ffprobe"]) copy(file, true);
copy("frontend/web/.next/standalone");

// Bundle an official, self-contained Node distribution, rather than relying on
// an installed Node or a Homebrew executable with external dylib dependencies.
const nodeVersion = "22.22.0";
const platform = process.platform === "win32" ? "win" : process.platform;
const arch = process.arch;
if (!["x64", "arm64"].includes(arch) || !["win", "darwin", "linux"].includes(platform))
  throw new Error("Unsupported Node platform");
const extension = platform === "win" ? "zip" : "tar.gz";
const name = `node-v${nodeVersion}-${platform}-${arch}`;
const filename = `${name}.${extension}`;
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
const cache = path.join(desktop, ".cache", "node", nodeVersion);
fs.mkdirSync(cache, { recursive: true });
const sums = await (await fetch(`${base}SHASUMS256.txt`)).text();
const expected = sums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts[1] === filename)?.[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected))
  throw new Error(`Missing official Node checksum: ${filename}`);
const archive = path.join(cache, filename);
const valid = () =>
  fs.existsSync(archive) && createHash("sha256").update(fs.readFileSync(archive)).digest("hex") === expected;
if (!valid()) {
  const response = await fetch(`${base}${filename}`);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
}
if (!valid()) throw new Error("Node runtime checksum mismatch");
execFileSync("tar", ["-xf", archive, "-C", cache], { stdio: "inherit", windowsHide: true });
const node = platform === "win" ? "node.exe" : "node";
fs.copyFileSync(
  path.join(cache, name, platform === "win" ? node : `bin/${node}`),
  path.join(destination, node),
);
if (platform !== "win") fs.chmodSync(path.join(destination, node), 0o755);
console.log(`Tauri resources staged at ${destination}`);
