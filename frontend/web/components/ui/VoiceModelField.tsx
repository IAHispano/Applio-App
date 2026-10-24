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
  /** Use compact model and index pickers. */
  compact?: boolean;
  hideIndex?: boolean;
  description?: React.ReactNode;
  /** Model selection handlers (ModelDropdown passthrough) */
  onSelect: (modelPath: string) => void;
  onUnload: () => void;
  onRefresh: () => void;
  /** Revalidate cached lists when a picker opens, without forcing a scan. */
  onOpen?: () => void;
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
  compact = false,
  hideIndex = false,
  description,
  onSelect,
  onUnload,
  onRefresh,
  onOpen,
  onIndexChange,
}: VoiceModelFieldProps) {
  const { t } = useI18n();
  const dropdownId = `voice-model-${useId()}`;

  return (
    <div className="space-y-2">
      <div className={compact ? "grid grid-cols-1 gap-3" : "space-y-2"}>
        <div className="min-w-0 space-y-2">
          {(label || compact) && (
            <label htmlFor={dropdownId} className="field-label block">
              {label ?? t("Voice Model")}
            </label>
          )}
          {compact ? (
            <CustomSelect
              id={dropdownId}
              aria-describedby={`${dropdownId}-help`}
              value={selectedModel}
              placeholder={t("Select a voice model…")}
              onOpen={onOpen ?? onRefresh}
              onValueChange={onSelect}
              options={models.map((model) => ({
                value: model,
                label: fileBasename(model).replace(/\.(pth|onnx)$/i, ""),
                badge: model.toLowerCase().endsWith(".onnx") ? "ONNX" : "PTH",
                description: model,
              }))}
            />
          ) : (
            <ModelDropdown
              id={dropdownId}
              aria-describedby={`${dropdownId}-help`}
              models={models}
              selectedModel={selectedModel}
              indexes={indexes}
              onSelect={onSelect}
              onUnload={onUnload}
              onRefresh={onOpen ?? onRefresh}
            />
          )}
          <div className={compact ? "sr-only" : undefined}>
            <SettingHelp text={description ?? t(SETTING_HELP.voiceModel)} controlId={dropdownId} />
          </div>
        </div>
        {!hideIndex && (selectedModel || compact) && (
          <div className={compact ? "min-w-0 space-y-2" : "space-y-2 pt-3"}>
            <label className="field-label block" htmlFor={indexSelectId}>
              {indexLabel ?? t("Index File")}
            </label>
            <CustomSelect
              id={indexSelectId}
              description={compact ? undefined : t(SETTING_HELP.index)}
              aria-describedby={compact ? `${indexSelectId}-help` : undefined}
              value={indexPath}
              disabled={!selectedModel}
              onOpen={onOpen ?? onRefresh}
              onChange={(e) => onIndexChange(e.target.value)}
              className="w-full"
              options={[
                { value: "", label: t("None") },
                ...indexes.map((idx) => ({
                  value: idx,
                  label: compact
                    ? fileBasename(idx).replace(/\.index$/i, "")
                    : `${fileBasename(idx)} (${idx})`,
                  badge: compact ? "INDEX" : undefined,
                  description: compact ? idx : undefined,
                })),
              ]}
            />
            {compact && (
              <div className="sr-only">
                <SettingHelp text={t(SETTING_HELP.index)} controlId={indexSelectId} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
