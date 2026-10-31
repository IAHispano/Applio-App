"use client";

import { ArrowRight, Check, CheckCircle2, Copy, RefreshCw, Terminal, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStage } from "@/components/JobStatus";
import SetupLogLine from "@/components/setup/SetupLogLine";
import { useAcceptedTerms } from "@/components/setup/TermsModal";
import { Alert, Badge, Button, Card, CardHeader, Disclosure } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg, type Job, pollJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { type SetupStatus, useSetup } from "@/lib/setup";
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
  const termsAccepted = useAcceptedTerms();
  const { refresh: refreshSetup } = useSetup();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const completionStarted = useRef(false);

  const autoStartedRef = useRef(false);
  const logsRef = useRef<HTMLDivElement | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  // Furthest setup phase reached so far. Kept monotonic so the checklist never
  // flaps backwards when early log lines scroll out of the capped history.
  const setupPhase = useRef(0);

  // Auto-start installation on mount
  useEffect(() => {
    if (!termsAccepted || autoStartedRef.current) return;
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
  }, [termsAccepted]);

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

  useEffect(() => {
    if (error) setLogsOpen(true);
  }, [error]);

  // Scroll only the console, keeping the welcome and progress in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when logs length changes
  useEffect(() => {
    const console = logsRef.current;
    if (logsOpen && console) console.scrollTop = console.scrollHeight;
  }, [displayLogs.length, logsOpen]);

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
      await refreshSetup(true);
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
  }, [jobId, job?.status, onComplete, refreshSetup]);

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

    const rawSteps = [
      { id: "env", title: "Creating Python environment…", phase: 2 },
      { id: "engine", title: "Installing dependencies…", phase: 3 },
      { id: "models", title: "Downloading models…", phase: 4 },
      { id: "ready", title: "Verifying installation…", phase: DONE_PHASE },
    ];

    const nextPhase = Math.min(...rawSteps.map((step) => step.phase).filter((value) => value > phase));

    return rawSteps.map((step) => ({
      ...step,
      status: phase >= step.phase ? "done" : step.phase === nextPhase ? "running" : "pending",
    }));
  }, [job?.status, job?.stage, logsText]);

  return (
    <div className="w-full min-h-full flex flex-col items-center justify-center p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="w-full space-y-6 sm:space-y-8">
        <header className="space-y-4">
          <p className="m-0 flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
            <span className="font-bold tracking-wide text-[var(--heading)]">Applio</span>
            <span aria-hidden="true">/</span>
            {t("Setup")}
          </p>
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--heading)] m-0">
              {job?.status === "done" ? t("Applio is Ready") : t("Welcome to Applio")}
            </h1>
            <p className="text-sm text-[var(--muted)] max-w-lg leading-relaxed m-0">
              {job?.status === "done"
                ? t("Your environment, voice conversion engine, and acoustic models are prepared.")
                : t(
                    "We’ll prepare everything you need to start creating with your voice. Setup runs automatically.",
                  )}
            </p>
          </div>
        </header>

        {/* Progress Bar Card */}
        <Card as="section" className="w-full !p-4 sm:!p-6 space-y-5">
          <div className="flex items-center justify-between text-xs text-neutral-300">
            <span className="font-medium flex items-center gap-2">
              {error ? (
                <XCircle size={16} className="text-red-400" />
              ) : job?.status === "done" ? (
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
          <ol className="list-none m-0 p-0 space-y-2">
            {steps.map((step, index) => {
              const isDone = step.status === "done";
              const isFailed = !!error && step.status === "running";
              const isRunning = step.status === "running" && !error;

              return (
                <li
                  key={step.id}
                  aria-current={isRunning || isFailed ? "step" : undefined}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all duration-200 ${
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
                    <div
                      aria-hidden="true"
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 border border-current/15 text-xs tabular-nums"
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      ) : isFailed ? (
                        <XCircle className="w-4 h-4 text-red-400" />
                      ) : isRunning ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold m-0">{t(step.title)}</p>
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
                </li>
              );
            })}
          </ol>
          {!error && job?.status !== "done" && (
            <p className="m-0 text-xs leading-relaxed text-[var(--muted)]">
              {t("Keep Applio open. This may take a few minutes, depending on your connection and computer.")}
            </p>
          )}
        </Card>

        {/* Error Alert */}
        {error && (
          <Alert
            variant="error"
            title={t("Setup Encountered an Issue")}
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

        <Disclosure
          title={t("Technical Details & Logs")}
          icon={<Terminal size={15} />}
          open={logsOpen}
          onToggle={setLogsOpen}
          className="w-full"
        >
          {error && job?.errorDetails && (
            <div className="space-y-2">
              <p className="m-0 text-xs font-semibold">{t("Failure details")}</p>
              <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-500/5 p-3 text-xs text-red-300 select-text">
                {job.errorDetails}
              </pre>
            </div>
          )}
          <CardHeader
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
            ref={logsRef}
            id="setup-console-logs"
            role="log"
            aria-live={logsOpen ? "polite" : "off"}
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
          </div>
        </Disclosure>

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
