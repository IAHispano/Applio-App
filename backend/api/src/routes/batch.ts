import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { trackPid } from "@/cli";
import { errMsg } from "@/errors";
import { appendLog, createJob, getJob, setDone, setError, setProgress, setRunning } from "@/jobs";
import { buildCommonInferArgs } from "@/lib/inferArgs";
import { getRepoRoot, resolveUserPath, runPythonModule } from "@/python";
import { acquireJobSlot, releaseJobSlot } from "@/scheduler";
import { type BatchInferenceParams, batchInferenceSchema } from "@/schemas";
import { requireEngineReady } from "@/setup";
import { inferenceWorker } from "@/worker";

const router = Router();
const audioExtension = /\.(wav|mp3|flac|ogg|m4a|aac|aiff|aif|wma|opus)$/i;
router.use(requireEngineReady);

router.post("/", (req: Request, res: Response) => {
  try {
    const parsed = batchInferenceSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    const p = parsed.data;
    const source = resolveUserPath(p.mode === "models" ? p.inputPath : p.inputFolder);
    const outputFolder = resolveUserPath(p.outputFolder);
    if (
      !fs.existsSync(source) ||
      (p.mode === "models" ? !fs.statSync(source).isFile() : !fs.statSync(source).isDirectory())
    )
      return res.status(400).json({ error: "Input file or folder not found" });
    if (p.mode === "models" && !audioExtension.test(source))
      return res.status(400).json({ error: "Unsupported input audio file" });
    const models =
      p.mode === "files" ? [{ pthPath: p.pthPath, indexPath: p.indexPath, overrides: {} }] : p.models;
    for (const model of models) {
      const modelPath = resolveUserPath(model.pthPath);
      const indexPath = model.indexPath ? resolveUserPath(model.indexPath) : "";
      if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile())
        return res.status(400).json({ error: `Model not found: ${model.pthPath}` });
      if (indexPath && (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()))
        return res.status(400).json({ error: `Index not found: ${model.indexPath}` });
    }
    const inputs =
      p.mode === "models"
        ? [source]
        : fs
            .readdirSync(source)
            .filter((name) => audioExtension.test(name))
            .map((name) => path.join(source, name))
            .filter((file) => fs.statSync(file).isFile())
            .sort();
    if (!inputs.length) return res.status(400).json({ error: "No supported audio files found" });
    fs.mkdirSync(outputFolder, { recursive: true });
    const job = createJob("batch-inference", p);
    void runBatchJob(job.id, p, inputs, outputFolder);
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) || "Batch inference failed to start" });
  }
});

async function runBatchJob(
  jobId: string,
  params: BatchInferenceParams,
  inputs: string[],
  outputFolder: string,
) {
  const job = getJob(jobId);
  if (!job || !(await acquireJobSlot(job, "gpu"))) return;
  try {
    setRunning(job);
    const models =
      params.mode === "files"
        ? [{ pthPath: params.pthPath, indexPath: params.indexPath, overrides: {} }]
        : params.models;
    const total = models.length * inputs.length;
    let done = 0;
    for (const [modelNumber, model] of models.entries()) {
      // Numbered directories distinguish checkpoints with the same basename.
      const modelDir =
        params.mode === "files"
          ? outputFolder
          : path.join(
              outputFolder,
              `${modelNumber + 1}_${path.basename(model.pthPath, path.extname(model.pthPath))}`,
            );
      fs.mkdirSync(modelDir, { recursive: true });
      const { overrides, ...modelPaths } = model;
      const selected = { ...params, ...overrides, ...modelPaths };
      for (const input of inputs) {
        if (job.status !== "running") return;
        // Preserve the source extension in the stem to avoid voice.wav/voice.mp3 collisions.
        const output = path.join(modelDir, `${path.basename(input)}_output.wav`);
        appendLog(job, `${done + 1}/${total}: ${path.basename(input)} -> ${path.basename(model.pthPath)}`);
        const log = (chunk: string) => {
          if (chunk.trim()) appendLog(job, chunk.trim().slice(0, 1000));
        };
        let served: string | undefined;
        try {
          const result = await inferenceWorker.infer(job.id, selected, input, output, log);
          served = result.outputPath;
        } catch (workerErr) {
          if (job.status !== "running") return;
          appendLog(job, `Worker notice: ${errMsg(workerErr)}; falling back to standalone CLI runner...`);
          const result = await runPythonModule(
            [
              path.join("rvc", "infer", "infer.py"),
              "--input-path",
              input,
              "--output-path",
              output,
              "--pth-path",
              selected.pthPath,
              "--index-path",
              selected.indexPath,
              ...buildCommonInferArgs(selected),
            ],
            { onData: log, onSpawn: (pid) => trackPid(job.id, pid) },
          );
          if (result.code !== 0)
            throw new Error(result.stderr.slice(-3000) || `Inference failed with code ${result.code}`);
        }
        trackPid(job.id, undefined);
        if (job.status !== "running") return;
        const exportExt = String(selected.exportFormat || params.exportFormat).toLowerCase();
        const expected = output.replace(/\.wav$/i, `.${exportExt}`);
        if (!fs.existsSync(served || expected))
          throw new Error(`No output found for ${path.basename(input)}`);
        setProgress(job, Math.round((++done * 100) / total));
      }
    }
    const rel = path.relative(getRepoRoot(), outputFolder).replace(/\\/g, "/");
    appendLog(job, `Done -> ${rel}`);
    setDone(job, { files: done, models: models.length }, rel);
  } catch (err) {
    trackPid(job.id, undefined);
    if (job.status === "running") {
      appendLog(job, `ERROR: ${errMsg(err)}`);
      setError(job, errMsg(err) || "Batch inference failed");
    }
  } finally {
    releaseJobSlot(job.id);
  }
}

export default router;
