"use client";

import {
  ChevronDown,
  Download,
  ExternalLink,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type CSSProperties, useId } from "react";
import Button from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import type { useWaveformPlayer } from "./useWaveformPlayer";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function PlayerControls({
  player,
  filename,
  displayName,
  resultLabel,
  showAnalyzerLink,
}: {
  player: ReturnType<typeof useWaveformPlayer>;
  filename?: string;
  displayName: string;
  resultLabel?: string;
  showAnalyzerLink: boolean;
}) {
  const { t } = useI18n();
  const volumeHelpId = useId();
  const {
    isReady,
    isPlaying,
    isLooping,
    isMuted,
    volume,
    playbackRate,
    downloadSrc,
    handlePlayPause,
    handleRestart,
    toggleLoop,
    setPlaybackRate,
    handleVolumeChange,
    toggleMute,
  } = player;
  const volumeLevel = isMuted ? 0 : volume;
  const volumePercent = Math.round(volumeLevel * 100);
  return (
    <div className="audio-toolbar flex min-w-0 items-center justify-between flex-wrap gap-x-4 gap-y-1">
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          className="audio-play"
          onClick={handlePlayPause}
          disabled={!isReady}
          aria-label={isPlaying ? t("Pause audio") : t("Play audio")}
          title={isPlaying ? t("Pause") : t("Play")}
          icon={isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        />
        <Button
          variant="ghost"
          className="audio-control"
          onClick={handleRestart}
          disabled={!isReady}
          aria-label={t("Restart audio")}
          title={t("Restart")}
          icon={<RotateCcw />}
        />
        <Button
          variant="ghost"
          className="audio-control"
          onClick={toggleLoop}
          disabled={!isReady}
          aria-label={t("Toggle loop")}
          aria-pressed={isLooping}
          title={isLooping ? t("Looping Enabled") : t("Enable Loop")}
          icon={<Repeat />}
        />
        <div className="audio-speed relative shrink-0">
          <select
            value={playbackRate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            disabled={!isReady}
            aria-label={t("Playback speed")}
            title={t("Playback Speed")}
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2"
          />
        </div>
      </div>
      <div className="flex min-w-0 max-w-full items-center gap-1 flex-wrap">
        <div className="audio-volume inline-flex items-center shrink-0">
          <Button
            variant="ghost"
            className="audio-control"
            onClick={toggleMute}
            aria-label={isMuted ? t("Unmute audio") : t("Mute audio")}
            title={isMuted ? t("Unmute") : t("Mute")}
            icon={isMuted || volume === 0 ? <VolumeX /> : volume < 0.5 ? <Volume1 /> : <Volume2 />}
          />
          <div className="audio-volume-track flex items-center">
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volumeLevel}
              onChange={handleVolumeChange}
              aria-label={t("Volume")}
              aria-describedby={volumeHelpId}
              title={t(SETTING_HELP.outputGain)}
              aria-valuetext={`${volumePercent}%`}
              style={{ "--range-fill": `${volumePercent}%` } as CSSProperties}
              className="range-control audio-volume-range"
            />
          </div>
          <span id={volumeHelpId} className="sr-only">
            {t(SETTING_HELP.outputGain)}
          </span>
        </div>
        {downloadSrc && (
          <Button
            href={downloadSrc}
            download={filename || displayName}
            variant="ghost"
            icon={<Download />}
            className={resultLabel ? "audio-control audio-download" : "audio-control"}
            aria-label={`${t("Download audio")}: ${displayName}`}
            title={t("Download audio")}
          >
            {resultLabel && t("Download audio")}
          </Button>
        )}
        {showAnalyzerLink && (
          <Button
            href="/extra"
            variant="ghost"
            aria-label={t("Inspect in Audio Tools")}
            title={t("Inspect in Audio Tools")}
            icon={<ExternalLink />}
            className="audio-control"
          />
        )}
      </div>
    </div>
  );
}
