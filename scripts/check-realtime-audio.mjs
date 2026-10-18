import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(
  relative,
  require = () => {
    throw new Error("Unexpected import");
  },
) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  new Function("exports", "require", outputText)(exports, require);
  return exports;
}

test("microphone gain stays manual with Voice Focus on or off", () => {
  const { realtimeMicrophoneConstraints } = load("../frontend/web/lib/voice-focus.ts");
  for (const variant of ["off", "c20", "c50", "c100"]) {
    const constraints = realtimeMicrophoneConstraints("microphone", variant);
    assert.equal(constraints.autoGainControl, false);
    assert.equal(constraints.noiseSuppression, variant === "off");
    assert.equal(constraints.echoCancellation, variant === "off");
    assert.deepEqual(constraints.deviceId, { exact: "microphone" });
  }
});

test("Voice Focus resumes the context before initializing and cleans up each variant", async () => {
  for (const variant of ["c20", "c50", "c100"]) {
    const calls = [];
    const start = {};
    const end = { connect: () => calls.push("output"), disconnect: () => calls.push("disconnect") };
    const transformer = {
      isSupported: () => true,
      createTransformDevice: async () => ({
        createAudioNode: async () => ({ start, end }),
        stop: async () => calls.push("stop"),
      }),
    };
    const Transformer = {
      create: async (spec) => {
        assert.equal(spec.variant, variant);
        calls.push("create");
        return transformer;
      },
      destroyVoiceFocus: async () => calls.push("destroy"),
    };
    const { connectVoiceFocus } = load("../frontend/web/lib/voice-focus.ts", () => ({
      default: Transformer,
    }));
    const cleanup = await connectVoiceFocus(
      { resume: async () => calls.push("resume") },
      {
        connect: (node) => {
          assert.equal(node, start);
          calls.push("input");
        },
      },
      {},
      {},
      variant,
    );
    assert.deepEqual(calls, ["resume", "create", "input", "output"]);
    await cleanup();
    await cleanup();
    assert.deepEqual(calls.slice(4), ["disconnect", "stop", "destroy"]);
  }
});

test("capture worklet transmits samples while leaving its connected output silent", () => {
  const { INPUT_WORKLET } = load("../frontend/web/lib/realtime-audio.ts");
  const messages = [];
  let Processor;
  class AudioWorkletProcessor {
    port = { postMessage: (message) => messages.push(message) };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", INPUT_WORKLET)(
    AudioWorkletProcessor,
    (_, implementation) => {
      Processor = implementation;
    },
  );
  const processor = new Processor();
  processor.port.onmessage({ data: { block_frame: 128 } });
  const microphone = Float32Array.from({ length: 128 }, (_, i) => i / 128);
  const output = new Float32Array(128);
  assert.equal(processor.process([[microphone]], [[output]]), true);
  assert.deepEqual(messages[0].chunk, microphone);
  assert.ok(
    output.every((sample) => sample === 0),
    "Capture must never play raw microphone audio",
  );
});
