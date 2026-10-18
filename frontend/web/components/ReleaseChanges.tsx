"use client";

import { ECOSYSTEM } from "@/lib/ecosystem";
import { useI18n } from "@/lib/i18n";
import { releaseLinks, releaseNoteParts } from "@/lib/update-policy";

export default function ReleaseChanges({
  local,
  latest,
  notes,
}: {
  local: string;
  latest: string;
  notes?: string;
}) {
  const { t } = useI18n();
  const repository = ECOSYSTEM.projects.desktop.repository;
  const links = releaseLinks(repository, local, latest);
  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs font-semibold m-0">{t("What's changed")}</p>
      {notes && (
        <div className="max-h-48 overflow-y-auto rounded-xl bg-black/20 p-3 space-y-2 text-xs break-words">
          {notes
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => (
              <p key={line} className="m-0 leading-relaxed">
                {releaseNoteParts(line.replace(/^#{1,6}\s+/, ""), repository).map((part) =>
                  part.href ? (
                    <a
                      key={part.key}
                      href={part.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-white"
                    >
                      {part.text}
                    </a>
                  ) : (
                    <span key={part.key}>{part.text}</span>
                  ),
                )}
              </p>
            ))}
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-xs">
        <a
          href={links.release}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          {t("Release notes on GitHub")}
        </a>
        {links.compare && (
          <a
            href={links.compare}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {t("Compare all changes")}
          </a>
        )}
      </div>
    </div>
  );
}
