// Windows development smoke check against the real WebView2/Tauri bridge.
// Enables a local CDP port for this isolated test process only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkDashboard, checkTrayHeartbeat } from "./check-dashboard.mjs";

if (process.platform !== "win32") throw new Error("This WebView2 check requires Windows");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/desktop/package.json"));
const WebSocket = require("ws");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-tauri-"));
if (!path.resolve(temporary).startsWith(path.join(path.resolve(os.tmpdir()), "applio-tauri-")))
  throw new Error("Invalid smoke-test directory");
const release = process.argv.includes("--release");
let executable = path.join(root, "target/debug/applio-desktop.exe");
if (release) {
  executable = path.join(temporary, "Applio.exe");
  fs.copyFileSync(path.join(root, "target/release/applio-desktop.exe"), executable);
  fs.cpSync(path.join(root, "frontend/desktop/resources"), path.join(temporary, "app"), {
    recursive: true,
    dereference: true,
  });
}
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const startupRetry = process.argv.includes("--startup-retry");
const permissions = process.argv.includes("--permissions");
const blocker = startupRetry ? net.createServer() : null;
if (blocker)
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(8000, "127.0.0.1", resolve);
  });
const processHandle = spawn(executable, [], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    APPLIO_ROOT: path.join(temporary, "runtime"),
    APPLIO_CONFIG_DIR: path.join(temporary, "config"),
    APPLIO_NO_ENV: "1",
    ...(release
      ? { APPDATA: path.join(temporary, "roaming"), LOCALAPPDATA: path.join(temporary, "local") }
      : {}),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}${permissions ? " --use-fake-device-for-media-stream" : ""}`,
    WEBVIEW2_USER_DATA_FOLDER: path.join(temporary, "webview"),
  },
});
let launcherOutput = "";
for (const stream of [processHandle.stdout, processHandle.stderr])
  stream.on("data", (bytes) => {
    launcherOutput = (launcherOutput + bytes).slice(-10000);
  });
let socket;
let loadingSocket;
try {
  if (startupRetry) {
    let loading;
    for (let attempt = 0; attempt < 120 && !loading; attempt++) {
      if (processHandle.exitCode !== null)
        throw new Error(`Desktop exited: ${processHandle.exitCode} ${launcherOutput}`);
      let targets = [];
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      } catch {}
      for (const target of targets.filter(
        (t) => t.type === "page" && (t.url.includes("tauri.localhost") || t.url.startsWith("tauri://")),
      )) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        let sequence = 0;
        const pending = new Map();
        ws.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          const p = pending.get(message.id);
          if (p) {
            pending.delete(message.id);
            message.error ? p.reject(message.error) : p.resolve(message.result);
          }
        });
        const call = (method, params) =>
          new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
          });
        const label = await call("Runtime.evaluate", {
          returnByValue: true,
          expression: "window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label",
        });
        if (label.result?.value === "splash") {
          loading = { call };
          loadingSocket = ws;
          break;
        }
        ws.close();
      }
      if (!loading) await delay(50);
    }
    assert.ok(loading, "The original splash window must be shown during startup");
    const state = await loading.call("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async()=>{
      for(let i=0;i<80&&!document.body.dataset.failed;i++)await new Promise(resolve=>setTimeout(resolve,50));
      await document.fonts.load('700 82px Syne');
      let denied=false;try{await window.__TAURI__.core.invoke('bridge_command',{action:'status'});}catch{denied=true;}
      return {failed:document.body.dataset.failed==='true',retry:!document.getElementById('retry').hidden,font:document.fonts.check('700 82px Syne'),brand:document.querySelector('.brand')?.textContent,grid:!!document.querySelector('.bg-lines'),denied};
    })()`,
    });
    assert.deepEqual(state.result.value, {
      failed: true,
      retry: true,
      font: true,
      brand: "Applio",
      grid: true,
      denied: true,
    });
    if (process.argv.includes("--snapshot")) {
      await loading.call("Runtime.evaluate", {
        expression:
          "document.getElementById('retry').hidden=true; delete document.body.dataset.failed; window.setStatus('Loading Applio…');",
      });
      await delay(450);
      const screenshot = await loading.call("Page.captureScreenshot", { format: "png" });
      const output = path.join(root, ".applio-dev/splash-preview.png");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, Buffer.from(screenshot.data, "base64"));
      console.log(`Splash preview: ${output}`);
    }
    await new Promise((resolve) => blocker.close(resolve));
    await loading.call("Runtime.evaluate", {
      expression: "document.getElementById('retry').hidden=false; document.getElementById('retry').click();",
    });
    console.log("Splash font, original artwork, restricted capabilities and startup retry verified.");
  }
  let target;
  for (let i = 0; i < 180; i++) {
    if (processHandle.exitCode !== null)
      throw new Error(`Desktop exited: ${processHandle.exitCode}\n${launcherOutput}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:3000"));
      if (target) break;
    } catch {}
    await delay(500);
  }
  if (!target) {
    const log = path.join(temporary, "config/app-logs/launcher.log");
    throw new Error(
      `Desktop did not load. ${fs.existsSync(log) ? fs.readFileSync(log, "utf8").slice(-5000) : "No launcher log"}`,
    );
  }
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (promise) message.error ? promise.reject(message.error) : promise.resolve(message.result);
    }
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const result = await call("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
    const bridge = window.applio;
    if (!bridge) throw new Error('Native bridge is missing');
    const status = await bridge.bridgeMode.getStatus();
    const updater = await bridge.updater.getStatus();
    const maximized = await bridge.controls.isMaximized();
    const hotkey = await bridge.setPassthroughHotkey('CommandOrControl+Alt+F11');
    await bridge.setPassthroughHotkey('');
    let denied = false;
    try { await window.__TAURI__.core.invoke('window_action', {action:'open-external', url:'file:///invalid'}); } catch {denied = true;}
    let invalidSetupDenied = false;
    try { await bridge.restartAfterSetup('invalid-job'); } catch {invalidSetupDenied = true;}
    const health = await (await fetch('/api/health')).json();
    // Rebuild native menus across each realtime state, including model/timing
    // labels and checked items; each invocation must finish without a lockup.
    const snapshot = {connecting:false,streaming:false,muted:false,monitor:false,
      model:'voices/example.pth',processingMs:12.4,roundTripMs:27.8};
    for (const patch of [{},{connecting:true},{streaming:true},{streaming:true,muted:true,monitor:true}]) {
      await window.__TAURI__.core.invoke('report_realtime_state',{stateValue:{...snapshot,...patch}});
    }
    await window.__TAURI__.core.invoke('report_realtime_state',{stateValue:null});
    const blocked = [{key:'F12'},{key:'F5'},{key:'F11'},
      ...['i','j','u','r','p','s','o','l','n','t','w','f'].map(key=>({key,ctrlKey:true})),
      {key:'I',ctrlKey:true,shiftKey:true},{key:'C',ctrlKey:true,shiftKey:true},
      {key:'i',metaKey:true,altKey:true},{key:'ArrowLeft',altKey:true}];
    const editing = ['a','c','v','x','z','y'].map(key=>({key,ctrlKey:true}));
    const cancelled = options => !window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...options}));
    const browserCommandsBlocked = blocked.every(cancelled);
    const editingPreserved = editing.every(options=>!cancelled(options));
    const contextMenuBlocked = !window.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    return {platform:bridge.platform, status:status.status, updater:updater.status, maximized, hotkey:hotkey.registered,
      browserCommandsBlocked,editingPreserved,contextMenuBlocked,
      denied, invalidSetupDenied, service:health.service, runtime:health.runtime, compatibilityService:health.compatibilityService, marker:document.documentElement.dataset.applioDesktop};
  })()`,
  });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  const value = result.result.value;
  assert.equal(value.platform, "win32");
  assert.equal(value.status, "stopped");
  assert.equal(value.updater, release ? "idle" : "dev-mode");
  assert.equal(typeof value.maximized, "boolean");
  assert.equal(value.hotkey, true);
  assert.equal(value.denied, true);
  assert.equal(value.invalidSetupDenied, true);
  assert.equal(value.marker, "true");
  assert.equal(value.service, "applio-rust-api");
  assert.equal(value.runtime, "rust");
  assert.equal(value.compatibilityService, false);
  assert.equal(value.browserCommandsBlocked, true);
  assert.equal(value.editingPreserved, true);
  assert.equal(value.contextMenuBlocked, true);
  assert.equal(launcherOutput.includes("Could not disable native browser commands"), false, launcherOutput);
  if (permissions) {
    const media = await call("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      expression: `(async()=>{
        // Only fake capture devices are enabled; browser permission UI is not
        // bypassed by Chromium flags or a CDP permission override.
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        const tracks=stream.getAudioTracks();
        const captured=tracks.length===1 && tracks[0].readyState==='live';
        for(const track of stream.getTracks())track.stop();
        const policy=document.permissionsPolicy || document.featurePolicy;
        return {captured,cameraDenied:!policy.allowsFeature('camera'),
          microphoneOrigins:policy.getAllowlistForFeature('microphone')};
      })()`,
    });
    assert.equal(media.exceptionDetails, undefined, JSON.stringify(media.exceptionDetails));
    assert.equal(media.result.value.captured, true);
    assert.equal(media.result.value.cameraDenied, true);
    assert.deepEqual(media.result.value.microphoneOrigins, ["http://127.0.0.1:3000"]);
    console.log(
      "Native microphone permission passed without browser UI; cross-origin capture remains blocked.",
    );
  }
  if (process.argv.includes("--dashboard")) await checkDashboard(call);
  await call("Page.navigate", { url: "http://127.0.0.1:3000/realtime" });
  let formantControls = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const check = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const toggle = document.getElementById('rt-formant-shifting');
        if (!toggle) return false;
        toggle.closest('details').open = true;
        if (!document.getElementById('rt-formant-qfrency')) { toggle.click(); return false; }
        return !!document.getElementById('rt-formant-timbre') && !document.getElementById('rt-post-process') && !document.getElementById('rt-clean-audio');
      })()`,
    });
    if (check.result?.value === true) {
      formantControls = true;
      break;
    }
    await delay(100);
  }
  assert.equal(formantControls, true, "Realtime formant controls must replace the retired FX controls");
  if (process.argv.includes("--dashboard")) await checkTrayHeartbeat(call);
  if (startupRetry) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    assert.equal(
      targets.some(
        (target) =>
          target.type === "page" &&
          (target.url.includes("tauri.localhost") || target.url.startsWith("tauri://")),
      ),
      false,
      "The splash must close after the main interface loads",
    );
  }
  console.log("Tauri WebView2 smoke check passed:", JSON.stringify(value));
} finally {
  socket?.close();
  loadingSocket?.close();
  if (blocker?.listening) await new Promise((resolve) => blocker.close(resolve));
  // Test-only process tree; closing the native window normally hides it to tray.
  await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(processHandle.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("exit", resolve);
    killer.once("error", resolve);
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
      break;
    } catch {
      await delay(250);
    }
  }
}
