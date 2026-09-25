import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { trackPid } from "@/cli";
import { errMsg } from "@/errors";
import { appendLog, createJob, getJob, setDone, setError, setProgress, setRunning } from "@/jobs";
import { buildCommonInferArgs } from "@/lib/inferArgs";
import { getRepoRoot, resolveUserPath, runPythonModule } from "@/python";
import { type BatchInferenceParams, batchInferenceSchema } from "@/schemas";
import { inferenceWorker } from "@/worker";

const router = Router();

function toCliArgs(p: BatchInferenceParams, inputFolder: string, outputFolder: string): string[] {
  return [
    path.join("rvc", "infer", "infer.py"),
    "--input-folder",
    inputFolder,
    "--output-folder",
    outputFolder,
    "--pth-path",
    p.pthPath,
    "--index-path",
    p.indexPath || "",
    ...buildCommonInferArgs(p),
  ];
}

router.post("/", (req: Request, res: Response) => {
  try {
    const parsed = batchInferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    }
    const p: BatchInferenceParams = parsed.data;
    const inputFolder = resolveUserPath(p.inputFolder);
    const outputFolder = resolveUserPath(p.outputFolder);
    if (!fs.existsSync(inputFolder))
      return res.status(400).json({ error: `Input folder not found: ${p.inputFolder}` });
    fs.mkdirSync(outputFolder, { recursive: true });
    const pthAbs = resolveUserPath(p.pthPath);
    if (!fs.existsSync(pthAbs)) return res.status(400).json({ error: `Model not found: ${p.pthPath}` });

    const job = createJob("batch-inference", p);
    void runBatchJob(job.id, p, inputFolder, outputFolder);
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) || "Batch inference failed to start" });
  }
});

async function runBatchJob(
  jobId: string,
  params: BatchInferenceParams,
  inputFolder: string,
  outputFolder: string,
) {
  const job = getJob(jobId);
  if (!job) return;
  setRunning(job);

  let totalFiles = 0;
  let doneFiles = 0;
  let lastPct = -1;
  let runStdout = "";

  const trackProgress = (trimmed: string) => {
    const totalMatch = trimmed.match(/Detected (\d+) audio files for inference\./);
    if (totalMatch) {
      totalFiles = Math.max(1, Number(totalMatch[1]));
      lastPct = 5;
      setProgress(job, 5);
      return;
    }
    if (/File .* inferred successfully\./.test(trimmed) && totalFiles > 0) {
      doneFiles += 1;
      const pct = 5 + Math.round((90 * Math.min(doneFiles, totalFiles)) / totalFiles);
      if (pct > lastPct) {
        lastPct = pct;
        setProgress(job, pct);
      }
    }
  };

  try {
    try {
      trackPid(job.id, inferenceWorker.getPid());
      await inferenceWorker.inferBatch(job.id, params, inputFolder, outputFolder, (chunk) => {
        const trimmed = chunk.trim().slice(0, 1000);
        if (trimmed) {
          appendLog(job, trimmed);
          runStdout += `${trimmed}\n`;
          trackProgress(trimmed);
        }
      });
      trackPid(job.id, undefined);
    } catch (workerErr) {
      appendLog(job, `Worker notice: ${errMsg(workerErr)}; falling back to standalone CLI runner...`);
      const args = toCliArgs(params, inputFolder, outputFolder);
      const result = await runPythonModule(args, {
        onData: (chunk) => {
          const trimmed = chunk.trim().slice(0, 1000);
          if (trimmed) {
            appendLog(job, trimmed);
            runStdout += `${trimmed}\n`;
            trackProgress(trimmed);
          }
        },
        onSpawn: (pid) => trackPid(job.id, pid),
      });
      trackPid(job.id, undefined);
      if (result.code !== 0) {
        throw new Error(result.stderr.slice(-3000) || `Batch inference failed with code ${result.code}`);
      }
      runStdout += result.stdout;
    }

    const rel = path.relative(getRepoRoot(), outputFolder).replace(/\\/g, "/");
    appendLog(job, `Done -> ${rel}`);
    setDone(job, { stdout: runStdout.slice(-2000) }, rel);
  } catch (err) {
    trackPid(job.id, undefined);
    appendLog(job, `ERROR: ${errMsg(err)}`);
    setError(job, errMsg(err) || "Batch inference failed");
  }
}

export default router;
