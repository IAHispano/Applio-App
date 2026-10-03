"use client";

import { AlertTriangle, ArrowRight, RefreshCw, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";

export default function SetupBarrier() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, loading, refresh } = useSetup();

  const failedChecks = status?.checks.filter((c) => c.status !== "ok") || [];

  return (
    <div className="w-full max-w-2xl mx-auto my-auto py-12 px-4 flex flex-col items-center justify-center animate-in fade-in duration-200">
      <Card className="w-full space-y-6 p-6 sm:p-8 text-center border-amber-500/20 bg-amber-500/[0.02]">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-lg">
            <AlertTriangle size={28} />
          </div>
          <div className="space-y-1">
            <Badge variant="warning" dot size="sm" className="mx-auto mb-2">
              {t("Setup Required")}
            </Badge>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white m-0">
              {t("Setup Required")}
            </h2>
            <p className="text-xs sm:text-sm text-neutral-400 max-w-md mx-auto leading-relaxed m-0 mt-1">
              {t(
                "Applio's core engine packages and Python environment are not ready yet. Please complete the initial setup to use this feature.",
              )}
            </p>
          </div>
        </div>

        {failedChecks.length > 0 && (
          <div className="text-left space-y-2 max-w-lg mx-auto w-full pt-2">
            <p className="text-xs font-semibold text-neutral-300 m-0">
              {t("Core engine dependencies are incomplete.")}
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {failedChecks.map((chk) => (
                <div
                  key={chk.id}
                  className="p-2.5 rounded-lg border border-white/5 bg-black/40 text-xs flex items-start gap-2.5"
                >
                  <span className="text-amber-400 font-bold shrink-0">!</span>
                  <div className="min-w-0">
                    <p className="font-medium text-white m-0 truncate">{chk.label}</p>
                    <p className="text-[11px] text-neutral-400 m-0 break-all">{chk.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
          <Button
            size="md"
            onClick={() => router.push("/")}
            icon={<Sparkles size={16} />}
            iconAfter={<ArrowRight size={14} />}
            className="w-full sm:w-auto"
          >
            {t("Go to Setup")}
          </Button>

          <Button
            variant="ghost"
            size="md"
            onClick={() => refresh(true)}
            disabled={loading}
            icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
            className="w-full sm:w-auto"
          >
            {loading ? t("Checking engine status…") : t("Retry Check")}
          </Button>

          <Link href="/settings" className="w-full sm:w-auto">
            <Button variant="ghost" size="md" icon={<Settings size={14} />} className="w-full">
              {t("Settings")}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
