"use client";

import { AudioWaveform, Wand2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ConversionParameters from "@/components/ConversionParameters";
import { JobError, JobProgress, JobStage } from "@/components/JobStatus";
import type { ModelMetadata } from "@/components/models/ModelInfoCard";
import { Alert, Badge, Button, Card, CardHeader, EMBEDDER_MODELS } from "@/components/ui";
import AudioDropzone from "@/components/ui/AudioDropzone";
import VoiceModelCard from "@/components/VoiceModelCard";
import {
  apiSend,
  errMsg,
  fetchJob,
  fetchModels,
  fileBasename,
  type Job,
  outputUrl,
  pollJob,
  stopJob,
  submitInference,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { getModelPreset } from "@/lib/model-presets";
import { useConversionParameters } from "@/lib/useConversionParameters";
import { usePersistentJobId } from "@/lib/useJob";
import { usePreviewUrl } from "@/lib/usePreviewUrl";
import { useSpeakers } from "@/lib/useSpeakers";

export default function InferenceForm() {
  const { t } = useI18n();

  const [models, setModels] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<string[]>([]);
  const [sampleAudios, setSampleAudios] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");

  const [pthPath, setPthPath] = useState("");
  const [indexPath, setIndexPath] = useState("");
  const [sid, setSid] = useState(0);

  // Audio input states
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [inputPath, setInputPath] = useState("");

  // Core conversion settings
  const conversion = useConversionParameters(pthPath);
  const {
    pitch,
    indexRate,
    volumeEnvelope,
    protect,
    f0Method,
    inferenceEngine,
    onnxPrecision,
    embedderModel,
    embedderModelCustom,
    exportFormat,
    splitAudio,
    f0Autotune,
    f0AutotuneStrength,
    proposedPitch,
    proposedPitchThreshold,
    formantShifting,
    formantQfrency,
    formantTimbre,
  } = conversion.values;
  const { embedderModel: setEmbedderModel } = conversion.setters;

  // Job submission & status
  const [job, setJob] = useState<Job | null>(null);
  const [persistedJobId, setPersistedJobId] = usePersistentJobId("inference");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const speakers = useSpeakers(pthPath);
  const handleModelMetadata = useCallback(
    (metadata: ModelMetadata) => {
      const emb = metadata.embedder_model?.toLowerCase();
      if (emb && EMBEDDER_MODELS.includes(emb) && !getModelPreset("conversion", pthPath)?.embedderModel)
        setEmbedderModel(emb);
    },
    [pthPath, setEmbedderModel],
  );

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  // Load models, indexes and sample audios
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model load uses latest state
  const loadAvailableModels = useCallback(
    (force = true) => {
      fetchModels(force)
        .then((m) => {
          setModels(m.models);
          setIndexes(m.indexes);
          setSampleAudios(m.audios);
          if (m.models.length > 0 && !pthPath) {
            handleModelSelect(m.models[0], m.indexes);
          }
          setLoadError("");
        })
        .catch((e) => setLoadError(errMsg(e)));
    },
    [pthPath],
  );

  // Initial model fetch & refresh on window focus
  useEffect(() => {
    loadAvailableModels(true);
    const onFocus = () => loadAvailableModels(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadAvailableModels]);

  // Pre-select model from URL params if available (e.g. from Models library)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const m = params.get("model");
      if (m) {
        setPthPath(m);
        const idx = params.get("index");
        if (idx) setIndexPath(idx);
      }
    }
  }, []);

  // Poll running jobs
  // biome-ignore lint/correctness/useExhaustiveDependencies: poll active job until completion
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const stop = pollJob(job.id, setJob);
    return stop;
  }, [job?.id]);

  // Restore the last job (running or finished) after navigation/refresh.
  useEffect(() => {
    if (job || !persistedJobId) return;
    let cancelled = false;
    fetchJob(persistedJobId)
      .then(({ job: j }) => {
        if (!cancelled) setJob(j);
      })
      .catch(() => {
        if (!cancelled) setPersistedJobId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [job, persistedJobId, setPersistedJobId]);

  const handleModelSelect = (selected: string, idxList = indexes) => {
    setPthPath(selected);
    const matched = matchIndex(selected, idxList);
    setIndexPath(matched);
    setSid(0);
    if (selected) {
      void apiSend("/api/models/preload", "POST", { pthPath: selected }).catch(() => {});
    }
  };

  const handleUnloadModel = () => {
    setPthPath("");
    setIndexPath("");
    setSid(0);
  };

  // Temporary original audio URL for A/B comparison waveplayer (safe auto-revoke)
  const originalAudioUrl = usePreviewUrl(audioFile, inputPath);

  const directAudioUrl = job?.outputFile ? outputUrl(job.outputFile) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conversion.loaded) {
      setSubmitError(t("Loading model settings…"));
      return;
    }
    setSubmitError("");
    if (!pthPath) {
      setSubmitError(t("Please select a voice model."));
      return;
    }
    if (!audioFile && !inputPath) {
      setSubmitError(t("Please provide an audio file or sample."));
      return;
    }

    const fd = new FormData();
    if (audioFile) fd.append("audio", audioFile);
    if (inputPath) fd.append("inputPath", inputPath);
    fd.append("pthPath", pthPath);
    fd.append("indexPath", indexPath);
    fd.append("pitch", String(pitch));
    fd.append("indexRate", String(indexRate));
    fd.append("volumeEnvelope", String(volumeEnvelope));
    fd.append("protect", String(protect));
    fd.append("f0Method", f0Method);
    fd.append("inferenceEngine", inferenceEngine);
    fd.append("onnxPrecision", onnxPrecision);
    fd.append("embedderModel", embedderModel);
    if (embedderModel === "custom" && embedderModelCustom) {
      fd.append("embedderModelCustom", embedderModelCustom);
    }
    fd.append("exportFormat", exportFormat);
    fd.append("splitAudio", String(splitAudio));
    fd.append("f0Autotune", String(f0Autotune));
    fd.append("f0AutotuneStrength", String(f0AutotuneStrength));
    fd.append("proposedPitch", String(proposedPitch));
    fd.append("proposedPitchThreshold", String(proposedPitchThreshold));
    fd.append("sid", String(sid));

    if (formantShifting) {
      fd.append("formantShifting", "true");
      fd.append("formantQfrency", String(formantQfrency));
      fd.append("formantTimbre", String(formantTimbre));
    }

    setSubmitting(true);
    try {
      const { jobId } = await submitInference(fd);
      const { job: fresh } = await fetchJob(jobId);
      setJob(fresh);
      setPersistedJobId(jobId);
    } catch (err) {
      setSubmitError(errMsg(err) || t("Submit failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const isConverting = Boolean(submitting || (job && job.status !== "done" && job.status !== "error"));

  const disabledReason = isConverting
    ? t("Wait for the current conversion to finish.")
    : !conversion.loaded
      ? t("Loading model settings…")
      : !pthPath
        ? t("Select a voice model.")
        : !audioFile && !inputPath
          ? t("Upload an audio file or select a sample from your library.")
          : "";

  return (
    <form onSubmit={onSubmit} className="card-stack w-full max-w-[1920px] mx-auto">
      {loadError && (
        <Alert variant="warning" className="mb-4">
          <strong className="text-white">{t("API offline.")}</strong>{" "}
          <span className="muted">
            {t("Start it with")} <code>npm run dev</code>. {loadError}
          </span>
        </Alert>
      )}

      {/* Top Grid: Model & Audio Input */}
      <div className="grid grid-cols-1 xl:grid-cols-12 card-grid items-stretch">
        {/* Voice Model Selector (5 cols, 4 on 2xl) */}
        <div className="xl:col-span-5 2xl:col-span-4 space-y-4 h-full">
          <VoiceModelCard
            step={1}
            className="h-full"
            models={models}
            selectedModel={pthPath}
            indexes={indexes}
            indexPath={indexPath}
            indexSelectId="infer-index-file"
            onSelect={handleModelSelect}
            onUnload={handleUnloadModel}
            onRefresh={loadAvailableModels}
            onIndexChange={setIndexPath}
            speakers={speakers}
            sid={sid}
            onSpeakerChange={setSid}
            onMetadata={handleModelMetadata}
          />
        </div>

        {/* Audio Input & Drag & Drop Zone (7 cols, 8 on 2xl) */}
        <div className="xl:col-span-7 2xl:col-span-8 space-y-4 h-full">
          <Card className="h-full">
            <CardHeader
              icon={<AudioWaveform size={18} className="text-white" />}
              title={t("Audio Source")}
              step={2}
              description={t("Upload an audio file or select a sample from your library.")}
              action={
                audioFile || inputPath ? (
                  <Badge variant="neutral" size="sm">
                    {audioFile ? t("Uploaded File") : t("Library Sample")}
                  </Badge>
                ) : undefined
              }
            />

            {/* Interactive Drag & Drop + WavePlayer Component */}
            <AudioDropzone
              audioFile={audioFile}
              inputPath={inputPath}
              sampleAudios={sampleAudios}
              onFileSelect={setAudioFile}
              onPathSelect={setInputPath}
              onRefreshAudios={() => loadAvailableModels(true)}
              disabled={isConverting}
              youtube
            />
          </Card>
        </div>
      </div>

      <ConversionParameters
        step={3}
        idPrefix="infer"
        simplified
        onReset={conversion.reset}
        values={conversion.values}
        setters={conversion.setters}
      />

      {/* Convert Action, Live Progress & WavePlayer Result Card */}
      <Card>
        {/* Action Header: Convert button & Status */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <Button
              type="submit"
              disabled={Boolean(disabledReason)}
              aria-describedby={disabledReason ? "infer-convert-help" : undefined}
              icon={<Wand2 size={16} />}
              className="w-full sm:w-auto"
            >
              {isConverting ? t("Converting Audio…") : t("Convert Audio")}
            </Button>

            {job && isConverting && (
              <Button
                variant="danger"
                onClick={() => stopJob(job.id).catch((e) => setSubmitError(errMsg(e)))}
                className="w-full sm:w-auto"
              >
                {t("Stop Conversion")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {job && (
              <Badge
                variant={job.status === "done" ? "success" : job.status === "error" ? "danger" : "info"}
                dot
              >
                {job.status === "done"
                  ? t("Completed")
                  : job.status === "running"
                    ? t("In Progress")
                    : t("Queued")}
              </Badge>
            )}
          </div>
        </div>

        {disabledReason && (
          <p id="infer-convert-help" className="field-help m-0" role="status" aria-live="polite">
            {disabledReason}
          </p>
        )}

        {/* Display measured progress only after the engine reports it. */}
        {isConverting && (
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2">
            <div
              className="flex items-center justify-between text-xs text-neutral-300"
              role="status"
              aria-live="polite"
            >
              <span className="font-medium">
                {submitting ? (
                  t("Submitting audio to AI voice model…")
                ) : job ? (
                  <JobStage job={job} />
                ) : (
                  t("Working…")
                )}
              </span>
              <span className="text-neutral-400 capitalize">
                {submitting ? t("Submitting…") : job?.status === "queued" ? t("Queued") : t("In Progress")}
              </span>
            </div>
            <JobProgress
              status={submitting ? "running" : (job?.status ?? "running")}
              progress={!submitting && job?.status === "running" ? job.progress : undefined}
            />
          </div>
        )}

        {/* Submit or Runtime Error */}
        {submitError && <Alert variant="error">{submitError}</Alert>}

        {job && job.status === "error" && (
          <JobError
            message={job.error || t("Inference job failed.")}
            details={job.errorDetails}
            logs={job.logs}
            jobId={job.id}
          />
        )}
      </Card>
      {job && directAudioUrl && job.status === "done" && (
        <AudioWavePlayer
          src={directAudioUrl}
          originalSrc={originalAudioUrl}
          resultLabel={t("Conversion Output Waveform")}
          title={fileBasename(pthPath).replace(/\.(pth|onnx)$/i, "")}
          filename={job.outputFile ? fileBasename(job.outputFile) : undefined}
        />
      )}
    </form>
  );
}
