import assert from "node:assert/strict";
import fs from "node:fs";
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
