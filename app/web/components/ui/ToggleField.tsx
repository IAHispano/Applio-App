"use client";

import type React from "react";
import { memo, useId } from "react";

export interface ToggleFieldProps {
  /** Optional custom id, generates one if omitted */
  id?: string;
  /** Primary label for the toggle */
  label: React.ReactNode;
  /** Optional descriptive help text underneath */
  description?: React.ReactNode;
  /** Current checked state */
  checked: boolean;
  /** Change event handler */
  onChange: (checked: boolean) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Optional status badge or indicator beside the label */
  badge?: React.ReactNode;
  /** Extra CSS classes */
  className?: string;
}

function ToggleFieldInner({
  id: customId,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
  className = "",
}: ToggleFieldProps) {
  const generatedId = useId();
  const id = customId || generatedId;
  const descId = description ? `${id}-desc` : undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      <label
        htmlFor={id}
        className={`flex items-center gap-2.5 select-none ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={descId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-xs font-medium text-neutral-200">{label}</span>
        {badge && <span className="ml-1">{badge}</span>}
      </label>
      {description && (
        <p id={descId} className="text-[11px] text-neutral-500 m-0 pl-6 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

function areTogglePropsEqual(prev: ToggleFieldProps, next: ToggleFieldProps) {
  return (
    prev.id === next.id &&
    prev.checked === next.checked &&
    prev.disabled === next.disabled &&
    prev.label === next.label &&
    prev.description === next.description &&
    prev.className === next.className &&
    prev.badge === next.badge
  );
}

const ToggleField = memo(ToggleFieldInner, areTogglePropsEqual);
export default ToggleField;
