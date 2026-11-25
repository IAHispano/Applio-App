"use client";

import { Activity, ArrowRight, Copy, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JobDetails from "@/components/JobDetails";
import { JobBadge, JobCancelButton, JobProgress } from "@/components/JobStatus";
import Link from "@/components/layout/IntentLink";
import PageHeader from "@/components/layout/PageHeader";
import SetupLogLine from "@/components/setup/SetupLogLine";
import { Alert, Badge, Button, Card, Disclosure, EmptyState, StatTile } from "@/components/ui";
import { apiGet, errMsg, fileBasename, type Job, outputUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { duration, historyState, historyStateLabels, jobContext } from "@/lib/job-history";
import { jobHref } from "@/lib/job-url";
import { cleanJobLogs } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

async function readHistoryJob(id: string, signal?: AbortSignal) {
  const { job } = await apiGet<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}?logTail=20`, { signal });
  return job;
}

async function copyHistoryJob(id: string) {
  const clipboard = navigator.clipboard;
  const write = clipboard.write;
  if (typeof ClipboardItem !== "undefined" && write) {
    // WebKit requires the write to begin inside the click, before the fetch resolves.
    const data = readHistoryJob(id).then(
      (job) => new Blob([JSON.stringify(job, null, 2)], { type: "text/plain" }),
    );
    await Promise.all([data, write.call(clipboard, [new ClipboardItem({ "text/plain": data })])]);
  } else {
    await clipboard.writeText(JSON.stringify(await readHistoryJob(id), null, 2));
  }
}

function HistoryDetails({ id, updatedAt }: { id: string; updatedAt: string }) {
  const { t } = useI18n();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload when the job changes or the user retries.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void readHistoryJob(id, controller.signal).then(
      (job) => {
        if (!controller.signal.aborted) setJob(job);
      },
      (err) => {
        if (!controller.signal.aborted) setError(errMsg(err));
      },
    );
    return () => controller.abort();
  }, [id, updatedAt, retry]);

  const logs = useMemo(() => cleanJobLogs(job?.logs), [job?.logs]);
  return (
    <div className="mt-4 space-y-4">
      {error && (
        <Alert variant="error">
          <p className="m-0">{error}</p>
          <Button variant="ghost" onClick={() => setRetry((current) => current + 1)}>
            {t("Retry")}
          </Button>
        </Alert>
      )}
      {!job && !error && <p role="status">{t("Loading activity…")}</p>}
      {job && <JobDetails job={job} />}
      {logs.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mt-0 mb-2">{t("Recent logs")}</h3>
          <div className="max-h-48 overflow-auto space-y-2 break-words text-xs rounded-lg bg-black/30 p-3">
            {logs
              .map((line, position) => ({ id: `log-${position}`, line }))
              .map(({ id, line }) => (
                <SetupLogLine key={id} text={line} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function JobsPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useWorkspaceState<Job[]>("page:jobs:jobs", []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetching = useRef(false);
  const mounted = useRef(false);
  const hasActiveJobs = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setRefreshing(true);
    try {
      const response = await apiGet<{ jobs: Job[] }>("/api/jobs?compact=true");
      if (mounted.current) {
        hasActiveJobs.current = response.jobs.some(
          (job) => job.status === "queued" || job.status === "running",
        );
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
  }, [setJobs]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    let elapsed = 0;
    let changed: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      elapsed += 3000;
      if (document.hidden || (!hasActiveJobs.current && elapsed < 30000)) return;
      elapsed = 0;
      void refresh();
    }, 3000);
    const onJobState = () => {
      if (changed || document.hidden) return;
      changed = setTimeout(() => {
        changed = undefined;
        void refresh();
      }, 250);
    };
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("applio:job-state", onJobState);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearTimeout(changed);
      window.removeEventListener("applio:job-state", onJobState);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  const counts = useMemo(() => {
    const totals = { active: 0, completed: 0, failed: 0, stopped: 0 };
    for (const job of jobs) {
      if (job.status === "running" || job.status === "queued") totals.active++;
      else if (job.status === "done") totals.completed++;
      else if (historyState(job) === "stopped") totals.stopped++;
      else totals.failed++;
    }
    return totals;
  }, [jobs]);
  const now = Date.now();
  return (
    <div className="page-stack">
      <PageHeader
        title={t("Job history")}
        description={t("Track progress, inspect settings and results, and revisit previous work.")}
      >
        <Button
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
        <StatTile label={t("Active")} value={counts.active} />
        <StatTile label={t("Completed")} value={counts.completed} />
        <StatTile label={t("Failed / interrupted")} value={counts.failed} />
        <StatTile label={t("Stopped")} value={counts.stopped} />
      </div>
      {loading ? (
        <Card role="status">{t("Loading activity…")}</Card>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState icon={<Activity size={22} />} title={t("No jobs yet.")} />
        </Card>
      ) : (
        <ul className="list-none m-0 p-0 card-stack">
          {jobs.map((job) => {
            const jobState = historyState(job);
            const active = job.status === "running" || job.status === "queued";
            const message = job.error || (typeof job.result?.message === "string" ? job.result.message : "");
            const context = jobContext(job);
            return (
              <li key={job.id}>
                <Card className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="card-heading m-0">
                        <Link href={jobHref(job.id)} className="hover:underline wrap-anywhere">
                          {t(job.label || job.type)}
                        </Link>
                      </h2>
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
                  {context.length > 0 && (
                    <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm bg-[var(--input-bg)] border border-[var(--border)] rounded-lg p-3">
                      {context.map(([label, value]) => (
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
                      <JobProgress status={job.status} progress={job.progress} job={job} />
                      {job.logs.length > 0 && (
                        <p className="m-0 text-xs text-[var(--muted)] line-clamp-2 break-words">
                          {cleanJobLogs(job.logs).at(-1)}
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
                  <div className="action-row [--action-row-width:40rem]">
                    <Button variant="ghost" href={jobHref(job.id)} icon={<ArrowRight size={13} />}>
                      {t("Open activity")}
                    </Button>
                    {job.status === "done" && job.outputFile && (
                      <Button
                        variant="ghost"
                        href={outputUrl(job.outputFile)}
                        download
                        icon={<Download size={13} />}
                      >
                        {fileBasename(job.outputFile)}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      icon={<Copy size={13} />}
                      onClick={() => {
                        void copyHistoryJob(job.id).catch((err) => setError(errMsg(err)));
                      }}
                    >
                      {t("Copy job details")}
                    </Button>
                  </div>
                  <Disclosure title={t("Settings, results and recent logs")}>
                    {() => <HistoryDetails id={job.id} updatedAt={job.updatedAt} />}
                  </Disclosure>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
