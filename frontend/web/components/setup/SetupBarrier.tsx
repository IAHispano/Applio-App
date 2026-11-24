"use client";

import { AlertTriangle, ArrowRight, RefreshCw, Settings, Sparkles } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";

export default function SetupBarrier() {
  const { t } = useI18n();
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
            <h1 className="title text-2xl text-[var(--heading)] m-0">{t("Setup Required")}</h1>
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
                    <p className="font-medium text-[var(--heading)] m-0 wrap-anywhere">{chk.label}</p>
                    <p className="text-[11px] text-neutral-400 m-0 break-all">{chk.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="action-row mx-auto [--action-row-width:36rem]">
          <Button href="/setup" icon={<Sparkles size={16} />} iconAfter={<ArrowRight size={14} />}>
            {t("Go to Setup")}
          </Button>

          <Button
            variant="ghost"
            onClick={() => refresh(true)}
            disabled={loading}
            icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
          >
            {loading ? t("Checking engine status…") : t("Retry Check")}
          </Button>

          <Button href="/settings" variant="ghost" icon={<Settings size={14} />}>
            {t("Settings")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
