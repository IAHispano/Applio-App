"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

interface ProgressBarProps {
  progress?: number | null;
  label?: string;
  showValue?: boolean;
  activity?: ReactNode;
}

/** Unknown progress remains indeterminate; percentages come from measured work. */
export default function ProgressBar({ progress, label, showValue = true, activity }: ProgressBarProps) {
  const { t } = useI18n();
  const percent =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : null;
  return (
    <div className="space-y-1">
      {activity && (
        <p className="text-xs text-[var(--muted)] m-0" role="status" aria-live="polite">
          {activity}
        </p>
      )}
      {percent === null ? (
        <div className="loader" role="progressbar" aria-label={label ?? t("Execution in progress")}>
          <div className="loaderBar" />
        </div>
      ) : (
        <>
          <div
            className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
            role="progressbar"
            aria-label={label ?? t("Job progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className="h-full bg-white rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          {showValue && <p className="text-[11px] text-neutral-400 m-0 tabular-nums">{percent}%</p>}
        </>
      )}
    </div>
  );
}
