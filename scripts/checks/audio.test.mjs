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
  new Function("exports", "require", "document", "AudioContext", "IntersectionObserver", "Audio", outputText)(exports, require, globals.document, globals.AudioContext, globals.IntersectionObserver, globals.Audio);
  return exports;
}

test("realtime uses the default output when enumeration exposes no concrete outputs", async () => {
  const path = new URL("../../frontend/web/components/RealtimeWorkspace.tsx", import.meta.url);
  const source = fs.readFileSync(path, "utf8");
  const tree = ts.createSourceFile("RealtimeWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = [];
  let outputExpression;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && ["dedupeDevices", "enumDevices"].includes(node.name?.text)) functions.push(node.getText(tree));
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "outDev") outputExpression = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(functions.length, 2);
  const compiled = ts.transpileModule(functions.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { DEFAULT_REALTIME_OUTPUT } = load("../../frontend/web/lib/realtime-output.ts");
  let reported = [{ kind: "audioinput", deviceId: "mic", label: "Microphone" }];
  let inputs, outputs, selectedInput = "mic", selectedOutput = "saved-cable", stopped = 0, permissionDenied = false;
  const messages = [];
  const navigator = { mediaDevices: {
    getUserMedia: async () => {
      if (permissionDenied) throw new Error("denied");
      return { getTracks: () => [{ stop: () => stopped++ }] };
    },
    enumerateDevices: async () => reported,
  } };
  const enumerate = new Function("navigator", "setInputs", "setOutputs", "setInDev", "setOutDev", "setMsg", "t", "DEFAULT_REALTIME_OUTPUT", `${compiled};return enumDevices;`)(
    navigator, (value) => inputs = value, (value) => outputs = value,
    (update) => selectedInput = update(selectedInput), (update) => selectedOutput = update(selectedOutput),
    (message) => messages.push(message), (value) => value, DEFAULT_REALTIME_OUTPUT,
  );
  await enumerate();
  assert.equal(stopped, 1, "permission-probe microphone tracks are released");
  assert.deepEqual(inputs, [{ id: "mic", label: "Microphone" }]);
  assert.deepEqual(outputs, [{ id: DEFAULT_REALTIME_OUTPUT, label: "Default" }]);
  assert.equal(selectedInput, "mic");
  assert.equal(selectedOutput, DEFAULT_REALTIME_OUTPUT);
  const effectiveOutput = new Function("outputs", "selectedOutDev", "DEFAULT_REALTIME_OUTPUT", `return ${outputExpression};`);
  assert.equal(effectiveOutput(outputs, "late-saved-cable", DEFAULT_REALTIME_OUTPUT), DEFAULT_REALTIME_OUTPUT, "late settings restoration cannot disable the fallback");
  reported.push({ kind: "audiooutput", deviceId: "default", label: "Default" });
  await enumerate();
  assert.equal(selectedOutput, DEFAULT_REALTIME_OUTPUT, "default-only enumeration still uses automatic playback");
  reported.push({ kind: "audiooutput", deviceId: "cable", label: "Virtual cable" });
  await enumerate();
  assert.deepEqual(outputs, [{ id: "cable", label: "Virtual cable" }]);
  assert.equal(selectedOutput, "", "a named output requires an explicit selection");
  selectedOutput = "cable";
  await enumerate();
  assert.equal(selectedOutput, "cable");
  assert.equal(effectiveOutput(outputs, "cable", DEFAULT_REALTIME_OUTPUT), "cable");
  permissionDenied = true;
  await enumerate();
  assert.equal(messages.length, 1, "permission failures are still reported");
});

