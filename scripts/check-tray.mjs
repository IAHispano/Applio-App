import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-tray-check-"));
try {
  const bundle = path.join(temporary, "tray.cjs");
  await require("esbuild").build({
    entryPoints: [path.join(root, "frontend/desktop/src/tray-menu.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
  });
  const { trayMenu, trayStatus, canNavigateFromTray, parseTraySnapshot, freshTraySnapshot } = require(bundle);
  const snapshot = {
    connecting: false,
    streaming: true,
    model: "C:\\models\\voice.pth",
    processingMs: 16.7,
    roundTripMs: 26.2,
    muted: true,
    monitor: true,
  };
  const idle = {
    available: true,
    engine: false,
    session: false,
    operation: null,
    snapshot: null,
    visible: true,
    alwaysOnTop: false,
  };
  const active = { ...idle, engine: true, session: true, snapshot };
  assert.equal(trayStatus(idle), "Realtime stopped");
  assert.equal(trayStatus({ ...idle, engine: true }), "Engine ready");
  assert.equal(trayStatus({ ...idle, session: true }), "Connecting audio…");
  assert.equal(trayStatus(active), "Realtime active");
  assert.equal(trayStatus({ ...active, available: false }), "Service unavailable");
  assert.equal(trayStatus({ ...idle, operation: "start" }), "Starting realtime…");
  assert.equal(trayStatus({ ...active, operation: "stop" }), "Stopping realtime…");
  assert.equal(canNavigateFromTray(active), false);
  assert.equal(
    canNavigateFromTray({ ...idle, snapshot: { ...snapshot, streaming: false, connecting: true } }),
    false,
  );
  assert.equal(canNavigateFromTray({ ...idle, engine: true }), true);
  assert.deepEqual(parseTraySnapshot(snapshot), snapshot);
  for (const value of [
    null,
    {},
    { ...snapshot, model: 42 },
    { ...snapshot, monitor: "true" },
    { ...snapshot, processingMs: NaN },
    { ...snapshot, roundTripMs: -1 },
  ])
    assert.equal(parseTraySnapshot(value), null);
  assert.equal(freshTraySnapshot(snapshot, 1000, 10999), snapshot);
  assert.equal(freshTraySnapshot(snapshot, 1000, 11000), null);
  const calls = [];
  const actions = Object.fromEntries(
    ["show", "hide", "navigate", "realtime", "alwaysOnTop", "folder", "quit"].map((name) => [
      name,
      (...args) => calls.push([name, ...args]),
    ]),
  );
  const find = (menu, label) => {
    for (const item of menu) {
      if (item.label === label) return item;
      if (Array.isArray(item.submenu)) {
        const nested = find(item.submenu, label);
        if (nested) return nested;
      }
    }
  };
  const menu = trayMenu(active, (key) => key, actions);
  for (const label of ["Realtime", "Studio", "Window", "Folders"]) assert.ok(find(menu, label).submenu);
  assert.equal(find(menu, "Start Realtime").enabled, false);
  assert.equal(find(menu, "Stop Realtime").enabled, true);
  assert.equal(find(menu, "Inference").enabled, false);
  assert.equal(find(menu, "Settings").enabled, false);
  assert.equal(find(menu, "Mute microphone").checked, true);
  assert.equal(find(menu, "Local monitor").checked, true);
  assert.ok(find(menu, "Voice model: voice.pth"));
  assert.ok(find(menu, "Processing: 17 ms"));
  find(menu, "Mute microphone").click({ checked: false });
  find(menu, "Local monitor").click({ checked: false });
  find(menu, "Voice models").click();
  assert.deepEqual(calls, [
    ["realtime", "unmute"],
    ["realtime", "monitor-off"],
    ["folder", "models"],
  ]);
  const stopped = trayMenu(idle, (key) => key, actions);
  assert.equal(find(stopped, "Start Realtime").enabled, true);
  assert.equal(find(stopped, "Stop Realtime").enabled, false);
  assert.equal(find(stopped, "Local monitor").enabled, false);
  assert.equal(find(stopped, "Inference").enabled, true);
  const unavailable = trayMenu({ ...active, available: false }, (key) => key, actions);
  assert.equal(find(unavailable, "Mute microphone").enabled, false);
  assert.equal(find(unavailable, "Start Realtime").enabled, false);
  assert.ok(
    find(
      trayMenu(idle, (key) => `translated:${key}`, actions),
      "translated:Folders",
    ),
  );
  if (process.argv.includes("--native")) {
    const desktopRequire = createRequire(path.join(root, "frontend/desktop/package.json"));
    const script = path.join(temporary, "native.cjs");
    fs.writeFileSync(
      script,
      `
      const {app, Menu} = require('electron');
      app.setPath('userData', ${JSON.stringify(temporary)});
      const {trayMenu} = require(${JSON.stringify(bundle)});
      const actions = Object.fromEntries(['show','hide','navigate','realtime','alwaysOnTop','folder','quit'].map(n=>[n,()=>{}]));
      app.whenReady().then(() => {
        for (const state of ${JSON.stringify([idle, active, { ...active, operation: "stop" }])}) {
          const menu = Menu.buildFromTemplate(trayMenu(state, k=>k, actions));
          if (!menu.items.find(item=>item.label==='Realtime')?.submenu) throw new Error('Missing native submenu');
        }
        console.log('Native Electron menus passed.'); app.quit();
      }).catch(error=>{console.error(error);app.exit(1);});
    `,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(desktopRequire("electron"), [script], {
      env,
      timeout: 20000,
      windowsHide: true,
    });
    assert.match(result.stdout, /Native Electron menus passed/);
    console.log("Native Electron menu construction passed.");
  }
  console.log(
    "Tray categories, audio status, stale-state expiry, controls, navigation guards and translations passed.",
  );
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true });
}
