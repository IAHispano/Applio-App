import { createRequire } from "node:module";
import { rustEnvironment } from "../../../bin/rust-env.mjs";

Object.assign(process.env, rustEnvironment());

const require = createRequire(import.meta.url);
const cli = require("@tauri-apps/cli/main");
const args = ["build", ...process.argv.slice(2)];
// Private signing keys stay in CI secrets. Unsigned local builds still produce
// installers; they do not advertise an unverifiable automatic update feed.
if (process.env.APPLIO_UPDATER_PUBLIC_KEY && process.env.TAURI_SIGNING_PRIVATE_KEY) {
  args.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
}
await cli.run(args, "pnpm tauri build");
