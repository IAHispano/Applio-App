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


test("the in-app API reference covers every native HTTP operation and produces valid Python examples", () => {
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
  assert.deepEqual([...documented].sort(), [...actual].sort(), "new app routes require an explicit API capability and reference entry");
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
