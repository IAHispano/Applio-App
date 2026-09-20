"use client";

import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Download,
  FileAudio,
  Flame,
  Layers,
  Radio,
  RefreshCw,
  Sparkles,
  Volume2,
  Wand2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import JobPanel from "@/components/JobPanel";
import FirstRunSetup from "@/components/setup/FirstRunSetup";
import { Alert, Badge, Button, Card, CardHeader, StatTile } from "@/components/ui";
import { apiGet, apiSend, displayVersion, errMsg, fileBasename } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface SetupCheck {
  id: string;
  label: string;
  status: "ok" | "missing" | "warn";
  detail: string;
}

interface SetupStatus {
  ready: boolean;
  checks: SetupCheck[];
  checkedAt: string;
}

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
  meta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block p-4 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 transition-all space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-neutral-300 group-hover:text-white transition-colors">
          {icon}
        </div>
        <ArrowRight
          size={14}
          className="text-neutral-600 group-hover:text-white group-hover:translate-x-0.5 transition-all"
        />
      </div>
      <div>
        <p className="text-sm font-semibold text-white m-0">{title}</p>
        <p className="text-xs text-neutral-400 m-0 mt-0.5 leading-relaxed">{description}</p>
        {meta && <div className="mt-2">{meta}</div>}
      </div>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [modelsData, setModelsData] = useState<ModelsSummary | null>(null);
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    try {
      const [setupRes, modelsRes, sysRes, verRes] = await Promise.all([
        apiGet<SetupStatus>(`/api/setup/status${force ? "?refresh=1" : ""}`),
        apiGet<ModelsSummary>("/api/models").catch(() => null),
        apiGet<SystemInfo>("/api/report/info").catch(() => null),
        apiGet<VersionInfo>("/api/settings/version-check", { force: true }).catch(() => null),
      ]);
      setStatus(setupRes);
      if (modelsRes) setModelsData(modelsRes);
      if (sysRes) setSysInfo(sysRes);
      if (verRes) setVersionInfo(verRes);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function prerequisites() {
    setError("");
    try {
      const { jobId: id } = await apiSend<{ jobId: string }>("/api/setup/prerequisites", "POST");
      setJobId(id);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const passedChecks = status?.checks.filter((c) => c.status === "ok").length ?? 0;
  const totalChecks = status?.checks.length ?? 0;
  const modelCount = modelsData?.models.length ?? 0;
  const indexCount = modelsData?.indexes.length ?? 0;
  const audioCount = modelsData?.audios.length ?? 0;
  const recentModels = (modelsData?.models ?? []).slice(0, 5);
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
      <div className="w-full max-w-[1920px] mx-auto flex flex-col gap-6 animate-pulse">
        <div className="h-28 rounded-2xl border border-white/5 bg-white/[0.02]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="h-24 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-24 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-24 rounded-xl border border-white/5 bg-white/[0.02]" />
          <div className="h-24 rounded-xl border border-white/5 bg-white/[0.02]" />
        </div>
      </div>
    );
  }

  if (!status.ready) {
    return <FirstRunSetup onComplete={() => refresh(true)} />;
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto flex flex-col gap-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="success" dot>
                {t("Ready")}
              </Badge>
              {currentVersion && <Badge variant="neutral">{currentVersion}</Badge>}
              {sysInfo && <Badge variant="outline">{sysInfo.platform}</Badge>}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white m-0">Applio</h1>
            <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed m-0">
              {t("High-performance AI voice cloning, real-time conversion, and model training.")}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <Button onClick={() => router.push("/inference")} icon={<Sparkles size={16} />}>
              {t("Open Inference")}
            </Button>
            <Button variant="ghost" onClick={() => router.push("/realtime")} icon={<Radio size={16} />}>
              {t("Realtime")}
            </Button>
          </div>
        </div>
      </div>

      {/* Update banner */}
      {updateAvailable && (
        <Alert
          variant="warning"
          title={t("Update available")}
          icon={<Download size={16} className="shrink-0" />}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>
              {displayVersion(versionInfo.local)} → {displayVersion(versionInfo.latest)}
              {versionInfo.versionsBehind ? ` (${versionInfo.versionsBehind} ${t("updates behind")})` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => router.push("/settings")}>
              {t("View update")}
            </Button>
          </div>
        </Alert>
      )}

      {/* Glanceable Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label={t("Voice Models")}
          value={`${modelCount}`}
          subtext={`${indexCount} ${t("indexes")}`}
          icon={<Database size={14} />}
        />
        <StatTile
          label={t("Audio Outputs")}
          value={`${audioCount}`}
          subtext={t("converted clips")}
          icon={<FileAudio size={14} />}
        />
        <StatTile
          label={t("Engine Checks")}
          value={`${passedChecks}/${totalChecks}`}
          subtext={passedChecks === totalChecks ? t("all systems go") : t("see diagnostics")}
          icon={<Activity size={14} />}
        />
        <StatTile
          label={t("App Version")}
          value={currentVersion || t("Unknown")}
          subtext={updateAvailable ? t("update available") : t("up to date")}
          icon={<Cpu size={14} />}
        />
      </div>

      {/* Quick Actions */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-200 m-0">{t("Quick Actions")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <ActionCard
            href="/inference"
            icon={<Wand2 size={18} className="text-white" />}
            title={t("Single Inference")}
            description={t("Convert voice recordings with any installed model.")}
            meta={
              <Badge variant="neutral">
                {modelCount} {modelCount === 1 ? t("model") : t("models")}
              </Badge>
            }
          />
          <ActionCard
            href="/realtime"
            icon={<Radio size={18} className="text-white" />}
            title={t("Realtime Conversion")}
            description={t("Stream live voice conversion with low latency.")}
          />
          <ActionCard
            href="/train"
            icon={<Flame size={18} className="text-white" />}
            title={t("Train a Voice")}
            description={t("Preprocess datasets, extract features, and train.")}
          />
          <ActionCard
            href="/models"
            icon={<Database size={18} className="text-white" />}
            title={t("Model Library")}
            description={t("Download, inspect, blend, and manage voices.")}
          />
          <ActionCard
            href="/tts"
            icon={<Volume2 size={18} className="text-white" />}
            title={t("Text to Speech")}
            description={t("Synthesize speech from text with RVC voices.")}
          />
          <ActionCard
            href="/voice-blender"
            icon={<Layers size={18} className="text-white" />}
            title={t("Voice Blender")}
            description={t("Interpolate weights between two checkpoints.")}
          />
        </div>
      </section>

      {/* Recent Models + System Snapshot */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            icon={<Database size={18} className="text-white" />}
            title={t("Recent Models")}
            description={t("Latest voices in your library.")}
            action={
              <Button size="xs" variant="ghost" onClick={() => router.push("/models")}>
                {t("View all")}
              </Button>
            }
          />
          {recentModels.length > 0 ? (
            <ul className="m-0 p-0 list-none space-y-1.5">
              {recentModels.map((m) => (
                <li key={m}>
                  <Link
                    href="/models"
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-all group"
                  >
                    <span className="text-xs text-neutral-200 font-medium truncate">{fileBasename(m)}</span>
                    <ArrowRight
                      size={13}
                      className="text-neutral-600 group-hover:text-white shrink-0 transition-colors"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={() => router.push("/models")}>
                {t("Download a Model")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => router.push("/train")}>
                {t("Train New Model")}
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<Cpu size={18} className="text-white" />}
            title={t("System Snapshot")}
            description={t("Live environment details from diagnostics.")}
            action={
              <Button size="xs" variant="ghost" onClick={() => refresh(true)} icon={<RefreshCw size={12} />}>
                {t("Refresh")}
              </Button>
            }
          />
          {sysInfo ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <StatTile label={t("Version")} value={displayVersion(sysInfo.version) || "—"} />
              <StatTile label={t("Platform")} value={sysInfo.platform} />
              <StatTile
                label={t("Engine Runtimes")}
                value={`Node ${sysInfo.node}`}
                subtext={sysInfo.python}
              />
              <StatTile
                label={t("Compute Resources")}
                value={`${sysInfo.cpus} CPU cores`}
                subtext={`${sysInfo.totalMemGB} GB RAM`}
              />
            </div>
          ) : (
            <p className="text-xs text-neutral-400 m-0">{t("Collecting system info…")}</p>
          )}
        </Card>
      </div>

      {/* Diagnostics */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between p-4 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Activity size={16} className="text-white" />
            <h3 className="text-sm font-semibold text-neutral-200 m-0">{t("System Diagnostics")}</h3>
            <Badge variant={passedChecks === totalChecks ? "success" : "warning"}>
              {passedChecks}/{totalChecks} {t("passed")}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="xs"
              variant="ghost"
              onClick={prerequisites}
              title={t("Download base models & checkpoints")}
              icon={<Download size={13} />}
            >
              {t("Prerequisites")}
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

        {showDetails && (
          <div className="border-t border-white/5 p-4 bg-black/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5 gap-2.5">
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
            <JobPanel jobId={jobId} embedded />
          </div>
        )}
      </section>
    </div>
  );
}
