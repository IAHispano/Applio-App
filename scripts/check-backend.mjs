import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend", "applio");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
try {
  for (const file of ["core.py", "rvc/configs/config.py", "requirements-engine.txt"]) {
    if (!fs.existsSync(path.join(backend, file))) throw new Error(`Missing ${file}`);
  }
  const pinned = git("ls-files", "--stage", "backend/applio").match(/^160000 ([a-f0-9]+) /)?.[1];
  const actual = git("-C", backend, "rev-parse", "HEAD");
  if (!pinned || pinned !== actual)
    throw new Error("Backend revision differs from the staged submodule pin.");
  if (git("-C", backend, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error(
      "Backend has uncommitted source changes. Commit them in Applio and update the submodule pin.",
    );
  }
  const files = {};
  for (const file of git(
    "-C",
    backend,
    "ls-files",
    "rvc",
    "core.py",
    "requirements-engine.txt",
    "assets/config_template.json",
  ).split("\n")) {
    if (!file || file.endsWith(".gitkeep") || file.startsWith("rvc/models/")) continue;
    files[file] = createHash("sha256")
      .update(fs.readFileSync(path.join(backend, file)))
      .digest("hex");
  }
  fs.writeFileSync(path.join(root, "backend", "revision.json"), JSON.stringify({ commit: actual, files }));
  console.log(`Applio backend: ${actual}`);
} catch (error) {
  console.error(`${error.message}\nInitialize the backend with: pnpm backend:init`);
  process.exitCode = 1;
}
