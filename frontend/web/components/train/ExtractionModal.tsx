"use client";
import { Activity, Play } from "lucide-react";
import type React from "react";
import TrainingUpload from "@/components/train/TrainingUpload";
import { Badge, Button, Modal } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

type StepModal = null | "preprocess" | "extract" | "train" | "index";

interface ExtractionModalProps {
  activeModal: StepModal;
  setActiveModal: React.Dispatch<React.SetStateAction<StepModal>>;
  modelName: string;
  isCpu: boolean;
  gpuCount: string;
  sampleRate: string;
  f0Method: string;
  setF0Method: React.Dispatch<React.SetStateAction<string>>;
  embedder: string;
  setEmbedder: React.Dispatch<React.SetStateAction<string>>;
  embedderCustom: string;
  setEmbedderCustom: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  activeTraining: boolean;
  uploadsInProgress: number;
  onUploadBusyChange: (uploading: boolean) => void;
  includeMutes: number;
  setIncludeMutes: React.Dispatch<React.SetStateAction<number>>;
  setSampleRate: React.Dispatch<React.SetStateAction<string>>;
  srOptions: string[];
  runExtract: () => Promise<void>;
}

export default function ExtractionModal({ controls }: { controls: ExtractionModalProps }) {
  const { t } = useI18n();
  const {
    activeModal,
    setActiveModal,
    modelName,
    isCpu,
    gpuCount,
    sampleRate,
    f0Method,
    setF0Method,
    embedder,
    setEmbedder,
    embedderCustom,
    setEmbedderCustom,
    busy,
    activeTraining,
    uploadsInProgress,
    onUploadBusyChange,
    includeMutes,
    setIncludeMutes,
    setSampleRate,
    srOptions,
    runExtract,
  } = controls;
  return (
    <Modal
      isOpen={activeModal === "extract"}
      onClose={() => setActiveModal(null)}
      title={t("Step 2 — Extract Features")}
      description={t("Pitch contours and speech representations for the preprocessed dataset.")}
      size="lg"
      icon={<Activity size={18} className="text-white" />}
    >
      <div className="modal-context">
        <Badge variant="neutral">{modelName || "…"}</Badge>
        <Badge variant={isCpu ? "warning" : "success"} dot>
          {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
        </Badge>
        <Badge variant="outline">{sampleRate} Hz</Badge>
      </div>
      <section className="modal-section" aria-label={t("Analysis models")}>
        <h3 className="modal-section-title">{t("Analysis models")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-ext-pitch-method">{t("Pitch extraction algorithm")}</label>
            <CustomSelect
              id="modal-ext-pitch-method"
              value={f0Method}
              onChange={(e) => setF0Method(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.pitchMethod)}
            >
              {["rmvpe", "fcpe", "swift", "crepe"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-ext-embedder-model">{t("Embedder Model")}</label>
            <CustomSelect
              id="modal-ext-embedder-model"
              value={embedder}
              onChange={(e) => setEmbedder(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.embedder)}
            >
              {["contentvec", "spin-v2", "custom"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          {embedder === "custom" && (
            <div className="sm:col-span-2">
              <label htmlFor="modal-ext-custom-embedder">{t("Select Custom Embedder")}</label>
              <input
                id="modal-ext-custom-embedder"
                type="text"
                value={embedderCustom}
                onChange={(e) => setEmbedderCustom(e.target.value)}
                placeholder="rvc/models/embedders/embedders_custom/my-embedder"
                aria-describedby={`${"modal-ext-custom-embedder"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.customEmbedder)} controlId={"modal-ext-custom-embedder"} />
              <TrainingUpload
                kind="embedder"
                disabled={busy || activeTraining || uploadsInProgress > 0}
                onUploaded={setEmbedderCustom}
                onBusyChange={onUploadBusyChange}
              />
            </div>
          )}
        </div>
      </section>
      <section className="modal-section" aria-label={t("Dataset")}>
        <h3 className="modal-section-title">{t("Dataset")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <SliderField
            id="modal-ext-include-mutes"
            label={t("Silent training files")}
            value={includeMutes}
            min={0}
            max={10}
            step={1}
            onChange={setIncludeMutes}
            description={t(SETTING_HELP.mutes)}
          />
          <div>
            <label htmlFor="modal-ext-sample-rate">{t("Sampling Rate")}</label>
            <CustomSelect
              id="modal-ext-sample-rate"
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
        </div>
      </section>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setActiveModal(null)}>
          {t("Cancel")}
        </Button>
        <Button
          loading={busy}
          onClick={runExtract}
          icon={<Play size={14} />}
          disabled={busy || activeTraining || uploadsInProgress > 0}
        >
          {busy ? t("Running…") : t("Run Extraction")}
        </Button>
      </div>
    </Modal>
  );
}
