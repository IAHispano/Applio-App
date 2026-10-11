"use client";

import { Activity, Layers, Sliders, Sparkles } from "lucide-react";
import {
  Card,
  CardHeader,
  Disclosure,
  EmbedderSelect,
  PitchMethodSelect,
  ToggleField,
} from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

const FORMATS = ["WAV", "MP3", "FLAC", "OGG", "M4A"];

export interface ConversionParameterValues {
  pitch: number;
  indexRate: number;
  volumeEnvelope: number;
  protect: number;
  f0Method: string;
  embedderModel: string;
  embedderModelCustom: string;
  exportFormat: string;
  splitAudio: boolean;
  f0Autotune: boolean;
  f0AutotuneStrength: number;
  proposedPitch: boolean;
  proposedPitchThreshold: number;
  cleanAudio: boolean;
  cleanStrength: number;
  formantShifting: boolean;
  formantQfrency: number;
  formantTimbre: number;
  postProcess: boolean;
  reverb: boolean;
  reverbRoomSize: number;
  reverbDamping: number;
  reverbWetGain: number;
  reverbDryGain: number;
  reverbWidth: number;
  reverbFreezeMode: number;
  pitchShift: boolean;
  pitchShiftSemitones: number;
  delay: boolean;
  delaySeconds: number;
  delayFeedback: number;
  delayMix: number;
  compressor: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
  limiter: boolean;
  limiterThreshold: number;
  limiterReleaseTime: number;
  chorus: boolean;
  chorusRate: number;
  chorusDepth: number;
  chorusCenterDelay: number;
  chorusFeedback: number;
  chorusMix: number;
  bitcrush: boolean;
  bitcrushBitDepth: number;
  clipping: boolean;
  clippingThreshold: number;
  distortion: boolean;
  distortionGain: number;
  gain: boolean;
  gainDb: number;
}

type ConversionParameterSetters = {
  [K in keyof ConversionParameterValues]: (value: ConversionParameterValues[K]) => void;
};

interface ConversionParametersProps {
  values: ConversionParameterValues;
  setters: ConversionParameterSetters;
  idPrefix: string;
  onReset: () => void;
  /** Optional control rendered next to the reset button (e.g. per-model target picker). */
  targetSelect?: React.ReactNode;
}

