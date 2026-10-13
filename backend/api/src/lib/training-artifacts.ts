import fs from "node:fs";
import path from "node:path";

export function modelArtifacts(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".pth")) continue;
    const stat = fs.statSync(path.join(directory, entry.name));
    files.set(entry.name, `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
  }
  return files;
}

/** Resolve this run's inference export, never a G_/D_ training checkpoint or an old export. */
export function trainedModelArtifact(
  directory: string,
  name: string,
  before: Map<string, string>,
  totalEpoch: number,
): string {
  const current = modelArtifacts(directory);
  const candidates: { file: string; epoch: number; step: number }[] = [];
  for (const [file, signature] of current) {
    if (signature === before.get(file) || fs.statSync(path.join(directory, file)).size === 0) continue;
    if (file === `${name}.pth`) candidates.push({ file, epoch: -1, step: -1 });
    else if (file.startsWith(`${name}_`)) {
      const suffix = file.slice(name.length + 1).match(/^(\d+)e_(\d+)s\.pth$/);
      if (suffix && Number(suffix[1]) >= totalEpoch)
        candidates.push({ file, epoch: Number(suffix[1]), step: Number(suffix[2]) });
    }
  }
  candidates.sort((a, b) => b.epoch - a.epoch || b.step - a.step);
  if (!candidates.length) {
    throw new Error(
      `Training did not save a new voice model in ${directory}. Expected ${name}_<epoch>e_<step>s.pth or ${name}.pth. Check the training logs for model export errors; G_/D_ files are training checkpoints.`,
    );
  }
  return path.join(directory, candidates[0].file);
}

export function indexArtifact(directory: string, name: string): string {
  const file = path.join(directory, `${name}.index`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(
      `Index generation produced no usable index file: ${file}. Check the feature extraction and index logs.`,
    );
  }
  return file;
}
