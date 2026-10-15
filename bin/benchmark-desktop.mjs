// Compare complete packaged Windows apps in isolated, disposable installations.
// Example: node bin/benchmark-desktop.mjs --electron "C:/.../Applio" --runs 5

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/desktop/package.json"));
const WebSocket = require("ws");
const exec = promisify(execFile);
const args = process.argv.slice(2);
function option(key, fallback) {
  const index = args.indexOf(`--${key}`);
  return index < 0 ? fallback : args[index + 1];
}
if (process.platform !== "win32") throw new Error("Windows only: uses Windows process accounting.");
const baseline = path.resolve(option("electron", path.join(process.env.LOCALAPPDATA, "Programs/Applio")));
const runs = Number(option("runs", "5"));
if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error("--runs must be 1–50");
const output = path.resolve(option("output", path.join(root, ".applio-dev/benchmark-desktop.json")));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-benchmark-"));
function cleanup() {
  if (!path.resolve(temporary).startsWith(path.join(path.resolve(os.tmpdir()), "applio-benchmark-")))
    throw new Error("Invalid cleanup target");
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
const ps = async (source) => {
  const { stdout } = await exec(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")],
    { windowsHide: true, maxBuffer: 4e6 },
  );
  return JSON.parse(stdout.trim());
};
async function freePort(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const assigned = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return assigned;
}
function footprint(folder, exclude = new Set()) {
  let bytes = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in packaged payload: ${file}`);
    bytes += entry.isDirectory() ? footprint(file) : fs.statSync(file).size;
  }
  return bytes;
}
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (bytes) => {
    const message = JSON.parse(bytes);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(new Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  });
  return {
    socket,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}
async function snapshot(pid) {
  // PrivateMemorySize64 is additive; summed WorkingSet64 includes shared pages.
  return ps(
    `$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId); $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do { $changed = $false; foreach ($item in $all) { if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $changed = $true } } } while ($changed); $rows = @(foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{pid=$p.Id;name=$p.ProcessName;privateBytes=$p.PrivateMemorySize64;workingSetBytes=$p.WorkingSet64;cpuSeconds=$p.TotalProcessorTime.TotalSeconds} } }); [pscustomobject]@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();processes=$rows} | ConvertTo-Json -Depth 4 -Compress`,
  );
}
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2;
};
let child;
let cdp;
const report = {
  createdAt: new Date().toISOString(),
  qualification:
    "Exploratory comparison: installed Electron release versus current uncommitted Tauri migration; different UI/API builds, not a controlled framework-only comparison.",
  methodology: {
    runsPerApp: runs,
    order: "One discarded warmup per app, then alternating Electron/Tauri and Tauri/Electron pairs.",
    startup:
      "Process spawn to API health HTTP 200 and main page document.readyState=complete with >100 visible text characters and at least one button. CDP polling at 100 ms; does not prove React hydration or first visible window.",
    profile:
      "Fresh isolated installation/profile per app; reused after warmup. OS file caches not flushed. APPLIO_NO_ENV=1; setup screen, no Python engine/model loaded.",
    idle: "10 seconds after document ready, then three process-tree samples 2 seconds apart; per-run median private bytes and working set.",
    memory:
      "All descendants of launcher via Win32_Process ParentProcessId, including Next.js, Node API (Electron), WebView2/GPU/renderer. Private bytes are process commit, not physical RAM. Summed working sets double-count shared pages.",
    cpu: "CPU deltas for surviving PIDs between first/last idle samples, normalized to all logical CPUs. Short-lived children between samples may be missed.",
    size: "Logical file bytes, excluding installation data, uninstaller and icon. Shared system WebView2 excluded. No matched Electron installer is available; download size not compared.",
    instrumentation:
      "Local CDP enabled on both apps for this run only; same sampling harness. No production app changes.",
  },
  machine: {
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    osRelease: os.release(),
    arch: os.arch(),
    node: process.version,
  },
  builds: {},
  samples: [],
};
async function run(kind, round) {
  await freePort(3000);
  await freePort(8000);
  const port = await freePort();
  const folder = path.join(temporary, kind);
  let logs = "";
  const started = performance.now();
  child = spawn(
    path.join(folder, "Applio.exe"),
    kind === "electron" ? [`--remote-debugging-port=${port}`] : [],
    {
      cwd: folder,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APPLIO_NO_ENV: "1",
        APPDATA: path.join(folder, "roaming"),
        LOCALAPPDATA: path.join(folder, "local"),
        WEBVIEW2_USER_DATA_FOLDER: path.join(folder, "data/session"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    },
  );
  child.on("error", (error) => {
    logs += String(error);
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-6000);
    });
  try {
    let ready = false;
    while (performance.now() - started < 90000 && !ready) {
      if (child.exitCode !== null) throw new Error(`${kind} exited ${child.exitCode}: ${logs}`);
      try {
        if (!cdp) {
          const targets = await (
            await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
          ).json();
          const target = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:3000"));
          if (target) cdp = await connect(target);
        }
        if (cdp) {
          const dom = await cdp.call("Runtime.evaluate", {
            returnByValue: true,
            expression:
              "document.readyState==='complete' && document.body.innerText.length>100 && !!document.querySelector('button')",
          });
          if (dom.result?.value === true)
            ready = (await fetch("http://127.0.0.1:8000/api/health", { signal: AbortSignal.timeout(1000) }))
              .ok;
        }
      } catch {
        /* Server/renderer can still be starting. */
      }
      if (!ready) await delay(100);
    }
    if (!ready) throw new Error(`${kind} startup timeout: ${logs}`);
    const startupMs = performance.now() - started;
    const browser = await cdp.call("Browser.getVersion");
    const health = await (await fetch("http://127.0.0.1:8000/api/health")).json();
    report.builds[kind].browser = browser.product;
    await delay(10000);
    const snapshots = [];
    for (let i = 0; i < 3; i++) {
      if (i) await delay(2000);
      snapshots.push(await snapshot(child.pid));
    }
    const first = snapshots[0],
      last = snapshots.at(-1);
    const previous = new Map(first.processes.map((p) => [p.pid, p.cpuSeconds]));
    const cpu = sum(
      last.processes
        .filter((p) => previous.has(p.pid))
        .map((p) => ({ delta: Math.max(0, p.cpuSeconds - previous.get(p.pid)) })),
      "delta",
    );
    const sample = {
      kind,
      round,
      startupMs,
      privateBytes: median(snapshots.map((s) => sum(s.processes, "privateBytes"))),
      workingSetBytes: median(snapshots.map((s) => sum(s.processes, "workingSetBytes"))),
      processCount: median(snapshots.map((s) => s.processes.length)),
      idleCpuPercent: (cpu / ((last.timestamp - first.timestamp) / 1000) / os.cpus().length) * 100,
      health,
      snapshots,
    };
    console.log(
      `${kind} ${round}: ${startupMs.toFixed(0)} ms; ${(sample.privateBytes / 1048576).toFixed(1)} MiB private; ${sample.processCount} processes`,
    );
    return sample;
  } finally {
    cdp?.socket.close();
    cdp = null;
    if (child?.pid)
      await exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(
        () => {},
      );
    child = null;
    await delay(1500);
  }
}
try {
  await freePort(3000);
  await freePort(8000);
  console.log("Copying packaged apps into isolated benchmark installations…");
  const electron = path.join(temporary, "electron"),
    tauri = path.join(temporary, "tauri");
  fs.cpSync(baseline, electron, {
    recursive: true,
    filter: (file) =>
      !["data", "Uninstall Applio.exe", "uninstallerIcon.ico"].includes(
        path.relative(baseline, file).split(path.sep)[0],
      ),
  });
  fs.mkdirSync(tauri);
  fs.copyFileSync(path.join(root, "target/release/applio-desktop.exe"), path.join(tauri, "Applio.exe"));
  fs.cpSync(path.join(root, "frontend/desktop/resources"), path.join(tauri, "app"), { recursive: true });
  for (const [kind, folder] of [
    ["electron", electron],
    ["tauri", tauri],
  ]) {
    report.builds[kind] = {
      executableSha256: hash(path.join(folder, "Applio.exe")),
      installedBytes: footprint(folder),
      version: "0.2.9",
    };
    fs.mkdirSync(path.join(folder, "data"));
    fs.writeFileSync(
      path.join(folder, "data/.legacy-imported"),
      "Isolated benchmark: skip importing user data",
    );
    const code = kind === "electron" ? path.join(folder, "resources/app") : path.join(folder, "app");
    const buildId = path.join(code, "frontend/web/.next/standalone/.next/BUILD_ID");
    report.builds[kind].nextBuildId = fs.existsSync(buildId) ? fs.readFileSync(buildId, "utf8").trim() : null;
    const revision = path.join(code, "backend/revision.json");
    report.builds[kind].engineRevision = fs.existsSync(revision)
      ? JSON.parse(fs.readFileSync(revision, "utf8")).commit
      : null;
  }
  report.builds.tauri.installerBytes = fs.statSync(
    path.join(root, "frontend/desktop/dist-installers/Applio_0.2.9_x64-setup.exe"),
  ).size;
  for (const kind of ["electron", "tauri"]) await run(kind, "discarded-warmup");
  for (let i = 0; i < runs; i++) {
    for (const kind of i % 2 ? ["tauri", "electron"] : ["electron", "tauri"]) {
      report.samples.push(await run(kind, i + 1));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  report.summary = Object.fromEntries(
    ["electron", "tauri"].map((kind) => [
      kind,
      Object.fromEntries(
        ["startupMs", "privateBytes", "workingSetBytes", "processCount", "idleCpuPercent"].map((metric) => {
          const values = report.samples.filter((s) => s.kind === kind).map((s) => s[metric]);
          return [metric, { median: median(values), min: Math.min(...values), max: Math.max(...values) }];
        }),
      ),
    ]),
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Raw results: ${output}`);
} finally {
  cleanup();
}
