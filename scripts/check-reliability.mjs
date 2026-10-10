import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-check-"));
process.env.APPLIO_CONFIG_DIR = temporary;
const bundle = path.join(temporary, "checks.cjs");
let server;
try {
  await require("esbuild").build({
    stdin: {
      contents:
        ["jobs", "scheduler", "download-file", "job-history", "realtime-process"]
          .map((name) => `export * from ${JSON.stringify(path.join(root, "backend/api/src", `${name}.ts`))};`)
          .join("\n") +
        `\nexport * from ${JSON.stringify(path.join(root, "frontend/web/lib/realtime-audio.ts"))};`,
      loader: "ts",
      resolveDir: root,
    },
    tsconfig: path.join(root, "backend/api/tsconfig.json"),
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
  });
  const api = require(bundle);
  const child = new EventEmitter();
  child.exitCode = null;
  let kills = 0;
  child.kill = () => {
    kills++;
    setTimeout(() => {
      child.exitCode = 0;
      child.emit("close");
    }, 20);
  };
  const manager = new api.RealtimeProcessManager(() => child);
  manager.start();
  let released = false;
  const stopped = manager.stop().then(() => {
    released = true;
  });
  const repeatedStop = manager.stop();
  assert.equal(released, false, "GPU released before realtime process closed");
  await Promise.all([stopped, repeatedStop]);
  assert.equal(released, true);
  assert.equal(kills, 1);
  if (process.platform === "win32") {
    const parentCode =
      "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid);setInterval(()=>{},1000);";
    const tree = new api.RealtimeProcessManager(() =>
      spawn(process.execPath, ["-e", parentCode], { windowsHide: true }),
    );
    const parent = tree.start();
    let descendant;
    try {
      descendant = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Process-tree fixture startup timed out")), 5000);
        parent.stdout.once("data", (bytes) => {
          clearTimeout(timer);
          resolve(Number(bytes.toString().trim()));
        });
      });
    } finally {
      await tree.stop();
    }
    assert.ok(descendant > 0);
    assert.throws(() => process.kill(descendant, 0), "Realtime descendant survived stop");
  }
  const frames = [];
  const sender = new api.RealtimeAudioSender((frame) => frames.push(frame[0]));
  sender.capture(new Float32Array([0]));
  assert.deepEqual(frames, []);
  sender.start();
  for (let i = 1; i <= 100; i++) sender.capture(new Float32Array([i]));
  assert.equal(sender.queuedBlocks, 1);
  assert.equal(sender.droppedBlocks, 98);
  sender.acknowledge();
  assert.deepEqual(frames, [1, 100]);
  let Playback;
  const reports = [];
  vm.runInNewContext(api.PLAYBACK_WORKLET, {
    Float32Array,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = { postMessage: (message) => reports.push(message) };
    },
    registerProcessor: (_name, processor) => {
      Playback = processor;
    },
  });
  const playback = new Playback();
  for (let i = 0; i < 3; i++)
    playback.port.onmessage({ data: { chunk: new Float32Array(1440).fill(i + 1).buffer } });
  assert.equal(playback.buffered, 2880);
  assert.equal(playback.dropped, 1440);
  for (let i = 0; i < 100; i++) playback.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.ok(reports.length);
  assert.equal(reports[0].stats.droppedFrames, 1440);
  assert.ok(reports[0].stats.underrunFrames > 0);
  const first = api.createJob("inference");
  assert.equal(await api.acquireJobSlot(first), true);
  api.setRunning(first);
  assert.equal(api.beginRealtimeSession(), null);
  const waiting = api.createJob("train");
  const cancelled = api.acquireJobSlot(waiting);
  api.cancelJob(waiting);
  assert.equal(await cancelled, false);
  api.setDone(waiting);
  assert.equal(waiting.status, "error", "Late completion overwrote cancellation");
  api.setDone(first, { message: "kept" }, "out.wav");
  api.releaseJobSlot(first.id);
  const realtimeRelease = api.beginRealtimeSession();
  assert.ok(realtimeRelease);
  const next = api.createJob("inference");
  let admitted = false;
  const admission = api.acquireJobSlot(next).then((result) => {
    admitted = result;
  });
  await delay(10);
  assert.equal(admitted, false);
  realtimeRelease();
  await admission;
  assert.equal(admitted, true);
  api.setRunning(next);
  api.flushJobHistory();
  const restored = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", `const a=require(${JSON.stringify(bundle)}); console.log(JSON.stringify(a.listJobs()));`],
      { encoding: "utf8", env: process.env },
    ),
  );
  assert.equal(restored.find((job) => job.id === next.id).status, "error");
  assert.match(restored.find((job) => job.id === next.id).error, /restart/);
  assert.equal(restored.find((job) => job.id === first.id).outputFile, "out.wav");
  api.cancelJob(next);
  api.releaseJobSlot(next.id);
  const network = Array.from({ length: 3 }, () => api.createJob("download"));
  assert.equal(await api.acquireJobSlot(network[0], "network"), true);
  assert.equal(await api.acquireJobSlot(network[1], "network"), true);
  let thirdStarted = false;
  const third = api.acquireJobSlot(network[2], "network").then(() => {
    thirdStarted = true;
  });
  await delay(10);
  assert.equal(thirdStarted, false);
  api.setDone(network[0]);
  api.releaseJobSlot(network[0].id);
  await third;
  assert.equal(thirdStarted, true);
  for (const job of network.slice(1)) {
    api.setDone(job);
    api.releaseJobSlot(job.id);
  }
  const malformed = path.join(temporary, "broken.json");
  fs.writeFileSync(malformed, "{broken");
  assert.deepEqual(new api.JobHistory(malformed).load(), []);
  assert.ok(
    fs.readdirSync(temporary).some((file) => file.startsWith("broken.json.") && file.endsWith(".corrupt")),
  );

  const payload = Buffer.alloc(1024 * 1024, 47);
  let failedOnce = false;
  const ranges = [];
  server = http.createServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404);
      res.end();
      return;
    }
    const offset = req.headers.range ? Number(req.headers.range.match(/\d+/)[0]) : 0;
    ranges.push(offset);
    const resumed = offset && req.headers["if-range"] === '"same"';
    const start = resumed ? offset : 0;
    res.writeHead(resumed ? 206 : 200, {
      "Content-Length": payload.length - start,
      ETag: '"same"',
      ...(resumed ? { "Content-Range": `bytes ${start}-${payload.length - 1}/${payload.length}` } : {}),
    });
    if (req.url === "/retry" && !failedOnce) {
      failedOnce = true;
      res.write(payload.subarray(0, payload.length / 2));
      setTimeout(() => res.destroy(), 30);
      return;
    }
    if (req.url === "/abort") {
      res.write(payload.subarray(0, 8192));
      return;
    }
    res.end(payload.subarray(start));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const destination = path.join(temporary, "model.pth");
  await api.downloadFile(`${base}/retry`, destination, {
    sha256: createHash("sha256").update(payload).digest("hex"),
  });
  assert.deepEqual(fs.readFileSync(destination), payload);
  assert.ok(
    ranges.some((offset) => offset > 0),
    "Transfer did not resume partial bytes",
  );
  fs.writeFileSync(`${destination}.part`, "old");
  fs.writeFileSync(
    `${destination}.part.json`,
    JSON.stringify({ url: `${base}/changed`, validator: '"old"', total: 3 }),
  );
  await api.downloadFile(`${base}/changed`, destination);
  assert.deepEqual(fs.readFileSync(destination), payload, "Changed remote file was appended to stale bytes");
  await assert.rejects(api.downloadFile(`${base}/missing`, destination));
  assert.deepEqual(fs.readFileSync(destination), payload, "Failure replaced an existing model");
  await assert.rejects(api.downloadFile(`${base}/good`, destination, { sha256: "0".repeat(64) }));
  assert.deepEqual(fs.readFileSync(destination), payload, "Bad checksum replaced an existing model");
  const abort = new AbortController();
  const pending = api.downloadFile(`${base}/abort`, path.join(temporary, "aborted.pth"), {
    signal: abort.signal,
  });
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(pending);
  assert.equal(fs.existsSync(path.join(temporary, "aborted.pth")), false);
  console.log(
    "Job persistence, cancellation, GPU admission, realtime priority, download resume/retry/checksum/cancellation passed.",
  );
} finally {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  // The bundle has an exit handler; flush before removing this temporary workspace.
  if (fs.existsSync(bundle)) {
    const api = require(bundle);
    await api.drainJobHistory();
    process.removeListener("exit", api.flushJobHistory);
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
