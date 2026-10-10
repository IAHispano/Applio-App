import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "done" | "error";
export type JobType = "inference" | "batch-inference" | "train" | "tts" | "download" | "other";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
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

export function createJob(type: JobType, params?: Record<string, unknown>): Job {
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
  notifyAllJobs(job);
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendLog(job: Job, line: string) {
  job.logs.push(line.slice(0, 2000));
  if (job.logs.length > 500) job.logs = job.logs.slice(-500);
  job.updatedAt = new Date().toISOString();
  notifyThrottled(job);
}

export function setRunning(job: Job) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  notify(job);
  notifyAllJobs(job);
}

export function setProgress(job: Job, pct: number) {
  job.progress = Math.max(0, Math.min(100, Math.round(pct)));
  job.updatedAt = new Date().toISOString();
  notify(job);
  notifyAllJobs(job);
}

export function setDone(job: Job, result?: Record<string, unknown>, outputFile?: string) {
  job.status = "done";
  job.result = result;
  if (outputFile) job.outputFile = outputFile;
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  notify(job);
  notifyAllJobs(job);
}

export function setError(job: Job, error: string, errorDetails?: string) {
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
