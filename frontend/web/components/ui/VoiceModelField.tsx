"use client";

import type React from "react";
import { useId } from "react";
import { fileBasename } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import CustomSelect from "./CustomSelect";
import ModelDropdown from "./ModelDropdown";
import SettingHelp from "./SettingHelp";

export interface VoiceModelFieldProps {
  /** Optional label rendered above the dropdown */
  label?: React.ReactNode;
  /** Available model paths */
  models: string[];
  /** Currently selected model path */
  selectedModel: string;
  /** Available index paths */
  indexes: string[];
  /** Currently selected index path */
  indexPath: string;
  /** DOM id for the index label/control pair */
  indexSelectId: string;
  /** Index picker label (defaults to "Index File") */
  indexLabel?: React.ReactNode;
  /** Model selection handlers (ModelDropdown passthrough) */
  onSelect: (modelPath: string) => void;
  onUnload: () => void;
  onRefresh: () => void;
  /** Index selection handler */
  onIndexChange: (value: string) => void;
}

/**
 * Shared voice-model picker: model dropdown plus the linked index picker.
 * Used identically by inference, TTS and realtime so the voice selection
 * step looks and behaves the same everywhere.
 */
export default function VoiceModelField({
  label,
  models,
  selectedModel,
  indexes,
  indexPath,
  indexSelectId,
  indexLabel,
  onSelect,
  onUnload,
  onRefresh,
  onIndexChange,
}: VoiceModelFieldProps) {
  const { t } = useI18n();
  const dropdownId = `voice-model-${useId()}`;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={dropdownId} className="block text-xs font-medium text-neutral-300">
          {label}
        </label>
      )}
      <ModelDropdown
        id={dropdownId}
        aria-describedby={`${dropdownId}-help`}
        models={models}
        selectedModel={selectedModel}
        indexes={indexes}
        onSelect={onSelect}
        onUnload={onUnload}
        onRefresh={onRefresh}
      />
      <SettingHelp text={t(SETTING_HELP.voiceModel)} controlId={dropdownId} />
      {selectedModel && (
        <div className="space-y-2 pt-3">
          <label className="field-label block" htmlFor={indexSelectId}>
            {indexLabel ?? t("Index File")}
          </label>
          <CustomSelect
            id={indexSelectId}
            description={t(SETTING_HELP.index)}
            value={indexPath}
            onOpen={onRefresh}
            onChange={(e) => onIndexChange(e.target.value)}
            className="w-full"
          >
            <option value="">{t("None")}</option>
            {indexes.map((idx) => (
              <option key={idx} value={idx}>
                {fileBasename(idx)} ({idx})
              </option>
            ))}
          </CustomSelect>
        </div>
      )}
    </div>
  );
}
