"use client";

import { Loader2, Music, Trash2, Upload } from "lucide-react";
import { memo } from "react";
import { useI18n } from "@/lib/i18n";
import PlayerControls from "./audio-player/PlayerControls";
import { useWaveformPlayer } from "./audio-player/useWaveformPlayer";
import { formatTime, playerClasses } from "./audio-player/utils";

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
  const { t } = useI18n();
  const player = useWaveformPlayer({ src, file, originalSrc, compact });
  const { containerRef, activeTrack, isPlaying, currentTime, duration, isReady, error } = player;
  const { btnSquare, btnText } = playerClasses(compact);
  const displayName =
    title || filename || file?.name || src.split(/[\\/]/).pop()?.split("?")[0] || "audio.wav";
  return (
    <section
      aria-label={`${t("Audio")}: ${displayName}`}
      className={`audioplayer-container w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-2xl ${resultLabel ? "p-5 space-y-4" : "p-4 shadow-xl space-y-3"} transition-all ${className}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {!resultLabel && (
            <div
              style={{ padding: 0 }}
              className={`${btnSquare} flex items-center justify-center shrink-0 border border-white/10 transition-all ${
                isPlaying ? "bg-white text-black shadow-md shadow-white/20" : "bg-white/5 text-neutral-300"
              }`}
            >
              <Music
                className={`w-4 h-4 shrink-0 ${isPlaying ? "text-black stroke-black" : ""}`}
                style={isPlaying ? { color: "#000000", stroke: "#000000" } : undefined}
              />
            </div>
          )}
          <div className="min-w-0">
            {resultLabel && <p className="text-xs text-[var(--muted)] mb-1">{resultLabel}</p>}
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate m-0" title={displayName}>
                {displayName}
              </p>
              {!resultLabel && isReady && duration > 0 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-neutral-300 shrink-0 border border-white/5">
                  {formatTime(duration)}
                </span>
              )}
            </div>
            {originalSrc && (
              <p className="text-xs text-neutral-400 truncate m-0 flex items-center gap-1.5 mt-0.5">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    activeTrack === "original" ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                />
                <span>
                  {activeTrack === "original"
                    ? t("Listening to Original Track (A)")
                    : t("Listening to Converted Voice (B)")}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* File-level Action Buttons (Replace, Remove) */}
        {(onReplace || onRemove) && (
          <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0">
            {onReplace && (
              <button
                type="button"
                onClick={onReplace}
                title={t("Replace audio file")}
                style={{ paddingTop: 0, paddingBottom: 0 }}
                className={`${btnText} text-xs font-medium bg-white/5 hover:bg-white/10 active:bg-white/15 text-neutral-300 hover:text-white transition-all border border-white/10 hover:border-white/20 flex items-center gap-1.5 cursor-pointer shadow-xs`}
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>{t("Replace")}</span>
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={t("Remove audio")}
                title={t("Remove audio")}
                style={{ padding: 0 }}
                className={`${btnSquare} bg-white/5 hover:bg-red-500/10 active:bg-red-500/20 text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-all flex items-center justify-center cursor-pointer shadow-xs`}
              >
                <Trash2 className="w-4 h-4 shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Real Waveform Container (WaveSurfer) */}
      <div
        className={`relative w-full overflow-hidden select-none ${resultLabel ? "py-2" : "rounded-xl bg-black/50 border border-white/10 px-2 py-1"}`}
      >
        <div
          ref={containerRef}
          role="slider"
          aria-label={t("Audio scrubber")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          tabIndex={isReady ? 0 : -1}
          onKeyDown={player.handleScrubberKeyDown}
          className="w-full cursor-pointer min-h-[40px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-lg"
        />

        {/* Loading Spinner / Skeleton */}
        {!isReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs gap-2 text-neutral-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>{t("Generating waveform…")}</span>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-950/40 text-red-400 text-xs px-3 text-center">
            <span>{t(error)}</span>
          </div>
        )}
      </div>

      <PlayerControls
        player={player}
        compact={compact}
        filename={filename}
        displayName={displayName}
        originalSrc={originalSrc}
        resultLabel={resultLabel}
        showAnalyzerLink={showAnalyzerLink}
      />
    </section>
  );
}

export default memo(AudioWavePlayerInner);
