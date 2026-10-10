"use client";

import { Heart } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { SUPPORT_URL } from "@/lib/support";

export default function SupportLink({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--heading)] transition-colors rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${className}`}
    >
      <Heart size={14} aria-hidden="true" />
      {t("Support us")}
    </a>
  );
}
