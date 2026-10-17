"use client";

import { Activity, Sliders, Sparkles } from "lucide-react";
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
  inferenceEngine: string;
  onnxPrecision: string;
  embedderModel: string;
  embedderModelCustom: string;
  exportFormat: string;
  splitAudio: boolean;
  f0Autotune: boolean;
  f0AutotuneStrength: number;
  proposedPitch: boolean;
  proposedPitchThreshold: number;
  formantShifting: boolean;
  formantQfrency: number;
  formantTimbre: number;
  cleanupMode: "off" | "light" | "speech";
  cleanupStrength: number;
}

export type ConversionParameterSetters = {
  [K in keyof ConversionParameterValues]: (value: ConversionParameterValues[K]) => void;
};

interface ConversionParametersProps {
  values: ConversionParameterValues;
  setters: ConversionParameterSetters;
  idPrefix: string;
  onReset: () => void;
  /** Optional control rendered next to the reset button (e.g. per-model target picker). */
  targetSelect?: React.ReactNode;
  /** Keep pitch visible and group technical controls under Advanced. */
  simplified?: boolean;
  step?: number;
  /** Workflow-specific controls grouped with the technical settings. */
  additionalControls?: React.ReactNode;
  cleanupStage?: "input" | "output";
}

export default function ConversionParameters({
  values,
  setters,
  idPrefix,
  onReset,
  targetSelect,
  simplified = false,
  step,
  additionalControls,
  cleanupStage = "input",
}: ConversionParametersProps) {
  const { t } = useI18n();
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
  } = values;
  const {
    pitch: setPitch,
    indexRate: setIndexRate,
    volumeEnvelope: setVolumeEnvelope,
    protect: setProtect,
    f0Method: setF0Method,
    inferenceEngine: setInferenceEngine,
    onnxPrecision: setOnnxPrecision,
    embedderModel: setEmbedderModel,
    embedderModelCustom: setEmbedderModelCustom,
    exportFormat: setExportFormat,
    splitAudio: setSplitAudio,
    f0Autotune: setF0Autotune,
    f0AutotuneStrength: setF0AutotuneStrength,
    proposedPitch: setProposedPitch,
    proposedPitchThreshold: setProposedPitchThreshold,
    formantShifting: setFormantShifting,
    formantQfrency: setFormantQfrency,
    formantTimbre: setFormantTimbre,
  } = setters;
  const pitchControl = (
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
  );
  const advancedParameters = (
    <>
      {/* 4 Core Voice Sliders (2x2 Grid on md, 4 across on xl/fullscreen) */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 ${simplified ? "xl:grid-cols-3" : "xl:grid-cols-4"} gap-5`}
      >
        {!simplified && pitchControl}

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-inference-engine`} className="text-xs font-medium text-neutral-300">
            {t("Inference engine")}
          </label>
          <CustomSelect
            id={`${idPrefix}-inference-engine`}
            value={inferenceEngine}
            onChange={(e) => setInferenceEngine(e.target.value)}
            className="w-full mt-1"
            description={t(SETTING_HELP.inferenceEngine)}
          >
            <option value="torch">PyTorch</option>
            <option value="onnx">{t("ONNX (experimental)")}</option>
          </CustomSelect>
        </div>
        {inferenceEngine === "onnx" && (
          <div>
            <label htmlFor={`${idPrefix}-onnx-precision`} className="text-xs font-medium text-neutral-300">
              {t("ONNX precision")}
            </label>
            <CustomSelect
              id={`${idPrefix}-onnx-precision`}
              value={onnxPrecision}
              onChange={(e) => setOnnxPrecision(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.onnxPrecision)}
            >
              <option value="auto">{t("Auto")}</option>
              <option value="float32">FP32</option>
              <option value="float16">FP16</option>
            </CustomSelect>
          </div>
        )}
      </div>

      {/* Collapsible Accordions: Advanced Tuning, Formant, Audio FX */}
      <div className="space-y-3 pt-2">
        {/* Advanced Pitch & Tuning Accordion */}
        <Disclosure
          title={t("Advanced Pitch & Tuning")}
          icon={<Activity size={15} />}
          description={t(SETTING_HELP.autotune)}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              id={`${idPrefix}-proposed-pitch`}
              label={t("Proposed Pitch")}
              checked={proposedPitch}
              onChange={setProposedPitch}
              description={t(SETTING_HELP.proposed)}
            />
          </div>

          {(f0Autotune || proposedPitch) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
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
                min={0.1}
                max={16.0}
                step={0.1}
                onChange={setFormantTimbre}
                description={t("Adjusts vocal tract length / timbre brightness")}
              />
            </div>
          )}
        </Disclosure>

        <Disclosure title={t("Audio cleanup")} icon={<Sparkles size={15} />}>
          <label htmlFor={`${idPrefix}-cleanup-mode`} className="text-xs text-neutral-300">
            {t("Noise reduction")}
          </label>
          <CustomSelect
            id={`${idPrefix}-cleanup-mode`}
            value={values.cleanupMode}
            onChange={(event) =>
              setters.cleanupMode(event.target.value as ConversionParameterValues["cleanupMode"])
            }
            options={[
              { value: "off", label: t("Off") },
              { value: "light", label: t("Light cleanup (FFmpeg)") },
              { value: "speech", label: t("Speech enhancement (DeepFilterNet3)") },
            ]}
          />
          {values.cleanupMode !== "off" && (
            <SliderField
              id={`${idPrefix}-cleanup-strength`}
              label={t("Noise reduction limit")}
              value={values.cleanupStrength}
              min={1}
              max={30}
              step={1}
              unit="dB"
              onChange={setters.cleanupStrength}
              description={t("Higher values remove more noise and can change the voice. Start with 12 dB.")}
            />
          )}
          <p className="text-xs text-neutral-400">
            {cleanupStage === "output"
              ? t("Cleans the converted speech before export. Leave Off for already-clean TTS.")
              : t(
                  "Cleans the source audio before voice conversion. Leave Off for singing unless tested on your audio.",
                )}
          </p>
          {values.cleanupMode === "speech" && (
            <p className="text-xs text-neutral-400">
              {t(
                "Processes locally on CPU. The runtime and model download on first use (about 35 MB). Speech enhancement may suppress music and sustained vocals.",
              )}
            </p>
          )}
        </Disclosure>
      </div>
    </>
  );

  return (
    <Card>
      <CardHeader
        step={step}
        icon={<Sliders size={18} className="text-white" />}
        title={t("Conversion Parameters")}
        description={
          simplified
            ? undefined
            : t("Fine-tune pitch shifting, index feature retrieval, and audio envelope response.")
        }
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

      {simplified ? (
        <>
          {pitchControl}
          <Disclosure
            title={t("Advanced Settings")}
            description={t("Fine-tune pitch shifting, index feature retrieval, and audio envelope response.")}
            icon={<Sliders size={16} />}
          >
            {additionalControls}
            {advancedParameters}
          </Disclosure>
        </>
      ) : (
        advancedParameters
      )}
    </Card>
  );
}
