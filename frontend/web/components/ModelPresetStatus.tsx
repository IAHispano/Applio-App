"use client";
import { useI18n } from "@/lib/i18n";
import { useModelPresets } from "@/lib/model-presets";
export default function ModelPresetStatus() {
  const { t } = useI18n();
  const { loaded, error } = useModelPresets();
  return (
    <p className={`field-help mt-3 mb-0 ${error ? "text-red-400" : "text-neutral-400"}`} role="status">
      {error
        ? t("Could not save model settings. Your changes remain available until you close the app.")
        : !loaded
          ? t("Loading model settings…")
          : t("Settings are saved automatically for each voice model and restored when you switch voices.")}
    </p>
  );
}
