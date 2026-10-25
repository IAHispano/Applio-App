"use client";

import CustomSelect from "@/components/ui/CustomSelect";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

export default function SampleAudioSource({
  audios,
  value,
  onSelect,
  onRefresh,
  compact = false,
}: {
  audios: string[];
  value: string;
  onSelect: (path: string) => void;
  onRefresh: () => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const prefix = compact ? "picker" : "empty";
  const selectId = compact ? "change-sample-audio-select" : "sample-audio-select";
  return (
    <div
      id={`${prefix}-panel-samples`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-samples`}
      className={compact ? "space-y-2" : "space-y-2 py-1"}
    >
      <label htmlFor={selectId} className="text-xs font-medium text-neutral-300">
        {t("Pick a sample audio from assets/audios")}
      </label>
      {audios.length === 0 ? (
        <p className="text-xs text-neutral-400 m-0 py-2">{t("No sample files found in assets/audios")}</p>
      ) : (
        <CustomSelect
          id={selectId}
          value={value}
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
