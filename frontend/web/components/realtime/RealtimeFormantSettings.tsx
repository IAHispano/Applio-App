"use client";

import { Sparkles } from "lucide-react";
import type React from "react";
import { Disclosure, ToggleField } from "@/components/ui";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeFormantSettingsProps {
  formantShifting: boolean;
  setFormantShifting: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: boolean;
  changeConfig: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  formantQfrency: number;
  setFormantQfrency: React.Dispatch<React.SetStateAction<number>>;
  changeConfigDebounced: (key: string, value: number | string | boolean, ifKwargs?: boolean) => void;
  formantTimbre: number;
  setFormantTimbre: React.Dispatch<React.SetStateAction<number>>;
}

export default function RealtimeFormantSettings({ controls }: { controls: RealtimeFormantSettingsProps }) {
  const { t } = useI18n();
  const {
    formantShifting,
    setFormantShifting,
    streaming,
    changeConfig,
    formantQfrency,
    setFormantQfrency,
    changeConfigDebounced,
    formantTimbre,
    setFormantTimbre,
  } = controls;
  return (
    <Disclosure
      title={t("Formant Shifting")}
      icon={<Sparkles size={15} />}
      description={t(SETTING_HELP.formant)}
    >
      <ToggleField
        id="rt-formant-shifting"
        label={t("Enable Formant Shifting")}
        checked={formantShifting}
        onChange={(checked) => {
          setFormantShifting(checked);
          if (streaming) changeConfig("formant_shifting", checked);
        }}
        description={t(SETTING_HELP.formant)}
      />
      {formantShifting && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <SliderField
            id="rt-formant-qfrency"
            label={t("Quefrency for formant shifting")}
            value={formantQfrency}
            min={0}
            max={16}
            step={0.1}
            onChange={(v) => {
              setFormantQfrency(v);
              if (streaming) changeConfigDebounced("formant_qfrency", v);
            }}
            description={t("Modifies formants width and spectral envelope")}
          />
          <SliderField
            id="rt-formant-timbre"
            label={t("Timbre for formant shifting")}
            value={formantTimbre}
            min={0.1}
            max={16}
            step={0.1}
            onChange={(v) => {
              setFormantTimbre(v);
              if (streaming) changeConfigDebounced("formant_timbre", v);
            }}
            description={t("Adjusts vocal tract length / timbre brightness")}
          />
          <p className="text-xs text-neutral-400 sm:col-span-2">
            {t("Active formant shifting adds 64 ms of audio delay. Timbre 1 is neutral.")}
          </p>
        </div>
      )}
    </Disclosure>
  );
}
