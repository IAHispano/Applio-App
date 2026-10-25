"use client";
import { Gauge } from "lucide-react";
import type React from "react";
import { Disclosure, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import type { VoiceFocusVariant } from "@/lib/voice-focus";

interface RealtimeAudioSettingsProps {
  decoderFp16: boolean;
  setDecoderFp16: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: boolean;
  changeConfig: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  voiceFocus: VoiceFocusVariant;
  selectVoiceFocus: (next: VoiceFocusVariant) => Promise<void>;
  voiceFocusUnsupported: boolean;
  voiceFocusError: string;
  chunkMs: number;
  setChunkMs: React.Dispatch<React.SetStateAction<number>>;
  setAutoChunk: React.Dispatch<React.SetStateAction<boolean>>;
  autoChunk: boolean;
  crossfade: number;
  setCrossfade: React.Dispatch<React.SetStateAction<number>>;
  changeConfigDebounced: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  extraSize: number;
  setExtraSize: React.Dispatch<React.SetStateAction<number>>;
  silent: number;
  setSilent: React.Dispatch<React.SetStateAction<number>>;
  inGain: number;
  setInGain: React.Dispatch<React.SetStateAction<number>>;
  outGain: number;
  setOutGain: React.Dispatch<React.SetStateAction<number>>;
  vad: boolean;
  setVad: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function RealtimeAudioSettings({ controls }: { controls: RealtimeAudioSettingsProps }) {
  const { t } = useI18n();
  const {
    decoderFp16,
    setDecoderFp16,
    streaming,
    changeConfig,
    voiceFocus,
    selectVoiceFocus,
    voiceFocusUnsupported,
    voiceFocusError,
    chunkMs,
    setChunkMs,
    setAutoChunk,
    autoChunk,
    crossfade,
    setCrossfade,
    changeConfigDebounced,
    extraSize,
    setExtraSize,
    silent,
    setSilent,
    inGain,
    setInGain,
    outGain,
    setOutGain,
    vad,
    setVad,
  } = controls;
  return (
    <Disclosure
      title={t("Latency / VAD / gains")}
      icon={<Gauge size={15} />}
      description={
        <>
          {t(SETTING_HELP.chunk)} {t(SETTING_HELP.vad)}
        </>
      }
    >
      <div className="mb-4 space-y-3">
        <ToggleField
          id="rt-decoder-fp16"
          label={t("FP16 HiFi-GAN decoder (CUDA)")}
          checked={decoderFp16}
          onChange={(checked) => {
            setDecoderFp16(checked);
            if (streaming) changeConfig("decoder_fp16", checked);
          }}
          description={t(SETTING_HELP.fp16)}
        />
        <label htmlFor="rt-voice-focus" className="text-xs text-neutral-300">
          {t("Voice Focus")}
        </label>
        <CustomSelect
          id="rt-voice-focus"
          value={voiceFocus}
          onChange={(e) => void selectVoiceFocus(e.target.value as VoiceFocusVariant)}
          options={[
            { value: "off", label: t("Off") },
            {
              value: "c20",
              label: "Voice Focus c20",
              disabled: voiceFocusUnsupported,
            },
            {
              value: "c50",
              label: "Voice Focus c50",
              disabled: voiceFocusUnsupported,
            },
            {
              value: "c100",
              label: "Voice Focus c100",
              disabled: voiceFocusUnsupported,
            },
          ]}
          description={t(SETTING_HELP.voiceFocus)}
        />
        <p className="text-xs text-neutral-400">
          {voiceFocusUnsupported
            ? t("Voice Focus is not available on this system. Input keeps working without it.")
            : t(
                "Voice Focus processes microphone audio locally. Model assets download from AWS when enabled.",
              )}
        </p>
        {voiceFocusError ? (
          <p className="text-xs text-amber-300" role="status">
            {voiceFocusError}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div>
          <SliderField
            id="rt-chunk-ms"
            label={t("Chunk Size (ms)")}
            value={chunkMs}
            min={20}
            max={1000}
            step={10}
            unit="ms"
            onChange={(value) => {
              setChunkMs(value);
              setAutoChunk(false);
            }}
            description={t(SETTING_HELP.chunk)}
          />
          <ToggleField
            label={t("Auto chunk size")}
            checked={autoChunk}
            onChange={setAutoChunk}
            description={t(SETTING_HELP.autoChunk)}
          />
        </div>
        <div>
          <SliderField
            id="rt-crossfade"
            label={t("Crossfade Overlap Size (s)")}
            value={crossfade}
            min={0.05}
            max={0.2}
            step={0.01}
            unit="s"
            onChange={(v) => {
              setCrossfade(v);
              if (streaming) changeConfigDebounced("cross_fade_overlap_size", v);
            }}
            description={t(SETTING_HELP.crossfade)}
          />
        </div>
        <div>
          <SliderField
            id="rt-extra-size"
            label={t("Extra Conversion Size (s)")}
            value={extraSize}
            min={0.1}
            max={5}
            step={0.1}
            unit="s"
            onChange={(v) => {
              setExtraSize(v);
              if (streaming) changeConfigDebounced("extra_convert_size", v);
            }}
            description={t(SETTING_HELP.context)}
          />
        </div>
        <div>
          <SliderField
            id="rt-silent-threshold"
            label={t("Silence Threshold (dB)")}
            value={silent}
            min={-90}
            max={-30}
            step={1}
            unit="dB"
            onChange={(v) => {
              setSilent(v);
              if (streaming) changeConfigDebounced("silent_threshold", v);
            }}
            description={t(SETTING_HELP.silence)}
          />
        </div>
        <div>
          <SliderField
            id="rt-in-gain"
            label={t("Input Gain (%)")}
            value={inGain}
            min={0}
            max={200}
            step={1}
            unit="%"
            onChange={(v) => {
              setInGain(v);
              if (streaming) changeConfigDebounced("input_audio_gain", v);
            }}
            description={t(SETTING_HELP.inputGain)}
          />
        </div>
        <div>
          <SliderField
            id="rt-out-gain"
            label={`${t("Output Gain (%)")} ${t("(local)")}`}
            value={outGain}
            min={0}
            max={200}
            step={1}
            unit="%"
            onChange={setOutGain}
            description={t(SETTING_HELP.outputGain)}
          />
        </div>
      </div>
      <ToggleField
        id="rt-vad-enabled"
        label={t("Enable VAD")}
        checked={vad}
        onChange={(checked) => {
          setVad(checked);
          if (streaming) changeConfig("vad_enabled", checked);
        }}
        className="mt-3"
        description={t(SETTING_HELP.vad)}
      />
    </Disclosure>
  );
}
