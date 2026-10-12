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
  Layers,
  Radio,
  RefreshCw,
  Volume2,
  Wand2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { JobPanelContent } from "@/components/JobPanel";
import { JobBadge } from "@/components/JobStatus";
import Link from "@/components/layout/IntentLink";
import FirstRunSetup from "@/components/setup/FirstRunSetup";
import { Alert, Badge, Button, Card, CardHeader, StatTile } from "@/components/ui";
import { apiGet, apiSend, displayVersion, errMsg, fileBasename, type Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";
import { useJob } from "@/lib/useJob";

interface ModelsSummary {
  models: string[];
  indexes: string[];
  audios: string[];
}

interface SystemInfo {
  version: string;
  platform: string;
  node: string;
  python: string;
  cpus: number;
  totalMemGB: number;
}

interface LibraryModel {
  pthPath: string;
  name: string;
  indexPath: string | null;
  modifiedAt: string;
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

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const { status, refresh: refreshSetup } = useSetup();
  const [modelsData, setModelsData] = useState<ModelsSummary | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [library, setLibrary] = useState<LibraryModel[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [forceSetup, setForceSetup] = useState(false);
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
      setRefreshing(true);
      try {
        const [, modelsRes, sysRes, verRes, libraryRes, jobsRes] = await Promise.all([
          refreshSetup(force),
          apiGet<ModelsSummary>("/api/models").catch(() => null),
          apiGet<SystemInfo>("/api/report/info").catch(() => null),
          apiGet<VersionInfo>("/api/settings/version-check").catch(() => null),
          apiGet<{ models: LibraryModel[] }>("/api/models/library").catch(() => null),
          apiGet<{ jobs: Job[] }>("/api/jobs/activity").catch(() => null),
        ]);
        if (modelsRes) setModelsData(modelsRes);
        if (sysRes) setSysInfo(sysRes);
        if (verRes) setVersionInfo(verRes);
        if (libraryRes) setLibrary(libraryRes.models);
        if (jobsRes) setJobs(jobsRes.jobs);
        setError("");
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setRefreshing(false);
      }
    },
    [refreshSetup],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void apiGet<{ jobs: Job[] }>("/api/jobs/activity")
        .then((data) => {
          if (!disposed) setJobs(data.jobs);
        })
        .catch(() => {});
    }, 15000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

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
  const updateAvailable =
    versionInfo && !versionInfo.isDev && versionInfo.status === "behind" && versionInfo.latest;
  const currentVersion = displayVersion(sysInfo?.version || versionInfo?.local);

  if (!status) {
    if (error) {
      return (
        <div className="h-full w-full min-h-[300px] flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full space-y-4 text-center">
            <Alert variant="error">{error}</Alert>
            <Button onClick={() => refresh(true)} icon={<RefreshCw size={14} />}>
              {t("Retry Connection")}
            </Button>
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
      </div>
    );
  }

  if (!status.ready || forceSetup) {
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
      <section className="home-hero relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Badge variant="success" dot>
              {t("Ready")}
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
                {t("Open Inference")}
              </Button>
              <Button href="/realtime" variant="ghost" icon={<Radio size={18} />}>
                {t("Realtime")}
              </Button>
            </div>
          </div>
        </div>
      </section>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 card-grid">
        <Card className="lg:col-span-2 !mb-0 !space-y-0 !p-0 overflow-hidden">
          <div className="grid grid-cols-2">
            <Link
              href="/models"
              className="p-5 flex items-center gap-3 hover:bg-[var(--surface)] transition-colors border-r border-[var(--border)]"
            >
              <Database size={18} className="text-[var(--muted)] shrink-0" />
              <div>
                <p className="text-2xl font-semibold text-[var(--heading)] m-0">
                  {modelsData ? modelCount : "—"}
                </p>
                <p className="text-xs text-[var(--muted)] m-0 mt-1">{t("Voice Models")}</p>
              </div>
            </Link>
            <Link
              href="/extra"
              className="p-5 flex items-center gap-3 hover:bg-[var(--surface)] transition-colors"
            >
              <FileAudio size={18} className="text-[var(--muted)] shrink-0" />
              <div>
                <p className="text-2xl font-semibold text-[var(--heading)] m-0">
                  {modelsData ? audioCount : "—"}
                </p>
                <p className="text-xs text-[var(--muted)] m-0 mt-1">{t("Audio files")}</p>
              </div>
            </Link>
          </div>
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
              <ul className="m-0 p-0 list-none divide-y divide-[var(--border)]">
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
                          {model.indexPath ? ` · ${t("Index paired")}` : ""}
                        </p>
                      </div>
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
            <ul className="m-0 p-0 list-none divide-y divide-[var(--border)]">
              {recentJobs.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${encodeURIComponent(job.id)}`}
                    className="block py-3 space-y-2 rounded-lg hover:bg-[var(--surface)] px-2 -mx-2 transition-colors"
                  >
                    <p className="text-sm font-medium text-[var(--heading)] truncate m-0">
                      {t(job.label || job.type)}
                    </p>
                    <JobBadge status={job.status} error={job.error} />
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
            <Badge variant={passedChecks === totalChecks ? "success" : "warning"}>
              {passedChecks}/{totalChecks} {t("passed")}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="xs"
              variant="ghost"
              onClick={prerequisites}
              disabled={prereqRunning}
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

        {error && (
          <div className="mx-4 mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

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
            {status.checks.map((c) => {
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
