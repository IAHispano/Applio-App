"use client";

import { ChevronDown, Download } from "lucide-react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import { JobBadge, JobCancelButton, JobError, JobProgress } from "@/components/JobStatus";
import { Alert, Button, Card } from "@/components/ui";
import { fileBasename, isAudioFile, isImageFile, outputUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";

export interface JobPanelProps {
  jobId: string | null;
  compact?: boolean;
  showLogs?: boolean;
  embedded?: boolean;
}

// Polls a job, shows status, and renders its output file cleanly without CLI clutter.
export default function JobPanel({ jobId, compact, showLogs = false, embedded = false }: JobPanelProps) {
  const { t } = useI18n();
  const { job, error, setError, cleanedLogs } = useJob(jobId);

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
      <div className="pt-3 mt-3 border-t border-white/10">
        <p className="text-xs text-neutral-400 m-0">{t("Loading activity…")}</p>
      </div>
    ) : (
      <Card className="p-4">
        <p className="text-xs text-neutral-400 m-0">{t("Loading activity…")}</p>
      </Card>
    );
  }

  const out = job.outputFile;
  const sidecars: Array<{ label: string; file: string }> = [];
  if (job.result) {
    for (const [k, v] of Object.entries(job.result)) {
      if (
        typeof v === "string" &&
        (v.endsWith(".txt") ||
          v.endsWith(".png") ||
          v.endsWith(".pth") ||
          v.endsWith(".wav") ||
          v.endsWith(".mp4") ||
          v.endsWith(".webm")) &&
        v !== out
      ) {
        sidecars.push({ label: k, file: v });
      }
    }
  }

  const resultMsg = typeof job.result?.message === "string" ? job.result.message : null;
  const resultInfo = typeof job.result?.info === "string" ? job.result.info : null;

  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <JobBadge status={job.status} />
          <span className="text-neutral-400 text-xs font-medium">{t("Activity")}</span>
        </div>
        {(job.status === "queued" || job.status === "running") && (
          <JobCancelButton jobId={job.id} onError={setError} />
        )}
      </div>

      {job.status === "error" && <JobError message={job.error} />}

      <JobProgress status={job.status} />

      {resultMsg && <p className="text-xs font-medium text-white m-0">{resultMsg}</p>}

      {resultInfo && (
        <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
          <p className="text-neutral-400 text-xs font-medium m-0">{t("Analysis details")}</p>
          <p className="text-xs text-neutral-200 leading-relaxed m-0 whitespace-pre-wrap">{resultInfo}</p>
        </div>
      )}

      {out && isAudioFile(out) && <AudioWavePlayer src={outputUrl(out)} filename={fileBasename(out)} />}

      {out && isImageFile(out) && (
        <div className="space-y-2">
          {/* biome-ignore lint/performance/noImgElement: user-generated plot */}
          <img
            src={outputUrl(out)}
            alt={`Analysis plot result for job ${job.id}`}
            className="w-full h-auto rounded-xl border border-white/10"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-neutral-400">({fileBasename(out)})</span>
            <Button href={outputUrl(out)} download size="sm" icon={<Download size={13} />}>
              {t("Download image")}
            </Button>
          </div>
        </div>
      )}

      {out && !isAudioFile(out) && !isImageFile(out) && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/5">
          <span className="text-xs text-neutral-300 font-medium truncate">{fileBasename(out)}</span>
          <Button href={outputUrl(out)} download size="sm" icon={<Download size={13} />}>
            {t("Download")}
          </Button>
        </div>
      )}

      {sidecars.map((s) => (
        <div
          key={s.label}
          className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5"
        >
          <span className="text-xs text-neutral-300">
            {s.label}: {fileBasename(s.file)}
          </span>
          <Button href={outputUrl(s.file)} download variant="ghost" size="xs" icon={<Download size={12} />}>
            {t("Download")}
          </Button>
        </div>
      ))}

      {showLogs && !compact && cleanedLogs.length > 0 && (
        <details className="pt-2 text-xs text-neutral-400 group border-t border-white/5">
          <summary className="cursor-pointer hover:text-white transition-colors py-1 flex items-center gap-1.5 select-none font-medium">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180 shrink-0" />
            <span>{t("Activity Details")}</span>
          </summary>
          <div
            className="mt-2 max-h-48 overflow-y-auto text-xs p-3 rounded-xl bg-black/50 border border-white/10 space-y-0.5"
            role="log"
          >
            {cleanedLogs.slice(-60).map((l, idx) => (
              <p key={idx} className="m-0 leading-relaxed text-neutral-300">
                {l}
              </p>
            ))}
          </div>
        </details>
      )}
    </>
  );

  return embedded ? (
    <section
      className="space-y-3 pt-3.5 mt-3.5 border-t border-white/10 animate-in fade-in duration-200"
      aria-label={t("Task Activity")}
    >
      {content}
    </section>
  ) : (
    <Card as="section" className="space-y-3 animate-in fade-in duration-200" aria-label={t("Task Activity")}>
      {content}
    </Card>
  );
}
