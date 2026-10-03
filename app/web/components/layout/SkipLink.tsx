"use client";

import { useI18n } from "@/lib/i18n";

export default function SkipLink() {
  const { t } = useI18n();

  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:font-semibold focus:rounded-lg focus:shadow-xl focus:outline-2 focus:outline-white"
    >
      {t("Skip to main content")}
    </a>
  );
}
