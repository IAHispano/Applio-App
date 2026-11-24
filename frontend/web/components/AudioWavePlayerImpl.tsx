"use client";

import { Loader2, Music, Trash2, Upload } from "lucide-react";
import { memo, useMemo } from "react";
import Button from "@/components/ui/Button";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { useI18n } from "@/lib/i18n";
import PlayerControls from "./audio-player/PlayerControls";
import { useWaveformPlayer } from "./audio-player/useWaveformPlayer";
import { formatTime } from "./audio-player/utils";

export interface AudioWavePlayerProps {
  src: string;
  file?: File | null;
  originalSrc?: string | null;
  title?: string;
  filename?: string;
  showAnalyzerLink?: boolean;
  onRemove?: () => void;
  onReplace?: () => void;
  className?: string;
  compact?: boolean;
  resultLabel?: string;
}

function AudioWavePlayerInner({
  src,
  file,
  originalSrc,
  title,
  filename,
  showAnalyzerLink = true,
  onRemove,
  onReplace,
  className = "",
  compact = false,
  resultLabel,
}: AudioWavePlayerProps) {
  const { t, code } = useI18n();
  const player = useWaveformPlayer({ src, file, originalSrc, compact });
  const { containerRef, activeTrack, currentTime, duration, isReady, error } = player;
  const seconds = useMemo(
    () =>
      new Intl.NumberFormat(code.replace("_", "-"), {
        style: "unit",
        unit: "second",
        unitDisplay: "long",
        maximumFractionDigits: 3,
      }),
    [code],
  );
  const scrubberReady = isReady && Number.isFinite(duration) && duration > 0;
  const position = Math.min(currentTime, duration);
  const displayName =
    title || filename || file?.name || src.split(/[\\/]/).pop()?.split("?")[0] || "audio.wav";
  return (
    <section
      aria-label={`${t("Audio")}: ${displayName}`}
      className={`audioplayer-container grid min-w-0 gap-3 w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] ${compact ? "p-3" : "p-3 sm:p-4"} ${className}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span aria-hidden="true" className="card-heading-mark">
            <Music size={16} />
          </span>
          <div className="min-w-0">
            {resultLabel && <p className="field-help m-0">{resultLabel}</p>}
            <p className="text-sm font-semibold text-[var(--heading)] truncate m-0" title={displayName}>
              {displayName}
            </p>
          </div>
        </div>

        {/* File-level Action Buttons (Replace, Remove) */}
        {(onReplace || onRemove) && (
          <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
            {onReplace && (
              <Button variant="ghost" onClick={onReplace} title={t("Replace audio file")} icon={<Upload />}>
                {t("Replace")}
              </Button>
            )}
            {onRemove && (
              <Button
                variant="danger"
                onClick={onRemove}
                aria-label={t("Remove audio")}
                title={t("Remove audio")}
                icon={<Trash2 />}
              />
            )}
          </div>
        )}
      </div>

      {originalSrc && (
        <SegmentedControl
          value={activeTrack}
          onChange={player.handleTrackSwitch}
          ariaLabel={t("Audio comparison")}
          options={[
            { value: "original", label: t("Original") },
            { value: "converted", label: t("Converted") },
          ]}
        />
      )}

      <div className="min-w-0 overflow-hidden rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--input-bg)]">
        <div className="relative select-none p-2.5">
          <div
            ref={containerRef}
            role="slider"
            aria-hidden={scrubberReady ? undefined : true}
            aria-label={scrubberReady ? t("Audio scrubber") : undefined}
            aria-valuemin={scrubberReady ? 0 : undefined}
            aria-valuemax={scrubberReady ? duration : undefined}
            aria-valuenow={scrubberReady ? position : undefined}
            aria-valuetext={
              scrubberReady ? `${seconds.format(position)} / ${seconds.format(duration)}` : undefined
            }
            tabIndex={scrubberReady ? 0 : undefined}
            onKeyDown={player.handleScrubberKeyDown}
            className={`audio-scrubber w-full rounded-lg ${compact ? "min-h-[44px]" : "min-h-16"} ${scrubberReady ? "cursor-pointer" : ""}`}
          />

          {/* Loading Spinner / Skeleton */}
          {!isReady && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--panel)] gap-2 text-[var(--text)] text-xs">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>{t("Generating waveform…")}</span>
            </div>
          )}

          {/* Error Fallback */}
          {error && (
            <div
              role="alert"
              className="absolute inset-0 flex items-center justify-center bg-[var(--panel)] text-[var(--danger-text)] text-xs px-3 text-center"
            >
              <span>{t(error)}</span>
            </div>
          )}
        </div>
        <div
          aria-hidden="true"
          className="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-xs tabular-nums text-[var(--muted)]"
        >
          <span className="font-semibold text-[var(--heading)]">{formatTime(position, duration < 10)}</span>
          <span>{formatTime(duration, duration < 10)}</span>
        </div>
      </div>

      <PlayerControls
        player={player}
        filename={filename}
        displayName={displayName}
        resultLabel={resultLabel}
        showAnalyzerLink={showAnalyzerLink}
      />
    </section>
  );
}

export default memo(AudioWavePlayerInner);
