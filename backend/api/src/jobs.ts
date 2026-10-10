import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfigDir } from "@/config";
import { JobHistory } from "@/job-history";

export type JobStatus = "queued" | "running" | "done" | "error";
export type JobType = "inference" | "batch-inference" | "train" | "tts" | "download" | "other";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  params?: Record<string, unknown>;
  logs: string[];
  result?: Record<string, unknown>;
  error?: string;
  errorDetails?: string;
  outputFile?: string; // repo-relative path served under /outputs
  progress?: number; // 0-100 determinate progress (unset = indeterminate)
}

const jobs = new Map<string, Job>();
const MAX_JOBS = 200;
const history = new JobHistory(path.join(getConfigDir(), "jobs.json"));
for (const job of history.load()) jobs.set(job.id, job);
let saveTimer: NodeJS.Timeout | undefined;
export function flushJobHistory(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  history.save([...jobs.values()]);
}
export async function drainJobHistory(): Promise<void> {
  flushJobHistory();
  await history.drain();
}
function scheduleSave(): void {
  if (!saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void history.saveAsync([...jobs.values()]);
    }, 500);
}
process.on("exit", flushJobHistory);

const cancellation = new Map<string, Set<() => void>>();
export function registerJobCancellation(id: string, callback: () => void): () => void {
  let callbacks = cancellation.get(id);
  if (!callbacks) {
    callbacks = new Set();
    cancellation.set(id, callbacks);
  }
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
    if (!callbacks.size) cancellation.delete(id);
  };
}
export function jobIsActive(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}
export function cancelJob(job: Job, reason = "Stopped by user"): void {
  if (!jobIsActive(job)) return;
  const callbacks = [...(cancellation.get(job.id) || [])];
  setError(job, reason);
  cancellation.delete(job.id);
  for (const callback of callbacks) {
    try {
      callback();
    } catch {}
  }
}

