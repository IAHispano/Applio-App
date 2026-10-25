"use client";

import { Download, ExternalLink, Pause, Play, Repeat, RotateCcw, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import type { useWaveformPlayer } from "./useWaveformPlayer";
import { formatTime, playerClasses } from "./utils";

export default function PlayerControls({
  player,
  compact,
  filename,
  displayName,
  originalSrc,
  resultLabel,
  showAnalyzerLink,
}: {
  player: ReturnType<typeof useWaveformPlayer>;
  compact: boolean;
  filename?: string;
  displayName: string;
  originalSrc?: string | null;
  resultLabel?: string;
  showAnalyzerLink: boolean;
}) {
  const { t } = useI18n();
  const volumeHelpId = useId();
  const { btnSquare, btnText, pillContainer } = playerClasses(compact);
  const {
    isReady,
    isPlaying,
    isLooping,
    isMuted,
    volume,
    playbackRate,
    activeTrack,
    currentTime,
    duration,
    downloadSrc,
    handlePlayPause,
    handleRestart,
    toggleLoop,
    cycleRate,
    handleTrackSwitch,
    handleVolumeChange,
    toggleMute,
  } = player;
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!isReady}
          aria-label={isPlaying ? t("Pause audio") : t("Play audio")}
          title={isPlaying ? t("Pause") : t("Play")}
          style={{ padding: 0, color: "#000000", backgroundColor: "#ffffff" }}
          className={`${btnSquare} audioplayer-play-btn bg-white text-black flex items-center justify-center hover:bg-neutral-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all cursor-pointer shrink-0`}
        >
          {isPlaying ? (
            <Pause
              className="w-4 h-4 shrink-0 fill-black stroke-black text-black"
              style={{ color: "#000000", fill: "#000000", stroke: "#000000" }}
            />
          ) : (
            <Play
              className="w-4 h-4 shrink-0 fill-black stroke-black text-black ml-0.5"
              style={{ color: "#000000", fill: "#000000", stroke: "#000000" }}
            />
          )}
        </button>
        <button
          type="button"
          onClick={handleRestart}
          disabled={!isReady}
          aria-label={t("Restart audio")}
          title={t("Restart")}
          style={{ padding: 0 }}
          className={`${btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-xs`}
        >
          <RotateCcw className="w-4 h-4 shrink-0" />
        </button>
        <button
          type="button"
          onClick={toggleLoop}
          disabled={!isReady}
          aria-label={t("Toggle loop")}
          aria-pressed={isLooping}
          title={isLooping ? t("Looping Enabled") : t("Enable Loop")}
          style={isLooping ? { padding: 0, color: "#000000", backgroundColor: "#ffffff" } : { padding: 0 }}
          className={`${btnSquare} border transition-all flex items-center justify-center cursor-pointer shrink-0 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
            isLooping
              ? "bg-white text-black border-white shadow-xs font-semibold"
              : "bg-white/5 hover:bg-white/10 active:bg-white/15 border-white/10 hover:border-white/20 text-neutral-300 hover:text-white"
          }`}
        >
          <Repeat
            className={`w-4 h-4 shrink-0 ${isLooping ? "text-black stroke-black" : ""}`}
            style={isLooping ? { color: "#000000", stroke: "#000000" } : undefined}
          />
        </button>
        <button
          type="button"
          onClick={cycleRate}
          disabled={!isReady}
          aria-label={`${t("Playback speed")}: ${playbackRate}x`}
          title={t("Playback Speed")}
          style={{ paddingTop: 0, paddingBottom: 0 }}
          className={`${btnText} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-xs font-semibold text-neutral-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <span>{playbackRate}x</span>
        </button>
        {originalSrc && (
          <div
            role="tablist"
            aria-label={t("Audio comparison")}
            className={`${pillContainer} inline-flex items-stretch gap-1 shrink-0`}
          >
            {(["original", "converted"] as const).map((track) => (
              <button
                key={track}
                type="button"
                role="tab"
                aria-selected={activeTrack === track}
                tabIndex={activeTrack === track ? 0 : -1}
                onClick={() => handleTrackSwitch(track)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const nextTrack =
                    event.key === "Home"
                      ? "original"
                      : event.key === "End"
                        ? "converted"
                        : track === "original"
                          ? "converted"
                          : "original";
                  handleTrackSwitch(nextTrack);
                  const tabs =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  tabs?.[nextTrack === "original" ? 0 : 1]?.focus();
                }}
                style={{ paddingTop: 0, paddingBottom: 0 }}
                className={`relative !rounded-none !border-0 !bg-transparent px-3 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)] after:absolute after:bottom-0 after:inset-x-3 after:h-0.5 after:rounded-full ${
                  activeTrack === track
                    ? "text-[var(--text)] after:bg-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)] after:bg-transparent"
                }`}
              >
                {t(track === "original" ? "Original" : "Converted")}
              </button>
            ))}
          </div>
        )}
        <div
          className={`${pillContainer} px-3 bg-white/5 border border-white/10 text-xs font-sans font-medium text-neutral-300 tabular-nums select-none flex items-center shrink-0 shadow-xs`}
        >
          <span className="text-white font-semibold">{formatTime(currentTime)}</span>
          <span className="mx-1 text-neutral-500">/</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0">
        <div
          className={`${pillContainer} inline-flex items-center gap-2 px-2.5 transition-all shrink-0 shadow-xs`}
        >
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? t("Unmute audio") : t("Mute audio")}
            title={isMuted ? t("Unmute") : t("Mute")}
            style={{ padding: 0 }}
            className="bg-transparent border-0 text-neutral-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center p-0 w-5 h-5 shrink-0"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 shrink-0" />
            ) : (
              <Volume2 className="w-4 h-4 shrink-0" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label={t("Volume")}
            aria-describedby={volumeHelpId}
            title={t(SETTING_HELP.outputGain)}
            aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)}%`}
            className="w-14 sm:w-20 h-1.5 bg-white/15 rounded-full accent-white cursor-pointer hover:bg-white/25 transition-colors"
          />
          <span id={volumeHelpId} className="sr-only">
            {t(SETTING_HELP.outputGain)}
          </span>
        </div>
        {downloadSrc && (
          <a
            href={downloadSrc}
            download={filename || displayName}
            aria-label={`${t("Download audio")}: ${displayName}`}
            title={t("Download audio")}
            style={resultLabel ? undefined : { padding: 0 }}
            className={`${resultLabel ? btnText : btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0 shadow-xs`}
          >
            <Download className="w-4 h-4 shrink-0" />
            {resultLabel && <span className="text-xs font-medium">{t("Download audio")}</span>}
          </a>
        )}
        {showAnalyzerLink && (
          <Link
            href="/extra"
            aria-label={t("Inspect in Audio Tools")}
            title={t("Inspect in Audio Tools")}
            style={{ padding: 0 }}
            className={`${btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs`}
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
          </Link>
        )}
      </div>
    </div>
  );
}
