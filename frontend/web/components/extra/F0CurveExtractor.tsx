"use client";

import { Download, FileText, LineChart, Loader2, RefreshCw, StopCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { JobError } from "@/components/JobStatus";
import { Button, IconButton, SegmentedControl, StatTile } from "@/components/ui";
import SettingHelp from "@/components/ui/SettingHelp";
import { ApiError, errMsg, fileBasename, outputUrl, postForm, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { useJob } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

interface F0CurveExtractorProps {
  file: File | null;
  fallbackPath?: string;
}

type MethodType = "rmvpe" | "fcpe" | "crepe" | "swift";
interface AcceptedExtraction {
  jobId: string;
  uploadedInputPath?: string;
}

export default function F0CurveExtractor({ file, fallbackPath }: F0CurveExtractorProps) {
  const { t } = useI18n();
  const [method, setMethod] = useWorkspaceState<MethodType>("F0CurveExtractor:extra:method", "rmvpe");
  const [jobId, setJobId] = useWorkspaceState<string | null>("F0CurveExtractor:extra:jobId", null);
  const [localError, setLocalError] = useWorkspaceState("F0CurveExtractor:extra:localError", "");
  const { job, error: jobError, setError: setJobError } = useJob(jobId);

  // Track the current active job ID and request sequence
  const activeJobIdRef = useRef<string | null>(jobId);
  const reqSeqRef = useRef(0);
  const uploadRef = useRef<{ file: File; accepted: Promise<AcceptedExtraction> } | null>(null);
  const [requestedKey, setRequestedKey] = useWorkspaceState("F0CurveExtractor:extra:requestedKey", "");
  const lastRequestedKeyRef = useRef(requestedKey);

  const hasAudio = Boolean(file || fallbackPath);

  const isRunning = job?.status === "running" || job?.status === "queued";
  const plotUrl = job?.status === "done" && job.outputFile ? job.outputFile : null;
  const curveFile =
    job?.status === "done" && typeof job.result?.curveFile === "string"
      ? (job.result.curveFile as string)
      : null;

  const runExtraction = useCallback(
    async (fileInput: File | null, pathInput: string | undefined, methodInput: MethodType) => {
      if (!fileInput && !pathInput) {
        setJobId(null);
        setLocalError("");
        return;
      }

      if (activeJobIdRef.current) {
        void stopJob(activeJobIdRef.current).catch(() => {});
        activeJobIdRef.current = null;
      }

      const seq = ++reqSeqRef.current;
      setLocalError("");
      setJobId(null);

      function submit(inputPath?: string) {
        const fd = new FormData();
        if (inputPath) fd.append("inputPath", inputPath);
        else if (fileInput) fd.append("audio", fileInput);
        fd.append("method", methodInput);
        return postForm<AcceptedExtraction>("/api/extra/f0", fd);
      }

      function upload() {
        const accepted = submit();
        if (fileInput) uploadRef.current = { file: fileInput, accepted };
        return accepted;
      }

      try {
        let result: AcceptedExtraction;
        if (!fileInput) {
          uploadRef.current = null;
          result = await submit(pathInput);
        } else {
          const previous = uploadRef.current;
          // Reuse the same upload even when a method changes before it finishes.
          const original = previous?.file === fileInput ? await previous.accepted.catch(() => null) : null;
          if (reqSeqRef.current !== seq) return;
          if (original?.uploadedInputPath) {
            try {
              result = await submit(original.uploadedInputPath);
            } catch (err) {
              if (reqSeqRef.current !== seq) return;
              if (
                !(err instanceof ApiError && err.status === 400 && err.message.startsWith("File not found: "))
              ) {
                throw err;
              }
              result = await upload();
            }
          } else {
            result = await upload();
          }
        }
        if (reqSeqRef.current !== seq) {
          void stopJob(result.jobId).catch(() => {});
          return;
        }
        activeJobIdRef.current = result.jobId;
        setJobId(result.jobId);
      } catch (err) {
        if (reqSeqRef.current === seq) {
          setLocalError(errMsg(err));
        }
      }
    },
    [setLocalError, setJobId],
  );

  // Automatically trigger extraction ONLY when audio source or method changes
  useEffect(() => {
    if (!file && !fallbackPath) {
      reqSeqRef.current++;
      uploadRef.current = null;
      if (activeJobIdRef.current) {
        void stopJob(activeJobIdRef.current).catch(() => {});
        activeJobIdRef.current = null;
      }
      setJobId(null);
      setLocalError("");
      lastRequestedKeyRef.current = "";
      setRequestedKey("");
      return;
    }

    const fileKey = file ? `${file.name}-${file.size}-${file.lastModified}` : fallbackPath || "";
    const currentKey = `${fileKey}::${method}`;

    if (currentKey === lastRequestedKeyRef.current) {
      return;
    }
    lastRequestedKeyRef.current = currentKey;
    setRequestedKey(currentKey);

    void runExtraction(file, fallbackPath, method);
  }, [file, fallbackPath, method, runExtraction, setLocalError, setJobId, setRequestedKey]);

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
              { value: "swift", label: "SWIFT" },
              { value: "crepe", label: "CREPE" },
            ]}
            onChange={(val) => setMethod(val as MethodType)}
            ariaLabel={t("Pitch extraction method")}
          />
          <SettingHelp text={t(SETTING_HELP.pitchMethod)} />
          {isRunning && (
            <span className="badge running text-[10px]" role="status">
              {t("Extracting…")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="danger"
              onClick={handleCancel}
              aria-label={t("Cancel extraction")}
              icon={<StopCircle size={13} />}
            >
              {t("Cancel")}
            </Button>
          )}

          {curveFile && (
            <Button href={outputUrl(curveFile)} download variant="ghost" icon={<FileText size={13} />}>
              {t("Download CSV")}
            </Button>
          )}

          {plotUrl && (
            <Button href={outputUrl(plotUrl)} download variant="ghost" icon={<Download size={13} />}>
              {t("Download Plot")}
            </Button>
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
          <div className="w-full max-w-md p-4 space-y-3">
            <JobError
              message={localError || jobError || job?.error || t("Failed to extract pitch curve.")}
              details={job?.errorDetails}
              logs={job?.logs}
              jobId={job?.id}
            />
            <div className="flex justify-center">
              <Button variant="ghost" onClick={handleManualRefresh}>
                {t("Retry Extraction")}
              </Button>
            </div>
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
