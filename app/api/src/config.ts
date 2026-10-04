import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCodeRoot, getRepoRoot } from "@/python";

export type JsonObject = Record<string, unknown>;

// Keep this policy in sync with rvc/lib/user_config.py for standalone Python use.
export function getConfigDir(platform = process.platform, env = process.env, home = os.homedir()): string {
  if (env.APPLIO_CONFIG_DIR) return path.resolve(env.APPLIO_CONFIG_DIR);
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Applio");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Applio");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Applio");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function readObject(file: string): JsonObject {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a settings object in ${file}`);
  }
  return value as JsonObject;
}

export function deepMerge(base: JsonObject, over: JsonObject): JsonObject {
  for (const k of Object.keys(over)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const bv = base[k];
    const ov = over[k];
    if (
      ov &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      deepMerge(bv as JsonObject, ov as JsonObject);
    } else base[k] = ov;
  }
  return base;
}

function writeConfig(cfg: JsonObject, createOnly = false): void {
  const file = getConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  // Version belongs to the shipped template, not user preferences.
  const { version: _version, ...preferences } = cfg;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(preferences, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (createOnly) {
      try {
        // Publish a complete file without replacing another process's migration.
        fs.linkSync(temp, file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    } else {
      fs.renameSync(temp, file);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function loadConfig(): JsonObject {
  // Packaged assets in the data directory can be older than the installed code.
  const defaults = readObject(path.join(getCodeRoot(), "assets", "config_template.json"));
  const file = getConfigPath();
  if (!fs.existsSync(file)) {
    const legacy = path.join(getRepoRoot(), "assets", "config.json");
    writeConfig(fs.existsSync(legacy) ? readObject(legacy) : {}, true);
  }
  const { version: _version, ...preferences } = readObject(file);
  return deepMerge(defaults, preferences);
}

export function saveConfig(cfg: JsonObject): void {
  writeConfig(cfg);
}
