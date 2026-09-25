"use client";

import type React from "react";
import { memo } from "react";

export interface StatTileProps {
  /** Metric label / caption */
  label: React.ReactNode;
  /** Primary metric value */
  value: React.ReactNode;
  /** Optional secondary text beneath the value */
  subtext?: React.ReactNode;
  /** Optional icon displayed alongside */
  icon?: React.ReactNode;
  /** Whether to use tabular-nums for numeric alignment (default: true) */
  tabular?: boolean;
  /** Optional HTML title tooltip */
  title?: string;
  /** Extra CSS classes */
  className?: string;
  /** Optional custom content rendered below value/subtext (e.g. progress bar) */
  children?: React.ReactNode;
}

function StatTileInner({
  label,
  value,
  subtext,
  icon,
  tabular = true,
  title,
  className = "",
  children,
}: StatTileProps) {
  return (
    <div className={`rounded-xl bg-black/30 border border-white/5 px-3 py-2 ${className}`} title={title}>
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <p className="text-[10px] text-neutral-500 m-0 font-medium truncate">{label}</p>
        {icon && <span className="text-neutral-500 shrink-0">{icon}</span>}
      </div>
      <p className={`text-xs text-white font-medium m-0 truncate ${tabular ? "tabular-nums" : ""}`}>
        {value}
      </p>
      {subtext && <p className="text-[10px] text-neutral-500 m-0 mt-0.5 truncate">{subtext}</p>}
      {children}
    </div>
  );
}

const StatTile = memo(StatTileInner);
export default StatTile;
