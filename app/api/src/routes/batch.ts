import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { setProgress } from "@/jobs";
import { buildCommonInferArgs } from "@/lib/inferArgs";
import { resolveUserPath } from "@/python";
import { type BatchInferenceParams, batchInferenceSchema } from "@/schemas";

const router = Router();

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

    const args = [
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
    let totalFiles = 0;
    let doneFiles = 0;
    let lastPct = -1;
    const job = startCliJob("batch-inference", p, args, {
      onChunk: (chunk) => {
        // Real progress from the engine's own log markers: file count, then
        // one "File … inferred successfully." line per finished file.
        const totalMatch = chunk.match(/Detected (\d+) audio files for inference\./);
        if (totalMatch) {
          totalFiles = Math.max(1, Number(totalMatch[1]));
          lastPct = 5;
          setProgress(job, 5);
          return;
        }
        if (/File .* inferred successfully\./.test(chunk) && totalFiles > 0) {
          doneFiles += 1;
          const pct = 5 + Math.round((90 * Math.min(doneFiles, totalFiles)) / totalFiles);
          if (pct > lastPct) {
            lastPct = pct;
            setProgress(job, pct);
          }
        }
      },
    });
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) || "Batch inference failed to start" });
  }
});

export default router;
