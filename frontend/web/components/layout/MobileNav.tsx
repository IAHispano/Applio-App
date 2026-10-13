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
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/layout/IntentLink";
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
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const moreActive = expanded || !tabs.some((tab) => pathname === tab.to);

  const close = useCallback(() => {
    setExpanded(false);
    moreRef.current?.focus();
  }, []);

  // Collapse the sheet on every route change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname signals route change
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  const renderTab = (tab: { icon: typeof House; label: string; to: string }) => {
    const Icon = tab.icon;
    const currentPage = pathname === tab.to;
    const active = currentPage && !expanded;
    return (
      <li key={tab.to} className="min-w-0">
        <Link
          href={tab.to}
          aria-current={currentPage ? "page" : undefined}
          className={`nav-press relative flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 min-h-[52px] text-[10px] font-medium leading-none transition-colors focus-visible:outline-none ${
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
          <span className="truncate max-w-full">{t(tab.label)}</span>
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
        <div className="absolute left-3 right-3 bottom-[6rem] rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl p-3 flex flex-col min-h-0 max-h-[min(78dvh,560px)] modal-panel">
          <div className="flex items-center justify-end shrink-0 pb-1">
            <IconButton
              icon={<ChevronDown size={20} aria-hidden="true" />}
              label={t("Close menu")}
              onClick={close}
              tabIndex={expanded ? 0 : -1}
              className="!h-10 !w-10 !min-w-10 !min-h-10 !max-w-10 !max-h-10 !rounded-xl border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
            />
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            <SidebarNavContent onNavigate={() => setExpanded(false)} />
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
              ref={moreRef}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-haspopup="dialog"
              aria-controls="mobile-menu-sheet"
              aria-label={t("More")}
              style={{
                borderColor: "transparent",
                backgroundColor: moreActive ? "var(--accent-soft)" : "transparent",
              }}
              className={`relative w-full flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[52px] text-[10px] font-medium leading-none transition-colors duration-200 focus-visible:outline-none bg-transparent border-transparent hover:bg-transparent active:bg-transparent ${
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
              <span className="truncate max-w-full">{t("More")}</span>
            </button>
          </li>
          {renderTab(tabs[2])}
          {renderTab(tabs[3])}
        </ul>
      </nav>
    </>
  );
}
