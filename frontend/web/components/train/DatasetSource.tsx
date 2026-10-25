"use client";

import { FolderOpen, Library, RefreshCw, Upload } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { CustomSelect, IconButton } from "@/components/ui";
import SettingHelp from "@/components/ui/SettingHelp";
import SourceTabs from "@/components/ui/SourceTabs";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import TrainingUpload from "./TrainingUpload";

type SourceMode = "upload" | "path" | "library";

export default function DatasetSource({
  datasetPath,
  datasets,
  disabled,
  onChange,
  onUploaded,
  onBusyChange,
  onRefresh,
}: {
  datasetPath: string;
  datasets: string[];
  disabled: boolean;
  onChange: (path: string) => void;
  onUploaded: (path: string) => void;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  const id = useId();
  const prefix = `dataset-${id}`;
  const [mode, setMode] = useState<SourceMode>(() =>
    datasetPath ? (datasets.includes(datasetPath) ? "library" : "path") : remote ? "library" : "upload",
  );
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // A prepared review dataset or restored path may not be in the saved list.
    if (datasetPath && !datasets.includes(datasetPath) && mode === "library") setMode("path");
    if (remote && mode === "upload") setMode("library");
  }, [datasetPath, datasets, mode, remote]);

  function selectMode(next: SourceMode) {
    if (disabled || refreshing) return;
    setMode(next);
    if (next === "upload" || (next === "library" && !datasets.includes(datasetPath))) onChange("");
  }

  async function refresh() {
    if (refreshing || disabled) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <fieldset disabled={disabled || refreshing} className="border-0 m-0 p-0 min-w-0 space-y-3">
      <legend className="text-sm font-semibold mb-3">{t("Dataset")}</legend>
      <SourceTabs<SourceMode>
        idPrefix={prefix}
        label={t("Dataset")}
        active={mode}
        onSelect={selectMode}
        tabs={[
          ...(!remote
            ? [{ id: "upload" as const, label: t("Upload a dataset"), icon: <Upload size={15} /> }]
            : []),
          { id: "path", label: t("Use a folder path"), icon: <FolderOpen size={15} /> },
          { id: "library", label: t("Choose a saved dataset"), icon: <Library size={15} /> },
        ]}
      />
      {!remote && (
        <div
          id={`${prefix}-panel-upload`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-upload`}
          hidden={mode !== "upload"}
        >
          <TrainingUpload
            kind="dataset"
            inline
            disabled={disabled}
            onUploaded={(path) => {
              onUploaded(path);
              setMode("library");
            }}
            onBusyChange={onBusyChange}
            onDraftChange={() => onChange("")}
          />
        </div>
      )}
      <div
        id={`${prefix}-panel-path`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-path`}
        hidden={mode !== "path"}
      >
        <label htmlFor={`${prefix}-path`}>{t("Dataset Path")}</label>
        <input
          id={`${prefix}-path`}
          type="text"
          value={datasetPath}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("e.g. assets/datasets/my-dataset or C:/path/to/dataset")}
          aria-describedby={`${prefix}-path-help`}
        />
        <SettingHelp text={t(SETTING_HELP.dataset)} controlId={`${prefix}-path`} />
      </div>
      <div
        id={`${prefix}-panel-library`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-library`}
        hidden={mode !== "library"}
      >
        <label htmlFor={`${prefix}-library`}>{t("Choose a saved dataset")}</label>
        <div className="flex items-center gap-2">
          <CustomSelect
            id={`${prefix}-library`}
            value={datasets.includes(datasetPath) ? datasetPath : ""}
            disabled={disabled || refreshing || datasets.length === 0}
            onChange={(event) => onChange(event.target.value)}
            className="flex-1 min-w-0"
            placeholder={t("Select a dataset…")}
          >
            <option value="" disabled>
              {t("Select a dataset…")}
            </option>
            {datasets.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </CustomSelect>
          <IconButton
            label={t("Refresh Datasets")}
            icon={<RefreshCw size={15} />}
            loading={refreshing}
            disabled={disabled}
            onClick={() => void refresh()}
          />
        </div>
        {datasets.length === 0 && <p className="field-help">{t("No saved datasets found.")}</p>}
      </div>
      {datasetPath && (
        <p className="text-xs text-[var(--muted)] m-0 break-all" role="status">
          {t("Selected dataset")}: <code>{datasetPath}</code>
        </p>
      )}
    </fieldset>
  );
}
