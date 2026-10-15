// Regression scenarios injected only into the isolated WebView2 smoke process.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function checkTrayHeartbeat(call) {
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const injected = await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const original = window.applio;
      window.__trayTest = {reports:[]};
      window.applio = {...original,reportRealtimeState:value=>{
        window.__trayTest.reports.push({at:performance.now(),value});
        return original.reportRealtimeState(value);
      }};
    })()`,
  });
  try {
    await call("Page.reload", {});
    let mounted = false;
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          "!!document.getElementById('rt-monitor-enabled') && window.__trayTest?.reports.length>0",
        )
      ) {
        mounted = true;
        break;
      }
      await delay(100);
    }
    assert.ok(mounted, "Realtime must mount with the instrumented test bridge");
    await evaluate("window.__trayTest.reports=[]");
    await delay(6200);
    const count = await evaluate("window.__trayTest.reports.length");
    assert.ok(
      count >= 1 && count <= 2,
      `Unchanged tray state should have a five-second heartbeat: ${count} reports in 6.2 seconds`,
    );
    const expected = await evaluate(`(() => {
      const toggle=document.getElementById('rt-monitor-enabled');
      toggle.closest('details').open=true;
      const before=toggle.checked; window.__trayTest.reports=[]; toggle.click(); return !before;
    })()`);
    let immediate = false;
    for (let i = 0; i < 10; i++) {
      if (await evaluate(`window.__trayTest.reports.some(r=>r.value?.monitor===${expected})`)) {
        immediate = true;
        break;
      }
      await delay(50);
    }
    assert.ok(
      immediate,
      "Monitor changes must update the tray immediately instead of waiting for a heartbeat",
    );
    console.log("Tray idle heartbeat and immediate control update checks passed.");
  } finally {
    await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
  }
}

export async function checkDashboard(call) {
  await call("Page.enable", {});
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const until = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    const state = await evaluate(
      "({text:(document.body?.innerText || String()).slice(0,3500),fixture:window.__dashboardTest})",
    );
    throw new Error(`${message}: ${JSON.stringify(state)}`);
  };
  const injected = await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const original = window.fetch.bind(window);
      const fixture = window.__dashboardTest = {
        setupFails: sessionStorage.getItem('dashboard-failure') === '1',
        voice: 'Dashboard fixture voice', versionRequests: 0, forcedChecks: 0,
        versionReleased: false, releaseVersion: () => {}, requests: []
      };
      const response = (value, status=200) => new Response(JSON.stringify(value), {
        status, headers: {'content-type':'application/json'}
      });
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
        fixture.requests.push(url.pathname + url.search);
        switch (url.pathname) {
          case '/api/settings/language': return response({code:'en_US',dict:{}});
          case '/api/setup/status':
            if (url.searchParams.get('refresh') === '1') fixture.forcedChecks++;
            return fixture.setupFails ? response({error:'Fixture API unavailable'},503)
              : response({ready:true,checks:[],checkedAt:new Date().toISOString()});
          case '/api/models': return response({models:['fixture.pth'],indexes:[],audios:[]});
          case '/api/models/library': return response({models:[{
            pthPath:'fixture.pth',name:fixture.voice,indexPath:null,modifiedAt:new Date().toISOString()
          }]});
          case '/api/report/info': return response({version:'0.2.9',platform:'win32',runtime:'rust',python:'fixture',cpus:12,totalMemGB:32});
          case '/api/jobs/activity': return response({jobs:[]});
          case '/api/settings/version-check': {
            fixture.versionRequests++;
            return new Promise((resolve,reject) => {
              const abort = () => reject(new DOMException('Aborted','AbortError'));
              if (init?.signal?.aborted) { abort(); return; }
              init?.signal?.addEventListener('abort',abort,{once:true});
              const previous = fixture.releaseVersion;
              fixture.releaseVersion = () => {
                previous(); fixture.versionReleased=true;
                init?.signal?.removeEventListener('abort',abort);
                resolve(response({local:'v0.2.9',latest:'v0.3.9',status:'behind',versionsBehind:3,isDev:false}));
              };
            });
          }
          default: return original(input,init);
        }
      };
    })();`,
  });
  try {
    await call("Page.navigate", { url: "http://127.0.0.1:3000/" });
    await until(
      "(document.body?.innerText || String()).includes('Dashboard fixture voice') && window.__dashboardTest?.versionRequests > 0 && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Refresh' && !b.disabled)",
      "Local dashboard content and Refresh must be ready while the version request remains pending",
    );
    assert.equal(await evaluate("window.__dashboardTest.versionReleased"), false);
    await evaluate("window.__dashboardTest.releaseVersion()");
    await until(
      "(document.body?.innerText || String()).includes('v0.3.9')",
      "The deferred update banner must still appear",
    );

    await evaluate(`sessionStorage.setItem('dashboard-failure','1')`);
    await call("Page.reload", {});
    await until(
      "(document.body?.innerText || String()).includes('Fixture API unavailable') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry Connection' && !b.disabled)",
      "Initial API failure must show a retry action instead of an endless skeleton",
    );
    await evaluate(`window.__dashboardTest.setupFails=false;
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry Connection').click()`);
    await until(
      "(document.body?.innerText || String()).includes('Dashboard fixture voice') && !(document.body?.innerText || String()).includes('Fixture API unavailable') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Refresh'&&!b.disabled)",
      "Retry must recover the dashboard without restarting the application",
    );
    assert.equal(await evaluate("window.__dashboardTest.forcedChecks"), 1);
    await evaluate(`window.__dashboardTest.setupFails=true;
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Refresh').click()`);
    await until(
      "window.__dashboardTest.forcedChecks===2 && (document.body?.innerText || String()).includes('Fixture API unavailable')",
      "A second forced check must reach the API rather than reuse the previous cached success",
    );
    console.log("Dashboard deferred updates, connection failure, retry and forced-refresh checks passed.");
  } finally {
    await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
    await evaluate("sessionStorage.removeItem('dashboard-failure')");
  }
}
