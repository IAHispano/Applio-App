import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { repoRel, runPythonJson, startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { audioUpload } from "@/lib/upload";
import { getOutputsDir, getRepoRoot, resolveUserPath } from "@/python";

const router = Router();

const upload = audioUpload();

function uvrDir(): string {
  return path.join(getRepoRoot(), "uvr");
}

function modelDir(): string {
  return path.join(getRepoRoot(), "assets", "uvr-models");
}

function inputFrom(req: Request): string {
  if (req.file) return req.file.path;
  const p = (req.body as Record<string, unknown>).inputPath;
  if (typeof p === "string" && p) return resolveUserPath(p);
  throw new Error("Provide an 'audio' upload or 'inputPath'.");
}

export interface UvrModelEntry {
  filename: string;
  name: string;
  type: string;
  stems: string[];
  target_stem: string | null;
}

// Simplified registry ({filename: {Name, Type, Stems, SDR}}) as produced by
// Separator.get_simplified_model_list(), converted for the UI dropdown.
function simplifyRegistry(
  raw: Record<string, { Name?: string; Type?: string; Stems?: string[] }>,
): UvrModelEntry[] {
  const stemToken = (s: string) => s.split(" (")[0];
  const models = Object.entries(raw).map(([filename, data]) => {
    const tokens = (data.Stems ?? []).map(stemToken);
    return {
      filename,
      name: data.Name ?? filename,
      type: data.Type ?? "Unknown",
      stems: tokens.map((t) => t.replace(/\*$/, "")),
      target_stem: tokens.find((t) => t.endsWith("*"))?.replace(/\*$/, "") ?? null,
    };
  });
  models.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return models;
}

let modelsCache: { at: number; models: UvrModelEntry[] } | null = null;

// Curated model registry for the UI (weights download on first use).
router.get("/models", async (_req: Request, res: Response) => {
  try {
    if (modelsCache && Date.now() - modelsCache.at < 3600_000) {
      return res.json({ models: modelsCache.models });
    }
    fs.mkdirSync(modelDir(), { recursive: true });
    const code = [
      "import sys, json, logging",
      `sys.path.insert(0, ${JSON.stringify(uvrDir())})`,
      "from audio_separator.separator import Separator",
      `sep = Separator(log_level=logging.ERROR, model_file_dir=${JSON.stringify(modelDir())}, output_dir=${JSON.stringify(getOutputsDir())}, info_only=True)`,
      "print('APPLIO_JSON:' + json.dumps({'models': sep.get_simplified_model_list()}))",
    ].join("; ");
    const data = await runPythonJson<{
      models: Record<string, { Name?: string; Type?: string; Stems?: string[] }>;
    }>(code);
    const models = simplifyRegistry(data.models);
    modelsCache = { at: Date.now(), models };
    return res.json({ models });
  } catch (err) {
    return res.status(500).json({ error: errMsg(err) || "Failed to load UVR model list." });
  }
});

// Label a separated stem file: "song_(Vocals)_MODEL.wav" -> "Vocals".
export function stemLabel(absPath: string, inputAbs: string): string {
  const ext = path.extname(absPath);
  const base = path.basename(absPath, ext);
  const inputBase = path.basename(inputAbs, path.extname(inputAbs));
  const rest = base.startsWith(`${inputBase}_`) ? base.slice(inputBase.length + 1) : base;
  const m = rest.match(/\(([^)]+)\)[^()]*$/);
  return (m ? m[1] : rest).trim() || base;
}

const separateSchema = z.object({
  model: z.string().min(1),
  inputPath: z.string().optional(),
  outputFormat: z.enum(["WAV", "MP3", "FLAC"]).default("WAV"),
  singleStem: z.enum(["all", "Vocals", "Instrumental"]).default("all"),
  vrAggression: z.coerce.number().int().min(1).max(20).default(5),
  vrWindow: z.coerce.number().int().min(256).max(1024).default(512),
  vrBatch: z.coerce.number().int().min(1).max(8).default(1),
  mdxSegment: z.coerce.number().int().min(32).max(1024).default(256),
  mdxOverlap: z.coerce.number().min(0).max(0.99).default(0.25),
  mdxBatch: z.coerce.number().int().min(1).max(8).default(1),
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
    fs.mkdirSync(modelDir(), { recursive: true });
    const outDir = path.join(getOutputsDir(), `uvr_${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    const args = [
      path.join(uvrDir(), "runner", "separate.py"),
      "--input",
      inputAbs,
      "--model",
      p.model,
      "--output-dir",
      outDir,
      "--model-dir",
      modelDir(),
      "--output-format",
      p.outputFormat,
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
    ];
    if (p.singleStem !== "all") args.push("--single-stem", p.singleStem);
    const job = startCliJob(
      "other",
      { inputPath: inputAbs, model: p.model, outputFormat: p.outputFormat },
      args,
      {
        parse: (stdout) => {
          const line = stdout.split("\n").find((l) => l.startsWith("APPLIO_JSON:"));
          if (!line) throw new Error("Separator finished without reporting outputs.");
          const data = JSON.parse(line.slice("APPLIO_JSON:".length)) as { outputs?: string[] };
          if (!data.outputs || data.outputs.length === 0) throw new Error("No stems produced.");
          const stems = data.outputs.map((abs) => ({
            label: stemLabel(abs, inputAbs),
            file: repoRel(abs),
          }));
          const primary =
            stems.find((s) => /vocals/i.test(s.label)) ??
            stems.find((s) => /instrumental/i.test(s.label)) ??
            stems[0];
          return {
            result: {
              stems,
              message: `Separated ${stems.length} stems with ${p.model}.`,
            },
            outputFile: primary.file,
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
