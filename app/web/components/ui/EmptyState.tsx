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
      {icon && <div className="text-neutral-500 mb-1">{icon}</div>}
      <div className="space-y-1 max-w-md mx-auto">
        <h3 className="text-sm font-semibold text-white m-0">{title}</h3>
        {description && <p className="text-xs text-neutral-400 m-0 leading-relaxed">{description}</p>}
      </div>
      {action && <div className="pt-2 flex items-center gap-2">{action}</div>}
    </div>
  );
}
