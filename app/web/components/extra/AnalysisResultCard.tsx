"use client";

import { Download, FileText, Image as ImageIcon, LineChart, StopCircle, Waves } from "lucide-react";
import { errMsg, fileBasename, outputUrl, stopJob } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useJob } from "../../lib/useJob";
import { Alert, Badge, Card } from "../ui";

interface AnalysisResultCardProps {
  jobId: string | null;
  title: string;
  type: "analyzer" | "f0";
  embedded?: boolean;
}

export default function AnalysisResultCard({
  jobId,
  title,
  type,
  embedded = false,
}: AnalysisResultCardProps) {
  const { t } = useI18n();
  const { job, error, setError } = useJob(jobId);

  if (!jobId) return null;

  if (error) {
    return (
      <Alert variant="error" className={embedded ? "mt-3" : ""}>
        {error}
      </Alert>
    );
  }

  if (!job) {
    return embedded ? (
      <div className="pt-3 mt-3 border-t border-white/10 text-center text-xs text-neutral-400">
        {t("Loading analysis…")}
      </div>
    ) : (
      <Card className="p-4 text-center text-xs text-neutral-400">{t("Loading analysis…")}</Card>
    );
  }

  const isRunning = job.status === "running" || job.status === "queued";
  const out = job.outputFile;
  const curveFile = typeof job.result?.curveFile === "string" ? job.result.curveFile : null;

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          {type === "analyzer" ? (
            <Waves size={18} className="text-white shrink-0" />
          ) : (
            <LineChart size={18} className="text-white shrink-0" />
          )}
          <h3 className="text-base font-bold text-white m-0">{title}</h3>
          <Badge
            variant={
              job.status === "done"
                ? "success"
                : job.status === "error"
                  ? "danger"
                  : isRunning
                    ? "info"
                    : "neutral"
            }
            dot
            size="sm"
          >
            {job.status === "done"
              ? t("Ready")
              : isRunning
                ? t("Analyzing…")
                : job.status === "error"
                  ? t("Failed")
                  : t("Queued")}
          </Badge>
        </div>

        {isRunning && (
          <button
            type="button"
            className="ghost h-7 px-2.5 text-xs text-red-400 hover:text-red-300 border-red-500/30 rounded-lg flex items-center gap-1.5 cursor-pointer"
            onClick={() => stopJob(job.id).catch((e) => setError(errMsg(e)))}
          >
            <StopCircle size={13} />
            <span>{t("Cancel")}</span>
          </button>
        )}
      </div>

      {job.status === "error" && (
        <Alert variant="error">{job.error || t("Analysis operation failed.")}</Alert>
      )}

      {isRunning && (
        <div className="py-4 space-y-3">
          <div className="loader" role="progressbar" aria-label={t("Analyzing audio…")}>
            <div className="loaderBar" />
          </div>
          <p className="text-xs text-neutral-400 text-center m-0">
            {type === "analyzer"
              ? t("Computing multi-band acoustic spectrogram and energy profiles…")
              : t("Calculating pitch contours across audio frames…")}
          </p>
        </div>
      )}

      {job.status === "done" && out && (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/60 p-2">
            {/* biome-ignore lint/performance/noImgElement: user-generated analysis plot */}
            <img
              src={outputUrl(out)}
              alt={`${title} visualization`}
              className="w-full h-auto rounded-lg object-contain max-h-[520px] 2xl:max-h-[720px]"
            />
          </div>

          {/* Action and Download Bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <span className="text-xs text-neutral-400">{fileBasename(out)}</span>

            <div className="flex items-center gap-2">
              {curveFile && (
                <a
                  href={outputUrl(curveFile)}
                  download
                  className="ghost h-9 px-3.5 rounded-xl text-xs font-medium flex items-center gap-1.5 text-neutral-200 hover:text-white"
                >
                  <FileText size={14} className="shrink-0" />
                  <span>{t("Download F0 CSV")}</span>
                </a>
              )}

              <a
                href={outputUrl(out)}
                download
                className="cta h-9 px-4 rounded-xl text-xs font-medium flex items-center gap-1.5 shrink-0"
              >
                <Download size={14} className="shrink-0" />
                <span>{t("Download Plot")}</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return embedded ? (
    <section
      className="space-y-4 pt-4 mt-4 border-t border-white/10 animate-in fade-in duration-200"
      aria-label={title}
    >
      {content}
    </section>
  ) : (
    <Card as="section" className="space-y-4 animate-in fade-in duration-200" aria-label={title}>
      {content}
    </Card>
  );
}
