import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { trackPid } from "../cli";
import { errMsg } from "../errors";
import { appendLog, createJob, getJob, setDone, setError, setRunning } from "../jobs";
import { buildCommonInferArgs } from "../lib/inferArgs";
import { audioUpload } from "../lib/upload";
import { getOutputsDir, getRepoRoot, resolveUserPath, runPythonModule } from "../python";
import { type InferenceParams, inferenceParamsSchema } from "../schemas";
import { inferenceWorker } from "../worker";

const router = Router();

const upload = audioUpload();

function toCliArgs(p: InferenceParams, inputPath: string, outputPath: string): string[] {
  return [
    "core.py",
    "infer",
    "--input-path",
    inputPath,
    "--output-path",
    outputPath,
    "--pth-path",
    p.pthPath,
    "--index-path",
    p.indexPath || "",
    ...buildCommonInferArgs(p),
  ];
}

router.post("/", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    const parsed = inferenceParamsSchema.safeParse(body);
    if (!parsed.success) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    }
    const params = parsed.data;

    let inputAbs: string;
    if (req.file) {
      inputAbs = req.file.path;
    } else if (typeof body.inputPath === "string" && body.inputPath.length > 0) {
      inputAbs = resolveUserPath(body.inputPath);
    } else {
      return res.status(400).json({ error: "Provide an 'audio' file upload or 'inputPath'." });
    }

    const pthAbs = resolveUserPath(params.pthPath);
    if (!fs.existsSync(pthAbs)) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: `Model not found: ${params.pthPath}` });
    }
    if (params.indexPath) {
      const idxAbs = resolveUserPath(params.indexPath);
      if (!fs.existsSync(idxAbs)) {
        if (req.file) fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ error: `Index not found: ${params.indexPath}` });
      }
    }

    const job = createJob("inference", { ...params, inputPath: inputAbs });
    void runInferenceJob(job.id, params, inputAbs);
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(500).json({ error: errMsg(err) || "Inference failed to start" });
  }
});

async function runInferenceJob(jobId: string, params: InferenceParams, inputAbs: string) {
  const job = getJob(jobId);
  if (!job) return;
  setRunning(job);
  try {
    const ts = Date.now();
    const ext = String(params.exportFormat || "WAV").toLowerCase();
    const outAbs = path.join(getOutputsDir(), `web_output_${ts}.${ext === "m4a" ? "m4a" : ext}`);
    // core.py expects a .wav output path then renames by export format; give .wav stem
    const outWav = outAbs.replace(/\.[a-z0-9]+$/i, ".wav");

    let finalServed: string | null = null;
    let runStdout = "";

    try {
      trackPid(job.id, inferenceWorker.getPid());
      const res = await inferenceWorker.infer(job.id, params, inputAbs, outWav, (chunk) => {
        const trimmed = chunk.trim().slice(0, 1000);
        if (trimmed) {
          appendLog(job, trimmed);
          runStdout += trimmed + "\n";
        }
      });
      trackPid(job.id, undefined);
      finalServed = res.outputPath || outWav;
    } catch (workerErr) {
      appendLog(job, `Worker notice: ${errMsg(workerErr)}; falling back to standalone CLI runner...`);
      const args = toCliArgs(params, inputAbs, outWav);
      const result = await runPythonModule(args, {
        onData: (chunk) => {
          const trimmed = chunk.trim().slice(0, 1000);
          if (trimmed) {
            appendLog(job, trimmed);
            runStdout += trimmed + "\n";
          }
        },
        onSpawn: (pid) => trackPid(job.id, pid),
      });
      trackPid(job.id, undefined);
      if (result.code !== 0) {
        throw new Error(result.stderr.slice(-3000) || `Inference failed with code ${result.code}`);
      }
      runStdout += result.stdout;
    }

    const finalAbs = outWav.replace(/\.wav$/i, `.${ext}`);
    const served =
      finalServed && fs.existsSync(finalServed) ? finalServed : fs.existsSync(finalAbs) ? finalAbs : outWav;

    if (!fs.existsSync(served)) throw new Error("Inference finished but no output file was found.");
    const rel = path.relative(getRepoRoot(), served).replace(/\\/g, "/");
    appendLog(job, `Done -> ${rel}`);
    setDone(job, { stdout: runStdout.slice(-2000) }, rel);
  } catch (err) {
    trackPid(job.id, undefined);
    appendLog(job, `ERROR: ${errMsg(err)}`);
    setError(job, errMsg(err) || "Inference failed");
  }
}

export default router;
