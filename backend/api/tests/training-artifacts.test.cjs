const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
let artifacts;

before(async () => {
  const build = await esbuild.build({
    entryPoints: [path.join(__dirname, "../src/lib/training-artifacts.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
  });
  const compiled = new Module(__filename, module);
  compiled.filename = __filename;
  compiled.paths = module.paths;
  compiled._compile(build.outputFiles[0].text, __filename);
  artifacts = compiled.exports;
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "applio-training-artifacts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, content = "test artifact") => fs.writeFileSync(path.join(directory, name), content);
  return { directory, write };
}

test("the final epoch/step voice export is selected instead of requiring a bare model filename", (t) => {
  const { directory, write } = fixture(t);
  const before = artifacts.modelArtifacts(directory);
  for (const name of [
    "G_2333333.pth",
    "D_2333333.pth",
    "mau777pi2_10e_1750s.pth",
    "mau777pi2_200e_35000s.pth",
  ])
    write(name);
  assert.equal(
    artifacts.trainedModelArtifact(directory, "mau777pi2", before, 200),
    path.join(directory, "mau777pi2_200e_35000s.pth"),
  );
});

test("old exports, incomplete epochs, checkpoints and empty files cannot hide a failed final export", (t) => {
  const { directory, write } = fixture(t);
  write("voice_200e_35000s.pth");
  write("voice.pth");
  const before = artifacts.modelArtifacts(directory);
  write("G_2333333.pth");
  write("D_2333333.pth");
  write("voice_190e_33000s.pth");
  write("voice_200e_36000s.pth", "");
  write("other_200e_35000s.pth");
  assert.throws(
    () => artifacts.trainedModelArtifact(directory, "voice", before, 200),
    /did not save a new voice model/,
  );
});

test("legacy exports and names containing underscores or punctuation are supported", (t) => {
  const { directory, write } = fixture(t);
  const before = artifacts.modelArtifacts(directory);
  write("voice.take_2.pth");
  assert.equal(
    artifacts.trainedModelArtifact(directory, "voice.take_2", before, 200),
    path.join(directory, "voice.take_2.pth"),
  );
  write("voice.take_2_200e_35000s.pth");
  write("voice.take_2_200e_35001s.pth");
  assert.equal(
    artifacts.trainedModelArtifact(directory, "voice.take_2", before, 200),
    path.join(directory, "voice.take_2_200e_35001s.pth"),
  );
});

test("an existing nonempty index is accepted; missing, empty and directory artifacts fail", (t) => {
  const { directory, write } = fixture(t);
  assert.throws(() => artifacts.indexArtifact(directory, "voice"), /no usable index/);
  write("voice.index", "");
  assert.throws(() => artifacts.indexArtifact(directory, "voice"), /no usable index/);
  write("voice.index");
  assert.equal(artifacts.indexArtifact(directory, "voice"), path.join(directory, "voice.index"));
  fs.mkdirSync(path.join(directory, "folder.index"));
  assert.throws(() => artifacts.indexArtifact(directory, "folder"), /no usable index/);
});
