const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const express = require("express");
const esbuild = require("esbuild");

test("training routes verify epoch exports and accept a silent existing index", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "applio-training-routes-"));
  const logs = path.join(root, "custom logs");
  const dataset = path.join(root, "dataset");
  fs.mkdirSync(logs);
  fs.mkdirSync(dataset);
  const state = { root, logs, jobs: new Map(), calls: [], exportModel: true, failIndex: false };
  globalThis.__applioTrainingTest = state;
  t.after(() => {
    delete globalThis.__applioTrainingTest;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const stubs = {
    jobs: `
      const s = globalThis.__applioTrainingTest;
      export function createJob(type, params) { const j = {id:String(s.jobs.size),type,params,status:'queued',logs:[]}; s.jobs.set(j.id,j); return j; }
      export const getJob = id => s.jobs.get(id);
      export const listJobs = () => [...s.jobs.values()];
      export const appendLog = (j,line) => j.logs.push(line);
      export const setRunning = j => j.status = 'running';
      export const setDone = (j,result,outputFile) => Object.assign(j,{status:'done',result,outputFile});
      export const setError = (j,error) => Object.assign(j,{status:'error',error});
      export const setProgress = () => {};
      export const cancelJob = () => {};
    `,
    python: `
      import path from 'node:path';
      const s = globalThis.__applioTrainingTest;
      export const getLogsDir = () => s.logs;
      export const getRepoRoot = () => s.root;
      export const getUploadsDir = () => s.root;
      export const resolveUserPath = value => path.resolve(value);
    `,
    setup: "export const assertEngineReady = async () => {};",
    scheduler: "export const acquireJobSlot = async () => true; export const releaseJobSlot = () => {};",
    pretraineds:
      "export const resolvePretrained = () => ['', '']; export const defaultPretrainedPaths = () => ['', '']; export const pretrainedFileReady = () => true;",
    cli: `
      import fs from 'node:fs'; import path from 'node:path';
      import {createJob,setRunning,setDone,setError} from '@/jobs';
      const s = globalThis.__applioTrainingTest;
      async function run(j,args) {
        s.calls.push(args);
        const name = j.params.modelName, dir = path.join(s.logs,name);
        fs.mkdirSync(dir,{recursive:true});
        const script = path.basename(args[0]);
        if(script === 'train.py') {
          if(s.exportModel) fs.writeFileSync(path.join(dir,name+'_'+j.params.totalEpoch+'e_35000s.pth'),'voice export');
          return 'Model '+name+' trained successfully.';
        }
        if(script === 'extract_index.py') {
          if(s.failIndex) throw new Error('Index failed (exit code 1): test engine failure');
          const file = path.join(dir,name+'.index');
          if(fs.existsSync(file)) return '';
          fs.writeFileSync(file,'index');
          return 'Index file for '+name+' generated successfully.';
        }
        return 'Model '+name+(script === 'preprocess.py' ? ' preprocessed' : ' extracted')+' successfully.';
      }
      export async function runJobStep(j,args,expected) { const out=await run(j,args); if(expected && !out.includes(expected)) throw new Error('Missing success marker'); }
      export function startCliJob(type,params,args,opts) {
        const j=createJob(type,params); setRunning(j);
        void run(j,args).then(out => {
          if(opts.expectSuccess && !out.includes(opts.expectSuccess)) throw new Error('Job reported failure');
          const parsed=opts.parse?.(out,'');
          const file=parsed?.outputFile;
          setDone(j,parsed?.result,file ? 'logs/'+path.relative(s.logs,file).split(path.sep).join('/') : undefined);
        }).catch(error => setError(j,error.message)); return j;
      }
      export const trackPid = () => {}; export const killJobTree = () => {}; export const runPythonJson = async () => ({});
    `,
  };
  const build = await esbuild.build({
    entryPoints: [path.join(__dirname, "../src/routes/train.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    tsconfig: path.join(__dirname, "../tsconfig.json"),
    plugins: [
      {
        name: "engine-fixture",
        setup(build) {
          build.onResolve({ filter: /^@\/(cli|jobs|python|setup|scheduler|pretraineds)$/ }, (args) => ({
            path: args.path.slice(2),
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const compiled = new Module(__filename, module);
  compiled.filename = __filename;
  compiled.paths = module.paths;
  compiled._compile(build.outputFiles[0].text, __filename);
  const app = express();
  app.use(express.json());
  app.use("/train", compiled.exports.default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function run(route, params) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/train/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = await response.json();
    assert.equal(response.status, 202, JSON.stringify(body));
    for (let i = 0; i < 100; i++) {
      const job = state.jobs.get(body.jobId);
      if (["done", "error"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Job did not finish");
  }
  for (const route of ["pipeline", "train"]) {
    const name = `voice_${route}`;
    const job = await run(route, {
      modelName: name,
      datasetPath: dataset,
      pretrained: false,
      totalEpoch: 200,
    });
    assert.equal(job.status, "done", job.error);
    assert.equal(job.outputFile, `logs/${name}/${name}_200e_35000s.pth`);
    const retry = await run("index", { modelName: name });
    assert.equal(retry.status, "done", retry.error);
    assert.equal(retry.outputFile, `logs/${name}/${name}.index`);
  }
  state.exportModel = false;
  const missing = await run("train", { modelName: "missing", pretrained: false });
  assert.equal(missing.status, "error");
  assert.match(missing.error, /did not save a new voice model/);
  assert.ok(
    !state.calls.some((args) => path.basename(args[0]) === "extract_index.py" && args[1].endsWith("missing")),
  );
  const count = state.calls.length;
  assert.equal((await run("index", { modelName: "skip", indexAlgorithm: "Skip" })).status, "done");
  assert.equal(state.calls.length, count);
  state.failIndex = true;
  const failed = await run("index", { modelName: "voice_train" });
  assert.equal(failed.status, "error");
  assert.match(failed.error, /exit code 1/);
});
