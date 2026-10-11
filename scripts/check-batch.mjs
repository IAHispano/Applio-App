import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/api/package.json"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "applio-batch-check-"));
const state = { jobs: new Map(), calls: [], fallbacks: 0 };
globalThis.__batchTest = state;
const stubs = {
  cli: "export function trackPid() {}",
  setup: "export const requireEngineReady = (_req, _res, next) => next();",
  scheduler: "export async function acquireJobSlot() { return true; } export function releaseJobSlot() {}",
  jobs: `const state = globalThis.__batchTest;
    export function createJob(kind, params) { const job = { id: String(state.jobs.size), status: 'queued', params, logs: [] }; state.jobs.set(job.id, job); return job; }
    export function getJob(id) { return state.jobs.get(id); }
    export function appendLog(job, log) { job.logs.push(log); }
    export function setRunning(job) { job.status = 'running'; }
    export function setProgress(job, progress) { job.progress = progress; }
    export function setDone(job, result, output) { Object.assign(job, { status: 'done', result, output }); }
    export function setError(job, error) { Object.assign(job, { status: 'error', error }); }`,
  python: `import fs from 'node:fs'; import path from 'node:path';
    export function resolveUserPath(p) { return path.resolve(p); }
    export function getRepoRoot() { return ${JSON.stringify(temporary)}; }
    export async function runPythonModule(args) { globalThis.__batchTest.fallbacks++; const output = args[args.indexOf('--output-path') + 1]; fs.writeFileSync(output, 'fallback'); return { code: 0, stdout: '', stderr: '' }; }`,
  worker: `import fs from 'node:fs';
    export const inferenceWorker = { async infer(id, params, input, output) {
      globalThis.__batchTest.calls.push({ id, model: params.pthPath, index: params.indexPath, input, output });
      if (params.pthPath.includes('fallback')) throw new Error('fixture fallback');
      if (input.includes('cancel')) { globalThis.__batchTest.jobs.get(id).status = 'error'; throw new Error('cancelled'); }
      fs.writeFileSync(output, 'converted'); return { outputPath: output };
    } };`,
};
let server;
try {
  const bundle = path.join(temporary, "route.cjs");
  await require("esbuild").build({
    entryPoints: [path.join(root, "backend/api/src/routes/batch.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    tsconfig: path.join(root, "backend/api/tsconfig.json"),
    plugins: [
      {
        name: "fixtures",
        setup(build) {
          build.onResolve({ filter: /^@\/(cli|setup|scheduler|jobs|python|worker)$/ }, (args) => ({
            path: args.path.slice(2),
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/batch", require(bundle).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const source = path.join(temporary, "inputs");
  fs.mkdirSync(source);
  for (const file of ["voice.wav", "voice.mp3", "ignore.txt"])
    fs.writeFileSync(path.join(source, file), "fixture");
  const models = ["a", "b", "fallback"].map((dir) => {
    const folder = path.join(temporary, dir);
    fs.mkdirSync(folder);
    const pthPath = path.join(folder, "voice.pth");
    const indexPath = path.join(folder, "voice.index");
    fs.writeFileSync(pthPath, "fixture");
    fs.writeFileSync(indexPath, "fixture");
    return { pthPath, indexPath };
  });
  const post = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function run(body, expectedCalls) {
    const before = state.calls.length;
    const response = await post({
      inputFolder: source,
      outputFolder: path.join(temporary, "outputs"),
      ...body,
    });
    assert.equal(response.status, 202, await response.clone().text());
    const { jobId } = await response.json();
    for (let i = 0; i < 100 && state.jobs.get(jobId).status !== "done"; i++) await delay(10);
    const job = state.jobs.get(jobId);
    assert.equal(job.status, "done", job.error);
    const calls = state.calls.slice(before);
    assert.equal(calls.length, expectedCalls);
    assert.equal(job.progress, 100);
    assert.equal(new Set(calls.map((call) => call.output)).size, expectedCalls);
    assert.ok(calls.every((call) => fs.existsSync(call.output)));
    return calls;
  }
  await run({ ...models[0] }, 2); // Legacy request remains Mode 1.
  const calls = await run(
    { mode: "models", models: models.slice(0, 2), inputPath: path.join(source, "voice.wav") },
    2,
  );
  assert.deepEqual(
    calls.map((call) => call.index),
    models.slice(0, 2).map((model) => model.indexPath),
  );
  await run({ mode: "both", models: models.slice(0, 2) }, 4);
  await run({ mode: "models", models: [models[2]], inputPath: path.join(source, "voice.wav") }, 1);
  assert.equal(state.fallbacks, 1);
  for (const body of [
    {},
    { mode: "models", models: [] },
    { mode: "both", models: [{ pthPath: "missing" }], inputFolder: source },
    { mode: "files", ...models[0], inputFolder: path.join(source, "voice.wav") },
    { mode: "models", models: [models[0]], inputPath: path.join(source, "ignore.txt") },
    { mode: "models", models: [{ pthPath: source }], inputPath: path.join(source, "voice.wav") },
    {
      mode: "models",
      models: [{ ...models[0], indexPath: source }],
      inputPath: path.join(source, "voice.wav"),
    },
  ]) {
    const response = await post({ outputFolder: path.join(temporary, "outputs"), ...body });
    assert.equal(response.status, 400);
  }
  const cancelled = path.join(temporary, "cancel.wav");
  fs.writeFileSync(cancelled, "fixture");
  const response = await post({
    mode: "models",
    models: models.slice(0, 2),
    inputPath: cancelled,
    outputFolder: path.join(temporary, "outputs"),
  });
  const { jobId } = await response.json();
  await delay(30);
  assert.equal(state.jobs.get(jobId).status, "error");
  assert.equal(state.calls.filter((call) => call.id === jobId).length, 1);
  console.log(
    "All three batch modes, matching indexes, filename collisions, validation, CLI fallback and cancellation passed.",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  // Only remove the exact directory created above in the system temp folder.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  fs.rmSync(temporary, { recursive: true, force: true });
  delete globalThis.__batchTest;
}
