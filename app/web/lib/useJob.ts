"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { errMsg, fetchJob, type Job, pollJob, stopJob } from "@/lib/api";

const JOB_ID_PREFIX = "applio:job:";

// Persists only the job id (not the job payload) in localStorage so a
// running or finished job survives route changes and page refreshes while
// the API server is up. On mount the id is re-validated against the server:
// ids the server no longer knows (e.g. after an API restart) are dropped
// silently, so nothing stale is ever resurrected.
export function usePersistentJobId(key: string) {
  const storageKey = `${JOB_ID_PREFIX}${key}`;
  const [jobId, setJobIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    fetchJob(jobId).catch(() => {
      if (cancelled) return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable */
      }
      setJobIdState(null);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, storageKey]);

  const setJobId = useCallback(
    (id: string | null) => {
      setJobIdState(id);
      try {
        if (id) window.localStorage.setItem(storageKey, id);
        else window.localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable (SSR/private mode) */
      }
    },
    [storageKey],
  );

  return [jobId, setJobId] as const;
}

// Shared job polling hook.
export function cleanJobLogs(logs?: string[]): string[] {
  if (!logs) return [];
  return logs
    .map((l) =>
      l
        .replace(/^\$ python.*$/i, "")
        .replace(/^\[(stdout|stderr)\]\s*/i, "")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    setError("");
    let stop = () => {};
    let source: EventSource | null = null;
    let cancelled = false;
    const startPolling = () => {
      if (!cancelled) stop = pollJob(jobId, setJob);
    };
    fetchJob(jobId)
      .then(({ job: j }) => {
        if (cancelled) return;
        setJob(j);
        if (j.status === "done" || j.status === "error") return;
        // Live stream preferred (instant progress/logs); polling fallback
        // covers proxies that buffer SSE or block EventSource.
        try {
          source = new EventSource(`/api/jobs/${jobId}/events`);
        } catch {
          startPolling();
          return;
        }
        const fallbackTimer = setTimeout(() => {
          // No event in time: SSE path is dead, fall back to polling.
          try {
            source?.close();
          } catch {
            /* ignore */
          }
          source = null;
          startPolling();
        }, 4000);
        source.onmessage = (e) => {
          clearTimeout(fallbackTimer);
          try {
            const data = JSON.parse(e.data) as { job: Job };
            if (!cancelled) setJob(data.job);
          } catch {
            /* malformed chunk — next event heals */
          }
        };
        source.onerror = () => {
          clearTimeout(fallbackTimer);
          try {
            source?.close();
          } catch {
            /* ignore */
          }
          source = null;
          startPolling();
        };
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
      stop();
      try {
        source?.close();
      } catch {
        /* ignore */
      }
    };
  }, [jobId]);

  const cleanedLogs = useMemo(() => cleanJobLogs(job?.logs), [job?.logs]);
  const isActive = job?.status === "running" || job?.status === "queued";

  const stop = useCallback(async () => {
    if (!job) return;
    try {
      await stopJob(job.id);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [job]);

  return { job, setJob, error, setError, cleanedLogs, isActive, stop };
}
