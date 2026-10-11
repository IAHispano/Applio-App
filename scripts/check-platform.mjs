import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-platform-"));
try {
  const bundle = path.join(temporary, "platform.cjs");
  await require("esbuild").build({
    stdin: { contents: 'export * from "./frontend/desktop/src/local-storage"; export * from "./backend/api/src/realtime-process";', resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile: bundle,
  });
  const { installationStorage, prepareInstallationStorage, copyLegacyUserData, RealtimeProcessManager } = require(bundle);
  const exe = path.join(temporary, "chosen-drive", "Applio.exe");
  const storage = prepareInstallationStorage(exe);
  assert.equal(storage.userData, path.join(path.dirname(exe), "data"));
  for (const value of Object.values(storage)) assert.ok(value.startsWith(storage.userData));
  const legacy = path.join(temporary, "legacy");
  fs.mkdirSync(path.join(legacy, "data/logs/voice"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "data/.venv"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "data/logs/voice/voice.pth"), "model bytes");
  fs.writeFileSync(path.join(legacy, "data/logs/voice/filelist.txt"), `${path.join(legacy, "data/logs/voice/audio.wav")}|0`);
  fs.writeFileSync(path.join(legacy, "data/.venv/python.exe"), "non-relocatable");
  fs.writeFileSync(path.join(legacy, "config.json"), JSON.stringify({ logs_dir: path.join(legacy, "data/logs"), custom: path.join(temporary, "external-models") }));
  fs.writeFileSync(path.join(legacy, "jobs.json"), JSON.stringify([{ output: path.join(legacy, "data/assets/audios/voice.wav") }]));
  copyLegacyUserData(legacy, exe);
  assert.equal(fs.readFileSync(path.join(storage.runtime, "logs/voice/voice.pth"), "utf8"), "model bytes");
  assert.equal(fs.readFileSync(path.join(storage.runtime, "logs/voice/filelist.txt"), "utf8"), `${path.join(storage.runtime, "logs/voice/audio.wav")}|0`);
  assert.ok(fs.existsSync(path.join(legacy, "data/logs/voice/voice.pth")), "Migration must preserve originals");
  assert.ok(!fs.existsSync(path.join(storage.runtime, ".venv")));
  const config = JSON.parse(fs.readFileSync(path.join(storage.userData, "config.json"), "utf8"));
  assert.equal(config.logs_dir, path.join(storage.runtime, "logs"));
  assert.equal(config.custom, path.join(temporary, "external-models"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(storage.userData, "jobs.json"), "utf8"))[0].output, path.join(storage.runtime, "assets/audios/voice.wav"));
  fs.writeFileSync(path.join(storage.runtime, "logs/voice/voice.pth"), "new model");
  copyLegacyUserData(legacy, exe);
  assert.equal(fs.readFileSync(path.join(storage.runtime, "logs/voice/voice.pth"), "utf8"), "new model");
  assert.deepEqual(installationStorage(exe), storage);

  const proc = new EventEmitter();
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
  const manager = new RealtimeProcessManager(() => proc);
  manager.start();
  const trace = `Traceback\n${"  stack frame\n".repeat(200)}RuntimeError: operator torchvision::nms does not exist\n`;
  proc.stderr.emit("data", Buffer.from(trace));
  assert.ok(manager.logs.join("\n").includes(trace), "The complete traceback must survive a single long pipe chunk");

  // Execute the actual endpoint's Python snippet with simulated devices.
  const ts = require("typescript");
  const source = ts.createSourceFile("train.ts", fs.readFileSync(path.join(root, "backend/api/src/routes/train.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  let snippet;
  function visit(node) {
    if (ts.isArrayLiteralExpression(node) && node.elements.some(e => ts.isStringLiteral(e) && e.text.includes("get_gpu_info, get_number_of_gpus"))) {
      snippet = node.elements.map(e => e.text).join("\n");
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(snippet);
  const python = process.env.PYTHON_BIN || path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  for (const mps of [true, false]) {
    const code = `import sys, torch\nsys.path.insert(0, ${JSON.stringify(path.join(root, "backend/applio"))})\ntorch.cuda.is_available = lambda: False\ntorch.backends.mps.is_available = lambda: ${mps ? "True" : "False"}\n${snippet}`;
    const result = spawnSync(python, ["-c", code], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout.split("APPLIO_JSON:")[1]);
    assert.equal(response.count, mps ? "0" : "-");
    assert.equal(response.devices.length, mps ? 1 : 0);
    assert.equal(response.gpus.at(-1).id, "-");
    if (mps) assert.equal(response.devices[0].name, "Apple Silicon GPU (MPS)");
  }
  console.log("Local storage migration, full realtime tracebacks, MPS and CPU GPU dispatch passed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
