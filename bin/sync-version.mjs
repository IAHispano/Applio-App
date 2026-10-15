// Syncs package versions + app config to the release input.
// Usage (from repo root): RELEASE_VERSION=3.7.0 node bin/sync-version.mjs
// Installer filenames embed the package.json version, so it must match
// the release tag (a leading "v" is stripped if given).
import fs from "node:fs";

import { releaseVersion } from "./release-version.mjs";

const v = releaseVersion(process.env.RELEASE_VERSION);
if (process.env.RELEASE_PRERELEASE === "false" && v.includes("-"))
  throw new Error("Enable the prerelease option when releasing a prerelease version");

for (const f of ["package.json", "frontend/web/package.json", "frontend/desktop/package.json"]) {
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.version = v;
  fs.writeFileSync(f, `${JSON.stringify(p, null, 2)}\n`);
}

const c = "assets/config_template.json";
const cfg = JSON.parse(fs.readFileSync(c, "utf8"));
cfg.version = v;
fs.writeFileSync(c, `${JSON.stringify(cfg, null, 2)}\n`);

const tauri = "frontend/desktop/src-tauri/tauri.conf.json";
const native = JSON.parse(fs.readFileSync(tauri, "utf8"));
native.version = v;
fs.writeFileSync(tauri, `${JSON.stringify(native, null, 2)}\n`);
const cargo = "Cargo.toml";
fs.writeFileSync(
  cargo,
  fs.readFileSync(cargo, "utf8").replace(/(\[workspace\.package\]\s*\nversion = ")[^"]+"/, `$1${v}"`),
);
// Workspace crates inherit this version; update only their lockfile entries.
const lock = "Cargo.lock";
fs.writeFileSync(
  lock,
  fs
    .readFileSync(lock, "utf8")
    .replace(/(name = "applio-(?:api|desktop)"\r?\nversion = ")[^"]+"/g, `$1${v}"`),
);

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${v}\ntag=v${v}\n`);
console.log(`version set to ${v}`);
