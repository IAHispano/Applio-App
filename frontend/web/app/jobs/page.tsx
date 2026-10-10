"use client";

import { ArrowRight, Copy, Download, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JobDetails from "@/components/JobDetails";
import { JobBadge, JobCancelButton, JobProgress } from "@/components/JobStatus";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Badge, Button, Card, CustomSelect, StatTile } from "@/components/ui";
import { apiGet, errMsg, fileBasename, type Job, outputUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { duration, historyState, historyStateLabels, jobContext } from "@/lib/job-history";

export default function JobsPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [type, setType] = useState("all");
  const fetching = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setRefreshing(true);
    try {
      const response = await apiGet<{ jobs: Job[] }>("/api/jobs", { force: true });
      if (mounted.current) {
        setJobs(response.jobs);
        setError("");
      }
    } catch (err) {
      if (mounted.current) setError(errMsg(err));
    } finally {
      fetching.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const labels = useMemo(() => [...new Set(jobs.map((job) => job.label || job.type))].sort(), [jobs]);
  const filtered = useMemo(
    () =>
      jobs.filter(
        (job) =>
          (state === "all" || historyState(job) === state) &&
          (type === "all" || (job.label || job.type) === type) &&
          JSON.stringify([job.id, job.label, job.type, job.params, job.outputFile, job.error, job.result])
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ),
    [jobs, state, type, query],
  );
  const now = Date.now();
  return (
    <div className="space-y-5">
      <PageHeader
        title={t("Job history")}
        description={t("Track progress, inspect settings and results, and revisit previous work.")}
      >
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          {t("Refresh")}
        </Button>
      </PageHeader>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label={t("Active")}
          value={jobs.filter((job) => job.status === "running" || job.status === "queued").length}
        />
        <StatTile label={t("Completed")} value={jobs.filter((job) => job.status === "done").length} />
        <StatTile
          label={t("Failed / interrupted")}
          value={jobs.filter((job) => ["error", "interrupted"].includes(historyState(job))).length}
        />
        <StatTile label={t("Stopped")} value={jobs.filter((job) => historyState(job) === "stopped").length} />
      </div>
      {loading ? (
        <Card>{t("Loading activity…")}</Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--muted)]">
            {t(jobs.length ? "No jobs match these filters." : "No jobs yet.")}
          </p>
        </Card>
      ) : (
        <ul className="list-none m-0 p-0 space-y-3">
          {filtered.map((job) => {
            const jobState = historyState(job);
            const active = job.status === "running" || job.status === "queued";
            const message = job.error || (typeof job.result?.message === "string" ? job.result.message : "");
            return (
              <li key={job.id}>
                <Card className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/jobs/${job.id}`} className="font-semibold text-sm hover:underline">
                        {t(job.label || job.type)}
                      </Link>
                      <p className="m-0 mt-1 text-xs text-[var(--muted)]">
                        {new Date(job.createdAt).toLocaleString()} · {t("Elapsed")}:{" "}
                        {duration(job.createdAt, job.finishedAt || now)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {["stopped", "interrupted"].includes(jobState) ? (
                        <Badge variant="neutral" size="sm" dot>
                          {t(historyStateLabels[jobState])}
                        </Badge>
                      ) : (
                        <JobBadge status={job.status} />
                      )}
                      {active && <JobCancelButton jobId={job.id} onError={setError} />}
                    </div>
                  </div>
                  {jobContext(job).length > 0 && (
                    <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      {jobContext(job).map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-[var(--muted)] mb-1">{t(label)}</dt>
                          <dd className="m-0 break-words [overflow-wrap:anywhere]" title={value}>
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {active && (
                    <>
                      <JobProgress status={job.status} progress={job.progress} />
                      {job.logs.length > 0 && (
                        <p className="m-0 text-xs text-[var(--muted)] line-clamp-2 break-words">
                          {job.logs.at(-1)}
                        </p>
                      )}
                    </>
                  )}
                  {message && (
                    <p
                      className={`m-0 text-xs whitespace-pre-wrap break-words line-clamp-3 ${jobState === "error" ? "text-[var(--err)]" : "text-[var(--muted)]"}`}
                    >
                      {message}
                    </p>
                  )}
                  {job.startedAt && (
                    <p className="m-0 text-xs text-[var(--muted)]">
                      {t("Queue time")}: {duration(job.createdAt, job.startedAt)} · {t("Run time")}:{" "}
                      {duration(job.startedAt, job.finishedAt || now)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      href={`/jobs/${job.id}`}
                      icon={<ArrowRight size={13} />}
                    >
                      {t("Open activity")}
                    </Button>
                    {job.status === "done" && job.outputFile && (
                      <Button
                        variant="ghost"
                        size="xs"
                        href={outputUrl(job.outputFile)}
                        download
                        icon={<Download size={13} />}
                      >
                        {fileBasename(job.outputFile)}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={<Copy size={13} />}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(JSON.stringify(job, null, 2))
                          .catch((err) => setError(errMsg(err)));
                      }}
                    >
                      {t("Copy job details")}
                    </Button>
                  </div>
                  <details className="border-t border-[var(--border)] pt-3">
                    <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--text)]">
                      {t("Settings, results and recent logs")}
                    </summary>
                    <div className="mt-4 space-y-4">
                      <JobDetails job={job} />
                      {job.logs.length > 0 && (
                        <section>
                          <h3 className="text-sm font-medium mt-0 mb-2">{t("Recent logs")}</h3>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs rounded-lg bg-black/30 p-3 m-0">
                            {job.logs.join("\n")}
                          </pre>
                        </section>
                      )}
                    </div>
                  </details>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
