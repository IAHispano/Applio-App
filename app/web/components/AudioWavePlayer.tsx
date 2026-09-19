"use client";

import {
  Download,
  ExternalLink,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Hover from "wavesurfer.js/plugins/hover";
import { useI18n } from "../lib/i18n";

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
}

function formatTime(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function AudioWavePlayer({
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
}: AudioWavePlayerProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [activeTrack, setActiveTrack] = useState<"converted" | "original">("converted");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;

  const pendingSeekTimeRef = useRef<number | null>(null);
  const shouldResumePlayRef = useRef<boolean>(false);

  const activeSrc = activeTrack === "original" && originalSrc ? originalSrc : src;

  // Clean filename for display and download
  const displayName =
    title ||
    filename ||
    (file ? file.name : "") ||
    (src ? src.split(/[\\/]/).pop()?.split("?")[0] : "") ||
    "audio.wav";

  // Initialize WaveSurfer instance
  useEffect(() => {
    if (!containerRef.current) return;
    if (!activeSrc && !file) return;

    setIsReady(false);
    setError(null);
    setIsPlaying(false);

    let createdBlobUrl: string | null = null;
    let urlToLoad = activeSrc;

    // If a File is provided and we're not inspecting the original comparison track, use an object URL
    if (file && activeTrack !== "original") {
      createdBlobUrl = URL.createObjectURL(file);
      urlToLoad = createdBlobUrl;
    }

    if (!urlToLoad) return;

    let ws: WaveSurfer | null = null;
    try {
      ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "rgba(255, 255, 255, 0.22)",
        progressColor: "#ffffff",
        cursorColor: "#ffffff",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 3,
        barRadius: 2,
        height: compact ? 40 : 54,
        normalize: true,
        url: urlToLoad,
        plugins: [
          Hover.create({
            lineColor: "rgba(255, 255, 255, 0.5)",
            lineWidth: 1.5,
            labelBackground: "#111111",
            labelColor: "#ffffff",
            labelSize: "11px",
          }),
        ],
      });

      wavesurferRef.current = ws;

      ws.on("ready", (dur) => {
        setIsReady(true);
        setDuration(dur);
        setError(null);
        if (ws) {
          ws.setVolume(isMuted ? 0 : volume);
          ws.setPlaybackRate(playbackRate);

          // Restore playback position on A/B track switch
          if (pendingSeekTimeRef.current !== null && dur > 0) {
            const target = Math.min(pendingSeekTimeRef.current, dur);
            ws.setTime(target);
            setCurrentTime(target);
            pendingSeekTimeRef.current = null;
            if (shouldResumePlayRef.current) {
              ws.play().catch(() => {});
              shouldResumePlayRef.current = false;
            }
          }
        }
      });

      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => {
        if (isLoopingRef.current && ws) {
          ws.seekTo(0);
          ws.play().catch(() => {});
        } else {
          setIsPlaying(false);
          setCurrentTime(0);
        }
      });
      ws.on("timeupdate", (time) => setCurrentTime(time));
      ws.on("error", (err) => {
        console.warn("WaveSurfer decode/load error:", err);
        setError(t("Failed to decode audio file"));
        setIsReady(false);
      });
    } catch (err) {
      console.warn("WaveSurfer initialization error:", err);
      setError(t("Failed to initialize waveform"));
    }

    return () => {
      if (ws) {
        try {
          ws.destroy();
        } catch {
          /* ignore */
        }
      }
      wavesurferRef.current = null;
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [activeSrc, file, activeTrack, compact, t, isMuted, volume, playbackRate]);

  // Play / Pause toggle
  const handlePlayPause = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (isPlaying) {
      ws.pause();
    } else {
      ws.play().catch((err) => {
        console.warn("Audio playback error:", err);
      });
    }
  };

  // Restart playback from start
  const handleRestart = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.seekTo(0);
    ws.play().catch(() => {});
  };

  // Toggle looping
  const toggleLoop = () => {
    const next = !isLooping;
    setIsLooping(next);
    isLoopingRef.current = next;
  };

  // Cycle playback rate
  const cycleRate = () => {
    const rates = [1, 1.25, 1.5, 2, 0.5, 0.75];
    const nextIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIndex];
    setPlaybackRate(nextRate);
    if (wavesurferRef.current) {
      wavesurferRef.current.setPlaybackRate(nextRate);
    }
  };

  // Switch A/B track while keeping playback position
  const handleTrackSwitch = (track: "converted" | "original") => {
    if (track === activeTrack) return;
    const ws = wavesurferRef.current;
    if (ws) {
      pendingSeekTimeRef.current = ws.getCurrentTime();
      shouldResumePlayRef.current = isPlaying;
    }
    setActiveTrack(track);
  };

  // Volume slider handler
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(val);
    }
  };

  // Mute toggle
  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (wavesurferRef.current) {
      wavesurferRef.current.setMuted(next);
      if (!next && volume === 0) {
        setVolume(0.5);
        wavesurferRef.current.setVolume(0.5);
      }
    }
  };

  // Static class combinations so Tailwind scans every class literal
  const btnSquare = compact ? "h-8 w-8 rounded-xl" : "h-9 w-9 rounded-xl";
  const btnText = compact ? "h-8 px-2.5 rounded-xl" : "h-9 px-3 rounded-xl";
  const pillContainer = compact ? "h-8 rounded-xl" : "h-9 rounded-xl";

  return (
    <section
      aria-label={`Audio Waveplayer: ${displayName}`}
      className={`w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-2xl p-4 shadow-xl space-y-3 transition-all ${className}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className={`${btnSquare} flex items-center justify-center shrink-0 border border-white/10 transition-all ${
              isPlaying ? "bg-white text-black shadow-md shadow-white/20" : "bg-white/5 text-neutral-300"
            }`}
          >
            <Music className="w-4 h-4 shrink-0" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate m-0" title={displayName}>
                {displayName}
              </p>
              {isReady && duration > 0 && (
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
          <div className="flex items-center gap-1.5 shrink-0">
            {onReplace && (
              <button
                type="button"
                onClick={onReplace}
                title={t("Replace audio file")}
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
                className={`${btnSquare} bg-white/5 hover:bg-red-500/10 active:bg-red-500/20 text-neutral-400 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-all flex items-center justify-center cursor-pointer shadow-xs`}
              >
                <Trash2 className="w-4 h-4 shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Real Waveform Container (WaveSurfer) */}
      <div className="relative w-full rounded-xl bg-black/50 border border-white/10 overflow-hidden px-2 py-1 select-none">
        <div ref={containerRef} className="w-full cursor-pointer min-h-[40px]" />

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
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Unified Controls Bar: All buttons strictly match in height, border radius, and surface style */}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
        {/* Left cluster: Play, Restart, Loop, Speed, A/B Switch, Time display */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Play / Pause button */}
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={!isReady && !error}
            aria-label={isPlaying ? t("Pause audio") : t("Play audio")}
            title={isPlaying ? t("Pause") : t("Play")}
            className={`${btnSquare} bg-white text-black flex items-center justify-center hover:bg-neutral-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all cursor-pointer shrink-0`}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 shrink-0 fill-current" />
            ) : (
              <Play className="w-4 h-4 shrink-0 fill-current ml-0.5" />
            )}
          </button>

          {/* Restart button */}
          <button
            type="button"
            onClick={handleRestart}
            disabled={!isReady}
            aria-label={t("Restart audio")}
            title={t("Restart")}
            className={`${btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 shadow-xs`}
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
          </button>

          {/* Loop button */}
          <button
            type="button"
            onClick={toggleLoop}
            disabled={!isReady}
            aria-label={t("Toggle loop")}
            aria-pressed={isLooping}
            title={isLooping ? t("Looping Enabled") : t("Enable Loop")}
            className={`${btnSquare} border transition-all flex items-center justify-center cursor-pointer shrink-0 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
              isLooping
                ? "bg-white text-black border-white shadow-xs font-semibold"
                : "bg-white/5 hover:bg-white/10 active:bg-white/15 border-white/10 hover:border-white/20 text-neutral-300 hover:text-white"
            }`}
          >
            <Repeat className="w-4 h-4 shrink-0" />
          </button>

          {/* Playback speed selector */}
          <button
            type="button"
            onClick={cycleRate}
            disabled={!isReady}
            aria-label={`${t("Playback speed")}: ${playbackRate}x`}
            title={t("Playback Speed")}
            className={`${btnText} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-xs font-semibold text-neutral-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span>{playbackRate}x</span>
          </button>

          {/* A/B Comparison Segmented Switch */}
          {originalSrc && (
            <div
              role="tablist"
              aria-label={t("Audio comparison")}
              className={`${pillContainer} inline-flex items-center p-0.5 bg-white/5 border border-white/10 shadow-xs shrink-0`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTrack === "original"}
                onClick={() => handleTrackSwitch("original")}
                className={`h-full px-2.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTrack === "original"
                    ? "bg-white text-black font-semibold shadow-xs"
                    : "text-neutral-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span
                  className={`text-[9px] font-bold px-1 rounded ${
                    activeTrack === "original" ? "bg-black/15 text-black" : "bg-white/10 text-neutral-300"
                  }`}
                >
                  A
                </span>
                <span>{t("Original")}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTrack === "converted"}
                onClick={() => handleTrackSwitch("converted")}
                className={`h-full px-2.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTrack === "converted"
                    ? "bg-white text-black font-semibold shadow-xs"
                    : "text-neutral-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span
                  className={`text-[9px] font-bold px-1 rounded ${
                    activeTrack === "converted" ? "bg-black/15 text-black" : "bg-white/10 text-neutral-300"
                  }`}
                >
                  B
                </span>
                <span>{t("Converted")}</span>
              </button>
            </div>
          )}

          {/* Time display */}
          <div
            className={`${pillContainer} px-3 bg-white/5 border border-white/10 text-xs font-mono font-medium text-neutral-300 tabular-nums select-none flex items-center shrink-0 shadow-xs`}
          >
            <span className="text-white font-semibold">{formatTime(currentTime)}</span>
            <span className="mx-1 text-neutral-500">/</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right cluster: Volume, Download, Audio Tools Link */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Volume Control */}
          <div
            className={`${pillContainer} inline-flex items-center gap-2 px-2.5 bg-white/5 border border-white/10 hover:border-white/20 transition-all shrink-0 shadow-xs`}
          >
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? t("Unmute audio") : t("Mute audio")}
              title={isMuted ? t("Unmute") : t("Mute")}
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer flex items-center justify-center p-0"
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
              className="w-20 h-1.5 bg-white/15 rounded-full accent-white cursor-pointer hover:bg-white/25 transition-colors"
            />
          </div>

          {/* Download button */}
          {activeSrc && (
            <a
              href={activeSrc}
              download={displayName}
              aria-label={`${t("Download audio")}: ${displayName}`}
              title={t("Download audio")}
              className={`${btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs`}
            >
              <Download className="w-4 h-4 shrink-0" />
            </a>
          )}

          {/* Inspect in Audio Tools link */}
          {showAnalyzerLink && (
            <Link
              href="/extra"
              aria-label={t("Inspect in Audio Tools")}
              title={t("Inspect in Audio Tools")}
              className={`${btnSquare} bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs`}
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
