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
      className={`group mt-2 p-0 border border-white/10 rounded-lg overflow-hidden bg-white/[0.02] ${className}`}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary
        aria-describedby={description ? helpId : undefined}
        className={`min-h-11 px-3 py-2.5 cursor-pointer text-xs font-semibold text-neutral-300 hover:text-white flex items-center justify-between gap-3 select-none ${summaryClassName}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
          <span className="min-w-0">
            <span className="block truncate">{title}</span>
            {description && (
              <span
                id={helpId}
                className="block mt-0.5 text-[11px] font-normal text-neutral-400 leading-snug"
              >
                {description}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="transition-transform duration-200 group-open:rotate-180 text-neutral-400 shrink-0"
        />
      </summary>
      <div className={`p-3 border-t border-white/10 space-y-3 bg-black/20 ${bodyClassName}`}>{children}</div>
    </details>
  );
}
