"use client";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import JobDetails from "@/components/JobDetails";
import { JobPanelContent } from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";

export default function JobPage() {
  const id = useSearchParams().get("id");
  const { t } = useI18n();
  const activity = useJob(id);
  return (
    <div className="page-stack">
      <PageHeader title={t(activity.job?.label || "Job activity")}>
        <Button href="/jobs" variant="ghost" icon={<ArrowLeft size={14} />}>
          {t("Back to job history")}
        </Button>
      </PageHeader>
      <JobPanelContent jobId={id} showLogs activity={activity} />
      {activity.job && (
        <Card>
          <JobDetails job={activity.job} />
        </Card>
      )}
    </div>
  );
}
