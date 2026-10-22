import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

function restart(fetch, now = () => 0) {
  const source = fs.readFileSync(new URL("../../frontend/web/lib/settings-actions.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function("exports", "fetch", "Date", "AbortSignal", "setTimeout", outputText)(
    exports,
    fetch,
    { now },
    { timeout: () => undefined },
    (callback) => {
      callback();
    },
  );
  return exports.restartApiAndWait;
}

const json = (body, ok = true) => ({ ok, json: async () => body });

test("existing Halloween theme files activate scenery and switching themes clears it", () => {
  const source = fs.readFileSync(new URL("../../frontend/web/lib/theme.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const root = { dataset: {}, style: { removeProperty() {}, setProperty() {} } };
  const document = { documentElement: root, body: { style: {} }, getElementById: () => null };
  const exports = {};
  new Function("exports", "require", "document", outputText)(exports, () => ({}), document);
  exports.applyTheme({ name: "Halloween" }, "halloween.json");
  assert.equal(root.dataset.themeEffects, "halloween");
  exports.applyTheme({ name: "Default" });
  assert.equal(root.dataset.themeEffects, "");
  exports.applyTheme({ effects: "halloween" });
  assert.equal(root.dataset.themeEffects, "halloween");
});

test("the Halloween ambience plays the whole score instead of one repeated note", (t) => {
  const options = { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 };
  const score = ts.transpileModule(
    fs.readFileSync(new URL("../../frontend/web/lib/haunted-score.ts", import.meta.url), "utf8"),
    { compilerOptions: options },
  );
  const scoreExports = {};
  new Function("exports", "require", score.outputText)(scoreExports, () => ({}));
  const component = ts.transpileModule(
    fs.readFileSync(new URL("../../frontend/web/components/HalloweenEffects.tsx", import.meta.url), "utf8"),
    { compilerOptions: options },
  );

  const started = [];
  const node = () => ({
    type: "sine",
    frequency: { value: 0 },
    detune: { value: 0 },
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    threshold: { value: 0 },
    ratio: { value: 0 },
    Q: { value: 0 },
    buffer: null,
    loop: false,
    connect() {
      return this;
    },
    disconnect() {},
    start(time) {
      started.push({ hz: Math.round(this.frequency.value), time });
    },
    stop() {},
  });
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    createGain: node,
    createOscillator: node,
    createBufferSource: node,
    createBiquadFilter: node,
    createConvolver: node,
    createDynamicsCompressor: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(1024) }),
  };

  t.mock.timers.enable({ apis: ["setInterval"] });
  const exports = {};
  new Function("exports", "require", "document", component.outputText)(exports, (id) => {
    if (id === "@/lib/haunted-score") return scoreExports;
    return {};
  }, { documentElement: { dataset: {} }, body: { style: {} } });
  exports.startAmbience(context);
  for (let step = 0; step < 300; step++) {
    context.currentTime = step * 0.1;
    t.mock.timers.tick(80);
  }
  t.mock.timers.reset();

  // A broken queue replays the opening chord over and over; a working one
  // walks through the melody, the bass line and the pad. The melody is the
  // opening of "In the Hall of the Mountain King": B, C#, D, E, F#.
  const pitches = new Set(started.map((note) => note.hz));
  assert.ok(started.length > 40, `expected a busy score, got ${started.length} notes`);
  for (const theme of [123, 139, 147, 165, 185]) {
    assert.ok(pitches.has(theme), `expected the melody to reach ${theme} Hz`);
  }
});

// The API answers validation failures with a structured body; the client must
// flatten it into a readable message instead of "[object Object]".
function apiClient(fetch) {
  const source = fs.readFileSync(new URL("../../frontend/web/lib/api.ts", import.meta.url), "utf8");
  // A modern target keeps `for (const key of map.keys())` intact; the ES5
  // downlevel rewrites it to array indexing, which never iterates a Map.
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function("exports", "require", "fetch", "setTimeout", "URL", outputText)(
    exports,
    () => ({}),
    fetch,
    setTimeout,
    URL,
  );
  return exports;
}

test("restart waits for a different API generation and tolerates reconnects", async () => {  let calls = 0;
  await restart(async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, "/api/settings/restart");
      assert.equal(options.method, "POST");
      return json({ instanceId: "old" });
    }
    assert.equal(url, "/api/health");
    assert.equal(options.cache, "no-store");
    if (calls === 2) return json({ ok: true, instanceId: "old" });
    if (calls === 3) throw new Error("Connection closed");
    return json({ ok: true, instanceId: "new" });
  })();
  assert.equal(calls, 4);
});

test("restart surfaces rejected requests and never reports the old generation as success", async () => {
  await assert.rejects(restart(async () => json({ error: "Restart denied" }, false))(), /Restart denied/);

  let time = 0;
  await assert.rejects(
    restart(
      async () => json({ ok: true, instanceId: "old" }),
      () => {
        time += 10000;
        return time;
      },
    )(),
    /timed out/,
  );
});

test("API validation errors keep their per-field messages", async () => {
  const body = {
    error: "Invalid params",
    details: {
      formErrors: [],
      fieldErrors: {
        indexRate: ["Number must be less than or equal to 1"],
        pitch: ["Expected number"],
        pthPath: ["Required"],
      },
    },
  };
  const { apiSend, errMsg } = apiClient(async () => ({
    ok: false,
    status: 400,
    json: async () => body,
  }));
  await assert.rejects(apiSend("/api/inference", "POST", {}), (error) => {
    const message = errMsg(error);
    assert.ok(!message.includes("[object Object]"), `message was not flattened: ${message}`);
    assert.match(message, /indexRate: Number must be less than or equal to 1/);
    assert.match(message, /pitch: Expected number/);
    assert.match(message, /pthPath: Required/);
    return true;
  });
});

test("the training schema advertises only the sample rates the route accepts", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      new URL("../../backend/rust-api/src/training/training-schema.json", import.meta.url),
      "utf8",
    ),
  );
  const route = fs.readFileSync(
    new URL("../../backend/rust-api/src/routes/training_routes.rs", import.meta.url),
    "utf8",
  );
  // The route rejects anything outside these lists for training and pipelines.
  const training = [...route.matchAll(/&\["(\d+)", "(\d+)", "(\d+)"\]\[\.\.\]/g)].map((m) =>
    m.slice(1).map(Number),
  );
  assert.ok(training.length > 0, "the route must list the accepted sample rates");
  for (const list of training) {
    assert.deepEqual(list, [32000, 40000, 48000]);
  }
  assert.match(route, /&\["24000", "32000"\]\[\.\.\]/);
  const pipeline = schema.pipeline.find((param) => param.name === "sampleRate");
  assert.deepEqual(pipeline.values, training[0].map(String));
  // Extracting features keeps the source rate, so it may still be 44100.
  const extract = schema.extract.find((param) => param.name === "sampleRate");
  assert.ok(extract.values.includes("44100"));
});

test("importing a custom UVR model drops the cached variant list", async () => {
  const calls = [];
  const { apiGet, apiSend } = apiClient(async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ variants: ["roformer"] }) };
  });
  await apiGet("/api/uvr/variants");
  await apiGet("/api/uvr/variants");
  assert.equal(calls.length, 1, "the second read must come from the cache");
  // "/api/uvr/custom-models" also contains "/models": the write has to clear
  // the UVR cache, not the voice-model one.
  await apiSend("/api/uvr/custom-models", "POST", {});
  await apiGet("/api/uvr/variants");
  assert.equal(calls.length, 3, "the variant list must be fetched again after the import");
  assert.ok(!calls.includes("/api/models"), "the voice model list must not be refetched");
});

test("desktop quit is permitted and returns native invocation failures to Settings", async () => {
  const permissions = fs.readFileSync(
    new URL("../../frontend/desktop/src-tauri/permissions/native.toml", import.meta.url),
    "utf8",
  );
  const allowed = JSON.parse(permissions.match(/commands\.allow = (\[[^\]]+\])/)[1]);
  assert.ok(allowed.includes("quit_app"));
  const source = fs.readFileSync(
    new URL("../../frontend/desktop/src-tauri/src/bridge.js", import.meta.url),
    "utf8",
  );
  let failure = false;
  const window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "quit_app");
          assert.ok(allowed.includes(command));
          if (failure) throw new Error("Native quit failed");
        },
      },
    },
  };
  new Function("window", "location", "document", "__APPLIO_PLATFORM__", source)(
    window,
    { origin: "http://127.0.0.1:3000" },
    { addEventListener: () => {} },
    "darwin",
  );
  const pending = window.applio.quit();
  assert.ok(pending instanceof Promise);
  await pending;
  failure = true;
  await assert.rejects(window.applio.quit(), /Native quit failed/);
});


