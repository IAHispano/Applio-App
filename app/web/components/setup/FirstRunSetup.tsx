"use client";

import { ArrowRight, Check, CheckCircle2, Copy, RefreshCw, Sparkles, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { apiGet, apiSend, errMsg, type Job, pollJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { SetupStatus } from "@/lib/setup";
import { toast } from "@/lib/toast";

interface FirstRunSetupProps {
  onComplete: () => void;
}

function setupBridge() {
  return (window as unknown as { applio?: { restartAfterSetup?: (jobId: string) => Promise<void> } }).applio;
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

  // Cleaned and filtered logs list
  const processedLogs = useMemo(() => {
    if (!job?.logs?.length) return [];
    return job.logs
      .map((log) => log.replace(/^\[(stdout|stderr)\]\s*/i, "").trim())
      .filter((log) => log.length > 0);
  }, [job?.logs]);

  // Auto-scroll logs as new output arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when logs length changes
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processedLogs.length]);

  // Copy logs handler
  const handleCopyLogs = useCallback(() => {
    if (!processedLogs.length) return;
    const text = processedLogs.join("\n");
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
  }, [processedLogs, t]);

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
    latched.current = {};
    try {
      const { jobId: id } = await apiSend<{ jobId: string }>("/api/setup/install", "POST");
      setJobId(id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  // Derive step progress and active phase from logs.
  // Logs are capped server-side (last 500 lines), so markers from early
  // phases scroll out during long downloads and raw substring matches would
  // flap backwards. Latch every step's best state: done/running never regress.
  const logsText = useMemo(() => job?.logs.join("\n") || "", [job?.logs]);
  const latched = useRef<Record<string, "running" | "done">>({});

  const steps = useMemo(() => {
    const isDone = job?.status === "done";
    const hasPy = logsText.includes("App virtualenv") || logsText.includes("Creating app virtualenv");
    const hasTorch = logsText.includes("Installing engine packages") || logsText.includes("torch");
    const hasDeps = logsText.includes("Using Python env") || logsText.includes("web dependencies");
    const hasAmd = logsText.includes("ROCm") || logsText.includes("ZLUDA") || logsText.includes("AMD GPU");
    const hasAmdDone =
      logsText.includes("ROCm native") ||
      logsText.includes("acceleration is ready") ||
      logsText.includes("GPU device active");
    const hasModels =
      logsText.includes("Downloading base voice models") || logsText.includes("prerequisites");
    const hasVerified = isDone || logsText.includes("Setup complete") || logsText.includes("checks passed");

    const rawSteps = [
      {
        id: "env",
        title: "AI Runtime Environment",
        desc: "Isolated core processing runtime",
        status: hasPy ? (hasTorch ? "done" : "running") : "running",
      },
      {
        id: "torch",
        title: hasAmd ? "Hardware Acceleration (ROCm / AMD)" : "Hardware Acceleration",
        desc: hasAmd
          ? "Native AMD ROCm hardware acceleration backend"
          : "CUDA, MPS, or high-performance compute backend",
        status: hasTorch
          ? hasAmd
            ? hasAmdDone || hasDeps
              ? "done"
              : "running"
            : hasDeps
              ? "done"
              : "running"
          : "pending",
      },
      {
        id: "engine",
        title: "Audio Processing Engine",
        desc: "Faiss indexer, FCPE, Crepe, and acoustic models",
        status: hasDeps ? (hasModels ? "done" : "running") : "pending",
      },
      {
        id: "models",
        title: "Base Acoustic Checkpoints",
        desc: "HuBERT feature extractor & RMVPE pitch models",
        status: hasModels ? (hasVerified ? "done" : "running") : "pending",
      },
      {
        id: "ready",
        title: "Finalizing Applio",
        desc: "Configuring workspaces and pipelines",
        status: isDone ? "done" : hasVerified ? "running" : "pending",
      },
    ];

    return rawSteps.map((s) => {
      const prev = latched.current[s.id];
      const status =
        s.status === "done" || prev === "done"
          ? "done"
          : s.status === "running" || prev === "running"
            ? "running"
            : "pending";
      if (status !== "pending") latched.current[s.id] = status;
      return { ...s, status };
    });
  }, [job?.status, logsText]);

  // Estimated progress percentage
  const progressPercent = useMemo(() => {
    if (job?.status === "done") return 100;
    const completedCount = steps.filter((s) => s.status === "done").length;
    const hasRunning = steps.some((s) => s.status === "running");
    const base = completedCount * 20;
    return Math.min(95, Math.max(8, base + (hasRunning ? 10 : 0)));
  }, [job?.status, steps]);

  return (
    <div className="w-full min-h-full flex flex-col items-center justify-center p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="w-full space-y-6">
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
                  : `${t("Automated Setup in Progress")} (${progressPercent}%)`}
              </span>
            </span>
            <span className="text-neutral-400">
              {t("%s / %s Steps")
                .replace("%s", String(steps.filter((s) => s.status === "done").length))
                .replace("%s", String(steps.length))}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${progressPercent}% - ${steps.filter((s) => s.status === "done").length} of ${steps.length} steps completed`}
            className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative"
          >
            <div
              className="h-full bg-white transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Checklist */}
          <div className="space-y-2 pt-2">
            {steps.map((step) => {
              const isDone = step.status === "done";
              const isRunning = step.status === "running";

              return (
                <div
                  key={step.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${
                    isDone
                      ? "bg-emerald-500/[0.05] border-emerald-500/20 text-neutral-200"
                      : isRunning
                        ? "bg-white/[0.06] border-white/20 text-white shadow-sm"
                        : "bg-white/[0.02] border-white/5 text-neutral-500"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-white" />
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
                    variant={isDone ? "success" : isRunning ? "info" : "neutral"}
                    dot={isRunning}
                    size="sm"
                  >
                    {isDone ? t("Ready") : isRunning ? t("Installing…") : t("Queued")}
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
              (job?.logs && job.logs.length > 0 ? job.logs.slice(-50).join("\n") : undefined)
            }
            copyText={[
              "Applio Setup Error:",
              error,
              job?.id ? `Job ID: ${job.id}` : null,
              job?.errorDetails
                ? `\nError Details:\n${job.errorDetails}`
                : job?.logs && job.logs.length > 0
                  ? `\nRecent Console Logs:\n${job.logs.slice(-60).join("\n")}`
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
                {processedLogs.length > 0 && (
                  <span className="text-[11px] text-neutral-400 tabular-nums">
                    {processedLogs.length} {processedLogs.length === 1 ? t("line") : t("lines")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleCopyLogs}
                  disabled={!processedLogs.length}
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
            {processedLogs.length ? (
              processedLogs.map((entry, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only activity logs
                <div key={`log-${idx}`} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-600 text-[10px] select-none shrink-0 w-6 text-right tabular-nums pt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">{renderLogLine(entry)}</div>
                </div>
              ))
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

function renderLogLine(text: string) {
  // Separator lines
  if (/^={5,}|^-{5,}/.test(text)) {
    return <div className="my-1.5 border-t border-white/10" />;
  }

  // Shell command line ($ cmd ...)
  if (text.startsWith("$ ")) {
    return (
      <div className="flex items-start gap-1.5 text-neutral-200 font-medium py-0.5">
        <span className="text-neutral-500 font-bold select-none shrink-0">$</span>
        <span className="text-neutral-100 break-all">{text.slice(2)}</span>
      </div>
    );
  }

  // Success lines
  if (
    text.startsWith("✓") ||
    text.startsWith("✔") ||
    text.includes("acceleration is ready") ||
    text.includes("all systems go") ||
    text.includes("passed ✓") ||
    text.includes("ready ✓") ||
    text.includes("installed ✓") ||
    text.startsWith("Successfully installed")
  ) {
    return (
      <div className="flex items-start gap-1.5 text-emerald-400 py-0.5 font-medium">
        <span className="text-emerald-400 font-bold select-none shrink-0">✓</span>
        <span className="text-neutral-200 break-all">{text.replace(/^[✓✔]\s*/, "")}</span>
      </div>
    );
  }

  // Error lines
  if (
    text.startsWith("✗") ||
    text.startsWith("Error:") ||
    text.startsWith("[ERR]") ||
    text.toLowerCase().includes("traceback (most recent call last)")
  ) {
    return (
      <div className="flex items-start gap-1.5 text-red-400 py-0.5 font-medium">
        <span className="text-red-400 font-bold select-none shrink-0">✗</span>
        <span className="text-red-300 break-all">{text.replace(/^(✗|\[ERR\])\s*/, "")}</span>
      </div>
    );
  }

  // Warning lines
  if (
    text.startsWith("!") ||
    text.startsWith("[!]") ||
    text.startsWith("Warning:") ||
    text.startsWith("WARNING:")
  ) {
    return (
      <div className="flex items-start gap-1.5 text-amber-400 py-0.5">
        <span className="text-amber-400 font-bold select-none shrink-0">!</span>
        <span className="text-amber-200/90 break-all">{text.replace(/^(\[!\]|!)\s*/, "")}</span>
      </div>
    );
  }

  // Progress/Downloading/Installing action lines
  if (
    text.startsWith("Installing") ||
    text.startsWith("Downloading") ||
    text.startsWith("Configuring") ||
    text.startsWith("Building") ||
    text.startsWith("Verifying") ||
    text.startsWith("Target architecture:")
  ) {
    return (
      <div className="flex items-start gap-1.5 text-white font-medium py-0.5">
        <span className="text-neutral-500 select-none shrink-0">›</span>
        <span className="text-neutral-100 break-all">{text}</span>
      </div>
    );
  }

  // Standard output lines
  return (
    <div className="flex items-start gap-1.5 text-neutral-400 py-0.5">
      <span className="text-neutral-600 select-none shrink-0">•</span>
      <span className="text-neutral-300 break-all">{text}</span>
    </div>
  );
}
