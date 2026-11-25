"use client";

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Download,
  FileAudio,
  Flame,
  HardDrive,
  Layers,
  RefreshCw,
  Volume2,
  XCircle,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useReducer, useState } from "react";
import Loading from "@/app/loading";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import { JobPanelContent } from "@/components/JobPanel";
import { JobBadge } from "@/components/JobStatus";
import Link from "@/components/layout/IntentLink";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Badge, Button, Card, CardHeader, StatTile } from "@/components/ui";
import Disclosure from "@/components/ui/Disclosure";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg, fileBasename, type Job, outputUrl } from "@/lib/api";
import { type TFn, useI18n } from "@/lib/i18n";
import { jobHref } from "@/lib/job-url";
import { useRealtimeGpuReserved } from "@/lib/realtime-presence";
import { type DiagnosticInfo, diagnosticRuntime } from "@/lib/report";
import { useSetup } from "@/lib/setup";
import { useJob } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

const FirstRunSetup = dynamic(() => import("@/components/setup/FirstRunSetup"), {
  ssr: false,
  loading: Loading,
});

interface DashboardModels {
  modelCount: number;
  audioCount: number;
  recentModels: LibraryModel[];
}

interface LibraryModel {
  pthPath: string;
  name: string;
  indexPath: string | null;
  modifiedAt: string;
  pthSize: number;
}

interface StorageSummary {
  totalBytes: number;
  totalFiles: number;
}

interface LatestOutput {
  jobId: string;
  outputFile: string;
  label: string;
  createdAt: string;
  model: string | null;
  index: string | null;
}

interface DashboardJobs {
  activeJobs: number;
  recentJobs: Pick<Job, "id" | "type" | "label" | "status" | "createdAt" | "stage" | "progress">[];
  latestOutput: LatestOutput | null;
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="card flex min-w-0 items-start gap-3 hover:!border-[var(--focus-border)]">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"
      >
        {icon}
      </span>
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold text-[var(--heading)] m-0 wrap-anywhere">{title}</h3>
        <p className="field-help m-0">{description}</p>
      </div>
    </Link>
  );
}

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function timeAgo(iso: string, t: TFn): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count} min ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count} h ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{count} d ago", { count: days });
  return new Date(iso).toLocaleDateString();
}

function DashboardStat({
  href,
  icon,
  label,
  value,
  subtext,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block min-w-0 rounded-lg">
      <StatTile
        label={label}
        value={<span className="text-xl leading-tight">{value}</span>}
        subtext={subtext}
        icon={<span aria-hidden="true">{icon}</span>}
        className="h-full transition-colors hover:!border-[var(--focus-border)] [&_p]:whitespace-normal [&_p]:wrap-anywhere"
      />
    </Link>
  );
}

