"use client";

import { Play, Sliders } from "lucide-react";
import type React from "react";
import DatasetSource from "@/components/train/DatasetSource";
import { Badge, Button, Modal, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

type StepModal = null | "preprocess" | "extract" | "train" | "index";

interface PreprocessModalProps {
  activeModal: StepModal;
  setActiveModal: React.Dispatch<React.SetStateAction<StepModal>>;
  modelName: string;
  isCpu: boolean;
  gpuCount: string;
  datasetPath: string;
  setDatasetPath: React.Dispatch<React.SetStateAction<string>>;
  datasets: string[];
  refreshDatasets: () => Promise<string[]>;
  busy: boolean;
  activeTraining: boolean;
  reviewBusy: boolean;
  uploadsInProgress: number;
  onDatasetUploaded: (path: string) => void;
  onUploadBusyChange: (uploading: boolean) => void;
  sampleRate: string;
  setSampleRate: React.Dispatch<React.SetStateAction<string>>;
  srOptions: string[];
  normalizationMode: string;
  setNormalizationMode: React.Dispatch<React.SetStateAction<string>>;
  cut: string;
  setCut: React.Dispatch<React.SetStateAction<string>>;
  chunk: number;
  setChunk: React.Dispatch<React.SetStateAction<number>>;
  overlap: number;
  setOverlap: React.Dispatch<React.SetStateAction<number>>;
  processEffects: boolean;
  setProcessEffects: React.Dispatch<React.SetStateAction<boolean>>;
  runPreprocess: () => Promise<void>;
}

export default function PreprocessModal({ controls }: { controls: PreprocessModalProps }) {
  const { t } = useI18n();
  const {
    activeModal,
    setActiveModal,
    modelName,
    isCpu,
    gpuCount,
    datasetPath,
    setDatasetPath,
    datasets,
    refreshDatasets,
    busy,
    activeTraining,
    reviewBusy,
    uploadsInProgress,
    onDatasetUploaded,
    onUploadBusyChange,
    sampleRate,
    setSampleRate,
    srOptions,
    normalizationMode,
    setNormalizationMode,
    cut,
    setCut,
    chunk,
    setChunk,
    overlap,
    setOverlap,
    processEffects,
    setProcessEffects,
    runPreprocess,
  } = controls;
  return (
    <Modal
      isOpen={activeModal === "preprocess"}
      onClose={() => setActiveModal(null)}
      title={t("Step 1 — Preprocess Dataset")}
      description={t("Slice, clean, and normalize audio before feature extraction.")}
      size="lg"
      icon={<Sliders size={18} className="text-white" />}
    >
      <div className="modal-context">
        <Badge variant="neutral">{modelName || "…"}</Badge>
        <Badge variant={isCpu ? "warning" : "success"} dot>
          {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
        </Badge>
      </div>
      <section className="modal-section" aria-label={t("Source")}>
        <h3 className="modal-section-title">{t("Source")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div className="sm:col-span-2">
            <DatasetSource
              datasetPath={datasetPath}
              datasets={datasets}
              disabled={busy || activeTraining || reviewBusy || uploadsInProgress > 0}
              onChange={setDatasetPath}
              onUploaded={onDatasetUploaded}
              onBusyChange={onUploadBusyChange}
              onRefresh={refreshDatasets}
            />
          </div>
          <div>
            <label htmlFor="modal-prep-sample-rate">{t("Sampling Rate")}</label>
            <CustomSelect
              id="modal-prep-sample-rate"
              value={sampleRate}
              onChange={(e) => setSampleRate(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.sampleRate)}
            >
              {srOptions.map((s) => (
                <option key={s} value={s}>
                  {s} Hz
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-prep-norm-mode">{t("Normalization mode")}</label>
            <CustomSelect
              id="modal-prep-norm-mode"
              value={normalizationMode}
              onChange={(e) => setNormalizationMode(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.normalize)}
            >
              {["none", "pre", "post"].map((s) => (
                <option key={s} value={s}>
                  {s === "none" ? t("None") : t(s)}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
      </section>
      <section className="modal-section" aria-label={t("Slicing")}>
        <h3 className="modal-section-title">{t("Slicing")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-prep-cut-method">{t("Audio cutting")}</label>
            <CustomSelect
              id="modal-prep-cut-method"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.cutting)}
            >
              {["Skip", "Simple", "Automatic"].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <SliderField
              id="modal-prep-chunk"
              label={t("Chunk length")}
              value={chunk}
              min={0.5}
              max={5}
              step={0.1}
              unit="s"
              onChange={setChunk}
              description={t(SETTING_HELP.trainChunk)}
            />
          </div>
          <div>
            <SliderField
              id="modal-prep-overlap"
              label={t("Overlap length")}
              value={overlap}
              min={0}
              max={0.4}
              step={0.1}
              unit="s"
              onChange={setOverlap}
              description={t(SETTING_HELP.trainOverlap)}
            />
          </div>
        </div>
      </section>
      <section className="modal-section" aria-label={t("Cleanup")}>
        <h3 className="modal-section-title">{t("Cleanup")}</h3>
        <div className="modal-option-grid">
          <ToggleField
            id="modal-prep-process-effects"
            label={t("Noise filter")}
            checked={processEffects}
            onChange={setProcessEffects}
            description={t(SETTING_HELP.noiseFilter)}
          />
        </div>
      </section>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setActiveModal(null)}>
          {t("Cancel")}
        </Button>
        <Button
          loading={busy}
          onClick={runPreprocess}
          icon={<Play size={14} />}
          disabled={busy || activeTraining || uploadsInProgress > 0}
        >
          {busy ? t("Running…") : t("Run Preprocess")}
        </Button>
      </div>
    </Modal>
  );
}
