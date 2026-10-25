"use client";
import { Database, Play } from "lucide-react";
import type React from "react";
import { Badge, Button, Modal } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

type StepModal = null | "preprocess" | "extract" | "train" | "index";

interface IndexModalProps {
  activeModal: StepModal;
  setActiveModal: React.Dispatch<React.SetStateAction<StepModal>>;
  modelName: string;
  indexAlgo: string;
  setIndexAlgo: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  runIndex: () => Promise<void>;
  activeTraining: boolean;
  uploadsInProgress: number;
}

export default function IndexModal({ controls }: { controls: IndexModalProps }) {
  const { t } = useI18n();
  const {
    activeModal,
    setActiveModal,
    modelName,
    indexAlgo,
    setIndexAlgo,
    busy,
    runIndex,
    activeTraining,
    uploadsInProgress,
  } = controls;
  return (
    <Modal
      isOpen={activeModal === "index"}
      onClose={() => setActiveModal(null)}
      title={t("Step 4 — Generate Index")}
      description={t("Re-runnable after training. Improves inference similarity.")}
      size="md"
      icon={<Database size={18} className="text-white" />}
    >
      <div className="modal-context">
        <Badge variant="neutral">{modelName || "…"}</Badge>
        <Badge variant="outline">{indexAlgo}</Badge>
      </div>
      <div>
        <label htmlFor="modal-index-algo">{t("Index Algorithm")}</label>
        <CustomSelect
          id="modal-index-algo"
          value={indexAlgo}
          onChange={(e) => setIndexAlgo(e.target.value)}
          className="w-full mt-1"
          description={t(SETTING_HELP.indexAlgorithm)}
        >
          {["Auto", "Faiss", "KMeans"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </CustomSelect>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={() => setActiveModal(null)}>
          {t("Cancel")}
        </Button>
        <Button
          loading={busy}
          onClick={runIndex}
          icon={<Play size={14} />}
          disabled={busy || activeTraining || uploadsInProgress > 0}
        >
          {busy ? t("Running…") : t("Generate Index")}
        </Button>
      </div>
    </Modal>
  );
}
