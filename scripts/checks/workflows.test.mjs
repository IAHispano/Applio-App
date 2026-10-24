import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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

test("desktop prerequisites retry resets and publish only complete models", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", ["-X", "utf8", "-c", String.raw`
import importlib.util, os, sys, tempfile, types
from pathlib import Path
from unittest.mock import patch

root = Path.cwd()
sys.path.insert(0, str(root / 'backend/applio'))
requests = types.ModuleType('requests')
class RequestException(Exception): pass
class ConnectionError(RequestException): pass
requests.RequestException = RequestException
attempts = {}
payload = b'model-prefix-model-suffix'
class Response:
 def __init__(self, offset=0):
  self.status_code = 206 if offset else 200
  self.headers = {'etag': '"stable"', 'content-length': str(len(payload)-offset)}
  if offset: self.headers['content-range'] = f'bytes {offset}-{len(payload)-1}/{len(payload)}'
  self.offset = offset
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def raise_for_status(self): pass
 def iter_content(self, size):
  if not self.offset:
   yield payload[:13]
   raise ConnectionError('connection reset during body')
  yield payload[self.offset:]
def get(url, *, headers, **kwargs):
 attempts[url] = attempts.get(url, 0)+1
 if 2 <= attempts[url] <= 4: raise ConnectionError('connection reset during redirect')
 offset = int(headers['Range'][6:-1]) if 'Range' in headers else 0
 if offset: assert headers['If-Range'] == '"stable"'
 return Response(offset)
requests.get = get
requests.head = lambda *args, **kwargs: Response()
tqdm = types.ModuleType('tqdm')
class Bar:
 def __init__(self, **kwargs): pass
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def update(self, amount): pass
tqdm.tqdm = Bar
with patch.dict(sys.modules, requests=requests, tqdm=tqdm):
 from rvc.lib.tools import prerequisites_download as upstream
 spec = importlib.util.spec_from_file_location('prerequisite_adapter', root/'backend/python/downloads/prerequisites.py')
 adapter = importlib.util.module_from_spec(spec)
 spec.loader.exec_module(adapter)
 with tempfile.TemporaryDirectory() as folder, patch('time.sleep'), patch.object(sys, 'argv', ['prerequisites.py', '--models']):
  os.chdir(folder)
  try:
   adapter.main()
   for remote, names in upstream.models_list + upstream.embedders_list:
    for name in names:
     destination = Path(upstream.folder_mapping_list[remote]) / name
     assert destination.read_bytes() == payload
     assert not Path(str(destination)+'.part').exists()
     assert not Path(str(destination)+'.part.json').exists()
   assert len(attempts) == 5 and set(attempts.values()) == {5}, attempts
   adapter.main()
   assert set(attempts.values()) == {5}, 'Completed files must be reused'
   with patch.object(sys, 'argv', ['prerequisites.py', '--vocoder', 'HiFi-GAN', '--sample-rate', '40000']):
    adapter.main()
   for kind in ('G', 'D'):
    assert Path(f'rvc/models/pretraineds/hifi-gan/f0{kind}40k.pth').read_bytes() == payload
   assert len(attempts) == 7 and set(attempts.values()) == {5}, attempts
   with upstream.ThreadPoolExecutor() as pool: assert pool._max_workers == 4
   assert 'torch' not in sys.modules
   # Exhausted retries must retain the prior completed file and propagate.
   destination = Path('old-model.pth')
   destination.write_bytes(b'previous valid model')
   with patch.object(requests, 'get', side_effect=ConnectionError('still offline')) as failed:
    try: upstream.download_http('http://offline/model', destination)
    except ConnectionError: pass
    else: raise AssertionError('Exhausted retries must fail the job')
    assert failed.call_count == 6
    assert destination.read_bytes() == b'previous valid model'
  finally: os.chdir(root)
`], { encoding: "utf8", windowsHide: true });
});

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
  const nativeOnly = new Set([
    "GET /v1/applio/uvr/variants",
    "POST /v1/applio/uvr/custom-models",
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
modules = {"edge_tts": types.ModuleType("edge_tts"), "edge_tts.drm": drm, "torch": torch, "uvicorn": types.ModuleType("uvicorn"), "librosa": types.ModuleType("librosa")}
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
