"use client";

import type React from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export default function PageHeader({ title, description, children, className = "" }: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 sm:gap-4 pb-4 border-b border-[var(--border)] ${className}`}
    >
      <div className="space-y-1 min-w-0 sm:flex-1 sm:basis-64">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--heading)] m-0 break-words">
          {title}
        </h1>
        {description && (
          <p className="text-[13px] sm:text-sm text-[var(--muted)] m-0 max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">{children}</div>}
    </div>
  );
}
