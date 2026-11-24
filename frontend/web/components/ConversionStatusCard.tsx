"use client";

import { StopCircle, Wand2 } from "lucide-react";
import { type ReactNode, useId } from "react";
import { JobBadge, JobError, JobStage } from "@/components/JobStatus";
import { Alert, Badge, Button, Card } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import type { Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { historyState } from "@/lib/job-history";

interface ConversionStatusCardProps {
  label: string;
  disabledReason: string;
  pending?: "submitting" | "loading";
  job: Job | null;
  onStop: () => void;
  error?: string;
  onDismissError?: () => void;
  failureMessage: string;
  missingOutput?: string;
  partial?: boolean;
  progressDetails?: ReactNode;
}

export default function ConversionStatusCard({
  label,
  disabledReason,
  pending,
  job,
  onStop,
  error,
  onDismissError,
  failureMessage,
  missingOutput,
  partial,
  progressDetails,
}: ConversionStatusCardProps) {
  const { t } = useI18n();
  const helpId = useId();
  const jobActive = job?.status === "queued" || job?.status === "running";
  const active = Boolean(pending) || jobActive;
  const help = !active && disabledReason;
  const jobState = job && historyState(job);

  let badge: ReactNode;
  if (pending) {
    badge = (
      <Badge variant="info" dot>
        {t(pending === "submitting" ? "Submitting…" : "Loading activity…")}
      </Badge>
    );
  } else if (missingOutput || partial) {
    badge = (
      <Badge variant={missingOutput ? "danger" : "warning"} dot>
        {t(missingOutput ? "Failed" : "Completed with errors")}
      </Badge>
    );
  } else if (job) {
    badge = <JobBadge status={job.status} error={job.error} />;
  }

  return (
    <Card as="section" aria-label={label}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="action-row [--action-row-width:23rem]">
          <Button
            type="submit"
            disabled={active || Boolean(disabledReason)}
            aria-describedby={help ? helpId : undefined}
            icon={<Wand2 size={16} />}
          >
            {label}
          </Button>
          {jobActive && !pending && (
            <Button variant="danger" onClick={onStop} icon={<StopCircle size={16} />}>
              {t("Cancel")}
            </Button>
          )}
        </div>
        <div role="status" className="min-w-0 empty:sr-only [&>span]:max-w-full [&>span]:whitespace-normal">
          {badge}
        </div>
      </div>

      {help && (
        <p id={helpId} className="field-help m-0" role="status">
          {help}
        </p>
      )}

      {active && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4 space-y-2">
          {!pending && job?.stage && (
            <div className="text-xs text-[var(--text)] break-words">
              <JobStage job={job} />
            </div>
          )}
          <ProgressBar progress={!pending && job?.status === "running" ? job.progress : undefined} />
          {!pending && progressDetails}
        </div>
      )}

      {error && (
        <Alert variant="error" onDismiss={onDismissError}>
          {error}
        </Alert>
      )}
      {!pending && missingOutput && <Alert variant="error">{missingOutput}</Alert>}
      {!pending && job?.status === "error" && (
        <JobError
          message={job.error || failureMessage}
          details={job.errorDetails}
          logs={job.logs}
          jobId={job.id}
          notice={jobState === "stopped" || jobState === "interrupted" ? jobState : undefined}
        />
      )}
    </Card>
  );
}
