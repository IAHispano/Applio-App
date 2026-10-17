import { createRequire } from "node:module";
import { rustEnvironment } from "../../../scripts/rust-env.mjs";

Object.assign(process.env, rustEnvironment());
const require = createRequire(import.meta.url);
await require("@tauri-apps/cli/main").run(["dev", ...process.argv.slice(2)], "pnpm desktop:dev");
