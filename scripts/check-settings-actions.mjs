import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

function restart(fetch, now = () => 0) {
  const source = fs.readFileSync(new URL("../frontend/web/lib/settings-actions.ts", import.meta.url), "utf8");
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
  const source = fs.readFileSync(new URL("../frontend/web/lib/theme.tsx", import.meta.url), "utf8");
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

test("restart waits for a different API generation and tolerates reconnects", async () => {
  let calls = 0;
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

test("desktop quit is permitted and returns native invocation failures to Settings", async () => {
  const permissions = fs.readFileSync(
    new URL("../frontend/desktop/src-tauri/permissions/native.toml", import.meta.url),
    "utf8",
  );
  const allowed = JSON.parse(permissions.match(/commands\.allow = (\[[^\]]+\])/)[1]);
  assert.ok(allowed.includes("quit_app"));
  const source = fs.readFileSync(
    new URL("../frontend/desktop/src-tauri/src/bridge.js", import.meta.url),
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
  const routes = new URL("../backend/rust-api/src/routes/", import.meta.url);
  const catalog = JSON.parse(fs.readFileSync(new URL("../assets/api-endpoints.json", import.meta.url), "utf8"));
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
  const source = fs.readFileSync(new URL("../frontend/web/components/ApiReference.tsx", import.meta.url), "utf8");
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
  const source = fs.readFileSync(new URL("../frontend/web/app/audio-separator/page.tsx", import.meta.url), "utf8");
  const schema = JSON.parse(fs.readFileSync(new URL("../backend/rust-api/src/routes/uvr-schema.json", import.meta.url), "utf8"));
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
