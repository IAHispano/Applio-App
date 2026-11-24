"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function Loading() {
  const { t } = useI18n();

  return (
    <div
      role="status"
      aria-live="polite"
      className="h-full w-full min-h-[160px] flex items-center justify-center gap-2 p-6 text-sm text-[var(--muted)]"
    >
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      <span>{t("Loading…")}</span>
    </div>
  );
}
