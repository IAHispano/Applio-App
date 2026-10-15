// Automated, headless navigation against the exported UI and real Rust HTTP host.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(new URL("../frontend/desktop/package.json", import.meta.url));
const WebSocket = require("ws");

export async function checkBrowser(origin, temporary) {
  const executable =
    process.env.APPLIO_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  assert.ok(fs.existsSync(executable), "Set APPLIO_TEST_BROWSER to a Chromium executable");
  const profile = path.join(temporary, "headless-browser");
  const browser = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let socket;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await delay(100);
    assert.ok(fs.existsSync(portFile), "Headless browser failed to start");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let sequence = 0;
    const pending = new Map();
    const failures = [];
    const components = [];
    socket.on("message", (bytes) => {
      const event = JSON.parse(bytes);
      if (event.method === "Runtime.exceptionThrown") failures.push(event.params.exceptionDetails);
      if (event.method === "Network.responseReceived" && event.params.response.url.includes(".txt"))
        components.push(event.params.response);
      const request = pending.get(event.id);
      if (request) {
        pending.delete(event.id);
        event.error ? request.reject(event.error) : request.resolve(event.result);
      }
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    const until = async (expression, message) => {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression)) return;
        await delay(100);
      }
      throw new Error(`${message}: ${await evaluate("document.body?.innerText?.slice(-1000)")}`);
    };
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Network.enable");
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      localStorage.setItem('applio:terms-accepted','true');
      window.__navigationDocument = Math.random();
      window.applio = {onNavigate: listener => {window.__navigate = listener; return ()=>{};}};
    `,
    });
    await call("Page.navigate", { url: origin });
    await until("!!window.__navigate && !!document.querySelector('#main-content')", "UI failed to hydrate");
    const documentId = await evaluate("window.__navigationDocument");
    for (const route of [
      "/models",
      "/inference",
      "/tts",
      "/train",
      "/extra",
      "/audio-separator",
      "/voice-blender",
      "/tensorboard",
      "/jobs",
      "/jobs/view?id=fixture-job",
      "/settings",
      "/report",
      "/realtime",
      "/",
    ]) {
      await evaluate(`window.__navigate(${JSON.stringify(route)})`);
      await until(
        `location.pathname+location.search===${JSON.stringify(route)} && !!document.querySelector('#main-content')`,
        `SPA navigation failed for ${route}`,
      );
      await delay(150);
      assert.equal(
        await evaluate("window.__navigationDocument"),
        documentId,
        `Unexpected full reload: ${route}`,
      );
      assert.equal(
        await evaluate("document.body.innerText.includes('Application error: a client-side exception')"),
        false,
        route,
      );
    }
    assert.ok(components.length >= 10, "Navigation must fetch exported React components");
    for (const response of components) assert.equal(response.status, 200, response.url);
    assert.deepEqual(failures, [], "Uncaught browser exceptions");
    // A legacy URL must survive a direct load and preserve the job id.
    await call("Page.navigate", { url: `${origin}/jobs/legacy-job` });
    await until(
      "location.pathname==='/jobs/view' && new URLSearchParams(location.search).get('id')==='legacy-job' && !!window.__navigate",
      "Legacy job navigation failed",
    );
    console.log(
      "Headless static UI: SPA navigation, component responses, hydration and legacy job links passed.",
    );
    // Exercise the actual React update dialog with an isolated native bridge fixture.
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      const listeners = new Set();
      const fixture = window.__updates = {checks:0,downloads:0,installs:0,listeners:0,status:{status:'idle'}};
      const emit = status => {fixture.status=status;for(const listener of listeners)listener(status);};
      window.applio.updater = {
        getStatus:async()=>fixture.status,
        check:async()=>{fixture.checks++;emit({status:'available'});},
        download:async()=>{
          fixture.downloads++;emit({status:'downloading',percent:50});
          if(sessionStorage.getItem('update-fail')==='1')throw new Error('fixture download failed');
          emit({status:'downloaded',version:'0.2.10'});
        },
        quitAndInstall:()=>{fixture.installs++;},
        onStatusChange:listener=>{listeners.add(listener);fixture.listeners=listeners.size;return()=>{listeners.delete(listener);fixture.listeners=listeners.size;};}
      };
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input.url||input,location.href);
        const respond=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
        if(url.pathname==='/api/settings/language')return respond({code:'en_US',dict:{}});
        if(url.pathname==='/api/settings/version-check')return respond({local:'0.2.9',latest:'0.2.10',status:'behind',versionsBehind:1,isOutdated:false,isDev:false});
        if(url.pathname==='/api/settings/apply-update')return respond({success:false,method:'manual',message:'Fixture manual update failed'});
        return originalFetch(input,init);
      };
    `,
    });
    await call("Page.navigate", { url: origin });
    await until(
      "document.body?.innerText.includes('Applio Update Available') && window.__updates.checks===1",
      "Update dialog failed to initialize",
    );
    await delay(1500);
    assert.equal(
      await evaluate("window.__updates.checks"),
      1,
      "Setting version data must not repeat update checks",
    );
    assert.equal(
      await evaluate("window.__updates.listeners"),
      1,
      "Only one updater subscription should remain",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update now').click()",
    );
    await until(
      "document.body.innerText.includes('Update ready to install.')",
      "Download completion was overwritten by a downloading message",
    );
    assert.equal(await evaluate("window.__updates.downloads"), 1);
    assert.equal(await evaluate("window.__updates.installs"), 0);
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Restart & Apply').click()",
    );
    assert.equal(await evaluate("window.__updates.installs"), 1);
    await evaluate("sessionStorage.setItem('update-fail','1')");
    await call("Page.reload");
    await until(
      "document.body?.innerText.includes('Applio Update Available') && window.__updates.checks===1",
      "Update retry fixture failed to initialize",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update now').click()",
    );
    await until(
      "document.body.innerText.includes('Fixture manual update failed')",
      "Failed fallback must remain an error",
    );
    assert.equal(await evaluate("window.__updates.installs"), 0);
    console.log(
      "Update dialog passed: one subscription/check, download completion, explicit install, failed fallback.",
    );
    await call("Browser.close");
  } finally {
    socket?.close();
    if (browser.exitCode === null) {
      const closed = new Promise((resolve) => browser.once("close", resolve));
      browser.kill();
      await Promise.race([closed, delay(5000)]);
      if (browser.exitCode === null) browser.kill("SIGKILL");
    }
  }
}
