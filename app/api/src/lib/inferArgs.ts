import type { InferenceParams } from "../schemas";

// CLI flags for rvc/infer/infer.py inference.

function flag(name: string, value: boolean): string[] {
  return value ? [`--${name}`] : [];
}

export function buildCommonInferArgs(p: InferenceParams): string[] {
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
    ...flag("clean-audio", p.cleanAudio),
    "--clean-strength",
    String(p.cleanStrength),
    ...flag("formant-shifting", p.formantShifting),
    "--formant-qfrency",
    String(p.formantQfrency),
    "--formant-timbre",
    String(p.formantTimbre),
    ...flag("post-process", p.postProcess),
    ...flag("reverb", p.reverb),
    "--reverb-room-size",
    String(p.reverbRoomSize),
    "--reverb-damping",
    String(p.reverbDamping),
    "--reverb-wet-gain",
    String(p.reverbWetGain),
    "--reverb-dry-gain",
    String(p.reverbDryGain),
    "--reverb-width",
    String(p.reverbWidth),
    "--reverb-freeze-mode",
    String(p.reverbFreezeMode),
    ...flag("pitch-shift", p.pitchShift),
    "--pitch-shift-semitones",
    String(p.pitchShiftSemitones),
    ...flag("limiter", p.limiter),
    "--limiter-threshold",
    String(p.limiterThreshold),
    "--limiter-release-time",
    String(p.limiterReleaseTime),
    ...flag("gain", p.gain),
    "--gain-db",
    String(p.gainDb),
    ...flag("distortion", p.distortion),
    "--distortion-gain",
    String(p.distortionGain),
    ...flag("chorus", p.chorus),
    "--chorus-rate",
    String(p.chorusRate),
    "--chorus-depth",
    String(p.chorusDepth),
    "--chorus-center-delay",
    String(p.chorusCenterDelay),
    "--chorus-feedback",
    String(p.chorusFeedback),
    "--chorus-mix",
    String(p.chorusMix),
    ...flag("bitcrush", p.bitcrush),
    "--bitcrush-bit-depth",
    String(p.bitcrushBitDepth),
    ...flag("clipping", p.clipping),
    "--clipping-threshold",
    String(p.clippingThreshold),
    ...flag("compressor", p.compressor),
    "--compressor-threshold",
    String(p.compressorThreshold),
    "--compressor-ratio",
    String(p.compressorRatio),
    "--compressor-attack",
    String(p.compressorAttack),
    "--compressor-release",
    String(p.compressorRelease),
    ...flag("delay", p.delay),
    "--delay-seconds",
    String(p.delaySeconds),
    "--delay-feedback",
    String(p.delayFeedback),
    "--delay-mix",
    String(p.delayMix),
  ];
  if (p.embedderModel === "custom" && p.embedderModelCustom) {
    args.push("--embedder-model-custom", p.embedderModelCustom);
  }
  return args;
}

// TTS shares the core inference subset (no post-process FX rack).
export function buildTtsInferArgs(
  p: Pick<
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
    | "cleanAudio"
    | "cleanStrength"
  >,
): string[] {
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
    ...flag("clean-audio", p.cleanAudio),
    "--clean-strength",
    String(p.cleanStrength),
  ];
  if (p.embedderModel === "custom" && p.embedderModelCustom) {
    args.push("--embedder-model-custom", p.embedderModelCustom);
  }
  return args;
}
