"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Download,
  Flame,
  Layers,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  StopCircle,
  Terminal,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { eventText, parseConsoleEvents } from "@/components/train/consoleEvents";
import { Alert, Badge, Button, Card, StatTile } from "@/components/ui";
import { errMsg, type Job, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cleanJobLogs, useJob } from "@/lib/useJob";

interface TrainingConsoleProps {
  jobId: string | null;
  modelName: string;
  totalEpochs?: number;
  onStop?: () => Promise<void> | void;
}

type LogLevel = "all" | "epochs" | "checkpoints" | "errors";

interface ParsedMetrics {
  currentEpoch: number | null;
  currentStep: number | null;
  loss: string | null;
  activePhase: 1 | 2 | 3 | 4 | 5; // 1: Preprocess, 2: Extract, 3: Train, 4: Index, 5: Done
}

export default function TrainingConsole({
  jobId,
  modelName,
  totalEpochs = 200,
  onStop,
}: TrainingConsoleProps) {
  const { t } = useI18n();
  const router = useRouter();

  const { job, error, setError } = useJob(jobId);
  const [filterText, setFilterText] = useState("");
  const [level, setLevel] = useState<LogLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) setElapsedSeconds(0);
  }, [jobId]);

  // Resume the elapsed counter from the job start time after remount/refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot resume per job
  useEffect(() => {
    if (!job || elapsedSeconds !== 0) return;
    const started = new Date(job.createdAt).getTime();
    if (Number.isNaN(started)) return;
    const s = Math.floor((Date.now() - started) / 1000);
    if (s > 0) setElapsedSeconds(s);
  }, [job?.id]);

  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [job?.status]);

  const cleanedLogs = useMemo(() => cleanJobLogs(job?.logs), [job?.logs]);

  const metrics: ParsedMetrics = useMemo(() => {
    let currentEpoch: number | null = null;
    let currentStep: number | null = null;
    let loss: string | null = null;
    let activePhase: 1 | 2 | 3 | 4 | 5 = 1;

    if (job?.status === "done") {
      activePhase = 5;
    }

    // Oldest -> newest so the latest line always wins and the phase only
    // moves forward. The previous newest-first scan let stale lines (e.g.
    // "audio" in old preprocess output) drag the stepper back to phase 1
    // mid-training.
    const raisePhase = (cur: 1 | 2 | 3 | 4 | 5, p: 1 | 2 | 3 | 4 | 5): 1 | 2 | 3 | 4 | 5 =>
      cur !== 5 && p > cur ? p : cur;

    for (const rawLine of cleanedLogs) {
      const line = rawLine.toLowerCase();

      // The API's own pipeline markers are authoritative when present.
      if (line.includes(">>> [4/4]")) {
        activePhase = raisePhase(activePhase, 4);
      } else if (line.includes(">>> [3/4]")) {
        activePhase = raisePhase(activePhase, 3);
      } else if (line.includes(">>> [2/4]")) {
        activePhase = raisePhase(activePhase, 2);
      } else if (line.includes(">>> [1/4]")) {
        activePhase = raisePhase(activePhase, 1);
      } else if (activePhase !== 5) {
        if (line.includes("index") || line.includes("faiss") || line.includes("trained_ivf")) {
          activePhase = raisePhase(activePhase, 4);
        } else if (
          line.includes("epoch=") ||
          line.includes("step=") ||
          line.includes("epoch:") ||
          /\bstarting training\b/.test(line)
        ) {
          // "Starting training..." (engine) but NOT "Starting 1-Click
          // Training Pipeline" (API header): word adjacency distinguishes them.
          activePhase = raisePhase(activePhase, 3);
        } else if (
          line.includes("extract") ||
          line.includes("f0") ||
          line.includes("rmvpe") ||
          line.includes("contentvec")
        ) {
          activePhase = raisePhase(activePhase, 2);
        } else if (line.includes("preprocess") || line.includes("sliced") || line.includes("audio")) {
          activePhase = raisePhase(activePhase, 1);
        }
      }

      // Newest match wins: plain overwrite in oldest-first order.
      const mEpoch = rawLine.match(/epoch=(\d+)/i) || rawLine.match(/epoch:\s*(\d+)/i);
      if (mEpoch) currentEpoch = Number.parseInt(mEpoch[1], 10);

      const mStep = rawLine.match(/step=(\d+)/i) || rawLine.match(/step:\s*(\d+)/i);
      if (mStep) {
        currentStep = Number.parseInt(mStep[1], 10);
      } else if (activePhase === 3) {
        // tqdm bars ("189/322 [..., 1.93it/s]") carry no step= token: attribute
        // the fraction to training steps only while already in phase 3, so
        // preprocess/extract bars can never pollute the counter.
        const mTqdm = rawLine.match(/(\d+)\/(\d+)\s*\[[^\]]*it\/s/);
        if (mTqdm) currentStep = Number.parseInt(mTqdm[1], 10);
      }

      const mLoss =
        rawLine.match(/lowest_value=([0-9.]+)/i) ||
        rawLine.match(/loss_gen_all=([0-9.]+)/i) ||
        rawLine.match(/loss:\s*([0-9.]+)/i);
      if (mLoss) loss = mLoss[1];
    }

    return { currentEpoch, currentStep, loss, activePhase };
  }, [cleanedLogs, job?.status]);

  const displayedEvents = useMemo(() => {
    const terminal = job?.status === "done" || job?.status === "error";
    const events = parseConsoleEvents(cleanedLogs, terminal);
    const q = filterText.trim().toLowerCase();
    return events.filter((ev) => {
      const text = eventText(ev);
      const lower = text.toLowerCase();
      if (level === "epochs" && !lower.includes("epoch=") && !lower.includes("epoch:")) {
        return false;
      }
      if (
        level === "checkpoints" &&
        !lower.includes("save") &&
        !lower.includes("checkpoint") &&
        !lower.includes(".pth")
      ) {
        return false;
      }
      if (
        level === "errors" &&
        ev.kind !== "error" &&
        !lower.includes("error") &&
        !lower.includes("fail") &&
        !lower.includes("exception")
      ) {
        return false;
      }
      // Text filter
      if (q && !lower.includes(q)) {
        return false;
      }
      return true;
    });
  }, [cleanedLogs, level, filterText, job?.status]);

  // Auto-scroll effect
  // biome-ignore lint/correctness/useExhaustiveDependencies: autoScroll toggle + new log updates
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [displayedEvents, autoScroll]);

  if (!jobId) return null;

  function copyAllLogs() {
    if (cleanedLogs.length === 0) return;
    navigator.clipboard.writeText(cleanedLogs.join("\n"));
    setCopied(true);
    toast(t("Console logs copied to clipboard"));
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleStop() {
    if (onStop) {
      await onStop();
      return;
    }
    if (job?.id) {
      try {
        await stopJob(job.id);
        toast(t("Training job stop requested"));
      } catch (e) {
        setError(errMsg(e));
      }
    }
  }

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const progressPercent =
    metrics.currentEpoch && totalEpochs
      ? Math.min(100, Math.round((metrics.currentEpoch / totalEpochs) * 100))
      : null;

  return (
    <Card
      as="section"
      className="space-y-5 animate-in fade-in duration-200"
      aria-label={t("Training Activity Console")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <Cpu size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-white m-0 truncate">
                {modelName ? `${t("Training:")} ${modelName}` : t("Training Project")}
              </h3>
              <Badge
                variant={
                  job?.status === "done"
                    ? "success"
                    : job?.status === "running"
                      ? "info"
                      : job?.status === "error"
                        ? "danger"
                        : "neutral"
                }
                dot
                size="sm"
              >
                {job?.status === "done"
                  ? t("Completed")
                  : job?.status === "running"
                    ? t("In Progress")
                    : job?.status === "error"
                      ? t("Failed")
                      : t("Queued")}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-400 mt-0.5">
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-neutral-400" />
                <span>{formatTime(elapsedSeconds)}</span>
              </span>
              <span>•</span>
              <span>{t("Integrated Engine Activity")}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(job?.status === "running" || job?.status === "queued") && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleStop}
              aria-label={t("Stop training job")}
              icon={<StopCircle size={14} />}
            >
              {t("Stop Training")}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t("Expand console") : t("Collapse console")}
            icon={collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          >
            <span className="hidden sm:inline">{collapsed ? t("Expand") : t("Collapse")}</span>
          </Button>
        </div>
      </div>

      {/* Runtime Error alert */}
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* 2. Pipeline Phase Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { step: 1, title: t("Preprocessing"), desc: t("Slice & Normalize") },
          { step: 2, title: t("Feature Extraction"), desc: t("Pitch & Embeddings") },
          { step: 3, title: t("Model Training"), desc: t("Epochs & Loss") },
          { step: 4, title: t("Index Building"), desc: t("FAISS Feature Index") },
        ].map((phase) => {
          const isDone = metrics.activePhase > phase.step || job?.status === "done";
          const isCurrent = metrics.activePhase === phase.step && job?.status === "running";

          return (
            <div
              key={phase.step}
              className={`p-3 rounded-xl border transition-colors ${
                isDone
                  ? "bg-white/[0.03] border-white/20 text-white"
                  : isCurrent
                    ? "bg-white/10 border-white text-white shadow-sm"
                    : "bg-black/20 border-white/5 text-neutral-400"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold tracking-wider uppercase">
                  {t("Phase")} {phase.step}
                </span>
                {isDone ? (
                  <CheckCircle2 size={13} className="text-white" />
                ) : isCurrent ? (
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                )}
              </div>
              <p className="text-xs font-semibold m-0 text-white truncate">{phase.title}</p>
              <p className="text-[10px] text-neutral-400 m-0 mt-0.5 truncate">{phase.desc}</p>
            </div>
          );
        })}
      </div>

      {/* 3. Live KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label={t("Epoch Progress")}
          value={
            <div className="flex items-baseline gap-1.5">
              <span>{metrics.currentEpoch !== null ? metrics.currentEpoch : "—"}</span>
              <span className="text-xs text-neutral-400 font-normal">/ {totalEpochs}</span>
            </div>
          }
        >
          {progressPercent !== null && (
            <div className="w-full bg-white/10 rounded-full h-1 mt-2 overflow-hidden">
              <div
                className="bg-white h-full rounded-full origin-left transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${progressPercent / 100})` }}
              />
            </div>
          )}
        </StatTile>

        <StatTile
          label={t("Training Steps")}
          value={metrics.currentStep !== null ? metrics.currentStep.toLocaleString() : "—"}
          subtext={t("Gradient updates")}
        />

        <StatTile
          label={t("Generator Loss")}
          value={metrics.loss !== null ? metrics.loss : "—"}
          subtext={t("Lowest rolling loss")}
        />

        <StatTile
          label={t("Active Status")}
          value={
            <span className="capitalize">
              {job?.status === "running" ? t("Training") : job?.status || t("Idle")}
            </span>
          }
          subtext={
            metrics.activePhase === 1
              ? t("Slicing audio")
              : metrics.activePhase === 2
                ? t("Extracting pitch")
                : metrics.activePhase === 3
                  ? t("Training network")
                  : metrics.activePhase === 4
                    ? t("Building index")
                    : t("Ready")
          }
        />
      </div>

      {/* 4. Celebratory Completion Banner */}
      {job?.status === "done" && (
        <div className="p-4 rounded-xl border border-white/20 bg-white/5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0">
              <Check size={16} className="text-black" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white m-0">{t("Training Completed Successfully")}</h4>
              <p className="text-xs text-neutral-400 m-0 mt-0.5">
                {t("Your voice model weights and feature index have been saved and are ready to use.")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              size="md"
              onClick={() =>
                router.push(`/inference?model=${encodeURIComponent(`logs/${modelName}/${modelName}.pth`)}`)
              }
              iconAfter={<ArrowRight size={14} />}
            >
              {t("Test in Inference")}
            </Button>
            <Link
              href="/models"
              className="ghost h-9 px-4 rounded-xl text-xs font-medium flex items-center gap-1.5 text-neutral-300 hover:text-white"
            >
              <Layers size={14} />
              <span>{t("View in Models Library")}</span>
            </Link>
          </div>
        </div>
      )}

      {/* 5. Embedded App Console Output */}
      {!collapsed && (
        <div className="space-y-2 pt-1">
          {/* Console Controls Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-neutral-400">
            <div className="flex items-center gap-1.5">
              <Terminal size={14} className="text-white" />
              <span className="font-semibold text-white">{t("Activity Log")}</span>
              <span className="text-[11px] text-neutral-400">({displayedEvents.length} events)</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Level Filter Pills */}
              <div className="flex items-center bg-black/40 p-0.5 rounded-lg border border-white/5 text-[11px]">
                {(["all", "epochs", "checkpoints", "errors"] as LogLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`px-2 py-0.5 rounded-md capitalize transition-colors ${
                      level === lvl
                        ? "bg-white/10 text-white font-medium"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                    onClick={() => setLevel(lvl)}
                  >
                    {lvl === "all"
                      ? t("All")
                      : lvl === "epochs"
                        ? t("Epochs")
                        : lvl === "checkpoints"
                          ? t("Saves")
                          : t("Errors")}
                  </button>
                ))}
              </div>

              <div className="relative flex items-center gap-1.5 border-b border-white/10 px-1">
                <Search size={12} className="text-neutral-500 shrink-0" aria-hidden="true" />
                <input
                  type="text"
                  placeholder={t("Filter logs…")}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="h-7 w-32 sm:w-44 text-xs bg-transparent border-0 rounded-none px-0 text-white placeholder:text-neutral-600 focus:outline-none"
                />
              </div>

              {/* Auto scroll toggle */}
              <button
                type="button"
                className={`ghost h-7 px-2 text-[11px] rounded-lg flex items-center gap-1 ${
                  autoScroll ? "text-white" : "text-neutral-400"
                }`}
                onClick={() => setAutoScroll(!autoScroll)}
                title={t("Toggle auto-scroll")}
              >
                <span>{t("Auto-scroll")}</span>
                <div className={`w-1.5 h-1.5 rounded-full ${autoScroll ? "bg-white" : "bg-neutral-600"}`} />
              </button>

              {/* Copy logs */}
              <Button
                variant="ghost"
                size="xs"
                onClick={copyAllLogs}
                aria-label={t("Copy logs")}
                icon={copied ? <Check size={12} className="text-white" /> : <Copy size={12} />}
              >
                {copied ? t("Copied") : t("Copy")}
              </Button>
            </div>
          </div>

          {/* Console Output Window */}
          <div
            ref={logContainerRef}
            className="h-64 sm:h-72 overflow-y-auto rounded-xl bg-black/60 border border-white/10 p-3 space-y-2 text-xs select-text"
            role="log"
            aria-live="polite"
          >
            {displayedEvents.length === 0 ? (
              <p className="text-neutral-400 text-xs italic m-0 p-2">
                {job?.status === "queued"
                  ? t("Queued for training execution…")
                  : t("Waiting for activity stream…")}
              </p>
            ) : (
              displayedEvents.map((ev) => {
                if (ev.kind === "phase") {
                  return (
                    <div key={ev.key} className="flex items-center gap-2.5 pt-1">
                      <span className="w-5 h-5 rounded-md bg-white text-black text-[10px] font-bold flex items-center justify-center shrink-0">
                        {ev.index}
                      </span>
                      <span className="text-xs font-semibold text-white truncate">{ev.title}</span>
                      <span className="text-[10px] text-neutral-500 tabular-nums shrink-0">
                        {ev.index}/{ev.total}
                      </span>
                      <span className="flex-1 h-px bg-white/10" aria-hidden="true" />
                    </div>
                  );
                }
                if (ev.kind === "progress") {
                  return (
                    <div key={ev.key} className="space-y-1 pl-[30px]">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-neutral-300 font-medium truncate">
                          {ev.phase || t("Working…")}
                        </span>
                        <span className="text-neutral-400 tabular-nums shrink-0">{ev.percent}%</span>
                      </div>
                      <div
                        className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={ev.percent}
                        aria-label={ev.phase || "Progress"}
                      >
                        <div
                          className="h-full bg-white rounded-full transition-all duration-300"
                          style={{ width: `${ev.percent}%` }}
                        />
                      </div>
                      {ev.detail && (
                        <p className="text-[10px] text-neutral-500 m-0 tabular-nums truncate">{ev.detail}</p>
                      )}
                    </div>
                  );
                }
                if (ev.kind === "task") {
                  const runningTask = ev.status === "running";
                  return (
                    <div key={ev.key} className="space-y-1 pl-[30px]">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 text-neutral-200 font-medium truncate min-w-0">
                          {runningTask ? (
                            <Loader2 size={12} className="animate-spin text-neutral-300 shrink-0" />
                          ) : (
                            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                          )}
                          <span className="truncate">{ev.title}</span>
                        </span>
                        <span className="text-neutral-400 tabular-nums shrink-0">
                          {ev.duration ?? (ev.percent !== null ? `${ev.percent}%` : "")}
                        </span>
                      </div>
                      {ev.meta && (
                        <p className="text-[10px] text-neutral-500 m-0 truncate">{ev.meta}</p>
                      )}
                      <div
                        className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={ev.percent ?? (runningTask ? undefined : 100)}
                        aria-label={ev.title}
                      >
                        {ev.percent !== null ? (
                          <div
                            className="h-full bg-white rounded-full transition-all duration-300"
                            style={{ width: `${ev.percent}%` }}
                          />
                        ) : (
                          <div className="h-full w-1/3 bg-white/70 rounded-full animate-pulse" />
                        )}
                      </div>
                      {ev.detail && (
                        <p className="text-[10px] text-neutral-500 m-0 tabular-nums truncate">{ev.detail}</p>
                      )}
                    </div>
                  );
                }
                if (ev.kind === "error") {
                  return (
                    <div
                      key={ev.key}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/25"
                    >
                      <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        {ev.lines.map((l) => (
                          <p
                            key={l.key}
                            className="text-[11px] text-red-300 m-0 leading-relaxed break-words"
                          >
                            {l.text}
                          </p>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={ev.key} className="flex items-start gap-2 py-0.5">
                    <span
                      className={`mt-[7px] w-1 h-1 rounded-full shrink-0 ${
                        ev.tone === "success" ? "bg-emerald-400" : "bg-neutral-600"
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`flex-1 leading-relaxed break-words ${
                        ev.tone === "success"
                          ? "text-neutral-100 font-medium"
                          : ev.tone === "muted"
                            ? "text-neutral-500"
                            : "text-neutral-300"
                      }`}
                    >
                      {ev.text}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </Card>
  );
}
