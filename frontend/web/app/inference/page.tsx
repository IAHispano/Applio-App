"use client";

import { Layers, Music } from "lucide-react";
import BatchForm from "@/components/BatchForm";
import InferenceForm from "@/components/InferenceForm";
import PageHeader from "@/components/layout/PageHeader";
import PersistentWorkspace from "@/components/layout/PersistentWorkspace";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { useI18n } from "@/lib/i18n";
import { useWorkspaceState } from "@/lib/workspace-state";

export default function InferencePage() {
  const [mode, setMode] = useWorkspaceState<"single" | "batch">("page:inference:mode", "single");
  const { t } = useI18n();

  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader
        title={t("Convert Audio")}
        description={t("Convert audio files using trained voice models with single and batch processing.")}
      >
        <SegmentedControl
          value={mode}
          onChange={setMode}
          ariaLabel={t("Convert Audio")}
          tabPanels
          options={[
            { value: "single", label: t("Single"), icon: Music },
            { value: "batch", label: t("Batch"), icon: Layers },
          ]}
        />
      </PageHeader>
      <PersistentWorkspace active={mode === "single"}>
        <div id="panel-single" role="tabpanel" aria-labelledby="tab-single">
          <InferenceForm />
        </div>
      </PersistentWorkspace>
      <PersistentWorkspace active={mode === "batch"}>
        <div id="panel-batch" role="tabpanel" aria-labelledby="tab-batch">
          <BatchForm />
        </div>
      </PersistentWorkspace>
    </div>
  );
}
