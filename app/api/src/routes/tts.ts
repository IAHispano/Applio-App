import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { trackPid } from "@/cli";
import { errMsg } from "@/errors";
import { appendLog, createJob, getJob, setDone, setError, setProgress, setRunning } from "@/jobs";
import { buildTtsInferArgs } from "@/lib/inferArgs";
import { txtUpload } from "@/lib/upload";
import { getOutputsDir, getRepoRoot, getUploadsDir, resolveUserPath, runPythonModule } from "@/python";
import { type TtsParams, ttsSchema } from "@/schemas";
import { inferenceWorker } from "@/worker";

const router = Router();

const upload = txtUpload();

interface TtsVoiceRaw {
  ShortName: string;
  FriendlyName?: string;
  Gender?: string;
  Locale?: string;
}

interface TtsVoice {
  shortName: string;
  friendlyName: string;
  gender: string;
  locale: string;
}

router.get("/voices", (_req: Request, res: Response) => {
  try {
    const voices = loadVoicesCached();
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) || "Could not load voices" });
  }
});

const voicesCache: { mtimeMs: number; voices: TtsVoice[] } = { mtimeMs: 0, voices: [] };

function loadVoicesCached(): TtsVoice[] {
  const file = path.join(getRepoRoot(), "rvc", "lib", "tools", "tts_voices.json");
  const stat = fs.statSync(file);
  if (voicesCache.voices.length > 0 && voicesCache.mtimeMs === stat.mtimeMs) {
    return voicesCache.voices;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as TtsVoiceRaw[];
  const voices: TtsVoice[] = raw.map((v) => ({
    shortName: v.ShortName,
    friendlyName: v.FriendlyName || v.ShortName,
    gender: v.Gender || "",
    locale: v.Locale || "",
  }));
  voicesCache.mtimeMs = stat.mtimeMs;
  voicesCache.voices = voices;
  return voices;
}

function toCliArgs(p: TtsParams, ttsFile: string, outTts: string, outRvc: string): string[] {
  return [
    path.join("rvc", "lib", "tools", "tts.py"),
    "--tts-file",
    ttsFile,
    "--tts-text",
    p.ttsText,
    "--tts-voice",
    p.ttsVoice,
    "--tts-rate",
    String(p.ttsRate),
    "--output-tts-path",
    outTts,
    "--output-rvc-path",
    outRvc,
    "--pth-path",
    p.pthPath,
    "--index-path",
    p.indexPath || "",
    ...buildTtsInferArgs(p),
  ];
}

router.post("/", upload.single("txt_file"), (req: Request, res: Response) => {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    let ttsFile = "";
    if (req.file) {
      const text = fs.readFileSync(req.file.path, "utf-8");
      const dest = path.join(getUploadsDir(), `tts_input_${Date.now()}.txt`);
      fs.writeFileSync(dest, text, "utf-8");
      fs.rmSync(req.file.path, { force: true });
      ttsFile = dest;
    }
    const parsed = ttsSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    }
    const p = parsed.data;
    if (!p.ttsText && !ttsFile) {
      return res.status(400).json({ error: "Provide 'ttsText' or upload a 'txt_file'." });
    }
    const pthAbs = resolveUserPath(p.pthPath);
    if (!fs.existsSync(pthAbs)) return res.status(400).json({ error: `Model not found: ${p.pthPath}` });

    const job = createJob("tts", { ...p, ttsFile });
    void runTtsJob(job.id, p, ttsFile);
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(500).json({ error: errMsg(err) || "TTS failed to start" });
  }
});

async function runTtsJob(jobId: string, params: TtsParams, ttsFile: string) {
  const job = getJob(jobId);
  if (!job) return;
  setRunning(job);

  const ts = Date.now();
  const ext = params.exportFormat.toLowerCase();
  const outTts = path.join(getOutputsDir(), `tts_output_${ts}.wav`);
  const outRvc = path.join(getOutputsDir(), `tts_rvc_output_${ts}.wav`);
  let runStdout = "";
  let finalServed: string | null = null;

  try {
    setProgress(job, 10);
    try {
      trackPid(job.id, inferenceWorker.getPid());
      const res = await inferenceWorker.tts(
        job.id,
        {
          params,
          ttsText: params.ttsText,
          ttsFile,
          ttsVoice: params.ttsVoice,
          ttsRate: params.ttsRate,
          outputTtsPath: outTts,
          outputRvcPath: outRvc,
        },
        (chunk) => {
          const trimmed = chunk.trim().slice(0, 1000);
          if (trimmed) {
            appendLog(job, trimmed);
            runStdout += `${trimmed}\n`;
            if (/TTS audio generated/i.test(trimmed)) setProgress(job, 40);
            if (/TTS RVC conversion completed/i.test(trimmed)) setProgress(job, 95);
          }
        },
      );
      trackPid(job.id, undefined);
      finalServed = res.outputRvcPath || res.outputPath || outRvc;
    } catch (workerErr) {
      appendLog(job, `Worker notice: ${errMsg(workerErr)}; falling back to standalone CLI runner...`);
      const args = toCliArgs(params, ttsFile, outTts, outRvc);
      const result = await runPythonModule(args, {
        onData: (chunk) => {
          const trimmed = chunk.trim().slice(0, 1000);
          if (trimmed) {
            appendLog(job, trimmed);
            runStdout += `${trimmed}\n`;
            if (/TTS audio generated/i.test(trimmed)) setProgress(job, 40);
          }
        },
        onSpawn: (pid) => trackPid(job.id, pid),
      });
      trackPid(job.id, undefined);
      if (result.code !== 0) {
        throw new Error(result.stderr.slice(-3000) || `TTS failed with code ${result.code}`);
      }
      runStdout += result.stdout;
    }

    const finalAbs = outRvc.replace(/\.wav$/i, `.${ext}`);
    const served =
      finalServed && fs.existsSync(finalServed) ? finalServed : fs.existsSync(finalAbs) ? finalAbs : outRvc;

    if (!fs.existsSync(served)) throw new Error("TTS finished but no output file was found.");
    const rel = path.relative(getRepoRoot(), served).replace(/\\/g, "/");
    appendLog(job, `Done -> ${rel}`);
    setProgress(job, 100);
    setDone(
      job,
      {
        stdout: runStdout.slice(-2000),
        ttsIntermediate: `assets/audios/${path.basename(outTts)}`,
      },
      rel,
    );
  } catch (err) {
    trackPid(job.id, undefined);
    appendLog(job, `ERROR: ${errMsg(err)}`);
    setError(job, errMsg(err) || "TTS failed");
  }
}

export default router;
