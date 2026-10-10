"use client";

import { ChevronDown, Database, House, LayoutGrid, Mic, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/layout/IntentLink";
import { SidebarNavContent } from "@/components/layout/Sidebar";
import { IconButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

const PRIMARY_TABS = [
  { icon: House, label: "Home", to: "/" },
  { icon: Sparkles, label: "Inference", to: "/inference" },
  { icon: Mic, label: "TTS", to: "/tts" },
  { icon: Database, label: "Models", to: "/models" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setExpanded(false);
    moreRef.current?.focus();
  }, []);

  // Collapse the sheet on every route change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname signals route change
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  // Sheet behaves as a modal dialog: move focus in on open, trap Tab
  // inside, close on Escape and return focus to the More button.
  useEffect(() => {
    if (!expanded) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  const renderTab = (tab: (typeof PRIMARY_TABS)[number]) => {
    const Icon = tab.icon;
    const active = pathname === tab.to;
    return (
      <li key={tab.to} className="min-w-0">
        <Link
          href={tab.to}
          aria-current={active ? "page" : undefined}
          className={`relative flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 min-h-[52px] text-[10px] font-medium leading-none transition-colors focus-visible:outline-none ${
            active ? "text-[var(--accent)] bg-[var(--accent-soft)]" : "text-[var(--muted)]"
          }`}
        >
          {active && (
            <span className="absolute top-1 w-6 h-1 rounded-full bg-[var(--accent)]" aria-hidden="true" />
          )}
          <Icon size={19} aria-hidden="true" className="shrink-0" />
          <span className="truncate max-w-full">{t(tab.label)}</span>
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        onClick={close}
        aria-label={t("Close menu")}
        tabIndex={expanded ? 0 : -1}
        className={`lg:hidden absolute inset-0 z-30 bg-black/60 backdrop-blur-[2px] cursor-default transition-opacity duration-200 border-transparent rounded-none p-0 hover:bg-black/60 active:bg-black/60 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Expandable sheet with the full navigation */}
      <div
        id="mobile-menu-sheet"
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Menu")}
        aria-hidden={!expanded}
        inert={!expanded}
        className={`lg:hidden absolute left-3 right-3 bottom-[6rem] z-40 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl p-3 flex flex-col min-h-0 max-h-[min(78dvh,560px)] transition-all duration-200 ease-out ${
          expanded ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
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

      {/* Collapsed bar */}
      <nav
        aria-label={t("Primary Navigation")}
        className="lg:hidden absolute bottom-2 left-3 right-3 z-50 rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] backdrop-blur-md shadow-2xl px-1.5 pt-1.5"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        <ul className="list-none m-0 p-0 grid grid-cols-5 gap-0.5">
          {renderTab(PRIMARY_TABS[0])}
          {renderTab(PRIMARY_TABS[1])}
          <li className="min-w-0">
            <button
              type="button"
              ref={moreRef}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls="mobile-menu-sheet"
              aria-label={t("More")}
              style={{ backgroundColor: "transparent", borderColor: "transparent" }}
              className={`relative w-full flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[52px] text-[10px] font-medium leading-none transition-colors duration-200 focus-visible:outline-none bg-transparent border-transparent hover:bg-transparent active:bg-transparent ${
                expanded ? "text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              {expanded && (
                <span className="absolute top-1 w-6 h-1 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              )}
              <LayoutGrid size={19} aria-hidden="true" className="shrink-0" />
              <span className="truncate max-w-full">{t("More")}</span>
            </button>
          </li>
          {renderTab(PRIMARY_TABS[2])}
          {renderTab(PRIMARY_TABS[3])}
        </ul>
      </nav>
    </>
  );
}
