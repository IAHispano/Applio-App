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
}

/** Tabs following the ARIA tabs pattern: one stop in the tab order, arrows to move. */
export default function SourceTabs<T extends string = string>({
  tabs,
  active,
  onSelect,
  idPrefix,
  label,
}: SourceTabsProps<T>) {
  const activeIndex = tabs.findIndex((item) => item.id === active);
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
      className="segmented min-w-0 max-w-full [&>button]:gap-1.5 [&>button]:px-2!"
      style={{ width: `min(100%, ${tabs.length * 10}rem)` }}
    >
      {tabs.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.id}`}
          aria-selected={active === item.id}
          aria-controls={`${idPrefix}-panel-${item.id}`}
          tabIndex={index === Math.max(0, activeIndex) ? 0 : -1}
          title={item.label}
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => move(event, index)}
          className={`segmented-item max-w-full min-w-0 ${active === item.id ? "is-active" : ""}`}
        >
          <span className="shrink-0" aria-hidden="true">
            {item.icon}
          </span>
          <span className="action-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SourceTabPanel({
  idPrefix,
  tab,
  active,
  focusable,
  children,
}: {
  idPrefix: string;
  tab: string;
  active: string;
  focusable?: boolean;
  children: ReactNode;
}) {
  const visible = active === tab;
  return (
    <div
      id={`${idPrefix}-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${tab}`}
      hidden={!visible}
      tabIndex={focusable ? 0 : undefined}
    >
      {visible && children}
    </div>
  );
}
