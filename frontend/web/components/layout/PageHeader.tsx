"use client";

import { BookOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import type React from "react";
import { guideForPage } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  guide?: false;
}

export default function PageHeader({ title, description, children, className = "", guide }: PageHeaderProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const documentationHref = guide === false ? undefined : guideForPage(pathname);
  return (
    <div
      className={`flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4 ${className}`}
    >
      <div className="space-y-1 min-w-0 sm:flex-1 sm:basis-64">
        <h1 className="title text-2xl sm:text-[28px] leading-tight text-[var(--heading)] m-0 break-words">
          {title}
        </h1>
        {description && (
          <p className="text-[13px] sm:text-sm text-[var(--muted)] m-0 max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {(children || documentationHref) && (
        <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
          {documentationHref && (
            <a
              href={documentationHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-2 text-xs text-[var(--muted)] hover:text-[var(--heading)] hover:bg-[var(--surface)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <BookOpen size={14} aria-hidden="true" />
              {t("User guide")}
            </a>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
