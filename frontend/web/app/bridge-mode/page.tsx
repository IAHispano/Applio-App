"use client";

import BridgeModeCard from "@/components/BridgeModeCard";
import PageHeader from "@/components/layout/PageHeader";
import { useI18n } from "@/lib/i18n";

export default function BridgeModePage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-[1280px] mx-auto page-stack">
      <PageHeader
        title={t("Bridge Mode")}
        description={t("Your Applio, on any device. Processing stays on this computer.")}
      />
      <BridgeModeCard />
    </div>
  );
}
