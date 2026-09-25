"use client";

import type { LucideIcon } from "lucide-react";
import type React from "react";
import { memo } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  /** Wires each tab to its panel: id="tab-<value>", aria-controls="panel-<value>". */
  tabPanels?: boolean;
}

function SegmentedControlInner<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  tabPanels = false,
}: SegmentedControlProps<T>) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIdx = (index + 1) % options.length;
      onChange(options[nextIdx].value);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIdx = (index - 1 + options.length) % options.length;
      onChange(options[prevIdx].value);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(options[0].value);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(options[options.length - 1].value);
    }
  };

  return (
    <div
      className="segmented max-w-full overflow-x-auto hide-scrollbar"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option, idx) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            id={tabPanels ? `tab-${option.value}` : undefined}
            aria-controls={tabPanels ? `panel-${option.value}` : undefined}
            aria-selected={active}
            className={`segmented-item shrink-0 whitespace-nowrap ${active ? "is-active" : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const SegmentedControl = memo(SegmentedControlInner) as typeof SegmentedControlInner;
export default SegmentedControl;
