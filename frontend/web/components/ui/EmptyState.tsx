"use client";

import type React from "react";

export interface EmptyStateProps {
  /** Main illustration or icon */
  icon?: React.ReactNode;
  /** Primary heading */
  title: React.ReactNode;
  /** Explanatory description or call-to-action hint */
  description?: React.ReactNode;
  /** Action buttons or links (e.g., browse, upload, reload) */
  action?: React.ReactNode;
  /** Extra CSS classes */
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-4 space-y-3 select-none ${className}`}
    >
      {icon && (
        <div className="text-[var(--muted)] mb-1 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)]">
          {icon}
        </div>
      )}
      <div className="space-y-1 max-w-md mx-auto">
        <h3 className="text-sm font-semibold text-[var(--heading)] m-0">{title}</h3>
        {description && <p className="text-xs text-[var(--muted)] m-0 leading-relaxed">{description}</p>}
      </div>
      {action && <div className="pt-2 flex flex-wrap justify-center items-center gap-2">{action}</div>}
    </div>
  );
}
