"use client";

import { AlertTriangle, ArrowRight, MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "@/components/layout/IntentLink";
import { NAV_SECTIONS } from "@/components/layout/nav";
import SupportLink from "@/components/SupportLink";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";
import { DISCORD_SUPPORT_URL } from "@/lib/support";
import webPackage from "@/package.json";

export function SidebarNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isReady, loading } = useSetup();

  return (
    <>
      {/* Brand Header */}
      <div className="px-3 pt-1 pb-1.5 mb-1 flex items-center justify-between shrink-0">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 group rounded-lg focus-visible:outline-none min-w-0"
          aria-label={t("Applio - Home")}
        >
          <span className="title text-xl text-[var(--heading)] group-hover:opacity-80 transition-opacity">
            Applio
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--muted)] border border-[var(--border)]">
            v{webPackage.version}
          </span>
        </Link>
      </div>

      {/* Setup Incomplete Notice */}
      {!isReady && !loading && (
        <div className="mx-1 my-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-400">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{t("Setup Required")}</span>
          </div>
          <p className="text-[11px] text-amber-200/80 mt-1 m-0">
            {t("Core engine dependencies are incomplete.")}
          </p>
          <Link
            href="/"
            onClick={onNavigate}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 transition-colors"
          >
            <span>{t("Complete Setup")}</span>
            <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Grouped Navigation */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-thin"
        aria-label={t("Main Navigation")}
      >
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title || `sec-${sIdx}`} className="space-y-1">
            {section.title && (
              <h2 className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] select-none m-0">
                {t(section.title)}
              </h2>
            )}
            <ul className="space-y-0.5 list-none m-0 p-0">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                const itemNeedsSetup =
                  !isReady && !loading && item.to !== "/" && item.to !== "/settings" && item.to !== "/report";

                return (
                  <li key={item.to}>
                    <Link
                      href={item.to}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 px-3 py-2.5 lg:py-1.5 rounded-lg text-[13px] transition-colors duration-150 relative min-h-[44px] lg:min-h-8 ${
                        active
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                          : itemNeedsSetup
                            ? "text-[var(--muted)] opacity-70 hover:opacity-100 hover:text-[var(--heading)] hover:bg-[var(--surface)]"
                            : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute left-1 w-1 h-3.5 bg-[var(--accent)] rounded-full"
                          aria-hidden="true"
                        />
                      )}
                      <Icon
                        aria-hidden="true"
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          active ? "text-[var(--accent)]" : "text-[var(--muted)]"
                        }`}
                      />
                      <span className="truncate">{t(item.label)}</span>
                      {item.badge ? (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--muted)] font-medium border border-[var(--border)]">
                          {t(item.badge)}
                        </span>
                      ) : itemNeedsSetup ? (
                        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium border border-amber-500/20">
                          {t("Setup")}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 mt-2 px-3 flex flex-col">
        <a
          href={DISCORD_SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 py-2 text-xs text-[var(--muted)] hover:text-[var(--heading)] transition-colors rounded-lg"
        >
          <MessageCircle size={14} aria-hidden="true" />
          {t("Discord support")}
        </a>
        <SupportLink className="py-2" />
      </div>
    </>
  );
}

export default function Sidebar() {
  const { t } = useI18n();
  return (
    <aside
      className="hidden lg:flex flex-col w-[248px] shrink-0 bg-[var(--panel)] border border-[var(--border)] text-[var(--text)] p-3 ml-3 mr-0 my-4 rounded-xl select-none min-h-0 transition-colors duration-200"
      aria-label={t("Sidebar Navigation")}
    >
      <SidebarNavContent />
    </aside>
  );
}
