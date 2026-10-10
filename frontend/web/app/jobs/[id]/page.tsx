"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import JobDetails from "@/components/JobDetails";
import { JobPanelContent } from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const activity = useJob(id);
  return (
    <div className="space-y-5">
      <PageHeader title={t(activity.job?.label || "Job activity")}>
        <Link href="/jobs" className="ghost-link">
          {t("Back to job history")}
        </Link>
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
