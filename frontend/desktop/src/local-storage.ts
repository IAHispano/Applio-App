import fs from "node:fs";
import path from "node:path";

function relocatePaths(value: unknown, oldRuntime: string, runtime: string): unknown {
  if (Array.isArray(value)) return value.map((item) => relocatePaths(item, oldRuntime, runtime));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, relocatePaths(item, oldRuntime, runtime)]),
    );
  if (typeof value !== "string" || !path.isAbsolute(value)) return value;
  const relative = path.relative(oldRuntime, value);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? path.join(runtime, relative)
    : value;
}

function relocateTrainingLists(folder: string, oldRuntime: string, runtime: string) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) relocateTrainingLists(file, oldRuntime, runtime);
    else if (entry.isFile() && entry.name === "filelist.txt") {
      const content = fs.readFileSync(file, "utf-8");
      const updated = content
        .replaceAll(`${oldRuntime}${path.sep}`, `${runtime}${path.sep}`)
        .replaceAll(`${oldRuntime.replaceAll("\\", "/")}/`, `${runtime.replaceAll("\\", "/")}/`);
      if (updated !== content) fs.writeFileSync(file, updated);
    } else if (entry.isFile() && entry.name === "config.json") {
      const content = fs.readFileSync(file, "utf-8");
      try {
        const config = JSON.parse(content);
        fs.writeFileSync(file, JSON.stringify(relocatePaths(config, oldRuntime, runtime), null, 2));
      } catch {
        // Preserve invalid existing metadata verbatim; never reset it.
      }
    }
  }
}

// This name is also excluded by the NSIS customRemoveFiles hook.
export function installationStorage(executable: string) {
  const userData = path.join(path.dirname(executable), "data");
  return {
    userData,
    runtime: path.join(userData, "runtime"),
    cache: path.join(userData, "cache"),
    temp: path.join(userData, "temp"),
    session: path.join(userData, "session"),
    crashDumps: path.join(userData, "crash-dumps"),
    logs: path.join(userData, "app-logs"),
  };
}

export function copyLegacyUserData(legacy: string, executable: string) {
  const storage = installationStorage(executable);
  const marker = path.join(storage.userData, ".legacy-imported");
  if (legacy === storage.userData || fs.existsSync(marker)) return;
  // Copy user content only. Virtualenvs cannot safely be relocated and will
  // be installed locally by setup. The original data is never removed.
  for (const entry of ["logs", "assets", "rvc/models"]) {
    const source = path.join(legacy, "data", entry);
    const destination = path.join(storage.runtime, entry);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    const staging = `${destination}.legacy-import`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // A failed copy can be retried: overwrite only our staging files, never
    // existing destination content or the original data.
    fs.cpSync(source, staging, { recursive: true, force: true });
    if (entry === "logs") relocateTrainingLists(staging, path.join(legacy, "data"), storage.runtime);
    fs.renameSync(staging, destination);
  }
  const oldAppLogs = path.join(legacy, "logs");
  if (fs.existsSync(oldAppLogs)) {
    fs.cpSync(oldAppLogs, storage.logs, { recursive: true, force: false, errorOnExist: false });
  }
  for (const entry of ["config.json", "window-state.json", "jobs.json"]) {
    const source = path.join(legacy, entry);
    const destination = path.join(storage.userData, entry);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    let content = fs.readFileSync(source, "utf-8");
    if (entry === "config.json" || entry === "jobs.json") {
      // Move default paths into the local runtime; preserve explicitly chosen
      // external model folders.
      try {
        const config = JSON.parse(content);
        content = JSON.stringify(relocatePaths(config, path.join(legacy, "data"), storage.runtime), null, 2);
      } catch (error) {
        if (entry === "config.json") throw error;
        // The job-history reader reports invalid history; preserve its bytes.
      }
    }
    fs.writeFileSync(destination, content, { flag: "wx" });
  }
  fs.writeFileSync(marker, legacy, { flag: "wx" });
}

export function prepareInstallationStorage(executable: string) {
  const storage = installationStorage(executable);
  for (const dir of Object.values(storage)) fs.mkdirSync(dir, { recursive: true });
  // Fail visibly for unwritable installations instead of silently using AppData.
  fs.accessSync(storage.userData, fs.constants.W_OK);
  // Windows access(W_OK) does not check directory ACLs; verify a real write.
  const probe = path.join(storage.userData, `.write-check-${process.pid}`);
  const fd = fs.openSync(probe, "wx");
  fs.closeSync(fd);
  fs.unlinkSync(probe);
  return storage;
}
