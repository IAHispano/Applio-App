import assert from "node:assert/strict";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export async function checkStartupPage(call) {
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  await call("Page.navigate", { url: "about:blank" });
  for (let i = 0; i < 50; i++) {
    if (await evaluate("location.href==='about:blank' && document.readyState==='complete'")) break;
    await delay(50);
  }
  await evaluate(`(() => {
    const fixture = window.__startupFixture = {retries:0};
    window.__TAURI__ = {
      event: {listen: async (_, listener) => { fixture.listener=listener; }},
      core: {invoke: command => {
        if(command==='startup_error') return new Promise(resolve => { fixture.initial=resolve; });
        if(command==='retry_startup') {
          fixture.retries++; return new Promise((_,reject) => {fixture.reject=reject;});
        }
        throw new Error(command);
      }}
    };
  })()`);
  const { frameTree } = await call("Page.getFrameTree", {});
  await call("Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: fs.readFileSync(new URL("../frontend/desktop/ui/index.html", import.meta.url), "utf8"),
  });
  assert.equal(await evaluate("document.getElementById('startup-error').hidden"), true);
  assert.equal(await evaluate("!!document.querySelector('[role=progressbar],.splash,.bar')"), false);
  await evaluate(`window.__startupFixture.listener({payload:'Fixture startup failure'});
    window.__startupFixture.initial('Stale startup failure')`);
  assert.equal(await evaluate("document.getElementById('error').textContent"), "Fixture startup failure");
  assert.equal(await evaluate("document.getElementById('startup-error').hidden"), false);
  await evaluate("document.getElementById('retry').click()");
  assert.equal(await evaluate("document.getElementById('retry').disabled && window.__startupFixture.retries===1"), true);
  await evaluate("window.__startupFixture.reject('Fixture retry failure')");
  assert.equal(await evaluate("document.getElementById('error').textContent"), "Fixture retry failure");
  assert.equal(await evaluate("document.getElementById('retry').disabled"), false);
  console.log("Startup fallback passed: no loader, error details, stale-result protection and retry.");
}
