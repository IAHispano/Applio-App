"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { errMsg, fetchJob, type Job, stopJob, watchJob } from "@/lib/api";

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
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI ESC prefix is required to strip terminal codes
const ANSI_RE = /\[[0-9;?]*[a-zA-Z]/g;

// Matches tqdm-style live progress bars ("Downloading all files: 64%|██| ...").
// Keep in sync with the backend collapse helper in api/src/jobs.ts.
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

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setJob(null);
    setError("");
    if (!jobId) return;
    return watchJob(jobId, setJob, (error) => setError(errMsg(error)));
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