test("the workflow API catalog explicitly accounts for native routes and produces valid Python examples", () => {
  const routes = new URL("../../backend/rust-api/src/routes/", import.meta.url);
  const catalog = JSON.parse(fs.readFileSync(new URL("../../assets/api-endpoints.json", import.meta.url), "utf8"));
  const documented = new Set(catalog.map((entry) => `${entry.method} ${entry.path}`));
  const actual = new Set();
  for (const filename of fs.readdirSync(routes).filter((name) => name.endsWith(".rs") && !name.startsWith("integration_"))) {
    const source = fs.readFileSync(new URL(filename, routes), "utf8").split("#[cfg(test)]")[0];
    for (const match of source.matchAll(/\.route\(\s*"(\/api[^"\n]+)"\s*,/g)) {
      let depth = 1, cursor = match.index + match[0].length;
      const begin = cursor;
      while (depth && cursor < source.length) {
        if (source[cursor] === "(") depth++;
        if (source[cursor] === ")") depth--;
        cursor++;
      }
      for (const method of source.slice(begin, cursor).matchAll(/\b(get|post|put|delete)\(/g))
        actual.add(`${method[1].toUpperCase()} /v1/applio${match[1].slice(4)}`);
    }
  }
  // Model import and custom architecture discovery remain on the native/Bridge
  // API; documenting local handlers must not grant new Bearer API capabilities.
  // Text-frontend training stays host-only; synthesis uses the existing TTS capability.
  const nativeOnly = new Set([
    "GET /v1/applio/uvr/variants",
    "POST /v1/applio/uvr/custom-models",
    "POST /v1/applio/train/text-rvc",
    "POST /v1/applio/tts/frontends",
  ]);
  for (const operation of nativeOnly) assert.ok(!documented.has(operation));
  assert.deepEqual([...new Set([...documented, ...nativeOnly])].sort(), [...actual].sort(), "new native routes need an explicit workflow capability or native-only decision");
  const source = fs.readFileSync(new URL("../../frontend/web/components/ApiReference.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  new Function("exports", "require", outputText)(exports, () => ({}));
  const examples = [];
  for (const entry of catalog) {
    const python = exports.pythonExample("http://127.0.0.1:3000", entry);
    const curl = exports.curlExample("http://127.0.0.1:3000", entry);
    assert.ok(curl.includes("Authorization: Bearer"));
    assert.ok(python.includes('os.environ["APPLIO_API_KEY"]'));
    assert.ok(!python.includes("{id}"), "replace route templates with explicit sample identifiers");
    if (entry.response === "job") {
      assert.ok(python.includes('job["status"] == "error"'));
      assert.ok(python.includes('/artifacts'));
    }
    examples.push(python);
  }
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-c", "import ast,json,sys; [ast.parse(source) for source in json.load(sys.stdin)]"], { input: JSON.stringify(examples), encoding: "utf8", windowsHide: true });
});


test("separator profiles submit schema-valid settings and preserve model, batch and export choices", async () => {
  const source = fs.readFileSync(new URL("../../frontend/web/app/audio-separator/page.tsx", import.meta.url), "utf8");
  const schema = JSON.parse(fs.readFileSync(new URL("../../backend/rust-api/src/routes/uvr-schema.json", import.meta.url), "utf8"));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const controls = {
    VR: ["vrWindow", "vrTta"],
    MDX: ["mdxOverlap", "mdxDenoise"],
    MDXC: ["mdxcOverlap"],
    DEMUCS: ["demucsOverlap", "demucsShifts"],
    ROFORMER: ["roformerOverlap", "roformerDenoise"],
  };
  for (const [arch, fields] of Object.entries(controls)) {
    const drafts = new Map(Object.entries({
      models: [{ filename: "chosen-model", type: arch, stems: ["Vocals", "Instrumental"] }],
      model: "chosen-model", inputPath: "song.wav", format: "FLAC", device: "cpu",
      vrBatch: 3, mdxBatch: 3, mdxcBatch: 3, roformerBatch: 3,
      mdxSegment: 512, mdxcSegment: 512, demucsSegment: "7", roformerChunk: "8",
    }).map(([key, value]) => [`page:audio-separator:${key}`, value]));
    let payload;
    const state = (key, initial) => {
      if (!drafts.has(key)) drafts.set(key, initial);
      return [drafts.get(key), (value) => drafts.set(key, typeof value === "function" ? value(drafts.get(key)) : value)];
    };
    const jsx = (type, props) => ({ type, props });
    const exports = {};
    new Function("exports", "require", outputText)(exports, (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return { useState: (value) => [value, () => {}], useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }), useEffect() {} };
      if (name === "@/lib/workspace-state") return { useWorkspaceState: state };
      if (name === "@/lib/useJob") return { usePersistentJobId: () => [null, () => {}], useJob: () => ({ job: null }) };
      if (name === "@/lib/i18n") return { useI18n: () => ({ t: (key) => key }) };
      if (name === "@/lib/setting-help") return { SETTING_HELP: {} };
      if (name === "@/lib/api") return { postForm: async (url, body) => { assert.equal(url, "/api/uvr/separate"); payload = body; return { jobId: "profile-job" }; } };
      return new Proxy({}, { get: (_, key) => key });
    });
    const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
    const render = () => nodes(exports.default());
    const profile = () => render().find((node) => node.props?.id === "uvr-profile").props;
    for (const index of ["0", "1", "2"]) {
      profile().onValueChange(index);
      assert.equal(profile().value, index, arch);
      await render().find((node) => node.props?.children === "Separate Stems").props.onClick();
      for (const name of fields) {
        const field = schema.find((field) => field.name === name);
        const value = field.type === "boolean" ? payload.get(name) === "true" : Number(payload.get(name));
        if (index === "1") assert.equal(value, field.default, `${arch} balanced default: ${name}`);
        if (typeof value === "number") assert.ok(value >= field.min && value <= field.max, `${arch}: ${name}`);
        if (field.integer) assert.equal(Number.isInteger(value), true, name);
      }
      assert.equal(payload.get("model"), "chosen-model");
      assert.equal(payload.get("outputFormat"), "FLAC");
      assert.equal(payload.get("device"), "cpu");
      for (const batch of ["vrBatch", "mdxBatch", "mdxcBatch", "roformerBatch"]) assert.equal(payload.get(batch), "3");
      assert.equal(payload.get("mdxSegment"), "512");
      assert.equal(payload.get("demucsSegment"), "7");
      assert.equal(payload.get("roformerChunk"), "8");
    }
    drafts.set(`page:audio-separator:${fields[0]}`, 123);
    assert.equal(profile().value, "-1", `${arch} custom settings`);
    render().find((node) => node.props?.children === "Reset defaults").props.onClick();
    assert.equal(profile().value, "1", `${arch} reset profile`);
  }
});


test("settings writes preserve order and recover after a rejected request", async () => {
  const source = fs.readFileSync(new URL("../../frontend/web/lib/settings-actions.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function("exports", outputText)(exports);
  const written = [];
  let release;
  const firstPending = new Promise((resolve) => { release = resolve; });
  const save = exports.createSettingsSaveQueue(async (patch) => {
    written.push(patch);
    if (written.length === 1) { await firstPending; throw new Error("Write failed"); }
    return patch;
  });
  const first = assert.rejects(save({ precision: "fp32" }), /Write failed/);
  const second = save({ precision: "fp16" });
  const third = save({ theme: { file: "midnight.json" } });
  await Promise.resolve();
  assert.deepEqual(written, [{ precision: "fp32" }]);
  release();
  await first;
  assert.deepEqual(await second, { precision: "fp16" });
  await third;
  assert.deepEqual(written, [{ precision: "fp32" }, { precision: "fp16" }, { theme: { file: "midnight.json" } }]);
});

test("Bridge management has a static host route and desktop notifications target it", () => {
  const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(read("backend/rust-api/src/runtime/web_host.rs"), /"\/bridge-mode"/);
  assert.match(read("frontend/web/components/layout/nav.ts"), /to: "\/bridge-mode"/);
  assert.match(read("frontend/web/lib/bridge-mode.tsx"), /REMOTE_HOST_ROUTES = new Set\(\[[\s\S]*?"\/bridge-mode"/);
  assert.match(read("frontend/web/app/bridge-mode/page.tsx"), /<BridgeModeCard/);
  assert.doesNotMatch(read("frontend/web/app/settings/page.tsx"), /BridgeModeCard/);
  assert.match(read("frontend/desktop/src-tauri/src/runtime.rs"), /extra\("href", "\/bridge-mode"\)/);
  assert.match(read("frontend/desktop/src-tauri/src/main.rs"), /href == "\/bridge-mode"/);
  const key = "{name} is requesting access. Check code {code} in Bridge Mode.";
  for (const file of fs.readdirSync(new URL("../../assets/i18n/languages/", import.meta.url))) {
    const dict = JSON.parse(read(`assets/i18n/languages/${file}`));
    for (const label of ["Preferences", "Appearance", "Audio engine", "Storage", "Updates", "Application", "Settings sections", "Approve this device in Bridge Mode on your host. Check that the code matches:", "Open the desktop app to share this computer with your other devices.", key]) {
      assert.ok(dict[label], `${file}: ${label}`);
    }
    assert.deepEqual(dict[key].match(/\{\w+\}/g).sort(), ["{code}", "{name}"], file);
  }
});

test("Bridge browser fallback avoids polling and desktop polling stops when its page unmounts", async () => {
  const source = fs.readFileSync(new URL("../../frontend/web/components/BridgeModeCard.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  for (const native of [false, true]) {
    const states = [], effects = [], cleared = [];
    let cursor = 0, polls = 0, requests = 0;
    const jsx = (type, props) => ({ type, props });
    const exports = {};
    const bridge = { getStatus: async () => { requests++; return { status: "stopped", devices: [] }; } };
    new Function("exports", "require", "setInterval", "clearInterval", outputText)(exports, (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        useState: (initial) => {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (value) => { states[index] = value; }];
        },
        useRef: () => ({ current: null }), useEffect: (effect) => effects.push(effect),
      };
      if (name === "@/lib/i18n") return { useI18n: () => ({ t: (key) => key }) };
      if (name === "@/lib/bridge-mode") return { desktopBridgeMode: () => native ? bridge : undefined };
      return new Proxy({}, { get: (_, key) => key });
    }, () => { polls++; return 42; }, (id) => cleared.push(id));
    exports.default();
    const dispose = effects[0]();
    await Promise.resolve();
    cursor = 0;
    const tree = exports.default();
    if (native) {
      assert.equal(requests, 1);
      assert.equal(polls, 1);
      dispose();
      assert.deepEqual(cleared, [42]);
    } else {
      assert.equal(tree.props.children.props.description, "Open the desktop app to share this computer with your other devices.");
      assert.equal(requests, 0);
      assert.equal(polls, 0);
      assert.equal(dispose, undefined);
    }
  }
});


test("Settings ignores superseded save responses and keeps an unsaved author draft", async () => {
  const source = fs.readFileSync(new URL("../../frontend/web/app/settings/page.tsx", import.meta.url), "utf8");
  const actions = fs.readFileSync(new URL("../../frontend/web/lib/settings-actions.ts", import.meta.url), "utf8");
  const actionExports = {};
  new Function("exports", ts.transpileModule(actions, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(actionExports);
  const config = { model_index_filter: true, precision: "fp16", model_author: "Saved author", version: "1.0.3" };
  const drafts = new Map([["page:settings:cfg", config]]), hooks = [];
  let cursor = 0;
  const workspace = (key, initial) => {
    if (!drafts.has(key)) drafts.set(key, initial);
    return [drafts.get(key), (value) => drafts.set(key, typeof value === "function" ? value(drafts.get(key)) : value)];
  };
  const pending = [];
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  new Function("exports", "require", "setTimeout", outputText)(exports, (name) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useEffect() {}, useCallback: (fn) => fn,
      useState: (initial) => {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
      },
      useMemo: (fn) => { const index = cursor++; return hooks[index] ??= fn(); },
      useRef: (initial) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    };
    if (name === "@/lib/workspace-state") return { useWorkspaceState: workspace };
    if (name === "@/lib/i18n") return { useI18n: () => ({ t: (key) => key }) };
    if (name === "@/lib/api") return { displayVersion: (value) => value, apiSend: (url, method, patch) => new Promise((resolve) => pending.push({ url, method, patch, resolve })) };
    if (name === "@/lib/settings-actions") return actionExports;
    if (name === "@/lib/setting-help") return { SETTING_HELP: {} };
    if (name === "@/lib/update-policy") return { desktopUpdater: () => null };
    return new Proxy({}, { get: (_, key) => key });
  }, () => 0);
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => { cursor = 0; return nodes(exports.default()); };
  const control = (id) => render().find((node) => node.props?.id === id).props;
  const select = (section) => render().find((node) => node.type === "SegmentedControl").props.onChange(section);
  select("settings-audio");
  control("settings-model-author").onChange({ target: { value: "Draft author" } });
  select("settings-general");
  control("settings-filter-checkbox").onChange(false);
  await Promise.resolve();
  control("settings-filter-checkbox").onChange(true);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].patch, { model_index_filter: false });
  pending[0].resolve({ config: { ...config, model_index_filter: false } });
  await new Promise(setImmediate);
  assert.equal(drafts.get("page:settings:cfg").model_index_filter, true, "an older response cannot replace the newer choice");
  assert.equal(pending.length, 2);
  assert.equal(pending[1].url, "/api/settings");
  assert.equal(pending[1].method, "PUT");
  assert.deepEqual(pending[1].patch, { model_index_filter: true });
  pending[1].resolve({ config });
  await new Promise(setImmediate);
  select("settings-audio");
  assert.equal(control("settings-model-author").value, "Draft author");
  assert.equal(render().filter((node) => node.props?.role === "tabpanel" && !node.props.hidden).length, 1);
});


test("separator inference phases wrap measured passes and leave failures as failures", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import ast, contextlib, io, sys, types
from pathlib import Path
from unittest.mock import patch

paths = [Path("uvr") / (name + ".py") for name in ["base", "vr", "mdx", "mdxc", "roformer", "demucs"]]
for path in paths:
    ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
base = ast.parse(paths[0].read_text(encoding="utf-8"))
original = next(node for node in base.body if isinstance(node, ast.ClassDef) and node.name == "BaseSeparator")
methods = [node for node in original.body if isinstance(node, ast.FunctionDef) and node.name in {"report_stage", "inference_progress"}]
module = ast.Module(body=[ast.ClassDef(name="ProgressProbe", bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])
namespace = {"contextmanager": contextlib.contextmanager, "sys": sys}
exec(compile(ast.fix_missing_locations(module), "uvr/base.py", "exec"), namespace)
probe = namespace["ProgressProbe"]()
closed = []
class Progress:
    def __init__(self, values=None, **kwargs): self.values = values
    def __enter__(self): return self
    def __exit__(self, *args): closed.append(True)
    def __iter__(self): return iter(self.values)

stream = io.StringIO()
with patch.dict(sys.modules, {"tqdm": types.SimpleNamespace(tqdm=Progress)}), contextlib.redirect_stderr(stream):
    for _ in range(2):
        with probe.inference_progress(range(3), desc="Batches") as batches:
            assert list(batches) == [0, 1, 2]
    try:
        with probe.inference_progress(range(3)):
            raise RuntimeError("Inference failed")
    except RuntimeError as error:
        assert str(error) == "Inference failed"
    else:
        raise AssertionError("Inference failure was swallowed")
assert len(closed) == 3
assert stream.getvalue().splitlines() == [
    "APPLIO_STAGE:Separating…", "APPLIO_STAGE:Reconstructing audio…",
    "APPLIO_STAGE:Separating…", "APPLIO_STAGE:Reconstructing audio…",
    "APPLIO_STAGE:Separating…",
]
`], { encoding: "utf8", windowsHide: true });
});


test("conversion drafts and saved presets cannot reintroduce retired parameters", () => {
  const source = fs.readFileSync(new URL("../../frontend/web/lib/useConversionParameters.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const legacy = { splitAudio: true, pitch: 7, f0Autotune: true, f0AutotuneStrength: 0.6 };
  const exports = {};
  new Function("exports", "require", outputText)(exports, (name) => {
    if (name === "react") return { useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }) };
    if (name === "@/lib/workspace-state") return { useWorkspaceState: () => [legacy, () => {}] };
    if (name === "@/lib/model-presets") return {
      modelPresetKey: (scope, model) => `${scope}:${model}`,
      useModelPresets: () => ({ loaded: true, presets: { "conversion:voice.pth": legacy } }),
    };
    throw new Error(`Unexpected import: ${name}`);
  });
  assert.deepEqual(exports.conversionOverrides(legacy), { pitch: 7, f0Autotune: true, f0AutotuneStrength: 0.6 });
  for (const model of ["", "voice.pth"]) {
    const { values, setters } = exports.useConversionParameters(model);
    assert.equal(values.pitch, 7);
    assert.equal(values.f0Autotune, true);
    assert.equal(values.f0AutotuneStrength, 0.6);
    assert.ok(!("splitAudio" in values));
    assert.ok(!("splitAudio" in setters));
    assert.deepEqual(Object.keys(values), Object.keys(exports.CONVERSION_DEFAULTS));
  }
});

test("engine readiness rejects the obsolete TTS dependency before loading ML packages", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import re, sys, types
from pathlib import Path
from unittest.mock import patch

source = Path("backend/rust-api/src/execution/engine.rs").read_text(encoding="utf-8")
probe = re.search(r'const ENGINE_PROBE: &str = r#"(.*?)"#;', source, re.S).group(1)
torch = types.SimpleNamespace(__version__="2.11.0", cuda=types.SimpleNamespace(is_available=lambda: False))
drm = types.ModuleType("edge_tts.drm")
modules = {"edge_tts": types.ModuleType("edge_tts"), "edge_tts.drm": drm, "gtts": types.SimpleNamespace(gTTS=object()), "torch": torch, "uvicorn": types.ModuleType("uvicorn"), "librosa": types.ModuleType("librosa")}
with patch.dict(sys.modules, modules):
    try:
        exec(probe, {})
    except ImportError as error:
        assert "generate_sec_ms_gec_v2" in str(error)
    else:
        raise AssertionError("Obsolete TTS package passed readiness")
    drm.generate_sec_ms_gec_v2 = lambda: "v2-token"
    exec(probe, {})
`], { encoding: "utf8", windowsHide: true });
});

