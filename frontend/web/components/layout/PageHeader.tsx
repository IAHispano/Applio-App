"use client";

import { BookOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import type React from "react";
import { Button } from "@/components/ui";
import { guideForPage } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";

interface PageHeaderProps {
  title: string;
  description?: string;
  status?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  guide?: false;
}

export default function PageHeader({
  title,
  description,
  status,
  children,
  className = "",
  guide,
}: PageHeaderProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const documentationHref = guide === false ? undefined : guideForPage(pathname);
  return (
    <header
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-[var(--border)] pt-1 pb-3 sm:pt-2 sm:pb-4 ${className}`}
    >
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-72 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="title text-[26px] sm:text-[32px] leading-tight text-[var(--heading)] m-0 wrap-anywhere">
            {title}
          </h1>
          {status}
        </div>
        {description && <p className="field-help m-0 max-w-2xl">{description}</p>}
      </div>
      {(children || documentationHref) && (
        <div className="flex flex-wrap items-center gap-[var(--action-gap)] min-w-0 max-w-full sm:justify-end">
          {children}
          {documentationHref && (
            <Button
              href={documentationHref}
              target="_blank"
              variant="ghost"
              icon={<BookOpen size={14} aria-hidden="true" />}
            >
              {t("User guide")}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
