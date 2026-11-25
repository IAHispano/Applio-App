"use client";

import { AudioWaveform } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ConversionParameters from "@/components/ConversionParameters";
import ConversionStatusCard from "@/components/ConversionStatusCard";
import type { ModelMetadata } from "@/components/models/ModelInfoCard";
import { Alert, Badge, Card, CardHeader } from "@/components/ui";
import AudioDropzone from "@/components/ui/AudioDropzone";
import { EMBEDDER_MODELS } from "@/components/ui/PitchMethodSelect";
import VoiceModelCard from "@/components/VoiceModelCard";
import {
  apiSend,
  cachedModels,
  errMsg,
  fetchModels,
  fileBasename,
  onModelsChanged,
  outputUrl,
  submitInference,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { getModelPreset } from "@/lib/model-presets";
import { useConversionParameters } from "@/lib/useConversionParameters";
import { usePersistentJob } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";
import { useWorkspaceState } from "@/lib/workspace-state";

export default function InferenceForm() {
  const { t } = useI18n();

  const [models, setModels] = useWorkspaceState<string[]>(
    "InferenceForm:components:models",
    () => cachedModels()?.models ?? [],
  );
  const [indexes, setIndexes] = useWorkspaceState<string[]>(
    "InferenceForm:components:indexes",
    () => cachedModels()?.indexes ?? [],
  );
  const [loadError, setLoadError] = useState("");

  const [pthPath, setPthPath] = useWorkspaceState("InferenceForm:components:pthPath", "");
  const [indexPath, setIndexPath] = useWorkspaceState("InferenceForm:components:indexPath", "");
  const [sid, setSid] = useWorkspaceState("InferenceForm:components:sid", 0);

  // Audio input states
  const [audioFile, setAudioFile] = useWorkspaceState<File | null>(
    "InferenceForm:components:audioFile",
    null,
  );
  const [inputPath, setInputPath] = useWorkspaceState("InferenceForm:components:inputPath", "");

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
    f0Autotune,
    f0AutotuneStrength,
    proposedPitch,
    proposedPitchThreshold,
    formantShifting,
    formantQfrency,
    formantTimbre,
    cleanupMode,
    cleanupStrength,
  } = conversion.values;
  const { embedderModel: setEmbedderModel } = conversion.setters;

  // Job submission & status
  const { jobId, setJobId, activity } = usePersistentJob("inference");
  const { job, error: jobError, stop } = activity;
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
  }, [speakers, sid, setSid]);

  // Load models and indexes
  const loadAvailableModels = useCallback(
    (force = true) => {
      fetchModels(force)
        .then((m) => {
          setModels(m.models);
          setIndexes(m.indexes);
          setLoadError("");
        })
        .catch((e) => setLoadError(errMsg(e)));
    },
    [setIndexes, setModels],
  );

  // Preselect the first model when nothing is chosen yet. Kept out of
  // loadAvailableModels so the fetch is not restarted on every model change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: select once per model list
  useEffect(() => {
    if (models.length > 0 && !pthPath) handleModelSelect(models[0], indexes);
  }, [models, indexes, pthPath]);

  // Initial model fetch & refresh on window focus
  useEffect(() => {
    const unsubscribe = onModelsChanged((models) => {
      setModels(models.models);
      setIndexes(models.indexes);
    });
    loadAvailableModels(false);
    const onFocus = () => loadAvailableModels(false);
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [loadAvailableModels, setIndexes, setModels]);

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
  }, [setPthPath, setIndexPath]);

  const primedRef = useRef("");

  // Settings sent with the preload so the API can run one tiny background
  // conversion that warms the embedder, F0 models, index and device kernels.
  const primeParams = (selected: string, matchedIndex: string) => ({
    pthPath: selected,
    indexPath: matchedIndex,
    pitch,
    indexRate,
    volumeEnvelope,
    protect,
    f0Method,
    inferenceEngine,
    onnxPrecision,
    embedderModel,
    embedderModelCustom: embedderModel === "custom" ? embedderModelCustom : "",
    exportFormat: "WAV",
    f0Autotune,
    f0AutotuneStrength,
    proposedPitch,
    proposedPitchThreshold,
    sid: 0,
    formantShifting,
    formantQfrency,
    formantTimbre,
  });

  const handleModelSelect = (selected: string, idxList = indexes) => {
    setPthPath(selected);
    const matched = matchIndex(selected, idxList);
    setIndexPath(matched);
    setSid(0);
    if (selected) {
      primedRef.current = selected;
      void apiSend("/api/models/preload", "POST", {
        pthPath: selected,
        prime: true,
        params: primeParams(selected, matched),
      }).catch(() => {});
    }
  };

  // Warm a model restored from presets or URL parameters, so the first
  // conversion does not sit on model loading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: prime once per selected model
  useEffect(() => {
    if (!conversion.loaded || !pthPath || primedRef.current === pthPath) return;
    primedRef.current = pthPath;
    void apiSend("/api/models/preload", "POST", {
      pthPath,
      prime: true,
      params: primeParams(pthPath, matchIndex(pthPath, indexes)),
    }).catch(() => {});
  }, [conversion.loaded, pthPath]);

  const handleUnloadModel = () => {
    setPthPath("");
    setIndexPath("");
    setSid(0);
  };

  const directAudioUrl = job?.outputFile ? outputUrl(job.outputFile) : null;
  const jobInputPath = job?.params?.inputPath;
  const originalAudioUrl =
    typeof jobInputPath === "string" && jobInputPath
      ? `/api/audio/raw?path=${encodeURIComponent(jobInputPath)}`
      : null;
  const resultModel = job?.params?.pthPath;
  const missingOutput = job?.status === "done" && !directAudioUrl;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isConverting) return;
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
    fd.append("f0Autotune", String(f0Autotune));
    fd.append("f0AutotuneStrength", String(f0AutotuneStrength));
    fd.append("proposedPitch", String(proposedPitch));
    fd.append("proposedPitchThreshold", String(proposedPitchThreshold));
    fd.append("sid", String(sid));
    fd.append("cleanupMode", cleanupMode);
    fd.append("cleanupStrength", String(cleanupStrength));

    if (formantShifting) {
      fd.append("formantShifting", "true");
      fd.append("formantQfrency", String(formantQfrency));
      fd.append("formantTimbre", String(formantTimbre));
    }

    setSubmitting(true);
    setJobId(null);
    try {
      const accepted = await submitInference(fd);
      if (typeof accepted?.jobId !== "string" || !accepted.jobId) {
        setSubmitError(t("Submit failed"));
        return;
      }
      setJobId(accepted.jobId);
    } catch (err) {
      setSubmitError(errMsg(err) || t("Submit failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const jobActive = job?.status === "queued" || job?.status === "running";
  const awaitingJob = Boolean(jobId && !job && !jobError);
  const isConverting = submitting || jobActive || awaitingJob;

  const disabledReason = !conversion.loaded
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
            onOpen={() => loadAvailableModels(false)}
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
              onFileSelect={setAudioFile}
              onPathSelect={setInputPath}
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

      <ConversionStatusCard
        label={t("Convert Audio")}
        disabledReason={disabledReason}
        pending={submitting ? "submitting" : awaitingJob ? "loading" : undefined}
        job={job}
        onStop={stop}
        error={submitError || (jobId ? jobError : "")}
        failureMessage={t("Inference job failed.")}
        missingOutput={missingOutput ? t("Inference finished but no output file was found.") : undefined}
      />
      {job && directAudioUrl && job.status === "done" && (
        <AudioWavePlayer
          key={job.id}
          src={directAudioUrl}
          originalSrc={originalAudioUrl}
          resultLabel={t("Conversion Output Waveform")}
          title={
            typeof resultModel === "string"
              ? fileBasename(resultModel).replace(/\.(pth|onnx)$/i, "")
              : undefined
          }
          filename={job.outputFile ? fileBasename(job.outputFile) : undefined}
        />
      )}
    </form>
  );
}
