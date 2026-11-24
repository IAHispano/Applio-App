"use client";
import { Cpu } from "lucide-react";
import type React from "react";
import DatasetReview from "@/components/train/DatasetReview";
import DatasetSource from "@/components/train/DatasetSource";
import GpuSelect, { type GpuDevice } from "@/components/train/GpuSelect";
import { Alert, Badge, Card, CardHeader } from "@/components/ui";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface TrainingProjectSetupProps {
  isCpu: boolean;
  gpuCount: string;
  activeTraining: boolean;
  modelName: string;
  setModelName: React.Dispatch<React.SetStateAction<string>>;
  setGpuCount: React.Dispatch<React.SetStateAction<string>>;
  gpuDevices: GpuDevice[];
  cpuCores: string;
  hostCores: number;
  cpuTouchedRef: React.RefObject<boolean>;
  setCpuCores: React.Dispatch<React.SetStateAction<string>>;
  datasetPath: string;
  busy: boolean;
  reviewBusy: boolean;
  uploadsInProgress: number;
  setDatasetPath: React.Dispatch<React.SetStateAction<string>>;
  datasets: string[];
  refreshDatasets: () => Promise<string[]>;
  onDatasetUploaded: (path: string) => void;
  onUploadBusyChange: (uploading: boolean) => void;
  setReviewBusy: React.Dispatch<React.SetStateAction<boolean>>;
  gpuInfo: string;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
}

export default function TrainingProjectSetup({ controls }: { controls: TrainingProjectSetupProps }) {
  const { t } = useI18n();
  const {
    isCpu,
    gpuCount,
    activeTraining,
    modelName,
    setModelName,
    setGpuCount,
    gpuDevices,
    cpuCores,
    hostCores,
    cpuTouchedRef,
    setCpuCores,
    datasetPath,
    busy,
    reviewBusy,
    uploadsInProgress,
    setDatasetPath,
    datasets,
    refreshDatasets,
    onDatasetUploaded,
    onUploadBusyChange,
    setReviewBusy,
    gpuInfo,
    error,
    setError,
  } = controls;
  return (
    <Card>
      <CardHeader
        step={1}
        icon={<Cpu size={18} className="text-white" />}
        title={t("Model & Compute Hardware")}
        description={t("Applies to both Automatic and Manual training.")}
        action={
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] card-grid">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-1 content-start gap-4">
          <div>
            <label htmlFor="train-model-name">{t("Model Name")}</label>
            <input
              id="train-model-name"
              disabled={activeTraining}
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("e.g. vocal-model")}
              aria-describedby={`${"train-model-name"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.modelName)} controlId={"train-model-name"} />
          </div>
          <div>
            <label htmlFor="train-gpu">{t("GPU")}</label>
            <GpuSelect
              id="train-gpu"
              disabled={activeTraining}
              value={gpuCount}
              onChange={setGpuCount}
              devices={gpuDevices}
              className="w-full"
            />
          </div>
          <div>
            <SliderField
              id="train-cpu-cores"
              disabled={activeTraining}
              label={t("CPU Cores")}
              value={cpuCores === "" ? hostCores : Math.min(Number(cpuCores), hostCores)}
              min={1}
              max={hostCores}
              step={1}
              onChange={(v) => {
                cpuTouchedRef.current = true;
                setCpuCores(String(v));
              }}
              description={t(SETTING_HELP.cpu)}
            />
          </div>
        </div>
        <div className="space-y-4 min-w-0 border-t border-[var(--border)] pt-4 xl:border-t-0 xl:border-s xl:pt-0 xl:ps-5">
          <DatasetSource
            datasetPath={datasetPath}
            datasets={datasets}
            disabled={busy || activeTraining || reviewBusy || uploadsInProgress > 0}
            onChange={setDatasetPath}
            onUploaded={onDatasetUploaded}
            onBusyChange={onUploadBusyChange}
            onRefresh={refreshDatasets}
          />
          <DatasetReview
            datasetPath={datasetPath}
            onDatasetChange={setDatasetPath}
            uploading={uploadsInProgress > 0}
            onBusyChange={setReviewBusy}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap field-help border-t border-[var(--border)] pt-3">
        <span className="min-w-0 wrap-anywhere">{gpuInfo || t("Detecting GPU acceleration…")}</span>
        <span className="min-w-0 wrap-anywhere">
          {t("Output saved to")} <code>logs/{modelName || "…"}/</code>
        </span>
      </div>
      {error && (
        <Alert variant="error" onDismiss={() => setError("")} className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}