export function createJob(type: JobType, params?: Record<string, unknown>): Job {
  if (jobs.size >= MAX_JOBS && [...jobs.values()].every(jobIsActive))
    throw new Error("Too many active jobs. Finish or cancel a job before starting another.");
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    type,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    params,
    logs: [],
  };
  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()]
      .filter((j) => !jobIsActive(j))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) {
      jobs.delete(oldest.id);
      lastNotifyAt.delete(oldest.id);
    }
  }
  notifyAllJobs(job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendLog(job: Job, line: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI ESC prefix is required to strip terminal codes
  const clean = line.replace(/\[[0-9;?]*[a-zA-Z]/g, "").slice(0, 2000);
  // Live progress bars (tqdm redraws like "Downloading all files: 64%|...").
  // They arrive as many lines per second; keep only the latest per bar so the
  // log stays 1 line instead of 1 line per step. Same-desc check keeps
  // distinct bars (e.g. a new file/phase) as separate lines.
  if (isProgressBarLine(clean) && job.logs.length > 0) {
    const last = job.logs[job.logs.length - 1];
    if (isProgressBarLine(last) && progressBarDesc(last) === progressBarDesc(clean)) {
      job.logs[job.logs.length - 1] = clean;
      job.updatedAt = new Date().toISOString();
      notifyThrottled(job);
      scheduleSave();
      return;
    }
  }
  job.logs.push(clean);
  if (job.logs.length > 500) job.logs = job.logs.slice(-500);
  job.updatedAt = new Date().toISOString();
  notifyThrottled(job);
  scheduleSave();
}

// Matches tqdm-style bars ("Downloading all files: 64%|██| 836M/1.31G [...]").
// Keep in sync with the frontend collapse helper in web/lib/useJob.ts.
export function isProgressBarLine(line: string): boolean {
  return /(\d{1,3})%\s*\|/.test(line);
}

export function progressBarDesc(line: string): string {
  const idx = line.search(/\d{1,3}%\s*\|/);
  if (idx === -1) return "";
  return line
    .slice(0, idx)
    .replace(/^\[(stdout|stderr)\]\s*/i, "")
    .trim()
    .toLowerCase();
}

export function setRunning(job: Job) {
  if (!jobIsActive(job)) return;
  job.status = "running";
  job.startedAt ??= new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  notify(job);
  notifyAllJobs(job);
}

export function setProgress(job: Job, pct: number) {
  if (!jobIsActive(job) || !Number.isFinite(pct)) return;
  const progress = Math.max(0, Math.min(100, Math.round(pct)));
  if (job.progress === progress) return;
  job.progress = progress;
  job.updatedAt = new Date().toISOString();
  notify(job);
  notifyAllJobs(job);
}

export function setDone(job: Job, result?: Record<string, unknown>, outputFile?: string) {
  if (!jobIsActive(job)) return;
  job.status = "done";
  job.result = result;
  if (outputFile) job.outputFile = outputFile;
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  notify(job);
  notifyAllJobs(job);
}

export function setError(job: Job, error: string, errorDetails?: string) {
  if (!jobIsActive(job)) return;
  job.status = "error";
  job.error = error;
  if (errorDetails) {
    job.errorDetails = errorDetails;
  } else if (job.logs.length > 0) {
    job.errorDetails = job.logs.slice(-30).join("\n");
  }
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  notify(job);
  notifyAllJobs(job);
}

// App-wide activity excludes logs, output data and filesystem paths.
export function jobSummary(job: Job) {
  const p = job.params || {};
  const stepLabels: Record<string, string> = {
    preprocess: "Dataset preprocessing",
    extract: "Feature extraction",
    index: "Index generation",
  };
  const label =
    typeof p.step === "string" && stepLabels[p.step]
      ? stepLabels[p.step]
      : job.type !== "other"
        ? {
            inference: "Voice conversion",
            "batch-inference": "Batch conversion",
            train: "Training",
            tts: "Speech synthesis",
            download: "Download",
          }[job.type]
        : p.setup === "prerequisites"
          ? "Model prerequisites"
          : p.setup
            ? "Engine setup"
            : p.pthPath1
              ? "Model blending"
              : p.pthPath
                ? "Model inspection"
                : p.inputPath && p.method
                  ? "Pitch extraction"
                  : p.inputPath && p.model && p.outputFormat
                    ? "Audio separation"
                    : p.url
                      ? "Audio download"
                      : p.plugin
                        ? "Plugin installation"
                        : p.inputPath
                          ? "Audio analysis"
                          : "Task";
  return {
    id: job.id,
    type: job.type,
    label,
    status: job.status,
    createdAt: job.createdAt,
    progress: job.progress,
    stopped: job.status === "error" && /stopped by user|cancelled|canceled/i.test(job.error || ""),
  };
}

const allJobListeners = new Set<(job: ReturnType<typeof jobSummary>) => void>();

export function subscribeAllJobs(listener: (job: ReturnType<typeof jobSummary>) => void): () => void {
  allJobListeners.add(listener);
  return () => {
    allJobListeners.delete(listener);
  };
}

function notifyAllJobs(job: Job): void {
  if (!jobIsActive(job)) {
    cancellation.delete(job.id);
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void history.saveAsync([...jobs.values()]);
  } else scheduleSave();
  if (!allJobListeners.size) return;
  const summary = jobSummary(job);
  for (const listener of allJobListeners) {
    try {
      listener(summary);
    } catch {
      /* observers must never interrupt work */
    }
  }
}

// Live subscribers (server-sent events). Logs stream per chunk, so those
// notifications are throttled; status/progress/done push immediately.
type JobListener = (job: Job) => void;

const listeners = new Map<string, Set<JobListener>>();
const lastNotifyAt = new Map<string, number>();
const NOTIFY_THROTTLE_MS = 250;

export function subscribeJob(id: string, cb: JobListener): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(id);
    if (s) {
      s.delete(cb);
      if (s.size === 0) {
        listeners.delete(id);
        lastNotifyAt.delete(id);
      }
    }
  };
}

function notify(job: Job) {
  const set = listeners.get(job.id);
  if (!set || set.size === 0) return;
  lastNotifyAt.set(job.id, Date.now());
  for (const cb of set) {
    try {
      cb(job);
    } catch {
      /* a slow client must never break the job */
    }
  }
}

function notifyThrottled(job: Job) {
  const set = listeners.get(job.id);
  if (!set || set.size === 0) return;
  const now = Date.now();
  if (now - (lastNotifyAt.get(job.id) ?? 0) < NOTIFY_THROTTLE_MS) return;
  notify(job);
}
