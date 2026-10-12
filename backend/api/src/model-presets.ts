import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "@/config";

export type PresetValues = Record<string, string | number | boolean>;
export type Presets = Record<string, PresetValues>;
export function presetKey(scope: string, model: string): string {
  return `${scope}:${model.replace(/\\/g, "/")}`;
}
export function readModelPresets(): Presets {
  const file = path.join(getConfigDir(), "model-presets.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.version !== 1 || !data.presets || typeof data.presets !== "object" || Array.isArray(data.presets))
    throw new Error("Invalid model presets file");
  return data.presets;
}
export function saveModelPreset(scope: string, model: string, values: PresetValues): void {
  const presets = readModelPresets();
  // Define an own property even for model names that resemble prototype keys.
  Object.defineProperty(presets, presetKey(scope, model), {
    value: values,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const file = path.join(getConfigDir(), "model-presets.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, presets }, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
