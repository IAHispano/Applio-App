"use client";

import { StopCircle } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import { errMsg, type Job, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { historyState, historyStateLabels } from "@/lib/job-history";

// Shared job status UI: badge + error + cancel + progress.
export function JobBadge({ status, error }: { status: Job["status"]; error?: string }) {
  const { t } = useI18n();
  const state = historyState({ status, error } as Job);
  const interrupted = state === "stopped" || state === "interrupted";
  const variant = interrupted
    ? "neutral"
    : status === "done"
      ? "success"
      : status === "error"
        ? "danger"
        : status === "running"
          ? "info"
          : "neutral";

  return (
    <Badge variant={variant} dot size="sm" aria-label={t("Status: {status}", { status })}>
      {interrupted
        ? t(historyStateLabels[state])
        : status === "done"
          ? t("Completed")
          : status === "running"
            ? t("In Progress")
            : status === "error"
              ? t("Failed")
              : t("Queued")}
    </Badge>
  );
}

export interface JobErrorProps {
  message?: string;
  details?: string;
  logs?: string[];
  jobId?: string;
  className?: string;
  onDismiss?: () => void;
}

export function JobError({ message, details, logs, jobId, className, onDismiss }: JobErrorProps) {
  const { t } = useI18n();
  if (!message && !details && (!logs || logs.length === 0)) return null;

  const errorTitle = message || t("Operation failed.");

  let diagnosticText = details;
  if (!diagnosticText && logs && logs.length > 0) {
    diagnosticText = logs.slice(-50).join("\n");
  }

  const fullCopyText = [
    jobId ? `Job ID: ${jobId}` : null,
    `Error: ${errorTitle}`,
    diagnosticText ? `\nLogs / Details:\n${diagnosticText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Alert
      variant="error"
      title={t("Operation Failed")}
      details={diagnosticText}
      copyText={fullCopyText}
      className={className}
      onDismiss={onDismiss}
    >
      <p className="m-0 leading-relaxed break-words">{errorTitle}</p>
    </Alert>
  );
}

export function JobCancelButton({ jobId, onError }: { jobId: string; onError?: (msg: string) => void }) {
  const { t } = useI18n();
  return (
    <Button
      variant="danger"
      size="xs"
      onClick={() => stopJob(jobId).catch((e) => onError?.(errMsg(e)))}
      aria-label={t("Cancel")}
      icon={<StopCircle size={13} />}
    >
      {t("Cancel")}
    </Button>
  );
}

export function JobProgress({ status, progress }: { status: Job["status"]; progress?: number | null }) {
  const { t } = useI18n();
  if (status !== "queued" && status !== "running") return null;
  if (progress !== undefined && progress !== null) {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    return (
      <div className="space-y-1" style={{ marginTop: 8 }}>
        <div
          className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
          role="progressbar"
          aria-label={t("Job progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className="h-full bg-white rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-neutral-400 m-0 tabular-nums">{pct}%</p>
      </div>
    );
  }
  return (
    <div
      className="loader"
      role="progressbar"
      aria-label={t("Execution in progress")}
      style={{ marginTop: 8 }}
    >
      <div className="loaderBar" />
    </div>
  );
}