test("text-to-RVC trains without future leakage and decodes through a frozen RVC network", (t) => {
  const python = process.env.APPLIO_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const probe = spawnSync(python, ["-c", "import importlib.util; print(bool(importlib.util.find_spec('torch')))"], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0 || probe.stdout.trim() !== "True") {
    t.skip("Requires engine dependencies; set APPLIO_TEST_PYTHON to the engine interpreter");
    return;
  }
  execFileSync(python, ["-X", "utf8", "-c", String.raw`
import sys, tempfile
from pathlib import Path
import torch
sys.path.insert(0,str(Path("backend/applio").resolve()))
from rvc.lib.tools.text_rvc.model import TextFrontend, DurationFrontend, batch, loss, denormalize
from rvc.lib.tools.text_rvc.alignment import alignment_text, ctc_durations
from rvc.lib.tools.text_rvc.assessment import error_rate
from unittest.mock import patch
import types
from rvc.lib.tools.text_rvc.__main__ import decode_rvc
from rvc.lib.tools.text_rvc.data import digest
from rvc.lib.algorithm.synthesizers import Synthesizer

torch.set_num_threads(2)
torch.manual_seed(7)
model=TextFrontend(256,hidden=32,layers=1)
examples=[{"text":"Hello", "features":torch.randn(21,256), "f0":torch.full((21,),200.)}, {"text":"Test", "features":torch.randn(13,256), "f0":torch.zeros(13)}]
args=batch(examples,torch.zeros(256),torch.ones(256),4)
total,_=loss(model,*args)
total.backward()
assert torch.isfinite(total) and model.output_projection.weight.grad.abs().sum()>0
model.eval()
a,_=model(args[0],args[1])
changed=args[1].clone(); changed[:,2:]+=500
b,_=model(args[0],changed)
assert torch.allclose(a[:,:3],b[:,:3],atol=1e-6), "Future acoustic targets leaked"
generated=model.generate(args[0][:1])
features,f0,coarse=denormalize(generated,torch.zeros(256),torch.ones(256))
assert torch.isfinite(features).all() and coarse.min()>=1 and coarse.max()<=255

# Repeated CTC letters must pass through a blank and cover every target frame.
emission=torch.full((8,3),-9.)
emission[range(8),[0,1,1,0,2,0,2,0]]=0
timing=ctc_durations(emission,[1,2,2],16)
assert timing.tolist()==[8,4,4]
assert alignment_text('Hello, WORLD!')=='hello world'
assert error_rate('Hello, world!', 'hello there world')==(1,2)
assert error_rate('El niño volvió aquí.', 'el nino volvió aqui')==(2,4)
assert error_rate('Été, déjà!', 'E\u0301te\u0301 de\u0301ja\u0300')==(0,2)
assert error_rate('Привет мир', 'привет друг')==(1,2)
assert error_rate('مرحبا بالعالم', 'مرحبا')==(1,2)
duration_model=DurationFrontend(256,hidden=32,layers=1)
from rvc.lib.tools.text_rvc.model import prosody_loss
reference=torch.zeros(1,24,258)
steady=reference.clone().requires_grad_()
spoken=torch.ones(1,24,dtype=torch.bool)
phones=torch.tensor([[1,2,3,257,0]])
timing=torch.tensor([[8,8,8,0,0]])
log_timing=timing.float().log1p().requires_grad_()
contour,rhythm=prosody_loss(steady,reference,spoken,log_timing,phones,timing)
assert contour==0 and rhythm.abs()<1e-10
shaking=reference.clone(); shaking[:,::2,-2]=1; shaking.requires_grad_()
contour,rhythm=prosody_loss(shaking,reference,spoken,log_timing+.4,phones,timing)
assert contour>0 and rhythm>0
(contour+rhythm).backward()
assert shaking.grad.abs().sum()>0 and log_timing.grad.abs().sum()>0
assert prosody_loss(shaking,reference,torch.zeros_like(spoken),log_timing,phones,timing)[0]==0
aligned=[{"text":"hello", "features":torch.randn(24,256), "f0":torch.full((24,),200.), "durations":[4,4,4,4,8,0]}]
aligned_args=batch(aligned,torch.zeros(256),torch.ones(256),1)
total,_=loss(duration_model,*aligned_args); total.backward()
assert torch.isfinite(total) and duration_model.duration[-1].weight.grad.abs().sum()>0
duration_model.eval()
with torch.no_grad():
    first,_=duration_model(aligned_args[0],aligned_args[1],aligned_args[-1])
    other,_=duration_model(aligned_args[0],aligned_args[1]+500,aligned_args[-1])
assert torch.equal(first,other), "Acoustic targets influenced duration frontend predictions"
with torch.no_grad():
    duration_model.duration[-1].weight.zero_()
    duration_model.duration[-1].bias.fill_(1.6)
assert len(duration_model.generate(aligned_args[0]))==20
try: duration_model.generate(aligned_args[0],max_frames=4)
except ValueError: pass
else: raise AssertionError("Duration limit ignored")
from rvc.lib.tools.text_rvc.model import fit_phonetic_head
fit_phonetic_head(duration_model,aligned,torch.zeros(256),torch.ones(256),steps=2)
consumed=[]
def many_examples():
    for index in range(1025):
        assert index<1024, 'Phonetic fitting consumed an unbounded corpus'
        consumed.append(index)
        frames=256 if index==0 else 4
        yield dict(text='hello',features=torch.zeros(frames,256),tokens=[98,257],durations=[frames,0])
with patch.object(torch,'cat',wraps=torch.cat) as pools:
    fit_phonetic_head(duration_model,many_examples(),torch.zeros(256),torch.ones(256),steps=0)
    assert len(consumed)==1024 and max(len(item) for item in pools.call_args_list[0].args[0])==128
duration_model.zero_grad(set_to_none=True)
total,metrics=loss(duration_model,*aligned_args);total.backward()
assert metrics['phonetic_loss']>0 and duration_model.output_projection.weight.grad.abs().sum()>0
assert all(parameter.grad is None and not parameter.requires_grad for parameter in duration_model.phonetic_head.parameters())
import rvc.lib.tools.text_rvc.alignment as alignment
class Phonemizer:
    def phonemize(self, voice, text):
        self.voice=voice
        return [list('a i')]
with patch.dict(sys.modules, {'piper.phonemize_espeak':types.SimpleNamespace(EspeakPhonemizer=Phonemizer)}):
    with patch.object(alignment,'_phonemizer',Phonemizer()):
        vocabulary={'a':4,'i':5,'aɪ':6}
        assert alignment.phoneme_labels('hello',vocabulary)==[4,5], 'Phones merged across word boundaries'
        with patch.object(alignment._phonemizer,'phonemize',return_value=[list('a-i')]):
            assert alignment.phoneme_labels('des accents',vocabulary,'fr')==[4,5], 'French word-joining marker became a phoneme'
        with patch.object(alignment._phonemizer,'phonemize',return_value=[list('a'),list('ɪ')]):
            assert alignment.phoneme_labels('One. Two.',{'a':4,'ɪ':5,'aɪ':6})==[4,5], 'Phones merged across sentence boundaries'
        phone_model=DurationFrontend(256,hidden=32,layers=1,phoneme_vocabulary=vocabulary)
        assert phone_model.tokenize('hello')==[5,6,511]
        american=DurationFrontend(256,hidden=32,layers=1,phoneme_vocabulary=vocabulary,language='en-us')
        assert american.tokenize('glass')==[5,6,511] and alignment._phonemizer.voice=='en-us'
        assert american.config['language']=='en-us' and phone_model.language=='en'
        augmented=alignment.prosody_vocabulary(vocabulary)
        with patch.object(alignment._phonemizer,'phonemize',return_value=[list('ˈa i.')]):
            annotated,timing=alignment.annotate_durations('Hello world.',vocabulary,[3,7])
            assert sum(timing)==10 and [value for value in timing if value]==[3,7]
            assert annotated[0]==augmented['<stress>'] and augmented['<word>'] in annotated
            assert annotated[-1]==augmented['<sentence>']
            contextual=DurationFrontend(256,hidden=32,layers=1,phoneme_vocabulary=augmented)
            context_tokens=torch.tensor([contextual.tokenize('Hello world.')])
            assert contextual.acoustic_mask(context_tokens).sum()==2
            with torch.no_grad():
                contextual.duration[-1].weight.zero_();contextual.duration[-1].bias.fill_(1.6)
            assert len(contextual.generate(context_tokens))==8, 'Context-only annotations acquired acoustic frames'
        with patch.object(alignment._phonemizer,'phonemize',return_value=[list('jˈu')]):
            compound={'ju':4,'j':5,'u':6}
            annotated,timing=alignment.annotate_durations('you',compound,[10])
            assert annotated[-1]==4 and timing==[0,10], 'Stress split a compound acoustic phoneme'
        from rvc.lib.tools.text_rvc.model import transfer_frontend
        remapped=DurationFrontend(256,hidden=32,layers=1,phoneme_vocabulary={'a':9,'i':4,'o':5},language='fr')
        assert transfer_frontend(remapped,phone_model)==2
        assert torch.equal(remapped.embedding.weight[10],phone_model.embedding.weight[5])
        assert torch.equal(remapped.embedding.weight[5],phone_model.embedding.weight[6])
        assert remapped.language=='fr'
        spanish=DurationFrontend(256,hidden=32,layers=1,phoneme_vocabulary=vocabulary,language='es')
        assert spanish.tokenize('hola')==[5,6,511] and alignment._phonemizer.voice=='es'
        with torch.no_grad():
            spanish.duration[-1].weight.zero_()
            spanish.duration[-1].bias.fill_(-1)
        assert len(spanish.generate(torch.tensor([[5,6,511]])))==2, 'Inference silently dropped pronounced phonemes'
        with tempfile.TemporaryDirectory() as directory:
            from rvc.lib.tools.text_rvc.__main__ import _load
            checkpoint=Path(directory)/'spanish.pt'
            torch.save({'format':'applio-text-rvc-frontend-v1','config':spanish.config,'weights':spanish.state_dict()},checkpoint)
            restored,_=_load(checkpoint)
            assert restored.language=='es' and restored.tokenize('hola')==[5,6,511]
            assert alignment._phonemizer.voice=='es'
            import argparse,json
            from rvc.lib.tools.text_rvc.__main__ import train,validate_initial_frontend
            root=Path(directory)
            space={'feature_dim':256,'frame_hz':100}
            source={'format':'applio-text-rvc-frontend-v1','config':spanish.config,'weights':spanish.state_dict(),
                    'mean':torch.zeros(256),'scale':torch.ones(256),'feature_space':space,
                    'train_ids':['historic'],'validation_ids':[]}
            torch.save(source,checkpoint)
            validate_initial_frontend(checkpoint,32,1,256)
            try: validate_initial_frontend(checkpoint,128,1,256)
            except ValueError as error: assert 'hidden size' in str(error)
            else: raise AssertionError('Incompatible warm start passed training preflight')
            rows=[]
            for i in range(4):
                path=root/f'{i}.pt'
                torch.save({'features':torch.randn(16,256),'f0':torch.full((16,),200.)},path)
                rows.append({'id':f'p225_{i:03}','text':f'phrase {i}','split':'train' if i<3 else 'validation',
                             'frames':16,'features':path.name,'audio_sha256':str(i)*64,
                             'tokens':[5,6,511],'durations':[8,8,0]})
            manifest=root/'manifest.json'
            manifest.write_text(json.dumps({'format':'applio-text-rvc-data-v1','feature_space':space,'records':rows,
                                           'alignment':{'phoneme_vocabulary':vocabulary,'language':'es'},'corpus':'fixture','speaker':'fixture'}))
            args=argparse.Namespace(manifest=str(manifest),output=str(root/'trained'),seed=7,hidden=32,layers=1,
                initialize_from=str(checkpoint),reset_tokenizer=False,phonetic_loss=False,device='cpu',
                learning_rate=0.,steps=1,batch_size=2,validate_every=1)
            train(args)
            _,saved=_load(root/'trained/best.pt')
            assert saved['step']==0, 'Fine-tuning discarded a better initial checkpoint'
            assert 'historic' in saved['seen_ids'] and len(saved['seen_audio_sha256'])==3
            source['seen_audio_sha256']=[rows[-1]['audio_sha256']]
            torch.save(source,checkpoint)
            args.output=str(root/'rejected')
            try: train(args)
            except ValueError as error: assert 'validation recordings' in str(error)
            else: raise AssertionError('Warm-start validation audio leaked through renamed records')
        phonetic_examples=[dict(text='hello',tokens=[5,6,511],durations=[8,8,0],features=torch.randn(16,256),f0=torch.full((16,),200.))]
        total,_=loss(phone_model,*batch(phonetic_examples,torch.zeros(256),torch.ones(256),1))
        total.backward();assert torch.isfinite(total)

config=[5,8,8,16,32,2,1,3,0.,"1",[3],[[1,3,5]],[10,6,2,2],64,[20,12,4,4],1,8,24000]
decoder=Synthesizer(*config,use_f0=True,text_enc_hidden_dim=768)
del decoder.enc_q
with tempfile.TemporaryDirectory() as directory:
    voice=Path(directory)/"fixture.pth"
    torch.save({"config":config,"weight":decoder.state_dict(),"version":"v2","f0":1},voice)
    acoustic={"features":torch.randn(16,768),"f0":torch.full((16,),200.),"coarse_f0":torch.full((16,),100,dtype=torch.long),"feature_space":{"frame_hz":100}}
    before=digest(voice)
    audio,sr=decode_rvc(acoustic,voice)
    assert len(audio)==3840 and sr==24000 and digest(voice)==before
    import argparse, soundfile as sf
    import rvc.lib.tools.text_rvc.__main__ as text_engine
    args=argparse.Namespace(frontend=voice,rvc=voice,sid=0,device='cpu',rate=0,max_frames=3000,
                            text='First sentence. Second sentence.',output=Path(directory)/'long.wav')
    with patch.object(text_engine,'_load',return_value=(phone_model,{})), patch.object(text_engine,'predict',return_value=acoustic), patch.object(text_engine,'load_rvc',wraps=text_engine.load_rvc) as loads:
        text_engine.synthesize(args)
        assert loads.call_count==1, 'Long-text synthesis reloaded the voice for each sentence'
    assert sf.info(args.output).frames==2*3840+round(.22*24000)
    assert not sf.read(args.output)[0][3840:3840+round(.22*24000)].any()
    present=set(Path(directory).iterdir())
    with patch.object(text_engine,'_load',side_effect=ValueError('Invalid frontend')):
        try: text_engine.synthesize(args)
        except ValueError: pass
        else: raise AssertionError('Invalid frontend was accepted')
    assert set(Path(directory).iterdir())==present, 'Failed frontend loading left temporary audio'
    with tempfile.TemporaryDirectory(dir=directory) as work:
        args.temporary_directory=work
        args.output=Path(directory)/'interrupted.wav'
        predictions=[]
        def interrupted_prediction(*unused,**options):
            if predictions:
                assert len(list(Path(work).glob('*.wav')))==1, 'Partial audio escaped the job-owned directory'
                raise ValueError('Interrupted synthesis')
            predictions.append(True)
            return acoustic
        with patch.object(text_engine,'_load',return_value=(phone_model,{})), patch.object(text_engine,'predict',side_effect=interrupted_prediction):
            try: text_engine.synthesize(args)
            except ValueError: pass
            else: raise AssertionError('Interrupted synthesis succeeded')
        assert not args.output.exists() and not list(Path(work).iterdir())
    for sid,dimensions in [(1,768),(0,256)]:
        acoustic["features"]=torch.randn(16,dimensions)
        try: decode_rvc(acoustic,voice,sid)
        except ValueError: pass
        else: raise AssertionError("Incompatible speaker/features accepted")

# Combined training prepares once, aligns separately and consumes the same cache.
with tempfile.TemporaryDirectory() as directory:
    import argparse,json
    import rvc.lib.tools.text_rvc.data as speech_data
    import rvc.lib.tools.text_rvc.__main__ as text_engine
    root=Path(directory); embedder=root/'embedder';embedder.mkdir()
    (embedder/'pytorch_model.bin').write_bytes(b'fixture');pitch=root/'rmvpe.pt';pitch.write_bytes(b'fixture')
    recordings=[]
    for i in range(4):
        audio=root/f'{i}.wav';audio.write_bytes(bytes([i])*16)
        recordings.append(dict(id=f'p225_{i:03}',text=f'phrase {i}',audio=str(audio),audio_sha256=digest(audio),
                               split='train' if i<3 else 'validation',frames=4))
    args=argparse.Namespace(output=str(root/'tts'),vctk_root=str(root),speaker='p225',language='en',rvc='',
        embedder=str(embedder),rmvpe=str(pitch),recognizer=str(root/'recognizer'),initialize_from=None,
        hidden=32,layers=1,device='cpu',prepare_only=True,aligned_manifest=None)
    prepared=root/'tts/prepared'
    def prepared_audio(*unused,**options):
        prepared.mkdir(parents=True)
        (prepared/'manifest.json').write_text(json.dumps(dict(format='applio-text-rvc-data-v1',
            feature_space={'version':'v2'},records=recordings,alignment={'language':'en'})))
    with patch.object(speech_data,'validate_speech',return_value=recordings), patch.object(speech_data,'prepare',side_effect=prepared_audio) as preparation, patch.object(alignment,'align') as aligner, patch('huggingface_hub.snapshot_download') as download, patch.object(text_engine,'validate_initial_frontend'), patch.object(text_engine,'train') as trainer, patch.object(text_engine,'calibrate') as calibration:
        text_engine.fit(args)
        assert preparation.call_count==1 and not aligner.called and not trainer.called and not calibration.called
        aligned=prepared/'phonemes.json';aligned.write_text((prepared/'manifest.json').read_text())
        args.prepare_only=False;args.aligned_manifest=str(aligned)
        text_engine.fit(args)
        assert preparation.call_count==1 and download.call_count==1 and not aligner.called
        assert trainer.call_args.args[0].manifest==str(aligned) and calibration.call_count==1
        transcript=recordings[0]['text'];recordings[0]['text']='edited transcript'
        try: text_engine.fit(args)
        except ValueError as error: assert 'changed after preparation' in str(error)
        else: raise AssertionError('Combined training reused stale transcript alignment')
        recordings[0]['text']=transcript
        Path(recordings[0]['audio']).write_bytes(b'changed')
        try: text_engine.fit(args)
        except ValueError as error: assert 'changed after preparation' in str(error)
        else: raise AssertionError('Combined training reused stale audio alignment')
        assert trainer.call_count==1
`], { encoding: "utf8", windowsHide: true });
});

