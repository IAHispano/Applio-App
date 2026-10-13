"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { fileBasename, type Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export interface BatchResult {
  files: number;
  failed: number;
  total: number;
  outputFolder: string;
  items: { input: string; model: string; status: "running" | "done" | "error"; error?: string }[];
}

export default function BatchResults({ job }: { job: Job }) {
  const { t } = useI18n();
  const result = job.result as unknown as BatchResult | undefined;
  const [page, setPage] = useState(0);
  if (!result?.items?.length) return null;
  const pages = Math.ceil(result.items.length / 20);
  const currentPage = Math.min(page, pages - 1);
  return (
    <section className="space-y-3" aria-label={t("Batch results")}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold m-0">{t("Batch results")}</h3>
        <p className="field-help m-0" role="status">
          {t("{done} completed · {failed} failed · {total} total", {
            done: result.files,
            failed: result.failed,
            total: result.total,
          })}
        </p>
      </div>
      <div className="space-y-2">
        {result.items.slice(currentPage * 20, currentPage * 20 + 20).map((item, index) => (
          <div
            key={`${item.model}:${item.input}`}
            className="rounded-xl border border-[var(--border)] p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium m-0 break-all">{item.input}</p>
                <p className="field-help m-0 break-all">{fileBasename(item.model)}</p>
              </div>
              <span className="text-xs text-[var(--muted)] shrink-0">
                {t(
                  item.status === "done"
                    ? "Completed"
                    : item.status === "error"
                      ? "Failed"
                      : job.status === "error"
                        ? "Stopped"
                        : "In Progress",
                )}
              </span>
            </div>
            {item.error && <p className="text-xs text-[var(--danger-text)] m-0 break-words">{item.error}</p>}
            {item.status === "done" && (
              <div className="flex gap-3 items-center flex-wrap">
                {/* biome-ignore lint/a11y/useMediaCaption: User-generated voice conversion has no transcript available. */}
                <audio
                  controls
                  preload="none"
                  className="h-9 max-w-full"
                  aria-label={`${item.input} — ${fileBasename(item.model)}`}
                  src={`/api/inference/batch/${encodeURIComponent(job.id)}/outputs/${currentPage * 20 + index}`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  href={`/api/inference/batch/${encodeURIComponent(job.id)}/outputs/${currentPage * 20 + index}`}
                  download
                  icon={<Download size={14} />}
                >
                  {t("Download")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="flex justify-end gap-2 items-center">
          <Button
            size="xs"
            variant="ghost"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("Previous")}
          </Button>
          <span className="field-help">
            {currentPage + 1} / {pages}
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("Next")}
          </Button>
        </div>
      )}
    </section>
  );
}
