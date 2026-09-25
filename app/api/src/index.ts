import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { startStorageCleaner } from "@/cleaner";
import { killJobTree } from "@/cli";
import { errMsg } from "@/errors";
import { getJob, setError } from "@/jobs";
import {
  ensureWindowsRealPythonSync,
  getOutputsDir,
  getPythonBin,
  getRepoRoot,
  resolveUserPath,
  runPythonModule,
} from "@/python";
import audioRouter from "@/routes/audio";
import batchRouter from "@/routes/batch";
import blenderRouter from "@/routes/blender";
import downloadRouter from "@/routes/download";
import extraRouter from "@/routes/extra";
import inferenceRouter from "@/routes/inference";
import jobsRouter from "@/routes/jobs";
import modelsRouter from "@/routes/models";
import pluginsRouter from "@/routes/plugins";
import realtimeRouter, { attachRealtimeProxy } from "@/routes/realtime";
import reportRouter from "@/routes/report";
import settingsRouter, { autoStartPresence, stopPresence } from "@/routes/settings";
import setupRouter from "@/routes/setup";
import tensorboardRouter, { autoStartTensorboard, stopTensorboard } from "@/routes/tensorboard";
import trainRouter from "@/routes/train";
import ttsRouter from "@/routes/tts";
import uvrRouter from "@/routes/uvr";
import { inferenceWorker } from "@/worker";

const app = express();
const PORT = Number(process.env.API_PORT || process.env.PORT || 8000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Static files produced by jobs (audio, plots, clips) and repo assets (samples).
const repoRoot = getRepoRoot();
const outputsDir = getOutputsDir();
app.use("/outputs", express.static(outputsDir, { maxAge: "1h", fallthrough: true }));
app.use("/assets", express.static(path.join(repoRoot, "assets"), { maxAge: "1h", fallthrough: true }));

// Drop stale analyzer/F0 byproducts on startup so assets/audios doesn't fill
// with spectrogram pictures and pitch files. Only our generated filename
// patterns — user audio is never touched.
try {
  const audioDir = path.join(repoRoot, "assets", "audios");
  const staleRes = [/^audio_analysis_.*\.png$/, /^f0_plot_.*\.png$/, /^f0_curve_.*\.txt$/];
  let removed = 0;
  for (const f of fs.readdirSync(audioDir)) {
    if (staleRes.some((re) => re.test(f))) {
      try {
        fs.rmSync(path.join(audioDir, f), { force: true });
        removed++;
      } catch {
        /* keep going */
      }
    }
  }
  if (removed > 0) console.log(`[startup] removed ${removed} stale analysis files from assets/audios`);
} catch {
  /* audio dir missing — nothing to clean */
}

// Safe raw audio streaming endpoint for any relative/repo audio path
app.get("/api/audio/raw", (req, res) => {
  const p = req.query.path;
  if (typeof p !== "string" || !p) {
    res.status(400).json({ error: "Missing path parameter" });
    return;
  }
  try {
    const abs = resolveUserPath(p);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }
    res.sendFile(abs);
  } catch (e) {
    res.status(400).json({ error: errMsg(e) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "applio-api",
    repoRoot: getRepoRoot(),
    python: getPythonBin(),
    time: new Date().toISOString(),
  });
});

app.get("/api/diagnostics", async (_req, res) => {
  try {
    const r = await runPythonModule(["--version"]);
    const torch = await runPythonModule(["-c", "import torch; print(torch.__version__)"], {}).catch(
      (e: unknown) => ({
        stdout: "",
        stderr: String(e),
        code: 1,
      }),
    );
    res.json({
      pythonVersion: (r.stdout + r.stderr).trim(),
      torchVersion: (torch.stdout + torch.stderr).trim(),
      repoRoot: getRepoRoot(),
    });
  } catch (e) {
    res.status(500).json({ error: errMsg(e) });
  }
});

app.use("/api/models", modelsRouter);
app.use("/api/inference/batch", batchRouter); // before /api/inference (more specific first)
app.use("/api/inference", inferenceRouter);
app.use("/api/tts", ttsRouter);
app.use("/api/voice-blender", blenderRouter);
app.use("/api/download", downloadRouter);
app.use("/api/extra", extraRouter);
app.use("/api/audio", audioRouter);
app.use("/api/uvr", uvrRouter);
app.use("/api/train", trainRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/tensorboard", tensorboardRouter);
app.use("/api/report", reportRouter);
app.use("/api/plugins", pluginsRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/setup", setupRouter);

app.post("/api/jobs/:id/stop", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status === "done" || job.status === "error") {
    return res.json({ ok: true, alreadyFinished: true });
  }
  const killed = killJobTree(job.id);
  if (killed) {
    setError(job, "Stopped by user");
    return res.json({ ok: true });
  }
  return res.status(404).json({ error: "Job has no running process (may have finished starting)." });
});

if (process.platform === "win32") {
  const root = getRepoRoot();
  for (const sub of [".venv", "venv", "env"]) {
    ensureWindowsRealPythonSync(path.join(root, sub));
  }
}

const server = app.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[applio-api] listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[applio-api] repoRoot=${getRepoRoot()} outputs=${outputsDir}`);
  // Gradio app.py parity: start Discord presence at boot when enabled.
  autoStartPresence();
  // Start TensorBoard in background so it is ready immediately when user opens tab.
  autoStartTensorboard();
  // Warm the inference worker (CUDA context + default embedder) in the
  // background so the first conversion doesn't pay one-time load costs.
  inferenceWorker.warmupDelayed();
  // Automatically clean expired temporary audio files and uploads
  startStorageCleaner();
});

// Realtime audio frames ride raw WebSockets (Next rewrites don't proxy upgrades),
// so the WS proxy attaches directly to our HTTP server.
attachRealtimeProxy(server);

process.on("SIGINT", () => {
  stopPresence();
  stopTensorboard();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopPresence();
  stopTensorboard();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[applio-api] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[applio-api] Unhandled rejection:", reason);
});
