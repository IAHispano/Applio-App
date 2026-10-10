import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function digest(file: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

export function validateLogsMove(source: string, destination: string): void {
  for (const folder of [source, destination]) {
    if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory())
      throw new Error(`Not a logs folder: ${folder}`);
  }
  const from = fs.existsSync(source) ? fs.realpathSync(source) : path.resolve(source);
  const to = fs.existsSync(destination) ? fs.realpathSync(destination) : path.resolve(destination);
  if (from === to) return;
  if (from === path.parse(from).root || to === path.parse(to).root || inside(from, to) || inside(to, from)) {
    throw new Error("Choose a separate logs folder, outside the current folder and its parent folders.");
  }
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error("The destination must be a folder, not a symbolic link.");
  }
}

export function cleanupMovedLogs(source: string, destination: string): void {
  validateLogsMove(source, destination);
  if (!fs.existsSync(destination))
    throw new Error("The new logs folder is missing; the original files were kept.");
  let isLink = false;
  try {
    isLink = fs.lstatSync(source).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (fs.existsSync(source)) {
    const physical = fs.realpathSync(source);
    if (physical === fs.realpathSync(destination)) return;
    // The canonical target is the explicitly saved source folder, validated
    // above against the destination and drive roots before recursive removal.
    fs.rmSync(physical, { recursive: true, force: true });
  }
  if (isLink) fs.unlinkSync(source);
}

// Run before API jobs/engine processes start. Stage and verify the whole tree,
// publish it, commit settings, then remove the original to free its disk space.
export function moveLogsDirectory(
  source: string,
  destination: string,
  repoRoot: string,
  commit: () => void,
): void {
  validateLogsMove(source, destination);
  if (!fs.existsSync(source) || fs.realpathSync(source) === path.resolve(destination)) {
    fs.mkdirSync(destination, { recursive: true });
    commit();
    return;
  }
  const physical = fs.realpathSync(source);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, ".applio-logs-move-"));
  const backup = path.join(parent, `.applio-logs-backup-${randomUUID()}`);
  if (!inside(parent, stage) || !inside(parent, backup)) throw new Error("Invalid migration staging path");
  let published = false;
  let backedUp = false;
  let committed = false;
  try {
    fs.cpSync(physical, stage, { recursive: true, verbatimSymlinks: true });
    const verify = (from: string, to: string) => {
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory()) verify(src, dst);
        else if (entry.isSymbolicLink()) {
          if (fs.readlinkSync(src) !== fs.readlinkSync(dst))
            throw new Error(`Could not verify copied link: ${src}`);
        } else if (fs.statSync(src).size !== fs.statSync(dst).size || digest(src) !== digest(dst)) {
          throw new Error(`Could not verify copied file: ${src}`);
        }
      }
    };
    verify(physical, stage);
    // Existing non-conflicting files (including shipped mute/reference data)
    // are kept. A differing file never gets overwritten.
    const merge = (from: string, to: string) => {
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (!fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
        else if (entry.isDirectory() && fs.lstatSync(dst).isDirectory()) merge(src, dst);
        else if (!entry.isFile() || !fs.lstatSync(dst).isFile() || digest(src) !== digest(dst)) {
          throw new Error(`Destination contains a conflicting file: ${src}`);
        }
      }
    };
    if (fs.existsSync(destination)) merge(destination, stage);
    const relocatedPath = (value: string): string => {
      const absolute = path.resolve(repoRoot, value);
      const base = inside(physical, absolute)
        ? physical
        : inside(path.resolve(source), absolute)
          ? path.resolve(source)
          : null;
      return base ? path.join(destination, path.relative(base, absolute)).replace(/\\/g, "/") : value;
    };
    const updatePaths = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) updatePaths(file);
        else if (entry.isFile() && entry.name === "filelist.txt") {
          const text = fs
            .readFileSync(file, "utf-8")
            .split(/\r?\n/)
            .map((line) =>
              line
                .split("|")
                .map((value, index) => (index < 4 && value ? relocatedPath(value) : value))
                .join("|"),
            )
            .join("\n");
          fs.writeFileSync(file, text);
        } else if (entry.isSymbolicLink()) {
          const link = fs.readlinkSync(file);
          if (path.isAbsolute(link)) {
            const moved = relocatedPath(link);
            if (moved !== link) {
              const type = fs.statSync(file).isDirectory() ? "junction" : "file";
              fs.unlinkSync(file);
              fs.symlinkSync(moved, file, type);
            }
          }
        }
      }
    };
    updatePaths(stage);
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      backedUp = true;
    }
    fs.renameSync(stage, destination);
    published = true;
    commit();
    committed = true;
  } catch (err) {
    if (published && !committed) fs.renameSync(destination, stage);
    if (backedUp && !committed) fs.renameSync(backup, destination);
    throw err;
  } finally {
    // Both generated directories are verified siblings inside the explicitly
    // chosen destination parent; neither removal follows links into user data.
    fs.rmSync(stage, { recursive: true, force: true });
    if (committed) fs.rmSync(backup, { recursive: true, force: true });
  }
}
