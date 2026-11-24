"use client";

import {
  Activity,
  AudioWaveform,
  ChevronDown,
  Database,
  House,
  LayoutGrid,
  Mic,
  Sparkles,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "@/components/layout/IntentLink";
import { currentNavigation } from "@/components/layout/nav";
import { SidebarNavContent } from "@/components/layout/Sidebar";
import { Dialog, IconButton } from "@/components/ui";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

const PRIMARY_TABS = [
  { icon: House, label: "Home", to: "/" },
  { icon: Sparkles, label: "Convert Audio", to: "/inference" },
  { icon: Mic, label: "Text to Speech", to: "/tts" },
  { icon: Database, label: "Models", to: "/models" },
] as const;

export function BottomNav() {
  const { remote } = useRemoteBridge();
  const tabs = remote
    ? [
        { icon: Sparkles, label: "Convert Audio", to: "/inference" },
        { icon: AudioWaveform, label: "Audio Separator", to: "/audio-separator" },
        { icon: Mic, label: "Text to Speech", to: "/tts" },
        { icon: Activity, label: "Job history", to: "/jobs" },
      ]
    : PRIMARY_TABS;
  const pathname = usePathname();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const closedForDesktop = useRef(false);
  const moreActive = expanded || !tabs.some((tab) => currentNavigation(pathname, tab.to));

  const close = () => setExpanded(false);

  useEffect(() => {
    if (!expanded) {
      if (closedForDesktop.current) {
        closedForDesktop.current = false;
        document.getElementById("main-content")?.focus({ preventScroll: true });
      }
      return;
    }
    // A hidden native modal still makes the rest of the page inert.
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (!desktop.matches) return;
      closedForDesktop.current = true;
      setExpanded(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [expanded]);

  // Collapse the sheet on every route change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname signals route change
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  const renderTab = (tab: { icon: typeof House; label: string; to: string }) => {
    const Icon = tab.icon;
    const current = currentNavigation(pathname, tab.to);
    const active = current && !expanded;
    return (
      <li key={tab.to} className="min-w-0">
        <Link
          href={tab.to}
          aria-current={current}
          className={`nav-press relative flex h-full flex-col items-center gap-1 rounded-xl px-1 py-2 min-h-[52px] text-center text-[10px] font-medium transition-colors ${
            active ? "nav-tab-active text-[var(--accent)] bg-[var(--accent-soft)]" : "text-[var(--muted)]"
          }`}
        >
          {active && (
            <span
              key={tab.to}
              className="nav-pill absolute top-1 w-6 h-1 rounded-full bg-[var(--accent)]"
              aria-hidden="true"
            />
          )}
          <Icon size={19} aria-hidden="true" className="shrink-0" />
          <span className="line-clamp-3 min-h-6 max-w-full wrap-anywhere leading-[1.15]">{t(tab.label)}</span>
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Expandable sheet with the full navigation */}
      <Dialog
        id="mobile-menu-sheet"
        isOpen={expanded}
        onClose={close}
        aria-label={t("Menu")}
        className="lg:hidden bg-black/60 backdrop-blur-[2px] modal-backdrop"
      >
        <div className="absolute left-3 right-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl p-3 flex flex-col min-h-0 max-h-[min(560px,calc(100dvh-7rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] modal-panel">
          <div className="flex items-center justify-end shrink-0 pb-1">
            <IconButton
              icon={<ChevronDown size={20} aria-hidden="true" />}
              label={t("Close menu")}
              onClick={close}
            />
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            <SidebarNavContent onNavigate={close} />
          </div>
        </div>
      </Dialog>

      {/* Collapsed bar */}
      <nav
        aria-label={t("Primary Navigation")}
        className="lg:hidden absolute bottom-2 left-3 right-3 z-50 rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] backdrop-blur-md shadow-2xl px-1.5 pt-1.5"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        <ul className="list-none m-0 p-0 grid grid-cols-5 gap-0.5">
          {renderTab(tabs[0])}
          {renderTab(tabs[1])}
          <li className="min-w-0">
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.focus();
                setExpanded(true);
              }}
              aria-expanded={expanded}
              aria-haspopup="dialog"
              aria-controls={expanded ? "mobile-menu-sheet" : undefined}
              aria-label={t("More")}
              style={{
                borderColor: "transparent",
                backgroundColor: moreActive ? "var(--accent-soft)" : "transparent",
              }}
              className={`relative h-full w-full flex flex-col items-center gap-1 px-1 py-2 min-h-[52px] text-[10px] font-medium transition-colors duration-200 bg-transparent border-transparent hover:bg-transparent active:bg-transparent ${
                moreActive ? "text-[var(--accent)] rounded-xl" : "text-[var(--muted)]"
              }`}
            >
              {moreActive && (
                <span
                  key={expanded ? "more-open" : pathname}
                  className="nav-pill absolute top-1 w-6 h-1 rounded-full bg-[var(--accent)]"
                  aria-hidden="true"
                />
              )}
              <LayoutGrid size={19} aria-hidden="true" className="shrink-0" />
              <span className="line-clamp-3 min-h-6 max-w-full wrap-anywhere leading-[1.15]">
                {t("More")}
              </span>
            </button>
          </li>
          {renderTab(tabs[2])}
          {renderTab(tabs[3])}
        </ul>
      </nav>
    </>
  );
}
