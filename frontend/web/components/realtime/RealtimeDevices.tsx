"use client";

import { ListMusic, RefreshCw } from "lucide-react";
import type React from "react";
import Stage from "@/components/realtime/RealtimeStage";
import { FormField, IconButton } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeDevicesProps {
  calibrating: boolean;
  inDev: string;
  setInDev: React.Dispatch<React.SetStateAction<string>>;
  inputs: { id: string; label: string }[];
  outDev: string;
  setOutDev: React.Dispatch<React.SetStateAction<string>>;
  outputs: { id: string; label: string }[];
  enumDevices: () => Promise<void>;
}

export default function RealtimeDevices({ controls }: { controls: RealtimeDevicesProps }) {
  const { t } = useI18n();
  const { calibrating, inDev, setInDev, inputs, outDev, setOutDev, outputs, enumDevices } = controls;
  return (
    <Stage
      disabled={calibrating}
      step={2}
      title={t("Audio Devices")}
      description={t("Select your input and output devices.")}
      icon={<ListMusic size={18} className="text-white" />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4">
        <FormField label={t("Input Device")} htmlFor="rt-in-dev" required>
          <CustomSelect
            id="rt-in-dev"
            value={inDev}
            onChange={(e) => setInDev(e.target.value)}
            className="w-full"
            description={t(SETTING_HELP.inputDevice)}
          >
            <option value="" disabled>
              {t("Select an input device")}
            </option>
            {inputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </CustomSelect>
        </FormField>
        <FormField label={t("Output Device")} htmlFor="rt-out-dev" required>
          <CustomSelect
            id="rt-out-dev"
            value={outDev}
            onChange={(e) => setOutDev(e.target.value)}
            className="w-full"
            description={t(SETTING_HELP.outputDevice)}
          >
            <option value="" disabled>
              {t("Select an output device")}
            </option>
            {outputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </CustomSelect>
        </FormField>
        <div className="flex items-start sm:pt-[30px]">
          <IconButton
            label={t("Refresh audio devices")}
            icon={<RefreshCw size={14} />}
            size="md"
            onClick={() => void enumDevices()}
          />
        </div>
      </div>
      <p className="text-xs text-neutral-400">
        {t(
          "Choose your microphone as input. To send converted audio to another app, select a virtual cable as output and select its paired input in that app.",
        )}
      </p>
    </Stage>
  );
}
