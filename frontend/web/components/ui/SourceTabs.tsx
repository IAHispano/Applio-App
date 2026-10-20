"use client";

import type { KeyboardEvent, ReactNode } from "react";

export interface SourceTab<T extends string = string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface SourceTabsProps<T extends string = string> {
  tabs: SourceTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Prefix for the tab and panel ids, so several tablists can coexist. */
  idPrefix: string;
  label: string;
  className?: string;
}

/** Tabs following the ARIA tabs pattern: one stop in the tab order, arrows to move. */
export default function SourceTabs<T extends string = string>({
  tabs,
  active,
  onSelect,
  idPrefix,
  label,
  className = "",
}: SourceTabsProps<T>) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex flex-wrap items-center gap-1.5 max-w-full ${className}`}
    >
      {tabs.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.id}`}
          aria-selected={active === item.id}
          aria-controls={`${idPrefix}-panel-${item.id}`}
          tabIndex={active === item.id ? 0 : -1}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => move(event, index)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
            active === item.id ? "bg-white/10 text-white font-medium" : "text-neutral-400 hover:text-white"
          }`}
        >
          <span className="flex items-center gap-1.5">
            {item.icon}
            <span>{item.label}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
