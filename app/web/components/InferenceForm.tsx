"use client";

import { Activity, AudioWaveform, Layers, Loader2, Music, Sliders, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import type { ModelMetadata } from "@/components/models/ModelInfoCard";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Disclosure,
  EMBEDDER_MODELS,
  EmbedderSelect,
  PitchMethodSelect,
  ToggleField,
  VoiceModelField,
} from "@/components/ui";
import AudioDropzone from "@/components/ui/AudioDropzone";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import {
  apiGet,
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
import { usePersistentJobId } from "@/lib/useJob";
import { usePreviewUrl } from "@/lib/usePreviewUrl";
import { useSpeakers } from "@/lib/useSpeakers";

const FORMATS = ["WAV", "MP3", "FLAC", "OGG", "M4A"];

interface ModelDetail {
  pthPath: string;
  pthSize: number;
  indexSize: number | null;
  modifiedAt: string;
  folder: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0.75);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1.0);
  const [protect, setProtect] = useState(0.5);

  // Algorithm & Export
  const [f0Method, setF0Method] = useState("rmvpe");
  const [embedderModel, setEmbedderModel] = useState("contentvec");
  const [embedderModelCustom, setEmbedderModelCustom] = useState("");
  const [exportFormat, setExportFormat] = useState("WAV");

  // Advanced settings
  const [splitAudio, setSplitAudio] = useState(false);
  const [f0Autotune, setF0Autotune] = useState(false);
  const [f0AutotuneStrength, setF0AutotuneStrength] = useState(1.0);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [proposedPitchThreshold, setProposedPitchThreshold] = useState(155);
  const [cleanAudio, setCleanAudio] = useState(false);
  const [cleanStrength, setCleanStrength] = useState(0.5);

  // Formant Shifting
  const [formantShifting, setFormantShifting] = useState(false);
  const [formantQfrency, setFormantQfrency] = useState(1.0);
  const [formantTimbre, setFormantTimbre] = useState(1.0);
  const [formantPresets, setFormantPresets] = useState<string[]>([]);
  const [formantPreset, setFormantPreset] = useState("");

  useEffect(() => {
    apiGet<{ presets: string[] }>("/api/presets/formant")
      .then((r) => setFormantPresets(r.presets || []))
      .catch(() => setFormantPresets([]));
  }, []);

  async function applyFormantPreset(name: string) {
    setFormantPreset(name);
    if (!name) return;
    try {
      const r = await apiGet<{ values: { formant_qfrency: number; formant_timbre: number } }>(
        `/api/presets/formant/${encodeURIComponent(name.replace(/\.json$/i, ""))}`,
      );
      if (typeof r.values.formant_qfrency === "number") setFormantQfrency(r.values.formant_qfrency);
      if (typeof r.values.formant_timbre === "number") setFormantTimbre(r.values.formant_timbre);
    } catch (e) {
      setSubmitError(errMsg(e));
    }
  }

  // FX Rack
  const [postProcess, setPostProcess] = useState(false);
  const [reverb, setReverb] = useState(false);
  const [reverbRoomSize, setReverbRoomSize] = useState(0.5);
  const [reverbDamping, setReverbDamping] = useState(0.5);
  const [reverbWetGain, setReverbWetGain] = useState(0.33);
  const [reverbDryGain, setReverbDryGain] = useState(0.4);
  const [reverbWidth, setReverbWidth] = useState(1.0);
  const [reverbFreezeMode, setReverbFreezeMode] = useState(0.0);
  const [pitchShift, setPitchShift] = useState(false);
  const [pitchShiftSemitones, setPitchShiftSemitones] = useState(0);

  const [delay, setDelay] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(0.5);
  const [delayFeedback, setDelayFeedback] = useState(0.0);
  const [delayMix, setDelayMix] = useState(0.4);

  const [compressor, setCompressor] = useState(false);
  const [compressorThreshold, setCompressorThreshold] = useState(0);
  const [compressorRatio, setCompressorRatio] = useState(1);
  const [compressorAttack, setCompressorAttack] = useState(1.0);
  const [compressorRelease, setCompressorRelease] = useState(100);

  const [limiter, setLimiter] = useState(false);
  const [limiterThreshold, setLimiterThreshold] = useState(-6);
  const [limiterReleaseTime, setLimiterReleaseTime] = useState(0.05);

  const [chorus, setChorus] = useState(false);
  const [chorusRate, setChorusRate] = useState(1.0);
  const [chorusDepth, setChorusDepth] = useState(0.25);
  const [chorusCenterDelay, setChorusCenterDelay] = useState(7);
  const [chorusFeedback, setChorusFeedback] = useState(0.0);
  const [chorusMix, setChorusMix] = useState(0.5);
  const [bitcrush, setBitcrush] = useState(false);
  const [bitcrushBitDepth, setBitcrushBitDepth] = useState(8);
  const [clipping, setClipping] = useState(false);
  const [clippingThreshold, setClippingThreshold] = useState(-6);

  const [distortion, setDistortion] = useState(false);
  const [distortionGain, setDistortionGain] = useState(25);

  const [gain, setGain] = useState(false);
  const [gainDb, setGainDb] = useState(0);

  // Job submission & status
  const [job, setJob] = useState<Job | null>(null);
  const [persistedJobId, setPersistedJobId] = usePersistentJobId("inference");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const speakers = useSpeakers(pthPath);
  const [library, setLibrary] = useState<ModelDetail[]>([]);

  // Cheap filesystem metadata (no Python): fills the model card once a model
  // is picked, where the empty-state hint used to be.
  useEffect(() => {
    apiGet<{ models: ModelDetail[] }>("/api/models/library")
      .then((r) => setLibrary(r.models || []))
      .catch(() => setLibrary([]));
  }, []);

  const selectedMeta = useMemo(() => library.find((m) => m.pthPath === pthPath) ?? null, [library, pthPath]);

  // Deep model metadata extracted by running inspection script
  const [inspectMeta, setInspectMeta] = useState<ModelMetadata | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");

  // Extract model information when checkpoint is loaded
  useEffect(() => {
    if (!pthPath) {
      setInspectMeta(null);
      setInspectLoading(false);
      setInspectError("");
      return;
    }

    let cancelled = false;
    // Clear previous model's details immediately so stale arch info never
    // lingers while the new checkpoint inspects (skeletons show instead).
    setInspectMeta(null);
    setInspectLoading(true);
    setInspectError("");

    apiSend<{ ok: boolean; metadata: ModelMetadata }>("/api/models/inspect", "POST", { pthPath })
      .then((res) => {
        if (cancelled) return;
        if (res?.metadata) {
          setInspectMeta(res.metadata);
          // Auto-sync embedder model if detected in checkpoint metadata
          if (res.metadata.embedder_model && res.metadata.embedder_model !== "None") {
            const emb = res.metadata.embedder_model.toLowerCase();
            if (EMBEDDER_MODELS.includes(emb)) {
              setEmbedderModel(emb);
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setInspectError(errMsg(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInspectLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pthPath]);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  // Load models, indexes and sample audios
  const loadAvailableModels = () => {
    fetchModels()
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
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    loadAvailableModels();
  }, []);

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

  const presetStateRef = useRef({ pitch, indexRate, volumeEnvelope, protect });
  presetStateRef.current = { pitch, indexRate, volumeEnvelope, protect };

  // PresetsPanel bridge (Gradio had preset dropdown + import/export per tab).
  useEffect(() => {
    const onApply = (e: Event) => {
      const v = (e as CustomEvent).detail as {
        pitch: number;
        index_rate: number;
        rms_mix_rate: number;
        protect: number;
      };
      if (typeof v.pitch === "number") setPitch(Math.max(-24, Math.min(24, v.pitch)));
      if (typeof v.index_rate === "number") setIndexRate(v.index_rate);
      if (typeof v.rms_mix_rate === "number") setVolumeEnvelope(v.rms_mix_rate);
      if (typeof v.protect === "number") setProtect(v.protect);
    };
    const onRequest = () => {
      window.dispatchEvent(
        new CustomEvent("applio:read-preset", {
          detail: presetStateRef.current,
        }),
      );
    };
    window.addEventListener("applio:apply-preset", onApply);
    window.addEventListener("applio:request-preset", onRequest);
    return () => {
      window.removeEventListener("applio:apply-preset", onApply);
      window.removeEventListener("applio:request-preset", onRequest);
    };
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
    fd.append("embedderModel", embedderModel);
    if (embedderModel === "custom" && embedderModelCustom) {
      fd.append("embedderModelCustom", embedderModelCustom);
    }
    fd.append("exportFormat", exportFormat);
    fd.append("splitAudio", String(splitAudio));
    fd.append("f0Autotune", String(f0Autotune));
    if (f0Autotune) fd.append("f0AutotuneStrength", String(f0AutotuneStrength));
    fd.append("proposedPitch", String(proposedPitch));
    if (proposedPitch) fd.append("proposedPitchThreshold", String(proposedPitchThreshold));
    fd.append("cleanAudio", String(cleanAudio));
    if (cleanAudio) fd.append("cleanStrength", String(cleanStrength));
    fd.append("sid", String(sid));

    if (formantShifting) {
      fd.append("formantShifting", "true");
      fd.append("formantQfrency", String(formantQfrency));
      fd.append("formantTimbre", String(formantTimbre));
    }

    if (postProcess) {
      fd.append("postProcess", "true");
      if (reverb) {
        fd.append("reverb", "true");
        fd.append("reverbRoomSize", String(reverbRoomSize));
        fd.append("reverbDamping", String(reverbDamping));
        fd.append("reverbWetGain", String(reverbWetGain));
        fd.append("reverbDryGain", String(reverbDryGain));
        fd.append("reverbWidth", String(reverbWidth));
        fd.append("reverbFreezeMode", String(reverbFreezeMode));
      }
      if (pitchShift) {
        fd.append("pitchShift", "true");
        fd.append("pitchShiftSemitones", String(pitchShiftSemitones));
      }
      if (delay) {
        fd.append("delay", "true");
        fd.append("delaySeconds", String(delaySeconds));
        fd.append("delayFeedback", String(delayFeedback));
        fd.append("delayMix", String(delayMix));
      }
      if (compressor) {
        fd.append("compressor", "true");
        fd.append("compressorThreshold", String(compressorThreshold));
        fd.append("compressorRatio", String(compressorRatio));
        fd.append("compressorAttack", String(compressorAttack));
        fd.append("compressorRelease", String(compressorRelease));
      }
      if (limiter) {
        fd.append("limiter", "true");
        fd.append("limiterThreshold", String(limiterThreshold));
        fd.append("limiterReleaseTime", String(limiterReleaseTime));
      }
      if (chorus) {
        fd.append("chorus", "true");
        fd.append("chorusRate", String(chorusRate));
        fd.append("chorusDepth", String(chorusDepth));
        fd.append("chorusCenterDelay", String(chorusCenterDelay));
        fd.append("chorusFeedback", String(chorusFeedback));
        fd.append("chorusMix", String(chorusMix));
      }
      if (bitcrush) {
        fd.append("bitcrush", "true");
        fd.append("bitcrushBitDepth", String(bitcrushBitDepth));
      }
      if (clipping) {
        fd.append("clipping", "true");
        fd.append("clippingThreshold", String(clippingThreshold));
      }
      if (gain) {
        fd.append("gain", "true");
        fd.append("gainDb", String(gainDb));
      }
      if (distortion) {
        fd.append("distortion", "true");
        fd.append("distortionGain", String(distortionGain));
      }
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

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-[1920px] mx-auto">
      {loadError && (
        <Alert variant="warning" className="mb-4">
          <strong className="text-white">{t("API offline.")}</strong>{" "}
          <span className="muted">
            {t("Start it with")} <code>npm run dev</code>. {loadError}
          </span>
        </Alert>
      )}

      {/* Top Grid: Model & Audio Input */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Voice Model Selector (5 cols, 4 on 2xl) */}
        <div className="lg:col-span-5 2xl:col-span-4 space-y-4 h-full">
          <Card className="h-full flex flex-col">
            <CardHeader
              icon={<Music size={18} className="text-white" />}
              title={t("Voice Model")}
              description={t("Select the target voice checkpoint and paired feature index.")}
              action={
                pthPath ? (
                  <Badge variant="success" size="sm" dot>
                    {t("Ready")}
                  </Badge>
                ) : undefined
              }
            />

            {/* Shared voice model picker (dropdown + linked index) */}
            <VoiceModelField
              models={models}
              selectedModel={pthPath}
              indexes={indexes}
              indexPath={indexPath}
              indexSelectId="infer-index-file"
              onSelect={handleModelSelect}
              onUnload={handleUnloadModel}
              onRefresh={loadAvailableModels}
              onIndexChange={setIndexPath}
            />

            {/* Enriched Model Metadata with deep inspection extraction */}
            {pthPath && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between text-xs text-neutral-400 px-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-neutral-300">{t("Model Architecture")}</span>
                    {inspectLoading && (
                      <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                        <Loader2 size={11} className="animate-spin text-neutral-300" />
                        <span>{t("Extracting info…")}</span>
                      </span>
                    )}
                    {inspectMeta?.version && inspectMeta.version !== "None" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white font-mono uppercase border border-white/10">
                        {inspectMeta.version}
                      </span>
                    )}
                  </div>
                  {inspectMeta?.author && inspectMeta.author !== "None" && (
                    <span className="text-[11px] text-neutral-300 truncate max-w-[150px]">
                      {t("by")} <strong className="text-white font-medium">{inspectMeta.author}</strong>
                    </span>
                  )}
                </div>

                {inspectError && !inspectLoading && <Alert variant="warning">{inspectError}</Alert>}

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-neutral-400 bg-black/30 p-2.5 rounded-xl border border-white/5">
                  <div>
                    <dt>{t("Weights")}</dt>
                    <dd className="text-white font-medium">
                      {selectedMeta?.pthSize ? humanSize(selectedMeta.pthSize) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Index")}</dt>
                    <dd className="text-white font-medium">
                      {selectedMeta?.indexSize
                        ? humanSize(selectedMeta.indexSize)
                        : indexPath
                          ? fileBasename(indexPath)
                          : "—"}
                    </dd>
                  </div>
                  {(
                    [
                      { label: t("Epochs"), value: inspectMeta?.epochs },
                      { label: t("Training Steps"), value: inspectMeta?.step, numeric: true },
                      { label: t("Sample Rate"), value: inspectMeta?.sr, sampleRate: true },
                      { label: t("Pitch extraction algorithm"), value: inspectMeta?.f0, pitch: true },
                      { label: t("Embedder Model"), value: inspectMeta?.embedder_model, truncate: true },
                    ] as Array<{
                      label: string;
                      value?: string;
                      numeric?: boolean;
                      sampleRate?: boolean;
                      pitch?: boolean;
                      truncate?: boolean;
                    }>
                  ).map((row) => {
                    const value = row.value ?? "";
                    const missing =
                      value === "" || value === "None" || (row.numeric && Number.isNaN(Number(value)));
                    return (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd className="text-white font-medium">
                          {inspectLoading ? (
                            <span
                              aria-hidden="true"
                              className="block h-3.5 w-20 rounded bg-white/10 animate-pulse"
                            />
                          ) : missing ? (
                            "—"
                          ) : row.numeric ? (
                            Number(value).toLocaleString()
                          ) : row.sampleRate ? (
                            value.endsWith("k") ? (
                              `${value}Hz`
                            ) : (
                              `${Number(value) / 1000} kHz`
                            )
                          ) : row.pitch ? (
                            value === "1" || value === "True" || value === "true" ? (
                              t("Yes")
                            ) : (
                              t("No (pitchless)")
                            )
                          ) : row.truncate ? (
                            <span className="block truncate" title={value}>
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </dd>
                      </div>
                    );
                  })}
                  <div>
                    <dt>{t("Speakers")}</dt>
                    <dd className="text-white font-medium">
                      {speakers.length > 0 ? speakers.length : inspectMeta?.speakers_id || 1}
                    </dd>
                  </div>
                  {selectedMeta?.folder && (
                    <div>
                      <dt>{t("Folder")}</dt>
                      <dd className="text-white font-medium truncate" title={selectedMeta.folder}>
                        {selectedMeta.folder}
                      </dd>
                    </div>
                  )}
                  {selectedMeta?.modifiedAt && (
                    <div>
                      <dt>{t("Modified")}</dt>
                      <dd className="text-white font-medium">
                        {new Date(selectedMeta.modifiedAt).toLocaleDateString()}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Empty state: the card is as tall as the audio one, so use the
                room to say where models come from instead of leaving a void. */}
            {!pthPath && (
              <div className="flex flex-col items-center justify-center text-center gap-3 flex-1 py-6">
                <Music size={26} className="text-neutral-600" />
                <p className="text-xs text-neutral-400 m-0 max-w-[240px] leading-relaxed">
                  {models.length === 0
                    ? t("No models found in logs/. Download one or train your own to get started.")
                    : t("Pick a voice model above — its index file is paired automatically.")}
                </p>
                {models.length === 0 && (
                  <Link href="/models" className="ghost-link">
                    {t("Go to Download")}
                  </Link>
                )}
              </div>
            )}

            {/* Multi-speaker ID selector */}
            {speakers.length > 1 && (
              <div>
                <label htmlFor="speaker-id-select" className="text-xs font-medium text-neutral-300">
                  {t("Speaker ID (Multi-Speaker Model)")}
                </label>
                <CustomSelect
                  id="speaker-id-select"
                  value={String(sid)}
                  onChange={(e) => setSid(Number(e.target.value))}
                  className="w-full mt-1"
                >
                  {speakers.map((s) => (
                    <option key={s} value={String(s)}>
                      {t("Speaker")} {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
            )}
          </Card>
        </div>

        {/* Audio Input & Drag & Drop Zone (7 cols, 8 on 2xl) */}
        <div className="lg:col-span-7 2xl:col-span-8 space-y-4 h-full">
          <Card className="h-full">
            <CardHeader
              icon={<AudioWaveform size={18} className="text-white" />}
              title={t("Audio Source")}
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
              disabled={isConverting}
              youtube
            />
          </Card>
        </div>
      </div>

      {/* Main Conversion Settings Card */}
      <Card>
        <CardHeader
          icon={<Sliders size={18} className="text-white" />}
          title={t("Conversion Parameters")}
          description={t("Fine-tune pitch shifting, index feature retrieval, and audio envelope response.")}
          action={
            <button
              type="button"
              onClick={() => {
                setPitch(0);
                setIndexRate(0.75);
                setVolumeEnvelope(1.0);
                setProtect(0.5);
              }}
              className="text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              {t("Reset defaults")}
            </button>
          }
        />

        {/* 4 Core Voice Sliders (2x2 Grid on md, 4 across on xl/fullscreen) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {/* Pitch Shift with Quick Octave Buttons */}
          <div className="space-y-2">
            <SliderField
              id="infer-pitch"
              label={t("Pitch")}
              value={pitch}
              min={-24}
              max={24}
              step={1}
              unit="st"
              formatValue={(v) => `${v > 0 ? `+${v}` : v} semitones`}
              onChange={setPitch}
              description={t("-24 to 24 semitones (±12 = 1 full octave)")}
            />
            {/* Octave Quick Buttons */}
            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
              <span className="text-[10px] text-neutral-500 mr-1">{t("Quick:")}</span>
              <button
                type="button"
                onClick={() => setPitch(-12)}
                className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-neutral-300 border border-white/10 transition-colors"
              >
                -12 (Male)
              </button>
              <button
                type="button"
                onClick={() => setPitch(0)}
                className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-neutral-300 border border-white/10 transition-colors"
              >
                0 (Default)
              </button>
              <button
                type="button"
                onClick={() => setPitch(12)}
                className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-neutral-300 border border-white/10 transition-colors"
              >
                +12 (Female)
              </button>
            </div>
          </div>

          {/* Search Feature Ratio */}
          <div>
            <SliderField
              id="infer-index-rate"
              label={t("Search Feature Ratio")}
              value={indexRate}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => `${v}`}
              onChange={setIndexRate}
              description={t("Weight of the index feature retrieval (0 = model only, 1 = max accent)")}
            />
          </div>

          {/* Volume Envelope */}
          <div>
            <SliderField
              id="infer-volume-envelope"
              label={t("Volume Envelope")}
              value={volumeEnvelope}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => `${v}`}
              onChange={setVolumeEnvelope}
              description={t("Match input audio loudness dynamics (1.0 = full dynamic match)")}
            />
          </div>

          {/* Consonant Protection */}
          <div>
            <SliderField
              id="infer-protect"
              label={t("Protect Voiceless Consonants")}
              value={protect}
              min={0}
              max={0.5}
              step={0.01}
              formatValue={(v) => `${v}`}
              onChange={setProtect}
              description={t("Shields voiceless consonants and breath sounds from artifacts (0.5 = neutral)")}
            />
          </div>
        </div>

        {/* Algorithm, Embedder & Export Format Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10">
          <PitchMethodSelect
            id="f0-method-select"
            label={t("Pitch Extraction Algorithm")}
            value={f0Method}
            onChange={setF0Method}
          />

          <EmbedderSelect
            id="embedder-model-select"
            label={t("Embedder Model")}
            value={embedderModel}
            onChange={setEmbedderModel}
          />

          <div>
            <label htmlFor="export-format-select" className="text-xs font-medium text-neutral-300">
              {t("Output Audio Format")}
            </label>
            <CustomSelect
              id="export-format-select"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="w-full mt-1"
            >
              {FORMATS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>

        {embedderModel === "custom" && (
          <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
            <label htmlFor="embedder-custom-input" className="text-xs font-medium text-neutral-300">
              {t("Select Custom Embedder")}
            </label>
            <input
              id="embedder-custom-input"
              type="text"
              value={embedderModelCustom}
              onChange={(e) => setEmbedderModelCustom(e.target.value)}
              placeholder="rvc/models/embedders/embedders_custom/my-embedder"
              className="w-full mt-1"
            />
          </div>
        )}

        {/* Collapsible Accordions: Advanced Tuning, Formant, Audio FX */}
        <div className="space-y-3 pt-2">
          {/* Advanced Pitch & Tuning Accordion */}
          <Disclosure title={t("Advanced Pitch & Audio Cleanup")} icon={<Activity size={15} />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ToggleField
                id="infer-split-audio"
                label={t("Split Audio")}
                checked={splitAudio}
                onChange={setSplitAudio}
              />
              <ToggleField
                id="infer-autotune"
                label={t("Autotune")}
                checked={f0Autotune}
                onChange={setF0Autotune}
              />
              <ToggleField
                id="infer-clean-audio"
                label={t("Clean Audio")}
                checked={cleanAudio}
                onChange={setCleanAudio}
              />
              <ToggleField
                id="infer-proposed-pitch"
                label={t("Proposed Pitch")}
                checked={proposedPitch}
                onChange={setProposedPitch}
              />
            </div>

            {(f0Autotune || cleanAudio || proposedPitch) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                {f0Autotune && (
                  <SliderField
                    id="infer-autotune-strength"
                    label={t("Autotune Strength")}
                    value={f0AutotuneStrength}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setF0AutotuneStrength}
                  />
                )}
                {cleanAudio && (
                  <SliderField
                    id="infer-clean-strength"
                    label={t("Clean Strength")}
                    value={cleanStrength}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onChange={setCleanStrength}
                  />
                )}
                {proposedPitch && (
                  <SliderField
                    id="infer-pitch-thresh"
                    label={t("Proposed Pitch Threshold")}
                    value={proposedPitchThreshold}
                    min={50}
                    max={1200}
                    step={1}
                    unit="Hz"
                    onChange={setProposedPitchThreshold}
                  />
                )}
              </div>
            )}
          </Disclosure>

          {/* Formant Shifting Accordion */}
          <Disclosure title={t("Formant Shifting")} icon={<Sparkles size={15} />}>
            <ToggleField
              id="infer-formant-shifting"
              label={t("Enable Formant Shifting")}
              checked={formantShifting}
              onChange={setFormantShifting}
            />
            {formantPresets.length > 0 && (
              <div className="max-w-xs">
                <label htmlFor="infer-formant-preset" className="text-xs font-medium text-neutral-300">
                  {t("Browse presets for formanting")}{" "}
                  <span className="text-neutral-500">(assets/formant_shift)</span>
                </label>
                <CustomSelect
                  id="infer-formant-preset"
                  value={formantPreset}
                  onChange={(e) => applyFormantPreset(e.target.value)}
                  placeholder={t("Select formant preset…")}
                  className="w-full mt-1"
                >
                  <option value="">{t("None (manual)")}</option>
                  {formantPresets.map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/\.json$/i, "")}
                    </option>
                  ))}
                </CustomSelect>
              </div>
            )}

            {formantShifting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <SliderField
                  id="infer-formant-qfrency"
                  label={t("Quefrency for formant shifting")}
                  value={formantQfrency}
                  min={0}
                  max={16.0}
                  step={0.1}
                  onChange={setFormantQfrency}
                  description={t("Modifies formants width and spectral envelope")}
                />
                <SliderField
                  id="infer-formant-timbre"
                  label={t("Timbre for formant shifting")}
                  value={formantTimbre}
                  min={0}
                  max={16.0}
                  step={0.1}
                  onChange={setFormantTimbre}
                  description={t("Adjusts vocal tract length / timbre brightness")}
                />
              </div>
            )}
          </Disclosure>

          {/* Audio FX Rack Accordion */}
          <Disclosure
            title={t("Post-Process")}
            icon={<Layers size={15} />}
            open={postProcess}
            onToggle={setPostProcess}
          >
            {postProcess && (
              <div className="space-y-4 pt-2">
                {/* Reverb */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input type="checkbox" checked={reverb} onChange={(e) => setReverb(e.target.checked)} />
                    <span>{t("Reverb")}</span>
                  </label>
                  {reverb && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <SliderField
                        id="fx-reverb-room"
                        label={t("Reverb Room Size")}
                        value={reverbRoomSize}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbRoomSize}
                      />
                      <SliderField
                        id="fx-reverb-damping"
                        label={t("Reverb Damping")}
                        value={reverbDamping}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbDamping}
                      />
                      <SliderField
                        id="fx-reverb-wet"
                        label={t("Reverb Wet Gain")}
                        value={reverbWetGain}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbWetGain}
                      />
                      <SliderField
                        id="fx-reverb-dry"
                        label={t("Reverb Dry Gain")}
                        value={reverbDryGain}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbDryGain}
                      />
                      <SliderField
                        id="fx-reverb-width"
                        label={t("Reverb Width")}
                        value={reverbWidth}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbWidth}
                      />
                      <SliderField
                        id="fx-reverb-freeze"
                        label={t("Reverb Freeze Mode")}
                        value={reverbFreezeMode}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setReverbFreezeMode}
                      />
                    </div>
                  )}
                </div>

                {/* Pitch Shift */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input
                      type="checkbox"
                      checked={pitchShift}
                      onChange={(e) => setPitchShift(e.target.checked)}
                    />
                    <span>{t("Pitch Shift")}</span>
                  </label>
                  {pitchShift && (
                    <SliderField
                      id="fx-pitch-semitones"
                      label={t("Pitch Shift Semitones")}
                      value={pitchShiftSemitones}
                      min={-12}
                      max={12}
                      step={1}
                      onChange={setPitchShiftSemitones}
                    />
                  )}
                </div>

                {/* Delay */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input type="checkbox" checked={delay} onChange={(e) => setDelay(e.target.checked)} />
                    <span>{t("Delay")}</span>
                  </label>
                  {delay && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <SliderField
                        id="fx-delay-time"
                        label={t("Delay Seconds")}
                        value={delaySeconds}
                        min={0}
                        max={5.0}
                        step={0.05}
                        unit="s"
                        onChange={setDelaySeconds}
                      />
                      <SliderField
                        id="fx-delay-feedback"
                        label={t("Delay Feedback")}
                        value={delayFeedback}
                        min={0}
                        max={1.0}
                        step={0.05}
                        onChange={setDelayFeedback}
                      />
                      <SliderField
                        id="fx-delay-mix"
                        label={t("Delay Mix")}
                        value={delayMix}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setDelayMix}
                      />
                    </div>
                  )}
                </div>

                {/* Compressor & Limiter */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input
                        type="checkbox"
                        checked={compressor}
                        onChange={(e) => setCompressor(e.target.checked)}
                      />
                      <span>{t("Compressor")}</span>
                    </label>
                    {compressor && (
                      <div className="space-y-2">
                        <SliderField
                          id="fx-comp-thresh"
                          label={t("Compressor Threshold dB")}
                          value={compressorThreshold}
                          min={-60}
                          max={0}
                          step={1}
                          unit="dB"
                          onChange={setCompressorThreshold}
                        />
                        <SliderField
                          id="fx-comp-ratio"
                          label={t("Compressor Ratio")}
                          value={compressorRatio}
                          min={1}
                          max={20}
                          step={0.5}
                          formatValue={(v) => `${v}:1`}
                          onChange={setCompressorRatio}
                        />
                        <SliderField
                          id="fx-comp-attack"
                          label={t("Compressor Attack ms")}
                          value={compressorAttack}
                          min={0}
                          max={100}
                          step={1}
                          unit="ms"
                          onChange={setCompressorAttack}
                        />
                        <SliderField
                          id="fx-comp-release"
                          label={t("Compressor Release ms")}
                          value={compressorRelease}
                          min={0.01}
                          max={100}
                          step={0.5}
                          unit="ms"
                          onChange={setCompressorRelease}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input
                        type="checkbox"
                        checked={limiter}
                        onChange={(e) => setLimiter(e.target.checked)}
                      />
                      <span>{t("Limiter")}</span>
                    </label>
                    {limiter && (
                      <div className="space-y-2">
                        <SliderField
                          id="fx-limiter-ceil"
                          label={t("Limiter Threshold dB")}
                          value={limiterThreshold}
                          min={-60}
                          max={0}
                          step={0.5}
                          unit="dB"
                          onChange={setLimiterThreshold}
                        />
                        <SliderField
                          id="fx-limiter-release"
                          label={t("Limiter Release Time")}
                          value={limiterReleaseTime}
                          min={0.01}
                          max={1}
                          step={0.01}
                          unit="s"
                          onChange={setLimiterReleaseTime}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Chorus, Distortion & Gain */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input type="checkbox" checked={chorus} onChange={(e) => setChorus(e.target.checked)} />
                      <span>{t("Chorus")}</span>
                    </label>
                    {chorus && (
                      <div className="space-y-2">
                        <SliderField
                          id="fx-chorus-rate"
                          label={t("Chorus Rate Hz")}
                          value={chorusRate}
                          min={0.1}
                          max={100}
                          step={0.1}
                          unit="Hz"
                          onChange={setChorusRate}
                        />
                        <SliderField
                          id="fx-chorus-depth"
                          label={t("Chorus Depth")}
                          value={chorusDepth}
                          min={0.05}
                          max={1}
                          step={0.05}
                          onChange={setChorusDepth}
                        />
                        <SliderField
                          id="fx-chorus-center"
                          label={t("Chorus Center Delay ms")}
                          value={chorusCenterDelay}
                          min={7}
                          max={8}
                          step={0.1}
                          unit="ms"
                          onChange={setChorusCenterDelay}
                        />
                        <SliderField
                          id="fx-chorus-feedback"
                          label={t("Chorus Feedback")}
                          value={chorusFeedback}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={setChorusFeedback}
                        />
                        <SliderField
                          id="fx-chorus-mix"
                          label={t("Chorus Mix")}
                          value={chorusMix}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={setChorusMix}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input
                        type="checkbox"
                        checked={distortion}
                        onChange={(e) => setDistortion(e.target.checked)}
                      />
                      <span>{t("Distortion")}</span>
                    </label>
                    {distortion && (
                      <SliderField
                        id="fx-dist-gain"
                        label={t("Distortion Gain")}
                        value={distortionGain}
                        min={-60}
                        max={60}
                        step={1}
                        unit="dB"
                        onChange={setDistortionGain}
                      />
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input type="checkbox" checked={gain} onChange={(e) => setGain(e.target.checked)} />
                      <span>{t("Gain")}</span>
                    </label>
                    {gain && (
                      <SliderField
                        id="fx-gain-db"
                        label={t("Gain dB")}
                        value={gainDb}
                        min={-60}
                        max={60}
                        step={0.5}
                        unit="dB"
                        onChange={setGainDb}
                      />
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input
                        type="checkbox"
                        checked={bitcrush}
                        onChange={(e) => setBitcrush(e.target.checked)}
                      />
                      <span>{t("Bitcrush")}</span>
                    </label>
                    {bitcrush && (
                      <SliderField
                        id="fx-bitcrush-depth"
                        label={t("Bitcrush Bit Depth")}
                        value={bitcrushBitDepth}
                        min={1}
                        max={32}
                        step={1}
                        onChange={setBitcrushBitDepth}
                      />
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                      <input
                        type="checkbox"
                        checked={clipping}
                        onChange={(e) => setClipping(e.target.checked)}
                      />
                      <span>{t("Clipping")}</span>
                    </label>
                    {clipping && (
                      <SliderField
                        id="fx-clip-thresh"
                        label={t("Clipping Threshold")}
                        value={clippingThreshold}
                        min={-60}
                        max={0}
                        step={0.5}
                        unit="dB"
                        onChange={setClippingThreshold}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </Disclosure>
        </div>
      </Card>

      {/* Convert Action, Live Progress & WavePlayer Result Card */}
      <Card>
        {/* Action Header: Convert button & Status */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={isConverting || !pthPath || (!audioFile && !inputPath)}
              icon={<Wand2 size={16} />}
            >
              {isConverting ? t("Converting Audio…") : t("Convert Audio")}
            </Button>

            {job && isConverting && (
              <Button
                variant="danger"
                onClick={() => stopJob(job.id).catch((e) => setSubmitError(errMsg(e)))}
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
                    : job.status}
              </Badge>
            )}
          </div>
        </div>

        {/* Live Conversion Progress Bar (strictly progress bar, no spinners!) */}
        {isConverting && (
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="font-medium">
                {submitting
                  ? t("Submitting audio to AI voice model…")
                  : job?.status === "queued"
                    ? t("Queued in processing pipeline…")
                    : t("Processing inference with voice model…")}
              </span>
              <span className="text-neutral-400 capitalize">
                {submitting ? t("Uploading…") : job?.status || t("Working…")}
              </span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300 animate-pulse"
                style={{
                  width: submitting ? "30%" : job?.status === "queued" ? "50%" : "85%",
                }}
              />
            </div>
          </div>
        )}

        {/* Submit or Runtime Error */}
        {submitError && <Alert variant="error">{submitError}</Alert>}

        {job && job.status === "error" && (
          <Alert variant="error">{job.error || t("Inference job failed.")}</Alert>
        )}

        {/* Converted Audio WavePlayer Result with A/B Track Switching */}
        {job && directAudioUrl && job.status === "done" && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
              <span className="font-semibold text-white">{t("Conversion Output Waveform")}</span>
              <span>{t("Use A/B toggle to compare with original")}</span>
            </div>

            <AudioWavePlayer
              src={directAudioUrl}
              originalSrc={originalAudioUrl}
              title={`${t("Output:")} ${fileBasename(pthPath).replace(/\.(pth|onnx)$/i, "")}`}
              filename={job.outputFile ? fileBasename(job.outputFile) : undefined}
            />
          </div>
        )}
      </Card>
    </form>
  );
}
