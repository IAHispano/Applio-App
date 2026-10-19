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
  Radio,
  RefreshCw,
  Volume2,
  Wand2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import { JobPanelContent } from "@/components/JobPanel";
import { JobBadge } from "@/components/JobStatus";
import Link from "@/components/layout/IntentLink";
import FirstRunSetup from "@/components/setup/FirstRunSetup";
import { Alert, Badge, Button, Card, CardHeader, StatTile } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import {
  apiGet,
  apiSend,
  displayVersion,
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
import { useSetup } from "@/lib/setup";
import { useJob } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

interface ModelsSummary {
  models: string[];
  indexes: string[];
  audios: string[];
}

interface SystemInfo {
  version: string;
  platform: string;
  node?: string;
  runtime?: string;
  python: string;
  cpus: number;
  totalMemGB: number;
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

interface VersionInfo {
  local?: string | null;
  latest?: string | null;
  status?: string | null;
  isOutdated?: boolean;
  versionsBehind?: number;
  isDev?: boolean;
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
    <Link
      href={href}
      className="group flex flex-row sm:flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 hover:border-[var(--focus-border)] hover:bg-[var(--surface)] transition-colors"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-[var(--heading)] m-0">{title}</h3>
        <p className="text-sm text-[var(--muted)] m-0 leading-relaxed">{description}</p>
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

function HeroStat({
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
    <Link
      href={href}
      className="group flex h-full items-center gap-3 rounded-xl px-2 py-1.5 -mx-2 hover:bg-[var(--surface)] transition-colors min-w-0"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold text-[var(--heading)] m-0 leading-tight tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)] m-0 mt-0.5 truncate">{label}</p>
        {subtext && <p className="text-[11px] text-[var(--muted)] m-0 mt-0.5 truncate">{subtext}</p>}
      </div>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const { status, error: setupError, loading: setupLoading, refresh: refreshSetup } = useSetup();
  const [modelsData, setModelsData] = useWorkspaceState<ModelsSummary | null>("page:app:modelsData", null);
  const [sysInfo, setSysInfo] = useWorkspaceState<SystemInfo | null>("page:app:sysInfo", null);
  const [library, setLibrary] = useWorkspaceState<LibraryModel[] | null>("page:app:library", null);
  const [jobs, setJobs] = useWorkspaceState<Job[] | null>("page:app:jobs", null);
  const [storage, setStorage] = useWorkspaceState<StorageSummary | null>("page:app:storage", null);
  const [lastConversion, setLastConversion] = useWorkspaceState<LastConversion | null>(
    "page:app:lastConversion",
    null,
  );
  const [versionInfo, setVersionInfo] = useWorkspaceState<VersionInfo | null>("page:app:versionInfo", null);
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
      // Online release checks must not hold up local dashboard content or Refresh.
      void load<VersionInfo>("/api/settings/version-check", setVersionInfo);
      await Promise.all([
        refreshSetup(force),
        load<ModelsSummary>("/api/models", setModelsData),
        load<SystemInfo>("/api/report/info", setSysInfo),
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
    [
      refreshSetup,
      setSysInfo,
      setVersionInfo,
      setModelsData,
      setLibrary,
      setJobs,
      setStorage,
      setLastConversion,
    ],
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
  const updateAvailable =
    versionInfo && !versionInfo.isDev && versionInfo.status === "behind" && versionInfo.latest;
  const currentVersion = displayVersion(sysInfo?.version || versionInfo?.local);

  if (!status) {
    const combinedError = error || setupError;
    if (combinedError) {
      return (
        <div className="h-full w-full min-h-[300px] flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <Alert variant="error">{combinedError}</Alert>
            <div className="flex items-center justify-center gap-2 flex-wrap">
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
      <div className="w-full max-w-[1920px] mx-auto flex flex-col page-stack animate-pulse">
        <div className="h-52 sm:h-56 rounded-xl border border-white/5 bg-white/[0.02]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 card-grid">
          <div className="h-40 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-40 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-40 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-40 rounded-xl border border-white/5 bg-white/[0.02]" />
        </div>
        {(stuck || !setupLoading) && (
          <div className="flex flex-col items-center gap-2 pt-4 animate-none">
            <p className="text-xs text-[var(--muted)] m-0 text-center">
              {t("Still checking engine status… the first torch import can take a few minutes.")}
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <Button size="sm" variant="ghost" onClick={() => refresh(true)} icon={<RefreshCw size={13} />}>
                {t("Retry Check")}
              </Button>
              <Button size="sm" href="/setup">
                {t("Go to Setup")}
              </Button>
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
    <div className="w-full max-w-[1920px] mx-auto flex flex-col page-stack">
      <section className="home-hero relative overflow-hidden rounded-xl border border-[var(--border)] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Badge variant={status?.ready ? "success" : "neutral"} dot>
              {t(status?.ready ? "Ready" : "Checking engine status…")}
            </Badge>
            {currentVersion && <span className="text-xs text-[var(--muted)]">Applio {currentVersion}</span>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            loading={refreshing}
            onClick={() => refresh(true)}
            icon={<RefreshCw size={14} />}
          >
            {t("Refresh")}
          </Button>
        </div>
        <div className="pt-5">
          <div className="space-y-5">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight text-[var(--heading)] m-0">
              {t("Your voice workspace")}
            </h1>
            <p className="text-base text-[var(--muted)] leading-relaxed m-0">
              {t("High-performance AI voice cloning, real-time conversion, and model training.")}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button href="/inference" icon={<Wand2 size={18} />}>
                {t("Convert Audio")}
              </Button>
              <Button href="/realtime" variant="ghost" icon={<Radio size={18} />}>
                {t("Realtime")}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-6 pt-5 grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          <HeroStat
            href="/models"
            icon={<Database size={16} />}
            label={t("Voice Models")}
            value={modelsData ? modelCount : "—"}
          />
          <HeroStat
            href="/extra"
            icon={<FileAudio size={16} />}
            label={t("Audio files")}
            value={modelsData ? audioCount : "—"}
          />
          <HeroStat
            href="/jobs"
            icon={<Activity size={16} />}
            label={t("Active jobs")}
            value={jobs ? activeJobs : "—"}
            subtext={
              realtimeLive ? t("Realtime streaming") : activeJobs > 0 ? t("Processing now") : t("Idle")
            }
          />
          <HeroStat
            href="/settings"
            icon={<HardDrive size={16} />}
            label={t("Storage used")}
            value={storage ? formatBytes(storage.totalBytes) : "—"}
            subtext={storage ? `${storage.totalFiles} ${t("files")}` : undefined}
          />
        </div>
      </section>

      {(error || setupError) && (
        <Alert variant="error">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error || setupError}</span>
            {setupError && (
              <Button
                size="sm"
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

      {/* Update banner */}
      {updateAvailable && (
        <Alert
          variant="warning"
          title={t("Update available")}
          icon={<Download size={16} className="shrink-0" />}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>
              {displayVersion(versionInfo.latest)}
              {versionInfo.versionsBehind ? ` (${versionInfo.versionsBehind} ${t("updates behind")})` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => router.push("/settings")}>
              {t("View update")}
            </Button>
          </div>
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--heading)] m-0">{t("Quick Actions")}</h2>
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
        <Card className="!mb-0 !space-y-0 !p-5 sm:!p-6">
          <CardHeader
            border={false}
            title={t("Latest output")}
            icon={<FileAudio size={17} />}
            description={`${t(lastConversion.label || "Audio")} · ${timeAgo(lastConversion.createdAt, t)}`}
            action={
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="ghost" href={jobHref(lastConversion.jobId)}>
                  {t("Open job")}
                </Button>
                {lastConversion.model && (
                  <Button
                    size="xs"
                    variant="ghost"
                    href={`/inference?${new URLSearchParams({
                      model: lastConversion.model,
                      ...(lastConversion.index ? { index: lastConversion.index } : {}),
                    }).toString()}`}
                  >
                    {t("Convert again")}
                  </Button>
                )}
              </div>
            }
          />
          <div className="pt-1">
            <AudioWavePlayer
              src={outputUrl(lastConversion.outputFile)}
              filename={fileBasename(lastConversion.outputFile)}
              showAnalyzerLink={false}
              compact
            />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 card-grid">
        <Card className="lg:col-span-2 !mb-0 !space-y-0 !p-0 overflow-hidden">
          <div className="p-5 sm:p-6 space-y-4">
            <CardHeader
              border={false}
              title={t("Recent Models")}
              description={t("Latest voices in your library.")}
              action={
                <Link
                  href="/models"
                  className="text-xs text-[var(--muted)] hover:text-[var(--heading)] inline-flex items-center gap-1.5"
                >
                  {t("View all")}
                </Link>
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
                      className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-[var(--surface)] transition-colors group"
                    >
                      <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl bg-[var(--surface)]">
                        <Volume2 size={18} className="text-[var(--muted)]" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--heading)] m-0 truncate">
                          {model.name}
                        </p>
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
              <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center space-y-4">
                <Database size={24} className="mx-auto text-[var(--muted)]" />
                <p className="text-sm text-[var(--muted)] m-0">{t("Your models will appear here.")}</p>
                <Button size="sm" onClick={() => router.push("/models")} icon={<Download size={14} />}>
                  {t("Download a Model")}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="!mb-0 !p-5 sm:!p-6">
          <CardHeader
            border={false}
            title={t("Recent activity")}
            icon={<Clock3 size={17} />}
            action={
              <Link href="/jobs" className="text-xs text-[var(--muted)] hover:text-[var(--heading)]">
                {t("View all")}
              </Link>
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
                    className="block py-3 space-y-2 rounded-lg hover:bg-[var(--surface)] px-2 -mx-2 transition-colors"
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
            <div className="py-5 space-y-3">
              <p className="text-sm font-medium text-[var(--heading)] m-0">{t("No jobs yet.")}</p>
              <p className="text-xs leading-relaxed text-[var(--muted)] m-0">
                {t("Track progress, inspect settings and results, and revisit previous work.")}
              </p>
              <Link
                href="/jobs"
                className="inline-flex items-center gap-2 text-xs text-[var(--heading)] mt-2"
              >
                {t("Job history")}
              </Link>
            </div>
          )}
        </Card>
      </div>

      {/* Diagnostics */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between p-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Activity size={16} className="text-white" />
            <h2 className="text-sm font-semibold text-neutral-200 m-0">{t("System Diagnostics")}</h2>
            <Badge variant={!status ? "neutral" : passedChecks === totalChecks ? "success" : "warning"}>
              {status ? `${passedChecks}/${totalChecks} ${t("passed")}` : t("Checking…")}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="xs"
              variant="ghost"
              onClick={prerequisites}
              disabled={!status?.ready || prereqRunning}
              title={t("Download base voice models and checkpoints (hubert, rmvpe, vocoders)")}
              icon={<Download size={13} />}
            >
              {prereqRunning
                ? t("Downloading…")
                : prereqJob?.status === "done"
                  ? t("Downloaded")
                  : t("Prerequisites")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => refresh(true)}
              title={t("Re-run diagnostic checks")}
              icon={<RefreshCw size={13} />}
            >
              {t("Re-check")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
              aria-controls="home-diagnostics-details"
              iconAfter={showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            >
              {showDetails ? t("Hide Details") : t("Show Details")}
            </Button>
          </div>
        </div>

        {showDetails && sysInfo && (
          <div className="px-4 pb-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile label={t("App Version")} value={displayVersion(sysInfo.version) || "—"} />
            <StatTile label={t("Platform")} value={sysInfo.platform} />
            <StatTile label={t("Engine Runtimes")} value={`Node ${sysInfo.node}`} subtext={sysInfo.python} />
            <StatTile
              label={t("Compute Resources")}
              value={t("{count} CPU cores", { count: sysInfo.cpus })}
              subtext={`${sysInfo.totalMemGB} GB RAM`}
            />
          </div>
        )}

        {showDetails && (
          <div
            id="home-diagnostics-details"
            className="p-4 bg-black/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5 gap-2.5"
          >
            {status?.checks.map((c) => {
              const isOk = c.status === "ok";
              const isWarn = c.status === "warn";
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-2 p-2.5 rounded-lg border border-white/5 bg-white/[0.01]"
                >
                  <div className="mt-0.5 shrink-0">
                    {isOk ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    ) : isWarn ? (
                      <AlertCircle className="w-3.5 h-3.5 text-neutral-300" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-neutral-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium text-neutral-200 truncate">{c.label}</span>
                      <Badge variant={isOk ? "success" : isWarn ? "warning" : "danger"}>{c.status}</Badge>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-0.5 truncate m-0">{c.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {jobId && (
          <div className="px-4 pb-4">
            <JobPanelContent jobId={jobId} activity={activity} embedded />
          </div>
        )}
      </section>
    </div>
  );
}
