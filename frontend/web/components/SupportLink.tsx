"use client";

import { Heart } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { PATREON_URL, SUPPORT_URL } from "@/lib/support";

export default function SupportLink({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const linkClassName =
    "inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--heading)] transition-colors rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        <Heart size={14} aria-hidden="true" />
        {t("Support us")}
      </a>
      <span aria-hidden="true" className="text-xs text-[var(--muted)]">
        ·
      </span>
      <a href={PATREON_URL} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        {t("Patreon")}
      </a>
    </span>
  );
}
