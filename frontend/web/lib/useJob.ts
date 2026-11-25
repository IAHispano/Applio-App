"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errMsg, isMissingJob, type Job, type JobView, stopJob, watchJob } from "@/lib/api";

const JOB_ID_PREFIX = "applio:job:";

// The watcher restores the saved id and validates it on the same connection.
export function usePersistentJob(key: string, view: JobView = "full") {
  const storageKey = `${JOB_ID_PREFIX}${key}`;
  const [jobId, setJobIdState] = useState<string | null>(null);
  const currentJobId = useRef<string | null>(null);

  // Static HTML and the initial client render both start without a saved job.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      currentJobId.current = saved;
      setJobIdState(saved);
    } catch {
      /* storage unavailable */
    }
  }, [storageKey]);

  const setJobId = useCallback(
    (id: string | null) => {
      currentJobId.current = id;
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

  const clearMissing = useCallback(
    (id: string) => {
      if (currentJobId.current !== id) return;
      currentJobId.current = null;
      setJobIdState(null);
      try {
        // Another tab can have stored a newer job while this request was in flight.
        if (window.localStorage.getItem(storageKey) === id) window.localStorage.removeItem(storageKey);
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey],
  );

  const activity = useJob(jobId, view, clearMissing);
  return { jobId, setJobId, activity };
}

// Shared job polling hook.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI ESC prefix is required to strip terminal codes
const ANSI_RE = /\[[0-9;?]*[a-zA-Z]/g;

// Matches tqdm-style live progress bars ("Downloading all files: 64%|██| ...").
// Keep in sync with progress_description in backend/rust-api/src/execution/jobs.rs.
export function isProgressBarLine(line: string): boolean {
  return /\d{1,3}(?:\.\d+)?%\s*\|/.test(line);
}

export function progressBarDesc(line: string): string {
  const idx = line.search(/\d{1,3}(?:\.\d+)?%\s*\|/);
  if (idx === -1) return "";
  return line
    .slice(0, idx)
    .replace(/^\[(stdout|stderr)\]\s*/i, "")
    .replace(/\s*\|\s*step=\d+(?:\s*\|\s*batch=\d+\/\d+)?\s*\|?\s*$/i, "")
    .trim()
    .toLowerCase();
}

// Collapse live progress redraws so a run of same-bar updates ("64%|…",
// "65%|…") stays 1 line showing only the latest. Distinct bars (new desc)
// still start a new line; non-progress lines always break the run.
export function collapseProgressLogs(logs: string[]): string[] {
  const out: string[] = [];
  for (const line of logs) {
    if (isProgressBarLine(line) && out.length > 0) {
      const prev = out[out.length - 1];
      if (isProgressBarLine(prev) && progressBarDesc(prev) === progressBarDesc(line)) {
        out[out.length - 1] = line;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

export function cleanJobLogs(logs?: string[]): string[] {
  if (!logs) return [];
  const cleaned: string[] = [];
  for (const entry of logs) {
    // Backend entries can glue many tqdm redraws into one chunk with \r
    // separators; split first so each update collapses exactly.
    for (const frag of entry.split(/\r+\n?|\n/)) {
      const l = frag
        .replace(ANSI_RE, "")
        .replace(/^\$ python.*$/i, "")
        .replace(/^\[(stdout|stderr)\]\s*/i, "")
        .trim();
      if (l.length > 0) cleaned.push(l);
    }
  }
  return collapseProgressLogs(cleaned);
}

const recentJobs = new Map<string, Job>();

export function useJob(jobId: string | null, view: JobView = "full", onMissing?: (id: string) => void) {
  const cacheKey = `${view}:${jobId}`;
  const [observed, setJob] = useState<Job | null>(() => (jobId ? (recentJobs.get(cacheKey) ?? null) : null));
  const [actionError, setActionError] = useState("");
  const [transportError, setTransportError] = useState("");
  const job = observed?.id === jobId ? observed : null;
  const setError = useCallback((message: string) => {
    setActionError(message);
    setTransportError("");
  }, []);

  useEffect(() => {
    setJob(jobId ? (recentJobs.get(cacheKey) ?? null) : null);
    setError("");
    if (!jobId) return;
    return watchJob(
      jobId,
      (job) => {
        recentJobs.delete(cacheKey);
        recentJobs.set(cacheKey, job);
        if (recentJobs.size > 100) {
          const oldest = recentJobs.keys().next().value;
          if (oldest !== undefined) recentJobs.delete(oldest);
        }
        setJob(job);
        setTransportError("");
      },
      (error) => {
        if (isMissingJob(error)) {
          recentJobs.delete(cacheKey);
          setJob(null);
          if (onMissing) {
            onMissing(jobId);
            return;
          }
        }
        setTransportError(errMsg(error));
      },
      view,
    );
  }, [jobId, cacheKey, view, onMissing, setError]);

  const isActive = job?.status === "running" || job?.status === "queued";

  const observedId = job?.id;
  const stop = useCallback(async () => {
    if (!observedId) return;
    try {
      await stopJob(observedId);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [observedId, setError]);

  return { job, error: actionError || transportError, setError, isActive, stop };
}
