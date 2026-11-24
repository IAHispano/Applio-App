"use client";

import type React from "react";

export interface EmptyStateProps {
  /** Main illustration or icon */
  icon?: React.ReactNode;
  headingLevel?: 1 | 2 | 3;
  /** Primary heading */
  title: React.ReactNode;
  /** Explanatory description or call-to-action hint */
  description?: React.ReactNode;
  /** Action buttons or links (e.g., browse, upload, reload) */
  action?: React.ReactNode;
  /** Extra CSS classes */
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  className = "",
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-8 sm:py-10 px-4 gap-3 ${className}`}
    >
      {icon && (
        <div className="text-[var(--muted)] mb-1 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)]">
          {icon}
        </div>
      )}
      <div className="space-y-1 max-w-md mx-auto">
        <Heading className="text-base font-semibold text-[var(--heading)] m-0">{title}</Heading>
        {description && <p className="text-sm text-[var(--muted)] m-0 leading-relaxed">{description}</p>}
      </div>
      {action && <div className="pt-2 flex flex-wrap justify-center items-center gap-2">{action}</div>}
    </div>
  );
}
