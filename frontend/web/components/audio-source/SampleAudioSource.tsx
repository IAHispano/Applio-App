"use client";

import { useId, useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import { fileBasename } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

export default function SampleAudioSource({
  audios,
  loading,
  value,
  onSelect,
  onRefresh,
  disabled,
  compact = false,
}: {
  audios: string[];
  loading: boolean;
  value: string;
  onSelect: (path: string) => void;
  onRefresh: () => Promise<void>;
  disabled: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const selectId = useId();
  const options = useMemo(
    () => [
      { value: "", label: t("Select an audio file…") },
      ...audios.map((audio) => ({ value: audio, label: fileBasename(audio) })),
    ],
    [audios, t],
  );
  return (
    <div className={compact ? "space-y-2" : "space-y-2 py-1"}>
      <label htmlFor={selectId} className="text-xs font-medium text-neutral-300">
        {t("Pick a sample audio from assets/audios")}
      </label>
      {audios.length === 0 ? (
        <p className="text-xs text-neutral-400 m-0 py-2">
          {t(loading ? "Loading…" : "No sample files found in assets/audios")}
        </p>
      ) : (
        <CustomSelect
          id={selectId}
          value={value}
          options={options}
          disabled={disabled}
          onOpen={onRefresh}
          onChange={(event) => {
            if (event.target.value) onSelect(event.target.value);
          }}
          placeholder={t("Choose a sample audio…")}
          className="w-full"
          description={t(SETTING_HELP.audioSource)}
        />
      )}
    </div>
  );
}
