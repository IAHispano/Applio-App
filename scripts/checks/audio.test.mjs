import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(
  relative,
  require = () => {
    throw new Error("Unexpected import");
  },
  globals = {},
) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function("exports", "require", "document", "AudioContext", "IntersectionObserver", outputText)(exports, require, globals.document, globals.AudioContext, globals.IntersectionObserver);
  return exports;
}

test("Halloween music loops continuously and releases audio when disabled", () => {
  const ref = { current: null };
  const effects = [];
  const calls = [];
  const listeners = new Map();
  const source = { connect: () => gain, start: () => calls.push("start"), stop: () => calls.push("stop"), disconnect() {} };
  const gain = { gain: {}, connect() {}, disconnect() {} };
  const media = [];
  const document = { hidden: false, querySelectorAll: () => media, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event) };
  class Context {
    resume() { calls.push("resume"); return Promise.resolve(); }
    suspend() { calls.push("suspend"); return Promise.resolve(); }
    close() { calls.push("close"); return Promise.resolve(); }
    createBuffer(channels, length, rate) { assert.equal(channels, 1); assert.equal(length / rate, 24); const samples = new Float32Array(length); return { getChannelData: () => samples }; }
    createBufferSource() { return source; }
    createGain() { return gain; }
  }
  const { createHauntedLoop, useHauntedSound } = load("../../frontend/web/components/HalloweenEffects.tsx", () => ({ useRef: () => ref, useEffect: (fn) => effects.push(fn) }), { document, AudioContext: Context });
  const samples = createHauntedLoop(new Context()).getChannelData(0);
  assert.ok(samples.some((sample) => Math.abs(sample) > 0.01));
  assert.ok(Math.abs(samples[0] - samples.at(-1)) < 0.002, "loop seam must not click");
  assert.ok(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.25));
  const unlock = useHauntedSound(false, false);
  assert.equal(unlock(), true);
  effects.length = 0;
  useHauntedSound(true, false);
  const cleanup = effects[0]();
  assert.equal(source.loop, true);
  assert.ok(calls.includes("start"));
  document.hidden = true; listeners.get("visibilitychange")(); assert.equal(calls.at(-1), "suspend");
  document.hidden = false; listeners.get("visibilitychange")(); assert.equal(calls.at(-1), "resume");
  media.push({ paused: false, ended: false, muted: false }); listeners.get("play")(); assert.equal(calls.at(-1), "suspend");
  cleanup(); assert.ok(calls.includes("stop")); assert.equal(calls.at(-1), "close"); assert.equal(listeners.size, 0);
});

test("microphone gain stays manual with Voice Focus on or off", () => {
  const { realtimeMicrophoneConstraints } = load("../../frontend/web/lib/voice-focus.ts");
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
    const { connectVoiceFocus } = load("../../frontend/web/lib/voice-focus.ts", () => ({
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
  const { INPUT_WORKLET } = load("../../frontend/web/lib/realtime-audio.ts");
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


test("waveform players defer native media offscreen and limit React updates without losing seeks or cleanup", () => {
  const states = [], refs = [], effectSlots = [];
  let cursor = 0, refCursor = 0, effectCursor = 0;
  let observer, disconnected = 0, destroyed = 0, creates = 0;
  let mediaTime = 0;
  const listeners = new Map();
  const timeUpdates = [];
  const react = {
    memo: (component) => component,
    useId: () => "preview",
    useCallback: (fn) => fn,
    useRef: (value) => {
      const index = refCursor++;
      return refs[index] ||= { current: index === 0 ? { querySelectorAll: () => [] } : value };
    },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => {
        states[index] = value;
        if (index === 3) timeUpdates.push(value);
      }];
    },
    useEffect: (fn, deps) => {
      const index = effectCursor++;
      const previous = effectSlots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        effectSlots[index] = { fn, deps, pending: true };
      }
    },
  };
  class Observer {
    constructor(callback, options) { this.callback = callback; observer = this; assert.equal(options.rootMargin, "200px"); }
    observe() {}
    disconnect() { disconnected++; }
  }
  const player = {
    on: (event, callback) => listeners.set(event, callback),
    getCurrentTime: () => mediaTime,
    setVolume() {}, setPlaybackRate() {},
    destroy: () => { destroyed++; listeners.clear(); },
  };
  const jsx = (type, props) => ({ type, props });
  const { default: Player } = load("../../frontend/web/components/AudioWavePlayerImpl.tsx", (id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "wavesurfer.js") return { default: { create: () => { creates++; return player; } } };
    if (id === "wavesurfer.js/plugins/hover") return { default: { create: () => ({}) } };
    if (id === "@/lib/i18n") return { useI18n: () => ({ t: (s) => s }) };
    if (id === "@/lib/setting-help") return { SETTING_HELP: {} };
    return {};
  }, { IntersectionObserver: Observer });
  const render = (src) => {
    cursor = refCursor = effectCursor = 0;
    Player({ src });
    for (const effect of effectSlots) if (effect.pending) {
      effect.pending = false;
      effect.cleanup = effect.fn();
    }
  };
  render("/outputs/input.flac");
  assert.equal(creates, 0, "offscreen players must not fetch/decode or construct a media pipeline");
  observer.callback([{ isIntersecting: false }]);
  render("/outputs/input.flac");
  assert.equal(creates, 0);
  observer.callback([{ isIntersecting: true }]);
  render("/outputs/input.flac");
  assert.equal(creates, 1);
  listeners.get("ready")(20);
  timeUpdates.length = 0;
  for (let frame = 1; frame <= 60; frame++) listeners.get("timeupdate")(frame / 60);
  assert.ok(timeUpdates.length >= 8 && timeUpdates.length <= 10, "React controls update at most 10 times a second while WaveSurfer owns its smooth cursor");
  listeners.get("seeking")(7.031);
  assert.equal(timeUpdates.at(-1), 7.031, "seeking stays precise");
  mediaTime = 7.048;
  listeners.get("pause")();
  assert.equal(timeUpdates.at(-1), mediaTime, "pause publishes the exact position");
  render("/outputs/another.flac");
  assert.equal(creates, 2);
  assert.equal(destroyed, 1, "source changes release the previous player");
  for (const effect of effectSlots) effect.cleanup?.();
  assert.equal(destroyed, 2);
  assert.ok(disconnected >= 2, "observer is released after visibility and on unmount");
});
