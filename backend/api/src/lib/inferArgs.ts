import type { InferenceParams } from "@/schemas";

// CLI flags for rvc/infer/infer.py inference.

function flag(name: string, value: boolean): string[] {
  return value ? [`--${name}`] : [];
}

export type CoreInferParams = Pick<
  InferenceParams,
  | "pitch"
  | "indexRate"
  | "volumeEnvelope"
  | "protect"
  | "f0Method"
  | "exportFormat"
  | "embedderModel"
  | "embedderModelCustom"
  | "sid"
  | "splitAudio"
  | "f0Autotune"
  | "f0AutotuneStrength"
  | "proposedPitch"
  | "proposedPitchThreshold"
>;

export function buildCoreInferArgs(p: CoreInferParams): string[] {
  const args: string[] = [
    "--pitch",
    String(p.pitch),
    "--index-rate",
    String(p.indexRate),
    "--volume-envelope",
    String(p.volumeEnvelope),
    "--protect",
    String(p.protect),
    "--f0-method",
    p.f0Method,
    "--export-format",
    p.exportFormat,
    "--embedder-model",
    p.embedderModel,
    "--sid",
    String(p.sid),
    ...flag("split-audio", p.splitAudio),
    ...flag("f0-autotune", p.f0Autotune),
    "--f0-autotune-strength",
    String(p.f0AutotuneStrength),
    ...flag("proposed-pitch", p.proposedPitch),
    "--proposed-pitch-threshold",
    String(p.proposedPitchThreshold),
  ];
  if (p.embedderModel === "custom" && p.embedderModelCustom) {
    args.push("--embedder-model-custom", p.embedderModelCustom);
  }
  return args;
}

export function buildCommonInferArgs(p: InferenceParams): string[] {
  return [
    ...buildCoreInferArgs(p),
    "--inference-engine",
    p.inferenceEngine,
    "--onnx-precision",
    p.onnxPrecision,
    ...flag("formant-shifting", p.formantShifting),
    "--formant-qfrency",
    String(p.formantQfrency),
    "--formant-timbre",
    String(p.formantTimbre),
  ];
}
