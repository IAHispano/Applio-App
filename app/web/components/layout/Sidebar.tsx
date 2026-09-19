"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../../lib/i18n";
import webPackage from "../../package.json";
import { NAV_SECTIONS } from "./nav";

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside
      className="flex flex-col w-64 shrink-0 bg-[var(--panel)] backdrop-blur-md border border-[var(--border)] text-[var(--text)] p-3 ml-3 mr-0 my-4 rounded-2xl select-none min-h-0 transition-colors duration-200"
      aria-label="Sidebar Navigation"
    >
      {/* Brand Header */}
      <div className="px-3 pt-2 pb-3 mb-1 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <Link
          href="/"
          prefetch={true}
          className="flex items-center gap-2.5 group rounded-lg focus-visible:outline-none"
          aria-label="Applio - Home"
        >
          <span className="text-lg font-semibold tracking-tight text-[var(--heading)] group-hover:opacity-80 transition-opacity">
            Applio
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--muted)] border border-[var(--border)]">
            v{webPackage.version}
          </span>
        </Link>
      </div>

      {/* Grouped Navigation */}
      <nav
        className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 scrollbar-thin"
        aria-label="Main Navigation"
      >
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title || `sec-${sIdx}`} className="space-y-1">
            {section.title && (
              <h2 className="px-3 pt-1 pb-1 text-xs font-semibold text-[var(--muted)] select-none m-0">
                {t(section.title)}
              </h2>
            )}
            <ul className="space-y-0.5 list-none m-0 p-0">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                return (
                  <li key={item.to}>
                    <Link
                      href={item.to}
                      prefetch={true}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 relative focus-visible:outline-none ${
                        active
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium shadow-xs"
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
                      {item.badge && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--muted)] font-medium border border-[var(--border)]">
                          {t(item.badge)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
