"use client";

import type { ReactNode } from "react";
import ProgressBar from "@/components/ui/ProgressBar";

/** A terminal-independent progress row shared by activity logs. */
export default function LogProgress({
  label,
  percent,
  detail,
  meta,
  icon,
  value,
  active = true,
}: {
  label: string;
  percent?: number | null;
  detail?: string;
  meta?: string;
  icon?: ReactNode;
  value?: string;
  active?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-start gap-2 font-medium text-neutral-200">
          {icon}
          <span className="min-w-0 break-words">{label}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-white">
          {value ?? (percent != null ? `${percent}%` : "")}
        </span>
      </div>
      {meta && <p className="m-0 break-words text-xs text-neutral-400">{meta}</p>}
      {(percent != null || active) && <ProgressBar progress={percent} label={label} showValue={false} />}
      {detail && (
        <p className="m-0 break-words text-xs leading-relaxed tabular-nums text-neutral-300">{detail}</p>
      )}
    </div>
  );
}
