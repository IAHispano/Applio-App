"use client";

import { StopCircle } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { errMsg, type Job, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { historyState, historyStateLabels } from "@/lib/job-history";
import { cleanJobLogs } from "@/lib/useJob";

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
    // Collapse tqdm progress spam so error diagnostics keep real context
    // instead of 50 "Downloading all files: 64%|…" redraws.
    diagnosticText = cleanJobLogs(logs).slice(-50).join("\n");
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

export function JobProgress({
  status,
  progress,
  job,
}: {
  status: Job["status"];
  progress?: number | null;
  job?: Job;
}) {
  if (status !== "queued" && status !== "running") return null;
  return (
    <ProgressBar
      progress={status === "running" ? progress : undefined}
      activity={job ? <JobStage job={job} /> : undefined}
    />
  );
}

export function JobStage({ job }: { job: Job }) {
  const { t } = useI18n();
  if (job.status !== "running" && job.status !== "queued") return null;
  return (
    <span role="status" aria-live="polite">
      {job.stage
        ? t(job.stage)
        : job.status === "queued"
          ? t("Queued in processing pipeline…")
          : t("In Progress")}
      {job.status === "running" &&
        Number.isFinite(job.stageCurrent) &&
        Number.isFinite(job.stageTotal) &&
        (job.stageTotal ?? 0) > 0 && (
          <span className="tabular-nums">
            {" · "}
            {job.stageCurrent} / {job.stageTotal}
          </span>
        )}
    </span>
  );
}
