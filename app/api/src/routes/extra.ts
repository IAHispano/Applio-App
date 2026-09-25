import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { runPythonJson, startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { appendLog, createJob, setDone, setError, setRunning } from "@/jobs";
import { audioUpload } from "@/lib/upload";
import { getOutputsDir, getRepoRoot, resolveUserPath } from "@/python";
import { inferenceWorker } from "@/worker";

const router = Router();

const upload = audioUpload();

function inputFrom(req: Request): string {
  if (req.file) return req.file.path;
  const p = (req.body as Record<string, unknown>).inputPath;
  if (typeof p === "string" && p) return resolveUserPath(p);
  throw new Error("Provide an 'audio' upload or 'inputPath'.");
}

router.post("/analyze", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const inputAbs = inputFrom(req);
    const ts = Date.now();
    const plotAbs = path.join(getOutputsDir(), `audio_analysis_${ts}.png`);
    const job = createJob("other", { inputPath: inputAbs });
    void (async () => {
      setRunning(job);
      try {
        let out: { info: unknown; plot: string };
        try {
          out = await inferenceWorker.analyzeAudio(job.id, inputAbs, plotAbs, (l) => appendLog(job, l));
        } catch {
          appendLog(job, "Running audio analysis via fallback runner...");
          const code = [
            "import json",
            "from rvc.lib.tools.analyzer import analyze_audio",
            `info, plot = analyze_audio(${JSON.stringify(inputAbs)}, ${JSON.stringify(plotAbs)})`,
            "print('APPLIO_JSON:' + json.dumps({'info': info, 'plot': plot}))",
          ].join("; ");
          out = await runPythonJson<{ info: unknown; plot: string }>(code, (l) => appendLog(job, l));
        }
        appendLog(job, `Plot saved at ${out.plot}`);
        setDone(job, { info: out.info }, path.relative(getRepoRoot(), out.plot).replace(/\\/g, "/"));
      } catch (err) {
        appendLog(job, `ERROR: ${errMsg(err)}`);
        setError(job, errMsg(err) || "Analysis failed");
      }
    })();
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: errMsg(err) });
  }
});

router.post("/model-info", (req: Request, res: Response) => {
  const parsed = z.object({ pthPath: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
  try {
    const abs = resolveUserPath(parsed.data.pthPath);
    if (!fs.existsSync(abs)) return res.status(400).json({ error: `File not found: ${parsed.data.pthPath}` });

    const job = createJob("other", parsed.data);
    void (async () => {
      setRunning(job);
      try {
        let meta: Record<string, unknown>;
        try {
          meta = await inferenceWorker.inspectModel(abs);
        } catch {
          // Fallback to CLI script
          const code = [path.join("rvc", "train", "process", "model_information.py"), abs];
          // We can run via startCliJob or runPythonModule
          meta = await new Promise((resolve, reject) => {
            const j = startCliJob("other", parsed.data, code, {
              parse: (stdout) => {
                const m: Record<string, string> = {};
                for (const line of stdout.split(/\r?\n/)) {
                  const match = line.match(/^([^:]+):\s*(.*)$/);
                  if (match) {
                    const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
                    m[key] = match[2].trim();
                  }
                }
                resolve(m);
                return { result: { metadata: m } };
              },
            });
            setTimeout(() => {
              if (j.status === "error") reject(new Error(j.error || "CLI failed"));
            }, 30000);
          });
        }
        const name = String(meta.model_name || path.basename(abs));
        appendLog(job, `Model info retrieved for ${name}`);
        setDone(job, {
          metadata: meta,
          message: `Checkpoint "${name}" analyzed successfully.`,
        });
      } catch (err) {
        appendLog(job, `ERROR: ${errMsg(err)}`);
        setError(job, errMsg(err) || "Model inspection failed");
      }
    })();

    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    return res.status(400).json({ error: errMsg(err) });
  }
});

router.post("/f0", upload.single("audio"), (req: Request, res: Response) => {
  try {
    const inputAbs = inputFrom(req);
    const parsed = z
      .object({ method: z.enum(["crepe", "fcpe", "rmvpe"]).default("rmvpe") })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    const ts = Date.now();
    const imgAbs = path.join(getOutputsDir(), `f0_plot_${ts}.png`);
    const txtAbs = path.join(getOutputsDir(), `f0_curve_${ts}.txt`);

    const job = createJob("other", { inputPath: inputAbs, method: parsed.data.method });
    void (async () => {
      setRunning(job);
      try {
        try {
          await inferenceWorker.extractF0(job.id, inputAbs, parsed.data.method, imgAbs, txtAbs, (l) =>
            appendLog(job, l),
          );
        } catch {
          appendLog(job, "Running F0 extraction via fallback CLI runner...");
          await new Promise<void>((resolve, reject) => {
            const j = startCliJob(
              "other",
              { inputPath: inputAbs, method: parsed.data.method },
              [
                path.join("rvc", "lib", "tools", "f0_curve.py"),
                "--input-path",
                inputAbs,
                "--method",
                parsed.data.method,
                "--output-image",
                imgAbs,
                "--output-txt",
                txtAbs,
              ],
              {
                parse: () => {
                  resolve();
                  return {};
                },
              },
            );
            setTimeout(() => {
              if (j.status === "error") reject(new Error(j.error || "F0 extraction failed"));
            }, 60000);
          });
        }
        if (!fs.existsSync(imgAbs)) throw new Error("F0 extraction finished but no plot was found.");
        appendLog(job, `F0 curve extracted to ${path.basename(txtAbs)}`);
        setDone(
          job,
          { curveFile: path.relative(getRepoRoot(), txtAbs).replace(/\\/g, "/") },
          path.relative(getRepoRoot(), imgAbs).replace(/\\/g, "/"),
        );
      } catch (err) {
        appendLog(job, `ERROR: ${errMsg(err)}`);
        setError(job, errMsg(err) || "F0 extraction failed");
      }
    })();

    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: errMsg(err) });
  }
});

export default router;
