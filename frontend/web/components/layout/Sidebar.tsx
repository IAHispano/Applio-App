"use client";

import { AlertTriangle, ArrowRight, BookOpen, Globe, MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import Link from "@/components/layout/IntentLink";
import { currentNavigation, NAV_SECTIONS, SETUP_OPTIONAL_ROUTES } from "@/components/layout/nav";
import SupportLink from "@/components/SupportLink";
import { REMOTE_HOST_ROUTES, useRemoteBridge } from "@/lib/bridge-mode";
import { DOCS_URL, WEBSITE_URL } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";
import { useSetup } from "@/lib/setup";
import { DISCORD_SUPPORT_URL } from "@/lib/support";
import webPackage from "@/package.json";

export function SidebarNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isReady, loading } = useSetup();
  const { remote } = useRemoteBridge();
  const navigation = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a route change updates aria-current
  useEffect(() => {
    const nav = navigation.current;
    if (!nav?.clientHeight || nav.scrollHeight <= nav.clientHeight) return;
    const current = nav.querySelector("[aria-current]");
    if (!current) return;
    const navTop = nav.getBoundingClientRect().top;
    const navBottom = navTop + nav.clientHeight;
    const item = current.getBoundingClientRect();
    if (item.top < navTop) nav.scrollTop -= navTop - item.top;
    else if (item.bottom > navBottom) nav.scrollTop += item.bottom - navBottom;
  }, [pathname]);
  const sections = remote
    ? NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !REMOTE_HOST_ROUTES.has(item.to)),
      })).filter((section) => section.items.length)
    : NAV_SECTIONS;

  return (
    <>
      {/* Brand Header */}
      <div className="px-3 pt-1 pb-1.5 mb-1 flex items-center justify-between shrink-0">
        <Link
          href={remote ? "/inference" : "/"}
          onNavigate={onNavigate}
          className="flex items-center gap-2.5 group rounded-lg min-w-0"
          aria-label={t("Applio - Home")}
        >
          <span
            aria-hidden="true"
            className="h-6 w-5 shrink-0 bg-[var(--heading)]"
            style={{
              maskImage: "url('/assets/applio-logo.svg')",
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
            }}
          />
          <span className="title text-xl text-[var(--heading)] group-hover:opacity-80 transition-opacity">
            Applio
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--muted)] border border-[var(--border)]">
            v{webPackage.version}
          </span>
        </Link>
      </div>

      {/* Setup Incomplete Notice */}
      {!remote && !isReady && !loading && (
        <div className="mx-1 my-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-400">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{t("Setup Required")}</span>
          </div>
          <p className="text-[11px] text-amber-200/80 mt-1 m-0">
            {t("Core engine dependencies are incomplete.")}
          </p>
          <Link
            href="/setup"
            onNavigate={onNavigate}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 transition-colors"
          >
            <span>{t("Complete Setup")}</span>
            <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Grouped Navigation */}
      <nav
        ref={navigation}
        className="space-y-2 pr-1 lg:flex-1 lg:min-h-0 lg:overflow-y-auto scrollbar-thin"
        aria-label={t("Main Navigation")}
      >
        {sections.map((section, sIdx) => (
          <div key={section.title || `sec-${sIdx}`} className="space-y-1">
            {section.title && (
              <h2 className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] select-none m-0">
                {t(section.title)}
              </h2>
            )}
            <ul className="space-y-0.5 list-none m-0 p-0">
              {section.items.map((item) => {
                const Icon = item.icon;
                const current = currentNavigation(pathname, item.to);
                const itemNeedsSetup = !isReady && !loading && !SETUP_OPTIONAL_ROUTES.has(item.to);

                return (
                  <li key={item.to}>
                    <Link
                      href={item.to}
                      onNavigate={onNavigate}
                      aria-current={current}
                      className={`nav-press flex items-center gap-2.5 px-3 py-2.5 lg:py-1.5 rounded-lg text-[13px] transition-colors duration-150 relative min-h-[44px] lg:min-h-8 ${
                        current
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                          : "text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface)]"
                      }`}
                    >
                      {current && (
                        <span
                          key={item.to}
                          className="nav-pill absolute left-1 w-1 h-3.5 bg-[var(--accent)] rounded-full"
                          aria-hidden="true"
                        />
                      )}
                      <Icon
                        aria-hidden="true"
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          current ? "text-[var(--accent)]" : "text-[var(--muted)]"
                        }`}
                      />
                      <span className="min-w-0 wrap-anywhere">{t(item.label)}</span>
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
      <div className="shrink-0 mt-2 px-3 pt-2 flex flex-col border-t border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-x-3">
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 min-h-7 py-1 text-xs text-[var(--muted)] hover:text-[var(--heading)] rounded-lg"
          >
            <Globe size={14} aria-hidden="true" />
            {t("Website")}
          </a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 min-h-7 py-1 text-xs text-[var(--muted)] hover:text-[var(--heading)] rounded-lg"
          >
            <BookOpen size={14} aria-hidden="true" />
            {t("Documentation")}
          </a>
        </div>
        <a
          href={DISCORD_SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 min-h-7 py-1 text-xs text-[var(--muted)] hover:text-[var(--heading)] transition-colors rounded-lg"
        >
          <MessageCircle size={14} aria-hidden="true" />
          {t("Discord support")}
        </a>
        <SupportLink className="min-h-7 py-1" />
      </div>
    </>
  );
}

export default function Sidebar() {
  const { t } = useI18n();
  return (
    <aside
      className="hidden lg:flex flex-col w-[var(--sidebar-w)] shrink-0 bg-[var(--panel)] border border-[var(--border)] text-[var(--text)] p-3 ml-[var(--sidebar-gap)] mr-0 my-4 rounded-xl select-none min-h-0 transition-colors duration-200"
      aria-label={t("Sidebar Navigation")}
    >
      <SidebarNavContent />
    </aside>
  );
}
