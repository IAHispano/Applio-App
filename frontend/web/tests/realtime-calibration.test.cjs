const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");
function source(name) {
  const filename = path.join(__dirname, "../lib", `${name}.ts`);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = new Module(filename, module);
  compiledModule.filename = filename;
  compiledModule._compile(code, filename);
  return compiledModule.exports;
}
const { CalibrationMeter, recommendCalibration, calibrationDelay } = source("realtime-calibration");
const { RealtimeSettingsSender } = source("realtime-settings");
const counters = { droppedBlocks: 2, underrunMs: 100, playbackDroppedMs: 25 };
function candidate(chunk, processing, after = counters, rms = 0.1) {
  const meter = new CalibrationMeter();
  meter.begin(counters);
  for (let i = 0; i < 20; i++) meter.reply(processing, processing + 5, rms);
  return meter.finish(chunk, after);
}
test("select the smallest stable buffer with real headroom, not the lowest average latency", () => {
  const results = [candidate(40, 38), candidate(80, 35), candidate(120, 45)];
  assert.equal(results[0].stable, false);
  assert.equal(recommendCalibration(results).chunkMs, 80);
});
test("silence, too few replies and nonfinite data cannot create a recommendation", () => {
  const silent = candidate(120, 2, counters, 0);
  assert.equal(silent.inconclusive, true);
  assert.equal(recommendCalibration([silent]), null);
  const meter = new CalibrationMeter();
  meter.begin(counters);
  meter.reply(NaN, 1, 0.2);
  meter.reply(1, 1, 0.2);
  assert.equal(meter.finish(100, counters).inconclusive, true);
  meter.begin(counters);
  for (let i = 0; i < 20; i++) meter.reply(1, 3, 0.1, false);
  assert.equal(
    meter.finish(100, counters).inconclusive,
    true,
    "VAD silence-gated replies must not benchmark the fast path",
  );
});
test("recent dropouts and playback gaps invalidate a candidate regardless of processing speed", () => {
  assert.equal(candidate(120, 10, { ...counters, droppedBlocks: 3 }).stable, false);
  assert.equal(candidate(120, 10, { ...counters, underrunMs: 160 }).stable, false);
  assert.equal(candidate(120, 10, { ...counters, playbackDroppedMs: 30 }).stable, false);
  assert.equal(candidate(120, 10).stable, true);
});
test("calibration waits for matching config acknowledgments and rejects busy settings", async () => {
  let message;
  const sender = new RealtimeSettingsSender(
    { suspend: async () => {}, start: () => {} },
    (json) => (message = JSON.parse(json)),
    () => {},
    () => {},
  );
  const apply = sender.apply({ block_frame: 3840, automatic_block_size: false });
  await Promise.resolve();
  await assert.rejects(sender.apply({ block_frame: 4800 }), /Wait/);
  sender.receive({ type: "config_applied", id: message.id + 1, block_frame: 3840 });
  assert.equal(sender.busy, true);
  sender.receive({ type: "config_applied", id: message.id, block_frame: 3840 });
  assert.equal(await apply, 3840);
  sender.dispose();
});
test("engine errors and session disposal reject pending calibration changes", async () => {
  let message;
  const sender = new RealtimeSettingsSender(
    { suspend: async () => {}, start: () => {} },
    (json) => (message = JSON.parse(json)),
    () => {},
    () => {},
  );
  const failed = sender.apply({ block_frame: 3840 });
  await Promise.resolve();
  sender.receive({ type: "config_error", id: message.id, message: "allocation failed" });
  await assert.rejects(failed, /allocation failed/);
  const closed = sender.apply({ block_frame: 4800 });
  sender.dispose();
  await assert.rejects(closed, /closed/);
});
test("cancelling a measurement releases its timer immediately", async () => {
  const controller = new AbortController();
  const wait = calibrationDelay(60000, controller.signal);
  controller.abort();
  await assert.rejects(wait, /cancelled/);
});
