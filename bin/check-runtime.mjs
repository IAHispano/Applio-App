import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkBrowser } from "./check-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function packagedRoots() {
  const explicit = process.argv[process.argv.indexOf("--packaged") + 1];
  if (explicit && !explicit.startsWith("--")) return [path.resolve(explicit)];
  const staged = path.join(root, "frontend/desktop/resources");
  assert.ok(
    fs.existsSync(path.join(staged, "frontend/web/out/index.html")),
    "Stage the Tauri resources first.",
  );
  return [staged];
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}
function cleanTemporary(directory) {
  if (!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), "applio-startup-")))
    throw new Error("Invalid runtime test cleanup root");
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
async function check(code) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-startup-"));
  const children = [];
  let errors = "";
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(code, "backend/revision.json"), "utf8"));
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    assert.ok(Object.keys(manifest.files).length > 50);
    for (const [file, expected] of Object.entries(manifest.files)) {
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(code, "backend/applio", file)))
          .digest("hex"),
        expected,
        `Engine source differs: ${file}`,
      );
    }
    assert.ok(fs.existsSync(path.join(code, "requirements-uvr.txt")));
    const apiPort = await freePort();
    const webPort = await freePort();
    const data = path.join(temporary, "data");
    fs.mkdirSync(data);
    if (process.argv.includes("--packaged")) {
      const inspect = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          assert.ok(
            !["node.exe", "node_modules", "standalone"].includes(entry.name),
            `Node runtime resource shipped: ${path.join(directory, entry.name)}`,
          );
          if (entry.isDirectory()) inspect(path.join(directory, entry.name));
        }
      };
      inspect(code);
    }
    const env = {
      ...process.env,
      APPLIO_NO_ENV: "1",
      APPLIO_ROOT: data,
      APPLIO_CODE_ROOT: code,
      APPLIO_BACKEND_ROOT: path.join(code, "backend/applio"),
      APPLIO_CONFIG_DIR: temporary,
      API_PORT: apiPort,
      PORT: webPort,
      WEB_PORT: webPort,
      APPLIO_SERVE_WEB: "1",
      HOSTNAME: "127.0.0.1",
      // The native runtime must start when Node cannot be resolved from PATH.
      PATH: process.platform === "win32" ? path.join(process.env.SystemRoot, "System32") : "/usr/bin:/bin",
      APPLIO_NODE: path.join(temporary, "node-must-not-exist"),
    };
    const packaged = process.argv.includes("--packaged");
    const native = path.join(
      root,
      "target",
      packaged ? "release" : "debug",
      process.platform === "win32" ? "applio-api.exe" : "applio-api",
    );
    {
      const child = spawn(native, ["--shutdown-on-stdin-eof"], {
        cwd: data,
        env,
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      });
      children.push(child);
      child.stderr.on("data", (bytes) => {
        errors = (errors + bytes).slice(-8000);
      });
      child.on("error", (error) => {
        errors += String(error);
      });
    }
    async function fetchReady(url) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (children.some((child) => child.exitCode !== null)) throw new Error(`Runtime exited:\n${errors}`);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
          if (response.ok) return response;
        } catch {}
        await delay(200);
      }
      throw new Error(`Startup timed out for ${url}:\n${errors}`);
    }
    console.log("Checking native runtime without Node on PATH…");
    const health = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.service, "applio-rust-api");
    assert.equal(health.repoRoot, data);
    assert.equal(health.compatibilityService, false);
    assert.equal(health.runtime, "rust");
    const voices = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/tts/voices`)).json();
    assert.ok(voices.voices.length > 100);
    const jobs = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/jobs`)).json();
    assert.deepEqual(jobs.jobs, []);
    const origin = `http://127.0.0.1:${webPort}`;
    for (const page of [
      "/",
      "/inference",
      "/realtime",
      "/tts",
      "/models",
      "/train",
      "/voice-blender",
      "/tensorboard",
      "/extra",
      "/audio-separator",
      "/jobs",
      "/jobs/view",
      "/settings",
      "/report",
      "/setup",
    ]) {
      if (process.env.APPLIO_CHECK_VERBOSE) console.log(`Checking ${page}`);
      const response = await fetchReady(`${origin}${page}`);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(await response.text(), /<html/);
      const component = await fetch(`${origin}${page === "/" ? "/index" : page}.txt?_rsc=test`);
      assert.equal(component.status, 200, `Missing navigation component: ${page}`);
      assert.match(component.headers.get("content-type"), /text\/x-component/);
    }
    const legacy = await fetch(`${origin}/jobs/old-job`, { redirect: "manual" });
    assert.equal(legacy.headers.get("location"), "/jobs/view?id=old-job");
    const webHealth = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(webHealth.repoRoot, health.repoRoot);
    assert.equal(webHealth.runtime, "rust");
    const status = await (await fetch(`${origin}/api/setup/status`)).json();
    assert.ok(!status.checks.some((check) => check.id === "node"), "Setup still requires Node");
    if (process.argv.includes("--browser")) await checkBrowser(origin, temporary);
    console.log(`Runtime passed: ${code} (engine ${manifest.commit.slice(0, 8)})`);
  } finally {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      const closed = new Promise((resolve) => child.once("close", resolve));
      if (child === children[0]) child.stdin.end();
      else child.kill();
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await closed;
      }
    }
    cleanTemporary(temporary);
  }
}
try {
  for (const code of process.argv.includes("--packaged") ? packagedRoots() : [root]) await check(code);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
