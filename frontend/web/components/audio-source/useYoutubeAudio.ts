"use client";

import { useEffect, useRef, useState } from "react";
import { apiSend, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";

const YOUTUBE_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i;

export function useYoutubeAudio({
  enabled,
  disabled,
  onSelected,
  onRefresh,
}: {
  enabled: boolean;
  disabled: boolean;
  onSelected: (path: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const { job, error: jobError } = useJob(enabled ? jobId : null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const latest = useRef({ onSelected, onRefresh, t });
  latest.current = { onSelected, onRefresh, t };
  const currentJob = job?.id === jobId ? job : null;
  const active =
    starting ||
    Boolean(
      jobId &&
        !jobError &&
        (!currentJob || currentJob.status === "running" || currentJob.status === "queued"),
    );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !jobId || job?.id !== jobId) return;
    if (job.status === "done") {
      void latest.current.onRefresh();
      const file = job.result?.file;
      if (typeof file === "string" && file) {
        latest.current.onSelected(file);
        setUrl("");
      } else setError(latest.current.t("Download finished without an audio file."));
      setJobId(null);
    } else if (job.status === "error") {
      setError(job.error || latest.current.t("YouTube download failed."));
      setJobId(null);
    }
  }, [enabled, jobId, job]);

  function reset() {
    // An accepted server job can finish in history, but a late HTTP response
    // must not replace a newer upload or microphone recording in this form.
    generation.current++;
    pending.current = false;
    setStarting(false);
    setJobId(null);
    setError("");
  }

  async function start() {
    if (!enabled || disabled || pending.current || active) return;
    const input = url.trim();
    if (!YOUTUBE_RE.test(input)) {
      setError(t("Paste a single YouTube video link (watch, shorts or youtu.be)."));
      return;
    }
    const epoch = ++generation.current;
    const current = () => mounted.current && generation.current === epoch;
    pending.current = true;
    setError("");
    setStarting(true);
    try {
      const response = await apiSend<{ jobId: string }>("/api/audio/youtube", "POST", {
        url: input,
        outputFormat: "wav",
      });
      if (current()) setJobId(response.jobId);
    } catch (error) {
      if (current()) setError(errMsg(error));
    } finally {
      if (current()) {
        pending.current = false;
        setStarting(false);
      }
    }
  }

  return { url, setUrl, active, error: error || (jobId ? jobError : ""), start, reset };
}
