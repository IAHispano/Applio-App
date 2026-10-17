"use client";

import { Radio } from "lucide-react";
import Link from "@/components/layout/IntentLink";
import { Alert } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRealtimeGpuReserved } from "@/lib/realtime-presence";

// Rendered above the scroll container, so the warning stays visible from any
// page while the realtime streaming session keeps the GPU reserved.
export default function RealtimeGpuBanner() {
  const reserved = useRealtimeGpuReserved();
  const { t } = useI18n();
  if (!reserved) return null;
  return (
    <div className="mt-3 px-3 sm:px-5 lg:px-6 2xl:px-8">
      <div className="mx-auto w-full max-w-[1920px]">
        <Alert
          variant="warning"
          icon={<Radio size={16} className="shrink-0" />}
          title={t("Realtime is streaming")}
        >
          {t(
            "The GPU is reserved for realtime. Inference, TTS, training, and separation jobs will wait until you stop streaming.",
          )}{" "}
          <Link href="/realtime" className="underline font-medium">
            {t("Open Realtime")}
          </Link>
        </Alert>
      </div>
    </div>
  );
}
