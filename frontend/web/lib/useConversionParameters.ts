"use client";

import { useCallback, useMemo, useRef } from "react";
import type {
  ConversionParameterSetters,
  ConversionParameterValues,
} from "@/components/ConversionParameters";
import { modelPresetKey, saveModelPreset, useModelPresets } from "@/lib/model-presets";
import { useWorkspaceState } from "@/lib/workspace-state";

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
  f0Autotune: false,
  f0AutotuneStrength: 1,
  proposedPitch: false,
  proposedPitchThreshold: 155,
  formantShifting: false,
  formantQfrency: 1,
  formantTimbre: 1,
  cleanupMode: "off",
  cleanupStrength: 12,
};

/** Keep retired options from old presets and session drafts out of requests. */
export function conversionOverrides(values: object | undefined): Partial<ConversionParameterValues> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([name]) => Object.hasOwn(CONVERSION_DEFAULTS, name)),
  ) as Partial<ConversionParameterValues>;
}

export function useConversionParameters(model = "", workspace = "conversion") {
  const presets = useModelPresets();
  const [sessionValues, setValues] = useWorkspaceState<ConversionParameterValues>(
    `${workspace}:session`,
    () => ({ ...CONVERSION_DEFAULTS }),
  );
  const saved = presets.presets[modelPresetKey("conversion", model)];
  const values = {
    ...CONVERSION_DEFAULTS,
    ...conversionOverrides(model ? saved : sessionValues),
  } as ConversionParameterValues;
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
    [setValues],
  );
  const reset = useCallback(() => {
    const current = modelRef.current;
    if (current) saveModelPreset("conversion", current, { ...CONVERSION_DEFAULTS });
    else setValues({ ...CONVERSION_DEFAULTS });
  }, [setValues]);
  return { values, setters, reset, loaded: presets.loaded, error: presets.error };
}
