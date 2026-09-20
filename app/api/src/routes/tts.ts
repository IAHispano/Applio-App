import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { buildTtsInferArgs } from "@/lib/inferArgs";
import { txtUpload } from "@/lib/upload";
import { getOutputsDir, getRepoRoot, getUploadsDir, resolveUserPath } from "@/python";
import { ttsSchema } from "@/schemas";

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

    const ts = Date.now();
    const outTts = path.join(getOutputsDir(), `tts_output_${ts}.wav`);
    const outRvc = path.join(getOutputsDir(), `tts_rvc_output_${ts}.wav`);
    const args = [
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
    const ext = p.exportFormat.toLowerCase();
    const job = startCliJob("tts", { ...p, ttsFile }, args, {
      parse: () => {
        const finalAbs = outRvc.replace(/\.wav$/i, `.${ext}`);
        const served = fs.existsSync(finalAbs) ? finalAbs : outRvc;
        if (!fs.existsSync(served)) throw new Error("TTS finished but no output file was found.");
        return {
          result: { ttsIntermediate: `assets/audios/${path.basename(outTts)}` },
          outputFile: path.relative(getRepoRoot(), served).replace(/\\/g, "/"),
        };
      },
    });
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(500).json({ error: errMsg(err) || "TTS failed to start" });
  }
});

export default router;
