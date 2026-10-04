"use client";

import type { LucideIcon } from "lucide-react";
import type React from "react";
import { memo, useRef } from "react";

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
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const nextIdx = (index + options.length) % options.length;
    onChange(options[nextIdx].value);
    // Keyboard focus follows the selection; otherwise focus stays behind on
    // an element that just became tabindex=-1 and the next Tab escapes.
    itemRefs.current[nextIdx]?.focus();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(options[0].value);
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(options[options.length - 1].value);
      itemRefs.current[options.length - 1]?.focus();
    }
  };

  // Without tabPanels these are not tabs (a tab must control a tabpanel):
  // expose them as radios so screen readers announce a real group.
  const listRole = tabPanels ? "tablist" : "radiogroup";
  const itemRole = tabPanels ? "tab" : "radio";

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is tablist|radiogroup, aria-label is valid on both
    <div
      className="segmented max-w-full overflow-x-auto hide-scrollbar"
      role={listRole}
      aria-label={ariaLabel}
    >
      {options.map((option, idx) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: tab branch uses aria-selected, radio branch uses aria-checked
          <button
            key={option.value}
            type="button"
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            role={itemRole}
            tabIndex={active ? 0 : -1}
            id={tabPanels ? `tab-${option.value}` : undefined}
            aria-controls={tabPanels ? `panel-${option.value}` : undefined}
            aria-selected={tabPanels ? active : undefined}
            aria-checked={!tabPanels ? active : undefined}
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
