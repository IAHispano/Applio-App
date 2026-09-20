"use client";

import { AlertCircle, Download, FileText, LineChart, Loader2, RefreshCw, StopCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errMsg, fileBasename, outputUrl, postForm, stopJob } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useJob } from "../../lib/useJob";
import { IconButton, SegmentedControl, StatTile } from "../ui";

interface F0CurveExtractorProps {
  file: File | null;
  fallbackPath?: string;
}

type MethodType = "rmvpe" | "fcpe" | "crepe";

export default function F0CurveExtractor({ file, fallbackPath }: F0CurveExtractorProps) {
  const { t } = useI18n();
  const [method, setMethod] = useState<MethodType>("rmvpe");
  const [jobId, setJobId] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const { job, error: jobError, setError: setJobError } = useJob(jobId);

  // Track the current active job ID and request sequence
  const activeJobIdRef = useRef<string | null>(null);
  const reqSeqRef = useRef(0);
  const lastRequestedKeyRef = useRef<string>("");

  const hasAudio = Boolean(file || fallbackPath);

  const isRunning = job?.status === "running" || job?.status === "queued";
  const plotUrl = job?.status === "done" && job.outputFile ? job.outputFile : null;
  const curveFile =
    job?.status === "done" && typeof job.result?.curveFile === "string"
      ? (job.result.curveFile as string)
      : null;

  // Stable execution function with zero reactive dependencies to prevent loops
  const runExtraction = useCallback(
    async (fileInput: File | null, pathInput: string | undefined, methodInput: MethodType) => {
      if (!fileInput && !pathInput) {
        setJobId(null);
        setLocalError("");
        return;
      }

      // Stop previous active job if one was running
      if (activeJobIdRef.current) {
        stopJob(activeJobIdRef.current).catch(() => {});
      }

      const seq = ++reqSeqRef.current;
      setLocalError("");
      setJobId(null);

      try {
        const fd = new FormData();
        if (fileInput) {
          fd.append("audio", fileInput);
        } else if (pathInput) {
          fd.append("inputPath", pathInput);
        }
        fd.append("method", methodInput);

        const res = await postForm<{ jobId: string }>("/api/extra/f0", fd);
        if (reqSeqRef.current === seq) {
          activeJobIdRef.current = res.jobId;
          setJobId(res.jobId);
        }
      } catch (err) {
        if (reqSeqRef.current === seq) {
          setLocalError(errMsg(err));
        }
      }
    },
    [],
  );

  // Automatically trigger extraction ONLY when audio source or method changes
  useEffect(() => {
    if (!file && !fallbackPath) {
      setJobId(null);
      setLocalError("");
      lastRequestedKeyRef.current = "";
      return;
    }

    const fileKey = file ? `${file.name}-${file.size}-${file.lastModified}` : fallbackPath || "";
    const currentKey = `${fileKey}::${method}`;

    if (currentKey === lastRequestedKeyRef.current) {
      return;
    }
    lastRequestedKeyRef.current = currentKey;

    void runExtraction(file, fallbackPath, method);
  }, [file, fallbackPath, method, runExtraction]);

  const handleManualRefresh = useCallback(() => {
    lastRequestedKeyRef.current = "";
    void runExtraction(file, fallbackPath, method);
  }, [file, fallbackPath, method, runExtraction]);

  const handleCancel = useCallback(() => {
    if (jobId) {
      stopJob(jobId).catch((e) => setJobError(errMsg(e)));
    }
  }, [jobId, setJobError]);

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      {/* Top Controls & Action Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs text-neutral-400 font-medium">{t("Method:")}</span>
          <SegmentedControl
            value={method}
            options={[
              { value: "rmvpe", label: "RMVPE" },
              { value: "fcpe", label: "FCPE" },
              { value: "crepe", label: "CREPE" },
            ]}
            onChange={(val) => setMethod(val as MethodType)}
            ariaLabel={t("Pitch extraction method")}
          />
          {isRunning && (
            <span className="badge running text-[10px]" role="status">
              {t("Extracting…")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              type="button"
              onClick={handleCancel}
              className="ghost h-7 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-red-400 hover:text-red-300 border-red-500/30"
              aria-label={t("Cancel extraction")}
            >
              <StopCircle size={13} />
              <span>{t("Cancel")}</span>
            </button>
          )}

          {curveFile && (
            <a
              href={outputUrl(curveFile)}
              download
              className="ghost h-7 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-neutral-300 hover:text-white"
            >
              <FileText size={13} />
              <span>{t("Download CSV")}</span>
            </a>
          )}

          {plotUrl && (
            <a
              href={outputUrl(plotUrl)}
              download
              className="ghost h-7 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-neutral-300 hover:text-white"
            >
              <Download size={13} />
              <span>{t("Download Plot")}</span>
            </a>
          )}

          <IconButton
            onClick={handleManualRefresh}
            disabled={!hasAudio}
            loading={isRunning}
            label={t("Re-extract pitch curve")}
            icon={<RefreshCw size={14} strokeWidth={2.2} className="shrink-0" />}
          />
        </div>
      </div>

      {/* Main Visualizer Canvas / Viewport */}
      <div className="relative w-full rounded-xl bg-black/50 border border-white/10 overflow-hidden select-none flex flex-col justify-center items-center min-h-[300px] p-2">
        {/* Loading State */}
        {isRunning && (
          <div className="flex flex-col items-center justify-center gap-3 text-neutral-400 text-xs py-16 text-center">
            <Loader2 size={26} className="animate-spin text-white" />
            <div className="space-y-1">
              <p className="text-white text-sm font-semibold m-0">{t("Extracting pitch contour…")}</p>
              <p className="text-neutral-500 text-xs m-0">
                {t("Calculating frame-by-frame fundamental frequencies with")} {method.toUpperCase()}…
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {!isRunning && (localError || jobError || (job?.status === "error" && job.error)) && (
          <div
            role="alert"
            className="flex flex-col items-center justify-center text-red-400 text-xs p-6 text-center max-w-md"
          >
            <AlertCircle size={26} className="mb-2 text-red-400 shrink-0" />
            <span className="leading-relaxed">
              {localError || jobError || job?.error || t("Failed to extract pitch curve.")}
            </span>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="ghost mt-3 text-xs py-1.5 px-4 rounded-lg border border-white/10 text-white hover:bg-white/10"
            >
              {t("Retry Extraction")}
            </button>
          </div>
        )}

        {/* Success / Plot Display */}
        {!isRunning && !localError && !jobError && job?.status !== "error" && plotUrl && (
          <div className="w-full flex flex-col items-center justify-center animate-in fade-in duration-200">
            <div className="w-full rounded-lg overflow-hidden flex items-center justify-center bg-black/40">
              {/* biome-ignore lint/performance/noImgElement: user-generated pitch plot */}
              <img
                src={outputUrl(plotUrl)}
                alt={t("Fundamental Pitch Contour (F0)")}
                className="w-full h-auto max-h-[460px] 2xl:max-h-[600px] object-contain rounded-lg shadow-md"
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isRunning && !localError && !jobError && !plotUrl && (
          <div className="flex flex-col items-center justify-center gap-2.5 text-neutral-500 text-xs py-16 text-center">
            <LineChart size={32} className="text-neutral-600" />
            <p className="m-0 text-neutral-400 text-xs font-medium">
              {hasAudio
                ? t("Ready to extract pitch curve")
                : t("Select or upload an audio file to extract pitch contour")}
            </p>
          </div>
        )}
      </div>

      {/* Stats Grid matching NativeAnalyzer */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <StatTile label={t("Method")} value={method.toUpperCase()} />
        <StatTile
          label={t("Status")}
          value={isRunning ? t("Extracting…") : plotUrl ? t("Ready") : t("Idle")}
        />
        <StatTile
          label={t("CSV Curve")}
          value={curveFile ? t("Available") : "–"}
          title={curveFile ? fileBasename(curveFile) : "–"}
        />
      </div>
    </div>
  );
}
