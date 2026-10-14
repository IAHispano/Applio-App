import { z } from "zod";

// Mirrors rvc inference options.

export const F0_METHODS = ["crepe", "rmvpe", "fcpe", "swift"] as const;

export const EXPORT_FORMATS = ["WAV", "MP3", "FLAC", "OGG", "M4A"] as const;

export const EMBEDDER_MODELS = [
  "contentvec",
  "spin",
  "spin-v2",
  "chinese-hubert-base",
  "japanese-hubert-base",
  "korean-hubert-base",
  "custom",
] as const;

// Safe boolean coercion that correctly handles string "false", "0", etc.
// z.coerce.boolean() uses Boolean(val), which evaluates Boolean("false") === true.
export const booleanCoerce = z.preprocess((val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off" || s === "") return false;
  }
  if (typeof val === "number") return val !== 0;
  return Boolean(val);
}, z.boolean());

export const baseInferSchema = z.object({
  // Model selection (paths relative to repo root, e.g. logs/my-model/model.pth)
  pthPath: z.string().min(1, "pthPath is required"),
  indexPath: z.string().default(""),

  // Core inference options (rvc VoiceConverter options)
  pitch: z.coerce.number().int().min(-24).max(24).default(0),
  indexRate: z.coerce.number().min(0).max(1).default(0.75),
  volumeEnvelope: z.coerce.number().min(0).max(1).default(1),
  protect: z.coerce.number().min(0).max(0.5).default(0.5),
  f0Method: z.enum(F0_METHODS).default("rmvpe"),
  inferenceEngine: z.enum(["torch", "onnx"]).default("torch"),
  onnxPrecision: z.enum(["auto", "float32", "float16"]).default("auto"),
  splitAudio: booleanCoerce.default(false),
  f0Autotune: booleanCoerce.default(false),
  f0AutotuneStrength: z.coerce.number().min(0).max(1).default(1),
  proposedPitch: booleanCoerce.default(false),
  proposedPitchThreshold: z.coerce.number().min(50).max(1200).default(155),
  exportFormat: z.enum(EXPORT_FORMATS).default("WAV"),
  embedderModel: z.enum(EMBEDDER_MODELS).default("contentvec"),
  embedderModelCustom: z.string().optional().default(""),
  sid: z.coerce.number().int().min(0).default(0),

  // Formant options — all optional, default off/neutral
  formantShifting: booleanCoerce.default(false),
  formantQfrency: z.coerce.number().default(1.0),
  formantTimbre: z.coerce.number().default(1.0),
});

export type InferenceParams = z.infer<typeof baseInferSchema>;

export const inferenceParamsSchema = baseInferSchema;

export const batchInferenceSchema = baseInferSchema
  .omit({ pthPath: true })
  .extend({
    pthPath: z.string().default(""),
    mode: z.enum(["files", "models", "both"]).default("files"),
    inputFolder: z.string().default(""),
    inputPath: z.string().default(""),
    excludedFiles: z.array(z.string().min(1)).max(10000).default([]),
    selectedFiles: z.array(z.string().min(1)).max(10000).optional(),
    continueOnError: booleanCoerce.default(true),
    models: z
      .array(
        z.object({
          pthPath: z.string().min(1),
          indexPath: z.string().default(""),
          overrides: baseInferSchema.partial().default({}),
        }),
      )
      .max(100)
      .default([]),
    outputFolder: z.string().min(1),
  })
  .superRefine((p, ctx) => {
    if (p.mode === "files" && !p.pthPath.trim())
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pthPath"], message: "Select a model" });
    const field = p.mode === "models" ? "inputPath" : "inputFolder";
    if (!p[field].trim())
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Input is required" });
    if (p.mode !== "files" && p.models.length === 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["models"], message: "Select at least one model" });
  });

export type BatchInferenceParams = z.infer<typeof batchInferenceSchema>;

export const ttsInferSchema = baseInferSchema;

export const ttsSchema = ttsInferSchema.extend({
  ttsText: z.string().default(""),
  ttsVoice: z.string().min(1),
  ttsRate: z.coerce.number().int().min(-100).max(100).default(0),
});

export type TtsParams = z.infer<typeof ttsSchema>;
