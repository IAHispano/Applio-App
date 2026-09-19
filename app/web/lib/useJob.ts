"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { errMsg, fetchJob, type Job, pollJob, stopJob } from "./api";

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
    fetchJob(jobId)
      .then(({ job: j }) => {
        setJob(j);
        if (j.status !== "done" && j.status !== "error") stop = pollJob(jobId, setJob);
      })
      .catch((e) => setError(errMsg(e)));
    return () => stop();
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