test("text-to-RVC VCTK preparation keeps microphones and validation utterances separate", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import io, json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path("backend/applio").resolve()))
from rvc.lib.tools.text_rvc import data

assert "torch" not in sys.modules
chunks=list(data.text_chunks('Hello world. ' + 'another word '*60, max_bytes=60))
assert chunks[0]=='Hello world.' and all(len(chunk.encode('utf-8'))<=60 for chunk in chunks)
assert data.boundary_pause('Finished.”')>data.boundary_pause('continuing,')>data.boundary_pause('length limit')
assert data.boundary_pause('Finished.',2)==data.boundary_pause('Finished.')/2
try: list(data.text_chunks('a'*121))
except ValueError: pass
else: raise AssertionError('Unbounded words accepted')
assert data.normalize_text("  Ｈｅｌｌｏ\n world! ") == "hello world!"
assert data.tokenize("a") == [98,257]
assert data.normalize_text('I İ', 'tr') == 'ı i'
assert data.normalize_text('Please do *not* say **asterisk**.')=='please do not say asterisk.'
assert data.normalize_text('2*3 and a lone *')=='2*3 and a lone *'
from rvc.lib.tools.text_rvc.alignment import LANGUAGES
schema=json.loads(Path('backend/rust-api/src/training/training-schema.json').read_text())
for section,field in [('train','ttsLanguage'),('pipeline','ttsLanguage'),('textRvc','language')]:
    assert next(item['values'] for item in schema[section] if item['name']==field)==list(LANGUAGES)
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    for i in range(4):
        (root/f'clip{i}.wav').write_bytes(b'fixture')
        (root/f'clip{i}.txt').write_text(f'Unique phrase {i}',encoding='utf-8')
    records=data.speech_records(root)
    assert len(records)==4 and len({row['id'] for row in records})==4
    (root/'clip0.txt').unlink()
    try: data.speech_records(root)
    except ValueError as error: assert 'Missing transcript' in str(error)
    else: raise AssertionError('Untranscribed recording accepted')
