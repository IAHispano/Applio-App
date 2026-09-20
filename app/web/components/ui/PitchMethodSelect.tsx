"use client";

import type React from "react";
import CustomSelect from "./CustomSelect";

/** Pitch extraction algorithms (mirrors the backend F0_METHODS validation). */
export const F0_METHODS = [
  "rmvpe",
  "fcpe",
  "crepe",
  "crepe-tiny",
  "hybrid[crepe+rmvpe]",
  "hybrid[crepe+fcpe]",
  "hybrid[rmvpe+fcpe]",
  "hybrid[crepe+rmvpe+fcpe]",
];

/** Subset supported by the realtime streaming engine. */
export const REALTIME_F0_METHODS = ["rmvpe", "fcpe", "crepe", "crepe-tiny"];

/** Speaker embedding models (mirrors the backend EMBEDDER_MODELS validation). */
export const EMBEDDER_MODELS = [
  "contentvec",
  "spin",
  "spin-v2",
  "chinese-hubert-base",
  "japanese-hubert-base",
  "korean-hubert-base",
  "custom",
];

interface MethodSelectProps {
  /** Selected value */
  value: string;
  /** Called with the new value */
  onChange: (value: string) => void;
  /** Label rendered above the dropdown */
  label: React.ReactNode;
  /** DOM id for the label/control pair */
  id?: string;
  /** Option list override (defaults to the full list) */
  methods?: string[];
  /** Disable the control */
  disabled?: boolean;
  /** Extra CSS classes for the dropdown */
  className?: string;
}

/** Shared pitch-extraction dropdown used by inference, TTS and realtime. */
export function PitchMethodSelect({
  value,
  onChange,
  label,
  id = "pitch-method-select",
  methods = F0_METHODS,
  disabled = false,
  className = "w-full mt-1",
}: MethodSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-neutral-300">
        {label}
      </label>
      <CustomSelect id={id} value={value} onValueChange={onChange} disabled={disabled} className={className}>
        {methods.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </CustomSelect>
    </div>
  );
}

/** Shared embedder-model dropdown used by inference, TTS and realtime. */
export function EmbedderSelect({
  value,
  onChange,
  label,
  id = "embedder-model-select",
  methods = EMBEDDER_MODELS,
  disabled = false,
  className = "w-full mt-1",
}: MethodSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-neutral-300">
        {label}
      </label>
      <CustomSelect id={id} value={value} onValueChange={onChange} disabled={disabled} className={className}>
        {methods.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </CustomSelect>
    </div>
  );
}
