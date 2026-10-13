const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { test } = require("node:test");

test("dataset review API scans real audio, prepares a curated copy, and rejects stale or unknown selections", {
  timeout: 60000,
}, async (t) => {
  const root = path.resolve(__dirname, "../../..");
  const python =
    process.env.PYTHON_BIN ||
    path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "applio-review-api-"));
  const data = path.join(temporary, "data");
  const config = path.join(temporary, "config");
  await fs.mkdir(data);
  await fs.mkdir(config);
  await fs.writeFile(path.join(config, "config.json"), JSON.stringify({ discord_presence: false }));
  const folder = path.join(data, "assets/datasets/voices");
  await fs.mkdir(folder, { recursive: true });
  execFileSync(
    python,
    [
      "-c",
      "import sys,numpy as np,soundfile as sf; from pathlib import Path; p=Path(sys.argv[1]); r=16000; v=.2*np.sin(2*np.pi*180*np.arange(r*3)/r); sf.write(p/'a.wav',v,r); v,_=sf.read(p/'a.wav'); sf.write(p/'b.flac',v,r)",
      folder,
    ],
    { windowsHide: true },
  );
  const original = await fs.readFile(path.join(folder, "a.wav"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let logs = "";
  const api = spawn(process.execPath, [path.join(root, "backend/api/dist/index.js")], {
    cwd: data,
    windowsHide: true,
    env: {
      ...process.env,
      APPLIO_ROOT: data,
      APPLIO_CODE_ROOT: root,
      APPLIO_BACKEND_ROOT: path.join(root, "backend/applio"),
      APPLIO_CONFIG_DIR: config,
      API_PORT: String(port),
      PYTHON_BIN: python,
      APPLIO_NO_ENV: "1",
    },
    stdio: "pipe",
  });
  api.stdout.on("data", (value) => (logs = (logs + value).slice(-10000)));
  api.stderr.on("data", (value) => (logs = (logs + value).slice(-10000)));
  t.after(async () => {
    api.kill();
    await new Promise((resolve) => (api.exitCode !== null ? resolve() : api.once("exit", resolve)));
    assert.equal(path.dirname(temporary), os.tmpdir());
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const request = async (pathname, body) => {
    const response = await fetch(
      `http://127.0.0.1:${port}${pathname}`,
      body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {},
    );
    return { status: response.status, body: await response.json() };
  };
  for (let i = 0; i < 60; i++) {
    try {
      if ((await request("/api/health")).status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(api.exitCode, null, logs);
  async function completed(id) {
    for (let i = 0; i < 150; i++) {
      const { body } = await request(`/api/jobs/${id}`);
      if (body.job?.status === "done") return body.job;
      if (body.job?.status === "error") throw new Error(body.job.error);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Review did not finish");
  }
  const scan = await request("/api/train/dataset-review/scan", { datasetPath: folder, silenceDb: -50 });
  assert.equal(scan.status, 202);
  await completed(scan.body.jobId);
  const report = await request(`/api/train/dataset-review/${scan.body.reviewId}`);
  assert.equal(report.status, 200);
  assert.equal(report.body.summary.duplicate, 1);
  assert.equal("sourceHash" in report.body.clips[0], false);
  const keep = report.body.clips.filter((clip) => !clip.duplicateOf).map((clip) => clip.id);
  const invalid = await request(`/api/train/dataset-review/${scan.body.reviewId}/prepare`, {
    include: ["f".repeat(24)],
    trimSilence: false,
    normalize: false,
    lowerPeaks: false,
  });
  assert.equal(invalid.status, 400);
  const prepared = await request(`/api/train/dataset-review/${scan.body.reviewId}/prepare`, {
    include: keep,
    trimSilence: false,
    normalize: false,
    lowerPeaks: false,
  });
  const done = await completed(prepared.body.jobId);
  assert.equal(done.result.files, 1);
  assert.deepEqual(await fs.readFile(path.join(done.result.datasetPath, "a.wav")), original);
  assert.deepEqual(await fs.readFile(path.join(folder, "a.wav")), original);
  assert.ok(
    (await request("/api/train/datasets")).body.datasets.some((name) =>
      name.startsWith("assets/curated-datasets/"),
    ),
  );
  const preview = await fetch(
    `http://127.0.0.1:${port}/api/train/dataset-review/${scan.body.reviewId}/audio/${keep[0]}`,
    { headers: { Range: "bytes=0-43" } },
  );
  assert.equal(preview.status, 206);
  assert.equal((await preview.arrayBuffer()).byteLength, 44);
  await fs.appendFile(path.join(folder, "a.wav"), "changed");
  const stale = await request(`/api/train/dataset-review/${scan.body.reviewId}/prepare`, {
    include: keep,
    trimSilence: false,
    normalize: false,
    lowerPeaks: false,
  });
  await assert.rejects(completed(stale.body.jobId), /changed/);
});
