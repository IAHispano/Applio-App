import path from "node:path";
import multer from "multer";
import { getUploadsDir } from "@/python";

export const AUDIO_EXTS = new Set(
  ".wav,.mp3,.flac,.ogg,.opus,.m4a,.mp4,.aac,.alac,.wma,.aiff,.webm,.ac3".split(","),
);

export const AUDIO_EXT_LIST = [...AUDIO_EXTS];

function audioFileFilter(_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) return cb(new Error(`Unsupported audio type: ${ext}`));
  cb(null, true);
}

export function audioUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, getUploadsDir()),
      filename: (_req, file, cb) => {
        const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}_${safe}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: audioFileFilter,
  });
}

export function txtUpload() {
  return multer({
    dest: getUploadsDir(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.originalname.toLowerCase().endsWith(".txt")) {
        return cb(new Error("Only .txt files are accepted"));
      }
      cb(null, true);
    },
  });
}
