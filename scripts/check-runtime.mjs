import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function packagedRoots() {
  const explicit = process.argv[process.argv.indexOf("--packaged") + 1];
  if (explicit && !explicit.startsWith("--")) return [path.resolve(explicit)];
  const directory = path.join(root, "frontend/desktop/dist-installers");
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = path.join(directory, entry.name);
    const app = path.join(base, "resources/app");
    if (fs.existsSync(path.join(app, "backend/api/dist/index.js"))) result.push(app);
    for (const child of fs.readdirSync(base))
      if (child.endsWith(".app")) {
        const mac = path.join(base, child, "Contents/Resources/app");
        if (fs.existsSync(path.join(mac, "backend/api/dist/index.js"))) result.push(mac);
      }
  }
  assert.ok(result.length, "No unpacked release found. Build an installer first.");
  return result;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return String(port);
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
    const env = {
      ...process.env,
      APPLIO_NO_ENV: "1",
      APPLIO_ROOT: data,
      APPLIO_CODE_ROOT: code,
      APPLIO_BACKEND_ROOT: path.join(code, "backend/applio"),
      APPLIO_CONFIG_DIR: temporary,
      API_PORT: apiPort,
      PORT: webPort,
      HOSTNAME: "127.0.0.1",
    };
    for (const entry of ["backend/api/dist/index.js", "frontend/web/.next/standalone/server.js"]) {
      const child = spawn(process.execPath, [path.join(code, entry)], {
        cwd: data,
        env,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
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
    const health = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.repoRoot, data);
    const voices = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/tts/voices`)).json();
    assert.ok(voices.voices.length > 100);
    const jobs = await (await fetchReady(`http://127.0.0.1:${apiPort}/api/jobs`)).json();
    assert.deepEqual(jobs.jobs, []);
    for (const page of ["/", "/jobs", "/realtime"])
      assert.equal((await fetchReady(`http://127.0.0.1:${webPort}${page}`)).status, 200);
    console.log(`Runtime passed: ${code} (engine ${manifest.commit.slice(0, 8)})`);
  } finally {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill();
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await closed;
      }
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
for (const code of process.argv.includes("--packaged") ? packagedRoots() : [root]) await check(code);
