"use client";

import { ChevronDown } from "lucide-react";
import type React from "react";
import { useCallback, useId } from "react";

export interface DisclosureProps {
  /** Header title text */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional icon displayed before the title */
  icon?: React.ReactNode;
  /** Collapsible content */
  children: React.ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Uncontrolled initial open state */
  defaultOpen?: boolean;
  /** Called when the user expands/collapses */
  onToggle?: (open: boolean) => void;
  /** Extra CSS classes for the <details> container */
  className?: string;
  /** Extra CSS classes for the <summary> row */
  summaryClassName?: string;
  /** Extra CSS classes for the content wrapper */
  bodyClassName?: string;
}

/**
 * Boxed collapsible section built on native <details>/<summary>.
 * Replaces the repeated `group border border-white/10 rounded-xl …`
 * accordion boilerplate (icon + title + rotating chevron header).
 */
export default function Disclosure({
  title,
  description,
  icon,
  children,
  open,
  defaultOpen,
  onToggle,
  className = "",
  summaryClassName = "",
  bodyClassName = "",
}: DisclosureProps) {
  const helpId = useId();
  // <details> has no `defaultOpen` attribute — apply the initial state imperatively.
  const initialOpenRef = useCallback(
    (el: HTMLDetailsElement | null) => {
      if (el && open === undefined && defaultOpen !== undefined) {
        el.open = defaultOpen;
      }
    },
    [open, defaultOpen],
  );

  return (
    <details
      data-disclosure
      ref={initialOpenRef}
      className={`group mt-2 p-0 border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--input-bg)] transition-colors ${className}`}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary
        aria-describedby={description ? helpId : undefined}
        className={`min-h-11 px-3.5 py-2.5 cursor-pointer text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface)] flex items-center justify-between gap-3 select-none transition-colors ${summaryClassName}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
          <span className="min-w-0">
            <span className="block break-words">{title}</span>
            {description && (
              <span
                id={helpId}
                className="block mt-1 text-xs font-normal text-[var(--muted)] leading-relaxed"
              >
                {description}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="transition-transform duration-200 group-open:rotate-180 text-[var(--muted)] shrink-0"
        />
      </summary>
      <div className={`disclosure-body px-3.5 pb-3.5 pt-1.5 space-y-4 ${bodyClassName}`}>{children}</div>
    </details>
  );
}
