import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { trackPid } from "@/cli";
import { errMsg } from "@/errors";
import {
  appendLog,
  createJob,
  getJob,
  setDone,
  setError,
  setJobResult,
  setJobStage,
  setProgress,
  setRunning,
} from "@/jobs";
import { buildCommonInferArgs } from "@/lib/inferArgs";
import { getRepoRoot, resolveUserPath, runPythonModule } from "@/python";
import { acquireJobSlot, releaseJobSlot } from "@/scheduler";
import { type BatchInferenceParams, batchInferenceSchema } from "@/schemas";
import { requireEngineReady } from "@/setup";
import { inferenceWorker } from "@/worker";

const router = Router();
const audioExtension = /\.(wav|mp3|flac|ogg|m4a|aac|aiff|aif|wma|opus)$/i;

function sourceFiles(source: string, single: boolean): string[] {
  if (!fs.existsSync(source) || (single ? !fs.statSync(source).isFile() : !fs.statSync(source).isDirectory()))
    throw new Error("Input file or folder not found");
  if (single) {
    if (!audioExtension.test(source)) throw new Error("Unsupported input audio file");
    return [source];
  }
  return fs
    .readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isFile() && audioExtension.test(entry.name))
    .map((entry) => path.join(source, entry.name))
    .sort();
}

router.post("/preview", (req: Request, res: Response) => {
  const parsed = z
    .object({ inputFolder: z.string().default(""), inputPath: z.string().default("") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid params" });
  try {
    const single = !!parsed.data.inputPath.trim();
    const source = resolveUserPath(single ? parsed.data.inputPath : parsed.data.inputFolder);
    const files = sourceFiles(source, single).map((file) => ({
      name: path.basename(file),
      bytes: fs.statSync(file).size,
    }));
    return res.json({ files });
  } catch (error) {
    return res.status(400).json({ error: errMsg(error) });
  }
});

router.get("/:jobId/outputs/:item", (req: Request, res: Response) => {
  const job = getJob(String(req.params.jobId));
  const items = job?.result?.items as BatchItem[] | undefined;
  const index = Number(req.params.item);
  const item = Number.isInteger(index) && index >= 0 ? items?.[index] : undefined;
  if (job?.type !== "batch-inference" || item?.status !== "done" || !item.output)
    return res.status(404).json({ error: "Output not found" });
  try {
    const root = fs.realpathSync(String(job.result?.outputFolder));
    const file = fs.realpathSync(item.output);
    const relative = path.relative(root, file);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
      return res.status(404).json({ error: "Output not found" });
    return res.download(file, path.basename(file));
  } catch {
    return res.status(404).json({ error: "Output not found" });
  }
});

interface BatchItem {
  input: string;
  model: string;
  status: "running" | "done" | "error";
  output?: string;
  error?: string;
}

router.use(requireEngineReady);

router.post("/", (req: Request, res: Response) => {
  try {
    const parsed = batchInferenceSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    const p = parsed.data;
    const source = resolveUserPath(p.mode === "models" ? p.inputPath : p.inputFolder);
    const outputFolder = resolveUserPath(p.outputFolder);
    let inputs: string[];
    try {
      inputs = sourceFiles(source, p.mode === "models").filter(
        (file) => !p.excludedFiles.includes(path.basename(file)),
      );
      if (p.selectedFiles) {
        const available = new Set(inputs.map((file) => path.basename(file)));
        if (p.selectedFiles.some((name) => !available.has(name)))
          return res.status(400).json({ error: "Selected input files changed. Review audio files again." });
        inputs = inputs.filter((file) => p.selectedFiles?.includes(path.basename(file)));
      }
    } catch (error) {
      return res.status(400).json({ error: errMsg(error) });
    }
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
    if (!inputs.length) return res.status(400).json({ error: "No supported audio files found" });
    fs.mkdirSync(outputFolder, { recursive: true });
    const job = createJob("batch-inference", p);
    void runBatchJob(job.id, p, inputs, path.join(outputFolder, `batch_${job.id.slice(0, 8)}`));
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
    let failed = 0;
    const items: BatchItem[] = [];
    const result = () => ({
      files: done,
      failed,
      total,
      models: models.length,
      items: [...items],
      outputFolder,
    });
    setJobResult(job, result());
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
        const item: BatchItem = { input: path.basename(input), model: model.pthPath, status: "running" };
        items.push(item);
        setJobResult(job, result());
        setJobStage(job, "Converting audio…", done + failed + 1, total);
        appendLog(
          job,
          `${done + failed + 1}/${total}: ${path.basename(input)} -> ${path.basename(model.pthPath)}`,
        );
        const log = (chunk: string) => {
          if (chunk.trim()) appendLog(job, chunk.trim().slice(0, 1000));
        };
        let served: string | undefined;
        try {
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
          item.status = "done";
          item.output = served || expected;
          done++;
        } catch (error) {
          if (job.status !== "running") return;
          item.status = "error";
          item.error = errMsg(error);
          failed++;
          appendLog(job, `Failed: ${item.input} -> ${path.basename(item.model)}: ${item.error}`);
          setJobResult(job, result());
          if (!params.continueOnError) throw error;
        } finally {
          trackPid(job.id, undefined);
        }
        setJobResult(job, result());
        setProgress(job, Math.round(((done + failed) * 100) / total));
      }
    }
    const rel = path.relative(getRepoRoot(), outputFolder).replace(/\\/g, "/");
    setJobStage(job, "Checking output…");
    appendLog(job, `Done -> ${rel}`);
    setJobResult(job, result());
    if (!done && failed)
      setError(job, "Batch conversion failed for every file. Check the individual results.");
    else setDone(job, result(), rel);
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
