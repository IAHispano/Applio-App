"use client";

import { ArrowRight, CheckCircle2, Layers, StopCircle, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ConversionParameters from "@/components/ConversionParameters";
import { JobError } from "@/components/JobStatus";
import { Alert, Badge, Button, Card, CardHeader, VoiceModelField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import { errMsg, fetchModels, stopJob, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { SETTING_HELP } from "@/lib/setting-help";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";

export default function BatchForm() {
  const [models, setModels] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<string[]>([]);
  const { t } = useI18n();
  const [pthPath, setPthPath] = useState("");
  const [indexPath, setIndexPath] = useState("");
  const [inputFolder, setInputFolder] = useState("assets/audios");
  const [mode, setMode] = useState("files");
  const [inputPath, setInputPath] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [outputFolder, setOutputFolder] = useState("assets/audios/batch_output");
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0.75);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1);
  const [protect, setProtect] = useState(0.5);
  const [f0Method, setF0Method] = useState("rmvpe");
  const [embedderModel, setEmbedderModel] = useState("contentvec");
  const [embedderModelCustom, setEmbedderModelCustom] = useState("");
  const [exportFormat, setExportFormat] = useState("WAV");
  const [splitAudio, setSplitAudio] = useState(false);
  const [f0Autotune, setF0Autotune] = useState(false);
  const [f0AutotuneStrength, setF0AutotuneStrength] = useState(1);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [proposedPitchThreshold, setProposedPitchThreshold] = useState(155);
  const [cleanAudio, setCleanAudio] = useState(false);
  const [cleanStrength, setCleanStrength] = useState(0.5);
  // Formant shifting
  const [formantShifting, setFormantShifting] = useState(false);
  const [formantQfrency, setFormantQfrency] = useState(1.0);
  const [formantTimbre, setFormantTimbre] = useState(1.0);
  // Post-process FX rack
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
  const [limiter, setLimiter] = useState(false);
  const [limiterThreshold, setLimiterThreshold] = useState(-6);
  const [limiterReleaseTime, setLimiterReleaseTime] = useState(0.05);
  const [gain, setGain] = useState(false);
  const [gainDb, setGainDb] = useState(0);
  const [distortion, setDistortion] = useState(false);
  const [distortionGain, setDistortionGain] = useState(25);
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
  const [compressor, setCompressor] = useState(false);
  const [compressorThreshold, setCompressorThreshold] = useState(0);
  const [compressorRatio, setCompressorRatio] = useState(1);
  const [compressorAttack, setCompressorAttack] = useState(1.0);
  const [compressorRelease, setCompressorRelease] = useState(100);
  const [delay, setDelay] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(0.5);
  const [delayFeedback, setDelayFeedback] = useState(0.0);
  const [delayMix, setDelayMix] = useState(0.5);
  const [sid, setSid] = useState(0);
  const [jobId, setJobId] = usePersistentJobId("batch");
  const { job, error, setError } = useJob(jobId);
  const [busy, setBusy] = useState(false);

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  const loadAvailableModels = useCallback((force = true) => {
    fetchModels(force)
      .then((m) => {
        setModels(m.models);
        setIndexes(m.indexes);
        if (m.models[0]) {
          setPthPath((prev) => prev || m.models[0]);
          setIndexPath((prev) => prev || matchIndex(m.models[0], m.indexes));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAvailableModels(true);
    const onFocus = () => loadAvailableModels(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadAvailableModels]);

  function handleModelSelect(selected: string, idxList = indexes) {
    setPthPath(selected);
    setIndexPath(matchIndex(selected, idxList));
    setSid(0);
  }

  function handleUnloadModel() {
    setPthPath("");
    setIndexPath("");
    setSid(0);
  }

  function loadModels() {
    fetchModels()
      .then((m) => {
        setModels(m.models);
        setIndexes(m.indexes);
      })
      .catch(() => {});
  }

  function resetDefaults() {
    setPitch(0);
    setIndexRate(0.75);
    setVolumeEnvelope(1);
    setProtect(0.5);
    setF0Method("rmvpe");
    setEmbedderModel("contentvec");
    setEmbedderModelCustom("");
    setExportFormat("WAV");
    setSplitAudio(false);
    setF0Autotune(false);
    setF0AutotuneStrength(1);
    setProposedPitch(false);
    setProposedPitchThreshold(155);
    setCleanAudio(false);
    setCleanStrength(0.5);
    setFormantShifting(false);
    setFormantQfrency(1.0);
    setFormantTimbre(1.0);
    setPostProcess(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "files" ? !pthPath : !selectedModels.length) {
      setError(t("Select a voice model."));
      return;
    }
    setBusy(true);
    try {
      const { jobId: id } = await submitJob("/api/inference/batch", {
        pthPath: mode === "files" ? pthPath : selectedModels[0],
        mode,
        inputPath,
        models: selectedModels.map((model) => ({ pthPath: model, indexPath: matchIndex(model, indexes) })),
        indexPath,
        inputFolder,
        outputFolder,
        pitch,
        indexRate,
        volumeEnvelope,
        protect,
        f0Method,
        exportFormat,
        embedderModel,
        ...(embedderModel === "custom" && embedderModelCustom ? { embedderModelCustom } : {}),
        splitAudio,
        f0Autotune,
        f0AutotuneStrength,
        proposedPitch,
        proposedPitchThreshold,
        cleanAudio,
        cleanStrength,
        formantShifting,
        formantQfrency,
        formantTimbre,
        postProcess,
        reverb,
        reverbRoomSize,
        reverbDamping,
        reverbWetGain,
        reverbDryGain,
        reverbWidth,
        reverbFreezeMode,
        pitchShift,
        pitchShiftSemitones,
        limiter,
        limiterThreshold,
        limiterReleaseTime,
        gain,
        gainDb,
        distortion,
        distortionGain,
        chorus,
        chorusRate,
        chorusDepth,
        chorusCenterDelay,
        chorusFeedback,
        chorusMix,
        bitcrush,
        bitcrushBitDepth,
        clipping,
        clippingThreshold,
        compressor,
        compressorThreshold,
        compressorRatio,
        compressorAttack,
        compressorRelease,
        delay,
        delaySeconds,
        delayFeedback,
        delayMix,
        sid: mode === "files" ? sid : 0,
      });
      setJobId(id);
    } catch (err) {
      setError(errMsg(err) || t("Submit failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* 1. Folders & Voice Model Card */}
      <Card>
        <CardHeader
          icon={<Layers size={18} className="text-white" />}
          title={t("Batch Source & Voice Model")}
          description={t(
            "Choose one model for many files, many models for one file, or many models for many files.",
          )}
          action={
            (mode === "files" ? pthPath : selectedModels.length) ? (
              <Badge variant="success" size="sm" dot>
                {t("Ready")}
              </Badge>
            ) : undefined
          }
        />
        <div className="mb-4">
          <label htmlFor="batch-mode" className="text-xs font-medium text-neutral-300">
            {t("Batch mode")}
          </label>
          <CustomSelect
            id="batch-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: "files", label: t("Mode 1: One model, multiple files") },
              { value: "models", label: t("Mode 2: Multiple models, one file") },
              { value: "both", label: t("Mode 3: Multiple models, multiple files") },
            ]}
            description={t(SETTING_HELP.batchMode)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="batch-input-folder" className="text-xs font-medium text-neutral-300">
              {mode === "models" ? t("Input File (server path)") : t("Input Folder (server path)")}
            </label>
            <input
              id="batch-input-folder"
              type="text"
              value={mode === "models" ? inputPath : inputFolder}
              onChange={(e) =>
                mode === "models" ? setInputPath(e.target.value) : setInputFolder(e.target.value)
              }
              className="w-full mt-1 text-xs"
              aria-describedby={`${"batch-input-folder"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.batchInput)} controlId={"batch-input-folder"} />
          </div>
          <div>
            <label htmlFor="batch-output-folder" className="text-xs font-medium text-neutral-300">
              {t("Output Folder (server path)")}
            </label>
            <input
              id="batch-output-folder"
              type="text"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
              className="w-full mt-1 text-xs"
              aria-describedby={`${"batch-output-folder"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.batchOutput)} controlId={"batch-output-folder"} />
          </div>
        </div>
        <div className="mt-3">
          {mode === "files" ? (
            <VoiceModelField
              models={models}
              selectedModel={pthPath}
              indexes={indexes}
              indexPath={indexPath}
              indexSelectId="batch-index-file"
              onSelect={handleModelSelect}
              onUnload={handleUnloadModel}
              onRefresh={loadModels}
              onIndexChange={setIndexPath}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-neutral-300">{t("Select voice models")}</p>
              {models.map((model) => (
                <label key={model} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedModels.includes(model)}
                    onChange={(e) =>
                      setSelectedModels((current) =>
                        e.target.checked ? [...current, model] : current.filter((item) => item !== model),
                      )
                    }
                  />
                  {model}
                </label>
              ))}
              <p className="text-xs text-neutral-400">
                {t("Each model uses its matching index and writes to its own output folder.")}
              </p>
            </div>
          )}
        </div>
      </Card>

      <ConversionParameters
        idPrefix="batch"
        onReset={resetDefaults}
        values={{
          pitch,
          indexRate,
          volumeEnvelope,
          protect,
          f0Method,
          embedderModel,
          embedderModelCustom,
          exportFormat,
          splitAudio,
          f0Autotune,
          f0AutotuneStrength,
          proposedPitch,
          proposedPitchThreshold,
          cleanAudio,
          cleanStrength,
          formantShifting,
          formantQfrency,
          formantTimbre,
          postProcess,
          reverb,
          reverbRoomSize,
          reverbDamping,
          reverbWetGain,
          reverbDryGain,
          reverbWidth,
          reverbFreezeMode,
          pitchShift,
          pitchShiftSemitones,
          delay,
          delaySeconds,
          delayFeedback,
          delayMix,
          compressor,
          compressorThreshold,
          compressorRatio,
          compressorAttack,
          compressorRelease,
          limiter,
          limiterThreshold,
          limiterReleaseTime,
          chorus,
          chorusRate,
          chorusDepth,
          chorusCenterDelay,
          chorusFeedback,
          chorusMix,
          bitcrush,
          bitcrushBitDepth,
          clipping,
          clippingThreshold,
          distortion,
          distortionGain,
          gain,
          gainDb,
        }}
        setters={{
          pitch: setPitch,
          indexRate: setIndexRate,
          volumeEnvelope: setVolumeEnvelope,
          protect: setProtect,
          f0Method: setF0Method,
          embedderModel: setEmbedderModel,
          embedderModelCustom: setEmbedderModelCustom,
          exportFormat: setExportFormat,
          splitAudio: setSplitAudio,
          f0Autotune: setF0Autotune,
          f0AutotuneStrength: setF0AutotuneStrength,
          proposedPitch: setProposedPitch,
          proposedPitchThreshold: setProposedPitchThreshold,
          cleanAudio: setCleanAudio,
          cleanStrength: setCleanStrength,
          formantShifting: setFormantShifting,
          formantQfrency: setFormantQfrency,
          formantTimbre: setFormantTimbre,
          postProcess: setPostProcess,
          reverb: setReverb,
          reverbRoomSize: setReverbRoomSize,
          reverbDamping: setReverbDamping,
          reverbWetGain: setReverbWetGain,
          reverbDryGain: setReverbDryGain,
          reverbWidth: setReverbWidth,
          reverbFreezeMode: setReverbFreezeMode,
          pitchShift: setPitchShift,
          pitchShiftSemitones: setPitchShiftSemitones,
          delay: setDelay,
          delaySeconds: setDelaySeconds,
          delayFeedback: setDelayFeedback,
          delayMix: setDelayMix,
          compressor: setCompressor,
          compressorThreshold: setCompressorThreshold,
          compressorRatio: setCompressorRatio,
          compressorAttack: setCompressorAttack,
          compressorRelease: setCompressorRelease,
          limiter: setLimiter,
          limiterThreshold: setLimiterThreshold,
          limiterReleaseTime: setLimiterReleaseTime,
          chorus: setChorus,
          chorusRate: setChorusRate,
          chorusDepth: setChorusDepth,
          chorusCenterDelay: setChorusCenterDelay,
          chorusFeedback: setChorusFeedback,
          chorusMix: setChorusMix,
          bitcrush: setBitcrush,
          bitcrushBitDepth: setBitcrushBitDepth,
          clipping: setClipping,
          clippingThreshold: setClippingThreshold,
          distortion: setDistortion,
          distortionGain: setDistortionGain,
          gain: setGain,
          gainDb: setGainDb,
        }}
      />

      {/* 3. Action & Batch Output Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                busy ||
                (mode === "files" ? !pthPath : !selectedModels.length) ||
                (mode === "models" ? !inputPath : !inputFolder)
              }
              icon={<Wand2 size={16} />}
            >
              {busy ? t("Converting Batch…") : t("Convert Batch")}
            </Button>

            {job && (job.status === "running" || job.status === "queued") && (
              <Button
                variant="danger"
                onClick={() => stopJob(job.id).catch((e) => setError(errMsg(e)))}
                icon={<StopCircle size={13} />}
              >
                {t("Cancel")}
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
                    : job.status === "error"
                      ? t("Failed")
                      : t("Queued")}
              </Badge>
            )}
          </div>
        </div>

        {/* Running State Live Progress Bar */}
        {job && (job.status === "running" || job.status === "queued") && (
          <div
            className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-3 animate-in fade-in duration-200"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="font-medium">{t("Batch Conversion in Progress…")}</span>
              <span className="text-neutral-400 capitalize">{job.status}</span>
            </div>
            <div
              className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
              aria-label={t("Batch Conversion in Progress…")}
            >
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${job.progress ?? 0}%` }}
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] text-neutral-400 pt-1 break-all">
              <span>
                {t("Input:")} {mode === "models" ? inputPath : inputFolder}
              </span>
              <span>
                {t("Output:")} {outputFolder}
              </span>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="error" className="animate-in fade-in duration-200">
            {error}
          </Alert>
        )}

        {job && job.status === "error" && !error && (
          <JobError
            message={job.error || t("Batch conversion failed.")}
            details={job.errorDetails}
            logs={job.logs}
            jobId={job.id}
            className="animate-in fade-in duration-200"
          />
        )}

        {job && job.status === "done" && (
          <div className="space-y-4 pt-3 border-t border-white/5 animate-in fade-in duration-200">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white m-0">{t("Batch Conversion Complete")}</h3>
                <p className="text-xs text-neutral-400 m-0 mt-0.5">
                  {t("All selected files and voice models have been processed.")}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-xs text-neutral-400 block">{t("Saved Output Directory")}</span>
              <span className="text-xs text-neutral-200 font-medium select-all block break-all">
                {outputFolder}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1 flex-wrap">
              <Link
                href={`/inference?model=${encodeURIComponent(pthPath)}`}
                className="cta h-9 px-4 rounded-xl text-xs font-medium flex items-center gap-1.5"
              >
                <span>{t("Test in Single Inference")}</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}
      </Card>
    </form>
  );
}
