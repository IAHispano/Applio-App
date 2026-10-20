"use client";

import { ArrowRight, Check, CheckCircle2, Copy, RefreshCw, Sparkles, Terminal, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStage } from "@/components/JobStatus";
import SetupLogLine from "@/components/setup/SetupLogLine";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg, type Job, pollJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { SetupStatus } from "@/lib/setup";
import { isHiddenSetupLine, mergeSetupLines } from "@/lib/setup-logs";
import { toast } from "@/lib/toast";
import { cleanJobLogs } from "@/lib/useJob";

interface FirstRunSetupProps {
  onComplete: () => void;
}

function setupBridge() {
  return (window as unknown as { applio?: { restartAfterSetup?: (jobId: string) => Promise<void> } }).applio;
}

// Setup phases reported through the job's structured `stage` field (see the
// `jobs.stage(...)` calls in backend/rust-api/src/setup/setup_install.rs).
// A later phase implies every earlier one finished.
const SETUP_PHASES: Record<string, number> = {
  "Creating Python environment…": 1,
  "Installing dependencies…": 2,
  "Downloading models…": 3,
  "Verifying installation…": 4,
};
// The installer only reports success after every readiness check passes, so a
// done job means the whole checklist is complete.
const DONE_PHASE = 5;

// Phase estimation from console output, used when a job has no stage value
// (for example one restored from history). Matches what the installer logs.
function phaseFromLogs(text: string): number {
  if (/verifying installation|web interface ready|default training pretrains/i.test(text)) {
    return 4;
  }
  if (/downloading all files|retrying download|prerequisites installed/i.test(text)) {
    return 3;
  }
  if (
    /torch installation policy|installing microsoft visual c|native amd rocm|removing amd rocm/i.test(text)
  ) {
    return 2;
  }
  if (/creating virtual environment|using cpython|app venv/i.test(text)) {
    return 1;
  }
  return 0;
}

