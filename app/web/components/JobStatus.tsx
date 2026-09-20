"use client";

import { StopCircle } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import { errMsg, type Job, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// Shared job status UI: badge + error + cancel + progress.
export function JobBadge({ status }: { status: Job["status"] }) {
  const { t } = useI18n();
  const variant =
    status === "done" ? "success" : status === "error" ? "danger" : status === "running" ? "info" : "neutral";

  return (
    <Badge variant={variant} dot size="sm" aria-label={`Status: ${status}`}>
      {status === "done"
        ? t("Completed")
        : status === "running"
          ? t("In Progress")
          : status === "error"
            ? t("Failed")
            : t("Queued")}
    </Badge>
  );
}

export function JobError({ message }: { message?: string }) {
  const { t } = useI18n();
  if (!message) return null;
  return <Alert variant="error">{message || t("Operation failed.")}</Alert>;
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

export function JobProgress({ status }: { status: Job["status"] }) {
  if (status !== "queued" && status !== "running") return null;
  return (
    <div className="loader" role="progressbar" aria-label="Execution in progress" style={{ marginTop: 8 }}>
      <div className="loaderBar" />
    </div>
  );
}