records=[{'id':str(i),'text':('repeated' if i<2 else f'phrase {i}')} for i in range(8)]
split=data.partition(records)
assert not ({row['text'] for row in split if row['split']=='train'} & {row['text'] for row in split if row['split']=='validation'})
try: data.partition([{'id':str(i),'text':'same'} for i in range(4)])
except ValueError: pass
else: raise AssertionError('Identical transcripts leaked between splits')
for text in ["", " ", "é"*257]:
    try: data.tokenize(text)
    except ValueError: pass
    else: raise AssertionError("Invalid text accepted")
rows=[]
for number in range(1,6):
    for mic in ("mic1","mic2"):
          rows.append({"row":{"speaker_id":"p225", "text_id":f"{number:03}", "text":f"Please call Stella {number}.", "file":f"/corpus/p225_{number:03}_{mic}.flac", "audio":[{"src":"https://datasets-server.huggingface.co/assets/mirror/--/"+"a"*40+"/--/audio.flac"}]}})
def fetch(url, **kwargs):
    if "/rows?" in url: return io.BytesIO(json.dumps({"rows":rows}).encode())
    return io.BytesIO(b"fLaCfixture")
with tempfile.TemporaryDirectory() as directory, patch.object(data,"urlopen",side_effect=fetch) as network:
    root=Path(directory)
    data.download_vctk(root,limit=4)
    records=data.vctk_records(root)
    assert len(records)==4 and network.call_count==5
    assert all("mic1" in row["audio"] for row in records)
    assert len(list((root/"wav48_silence_trimmed/p225").glob("*")))==4
    first={row["id"]:row["split"] for row in data.partition(records)}
    second={row["id"]:row["split"] for row in data.partition(list(reversed(records)))}
    assert first==second and set(first.values())=={"train","validation"}
    try: data.partition(records+[records[0]])
    except ValueError: pass
    else: raise AssertionError("Duplicate utterance leaked between splits")
    try: data.vctk_records(root,mic="mic2")
    except ValueError: pass
    else: raise AssertionError("Microphone mismatch accepted")
    Path(records[0]["audio"]).write_bytes(b"changed")
    try: data.vctk_records(root)
    except ValueError: pass
    else: raise AssertionError("Changed source audio accepted")
    provenance=json.loads((root/"source.json").read_text())
    assert provenance["revision"]=="a"*40 and "src" not in json.dumps(provenance)