export default function FirstRunSetup({ onComplete }: FirstRunSetupProps) {
  const { t } = useI18n();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const completionStarted = useRef(false);

  const autoStartedRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  // Furthest setup phase reached so far. Kept monotonic so the checklist never
  // flaps backwards when early log lines scroll out of the capped history.
  const setupPhase = useRef(0);

  // Auto-start installation on mount
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    setDesktop(typeof setupBridge()?.restartAfterSetup === "function");

    async function start() {
      setError("");
      try {
        const { jobId: id } = await apiSend<{ jobId: string }>("/api/setup/install", "POST");
        setJobId(id);
      } catch (err) {
        setError(errMsg(err));
      }
    }

    start();
  }, []);

  // Poll setup job progress
  useEffect(() => {
    if (!jobId) return;
    let active = true;

    const stop = pollJob(
      jobId,
      (nextJob) => {
        setJob(nextJob);
        if (nextJob.status === "done") {
          // The installer verifies readiness before completing. Restart desktop
          // before doing another check with its inherited, pre-install environment.
          if (setupBridge()?.restartAfterSetup) {
            setCountdown(2);
            return;
          }
          // Verify final status before starting the launch countdown.
          apiGet<SetupStatus>("/api/setup/status?refresh=1", { force: true })
            .then((status) => {
              if (!active) return;
              if (status.ready) setCountdown(2);
              else setError(t("Setup finished, but some required checks are incomplete."));
            })
            .catch(() => {
              if (active) setCountdown(2);
            });
        } else if (nextJob.status === "error") {
          setError(nextJob.error || t("Setup failed. Please check the console log below."));
        }
      },
      1000,
    );

    return () => {
      active = false;
      stop();
    };
  }, [jobId, t]);

  // Cleaned and filtered logs list. cleanJobLogs also splits \r-glued tqdm
  // redraws and collapses same-bar progress updates in place, so a long
  // "Downloading all files: 64%|…" download stays 1 live line, not 1 per step.
  const processedLogs = useMemo(() => cleanJobLogs(job?.logs), [job?.logs]);
  // Merge word-wrapped installer output (uv splits `Downloading X` / `(size)`
  // across lines) so each download renders as one tidy row.
  const displayLogs = useMemo(() => mergeSetupLines(processedLogs), [processedLogs]);

  // Auto-scroll logs as new output arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when logs length changes
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLogs.length]);

  // Copy logs handler
  const handleCopyLogs = useCallback(() => {
    if (!displayLogs.length) return;
    const text = displayLogs.join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        toast(t("Console logs copied to clipboard"));
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast(t("Failed to copy logs to clipboard"), "error");
      });
  }, [displayLogs, t]);

  const finishSetup = useCallback(async () => {
    if (!jobId || job?.status !== "done" || completionStarted.current) return;
    completionStarted.current = true;
    setCountdown(null);
    const restart = setupBridge()?.restartAfterSetup;
    if (!restart) {
      onComplete();
      return;
    }
    setRestarting(true);
    setError("");
    try {
      await restart(jobId);
    } catch (err) {
      completionStarted.current = false;
      setRestarting(false);
      setError(errMsg(err));
    }
  }, [jobId, job?.status, onComplete]);

  // Countdown to restart desktop or launch the browser UI.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      void finishSetup();
      return;
    }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, finishSetup]);

  // Retry setup
  async function retry() {
    setError("");
    setJob(null);
    setCountdown(null);
    completionStarted.current = false;
    setRestarting(false);
    setupPhase.current = 0;
    try {
      const { jobId: id } = await apiSend<{ jobId: string }>("/api/setup/install", "POST");
      setJobId(id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  // Derive checklist progress from the installer's structured stage, falling
  // back to log markers for jobs restored without one. Logs are capped
  // server-side (last few hundred lines) and early markers scroll out during
  // long downloads, so the furthest phase reached is latched and never
  // regresses. Each step's `phase` is the phase at which it is finished.
  const logsText = useMemo(() => job?.logs.join("\n") || "", [job?.logs]);

  const steps = useMemo(() => {
    const stage = job?.stage ? SETUP_PHASES[job.stage] : undefined;
    const phase =
      job?.status === "done" ? DONE_PHASE : Math.max(setupPhase.current, stage ?? 0, phaseFromLogs(logsText));
    setupPhase.current = phase;

    const hasAmd = /rocm|zluda|amd gpu/i.test(logsText);
    const rawSteps = [
      {
        id: "env",
        title: "AI Runtime Environment",
        desc: "Isolated core processing runtime",
        phase: 2,
      },
      {
        id: "torch",
        title: hasAmd ? "Hardware Acceleration (ROCm / AMD)" : "Hardware Acceleration",
        desc: hasAmd
          ? "Native AMD ROCm hardware acceleration backend"
          : "CUDA, MPS, or high-performance compute backend",
        phase: 3,
      },
      {
        id: "engine",
        title: "Audio Processing Engine",
        desc: "Faiss indexer, FCPE, Crepe, and acoustic models",
        phase: 4,
      },
      {
        id: "models",
        title: "Base Acoustic Checkpoints",
        desc: "HuBERT feature extractor & RMVPE pitch models",
        phase: 4,
      },
      {
        id: "ready",
        title: "Finalizing Applio",
        desc: "Configuring workspaces and pipelines",
        phase: DONE_PHASE,
      },
    ];

    // Every step whose phase is still ahead of the current one waits; the
    // nearest such phase is the one currently running (both the engine and
    // checkpoint rows are active during "Downloading models…").
    const nextPhase = Math.min(...rawSteps.map((step) => step.phase).filter((value) => value > phase));

    return rawSteps.map((step) => ({
      ...step,
      status: phase >= step.phase ? "done" : step.phase === nextPhase ? "running" : "pending",
    }));
  }, [job?.status, job?.stage, logsText]);

  return (
    <div className="w-full min-h-full flex flex-col items-center justify-center p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="w-full page-stack">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="relative inline-flex items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shadow-xl">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            {job?.status !== "done" && !error && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/40 opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 bg-white" />
              </span>
            )}
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white m-0">
              {job?.status === "done" ? t("Applio is Ready") : t("Preparing Applio for First Use")}
            </h1>
            <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed m-0">
              {job?.status === "done"
                ? t("Your environment, voice conversion engine, and acoustic models are prepared.")
                : t(
                    "Automatically setting up dependencies, neural models, and audio engines. This only happens on first launch.",
                  )}
            </p>
          </div>
        </div>

        {/* Progress Bar Card */}
        <Card as="section" className="w-full space-y-4">
          <div className="flex items-center justify-between text-xs text-neutral-300">
            <span className="font-medium flex items-center gap-2">
              {job?.status === "done" ? (
                <CheckCircle2 size={16} className="text-white" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              )}
              <span>
                {job?.status === "done"
                  ? t("Installation Complete")
                  : error
                    ? t("Failed")
                    : t("Automated Setup in Progress")}
              </span>
            </span>
            <span className="text-neutral-400">
              {t("%s / %s Steps")
                .replace("%s", String(steps.filter((s) => s.status === "done").length))
                .replace("%s", String(steps.length))}
            </span>
          </div>

          {!error && (
            <ProgressBar
              progress={job?.status === "done" ? 100 : job?.status === "running" ? job.progress : undefined}
              label={t("Automated Setup in Progress")}
              activity={
                job?.status === "done" ? (
                  t("Installation Complete")
                ) : job ? (
                  <JobStage job={job} />
                ) : (
                  t("Preparing…")
                )
              }
            />
          )}

          {/* Checklist */}
          <div className="space-y-2 pt-2">
            {steps.map((step) => {
              const isDone = step.status === "done";
              const isFailed = job?.status === "error" && step.status === "running";
              const isRunning = step.status === "running" && job?.status !== "error";

              return (
                <div
                  key={step.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${
                    isDone
                      ? "bg-emerald-500/[0.05] border-emerald-500/20 text-neutral-200"
                      : isFailed
                        ? "bg-red-500/[0.05] border-red-500/20 text-neutral-200"
                        : isRunning
                          ? "bg-white/[0.06] border-white/20 text-white shadow-sm"
                          : "bg-white/[0.02] border-white/5 text-neutral-500"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      ) : isFailed ? (
                        <XCircle className="w-4 h-4 text-red-400" />
                      ) : isRunning ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-neutral-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold m-0">{t(step.title)}</p>
                      <p className="text-[11px] text-neutral-400 m-0">{t(step.desc)}</p>
                    </div>
                  </div>

                  <Badge
                    variant={isDone ? "success" : isFailed ? "danger" : isRunning ? "info" : "neutral"}
                    dot={isRunning}
                    size="sm"
                  >
                    {isDone
                      ? t("Ready")
                      : isFailed
                        ? t("Failed")
                        : isRunning
                          ? t("Installing…")
                          : t("Queued")}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Error Alert */}
        {error && (
          <Alert
            variant="error"
            title={t("Setup Encountered an Issue")}
            details={
              job?.errorDetails ||
              (job?.logs && job.logs.length > 0 ? cleanJobLogs(job.logs).slice(-50).join("\n") : undefined)
            }
            copyText={[
              "Applio Setup Error:",
              error,
              job?.id ? `Job ID: ${job.id}` : null,
              job?.errorDetails
                ? `\nError Details:\n${job.errorDetails}`
                : job?.logs && job.logs.length > 0
                  ? `\nRecent Console Logs:\n${cleanJobLogs(job.logs).slice(-60).join("\n")}`
                  : null,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            <div className="space-y-2">
              <p className="m-0 leading-relaxed text-xs">{error}</p>
              <div className="flex items-center gap-2 pt-1">
                <Button size="xs" onClick={retry} icon={<RefreshCw size={13} />}>
                  {t("Retry Automated Setup")}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Activity Details / Live Console Logs (Shown by default) */}
        <Card as="section" className="w-full space-y-3">
          <CardHeader
            icon={<Terminal size={15} className="text-white" />}
            title={
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{t("Activity Details")}</span>
                {job?.status === "running" && (
                  <Badge variant="neutral" dot size="sm">
                    {t("Live")}
                  </Badge>
                )}
                {job?.status === "done" && (
                  <Badge variant="neutral" size="sm">
                    {t("Complete")}
                  </Badge>
                )}
                {job?.status === "error" && (
                  <Badge variant="danger" size="sm">
                    {t("Error")}
                  </Badge>
                )}
              </div>
            }
            action={
              <div className="flex items-center gap-2">
                {displayLogs.length > 0 && (
                  <span className="text-[11px] text-neutral-400 tabular-nums">
                    {displayLogs.length} {displayLogs.length === 1 ? t("line") : t("lines")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleCopyLogs}
                  disabled={!displayLogs.length}
                  title={t("Copy logs to clipboard")}
                  icon={copied ? <Check size={12} className="text-white" /> : <Copy size={12} />}
                >
                  {copied ? t("Copied") : t("Copy")}
                </Button>
              </div>
            }
          />

          <div
            id="setup-console-logs"
            role="log"
            aria-live="polite"
            aria-label={t("Live console output")}
            className="w-full p-3 sm:p-3.5 rounded-xl border border-white/5 bg-black/50 text-xs h-80 overflow-y-auto space-y-0.5 font-mono select-text scrollbar-thin"
          >
            {displayLogs.length ? (
              displayLogs.map((entry, idx) =>
                isHiddenSetupLine(entry) ? null : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only activity logs
                  <div key={`log-${idx}`} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-neutral-600 text-[10px] select-none shrink-0 w-6 text-right tabular-nums pt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <SetupLogLine text={entry} />
                    </div>
                  </div>
                ),
              )
            ) : (
              <div className="h-full w-full flex items-center gap-2 justify-center text-neutral-500 text-xs italic">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                <span>{t("Initializing setup stream…")}</span>
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </Card>

        {/* Launch Button when Done */}
        {job?.status === "done" && (
          <div className="flex justify-end pt-1 animate-in fade-in duration-300">
            <Button
              size="md"
              onClick={() => void finishSetup()}
              disabled={restarting || (!desktop && countdown === null && !!error)}
              className="w-full sm:w-auto shadow-xl px-6"
              iconAfter={<ArrowRight size={16} />}
            >
              {restarting
                ? t("Restarting Applio…")
                : countdown !== null
                  ? t(desktop ? "Restarting Applio (%ss)…" : "Entering Applio (%ss)…").replace(
                      "%s",
                      String(countdown),
                    )
                  : t(desktop ? "Restart Applio" : "Launch Applio")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
