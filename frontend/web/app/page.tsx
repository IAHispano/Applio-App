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
import { useCallback, useEffect, useRef, useState } from "react";
import Loading from "@/app/loading";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import { JobPanelContent } from "@/components/JobPanel";
import { JobBadge } from "@/components/JobStatus";
import Link from "@/components/layout/IntentLink";
import PageHeader from "@/components/layout/PageHeader";
import { Alert, Badge, Button, Card, CardHeader, StatTile } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import {
  apiGet,
  apiSend,
  errMsg,
  fetchModels,
  fileBasename,
  isAudioFile,
  type Job,
  outputUrl,
} from "@/lib/api";
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

interface ModelsSummary {
  models: string[];
  indexes: string[];
  audios: string[];
}

interface LibraryModel {
  pthPath: string;
  name: string;
  indexPath: string | null;
  modifiedAt: string;
  pthSize?: number;
  indexSize?: number;
}

interface StorageSummary {
  totalBytes: number;
  totalFiles: number;
}

interface LastConversion {
  jobId: string;
  outputFile: string;
  label?: string;
  createdAt: string;
  model?: string;
  index?: string;
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

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const { status, error: setupError, loading: setupLoading, refresh: refreshSetup } = useSetup();
  const [modelsData, setModelsData] = useWorkspaceState<ModelsSummary | null>("page:app:modelsData", null);
  const [sysInfo, setSysInfo] = useWorkspaceState<DiagnosticInfo | null>("page:app:sysInfo", null);
  const [library, setLibrary] = useWorkspaceState<LibraryModel[] | null>("page:app:library", null);
  const [jobs, setJobs] = useWorkspaceState<Job[] | null>("page:app:jobs", null);
  const [storage, setStorage] = useWorkspaceState<StorageSummary | null>("page:app:storage", null);
  const [lastConversion, setLastConversion] = useWorkspaceState<LastConversion | null>(
    "page:app:lastConversion",
    null,
  );
  const [showDetails, setShowDetails] = useWorkspaceState("page:app:showDetails", false);
  const realtimeLive = useRealtimeGpuReserved();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [jobId, setJobId] = useWorkspaceState<string | null>("page:app:jobId", null);
  const [forceSetup, setForceSetup] = useState(false);
  const requests = useRef<AbortController | null>(null);
  const [stuck, setStuck] = useState(false);
  const activity = useJob(jobId);
  const { job: prereqJob, isActive: prereqRunning } = activity;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("setup") === "1" || params.get("setup") === "true") {
        setForceSetup(true);
      }
    }
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      requests.current?.abort();
      const controller = new AbortController();
      requests.current = controller;
      setRefreshing(true);
      setError("");
      const load = async <T,>(path: string, update: (value: T) => void) => {
        try {
          const value =
            path === "/api/models"
              ? ((await fetchModels(force)) as T)
              : await apiGet<T>(path, { force, signal: controller.signal });
          if (!controller.signal.aborted) update(value);
        } catch {
          // Optional sections remain usable when another service is unavailable.
        }
      };
      await Promise.all([
        refreshSetup(force),
        load<ModelsSummary>("/api/models", setModelsData),
        load<DiagnosticInfo>("/api/report/info", setSysInfo),
        load<{ models: LibraryModel[] }>("/api/models/library", (value) => setLibrary(value.models)),
        load<{ jobs: Job[] }>("/api/jobs/activity", (value) => setJobs(value.jobs)),
        load<{ stats: StorageSummary }>("/api/settings/storage", (value) => setStorage(value.stats)),
        load<{ jobs: Job[] }>("/api/jobs", (value) => {
          const latest = value.jobs
            .filter((job) => job.status === "done" && job.outputFile && isAudioFile(job.outputFile))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          setLastConversion(
            latest?.outputFile
              ? {
                  jobId: latest.id,
                  outputFile: latest.outputFile,
                  label: latest.label,
                  createdAt: latest.createdAt,
                  model: typeof latest.params?.pthPath === "string" ? latest.params.pthPath : undefined,
                  index: typeof latest.params?.indexPath === "string" ? latest.params.indexPath : undefined,
                }
              : null,
          );
        }),
      ]);
      if (!controller.signal.aborted) setRefreshing(false);
    },
    [refreshSetup, setSysInfo, setModelsData, setLibrary, setJobs, setStorage, setLastConversion],
  );

  useEffect(() => {
    refresh();
    return () => requests.current?.abort();
  }, [refresh]);

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
    let disposed = false;
    const controller = new AbortController();
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await apiGet<{ jobs: Job[] }>("/api/jobs/activity", { signal: controller.signal });
        if (!disposed) setJobs(data.jobs);
      } catch {
        // Resume after transient service restarts.
      } finally {
        inFlight = false;
        if (!disposed) timer = setTimeout(poll, 15000);
      }
    };
    const resume = () => {
      if (!document.hidden && !inFlight) {
        clearTimeout(timer);
        timer = setTimeout(poll, 0);
      }
    };
    timer = setTimeout(poll, 15000);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [setJobs]);

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
    if (prereqJob?.status === "done") refresh(true);
    else if (prereqJob?.status === "error" && prereqJob.error) setError(prereqJob.error);
  }, [prereqJob?.status, prereqJob?.error, refresh]);

  const passedChecks = status?.checks.filter((c) => c.status === "ok").length ?? 0;
  const totalChecks = status?.checks.length ?? 0;
  const modelCount = modelsData?.models.length ?? 0;
  const audioCount = modelsData?.audios.length ?? 0;
  const recentModels = library?.slice(0, 4) ?? [];
  const recentJobs = [...(jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const activeJobs = (jobs ?? []).filter((job) => job.status === "running" || job.status === "queued").length;

  if (!status) {
    const combinedError = error || setupError;
    if (combinedError) {
      return (
        <div className="h-full w-full min-h-[300px] flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <Alert variant="error">{combinedError}</Alert>
            <div className="action-row mx-auto">
              <Button onClick={() => refresh(true)} icon={<RefreshCw size={14} />}>
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
              <Button variant="ghost" onClick={() => refresh(true)} icon={<RefreshCw size={13} />}>
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
          refresh(true);
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
          value={modelsData ? modelCount : "—"}
        />
        <DashboardStat
          href="/extra"
          icon={<FileAudio size={16} />}
          label={t("Audio files")}
          value={modelsData ? audioCount : "—"}
        />
        <DashboardStat
          href="/jobs"
          icon={<Activity size={16} />}
          label={t("Active jobs")}
          value={jobs ? activeJobs : "—"}
          subtext={realtimeLive ? t("Realtime streaming") : activeJobs > 0 ? t("Processing now") : t("Idle")}
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
              <Button
                variant="ghost"
                loading={setupLoading}
                onClick={() => refresh(true)}
                icon={<RefreshCw size={14} />}
              >
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

      {lastConversion && (
        <Card as="section">
          <CardHeader
            title={t("Latest output")}
            icon={<FileAudio size={17} />}
            description={`${t(lastConversion.label || "Audio")} · ${timeAgo(lastConversion.createdAt, t)}`}
            action={
              <>
                <Button variant="ghost" href={jobHref(lastConversion.jobId)}>
                  {t("Open job")}
                </Button>
                {lastConversion.model && (
                  <Button
                    variant="ghost"
                    href={`/inference?${new URLSearchParams({
                      model: lastConversion.model,
                      ...(lastConversion.index ? { index: lastConversion.index } : {}),
                    }).toString()}`}
                  >
                    {t("Convert again")}
                  </Button>
                )}
              </>
            }
          />
          <AudioWavePlayer
            src={outputUrl(lastConversion.outputFile)}
            filename={fileBasename(lastConversion.outputFile)}
            showAnalyzerLink={false}
            compact
          />
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
          {library === null ? (
            <p className="text-sm text-[var(--muted)] m-0">
              {refreshing ? t("Loading models…") : t("Service unavailable")}
            </p>
          ) : recentModels.length ? (
            <ul className="m-0 p-0 list-none">
              {recentModels.map((model) => (
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
              {refreshing ? t("Loading…") : t("Service unavailable")}
            </p>
          ) : recentJobs.length ? (
            <ul className="m-0 p-0 list-none">
              {recentJobs.map((job) => (
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
                      <JobBadge status={job.status} error={job.error} />
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
                onClick={() => refresh(true)}
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
