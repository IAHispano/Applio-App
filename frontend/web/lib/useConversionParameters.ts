"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ConversionParameterSetters,
  ConversionParameterValues,
} from "@/components/ConversionParameters";
import { modelPresetKey, saveModelPreset, useModelPresets } from "@/lib/model-presets";

export const CONVERSION_DEFAULTS: ConversionParameterValues = {
  pitch: 0,
  indexRate: 0.75,
  volumeEnvelope: 1,
  protect: 0.5,
  f0Method: "rmvpe",
  inferenceEngine: "torch",
  onnxPrecision: "auto",
  embedderModel: "contentvec",
  embedderModelCustom: "",
  exportFormat: "WAV",
  splitAudio: false,
  f0Autotune: false,
  f0AutotuneStrength: 1,
  proposedPitch: false,
  proposedPitchThreshold: 155,
  cleanAudio: false,
  cleanStrength: 0.5,
  formantShifting: false,
  formantQfrency: 1,
  formantTimbre: 1,
  postProcess: false,
  reverb: false,
  reverbRoomSize: 0.5,
  reverbDamping: 0.5,
  reverbWetGain: 0.33,
  reverbDryGain: 0.4,
  reverbWidth: 1,
  reverbFreezeMode: 0,
  pitchShift: false,
  pitchShiftSemitones: 0,
  delay: false,
  delaySeconds: 0.5,
  delayFeedback: 0,
  delayMix: 0.5,
  compressor: false,
  compressorThreshold: 0,
  compressorRatio: 1,
  compressorAttack: 1,
  compressorRelease: 100,
  limiter: false,
  limiterThreshold: -6,
  limiterReleaseTime: 0.05,
  chorus: false,
  chorusRate: 1,
  chorusDepth: 0.25,
  chorusCenterDelay: 7,
  chorusFeedback: 0,
  chorusMix: 0.5,
  bitcrush: false,
  bitcrushBitDepth: 8,
  clipping: false,
  clippingThreshold: -6,
  distortion: false,
  distortionGain: 25,
  gain: false,
  gainDb: 0,
};

export function useConversionParameters(model = "") {
  const presets = useModelPresets();
  const [sessionValues, setValues] = useState<ConversionParameterValues>(() => ({ ...CONVERSION_DEFAULTS }));
  const saved = presets.presets[modelPresetKey("conversion", model)];
  const values = model ? ({ ...CONVERSION_DEFAULTS, ...saved } as ConversionParameterValues) : sessionValues;
  const modelRef = useRef(model);
  modelRef.current = model;
  const setters = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(CONVERSION_DEFAULTS).map((name) => {
          const key = name as keyof ConversionParameterValues;
          return [
            key,
            (value: ConversionParameterValues[typeof key]) => {
              const current = modelRef.current;
              if (current) {
                saveModelPreset("conversion", current, { [key]: value });
                return;
              }
              setValues((previous) =>
                Object.is(previous[key], value) ? previous : { ...previous, [key]: value },
              );
            },
          ];
        }),
      ) as ConversionParameterSetters,
    [],
  );
  const reset = useCallback(() => {
    const current = modelRef.current;
    if (current) saveModelPreset("conversion", current, { ...CONVERSION_DEFAULTS });
    else setValues({ ...CONVERSION_DEFAULTS });
  }, []);
  return { values, setters, reset, loaded: presets.loaded, error: presets.error };
}
