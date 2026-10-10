"use client";
import { useParams } from "next/navigation";
import JobPanel from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import { useI18n } from "@/lib/i18n";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <PageHeader title={t("Job activity")} />
      <JobPanel jobId={id} showLogs />
    </div>
  );
}
