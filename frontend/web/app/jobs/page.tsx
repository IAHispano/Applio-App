"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { JobBadge, JobCancelButton } from "@/components/JobStatus";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Card } from "@/components/ui";
import { apiGet, errMsg, type Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function JobsPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stopped = false;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await apiGet<{ jobs: Job[] }>("/api/jobs");
        if (!stopped) {
          setJobs(response.jobs);
          setError("");
        }
      } catch (err) {
        if (!stopped) setError(errMsg(err));
      } finally {
        fetching = false;
        if (!stopped) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="space-y-5">
      <PageHeader title={t("Job history")} />
      {error && <Alert variant="error">{error}</Alert>}
      <Card>
        {loading ? (
          <p>{t("Loading activity…")}</p>
        ) : !jobs.length ? (
          <p>{t("No jobs yet.")}</p>
        ) : (
          <ul className="list-none m-0 p-0 divide-y divide-[var(--border)]">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 py-3">
                <Link href={`/jobs/${job.id}`} className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(job.label || job.type)}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                  {job.error && (
                    <span className="block text-xs text-[var(--muted)] truncate">{job.error}</span>
                  )}
                </Link>
                <JobBadge status={job.status} />
                {(job.status === "queued" || job.status === "running") && (
                  <JobCancelButton jobId={job.id} onError={setError} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