`], { encoding: "utf8", windowsHide: true });
});

test("automatic and manual voice training retain the TTS warm-start selection", async () => {
  const source=fs.readFileSync(new URL("../../frontend/web/app/train/page.tsx",import.meta.url),"utf8");
  const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  const state={"page:train:modelName":"voice","page:train:datasetPath":"recordings","page:train:enableTts":true,
    "page:train:ttsInitializeFrom":"logs/tts/base/frontend.pt","page:train:ttsLanguage":"fr"};
  const exports={};const requests=[];
  new Function("exports","require",outputText)(exports,(name)=>{
    if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==="react")return {useEffect(){},useCallback:(fn)=>fn,useRef:(current)=>({current}),useState:(value)=>[value===null?"train":typeof value==="function"?value():value,()=>{}]};
    if(name==="@/lib/workspace-state")return {useWorkspaceState:(key,initial)=>{
      if(!(key in state))state[key]=typeof initial==="function"?initial():initial;
      return [state[key],()=>{}];
    }};
    if(name==="@/lib/i18n")return {useI18n:()=>({t:(key)=>key})};
    if(name==="@/lib/useJob")return {usePersistentJobId:()=>[null,()=>{}],useJob:()=>({job:null,isActive:false})};
    if(name==="@/lib/api")return {submitJob:async(path,body)=>{requests.push({path,body});return {jobId:"job"};}};
    if(name==="@/lib/setting-help")return {SETTING_HELP:{}};
    return new Proxy({},{get:(_,key)=>key});
  });
  const find=(node,label)=>{
    if(!node||typeof node!=="object")return;
    if(typeof node.props?.onClick==="function"&&node.props.children===label)return node;
    for(const child of [node.props?.children].flat(Infinity)){const found=find(child,label);if(found)return found;}
  };
  for(const [label,path] of [["Start Automatic Training","/api/train/pipeline"],["Start Training","/api/train/train"]]){
    const action=find(exports.default(),label);
    assert.ok(action,`Missing ${label} action`);
    await action.props.onClick();
    assert.equal(requests.at(-1).path,path);
    assert.equal(requests.at(-1).body.enableTts,true);
    assert.equal(requests.at(-1).body.ttsInitializeFrom,"logs/tts/base/frontend.pt");
    assert.equal(requests.at(-1).body.ttsLanguage,"fr");
  }
});

test("TTS selection preserves each provider's voice and submits the synthesis contract", async () => {
  const source = fs.readFileSync(new URL("../../frontend/web/components/TtsForm.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const state = {
    "TtsForm:components:provider": "gtts",
    "TtsForm:components:voice": "en-US-AnaNeural",
    "TtsForm:components:voiceCatalogs": {
      edge: [{ shortName: "en-US-AnaNeural", friendlyName: "Ana", gender: "Female" }],
    },
    "TtsForm:components:text": "Hola",
    "TtsForm:components:pthPath": "logs/voice.pth",
    "TtsForm:components:rate": 25,
  };
  const exports = {};
  const submitted = [];
  let completedJob;
  const component = (type, props) => ({ type, props });
  new Function("exports", "require", outputText)(exports, (name) => {
    if (name === "react/jsx-runtime") return { jsx: component, jsxs: component };
    if (name === "react") return { useCallback: (fn) => fn, useEffect() {}, useRef: (current) => ({ current }), useState: (value) => [value, () => {}] };
    if (name === "@/lib/workspace-state") return { useWorkspaceState: (key, initial) => {
      if (!(key in state)) state[key] = typeof initial === "function" ? initial() : initial;
      return [state[key], (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; }];
    } };
    if (name === "@/lib/i18n") return { useI18n: () => ({ t: (key) => key }) };
    if (name === "@/lib/useJob") return { usePersistentJobId: () => [null, () => {}], useJob: () => ({ job: completedJob, setError() {} }) };
    if (name === "@/lib/useSpeakers") return { useSpeakers: () => [0] };
    if (name === "@/lib/useConversionParameters") return { useConversionParameters: () => ({ loaded: true, values: { pitch: 2 }, setters: {} }) };
    if (name === "@/lib/api") return { cachedModels: () => null, fileBasename: (path) => path.split(/[\\/]/).pop(), outputUrl: (path) => `/outputs/${path.split(/[\\/]/).pop()}`, postForm: async (path, body) => { submitted.push(Object.fromEntries(body)); return { jobId: "job" }; } };
    if (name === "@/lib/setting-help") return { SETTING_HELP: {} };
    if (name === "@/components/ui") return new Proxy({}, { get: (_, key) => key });
    return {};
  });
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const match = find(child, predicate);
      if (match) return match;
    }
  };
  for (const [provider, voice] of [["edge", "en-US-AnaNeural"]]) {
    const before = exports.default();
    assert.deepEqual(find(before, (node) => node.props?.id === "tts-provider-select").props.options.map((option) => option.value), ["edge", "rvc"]);
    assert.equal(find(before, (node) => node.props?.id === "tts-provider-select").props.value, "edge");
    const tree = exports.default();
    const selection = find(tree, (node) => node.props?.id === "tts-voice-select");
    assert.equal(selection.props.value, voice);
    assert.ok(selection.props.options.some((option) => option.value === voice));
    await find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.deepEqual(Object.fromEntries(["ttsProvider", "ttsVoice", "ttsText", "ttsRate", "pitch", "pthPath"].map((key) => [key, submitted.at(-1)[key]])), {
      ttsProvider: provider, ttsVoice: voice, ttsText: "Hola", ttsRate: "25", pitch: "2", pthPath: "logs/voice.pth",
    });
  }
  state["TtsForm:components:provider"] = "rvc";
  state["TtsForm:frontend"] = "logs/tts/voice/frontend.pt";
  const directTree = exports.default();
  assert.equal(find(directTree, (node) => node.props?.id === "tts-voice-select"), undefined);
  assert.equal(find(directTree, (node) => node.props?.id === "tts-frontend").props.value, "logs/tts/voice/frontend.pt");
  await find(directTree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(submitted.at(-1).ttsProvider, "rvc");
  assert.equal(submitted.at(-1).ttsFrontend, "logs/tts/voice/frontend.pt");
  assert.equal(submitted.at(-1).exportFormat, "WAV");
  assert.equal(submitted.at(-1).indexPath, "");
  assert.equal(submitted.at(-1).pitch, undefined, "Hidden conversion parameters were applied to direct synthesis");
  completedJob = {status: "done", outputFile: "assets/audios/finished.wav", params: {pthPath: "logs/original-voice.pth"}};
  state["TtsForm:components:pthPath"] = "logs/different-voice.pth";
  const completedTree = exports.default();
  assert.equal(find(completedTree, (node) => node.props?.src === "/outputs/finished.wav").props.title, "original-voice", "A new voice selection relabeled audio generated by the previous voice");
});

test("TTS exposes only Edge and Applio while retaining the internal phonemizer", () => {
  const catalog = JSON.parse(fs.readFileSync("assets/api-endpoints.json", "utf8"));
  const schema = JSON.parse(fs.readFileSync("backend/rust-api/src/inference/inference-schema.json", "utf8"));
  assert.deepEqual(
    catalog.find((entry) => entry.path === "/v1/applio/tts/voices").query.provider.enum,
    schema.tts.find((field) => field.name === "ttsProvider").values,
  );
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import ast, asyncio, os, sys, tempfile, types
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path("backend/applio").resolve()))
from rvc.lib.tools import tts_providers as tts
assert not any(name in sys.modules for name in ("torch","onnxruntime","scipy"))
assert tts.PROVIDERS==("edge",) and tts.voices("edge") and tts.voices("rvc")==[]
for provider in ("gtts","piper","unknown"):
    try: tts.voices(provider)
    except ValueError: pass
    else: raise AssertionError("Retired provider accepted")
tree=ast.parse(Path("backend/applio/tabs/tts/tts.py").read_text(encoding="utf-8"))
helpers=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in {"provider_info","change_provider"}]
namespace={"gr":types.SimpleNamespace(update=lambda **kwargs:kwargs),"i18n":lambda key:key,"provider_voices":tts.voices}
exec(compile(ast.Module(body=helpers,type_ignores=[]),"tts.py","exec"),namespace)
direct=namespace["change_provider"]("rvc")
assert not direct[0]["visible"] and direct[2]["visible"] and direct[3]["value"]=="" and not direct[4]["visible"]
assert direct[5]["value"]=="WAV" and not direct[5]["interactive"]
assert namespace["change_provider"]("edge")[0]["visible"]
async def save(path): pass
edge=types.SimpleNamespace(Communicate=Mock(return_value=types.SimpleNamespace(save=save)))
with tempfile.TemporaryDirectory() as directory:
    with patch.dict(sys.modules,{"edge_tts":edge}):
        asyncio.run(tts.synthesize("Hello","en-US-AnaNeural",-25,Path(directory)/"out.wav"))
        assert edge.Communicate.call_args.kwargs["rate"]=="-25%"
        for provider in ("gtts","piper","rvc"):
            try: asyncio.run(tts.synthesize("Hello","voice",0,Path(directory)/"out.wav",provider))
            except ValueError: pass
            else: raise AssertionError("Wrong synthesis dispatcher")
    modules={"rvc.lib.tools.audio_cleanup":types.SimpleNamespace(_asset_lock=lambda root:nullcontext())}
    with patch.dict(os.environ,{"APPLIO_TTS_CACHE":directory}),patch.dict(sys.modules,modules),patch.object(tts.metadata,"version",return_value="missing"),patch.object(tts,"_run") as run:
        tts.ensure_piper_runtime()
        assert "--no-deps" in run.call_args.args[0]
        assert "piper-tts==1.8.0" in run.call_args.args[0]
`], {encoding:"utf8",windowsHide:true});
});

