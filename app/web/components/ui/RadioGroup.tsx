"use client";

import type React from "react";
import { useId } from "react";

export interface RadioOption {
  value: string;
  label?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Label describing the radio group */
  label?: React.ReactNode;
  /** Name attribute for HTML radio inputs */
  name?: string;
  /** List of options (strings or option objects) */
  options: Array<string | RadioOption>;
  /** Currently selected value */
  value: string;
  /** Callback fired when selection changes */
  onChange: (value: string) => void;
  /** Layout orientation: horizontal (default) or vertical */
  orientation?: "horizontal" | "vertical";
  /** Visual variant: 'pills' (compact interactive chips) or 'radio' (traditional radio items) */
  variant?: "pills" | "radio";
  /** Optional container class */
  className?: string;
  /** Disabled state for all options */
  disabled?: boolean;
}

export function RadioGroup({
  label,
  name: explicitName,
  options,
  value,
  onChange,
  orientation = "horizontal",
  variant = "radio",
  className = "",
  disabled = false,
}: RadioGroupProps) {
  const autoId = useId();
  const groupName = explicitName || `radio-group-${autoId}`;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && <span className="block text-xs font-medium text-neutral-300">{label}</span>}
      <div
        role="radiogroup"
        aria-label={typeof label === "string" ? label : undefined}
        className={orientation === "horizontal" ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-2"}
      >
        {options.map((opt) => {
          const item: RadioOption = typeof opt === "string" ? { value: opt, label: opt } : opt;
          const isSelected = value === item.value;
          const isDisabled = disabled || item.disabled;

          if (variant === "pills") {
            return (
              <label
                key={item.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all select-none border shrink-0 inline-flex items-center justify-center ${
                  isSelected
                    ? "bg-white text-black border-white shadow-sm font-semibold"
                    : "bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white"
                } ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={item.value}
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => !isDisabled && onChange(item.value)}
                  className="sr-only"
                />
                <span>{item.label || item.value}</span>
              </label>
            );
          }

          return (
            <label
              key={item.value}
              className={`inline-flex items-center gap-2 text-xs select-none transition-colors ${
                isSelected ? "text-white font-medium" : "text-neutral-400 hover:text-neutral-200"
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={groupName}
                value={item.value}
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => !isDisabled && onChange(item.value)}
                className="accent-white cursor-pointer"
              />
              <span>{item.label || item.value}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default RadioGroup;
