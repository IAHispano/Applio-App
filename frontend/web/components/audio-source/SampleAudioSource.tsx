"use client";

import { useId } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

export default function SampleAudioSource({
  audios,
  value,
  onSelect,
  onRefresh,
  disabled,
  compact = false,
}: {
  audios: string[];
  value: string;
  onSelect: (path: string) => void;
  onRefresh: () => Promise<void>;
  disabled: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const selectId = useId();
  return (
    <div className={compact ? "space-y-2" : "space-y-2 py-1"}>
      <label htmlFor={selectId} className="text-xs font-medium text-neutral-300">
        {t("Pick a sample audio from assets/audios")}
      </label>
      {audios.length === 0 ? (
        <p className="text-xs text-neutral-400 m-0 py-2">{t("No sample files found in assets/audios")}</p>
      ) : (
        <CustomSelect
          id={selectId}
          value={value}
          disabled={disabled}
          onOpen={onRefresh}
          onChange={(event) => {
            if (event.target.value) onSelect(event.target.value);
          }}
          placeholder={t("Choose a sample audio…")}
          className="w-full"
          description={t(SETTING_HELP.audioSource)}
        >
          <option value="">{t("Select an audio file…")}</option>
          {audios.map((audio) => (
            <option key={audio} value={audio}>
              {audio.split(/[\\/]/).pop() || audio}
            </option>
          ))}
        </CustomSelect>
      )}
    </div>
  );
}