test("Gradio callback ordering and the worker retain conversion parameters after removing split audio", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import ast, inspect, os, time, types
from pathlib import Path
from unittest.mock import Mock

root = Path("backend/applio")
core = ast.parse((root / "core.py").read_text(encoding="utf-8"))
functions = [node for node in core.body if isinstance(node, ast.FunctionDef) and node.name in {"_base_infer_kwargs", "run_infer_script", "run_batch_infer_script", "run_tts_script"}]
namespace = {}
exec(compile(ast.Module(body=functions, type_ignores=[]), "core.py", "exec"), namespace)
control_names = {
 "rms_mix_rate": "volume_envelope", "autotune": "f0_autotune", "autotune_strength": "f0_autotune_strength",
 "audio": "input_path", "model_file": "pth_path", "index_file": "index_path",
 "input_tts_path": "tts_file", "output_tts_path": "output_tts_path", "output_rvc_path": "output_rvc_path",
}
for relative, callbacks in [("tabs/inference/inference.py", {"enforce_terms": "run_infer_script", "enforce_terms_batch": "run_batch_infer_script"}), ("tabs/tts/tts.py", {"enforce_terms": "run_tts_script"})]:
 tree = ast.parse((root / relative).read_text(encoding="utf-8"))
 found = set()
 for node in ast.walk(tree):
  if not isinstance(node, ast.Call): continue
  keywords = {keyword.arg: keyword.value for keyword in node.keywords}
  callback = keywords.get("fn")
  if not isinstance(callback, ast.Name) or callback.id not in callbacks or "inputs" not in keywords: continue
  script = callbacks[callback.id]; found.add(script)
  inputs = [item.id for item in keywords["inputs"].elts][1:]
  values = list(range(len(inputs)))
  signature = inspect.signature(namespace[script])
  if script == "run_tts_script": bound = signature.bind(*values)
  else: bound = signature.bind(*values[:-2], cleanup_mode=values[-2], cleanup_strength=values[-1])
  for control, value in zip(inputs, values):
   control = control.removesuffix("_batch")
   expected = control_names.get(control, control)
   assert bound.arguments[expected] == value, (script, control, bound.arguments)
  assert "split_audio" not in signature.parameters
 assert found == set(callbacks.values()), (relative, found)

worker = ast.parse((root / "rvc/infer/worker.py").read_text(encoding="utf-8"))
functions = [node for node in worker.body if isinstance(node, ast.FunctionDef) and node.name in {"map_params", "to_bool"}]
exec(compile(ast.Module(body=functions, type_ignores=[]), "worker.py", "exec"), namespace)
params = namespace["map_params"]({"splitAudio": True, "f0Autotune": True, "sid": 3}, "input.wav", "output.wav")
assert "split_audio" not in params and params["f0_autotune"] is True and params["sid"] == 3

infer = ast.parse((root / "rvc/infer/infer.py").read_text(encoding="utf-8"))
converter = next(node for node in infer.body if isinstance(node, ast.ClassDef) and node.name == "VoiceConverter")
convert = next(node for node in converter.body if isinstance(node, ast.FunctionDef) and node.name == "convert_audio")
convert.decorator_list = []
audio, output, embedder = object(), object(), object()
pipeline, write = Mock(return_value=output), Mock()
namespace.update(np=types.SimpleNamespace(abs=lambda _: types.SimpleNamespace(max=lambda: 0)), load_audio_infer=lambda *args, **kwargs: audio, sf=types.SimpleNamespace(write=write), os=os, time=time)
exec(compile(ast.Module(body=[convert], type_ignores=[]), "infer.py", "exec"), namespace)
vc = types.SimpleNamespace(get_vc=Mock(), hubert_model=embedder, last_embedder_model="contentvec", tgt_sr=44100, net_g=object(), use_f0=True, version="v2", vc=types.SimpleNamespace(pipeline=pipeline), convert_audio_format=Mock(return_value="out.wav"))
namespace["convert_audio"](vc, "in.wav", "out.wav", "voice.pth", "voice.index", pitch=7, f0_autotune=True, f0_autotune_strength=0.6, sid=3)
pipeline.assert_called_once()
assert pipeline.call_args.kwargs["audio"] is audio
assert pipeline.call_args.kwargs["pitch"] == 7
assert pipeline.call_args.kwargs["f0_autotune"] is True
assert pipeline.call_args.kwargs["f0_autotune_strength"] == 0.6
assert pipeline.call_args.kwargs["sid"] == 3
write.assert_called_once_with("out.wav", output, 44100, format="WAV")
`], { encoding: "utf8", windowsHide: true });
});

test("pitch windows cover an hour without gaps, duplicate joins or duration-sized model input", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import ast, types
from array import array
from pathlib import Path

class Contour(array):
 def __new__(cls, values=()): return super().__new__(cls, 'f', values)
 def reshape(self, *args): return self
 def __mul__(self, value): return Contour(item * value for item in self)

np = types.SimpleNamespace(
 float32='float32', float64='float64',
 empty=lambda count, **kwargs: Contour([0]*count),
 asarray=lambda values: Contour(values),
 concatenate=lambda parts: Contour(value for part in parts for value in part),
 arange=lambda count: Contour(range(count)),
)
# This check deliberately needs neither ML packages nor an hour-sized waveform.
namespace = {'np': np}
root = Path('backend/applio/rvc/lib/predictors')
tree = ast.parse((root / 'chunking.py').read_text(encoding='utf-8'))
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)], type_ignores=[]), 'chunking.py', 'exec'), namespace)
extract = namespace['extract_pitch']
class Audio:
 def __init__(self, length, offset=0): self.length, self.offset, self.size = length, offset, length
 def __len__(self): return self.length
 def __getitem__(self, key):
  start, end, step = key.indices(self.length)
  assert step == 1
  return Audio(end-start, self.offset+start)

for rate, hop in [(16000, 160), (44100, 512)]:
 for tail in [0, 1, hop-1, hop]:
  source = Audio(rate*3600+tail)
  calls = []
  def infer(window):
   assert window.offset % hop == 0
   calls.append((window.offset, len(window)))
   return Contour(range(window.offset//hop, (window.offset+len(window))//hop+1))
  result = extract(source, infer, rate, hop)
  assert list(result) == list(range(len(source)//hop+1)), (rate, hop, tail)
  assert max(length for _, length in calls) <= int(12*rate)
  assert all(calls[i][0] > calls[i-1][0] for i in range(1,len(calls)))
  # Check context trimming independently of the perfect frame-clock prediction.
  def contextual(window):
   values = infer(window)
   context = rate//hop
   if window.offset: values[:context] = Contour([-1]*context)
   if window.offset+len(window) < len(source): values[-context:] = Contour([-1]*context)
   return values
  assert all(value >= 0 for value in extract(source, contextual, rate, hop))
short = Audio(16000)
sentinel = object()
assert extract(short, lambda window: sentinel if window is short else None) is sentinel
try:
 extract(Audio(16000*11), lambda window: Contour())
except ValueError as error:
 assert 'fewer frames' in str(error)
else: raise AssertionError('A truncated pitch contour must fail instead of silently dropping audio')

# Exercise the actual entry methods: threshold, range and device arguments must
# reach the window callbacks used by Gradio, desktop, training and curve tools.
for file, cls, method in [('RMVPE.py','RMVPE0Predictor','infer_from_audio'), ('f0.py','CREPE','get_f0'), ('f0.py','FCPE','get_f0')]:
 tree = ast.parse((root/file).read_text(encoding='utf-8'))
 definition = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name==cls)
 fn = next(n for n in definition.body if isinstance(n, ast.FunctionDef) and n.name==method)
 exec(compile(ast.Module(body=[fn],type_ignores=[]),file,'exec'),namespace)
 calls=[]
 def window(audio,*args):
  calls.append((len(audio),args)); return Contour([220]*(len(audio)//160+1))
 obj=types.SimpleNamespace(sample_rate=16000,hop_size=160,_infer_window=window)
 result=namespace[method](obj,Audio(16000*3600))
 assert len(result)==360001 and max(size for size,_ in calls)<=192000
 if cls=='CREPE': assert all(args==(50,1100,'full') for _,args in calls)
 elif cls=='FCPE': assert all(args==(0.006,) for _,args in calls)
 else: assert all(args==(0.03,) for _,args in calls)

# Silence must survive the shared conversion normalizer before any extractor.
tree=ast.parse(Path('backend/applio/rvc/infer/pipeline.py').read_text(encoding='utf-8'))
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Pipeline')
fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='get_f0')
stop=next(i for i,n in enumerate(fn.body) if isinstance(n,ast.If) and isinstance(n.test,ast.Compare) and isinstance(n.test.left,ast.Name) and n.test.left.id=='f0_method')
fn.body=fn.body[:stop]+[ast.Return(value=ast.Name(id='x',ctx=ast.Load()))]
exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'pipeline.py','exec'),namespace)
class NormalizedAudio:
 def __init__(self,scale): self.scale,self.divisor=scale,None
 def astype(self,*args): return self
 def __itruediv__(self,divisor):
  assert divisor>0, 'Silence cannot be divided by zero'
  self.divisor=divisor
  return self
np.abs=lambda audio:audio
np.quantile=lambda audio,q:audio.scale
for scale in (0,0.5):
 audio=NormalizedAudio(scale)
 assert namespace['get_f0'](types.SimpleNamespace(device='cpu'),audio,100) is audio
 assert audio.divisor==(scale if scale else None)

# The optional RMVPE octave guide must be bounded before doubling sample rate.
tree=ast.parse((root/'f0.py').read_text(encoding='utf-8'))
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='RMVPE')
fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_half_speed_guide')
exec(compile(ast.Module(body=[fn],type_ignores=[]),'f0.py','exec'),namespace)
calls=[]
def guide(window,threshold):
 assert threshold==.03
 calls.append(len(window))
 return Contour([880]*(len(window)//160+1))
result=namespace['_half_speed_guide'](types.SimpleNamespace(sample_rate=16000,hop_size=160,_half_speed_window=guide),Audio(16000*3600),360001,.03)
assert len(result)==360001 and max(calls)<=192000

# SWIFT has its own 16ms clock and existing 30-second contextual windows.
tree=ast.parse((root/'Swift.py').read_text(encoding='utf-8'))
fn=next(n for cls in tree.body if isinstance(cls,ast.ClassDef) and cls.name=='SwiftPredictor' for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='detect')
namespace.update(SAMPLE_RATE=16000,HOP=256,FRAME_PERIOD=.016,FMIN=46.875,FMAX=2093.75,WINDOW_FRAMES=1875,LEFT_FRAMES=11,LOOKAHEAD_FRAMES=10,_to_mono=lambda audio:audio)
exec(compile(ast.Module(body=[fn],type_ignores=[]),'Swift.py','exec'),namespace)
calls=[]
def run(window,*args):
 calls.append(len(window))
 values=Contour(range(window.offset//256,(window.offset+len(window))//256))
 return values,Contour([1]*len(values))
timestamps,pitch,confidence=namespace['detect'](types.SimpleNamespace(_run=run),Audio(16000*3600+159))
assert list(pitch)==list(range(225000))
assert len(timestamps)==len(confidence)==225000
assert max(calls)<16000*31
`], { encoding: "utf8", windowsHide: true });
});
