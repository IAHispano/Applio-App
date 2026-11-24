"use client";

import { Minus, Plus } from "lucide-react";
import type React from "react";
import { memo, useEffect, useId, useState } from "react";
import { useI18n } from "@/lib/i18n";

export interface SliderFieldProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValueText?: string;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
  description?: string;
  disabled?: boolean;
  className?: string;
}

function parseInput(text: string) {
  const normalized = text.trim().replace(",", ".");
  return normalized ? Number(normalized) : Number.NaN;
}

function SliderFieldInner({
  id: customId,
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  defaultValueText,
  formatValue,
  onChange,
  description,
  disabled = false,
  className = "",
}: SliderFieldProps) {
  const { t } = useI18n();
  const generatedId = useId();
  const id = customId || `slider-${generatedId}`;
  const descId = `${id}-desc`;

  const [inputText, setInputText] = useState<string>(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setInputText(String(value));
    }
  }, [value, isFocused]);

  // Compute fill percentage for track styling
  const clampedValue = Math.min(Math.max(value, min), max);
  const percentage = max > min ? Math.max(0, Math.min(100, ((clampedValue - min) / (max - min)) * 100)) : 0;

  const ariaValueText = formatValue ? formatValue(clampedValue) : `${clampedValue}${unit ? ` ${unit}` : ""}`;
  const atMinimum = clampedValue === min;
  const atMaximum = clampedValue === max;

  const commitValue = (valStr: string) => {
    const parsed = parseInput(valStr);
    if (!Number.isFinite(parsed)) {
      setInputText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const precision = step < 1 ? (step.toString().split(".")[1]?.length ?? 2) : 0;
    const rounded = Number(clamped.toFixed(precision));
    if (rounded !== value) onChange(rounded);
    setInputText(String(rounded));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputText(text);
    const parsed = parseInput(text);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max && parsed !== value) {
      onChange(parsed);
    }
  };

  const handleInputBlur = () => {
    setIsFocused(false);
    commitValue(inputText);
  };

  const adjustValue = (change: number) => {
    const next = Math.min(max, Math.max(min, Math.round((clampedValue + change) * 1e4) / 1e4));
    if (next !== value) onChange(next);
    setInputText(String(next));
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        commitValue(inputText);
        break;
      case "ArrowUp":
        event.preventDefault();
        adjustValue(step);
        break;
      case "ArrowDown":
        event.preventDefault();
        adjustValue(-step);
        break;
    }
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label
          htmlFor={id}
          className="text-xs font-medium text-[var(--text)] m-0 select-none cursor-pointer flex-1 min-w-24 wrap-anywhere leading-relaxed"
        >
          {label}
        </label>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="text"
            inputMode="decimal"
            role="spinbutton"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={clampedValue}
            aria-valuetext={ariaValueText}
            aria-label={t("{label} numeric value", { label })}
            aria-describedby={description ? descId : undefined}
            value={inputText}
            disabled={disabled}
            onFocus={() => setIsFocused(true)}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            className="slider-field-number text-xs font-semibold text-center tabular-nums disabled:opacity-40"
          />
          {unit && <span className="text-xs text-[var(--muted)] select-none">{unit}</span>}
          {defaultValueText && (
            <span className="text-xs text-[var(--muted)] select-none hidden min-[480px]:inline">
              ({defaultValueText})
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => adjustValue(-step)}
          disabled={disabled}
          aria-disabled={disabled || atMinimum || undefined}
          aria-label={t("Decrease {label}", { label })}
          aria-controls={id}
          className="slider-step-btn"
        >
          <Minus size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>

        <input
          type="range"
          id={id}
          min={min}
          max={max}
          step={step}
          value={clampedValue}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            onChange(next);
            setInputText(String(next));
          }}
          aria-valuetext={ariaValueText}
          aria-describedby={description ? descId : undefined}
          style={{ "--range-fill": `${percentage}%` } as React.CSSProperties}
          className="range-control flex-1 min-w-0"
        />

        <button
          type="button"
          onClick={() => adjustValue(step)}
          disabled={disabled}
          aria-disabled={disabled || atMaximum || undefined}
          aria-label={t("Increase {label}", { label })}
          aria-controls={id}
          className="slider-step-btn"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>

      {description && (
        <p id={descId} className="field-help m-0">
          {description}
        </p>
      )}
    </div>
  );
}

function areSliderPropsEqual(prev: SliderFieldProps, next: SliderFieldProps) {
  return (
    prev.onChange === next.onChange &&
    prev.formatValue === next.formatValue &&
    prev.id === next.id &&
    prev.value === next.value &&
    prev.min === next.min &&
    prev.max === next.max &&
    prev.step === next.step &&
    prev.unit === next.unit &&
    prev.label === next.label &&
    prev.disabled === next.disabled &&
    prev.description === next.description &&
    prev.defaultValueText === next.defaultValueText &&
    prev.className === next.className
  );
}

const SliderField = memo(SliderFieldInner, areSliderPropsEqual);
export default SliderField;
