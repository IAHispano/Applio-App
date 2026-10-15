import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Runs against the isolated exported UI, without loading voice weights or using
// the user's engine. Interactions exercise the actual React controls and router.
export async function checkResponsiveness(call, origin) {
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
    throw new Error(`${message}: ${JSON.stringify(await evaluate("({text:document.body?.innerText?.slice(0,2500),fixture:window.__responsive})"))}`);
  };
  const injected = await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const original = window.fetch.bind(window);
      const fixture = window.__responsive = {modelReads:0, inspections:0, holdJobs:false, pendingJobs:[]};
      fixture.releaseJobs = () => { fixture.holdJobs=false; fixture.pendingJobs.splice(0).forEach(resolve=>resolve()); };
      const response = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url || input, location.href);
        switch (url.pathname) {
          case '/api/settings/language': return response({code:'en_US',dict:{}});
          case '/api/setup/status': return response({ready:true,checks:[],checkedAt:new Date().toISOString()});
          case '/api/models': fixture.modelReads++; return response({models:['fixture.pth'],indexes:[],audios:[]});
          case '/api/models/library': return response({models:[{pthPath:'fixture.pth',name:'Fixture voice',pthSize:1024}]});
          case '/api/models/inspect': fixture.inspections++; return response({ok:true,metadata:{version:'v2',sr:'40000',speakers_id:1}});
          case '/api/models/speakers': return response({speakers:[0]});
          case '/api/models/preload': return response({ok:true});
          case '/api/tts/voices': return response({voices:[{shortName:'fixture',friendlyName:'Fixture voice',locale:'en-US',gender:'Female'}]});
          case '/api/tts': return response({jobId:'responsive-tts'});
          case '/api/jobs/responsive-tts':
            if (fixture.holdJobs) await new Promise(resolve=>fixture.pendingJobs.push(resolve));
            return response({job:{id:'responsive-tts',type:'tts',status:'done',createdAt:new Date().toISOString(),logs:[],outputFile:'responsive.wav'}});
          case '/api/train/datasets': return response({datasets:[]});
          case '/api/train/pretraineds': return response({g:[],d:[]});
          case '/api/train/gpus': return response({count:0,info:'No compatible GPU',devices:[]});
          case '/api/report/info': return response({version:'0.2.10',platform:'win32',runtime:'rust',cpus:8,totalMemGB:16});
          case '/api/settings/version-check': return response({local:'v0.2.10',latest:'v0.2.10',status:'current',isDev:false});
          default: return original(input,init);
        }
      };
    })()`,
  });
  const navigate = async (path, ready) => {
    await evaluate(`document.querySelector('a[href="${path}"]').click()`);
    await until(`location.pathname===${JSON.stringify(path)} && (${ready})`, `Navigation to ${path}`);
  };
  const input = async (id, value) => {
    await evaluate(`(() => {
      const field=document.getElementById(${JSON.stringify(id)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field),'value').set.call(field,${JSON.stringify(value)});
      field.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
  };
  try {
    await call("Page.navigate", { url: `${origin}/` });
    await until("!!window.__navigate && !!document.querySelector('.page-transition a[href=\"/inference\"]')", "Homepage ready");
    const documentId = await evaluate("window.__navigationDocument");
    // This is the shared Button on the home page, not the sidebar's existing Link.
    await evaluate("document.querySelector('.page-transition a[href=\"/inference\"]').click()");
    await until("location.pathname==='/inference' && !!document.querySelector('[id^=voice-model-]') && window.__responsive.modelReads===1", "Inference ready");
    assert.equal(await evaluate("window.__navigationDocument"), documentId, "Home action must navigate without reloading");
    await navigate("/tts", "!!document.getElementById('tts-text-input')");
    await until("window.__responsive.inspections>0 && !!document.getElementById('tts-voice-select')", "Model inspection ready");
    await input("tts-text-input", "Keep this draft when I switch tabs.");
    await until("document.getElementById('tts-text-input').value.includes('Keep this draft')", "TTS input updated");
    await until("!!document.querySelector('.page-transition button[type=submit]:not(:disabled)')", "TTS action ready");
    await evaluate("document.querySelector('.page-transition button[type=submit]').click()");
    await until("document.body.innerText.includes('Synthesized Speech Output')", "Completed TTS result shown");
    await navigate("/train", "!!document.getElementById('train-model-name')");
    await input("train-model-name", "PreservedProject");
    await evaluate("document.getElementById('main-content').scrollTop=300");
    await delay(150);
    const scroll = await evaluate("document.getElementById('main-content').scrollTop");
    assert.ok(scroll > 0, "Training fixture must have scrollable content");
    await evaluate("window.__responsive.holdJobs=true");
    await navigate("/tts", "!!document.getElementById('tts-text-input')");
    assert.equal(await evaluate("document.getElementById('tts-text-input').value"), "Keep this draft when I switch tabs.");
    await until("window.__responsive.pendingJobs.length>0 && document.body.innerText.includes('Synthesized Speech Output')", "Result restored while job revalidation remains pending");
    await evaluate("window.__responsive.releaseJobs()");
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await delay(150);
    const reads = await evaluate("window.__responsive.modelReads");
    assert.equal(reads, 1, "Mounts and focus must reuse the shared model list");
    await evaluate("document.querySelector('[id^=voice-model-][role=combobox]').click()");
    await until("!!document.querySelector('[role=option]')", "Model picker opened");
    assert.equal(await evaluate("window.__responsive.modelReads"), reads, "Opening a picker must not force a filesystem scan");
    await evaluate("document.querySelector('[id^=voice-model-][role=combobox]').click()");
    await evaluate("document.querySelector('button[aria-label=Refresh]').click()");
    await until(`window.__responsive.modelReads===${reads + 1}`, "Explicit refresh must rescan models");
    await navigate("/train", "!!document.getElementById('train-model-name')");
    assert.equal(await evaluate("document.getElementById('train-model-name').value"), "PreservedProject");
    await until(`Math.abs(document.getElementById('main-content').scrollTop-${scroll})<2`, "Training scroll restored");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.page-transition')).animationName"), "none");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.page-transition').firstElementChild).animationName"), "none");
    assert.equal(await evaluate("window.__navigationDocument"), documentId, "Tab switches must keep the document alive");
    console.log("Responsiveness: home navigation, tab drafts/scroll, cached model lists, explicit refresh and immediate pages passed.");
  } finally {
    await evaluate("localStorage.removeItem('applio:job:tts')");
    await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
  }
}
