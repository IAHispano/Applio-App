"use client";

import {
  ArrowRight,
  CheckCircle2,
  Layers,
  RotateCcw,
  Sliders,
  Sparkles,
  StopCircle,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Disclosure,
  ToggleField,
  VoiceModelField,
} from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { errMsg, fetchJob, fetchModels, type Job, pollJob, stopJob, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { usePersistentJobId } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";

const F0 = ["crepe", "crepe-tiny", "rmvpe", "fcpe"];
const FORMATS = ["WAV", "MP3", "FLAC", "OGG", "M4A"];

export default function BatchForm() {
  const [models, setModels] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<string[]>([]);
  const { t } = useI18n();
  const [pthPath, setPthPath] = useState("");
  const [indexPath, setIndexPath] = useState("");
  const [inputFolder, setInputFolder] = useState("assets/audios");
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
  // Formant shifting (parity with Gradio batch tab)
  const [formantShifting, setFormantShifting] = useState(false);
  const [formantQfrency, setFormantQfrency] = useState(1.0);
  const [formantTimbre, setFormantTimbre] = useState(1.0);
  // Post-process FX rack (parity with Gradio batch tab; backend already supports it)
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
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let stop = () => {};
    fetchJob(jobId)
      .then(({ job: j }) => {
        setJob(j);
        if (j.status !== "done" && j.status !== "error") {
          stop = pollJob(jobId, setJob);
        }
      })
      .catch((e) => setError(errMsg(e)));
    return () => stop();
  }, [jobId]);

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  useEffect(() => {
    fetchModels()
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
    if (!pthPath) {
      setError(t("Select a voice model."));
      return;
    }
    setBusy(true);
    try {
      const { jobId: id } = await submitJob("/api/inference/batch", {
        pthPath,
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
        sid,
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
          description={t("Converts every supported audio file in the input folder (server-side paths).")}
          action={
            pthPath ? (
              <Badge variant="success" size="sm" dot>
                {t("Ready")}
              </Badge>
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="batch-input-folder" className="text-xs font-medium text-neutral-300">
              {t("Input Folder (server path)")}
            </label>
            <input
              id="batch-input-folder"
              type="text"
              value={inputFolder}
              onChange={(e) => setInputFolder(e.target.value)}
              className="w-full mt-1 text-xs"
            />
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
            />
          </div>
        </div>
        <div className="mt-3">
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
        </div>
      </Card>

      {/* 2. Conversion Parameters Card */}
      <Card>
        <CardHeader
          icon={<Sliders size={18} className="text-white" />}
          title={t("Conversion Parameters")}
          description={t(
            "Fine-tune pitch, timbre retrieval, voiceless consonant protection, and synthesis algorithms.",
          )}
          action={
            <button
              type="button"
              onClick={resetDefaults}
              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} className="text-white" />
              <span>{t("Reset Defaults")}</span>
            </button>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          <SliderField
            id="batch-pitch"
            label={t("Pitch")}
            value={pitch}
            min={-24}
            max={24}
            step={1}
            unit="st"
            formatValue={(v) => `${v > 0 ? `+${v}` : v} semitones`}
            onChange={setPitch}
          />
          <SliderField
            id="batch-index-rate"
            label={t("Search Feature Ratio")}
            value={indexRate}
            min={0}
            max={1}
            step={0.05}
            formatValue={(v) => `${v}`}
            onChange={setIndexRate}
          />
          <SliderField
            id="batch-volume-envelope"
            label={t("Volume Envelope")}
            value={volumeEnvelope}
            min={0}
            max={1}
            step={0.05}
            formatValue={(v) => `${v}`}
            onChange={setVolumeEnvelope}
          />
          <SliderField
            id="batch-protect"
            label={t("Protect Voiceless Consonants")}
            value={protect}
            min={0}
            max={0.5}
            step={0.01}
            formatValue={(v) => `${v}`}
            onChange={setProtect}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-4 border-t border-white/10">
          <div>
            <label htmlFor="batch-f0-method" className="text-xs font-medium text-neutral-300">
              {t("Pitch Extraction Algorithm")}
            </label>
            <CustomSelect
              id="batch-f0-method"
              value={f0Method}
              onChange={(e) => setF0Method(e.target.value)}
              className="w-full mt-1"
            >
              {F0.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="batch-embedder-model" className="text-xs font-medium text-neutral-300">
              {t("Speech Embedder Model")}
            </label>
            <CustomSelect
              id="batch-embedder-model"
              value={embedderModel}
              onChange={(e) => setEmbedderModel(e.target.value)}
              className="w-full mt-1"
            >
              {[
                "contentvec",
                "spin",
                "spin-v2",
                "chinese-hubert-base",
                "japanese-hubert-base",
                "korean-hubert-base",
                "custom",
              ].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
          {speakers.length > 1 && (
            <div>
              <label htmlFor="batch-speaker-id" className="text-xs font-medium text-neutral-300">
                {t("Speaker ID")}
              </label>
              <CustomSelect
                id="batch-speaker-id"
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
          <div>
            <label htmlFor="batch-export-format" className="text-xs font-medium text-neutral-300">
              {t("Output Audio Format")}
            </label>
            <CustomSelect
              id="batch-export-format"
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
          <div className="mt-3">
            <label htmlFor="batch-embedder-custom" className="text-xs font-medium text-neutral-300">
              {t("Select Custom Embedder")}
            </label>
            <input
              id="batch-embedder-custom"
              type="text"
              value={embedderModelCustom}
              onChange={(e) => setEmbedderModelCustom(e.target.value)}
              placeholder="rvc/models/embedders/embedders_custom/my-embedder"
              className="w-full mt-1 text-xs"
            />
          </div>
        )}

        <div className="space-y-3 pt-3">
          <Disclosure title={t("Advanced Pitch & Audio Cleanup")}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ToggleField
                id="batch-split-audio"
                label={t("Split in Chunks")}
                checked={splitAudio}
                onChange={setSplitAudio}
              />
              <ToggleField
                id="batch-f0-autotune"
                label={t("Autotune")}
                checked={f0Autotune}
                onChange={setF0Autotune}
              />
              <ToggleField
                id="batch-proposed-pitch"
                label={t("Proposed Pitch")}
                checked={proposedPitch}
                onChange={setProposedPitch}
              />
              <ToggleField
                id="batch-clean-audio"
                label={t("Clean Audio")}
                checked={cleanAudio}
                onChange={setCleanAudio}
              />
            </div>
            {(f0Autotune || proposedPitch || cleanAudio) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                {f0Autotune && (
                  <SliderField
                    id="batch-autotune-strength"
                    label={t("Autotune Strength")}
                    value={f0AutotuneStrength}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setF0AutotuneStrength}
                  />
                )}
                {proposedPitch && (
                  <SliderField
                    id="batch-proposed-threshold"
                    label={t("Proposed Pitch Threshold")}
                    value={proposedPitchThreshold}
                    min={50}
                    max={1200}
                    step={1}
                    unit="Hz"
                    onChange={setProposedPitchThreshold}
                  />
                )}
                {cleanAudio && (
                  <SliderField
                    id="batch-clean-strength"
                    label={t("Clean Strength")}
                    value={cleanStrength}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setCleanStrength}
                  />
                )}
              </div>
            )}
          </Disclosure>

          <Disclosure title={t("Formant Shifting")} icon={<Sparkles size={15} />}>
            <ToggleField
              id="batch-formant-shifting"
              label={t("Enable Formant Shifting")}
              checked={formantShifting}
              onChange={setFormantShifting}
            />
            {formantShifting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <SliderField
                  id="batch-formant-qfrency"
                  label={t("Quefrency for formant shifting")}
                  value={formantQfrency}
                  min={0}
                  max={16}
                  step={0.1}
                  onChange={setFormantQfrency}
                />
                <SliderField
                  id="batch-formant-timbre"
                  label={t("Timbre for formant shifting")}
                  value={formantTimbre}
                  min={0}
                  max={16}
                  step={0.1}
                  onChange={setFormantTimbre}
                />
              </div>
            )}
          </Disclosure>

          <Disclosure title={t("Post-Process")} open={postProcess} onToggle={setPostProcess}>
            {postProcess && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <ToggleField id="batch-reverb" label={t("Reverb")} checked={reverb} onChange={setReverb} />
                <ToggleField
                  id="batch-pitch-shift"
                  label={t("Pitch Shift")}
                  checked={pitchShift}
                  onChange={setPitchShift}
                />
                <ToggleField
                  id="batch-limiter"
                  label={t("Limiter")}
                  checked={limiter}
                  onChange={setLimiter}
                />
                <ToggleField id="batch-gain" label={t("Gain")} checked={gain} onChange={setGain} />
                <ToggleField
                  id="batch-distortion"
                  label={t("Distortion")}
                  checked={distortion}
                  onChange={setDistortion}
                />
                <ToggleField id="batch-chorus" label={t("Chorus")} checked={chorus} onChange={setChorus} />
                <ToggleField
                  id="batch-bitcrush"
                  label={t("Bitcrush")}
                  checked={bitcrush}
                  onChange={setBitcrush}
                />
                <ToggleField
                  id="batch-clipping"
                  label={t("Clipping")}
                  checked={clipping}
                  onChange={setClipping}
                />
                <ToggleField
                  id="batch-compressor"
                  label={t("Compressor")}
                  checked={compressor}
                  onChange={setCompressor}
                />
                <ToggleField id="batch-delay" label={t("Delay")} checked={delay} onChange={setDelay} />
              </div>
            )}
            {postProcess && reverb && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <SliderField
                  id="batch-reverb-room"
                  label={t("Reverb Room Size")}
                  value={reverbRoomSize}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbRoomSize}
                />
                <SliderField
                  id="batch-reverb-damping"
                  label={t("Reverb Damping")}
                  value={reverbDamping}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbDamping}
                />
                <SliderField
                  id="batch-reverb-wet"
                  label={t("Reverb Wet Gain")}
                  value={reverbWetGain}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbWetGain}
                />
                <SliderField
                  id="batch-reverb-dry"
                  label={t("Reverb Dry Gain")}
                  value={reverbDryGain}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbDryGain}
                />
                <SliderField
                  id="batch-reverb-width"
                  label={t("Reverb Width")}
                  value={reverbWidth}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbWidth}
                />
                <SliderField
                  id="batch-reverb-freeze"
                  label={t("Reverb Freeze Mode")}
                  value={reverbFreezeMode}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setReverbFreezeMode}
                />
              </div>
            )}
            {postProcess && pitchShift && (
              <div className="pt-2">
                <SliderField
                  id="batch-pitch-semitones"
                  label={t("Pitch Shift Semitones")}
                  value={pitchShiftSemitones}
                  min={-12}
                  max={12}
                  step={1}
                  onChange={setPitchShiftSemitones}
                />
              </div>
            )}
            {postProcess && limiter && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <SliderField
                  id="batch-limiter-thresh"
                  label={t("Limiter Threshold dB")}
                  value={limiterThreshold}
                  min={-60}
                  max={0}
                  step={0.5}
                  unit="dB"
                  onChange={setLimiterThreshold}
                />
                <SliderField
                  id="batch-limiter-release"
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
            {postProcess && gain && (
              <div className="pt-2">
                <SliderField
                  id="batch-gain-db"
                  label={t("Gain dB")}
                  value={gainDb}
                  min={-60}
                  max={60}
                  step={0.5}
                  unit="dB"
                  onChange={setGainDb}
                />
              </div>
            )}
            {postProcess && distortion && (
              <div className="pt-2">
                <SliderField
                  id="batch-dist-gain"
                  label={t("Distortion Gain")}
                  value={distortionGain}
                  min={-60}
                  max={60}
                  step={1}
                  unit="dB"
                  onChange={setDistortionGain}
                />
              </div>
            )}
            {postProcess && chorus && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <SliderField
                  id="batch-chorus-rate"
                  label={t("Chorus Rate Hz")}
                  value={chorusRate}
                  min={0.1}
                  max={100}
                  step={0.1}
                  unit="Hz"
                  onChange={setChorusRate}
                />
                <SliderField
                  id="batch-chorus-depth"
                  label={t("Chorus Depth")}
                  value={chorusDepth}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={setChorusDepth}
                />
                <SliderField
                  id="batch-chorus-center"
                  label={t("Chorus Center Delay ms")}
                  value={chorusCenterDelay}
                  min={7}
                  max={8}
                  step={0.1}
                  unit="ms"
                  onChange={setChorusCenterDelay}
                />
                <SliderField
                  id="batch-chorus-feedback"
                  label={t("Chorus Feedback")}
                  value={chorusFeedback}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setChorusFeedback}
                />
                <SliderField
                  id="batch-chorus-mix"
                  label={t("Chorus Mix")}
                  value={chorusMix}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setChorusMix}
                />
              </div>
            )}
            {postProcess && bitcrush && (
              <div className="pt-2">
                <SliderField
                  id="batch-bitcrush-depth"
                  label={t("Bitcrush Bit Depth")}
                  value={bitcrushBitDepth}
                  min={1}
                  max={32}
                  step={1}
                  onChange={setBitcrushBitDepth}
                />
              </div>
            )}
            {postProcess && clipping && (
              <div className="pt-2">
                <SliderField
                  id="batch-clip-thresh"
                  label={t("Clipping Threshold")}
                  value={clippingThreshold}
                  min={-60}
                  max={0}
                  step={0.5}
                  unit="dB"
                  onChange={setClippingThreshold}
                />
              </div>
            )}
            {postProcess && compressor && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <SliderField
                  id="batch-comp-thresh"
                  label={t("Compressor Threshold dB")}
                  value={compressorThreshold}
                  min={-60}
                  max={0}
                  step={1}
                  unit="dB"
                  onChange={setCompressorThreshold}
                />
                <SliderField
                  id="batch-comp-ratio"
                  label={t("Compressor Ratio")}
                  value={compressorRatio}
                  min={1}
                  max={20}
                  step={0.5}
                  onChange={setCompressorRatio}
                />
                <SliderField
                  id="batch-comp-attack"
                  label={t("Compressor Attack ms")}
                  value={compressorAttack}
                  min={0}
                  max={100}
                  step={1}
                  unit="ms"
                  onChange={setCompressorAttack}
                />
                <SliderField
                  id="batch-comp-release"
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
            {postProcess && delay && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <SliderField
                  id="batch-delay-time"
                  label={t("Delay Seconds")}
                  value={delaySeconds}
                  min={0}
                  max={5}
                  step={0.05}
                  unit="s"
                  onChange={setDelaySeconds}
                />
                <SliderField
                  id="batch-delay-feedback"
                  label={t("Delay Feedback")}
                  value={delayFeedback}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setDelayFeedback}
                />
                <SliderField
                  id="batch-delay-mix"
                  label={t("Delay Mix")}
                  value={delayMix}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setDelayMix}
                />
              </div>
            )}
          </Disclosure>
        </div>
      </Card>

      {/* 3. Action & Batch Output Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !pthPath || !inputFolder} icon={<Wand2 size={16} />}>
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
              aria-label={t("Batch Conversion in Progress…")}
            >
              <div className="h-full bg-white rounded-full transition-all duration-300 animate-pulse w-3/4" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] text-neutral-400 pt-1 break-all">
              <span>
                {t("Input:")} {inputFolder}
              </span>
              <span>
                {t("Output:")} {outputFolder}
              </span>
            </div>
          </div>
        )}

        {(error || (job && job.status === "error")) && (
          <Alert variant="error" className="animate-in fade-in duration-200">
            {error || job?.error || t("Batch conversion failed.")}
          </Alert>
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
                  {t("All audio files in the folder have been converted with the selected voice timbre.")}
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
