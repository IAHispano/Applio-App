const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const esbuild = require("esbuild");

test("inference fallback uses the app adapter across separate code/data directories", async () => {
  const build = await esbuild.build({
    entryPoints: [path.join(__dirname, "../src/python.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    tsconfig: path.join(__dirname, "../tsconfig.json"),
  });
  const compiled = new Module(__filename, module);
  compiled.filename = __filename;
  compiled.paths = module.paths;
  compiled._compile(build.outputFiles[0].text, __filename);
  const { resolvePythonArgs } = compiled.exports;
  const oldRoot = process.env.APPLIO_CODE_ROOT;
  try {
    const code = path.resolve(__dirname, "../../..");
    process.env.APPLIO_CODE_ROOT = code;
    assert.deepEqual(resolvePythonArgs(["rvc/infer/infer.py", "--protect", "0.33", "--split-audio"]), [
      path.join(code, "tools/inference_runtime.py"),
      "infer",
      "--protect",
      "0.33",
      "--split-audio",
    ]);
    assert.deepEqual(resolvePythonArgs(["rvc\\infer\\infer.py", "--input-path", "voice.wav"]), [
      path.join(code, "tools/inference_runtime.py"),
      "infer",
      "--input-path",
      "voice.wav",
    ]);
    assert.deepEqual(resolvePythonArgs(["-m", "pip", "--version"]), ["-m", "pip", "--version"]);
  } finally {
    if (oldRoot === undefined) delete process.env.APPLIO_CODE_ROOT;
    else process.env.APPLIO_CODE_ROOT = oldRoot;
  }
});
