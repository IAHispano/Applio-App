import {
  appendLog,
  type Job,
  jobIsActive,
  registerJobCancellation,
  setError,
  subscribeAllJobs,
} from "@/jobs";

export type JobResource = "gpu" | "network" | "model-download";
let prepareGpu: ((job: Job) => Promise<void>) | undefined;
export function setGpuPreparation(prepare: (job: Job) => Promise<void>): void {
  prepareGpu = prepare;
}
const active = new Map<string, JobResource>();
const waiting: Array<{
  job: Job;
  resource: JobResource;
  resolve: (admitted: boolean) => void;
  unregister: () => void;
}> = [];
let realtimeSessions = 0;

export function schedulerStatus() {
  return {
    realtime: realtimeSessions > 0,
    active: [...active.keys()],
    queued: waiting.map(({ job }) => job.id),
  };
}

function drain(): void {
  for (let index = 0; index < waiting.length; ) {
    const entry = waiting[index];
    const used = [...active.values()].filter((r) => r === entry.resource).length;
    if (used >= (entry.resource === "network" ? 2 : 1) || (entry.resource === "gpu" && realtimeSessions)) {
      index++;
      continue;
    }
    waiting.splice(index, 1);
    entry.unregister();
    if (!jobIsActive(entry.job)) {
      entry.resolve(false);
      continue;
    }
    active.set(entry.job.id, entry.resource);
    const preparation = entry.resource === "gpu" ? prepareGpu?.(entry.job) : undefined;
    Promise.resolve(preparation)
      .then(() => {
        if (!jobIsActive(entry.job)) {
          releaseJobSlot(entry.job.id);
          entry.resolve(false);
        } else entry.resolve(true);
      })
      .catch((error) => {
        setError(entry.job, String(error));
        releaseJobSlot(entry.job.id);
        entry.resolve(false);
      });
  }
}

export function acquireJobSlot(job: Job, resource: JobResource = "gpu"): Promise<boolean> {
  if (!jobIsActive(job)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const entry = { job, resource, resolve, unregister: () => {} };
    entry.unregister = registerJobCancellation(job.id, () => {
      const index = waiting.indexOf(entry);
      if (index !== -1) waiting.splice(index, 1);
      resolve(false);
    });
    waiting.push(entry);
    drain();
    if (waiting.includes(entry))
      appendLog(
        job,
        resource === "gpu" ? "Waiting for the GPU to become available." : "Waiting for a download slot.",
      );
  });
}

subscribeAllJobs((job) => {
  if (job.status === "done" || job.status === "error") {
    // Defer admission until cancellation has stopped the old process.
    queueMicrotask(() => {
      const index = waiting.findIndex((entry) => entry.job.id === job.id);
      if (index !== -1) {
        const [entry] = waiting.splice(index, 1);
        entry.unregister();
        entry.resolve(false);
      }
      drain();
    });
  }
});

export function releaseJobSlot(id: string): void {
  active.delete(id);
  drain();
}

export function gpuJobRunning(): boolean {
  return [...active.values()].includes("gpu");
}
// Realtime takes priority over waiting jobs; an active training job is never killed.
export function beginRealtimeSession(): (() => void) | null {
  if (gpuJobRunning() || realtimeSessions) return null;
  realtimeSessions++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      realtimeSessions--;
      drain();
    }
  };
}
