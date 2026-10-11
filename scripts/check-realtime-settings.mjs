import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-live-settings-"));
const wait = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const bundle = path.join(temporary, "settings.cjs");
  await require("esbuild").build({
    stdin: {
      contents: 'export * from "./realtime-settings"; export * from "./realtime-audio"; export * from "./realtime-output";',
      resolveDir: path.join(root, "frontend/web/lib"),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
  });
  const { RealtimeSettingsSender, RealtimeAudioSender, connectRealtimeOutput } = require(bundle);
  const sent = [];
  const resized = [];
  const statuses = [];
  const audio = new RealtimeAudioSender((chunk) => sent.push(chunk));
  const settings = new RealtimeSettingsSender(
    audio,
    (message) => sent.push(JSON.parse(message)),
    (block) => resized.push(block),
    (...status) => statuses.push(status),
  );
  audio.start();
  audio.capture(new Float32Array(4800));
  audio.capture(new Float32Array(4800));
  settings.update("f0_up_key", 2);
  settings.update("f0_up_key", 0);
  settings.update("autotune", false);
  settings.update("index_path", "");
  settings.update("reverb", false, true);
  await wait();
  assert.equal(sent.length, 1, "Configuration must wait for the last audio reply");
  audio.capture(new Float32Array(4800));
  audio.acknowledge();
  await wait(0);
  assert.deepEqual(sent[1], {
    type: "configure", id: 1,
    changes: { f0_up_key: 0, autotune: false, index_path: "" },
    kwargs: { reverb: false },
  });
  assert.equal(audio.queuedBlocks, 0, "Pre-update audio cannot resume as stale audio");
  settings.update("block_frame", 9600);
  await wait();
  assert.equal(sent.length, 2, "Updates must be serialized until acknowledged");
  settings.receive({ type: "config_applied", id: 99, block_frame: 4800 });
  assert.deepEqual(resized, [], "Stale acknowledgements cannot resume capture");
  settings.receive({ type: "config_applied", id: 1, block_frame: 4800 });
  await wait(0);
  assert.equal(sent[2].id, 2);
  settings.receive({ type: "config_applied", id: 2, block_frame: 9600 });
  audio.capture(new Float32Array(9600));
  assert.equal(sent[3].length, 9600);
  audio.acknowledge();
  settings.update("model_path", "missing.pth");
  await wait();
  settings.receive({ type: "config_error", id: 3, message: "Model missing" });
  assert.equal(statuses.at(-1)[1], "Model missing");
  audio.capture(new Float32Array(9600));
  assert.equal(sent.at(-1).length, 9600, "Rejected settings leave capture working");
  audio.acknowledge();
  settings.update("block_frame", 4800);
  await wait();
  settings.receive({ type: "config_applied", id: 4, block_frame: 481 });
  assert.equal(statuses.at(-1)[2], true, "Invalid geometry must stop capture safely");
  const length = sent.length;
  settings.update("input_audio_gain", 100);
  await wait();
  assert.equal(sent.length, length, "Disposed sessions cannot send new settings");
  const sinks = [];
  const destination = {};
  const connections = [];
  const context = {
    destination,
    async setSinkId(id) { sinks.push(id); },
    async resume() {},
  };
  const source = { connect(node) { connections.push(node); }, disconnect() {} };
  await connectRealtimeOutput(context, source, "virtual-cable");
  await connectRealtimeOutput(context, source, "");
  assert.deepEqual(sinks, ["virtual-cable", ""], "Default device must explicitly restore the sink");
  assert.deepEqual(connections, [destination, destination]);
  let paused = false;
  let stopped = false;
  let disconnected = false;
  const track = { stop() { stopped = true; } };
  const fallback = { stream: { getTracks: () => [track] } };
  globalThis.Audio = class {
    async setSinkId() { throw new Error("Device unavailable"); }
    pause() { paused = true; }
  };
  await assert.rejects(connectRealtimeOutput(
    { createMediaStreamDestination: () => fallback },
    { connect() {}, disconnect(node) { disconnected = node === fallback; } },
    "removed-device",
  ), /Device unavailable/);
  assert.ok(paused && stopped && disconnected, "Failed output setup must release the replacement route");
  console.log("Live settings: audio ordering, coalescing, acknowledgements, resizing and recovery passed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
