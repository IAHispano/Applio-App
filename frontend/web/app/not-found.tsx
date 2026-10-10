"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
      <h2 className="text-xl font-bold text-white">{t("Page Not Found")}</h2>
      <p className="text-sm text-neutral-400">{t("The requested page could not be found.")}</p>
      <Link href="/" className="cta px-4 py-2 text-xs font-semibold">
        {t("Return Home")}
      </Link>
    </div>
  );
}
