import fs from "node:fs";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { repoRel, startCliJob } from "@/cli";
import { errMsg } from "@/errors";
import { getRepoRoot } from "@/python";

const router = Router();

// Bundled ffmpeg if present (repo root), else null so yt-dlp resolves
// ffmpeg/ffprobe from PATH — same as setup checks.
function bundledFfmpeg(): string | null {
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const localExe = path.join(getRepoRoot(), exeName);
  return fs.existsSync(localExe) ? localExe : null;
}

const youtubeSchema = z.object({
  url: z
    .string()
    .min(1)
    .regex(
      /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i,
      "Only single YouTube video URLs are supported.",
    ),
  outputFormat: z.enum(["wav", "mp3"]).default("wav"),
});

// Download a YouTube track into assets/audios as a tracked job.
router.post("/youtube", (req: Request, res: Response) => {
  try {
    const parsed = youtubeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
    }
    const { url, outputFormat } = parsed.data;
    const audiosDir = path.join(getRepoRoot(), "assets", "audios");
    fs.mkdirSync(audiosDir, { recursive: true });
    const args = [
      path.join(getRepoRoot(), "tools", "audio", "youtube.py"),
      "--url",
      url,
      "--output-dir",
      audiosDir,
      "--output-format",
      outputFormat,
    ];
    const ffmpeg = bundledFfmpeg();
    if (ffmpeg) args.push("--ffmpeg-bin", ffmpeg);
    const job = startCliJob("other", { url, outputFormat }, args, {
      parse: (stdout) => {
        // Regex (not line-split): progress output may use \r redraws that
        // glue everything into one line.
        const m = stdout.match(/APPLIO_JSON:([^\r\n]+)/);
        if (!m) throw new Error("Download finished without reporting a file.");
        const data = JSON.parse(m[1]) as { file?: string; title?: string };
        if (!data.file || !fs.existsSync(data.file)) throw new Error("Downloaded file not found.");
        return {
          result: {
            file: repoRel(data.file),
            title: data.title ?? "",
            message: data.title ? `Downloaded "${data.title}".` : "YouTube audio downloaded.",
          },
          // Absolute here: startCliJob applies repoRel() once itself.
          outputFile: data.file,
        };
      },
    });
    return res.status(202).json({ jobId: job.id });
  } catch (err) {
    return res.status(400).json({ error: errMsg(err) });
  }
});

export default router;
