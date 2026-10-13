"use client";

import { Check, ClipboardCheck, FolderCheck, Play, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JobStage } from "@/components/JobStatus";
import { Alert, Badge, Button, Card, CardHeader, Disclosure, ToggleField } from "@/components/ui";
import ProgressBar from "@/components/ui/ProgressBar";
import { apiGet, apiSend, errMsg, stopJob, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";
import TrainingUpload from "./TrainingUpload";

type Issue = "duplicate" | "clipping" | "silence" | "level" | "unreadable" | "no-signal";
interface Section {
  start: number;
  end: number;
}
interface Clip {
  id: string;
  path: string;
  issues: Issue[];
  duration?: number;
  peakDb?: number;
  activeRmsDb?: number;
  silenceFraction?: number;
  duplicateOf?: string;
  error?: string;
  clippingSections?: Section[];
  silenceSections?: Section[];
  clippingSectionCount?: number;
  silenceSectionCount?: number;
}
interface Review {
  root: string;
  clips: Clip[];
  silenceDb: number;
  medianLevelDb: number | null;
  skippedLinks: string[];
  summary: {
    files: number;
    duration: number;
    flagged: number;
    duplicate: number;
    clipping: number;
    silence: number;
    level: number;
    unreadable: number;
  };
}
const ISSUES: Record<Issue, string> = {
  duplicate: "Duplicate",
  clipping: "Clipped peaks",
  silence: "Excessive silence",
  level: "Level mismatch",
  unreadable: "Unreadable",
  "no-signal": "No usable signal",
};
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const sectionClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;

export default function DatasetReview({
  datasetPath,
  datasets,
  onDatasetChange,
  onDatasetUploaded,
  onUploadBusyChange,
}: {
  datasetPath: string;
  datasets: string[];
  onDatasetChange: (path: string) => void;
  onDatasetUploaded: (path: string) => void;
  onUploadBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, error: jobError } = useJob(jobId);
  const [reviewId, setReviewId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("flagged");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"scan" | "prepare">("scan");
  const [source, setSource] = useState("");
  const [prepared, setPrepared] = useState("");
  const [trimSilence, setTrimSilence] = useState(true);
  const [normalize, setNormalize] = useState(false);
  const [lowerPeaks, setLowerPeaks] = useState(false);
  const [silenceDb, setSilenceDb] = useState(-50);
  const [previewId, setPreviewId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekRef = useRef(0);
  const active =
    submitting ||
    (!!jobId && !jobError && job?.id !== jobId) ||
    job?.status === "queued" ||
    job?.status === "running";
  const stale = !!source && source !== datasetPath;

  useEffect(() => {
    if (job?.status !== "done" || job.id !== jobId) return;
    let disposed = false;
    if (mode === "prepare") {
      if (typeof job.result?.datasetPath === "string") setPrepared(job.result.datasetPath);
      return;
    }
    void apiGet<Review>(`/api/train/dataset-review/${reviewId}`, { ttlMs: 0 })
      .then((report) => {
        if (disposed) return;
        setReview(report);
        setIncluded(new Set(report.clips.filter((clip) => !clip.error).map((clip) => clip.id)));
        setFilter(report.summary.flagged ? "flagged" : "all");
        setPage(0);
      })
      .catch((e) => {
        if (!disposed) setError(errMsg(e));
      });
    return () => {
      disposed = true;
    };
  }, [job, jobId, mode, reviewId]);

  async function scan() {
    setError("");
    setSubmitting(true);
    setReview(null);
    setPrepared("");
    setPreviewId("");
    try {
      const input = datasetPath.trim().replace(/^["']|["']$/g, "");
      const response = await apiSend<{ jobId: string; reviewId: string }>(
        "/api/train/dataset-review/scan",
        "POST",
        { datasetPath: input, silenceDb },
      );
      setMode("scan");
      setSource(datasetPath);
      setReviewId(response.reviewId);
      setJobId(response.jobId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function prepare() {
    setError("");
    setSubmitting(true);
    setPrepared("");
    try {
      const response = await submitJob(`/api/train/dataset-review/${reviewId}/prepare`, {
        include: [...included],
        trimSilence,
        normalize,
        lowerPeaks,
      });
      setMode("prepare");
      setJobId(response.jobId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }

  function preview(clip: Clip, at = 0) {
    seekRef.current = at;
    if (previewId === clip.id && audioRef.current) {
      audioRef.current.currentTime = at;
      void audioRef.current
        .play()
        .catch(() => setError(t("This audio format cannot be previewed in your browser.")));
    } else setPreviewId(clip.id);
  }

  const visible =
    review?.clips.filter(
      (clip) =>
        (filter === "all" ||
          (filter === "flagged" && clip.issues.length > 0) ||
          clip.issues.includes(filter as Issue)) &&
        clip.path.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const pages = Math.ceil(visible.length / 40);
  const rows = visible.slice(page * 40, (page + 1) * 40);
  return (
    <Card id="dataset-quality-review">
      <CardHeader
        icon={<ClipboardCheck size={18} />}
        title={t("Dataset quality review")}
        description={t(
          "Review your recordings before training. Exclusions and repairs are saved into a new dataset; source files stay untouched.",
        )}
      />
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[min(100%,240px)]">
          <label htmlFor="review-dataset-path">{t("Training folder")}</label>
          <input
            id="review-dataset-path"
            type="text"
            value={datasetPath}
            disabled={active || uploading}
            onChange={(e) => onDatasetChange(e.target.value)}
            list="review-datasets"
            placeholder={t("Choose or enter a training folder")}
          />
          <datalist id="review-datasets">
            {datasets.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
        </div>
        <Button
          size="sm"
          disabled={active || uploading || !datasetPath.trim()}
          icon={<Search size={15} />}
          onClick={() => void scan()}
        >
          {t(review ? "Scan again" : "Scan dataset")}
        </Button>
        {active && jobId && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Square size={14} />}
            onClick={() => void stopJob(jobId).catch((e) => setError(errMsg(e)))}
          >
            {t("Cancel")}
          </Button>
        )}
      </div>
      <TrainingUpload
        kind="dataset"
        disabled={active}
        onUploaded={onDatasetUploaded}
        onBusyChange={(value) => {
          setUploading(value);
          onUploadBusyChange(value);
        }}
      />
      <Disclosure title={t("Detection settings")}>
        <label htmlFor="review-silence-db" className="text-xs">
          {t("Silence threshold (dBFS)")}
        </label>
        <input
          id="review-silence-db"
          type="number"
          min={-80}
          max={-30}
          step={1}
          value={silenceDb}
          disabled={active}
          onChange={(e) => setSilenceDb(Number(e.target.value))}
          className="max-w-32"
        />
        <p className="field-help m-0">
          {t(
            "Defaults: silence below -50 dBFS; flag at least 35% silence, pauses over two seconds, or edges over one second. Levels are compared with the dataset median; differences of six dB are flagged. Duplicates require identical decoded audio.",
          )}
        </p>
      </Disclosure>
      {active && (
        <div className="space-y-2" role="status">
          <p className="text-xs text-[var(--muted)] m-0">
            {t(mode === "scan" ? "Scanning recordings…" : "Preparing a separate training copy…")}
          </p>
          <ProgressBar
            progress={job?.status === "running" ? job.progress : undefined}
            activity={job ? <JobStage job={job} /> : t("Preparing…")}
          />
        </div>
      )}
      {(error || jobError || job?.status === "error") && (
        <Alert variant="error">{error || jobError || job?.error}</Alert>
      )}
      {stale && review && (
        <Alert variant="warning">
          {t("This report belongs to another folder. Scan the current folder before preparing a copy.")}
        </Alert>
      )}
      {review && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              [t("Recordings"), review.summary.files],
              [t("Flagged"), review.summary.flagged],
              [t("Duplicates"), review.summary.duplicate],
              [t("Selected"), included.size],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5"
              >
                <p className="field-help m-0">{label}</p>
                <p className="text-xl font-semibold m-0">{value}</p>
              </div>
            ))}
          </div>
          <p className="field-help m-0">
            {t("{duration} of audio. Findings are signals for review, not a judgment of voice quality.", {
              duration: clock(review.summary.duration),
            })}
            {review.skippedLinks.length > 0 && (
              <> {t("Skipped {count} symbolic links.", { count: review.skippedLinks.length })}</>
            )}
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <label htmlFor="review-filter" className="sr-only">
              {t("Filter findings")}
            </label>
            <select
              id="review-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              className="text-xs max-w-full"
            >
              <option value="flagged">{t("Flagged recordings")}</option>
              <option value="all">{t("All recordings")}</option>
              {Object.entries(ISSUES).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
            <label htmlFor="review-search" className="sr-only">
              {t("Search recordings")}
            </label>
            <input
              id="review-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={t("Search recordings…")}
              className="flex-1 min-w-32 text-xs"
            />
            <Button
              size="xs"
              variant="ghost"
              disabled={active}
              onClick={() =>
                setIncluded(new Set(review.clips.filter((c) => !c.error && !c.duplicateOf).map((c) => c.id)))
              }
            >
              {t("Exclude duplicates")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={active}
              onClick={() => setIncluded(new Set(review.clips.filter((c) => !c.error).map((c) => c.id)))}
            >
              {t("Include all readable")}
            </Button>
          </div>
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {rows.length === 0 && (
              <p className="field-help p-4 text-center">{t("No recordings match this filter.")}</p>
            )}
            {rows.map((clip) => (
              <div key={clip.id} className="border border-[var(--border)] rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <ToggleField
                    id={`review-include-${clip.id}`}
                    checked={included.has(clip.id)}
                    disabled={active || !!clip.error}
                    onChange={(keep) =>
                      setIncluded((previous) => {
                        const next = new Set(previous);
                        if (keep) next.add(clip.id);
                        else next.delete(clip.id);
                        return next;
                      })
                    }
                    label={<span className="break-all text-xs">{clip.path}</span>}
                    className="min-w-0 flex-1"
                  />
                  {!clip.error && (
                    <Button size="xs" variant="ghost" icon={<Play size={12} />} onClick={() => preview(clip)}>
                      {t("Listen")}
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {clip.issues.map((issue) => (
                    <Badge key={issue} variant={issue === "unreadable" ? "danger" : "warning"}>
                      {t(ISSUES[issue])}
                    </Badge>
                  ))}
                  {clip.issues.length === 0 && <Badge variant="success">{t("No findings")}</Badge>}
                  {clip.duration !== undefined && (
                    <span className="text-[11px] text-[var(--muted)]">
                      {clock(clip.duration)} · {t("Peak")} {clip.peakDb} dBFS · {t("Active level")}{" "}
                      {clip.activeRmsDb ?? "—"} dBFS · {t("Silence")}{" "}
                      {Math.round((clip.silenceFraction || 0) * 100)}%
                    </span>
                  )}
                </div>
                {clip.duplicateOf && (
                  <p className="field-help m-0 break-all">
                    {t("Matches")} {clip.duplicateOf}
                  </p>
                )}
                {clip.error && <p className="field-help m-0 text-red-400">{clip.error}</p>}
                {(
                  [
                    ["clippingSections", "Clipped sections"],
                    ["silenceSections", "Silent sections"],
                  ] as const
                ).map(([key, label]) =>
                  clip[key]?.length ? (
                    <div key={key} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-[var(--muted)]">{t(label)}:</span>
                      {clip[key]?.slice(0, 8).map((section) => (
                        <button
                          key={section.start}
                          type="button"
                          className="ghost px-2 py-1 text-[11px]"
                          onClick={() => preview(clip, Math.max(0, section.start - 0.2))}
                        >
                          {sectionClock(section.start)}–{sectionClock(section.end)}
                        </button>
                      ))}
                      {(clip[key]?.length || 0) > 8 && (
                        <details className="w-full !border-0 !bg-transparent !p-0">
                          <summary className="cursor-pointer text-[var(--muted)] text-[11px]">
                            {t("Show more sections")}
                          </summary>
                          <div className="flex gap-1.5 flex-wrap pt-2">
                            {clip[key]?.slice(8).map((section) => (
                              <button
                                key={section.start}
                                type="button"
                                className="ghost px-2 py-1 text-[11px]"
                                onClick={() => preview(clip, Math.max(0, section.start - 0.2))}
                              >
                                {sectionClock(section.start)}–{sectionClock(section.end)}
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : null,
                )}
                {previewId === clip.id && (
                  <audio
                    ref={audioRef}
                    controls
                    aria-label={t("Preview {file}", { file: clip.path })}
                    className="w-full h-9"
                    src={`/api/train/dataset-review/${reviewId}/audio/${clip.id}`}
                    onLoadedMetadata={() => {
                      if (audioRef.current) {
                        audioRef.current.currentTime = seekRef.current;
                        void audioRef.current.play().catch(() => {});
                      }
                    }}
                    onError={() => setError(t("This audio format cannot be previewed in your browser."))}
                  >
                    <track kind="captions" />
                  </audio>
                )}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between">
              <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t("Previous")}
              </Button>
              <span className="field-help">
                {page + 1} / {pages}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t("Next")}
              </Button>
            </div>
          )}
          <div className="border-t border-[var(--border)] pt-4 space-y-3">
            <h3 className="text-sm font-semibold m-0">{t("Prepare training copy")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ToggleField
                checked={trimSilence}
                onChange={setTrimSilence}
                disabled={active}
                label={t("Trim silent edges")}
                description={t("Keep a 100 ms margin. Interior pauses are preserved.")}
              />
              <ToggleField
                checked={normalize}
                onChange={setNormalize}
                disabled={active}
                label={t("Balance recording levels")}
                description={t(
                  "Target -20 dBFS active RMS, with a -1 dBFS peak ceiling and at most 18 dB gain.",
                )}
              />
              <ToggleField
                checked={lowerPeaks}
                onChange={setLowerPeaks}
                disabled={active}
                label={t("Lower full-scale peaks")}
                description={t("Add peak headroom. Existing clipping distortion cannot be recovered.")}
              />
            </div>
            <p className="field-help m-0">
              {t(
                "Selected clips are copied to a new folder. Repaired audio is saved as 24-bit WAV; other clips keep their original format.",
              )}
            </p>
            <Button
              size="sm"
              disabled={active || stale || included.size === 0}
              icon={<FolderCheck size={15} />}
              onClick={() => void prepare()}
            >
              {t("Prepare {count} recordings", { count: included.size })}
            </Button>
            {prepared && (
              <Alert variant="success">
                <div className="space-y-2">
                  <p className="m-0 text-xs break-all">{prepared}</p>
                  <Button size="sm" icon={<Check size={14} />} onClick={() => onDatasetChange(prepared)}>
                    {t("Use this dataset for training")}
                  </Button>
                </div>
              </Alert>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