export default function ConversionParameters({
  values,
  setters,
  idPrefix,
  onReset,
  targetSelect,
}: ConversionParametersProps) {
  const { t } = useI18n();
  const {
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
  } = values;
  const {
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
  } = setters;
  return (
    <Card>
      <CardHeader
        icon={<Sliders size={18} className="text-white" />}
        title={t("Conversion Parameters")}
        description={t("Fine-tune pitch shifting, index feature retrieval, and audio envelope response.")}
        action={
          <div className="flex items-center gap-2">
            {targetSelect}
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              {t("Reset defaults")}
            </button>
          </div>
        }
      />

      {/* 4 Core Voice Sliders (2x2 Grid on md, 4 across on xl/fullscreen) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        {/* Pitch */}
        <div>
          <SliderField
            id={`${idPrefix}-pitch`}
            label={t("Pitch")}
            value={pitch}
            min={-24}
            max={24}
            step={1}
            unit="st"
            formatValue={(v) => `${v}`}
            onChange={setPitch}
            description={t("Transpose pitch in semitones (-24 = lower, +24 = higher)")}
          />
        </div>

        {/* Search Feature Ratio */}
        <div>
          <SliderField
            id={`${idPrefix}-index-rate`}
            label={t("Search Feature Ratio")}
            value={indexRate}
            min={0}
            max={1}
            step={0.05}
            formatValue={(v) => `${v}`}
            onChange={setIndexRate}
            description={t(
              "Blend of the index voice match (0 = model only, higher = closer timbre, more artifacts if the index is noisy)",
            )}
          />
        </div>

        {/* Volume Envelope */}
        <div>
          <SliderField
            id={`${idPrefix}-volume-envelope`}
            label={t("Volume Envelope")}
            value={volumeEnvelope}
            min={0}
            max={1}
            step={0.05}
            formatValue={(v) => `${v}`}
            onChange={setVolumeEnvelope}
            description={t(SETTING_HELP.envelope)}
          />
        </div>

        {/* Consonant Protection */}
        <div>
          <SliderField
            id={`${idPrefix}-protect`}
            label={t("Protect Voiceless Consonants")}
            value={protect}
            min={0}
            max={0.5}
            step={0.01}
            formatValue={(v) => `${v}`}
            onChange={setProtect}
            description={t(SETTING_HELP.protect)}
          />
        </div>
      </div>

      {/* Algorithm, Embedder & Export Format Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/10">
        <PitchMethodSelect
          id={`${idPrefix}-f0-method-select`}
          label={t("Pitch Extraction Algorithm")}
          value={f0Method}
          onChange={setF0Method}
        />

        <EmbedderSelect
          id={`${idPrefix}-embedder-model-select`}
          label={t("Embedder Model")}
          value={embedderModel}
          onChange={setEmbedderModel}
        />

        <div>
          <label
            htmlFor={`${idPrefix}-export-format-select`}
            className="text-xs font-medium text-neutral-300"
          >
            {t("Output Audio Format")}
          </label>
          <CustomSelect
            id={`${idPrefix}-export-format-select`}
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
            className="w-full mt-1"
            description={t(SETTING_HELP.export)}
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
          <label
            htmlFor={`${idPrefix}-embedder-custom-input`}
            className="text-xs font-medium text-neutral-300"
          >
            {t("Select Custom Embedder")}
          </label>
          <input
            id={`${idPrefix}-embedder-custom-input`}
            type="text"
            value={embedderModelCustom}
            onChange={(e) => setEmbedderModelCustom(e.target.value)}
            placeholder="rvc/models/embedders/embedders_custom/my-embedder"
            className="w-full mt-1"
            aria-describedby={`${`${idPrefix}-embedder-custom-input`}-help`}
          />
          <SettingHelp
            text={t(SETTING_HELP.customEmbedder)}
            controlId={`${idPrefix}-embedder-custom-input`}
          />
        </div>
      )}

      {/* Collapsible Accordions: Advanced Tuning, Formant, Audio FX */}
      <div className="space-y-3 pt-2">
        {/* Advanced Pitch & Tuning Accordion */}
        <Disclosure
          title={t("Advanced Pitch & Audio Cleanup")}
          icon={<Activity size={15} />}
          description={
            <>
              {t(SETTING_HELP.autotune)} {t(SETTING_HELP.clean)}
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <ToggleField
              id={`${idPrefix}-split-audio`}
              label={t("Split Audio")}
              checked={splitAudio}
              onChange={setSplitAudio}
              description={t(SETTING_HELP.split)}
            />
            <ToggleField
              id={`${idPrefix}-autotune`}
              label={t("Autotune")}
              checked={f0Autotune}
              onChange={setF0Autotune}
              description={t(SETTING_HELP.autotune)}
            />
            <ToggleField
              id={`${idPrefix}-clean-audio`}
              label={t("Clean Audio")}
              checked={cleanAudio}
              onChange={setCleanAudio}
              description={t(SETTING_HELP.clean)}
            />
            <ToggleField
              id={`${idPrefix}-proposed-pitch`}
              label={t("Proposed Pitch")}
              checked={proposedPitch}
              onChange={setProposedPitch}
              description={t(SETTING_HELP.proposed)}
            />
          </div>

          {(f0Autotune || cleanAudio || proposedPitch) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {f0Autotune && (
                <SliderField
                  id={`${idPrefix}-autotune-strength`}
                  label={t("Autotune Strength")}
                  value={f0AutotuneStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setF0AutotuneStrength}
                  description={t(SETTING_HELP.autotuneStrength)}
                />
              )}
              {cleanAudio && (
                <SliderField
                  id={`${idPrefix}-clean-strength`}
                  label={t("Clean Strength")}
                  value={cleanStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setCleanStrength}
                  description={t(SETTING_HELP.cleanStrength)}
                />
              )}
              {proposedPitch && (
                <SliderField
                  id={`${idPrefix}-pitch-thresh`}
                  label={t("Proposed Pitch Threshold")}
                  value={proposedPitchThreshold}
                  min={50}
                  max={1200}
                  step={1}
                  unit="Hz"
                  onChange={setProposedPitchThreshold}
                  description={t(SETTING_HELP.proposedThreshold)}
                />
              )}
            </div>
          )}
        </Disclosure>

        {/* Formant Shifting Accordion */}
        <Disclosure
          title={t("Formant Shifting")}
          icon={<Sparkles size={15} />}
          description={t(SETTING_HELP.formant)}
        >
          <ToggleField
            id={`${idPrefix}-formant-shifting`}
            label={t("Enable Formant Shifting")}
            checked={formantShifting}
            onChange={setFormantShifting}
            description={t(SETTING_HELP.formant)}
          />

          {formantShifting && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <SliderField
                id={`${idPrefix}-formant-qfrency`}
                label={t("Quefrency for formant shifting")}
                value={formantQfrency}
                min={0}
                max={16.0}
                step={0.1}
                onChange={setFormantQfrency}
                description={t("Modifies formants width and spectral envelope")}
              />
              <SliderField
                id={`${idPrefix}-formant-timbre`}
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
          description={t(SETTING_HELP.postProcess)}
        >
          {postProcess && (
            <div className="space-y-4 pt-2">
              {/* Reverb */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={reverb}
                    onChange={(e) => setReverb(e.target.checked)}
                    aria-describedby={`${`${idPrefix}-reverb-enabled`}-help`}
                    id={`${idPrefix}-reverb-enabled`}
                  />
                  <span>{t("Reverb")}</span>
                </label>
                <SettingHelp text={t(SETTING_HELP.reverb)} controlId={`${idPrefix}-reverb-enabled`} />
                {reverb && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <SliderField
                      id={`${idPrefix}-reverb-room`}
                      label={t("Reverb Room Size")}
                      value={reverbRoomSize}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbRoomSize}
                      description={t(SETTING_HELP.room)}
                    />
                    <SliderField
                      id={`${idPrefix}-reverb-damping`}
                      label={t("Reverb Damping")}
                      value={reverbDamping}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbDamping}
                      description={t(SETTING_HELP.damping)}
                    />
                    <SliderField
                      id={`${idPrefix}-reverb-wet`}
                      label={t("Reverb Wet Gain")}
                      value={reverbWetGain}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbWetGain}
                      description={t(SETTING_HELP.wet)}
                    />
                    <SliderField
                      id={`${idPrefix}-reverb-dry`}
                      label={t("Reverb Dry Gain")}
                      value={reverbDryGain}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbDryGain}
                      description={t(SETTING_HELP.dry)}
                    />
                    <SliderField
                      id={`${idPrefix}-reverb-width`}
                      label={t("Reverb Width")}
                      value={reverbWidth}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbWidth}
                      description={t(SETTING_HELP.width)}
                    />
                    <SliderField
                      id={`${idPrefix}-reverb-freeze`}
                      label={t("Reverb Freeze Mode")}
                      value={reverbFreezeMode}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setReverbFreezeMode}
                      description={t(SETTING_HELP.freeze)}
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
                    aria-describedby={`${`${idPrefix}-pitchShift-enabled`}-help`}
                    id={`${idPrefix}-pitchShift-enabled`}
                  />
                  <span>{t("Pitch Shift")}</span>
                </label>
                <SettingHelp text={t(SETTING_HELP.pitchShift)} controlId={`${idPrefix}-pitchShift-enabled`} />
                {pitchShift && (
                  <SliderField
                    id={`${idPrefix}-pitch-semitones`}
                    label={t("Pitch Shift Semitones")}
                    value={pitchShiftSemitones}
                    min={-12}
                    max={12}
                    step={1}
                    onChange={setPitchShiftSemitones}
                    description={t(SETTING_HELP.pitchShiftAmount)}
                  />
                )}
              </div>

              {/* Delay */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={delay}
                    onChange={(e) => setDelay(e.target.checked)}
                    aria-describedby={`${`${idPrefix}-delay-enabled`}-help`}
                    id={`${idPrefix}-delay-enabled`}
                  />
                  <span>{t("Delay")}</span>
                </label>
                <SettingHelp text={t(SETTING_HELP.delay)} controlId={`${idPrefix}-delay-enabled`} />
                {delay && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SliderField
                      id={`${idPrefix}-delay-time`}
                      label={t("Delay Seconds")}
                      value={delaySeconds}
                      min={0}
                      max={5.0}
                      step={0.05}
                      unit="s"
                      onChange={setDelaySeconds}
                      description={t(SETTING_HELP.delayTime)}
                    />
                    <SliderField
                      id={`${idPrefix}-delay-feedback`}
                      label={t("Delay Feedback")}
                      value={delayFeedback}
                      min={0}
                      max={1.0}
                      step={0.05}
                      onChange={setDelayFeedback}
                      description={t(SETTING_HELP.feedback)}
                    />
                    <SliderField
                      id={`${idPrefix}-delay-mix`}
                      label={t("Delay Mix")}
                      value={delayMix}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setDelayMix}
                      description={t(SETTING_HELP.mix)}
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
                      aria-describedby={`${`${idPrefix}-compressor-enabled`}-help`}
                      id={`${idPrefix}-compressor-enabled`}
                    />
                    <span>{t("Compressor")}</span>
                  </label>
                  <SettingHelp
                    text={t(SETTING_HELP.compressor)}
                    controlId={`${idPrefix}-compressor-enabled`}
                  />
                  {compressor && (
                    <div className="space-y-2">
                      <SliderField
                        id={`${idPrefix}-comp-thresh`}
                        label={t("Compressor Threshold dB")}
                        value={compressorThreshold}
                        min={-60}
                        max={0}
                        step={1}
                        unit="dB"
                        onChange={setCompressorThreshold}
                        description={t(SETTING_HELP.compressorThreshold)}
                      />
                      <SliderField
                        id={`${idPrefix}-comp-ratio`}
                        label={t("Compressor Ratio")}
                        value={compressorRatio}
                        min={1}
                        max={20}
                        step={0.5}
                        formatValue={(v) => `${v}:1`}
                        onChange={setCompressorRatio}
                        description={t(SETTING_HELP.compressorRatio)}
                      />
                      <SliderField
                        id={`${idPrefix}-comp-attack`}
                        label={t("Compressor Attack ms")}
                        value={compressorAttack}
                        min={0}
                        max={100}
                        step={1}
                        unit="ms"
                        onChange={setCompressorAttack}
                        description={t(SETTING_HELP.compressorAttack)}
                      />
                      <SliderField
                        id={`${idPrefix}-comp-release`}
                        label={t("Compressor Release ms")}
                        value={compressorRelease}
                        min={0.01}
                        max={100}
                        step={0.5}
                        unit="ms"
                        onChange={setCompressorRelease}
                        description={t(SETTING_HELP.compressorRelease)}
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
                      aria-describedby={`${`${idPrefix}-limiter-enabled`}-help`}
                      id={`${idPrefix}-limiter-enabled`}
                    />
                    <span>{t("Limiter")}</span>
                  </label>
                  <SettingHelp text={t(SETTING_HELP.limiter)} controlId={`${idPrefix}-limiter-enabled`} />
                  {limiter && (
                    <div className="space-y-2">
                      <SliderField
                        id={`${idPrefix}-limiter-ceil`}
                        label={t("Limiter Threshold dB")}
                        value={limiterThreshold}
                        min={-60}
                        max={0}
                        step={0.5}
                        unit="dB"
                        onChange={setLimiterThreshold}
                        description={t(SETTING_HELP.limiterThreshold)}
                      />
                      <SliderField
                        id={`${idPrefix}-limiter-release`}
                        label={t("Limiter Release Time")}
                        value={limiterReleaseTime}
                        min={0.01}
                        max={1}
                        step={0.01}
                        unit="s"
                        onChange={setLimiterReleaseTime}
                        description={t(SETTING_HELP.limiterRelease)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Chorus, Distortion & Gain */}
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input
                      type="checkbox"
                      checked={chorus}
                      onChange={(e) => setChorus(e.target.checked)}
                      aria-describedby={`${`${idPrefix}-chorus-enabled`}-help`}
                      id={`${idPrefix}-chorus-enabled`}
                    />
                    <span>{t("Chorus")}</span>
                  </label>
                  <SettingHelp text={t(SETTING_HELP.chorus)} controlId={`${idPrefix}-chorus-enabled`} />
                  {chorus && (
                    <div className="space-y-2">
                      <SliderField
                        id={`${idPrefix}-chorus-rate`}
                        label={t("Chorus Rate Hz")}
                        value={chorusRate}
                        min={0}
                        max={100}
                        step={0.1}
                        unit="Hz"
                        onChange={setChorusRate}
                        description={t(SETTING_HELP.chorusRate)}
                      />
                      <SliderField
                        id={`${idPrefix}-chorus-depth`}
                        label={t("Chorus Depth")}
                        value={chorusDepth}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setChorusDepth}
                        description={t(SETTING_HELP.chorusDepth)}
                      />
                      <SliderField
                        id={`${idPrefix}-chorus-center`}
                        label={t("Chorus Center Delay ms")}
                        value={chorusCenterDelay}
                        min={7}
                        max={8}
                        step={0.1}
                        unit="ms"
                        onChange={setChorusCenterDelay}
                        description={t(SETTING_HELP.chorusDelay)}
                      />
                      <SliderField
                        id={`${idPrefix}-chorus-feedback`}
                        label={t("Chorus Feedback")}
                        value={chorusFeedback}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setChorusFeedback}
                        description={t(SETTING_HELP.feedback)}
                      />
                      <SliderField
                        id={`${idPrefix}-chorus-mix`}
                        label={t("Chorus Mix")}
                        value={chorusMix}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={setChorusMix}
                        description={t(SETTING_HELP.mix)}
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
                      aria-describedby={`${`${idPrefix}-distortion-enabled`}-help`}
                      id={`${idPrefix}-distortion-enabled`}
                    />
                    <span>{t("Distortion")}</span>
                  </label>
                  <SettingHelp
                    text={t(SETTING_HELP.distortion)}
                    controlId={`${idPrefix}-distortion-enabled`}
                  />
                  {distortion && (
                    <SliderField
                      id={`${idPrefix}-dist-gain`}
                      label={t("Distortion Gain")}
                      value={distortionGain}
                      min={-60}
                      max={60}
                      step={1}
                      unit="dB"
                      onChange={setDistortionGain}
                      description={t(SETTING_HELP.distortionGain)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input
                      type="checkbox"
                      checked={gain}
                      onChange={(e) => setGain(e.target.checked)}
                      aria-describedby={`${`${idPrefix}-gain-enabled`}-help`}
                      id={`${idPrefix}-gain-enabled`}
                    />
                    <span>{t("Gain")}</span>
                  </label>
                  <SettingHelp text={t(SETTING_HELP.gain)} controlId={`${idPrefix}-gain-enabled`} />
                  {gain && (
                    <SliderField
                      id={`${idPrefix}-gain-db`}
                      label={t("Gain dB")}
                      value={gainDb}
                      min={-60}
                      max={60}
                      step={0.5}
                      unit="dB"
                      onChange={setGainDb}
                      description={t(SETTING_HELP.gainAmount)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input
                      type="checkbox"
                      checked={bitcrush}
                      onChange={(e) => setBitcrush(e.target.checked)}
                      aria-describedby={`${`${idPrefix}-bitcrush-enabled`}-help`}
                      id={`${idPrefix}-bitcrush-enabled`}
                    />
                    <span>{t("Bitcrush")}</span>
                  </label>
                  <SettingHelp text={t(SETTING_HELP.bitcrush)} controlId={`${idPrefix}-bitcrush-enabled`} />
                  {bitcrush && (
                    <SliderField
                      id={`${idPrefix}-bitcrush-depth`}
                      label={t("Bitcrush Bit Depth")}
                      value={bitcrushBitDepth}
                      min={1}
                      max={32}
                      step={1}
                      onChange={setBitcrushBitDepth}
                      description={t(SETTING_HELP.bitDepth)}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                    <input
                      type="checkbox"
                      checked={clipping}
                      onChange={(e) => setClipping(e.target.checked)}
                      aria-describedby={`${`${idPrefix}-clipping-enabled`}-help`}
                      id={`${idPrefix}-clipping-enabled`}
                    />
                    <span>{t("Clipping")}</span>
                  </label>
                  <SettingHelp text={t(SETTING_HELP.clipping)} controlId={`${idPrefix}-clipping-enabled`} />
                  {clipping && (
                    <SliderField
                      id={`${idPrefix}-clip-thresh`}
                      label={t("Clipping Threshold")}
                      value={clippingThreshold}
                      min={-60}
                      max={0}
                      step={0.5}
                      unit="dB"
                      onChange={setClippingThreshold}
                      description={t(SETTING_HELP.clippingThreshold)}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </Disclosure>
      </div>
    </Card>
  );
}
