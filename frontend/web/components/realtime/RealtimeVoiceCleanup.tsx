"use client";

import { Wand2 } from "lucide-react";
import type React from "react";
import { Disclosure, ToggleField } from "@/components/ui";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeVoiceCleanupProps {
  autotune: boolean;
  setAutotune: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: boolean;
  changeConfig: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  proposedPitch: boolean;
  setProposedPitch: React.Dispatch<React.SetStateAction<boolean>>;
  autotuneStrength: number;
  setAutotuneStrength: React.Dispatch<React.SetStateAction<number>>;
  changeConfigDebounced: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  proposedPitchThreshold: number;
  setProposedPitchThreshold: React.Dispatch<React.SetStateAction<number>>;
}

export default function RealtimeVoiceCleanup({ controls }: { controls: RealtimeVoiceCleanupProps }) {
  const { t } = useI18n();
  const {
    autotune,
    setAutotune,
    streaming,
    changeConfig,
    proposedPitch,
    setProposedPitch,
    autotuneStrength,
    setAutotuneStrength,
    changeConfigDebounced,
    proposedPitchThreshold,
    setProposedPitchThreshold,
  } = controls;
  return (
    <Disclosure
      title={t("Voice cleanup (autotune / proposed pitch)")}
      icon={<Wand2 size={15} />}
      description={t(SETTING_HELP.autotune)}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <ToggleField
            id="rt-autotune"
            label={t("Autotune")}
            checked={autotune}
            onChange={(checked) => {
              setAutotune(checked);
              if (streaming) changeConfig("autotune", checked);
            }}
            description={t(SETTING_HELP.autotune)}
          />
        </div>
        <div className="min-w-0">
          <ToggleField
            id="rt-proposed-pitch"
            label={t("Proposed Pitch")}
            checked={proposedPitch}
            onChange={(checked) => {
              setProposedPitch(checked);
              if (streaming) changeConfig("proposed_pitch", checked);
            }}
            description={t(SETTING_HELP.proposed)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ marginTop: 8 }}>
        <div>
          <SliderField
            id="rt-autotune-strength"
            label={t("Autotune Strength")}
            value={autotuneStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => {
              setAutotuneStrength(v);
              if (streaming) changeConfigDebounced("autotune_strength", v);
            }}
            description={t(SETTING_HELP.autotuneStrength)}
          />
        </div>
        <div>
          <SliderField
            id="rt-proposed-threshold"
            label={t("Proposed Pitch Threshold")}
            value={proposedPitchThreshold}
            min={50}
            max={1200}
            step={1}
            unit="Hz"
            onChange={(v) => {
              setProposedPitchThreshold(v);
              if (streaming) changeConfigDebounced("proposed_pitch_threshold", v);
            }}
            description={t(SETTING_HELP.proposedThreshold)}
          />
        </div>
      </div>
    </Disclosure>
  );
}
