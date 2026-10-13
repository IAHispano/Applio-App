import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { appendChunkLogs, trackPid } from "@/cli";
import { getConfigDir } from "@/config";
import { errMsg } from "@/errors";
import {
  appendLog,
  createJob,
  type Job,
  jobIsActive,
  setDone,
  setError,
  setProgress,
  setRunning,
} from "@/jobs";
import { getRepoRoot, resolveUserPath, runPythonModule } from "@/python";
import { acquireJobSlot, releaseJobSlot } from "@/scheduler";

const router = Router();
const ID = /^[a-f0-9-]{36}$/;
interface ReviewClip {
  id: string;
  path: string;
  error?: string;
  sourceHash?: string;
  pcmHash?: string;
}
interface ReviewReport {
  root: string;
  clips: ReviewClip[];
  [key: string]: unknown;
}

function reportPath(id: string): string {
  if (!ID.test(id)) throw new Error("Invalid dataset review.");
  return path.join(getConfigDir(), "dataset-reviews", `${id}.json`);
}

function readReport(id: string): ReviewReport {
  const report = JSON.parse(fs.readFileSync(reportPath(id), "utf8")) as ReviewReport;
  if (!Array.isArray(report.clips) || typeof report.root !== "string")
    throw new Error("Invalid review report. Scan the dataset again.");
  return report;
}

async function runReview(
  job: Job,
  args: string[],
  result: (output: Record<string, unknown>) => Record<string, unknown>,
) {
  if (!(await acquireJobSlot(job, "dataset-review"))) return;
  try {
    setRunning(job);
    let progressBuffer = "";
    const processResult = await runPythonModule(["tools/dataset_quality.py", ...args], {
      detached: process.platform !== "win32",
      onSpawn: (pid) => trackPid(job.id, pid, process.platform !== "win32"),
      onData: (chunk, stream) => {
        if (stream === "stderr") appendChunkLogs(job, chunk, stream);
        else {
          progressBuffer += chunk;
          const lines = progressBuffer.split(/\r?\n/);
          progressBuffer = lines.pop() || "";
          for (const line of lines) {
            const match = line.match(/^REVIEW_PROGRESS:(\d+)\/(\d+)$/);
            if (match) setProgress(job, Math.round((Number(match[1]) / Number(match[2])) * 100));
          }
        }
      },
    });
    if (!jobIsActive(job)) return;
    if (processResult.code !== 0)
      throw new Error(processResult.stderr.trim().slice(-2500) || "Dataset review failed.");
    const json = processResult.stdout.split(/\r?\n/).find((line) => line.startsWith("REVIEW_RESULT:"));
    if (!json) throw new Error("Dataset review produced no report.");
    setDone(job, result(JSON.parse(json.slice("REVIEW_RESULT:".length))));
  } catch (error) {
    if (jobIsActive(job)) {
      appendLog(job, errMsg(error));
      setError(job, errMsg(error));
    }
  } finally {
    trackPid(job.id, undefined);
    releaseJobSlot(job.id);
  }
}

router.post("/scan", (req, res) => {
  try {
    const body = z
      .object({ datasetPath: z.string().min(1), silenceDb: z.number().min(-80).max(-30).default(-50) })
      .parse(req.body);
    const root = fs.realpathSync(resolveUserPath(body.datasetPath));
    if (!fs.statSync(root).isDirectory()) throw new Error("Choose a training folder.");
    const reviewId = randomUUID();
    const report = reportPath(reviewId);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    const job = createJob("other", { step: "dataset-review", datasetPath: root, reviewId });
    void runReview(
      job,
      ["scan", "--root", root, "--report", report, "--silence-db", String(body.silenceDb)],
      (output) => ({ ...output, reviewId }),
    );
    res.status(202).json({ jobId: job.id, reviewId });
  } catch (error) {
    res.status(400).json({ error: errMsg(error) });
  }
});

router.get("/:id", (req, res) => {
  try {
    const report = readReport(req.params.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...report,
      clips: report.clips.map(({ sourceHash: _source, pcmHash: _pcm, ...clip }) => clip),
    });
  } catch (error) {
    res.status(404).json({ error: errMsg(error) });
  }
});

router.get("/:id/audio/:clipId", (req, res) => {
  try {
    const report = readReport(req.params.id);
    const clip = report.clips.find((value) => value.id === req.params.clipId);
    if (!clip || clip.error) throw new Error("Recording is unavailable.");
    const root = fs.realpathSync(report.root);
    const audio = fs.realpathSync(path.join(root, clip.path));
    const relative = path.relative(root, audio);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
      throw new Error("Recording is outside the reviewed folder.");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(audio);
  } catch (error) {
    res.status(400).json({ error: errMsg(error) });
  }
});

router.post("/:id/prepare", (req, res) => {
  try {
    const report = readReport(req.params.id);
    const plan = z
      .object({
        include: z
          .array(z.string().regex(/^[a-f0-9]{24}$/))
          .min(1)
          .max(5000),
        trimSilence: z.boolean(),
        normalize: z.boolean(),
        lowerPeaks: z.boolean(),
      })
      .parse(req.body);
    if (
      new Set(plan.include).size !== plan.include.length ||
      plan.include.some((id) => !report.clips.some((clip) => clip.id === id && !clip.error))
    )
      throw new Error("Choose valid recordings from this review.");
    const folder =
      path
        .basename(report.root)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 60) || "dataset";
    const output = path.join(
      getRepoRoot(),
      "assets",
      "curated-datasets",
      `${folder}-${randomUUID().slice(0, 8)}`,
    );
    const job = createJob("other", {
      step: "dataset-prepare",
      reviewId: req.params.id,
      datasetPath: report.root,
    });
    const planPath = path.join(path.dirname(reportPath(req.params.id)), `${job.id}.plan.json`);
    fs.writeFileSync(planPath, JSON.stringify(plan), { flag: "wx", mode: 0o600 });
    void runReview(
      job,
      ["prepare", "--report", reportPath(req.params.id), "--plan", planPath, "--destination", output],
      (result) => ({ ...result, reviewId: req.params.id }),
    ).finally(() => {
      // Windows force-cancellation cannot run Python's TemporaryDirectory cleanup.
      // Only remove the staging directories belonging to this unique destination.
      try {
        const parent = path.dirname(output);
        const prefix = `.applio-review-${path.basename(output)}-`;
        for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
          const staged = path.resolve(parent, entry.name);
          if (path.dirname(staged) === path.resolve(parent))
            fs.rmSync(staged, { recursive: true, force: true });
        }
      } catch {
        /* Staging is hidden from training and can be cleaned on a later run. */
      }
      try {
        fs.rmSync(planPath, { force: true });
      } catch {
        /* temporary plan can be removed later */
      }
    });
    res.status(202).json({ jobId: job.id });
  } catch (error) {
    res.status(400).json({ error: errMsg(error) });
  }
});

export default router;
