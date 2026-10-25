"use client";

import type React from "react";
import { EmbedderSelect, PitchMethodSelect, REALTIME_F0_METHODS } from "@/components/ui";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeConversionSettingsProps {
  indexRate: number;
  setIndexRate: React.Dispatch<React.SetStateAction<number>>;
  streaming: boolean;
  changeConfigDebounced: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  protect: number;
  setProtect: React.Dispatch<React.SetStateAction<number>>;
  volumeEnvelope: number;
  setVolumeEnvelope: React.Dispatch<React.SetStateAction<number>>;
  f0Method: string;
  setF0Method: React.Dispatch<React.SetStateAction<string>>;
  embedder: string;
  setEmbedder: React.Dispatch<React.SetStateAction<string>>;
  embedderCustom: string;
  setEmbedderCustom: React.Dispatch<React.SetStateAction<string>>;
}

export default function RealtimeConversionSettings({
  controls,
}: {
  controls: RealtimeConversionSettingsProps;
}) {
  const { t } = useI18n();
  const {
    indexRate,
    setIndexRate,
    streaming,
    changeConfigDebounced,
    protect,
    setProtect,
    volumeEnvelope,
    setVolumeEnvelope,
    f0Method,
    setF0Method,
    embedder,
    setEmbedder,
    embedderCustom,
    setEmbedderCustom,
  } = controls;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <div>
        <SliderField
          id="rt-index-rate"
          label={t("Search Feature Ratio")}
          value={indexRate}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => {
            setIndexRate(v);
            if (streaming) changeConfigDebounced("index_rate", v);
          }}
          description={t(SETTING_HELP.indexRate)}
        />
      </div>
      <div>
        <SliderField
          id="rt-protect"
          label={t("Protect Voiceless Consonants")}
          value={protect}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => {
            setProtect(v);
            if (streaming) changeConfigDebounced("protect", v);
          }}
          description={t(SETTING_HELP.protect)}
        />
      </div>
      <div>
        <SliderField
          id="rt-volume-envelope"
          label={t("Volume Envelope")}
          value={volumeEnvelope}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => {
            setVolumeEnvelope(v);
            if (streaming) changeConfigDebounced("volume_envelope", v);
          }}
          description={t(SETTING_HELP.envelope)}
        />
      </div>

      <PitchMethodSelect
        id="rt-f0-method"
        label={t("Pitch extraction algorithm")}
        value={f0Method}
        onChange={setF0Method}
        methods={REALTIME_F0_METHODS}
      />
      <EmbedderSelect id="rt-embedder" label={t("Embedder Model")} value={embedder} onChange={setEmbedder} />
      {embedder === "custom" && (
        <div>
          <label htmlFor="rt-custom-embedder">{t("Custom embedder path")}</label>
          <input
            id="rt-custom-embedder"
            type="text"
            value={embedderCustom}
            onChange={(e) => setEmbedderCustom(e.target.value)}
            placeholder="rvc/models/embedders/embedders_custom/my-embedder"
            aria-describedby={`${"rt-custom-embedder"}-help`}
          />
          <SettingHelp text={t(SETTING_HELP.customEmbedder)} controlId={"rt-custom-embedder"} />
        </div>
      )}
    </div>
  );
}