function LatestOutputPreview({ outputFile }: { outputFile: string }) {
  const { t } = useI18n();
  const filename = fileBasename(outputFile);
  return (
    <Disclosure title={t("Preview {file}", { file: filename })}>
      {() => (
        <AudioWavePlayer src={outputUrl(outputFile)} filename={filename} showAnalyzerLink={false} compact />
      )}
    </Disclosure>
  );
}

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const { status, isReady, error: setupError, loading: setupLoading, refresh: refreshSetup } = useSetup();
  const [models, setModels] = useWorkspaceState<DashboardModels | null>("page:app:dashboardModels", null);
  const [jobs, setJobs] = useWorkspaceState<DashboardJobs | null>("page:app:dashboardJobs", null);
  const [sysInfo, setSysInfo] = useWorkspaceState<DiagnosticInfo | null>("page:app:sysInfo", null);
  const [storage, setStorage] = useWorkspaceState<StorageSummary | null>("page:app:storage", null);
  const [showDetails, setShowDetails] = useWorkspaceState("page:app:showDetails", false);
  const realtimeLive = useRealtimeGpuReserved();
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobId, setJobId] = useWorkspaceState<string | null>("page:app:jobId", null);
  const [forceSetup, setForceSetup] = useState<boolean | null>(null);
  const [refreshVersion, refreshDashboard] = useReducer((version: number) => version + 1, 0);
  const [stuck, setStuck] = useState(false);
  const activity = useJob(jobId);
  const { job: prereqJob, isActive: prereqRunning } = activity;
  const dashboardRefresh = isReady && forceSetup === false ? refreshVersion : null;

  useEffect(() => {
    const setupParam = new URLSearchParams(window.location.search).get("setup");
    setForceSetup(setupParam === "1" || setupParam === "true");
  }, []);

  const recheck = useCallback(() => {
    setError("");
    refreshDashboard();
    void refreshSetup(true);
  }, [refreshSetup]);

  useEffect(() => {
    if (dashboardRefresh === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    setLoadingModels(true);
    apiGet<DashboardModels>("/api/models/dashboard", { signal })
      .then((data) => {
        if (!signal.aborted) setModels(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!signal.aborted) setLoadingModels(false);
      });
    apiGet<{ stats: StorageSummary }>("/api/settings/storage", { signal })
      .then(({ stats }) => {
        if (!signal.aborted) setStorage(stats);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [dashboardRefresh, setModels, setStorage]);

  useEffect(() => {
    if (dashboardRefresh === null || !showDetails) return;
    const controller = new AbortController();
    const { signal } = controller;
    apiGet<DiagnosticInfo>("/api/report/info", { signal })
      .then((info) => {
        if (!signal.aborted) setSysInfo(info);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [dashboardRefresh, showDetails, setSysInfo]);

  // If /api/setup/status never resolves (backend warming torch, EPERM-locked
  // .venv, offline port), the skeleton below would otherwise look like a dead
  // black screen forever. Surface a fallback with direct access to /setup.
  useEffect(() => {
    if (status) {
      setStuck(false);
      return;
    }
    setStuck(false);
    const timer = setTimeout(() => setStuck(true), 20000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (dashboardRefresh === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoadingJobs(true);
    const poll = async () => {
      if (signal.aborted || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await apiGet<DashboardJobs>("/api/jobs/dashboard", { signal });
        if (!signal.aborted) setJobs(data);
      } catch {
        // Resume after transient service restarts.
      } finally {
        inFlight = false;
        if (!signal.aborted) {
          setLoadingJobs(false);
          timer = setTimeout(poll, 15000);
        }
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        clearTimeout(timer);
        timer = setTimeout(poll, 0);
      }
    };
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => {
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [dashboardRefresh, setJobs]);

  async function prerequisites() {
    setError("");
    try {
      const { jobId: id } = await apiSend<{ jobId: string }>("/api/setup/prerequisites", "POST");
      setJobId(id);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Checks alone can't show the download, so re-run them once the job settles.
  useEffect(() => {
    if (prereqJob?.status === "done") recheck();
    else if (prereqJob?.status === "error" && prereqJob.error) setError(prereqJob.error);
  }, [prereqJob?.status, prereqJob?.error, recheck]);

  const passedChecks = status?.checks.filter((c) => c.status === "ok").length ?? 0;
  const totalChecks = status?.checks.length ?? 0;
  const latestOutput = jobs?.latestOutput;

  if (!status) {
    const combinedError = error || setupError;
    if (combinedError) {
      return (
        <div className="h-full w-full min-h-[300px] flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <Alert variant="error">{combinedError}</Alert>
            <div className="action-row mx-auto">
              <Button onClick={recheck} icon={<RefreshCw size={14} />}>
                {t("Retry Connection")}
              </Button>
              <Button variant="ghost" href="/setup">
                {t("Go to Setup")}
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)] m-0">
              {t("If this persists, open Settings → Report a Bug and attach the backend log.")}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="w-full max-w-[1920px] mx-auto page-stack">
        <div aria-hidden="true" className="page-stack animate-pulse">
          <div className="h-8 w-56 max-w-full rounded-lg bg-[var(--surface)]" />
          <div className="h-9 w-64 max-w-full rounded-lg bg-[var(--surface)]" />
          <div className="grid grid-cols-2 xl:grid-cols-4 card-grid">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-20 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]"
              />
            ))}
          </div>
        </div>
        {(stuck || !setupLoading) && (
          <div className="flex flex-col items-center gap-2 pt-4">
            <p className="text-xs text-[var(--muted)] m-0 text-center">
              {t("Still checking engine status… the first torch import can take a few minutes.")}
            </p>
            <div className="action-row">
              <Button variant="ghost" onClick={recheck} icon={<RefreshCw size={13} />}>
                {t("Retry Check")}
              </Button>
              <Button href="/setup">{t("Go to Setup")}</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status?.ready === false || forceSetup) {
    return (
      <FirstRunSetup
        onComplete={() => {
          setForceSetup(false);
          refreshDashboard();
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader title={t("Your voice workspace")} guide={false} />

      <div className="grid grid-cols-2 xl:grid-cols-4 card-grid">
        <DashboardStat
          href="/models"
          icon={<Database size={16} />}
          label={t("Voice Models")}
          value={models?.modelCount ?? "—"}
        />
        <DashboardStat
          href="/extra"
          icon={<FileAudio size={16} />}
          label={t("Audio files")}
          value={models?.audioCount ?? "—"}
        />
        <DashboardStat
          href="/jobs"
          icon={<Activity size={16} />}
          label={t("Active jobs")}
          value={jobs?.activeJobs ?? "—"}
          subtext={
            realtimeLive ? t("Realtime streaming") : jobs?.activeJobs ? t("Processing now") : t("Idle")
          }
        />
        <DashboardStat
          href="/settings"
          icon={<HardDrive size={16} />}
          label={t("Storage used")}
          value={storage ? formatBytes(storage.totalBytes) : "—"}
          subtext={storage ? `${storage.totalFiles} ${t("files")}` : undefined}
        />
      </div>

      {(error || setupError) && (
        <Alert variant="error">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error || setupError}</span>
            {setupError && (
              <Button variant="ghost" loading={setupLoading} onClick={recheck} icon={<RefreshCw size={14} />}>
                {t("Retry Connection")}
              </Button>
            )}
          </div>
        </Alert>
      )}

      <section className="space-y-3">
        <CardHeader title={t("Quick Actions")} />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 card-grid">
          <ActionCard
            href="/train"
            icon={<Flame size={18} />}
            title={t("Train a Voice")}
            description={t("Preprocess datasets, extract features, and train.")}
          />
          <ActionCard
            href="/tts"
            icon={<Volume2 size={18} />}
            title={t("Text to Speech")}
            description={t("Synthesize speech from text with RVC voices.")}
          />
          <ActionCard
            href="/voice-blender"
            icon={<Layers size={18} />}
            title={t("Voice Blender")}
            description={t("Interpolate weights between two checkpoints.")}
          />
          <ActionCard
            href="/audio-separator"
            icon={<Layers size={18} />}
            title={t("Audio Separator")}
            description={t("Separate vocals and instruments from audio.")}
          />
        </div>
      </section>

      {latestOutput && (
        <Card as="section">
          <CardHeader
            title={t("Latest output")}
            icon={<FileAudio size={17} />}
            description={`${t(latestOutput.label)} · ${timeAgo(latestOutput.createdAt, t)}`}
            action={
              <>
                <Button variant="ghost" href={jobHref(latestOutput.jobId)}>
                  {t("Open job")}
                </Button>
                {latestOutput.model && (
                  <Button
                    variant="ghost"
                    href={`/inference?${new URLSearchParams({
                      model: latestOutput.model,
                      ...(latestOutput.index ? { index: latestOutput.index } : {}),
                    }).toString()}`}
                  >
                    {t("Convert again")}
                  </Button>
                )}
              </>
            }
          />
          <LatestOutputPreview key={latestOutput.jobId} outputFile={latestOutput.outputFile} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 card-grid">
        <Card as="section" className="min-w-0 lg:col-span-2">
          <CardHeader
            title={t("Recent Models")}
            icon={<Database size={17} />}
            action={
              <Button href="/models" variant="ghost">
                {t("View all")}
              </Button>
            }
          />
          {models === null ? (
            <p className="text-sm text-[var(--muted)] m-0">
              {loadingModels ? t("Loading models…") : t("Service unavailable")}
            </p>
          ) : models.recentModels.length ? (
            <ul className="m-0 p-0 list-none">
              {models.recentModels.map((model) => (
                <li key={model.pthPath}>
                  <Link
                    href={`/inference?${new URLSearchParams({ model: model.pthPath, ...(model.indexPath ? { index: model.indexPath } : {}) })}`}
                    className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-[var(--input-bg)] transition-colors"
                  >
                    <span className="flex items-center justify-center size-9 shrink-0 rounded-lg bg-[var(--input-bg)]">
                      <Volume2 size={17} className="text-[var(--muted)]" aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--heading)] m-0 truncate">{model.name}</p>
                      <p className="text-xs text-[var(--muted)] m-0 mt-1 truncate" title={model.pthPath}>
                        {fileBasename(model.pthPath)}
                        {model.pthSize ? ` · ${formatBytes(model.pthSize)}` : ""}
                        {model.indexPath ? ` · ${t("Index paired")}` : ""}
                      </p>
                    </div>
                    <span className="text-[11px] text-[var(--muted)] shrink-0">
                      {timeAgo(model.modifiedAt, t)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center space-y-3">
              <p className="text-sm text-[var(--muted)] m-0">{t("Your models will appear here.")}</p>
              <Button onClick={() => router.push("/models")} icon={<Download size={14} />}>
                {t("Download a Model")}
              </Button>
            </div>
          )}
        </Card>

        <Card as="section" className="min-w-0">
          <CardHeader
            title={t("Recent activity")}
            icon={<Clock3 size={17} />}
            action={
              <Button href="/jobs" variant="ghost">
                {t("View all")}
              </Button>
            }
          />
          {jobs === null ? (
            <p className="text-sm text-[var(--muted)] m-0">
              {loadingJobs ? t("Loading…") : t("Service unavailable")}
            </p>
          ) : jobs.recentJobs.length ? (
            <ul className="m-0 p-0 list-none">
              {jobs.recentJobs.map((job) => (
                <li key={job.id}>
                  <Link
                    href={jobHref(job.id)}
                    className="block py-2.5 space-y-2 rounded-lg hover:bg-[var(--input-bg)] px-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--heading)] truncate m-0">
                        {t(job.label || job.type)}
                      </p>
                      <span className="text-[11px] text-[var(--muted)] shrink-0">
                        {timeAgo(job.createdAt, t)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <JobBadge status={job.status} />
                      {(job.status === "running" || job.status === "queued") && job.stage && (
                        <span className="text-[11px] text-[var(--muted)] truncate">{t(job.stage)}</span>
                      )}
                    </div>
                    {job.status === "running" && <ProgressBar progress={job.progress} />}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)] m-0">{t("No jobs yet.")}</p>
          )}
        </Card>
      </div>

      <Card as="section">
        <CardHeader
          icon={<Activity size={17} />}
          title={t("System Diagnostics")}
          action={
            <>
              <Badge variant={passedChecks === totalChecks ? "success" : "warning"}>
                {`${passedChecks}/${totalChecks} ${t("passed")}`}
              </Badge>
              <Button
                variant="ghost"
                onClick={prerequisites}
                disabled={prereqRunning}
                title={t("Download base voice models and checkpoints (hubert, rmvpe, vocoders)")}
                icon={<Download size={14} />}
              >
                {prereqRunning
                  ? t("Downloading…")
                  : prereqJob?.status === "done"
                    ? t("Downloaded")
                    : t("Prerequisites")}
              </Button>
              <Button
                variant="ghost"
                onClick={recheck}
                title={t("Re-run diagnostic checks")}
                icon={<RefreshCw size={14} />}
              >
                {t("Re-check")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowDetails(!showDetails)}
                aria-expanded={showDetails}
                aria-controls={showDetails ? "home-diagnostics-details" : undefined}
                iconAfter={showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              >
                {showDetails ? t("Hide Details") : t("Show Details")}
              </Button>
            </>
          }
        />

        {showDetails && (
          <div id="home-diagnostics-details" className="card-stack">
            {sysInfo && (
              <div className="grid grid-cols-2 xl:grid-cols-4 card-grid">
                <StatTile label={t("Platform")} value={sysInfo.platform} />
                <StatTile
                  label={t("Engine Runtimes")}
                  value={diagnosticRuntime(sysInfo)}
                  subtext={sysInfo.python}
                />
                <StatTile
                  label={t("Compute Resources")}
                  value={t("{count} CPU cores", { count: sysInfo.cpus })}
                  subtext={t("{count} GB RAM", { count: sysInfo.totalMemGB })}
                />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5">
              {status?.checks.map((c) => {
                const isOk = c.status === "ok";
                const isWarn = c.status === "warn";
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)]"
                  >
                    <div className="mt-0.5 shrink-0" aria-hidden="true">
                      {isOk ? (
                        <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
                      ) : isWarn ? (
                        <AlertCircle className="size-3.5 text-[var(--warn)]" />
                      ) : (
                        <XCircle className="size-3.5 text-[var(--err)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-xs font-medium text-[var(--heading)] wrap-anywhere">
                          {c.label}
                        </span>
                        <Badge variant={isOk ? "success" : isWarn ? "warning" : "danger"}>{c.status}</Badge>
                      </div>
                      <p className="text-[11px] text-[var(--muted)] mt-0.5 m-0 wrap-anywhere">{c.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {jobId && <JobPanelContent jobId={jobId} activity={activity} embedded />}
      </Card>
    </div>
  );
}
