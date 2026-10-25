"use client";

import { Flame, Play } from "lucide-react";
import type React from "react";
import TrainingUpload from "@/components/train/TrainingUpload";
import { Badge, Button, Modal, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

type StepModal = null | "preprocess" | "extract" | "train" | "index";

interface TrainingModalProps {
  activeModal: StepModal;
  setActiveModal: React.Dispatch<React.SetStateAction<StepModal>>;
  modelName: string;
  isCpu: boolean;
  gpuCount: string;
  vocoder: string;
  pickVocoder: (v: string) => void;
  indexAlgo: string;
  setIndexAlgo: React.Dispatch<React.SetStateAction<string>>;
  totalEpoch: number;
  setTotalEpoch: React.Dispatch<React.SetStateAction<number>>;
  batchSize: number;
  setBatchSize: React.Dispatch<React.SetStateAction<number>>;
  saveEvery: number;
  setSaveEvery: React.Dispatch<React.SetStateAction<number>>;
  pretrained: boolean;
  setPretrained: React.Dispatch<React.SetStateAction<boolean>>;
  saveOnlyLatest: boolean;
  setSaveOnlyLatest: React.Dispatch<React.SetStateAction<boolean>>;
  saveEveryWeights: boolean;
  setSaveEveryWeights: React.Dispatch<React.SetStateAction<boolean>>;
  cleanup: boolean;
  setCleanup: React.Dispatch<React.SetStateAction<boolean>>;
  cacheGpu: boolean;
  setCacheGpu: React.Dispatch<React.SetStateAction<boolean>>;
  checkpointing: boolean;
  setCheckpointing: React.Dispatch<React.SetStateAction<boolean>>;
  customPre: boolean;
  setCustomPre: React.Dispatch<React.SetStateAction<boolean>>;
  pretG: string[];
  gPath: string;
  setGPath: React.Dispatch<React.SetStateAction<string>>;
  onUploadBusyChange: (uploading: boolean) => void;
  busy: boolean;
  setPretG: React.Dispatch<React.SetStateAction<string[]>>;
  pretD: string[];
  dPath: string;
  setDPath: React.Dispatch<React.SetStateAction<string>>;
  setPretD: React.Dispatch<React.SetStateAction<string[]>>;
  runTrainStep: () => Promise<void>;
  activeTraining: boolean;
  uploadsInProgress: number;
}

export default function TrainingModal({ controls }: { controls: TrainingModalProps }) {
  const { t } = useI18n();
  const {
    activeModal,
    setActiveModal,
    modelName,
    isCpu,
    gpuCount,
    vocoder,
    pickVocoder,
    indexAlgo,
    setIndexAlgo,
    totalEpoch,
    setTotalEpoch,
    batchSize,
    setBatchSize,
    saveEvery,
    setSaveEvery,
    pretrained,
    setPretrained,
    saveOnlyLatest,
    setSaveOnlyLatest,
    saveEveryWeights,
    setSaveEveryWeights,
    cleanup,
    setCleanup,
    cacheGpu,
    setCacheGpu,
    checkpointing,
    setCheckpointing,
    customPre,
    setCustomPre,
    pretG,
    gPath,
    setGPath,
    onUploadBusyChange,
    busy,
    setPretG,
    pretD,
    dPath,
    setDPath,
    setPretD,
    runTrainStep,
    activeTraining,
    uploadsInProgress,
  } = controls;
  return (
    <Modal
      isOpen={activeModal === "train"}
      onClose={() => setActiveModal(null)}
      title={t("Step 3 — Model Training")}
      description={t("Generator and discriminator weights with automatic index build.")}
      size="xl"
      icon={<Flame size={18} className="text-white" />}
    >
      <div className="modal-context">
        <Badge variant="neutral">{modelName || "…"}</Badge>
        <Badge variant={isCpu ? "warning" : "success"} dot>
          {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
        </Badge>
        <Badge variant="outline">{vocoder}</Badge>
      </div>
      <section className="modal-section" aria-label={t("Architecture")}>
        <h3 className="modal-section-title">{t("Architecture")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-train-vocoder">{t("Vocoder")}</label>
            <CustomSelect
              id="modal-train-vocoder"
              value={vocoder}
              onChange={(e) => pickVocoder(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.vocoder)}
            >
              {["HiFi-GAN", "MRF HiFi-GAN", "RefineGAN"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-train-index-algo">{t("Index Algorithm")}</label>
            <CustomSelect
              id="modal-train-index-algo"
              value={indexAlgo}
              onChange={(e) => setIndexAlgo(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.indexAlgorithm)}
            >
              {["Auto", "Faiss", "KMeans"].map((s) => (
                <option key={s} value={s}>
                  {s === "Auto" ? t("Auto") : s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <SliderField
              id="modal-train-total-epoch"
              label={t("Total Epoch")}
              value={totalEpoch}
              min={1}
              max={10000}
              step={1}
              onChange={setTotalEpoch}
              description={t(SETTING_HELP.epochs)}
            />
          </div>
          <div>
            <SliderField
              id="modal-train-batch-size"
              label={t("Batch Size")}
              value={batchSize}
              min={1}
              max={64}
              step={1}
              onChange={setBatchSize}
              description={t(SETTING_HELP.batchSize)}
            />
          </div>
          <div className="sm:col-span-2">
            <SliderField
              id="modal-train-save-every"
              label={t("Save Every Epoch")}
              value={saveEvery}
              min={1}
              max={100}
              step={1}
              onChange={setSaveEvery}
              description={t(SETTING_HELP.saveEvery)}
            />
          </div>
        </div>
      </section>

      <section className="modal-section" aria-label={t("Checkpoints & performance")}>
        <h3 className="modal-section-title">{t("Checkpoints & performance")}</h3>
        <div className="modal-option-grid">
          <ToggleField
            id="modal-train-pretrained"
            label={t("Use pretrained model")}
            description={t(SETTING_HELP.pretrained)}
            checked={pretrained}
            onChange={setPretrained}
          />
          <ToggleField
            id="modal-train-save-latest"
            label={t("Save Only Latest")}
            checked={saveOnlyLatest}
            onChange={setSaveOnlyLatest}
            description={t(SETTING_HELP.saveLatest)}
          />
          <ToggleField
            id="modal-train-save-weights"
            label={t("Save Every Weights")}
            checked={saveEveryWeights}
            onChange={setSaveEveryWeights}
            description={t(SETTING_HELP.saveWeights)}
          />
          <ToggleField
            id="modal-train-cleanup"
            label={t("Fresh Training")}
            checked={cleanup}
            onChange={setCleanup}
            description={t(SETTING_HELP.fresh)}
          />
          <ToggleField
            id="modal-train-cache-gpu"
            label={t("Cache Dataset in GPU")}
            checked={cacheGpu}
            onChange={setCacheGpu}
            description={t(SETTING_HELP.cacheGPU)}
          />
          <ToggleField
            id="modal-train-checkpointing"
            label={t("Checkpointing")}
            checked={checkpointing}
            onChange={setCheckpointing}
            description={t(SETTING_HELP.checkpointing)}
          />
          <ToggleField
            id="modal-train-custom-pre"
            label={t("Custom Pretrained")}
            checked={customPre}
            onChange={setCustomPre}
            description={t(SETTING_HELP.customPretrained)}
          />
        </div>
      </section>
      {customPre && (
        <section className="modal-section" aria-label={t("Custom pretrained weights")}>
          <h3 className="modal-section-title">{t("Custom pretrained weights")}</h3>
          <div className="grid2">
            <div>
              <label htmlFor="modal-train-gpath">{t("Custom Pretrained G")}</label>
              {pretG.length > 0 ? (
                <CustomSelect
                  id="modal-train-gpath"
                  value={gPath}
                  onChange={(e) => setGPath(e.target.value)}
                  placeholder={t("Select pretrained G…")}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.pretrainedG)}
                >
                  <option value="">{t("Select pretrained G model…")}</option>
                  {pretG.map((p) => (
                    <option key={p} value={p}>
                      {p.split(/[\\/]/).pop() || p}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="modal-train-gpath"
                    type="text"
                    value={gPath}
                    onChange={(e) => setGPath(e.target.value)}
                    placeholder="assets/pretrained_v2/f0G40k.pth"
                    aria-describedby={`${"modal-train-gpath"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.pretrainedG)} controlId={"modal-train-gpath"} />
                </>
              )}
              <TrainingUpload
                kind="pretrained"
                label={t("Custom Pretrained G")}
                onBusyChange={onUploadBusyChange}
                disabled={busy}
                onUploaded={(path) => {
                  setPretG((current) => (current.includes(path) ? current : [...current, path].sort()));
                  setGPath(path);
                }}
              />
            </div>
            <div>
              <label htmlFor="modal-train-dpath">{t("Custom Pretrained D")}</label>
              {pretD.length > 0 ? (
                <CustomSelect
                  id="modal-train-dpath"
                  value={dPath}
                  onChange={(e) => setDPath(e.target.value)}
                  placeholder={t("Select pretrained D…")}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.pretrainedD)}
                >
                  <option value="">{t("Select pretrained D model…")}</option>
                  {pretD.map((p) => (
                    <option key={p} value={p}>
                      {p.split(/[\\/]/).pop() || p}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="modal-train-dpath"
                    type="text"
                    value={dPath}
                    onChange={(e) => setDPath(e.target.value)}
                    placeholder="assets/pretrained_v2/f0D40k.pth"
                    aria-describedby={`${"modal-train-dpath"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.pretrainedD)} controlId={"modal-train-dpath"} />
                </>
              )}
              <TrainingUpload
                kind="pretrained"
                label={t("Custom Pretrained D")}
                onBusyChange={onUploadBusyChange}
                disabled={busy}
                onUploaded={(path) => {
                  setPretD((current) => (current.includes(path) ? current : [...current, path].sort()));
                  setDPath(path);
                }}
              />
            </div>
          </div>
        </section>
      )}

      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setActiveModal(null)}>
          {t("Cancel")}
        </Button>
        <Button
          loading={busy}
          onClick={runTrainStep}
          icon={<Play size={14} />}
          disabled={busy || activeTraining || uploadsInProgress > 0}
        >
          {busy ? t("Running…") : t("Start Training")}
        </Button>
      </div>
    </Modal>
  );
}
