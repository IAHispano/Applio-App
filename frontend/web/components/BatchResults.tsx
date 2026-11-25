"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { errMsg, fetchJob, fileBasename, type Job } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export interface BatchResult {
  files: number;
  failed: number;
  total: number;
  outputFolder: string;
  itemCount: number;
  pageSize: number;
  items: { input: string; model: string; status: "running" | "done" | "error"; error?: string }[];
}

export default function BatchResults({ job }: { job: Job }) {
  const { t } = useI18n();
  const result = job.result as unknown as BatchResult | undefined;
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    page: number;
    revision: string;
    items?: BatchResult["items"];
    error?: string;
  }>();
  const pageSize = result?.pageSize ?? 1;
  const pages = Math.ceil((result?.itemCount ?? 0) / pageSize);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  const offset = currentPage * pageSize;
  const started = Math.min(pageSize, (result?.itemCount ?? 0) - offset);
  const settled = Math.max(0, Math.min(pageSize, (result?.files ?? 0) + (result?.failed ?? 0) - offset));
  const revision = `${currentPage}:${started}:${settled}:${retry}`;

  useEffect(() => {
    if (currentPage === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    void fetchJob(job.id, signal, currentPage)
      .then(({ job }) => {
        if (signal.aborted) return;
        const result = job.result as unknown as BatchResult | undefined;
        setLoaded({ page: currentPage, revision, items: result?.items ?? [] });
      })
      .catch((error) => {
        if (!signal.aborted) setLoaded({ page: currentPage, revision, error: errMsg(error) });
      });
    return () => controller.abort();
  }, [currentPage, job.id, revision]);

  if (!result?.itemCount) return null;
  const items = currentPage === 0 ? result.items : loaded?.page === currentPage ? loaded.items : undefined;
  const error = loaded?.revision === revision ? loaded.error : undefined;
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
      {error ? (
        <Alert variant="error">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">{error}</span>
            <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
              {t("Retry")}
            </Button>
          </div>
        </Alert>
      ) : (
        !items && (
          <p className="field-help" role="status">
            {t("Loading…")}
          </p>
        )
      )}
      <div className="space-y-2">
        {items?.map((item, index) => {
          const output = `/api/inference/batch/${encodeURIComponent(job.id)}/outputs/${offset + index}`;
          return (
            <div key={output} className="rounded-xl border border-[var(--border)] p-3 space-y-2">
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
              {item.error && (
                <p className="text-xs text-[var(--danger-text)] m-0 break-words">{item.error}</p>
              )}
              {item.status === "done" && (
                <div className="form-action-row">
                  {/* biome-ignore lint/a11y/useMediaCaption: User-generated voice conversion has no transcript available. */}
                  <audio
                    controls
                    preload="none"
                    className="h-[var(--action-height)] w-full min-w-0"
                    aria-label={`${item.input} — ${fileBasename(item.model)}`}
                    src={output}
                  />
                  <Button
                    variant="ghost"
                    href={output}
                    download={fileBasename(item.input)}
                    icon={<Download size={14} />}
                  >
                    {t("Download")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <div className="pagination-actions ms-auto">
          <Button variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            {t("Previous")}
          </Button>
          <span className="field-help">
            {currentPage + 1} / {pages}
          </span>
          <Button
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
