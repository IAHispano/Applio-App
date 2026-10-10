import fs from "node:fs";
import path from "node:path";
import { getLogsDir, getRepoRoot } from "@/python";

export function repoRel(absPath: string): string {
  const rel = path.relative(getLogsDir(), absPath);
  if (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
    return path.posix.join("logs", rel.replace(/\\/g, "/"));
  }
  return path.relative(getRepoRoot(), absPath).replace(/\\/g, "/");
}

export function walkDir(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, exts, out);
    else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) out.push(full);
  }
  return out;
}

// Model lists and the library share one traversal and the same exclusions.
export function scanModels(dir: string): { models: string[]; indexes: string[] } {
  const models: string[] = [];
  const indexes: string[] = [];
  for (const file of walkDir(dir, [".pth", ".onnx", ".index"])) {
    const name = path.basename(file);
    if (path.extname(name).toLowerCase() === ".index") {
      if (!name.includes("trained")) indexes.push(file);
    } else if (!name.startsWith("G_") && !name.startsWith("D_")) {
      models.push(file);
    }
  }
  return { models, indexes };
}