test("default realtime playback does not require a selectable audio sink", async () => {
  const { connectRealtimeOutput, DEFAULT_REALTIME_OUTPUT } = load("../../frontend/web/lib/realtime-output.ts");
  const connections = [];
  const sinks = [];
  let resumed = 0;
  const source = { connect: (target) => connections.push(target) };
  const ctx = { destination: {}, resume: async () => resumed++ };
  assert.deepEqual(await connectRealtimeOutput(ctx, source, DEFAULT_REALTIME_OUTPUT), []);
  assert.deepEqual(connections, [ctx.destination]);
  assert.equal(resumed, 1);
  ctx.setSinkId = async (id) => sinks.push(id);
  await connectRealtimeOutput(ctx, source, "virtual-cable");
  await connectRealtimeOutput(ctx, source, DEFAULT_REALTIME_OUTPUT);
  assert.deepEqual(sinks, ["virtual-cable", ""], "switching back restores the system default sink");
  ctx.setSinkId = async () => { throw new Error("device disconnected"); };
  await assert.rejects(connectRealtimeOutput(ctx, source, "missing-cable"), /device disconnected/);
  assert.equal(connections.length, 3, "an explicit device failure must not redirect audio to speakers");
});

test("legacy realtime output failures release the temporary playback route", async () => {
  let paused = 0, stopped = 0, disconnected = 0;
  const elements = [];
  class Audio {
    constructor() { elements.push(this); }
    async setSinkId() { throw new Error("device unavailable"); }
    pause() { paused++; }
  }
  const { connectRealtimeOutput } = load("../../frontend/web/lib/realtime-output.ts", undefined, { Audio });
  const destination = { stream: { getTracks: () => [{ stop: () => stopped++ }] } };
  const source = { connect() {}, disconnect: (node) => { assert.equal(node, destination); disconnected++; } };
  const ctx = { createMediaStreamDestination: () => destination };
  await assert.rejects(connectRealtimeOutput(ctx, source, "cable"), /device unavailable/);
  assert.equal(paused, 1);
  assert.equal(stopped, 1);
  assert.equal(disconnected, 1);
  assert.equal(elements[0].srcObject, null);
});

test("Halloween music plays the score and releases audio when disabled", () => {
  const ref = { current: null };
  const effects = [];
  const calls = [];
  const listeners = new Map();
  const media = [];
  const document = { hidden: false, querySelectorAll: () => media, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event) };
  const node = () => ({
    type: "sine",
    frequency: { value: 0 },
    detune: { value: 0 },
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    threshold: { value: 0 },
    ratio: { value: 0 },
    Q: { value: 0 },
    buffer: null,
    connect() {
      return this;
    },
    disconnect() {},
    start(time) {
      calls.push({ start: true, hz: Math.round(this.frequency.value), time });
    },
    stop() {
      calls.push("stop");
    },
  });
  class Context {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = {};
    }
    resume() { calls.push("resume"); return Promise.resolve(); }
    suspend() { calls.push("suspend"); return Promise.resolve(); }
    close() { calls.push("close"); return Promise.resolve(); }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBufferSource() { return node(); }
    createBiquadFilter() { return node(); }
    createConvolver() { return node(); }
    createDynamicsCompressor() { return node(); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  }
  const { useHauntedSound } = load(
    "../../frontend/web/components/HalloweenEffects.tsx",
    (id) => {
      if (id === "@/lib/haunted-score") {
        return load("../../frontend/web/lib/haunted-score.ts");
      }
      if (id === "react") {
        return { useRef: () => ref, useEffect: (fn) => effects.push(fn) };
      }
      return {};
    },
    { document, AudioContext: Context },
  );
  const unlock = useHauntedSound(false, false);
  assert.equal(unlock(), true);
  effects.length = 0;
  useHauntedSound(true, false);
  const cleanup = effects[0]();
  // The score is scheduled ahead of the clock, so the first notes are queued.
  assert.ok(calls.some((call) => call.start), "expected the score to start playing");
  assert.ok(calls.every((call) => typeof call === "string" || Number.isFinite(call.hz)));
  document.hidden = true; listeners.get("visibilitychange")(); assert.equal(calls.at(-1), "suspend");
  document.hidden = false; listeners.get("visibilitychange")(); assert.equal(calls.at(-1), "resume");
  media.push({ paused: false, ended: false, muted: false }); listeners.get("play")(); assert.equal(calls.at(-1), "suspend");
  cleanup(); assert.ok(calls.includes("close")); assert.equal(listeners.size, 0);
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
