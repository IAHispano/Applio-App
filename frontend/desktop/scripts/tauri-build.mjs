import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { rustEnvironment } from "../../../scripts/rust-env.mjs";

Object.assign(process.env, rustEnvironment());

const require = createRequire(import.meta.url);
const cli = require("@tauri-apps/cli/main");
const args = ["build", ...process.argv.slice(2)];
// Local keys stay outside the repository; CI must provide its signing secret.
const localKey =
  process.env.APPLIO_SIGNING_KEY_FILE || path.join(os.homedir(), ".applio-signing/updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.CI && fs.existsSync(localKey)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(localKey, "utf8");
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}
const config = JSON.parse(fs.readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
if (
  process.env.APPLIO_UPDATER_PUBLIC_KEY &&
  process.env.APPLIO_UPDATER_PUBLIC_KEY !== config.plugins.updater.pubkey
) {
  throw new Error("The CI public key differs from the committed updater identity.");
}
if (process.env.CI && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error("Release signing requires TAURI_SIGNING_PRIVATE_KEY in CI secrets.");
}
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  args.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
}
await cli.run(args, "pnpm tauri build");
