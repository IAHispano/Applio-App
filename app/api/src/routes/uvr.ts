import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { setProgress } from "@/jobs";
import { audioUpload } from "@/lib/upload";
import { getOutputsDir, resolveUserPath, runPythonModule } from "@/python";

const router = Router();

const upload = audioUpload();

export interface UvrModelEntry {
  filename: string;
  name: string;
  type: string;
  stems: string[];
  target_stem: string | null;
}

// Live registry from uvr/models.py (single source of truth). The catalog
// script is dependency-free, so this answers in well under a second.
async function fetchCatalog(): Promise<UvrModelEntry[]> {
  const r = await runPythonModule([path.join("uvr", "separate.py"), "--list-models"]);
  if (r.code !== 0) throw new Error(r.stderr.slice(-500) || "Model catalog failed.");
  // Regex (not line-split): vendored libs may print warnings to stdout that
  // glue onto the payload line.
  const m = r.stdout.match(/APPLIO_JSON:([^\r\n]+)/);
  if (!m) throw new Error("Model catalog returned no data.");
  const data = JSON.parse(m[1]) as { models: CatalogModel[] };
  if (!Array.isArray(data.models)) throw new Error("Model catalog returned no data.");
  return data.models.map((m) => ({
    filename: m.filename,
    name: m.label,
    type: m.arch.toUpperCase(),
    stems: m.stems.map(titleCase),
    target_stem: m.target ? titleCase(m.target) : null,
  }));
}

interface CatalogModel {
  key: string;
  label: string;
  arch: string;
  filename: string;
  stems: string[];
  target: string | null;
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Curated model registry for the UI (weights download on first use).
router.get("/models", async (_req: Request, res: Response) => {
  try {
    res.json({ models: await fetchCatalog() });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) || "Failed to load UVR model list." });
  }
});

function inputFrom(req: Request): string {
  if (req.file) return req.file.path;
  const p = (req.body as Record<string, unknown>).inputPath;
  if (typeof p === "string" && p) return resolveUserPath(p);
  throw new Error("Provide an 'audio' upload or 'inputPath'.");
}

const separateSchema = z.object({
  model: z.string().min(1),
  inputPath: z.string().optional(),
  outputFormat: z.enum(["WAV", "MP3", "FLAC"]).default("WAV"),
  // "all" keeps every stem; otherwise a single stem name of the chosen model.
  singleStem: z.string().min(1).max(64).default("all"),
  vrAggression: z.coerce.number().int().min(1).max(20).default(5),
  vrWindow: z.coerce.number().int().min(256).max(1024).default(512),
  vrBatch: z.coerce.number().int().min(1).max(8).default(1),
  mdxSegment: z.coerce.number().int().min(32).max(1024).default(256),
  mdxOverlap: z.coerce.number().min(0).max(0.99).default(0.25),
  mdxBatch: z.coerce.number().int().min(1).max(8).default(1),
  device: z
    .string()
    .regex(/^(auto|cpu|\d+)$/)
    .default("auto"),
});

// Separate stems (vocals / instrumental / more) as a tracked job.
router.post("/separate", upload.single("audio"), (req: Request, res: Response) => {
  try {
    const inputAbs = inputFrom(req);
    const parsed = separateSchema.safeParse(req.body);
    if (!parsed.success) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    }
    const p = parsed.data;
    // Model key/filename validity is enforced by uvr/separate.py
    // (catalog.resolve), which fails the job with a clear message.
    const outDir = path.join(getOutputsDir(), `uvr_${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    const args = [
      path.join("uvr", "separate.py"),
      "--input-path",
      inputAbs,
      "--model",
      p.model,
      "--output-dir",
      outDir,
      "--output-format",
      p.outputFormat.toLowerCase(),
      "--single-stem",
      p.singleStem,
      "--vr-aggression",
      String(p.vrAggression),
      "--vr-window",
      String(p.vrWindow),
      "--vr-batch",
      String(p.vrBatch),
      "--mdx-segment",
      String(p.mdxSegment),
      "--mdx-overlap",
      String(p.mdxOverlap),
      "--mdx-batch",
      String(p.mdxBatch),
      "--device",
      p.device,
    ];
    const job = startCliJob(
      "other",
      { inputPath: inputAbs, model: p.model, outputFormat: p.outputFormat, device: p.device },
      args,
      {
        onChunk: (chunk) => {
          // tqdm progress (" 45%|…") → real %. Take the last percentage in
          // the chunk; only move forward.
          const matches = chunk.match(/(\d{1,3})%\s*\|/g);
          if (!matches || matches.length === 0) return;
          const pct = Number(matches[matches.length - 1].replace(/[^0-9]/g, ""));
          if (Number.isFinite(pct) && (job.progress ?? -1) < pct) setProgress(job, pct);
        },
        parse: (stdout) => {
          // Regex (not line-split): progress output may use \r redraws that
          // glue everything into one line, and vendored libs may print
          // warnings to stdout.
          const m = stdout.match(/APPLIO_JSON:([^\r\n]+)/);
          if (!m) throw new Error("Separator finished without reporting outputs.");
          const data = JSON.parse(m[1]) as {
            stems?: Record<string, string>;
            outputFile?: string;
          };
          const entries = Object.entries(data.stems ?? {});
          if (entries.length === 0) throw new Error("No stems produced.");
          setProgress(job, 100);
          const stems = entries.map(([label, file]) => ({
            label,
            file,
            // Ready-to-play URL: outputUrl() only handles flat basenames, so
            // build the subdirectory-preserving URL here instead.
            url: `/${file
              .split("/")
              .map((seg) => encodeURIComponent(seg))
              .join("/")}`,
          }));
          return {
            result: {
              stems,
              message: `Separated ${stems.length} stems with ${p.model}.`,
            },
            // No outputFile on purpose: the page renders one player per stem
            // already (JobPanel only resolves flat output basenames, so a
            // subdirectory file here would render a duplicate broken player).
          };
        },
      },
    );
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: errMsg(err) });
  }
});

export default router;
