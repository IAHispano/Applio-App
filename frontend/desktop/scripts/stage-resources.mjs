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
copy("backend/python", false);
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
copy("frontend/web/out");
console.log(`Node-free Tauri resources staged at ${destination}`);
