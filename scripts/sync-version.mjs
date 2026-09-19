// Syncs package versions + app config to the release input.
// Usage (from repo root): RELEASE_VERSION=3.7.0 node scripts/sync-version.mjs
// Installer filenames embed the package.json version, so it must match
// the release tag (a leading "v" is stripped if given).
import fs from "node:fs";

const v = (process.env.RELEASE_VERSION || "").replace(/^v/, "");
if (!v) throw new Error("empty version");

for (const f of ["package.json", "app/api/package.json", "app/web/package.json", "app/desktop/package.json"]) {
  const p = JSON.parse(fs.readFileSync(f, "utf8"));
  p.version = v;
  fs.writeFileSync(f, `${JSON.stringify(p, null, 2)}\n`);
}

const c = "assets/config_template.json";
const cfg = JSON.parse(fs.readFileSync(c, "utf8"));
cfg.version = v;
fs.writeFileSync(c, `${JSON.stringify(cfg, null, 2)}\n`);

console.log(`version set to ${v}`);
