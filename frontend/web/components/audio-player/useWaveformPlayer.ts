"use client";

import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Hover from "wavesurfer.js/plugins/hover";

type Track = "converted" | "original";
interface Source {
  src: string;
  file?: File | null;
  originalSrc?: string | null;
}
const sameSource = (a: Source, b: Source) =>
  a.src === b.src && a.file === b.file && a.originalSrc === b.originalSrc;

export function useWaveformPlayer({ src, file, originalSrc, compact }: Source & { compact: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [comparison, setComparison] = useState<Source & { track: Track }>({
    src,
    file,
    originalSrc,
    track: "converted",
  });
  const [fileSource, setFileSource] = useState<{ file: File; url: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const settings = useRef({ volume, isMuted, isLooping, playbackRate, compact });
  settings.current = { volume, isMuted, isLooping, playbackRate, compact };
  const pendingSeek = useRef<(Source & { time: number; resume: boolean }) | null>(null);
  const source = { src, file, originalSrc };
  const activeTrack = sameSource(comparison, source) && originalSrc ? comparison.track : "converted";
  const activeSrc = activeTrack === "original" ? originalSrc || "" : src;
  const downloadSrc =
    file && activeTrack === "converted" ? (fileSource?.file === file ? fileSource.url : "") : activeSrc;

  // A File URL is also the download target, so it must survive waveform errors
  // and offscreen deferral. Only the hook that created it may revoke it.
  useEffect(() => {
    if (!file) {
      setFileSource(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFileSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const next = { src, file, originalSrc };
    setComparison((previous) => (sameSource(previous, next) ? previous : { ...next, track: "converted" }));
    if (pendingSeek.current && !sameSource(pendingSeek.current, next)) pendingSeek.current = null;
  }, [src, file, originalSrc]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsReady(false);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    if (!nearViewport || !containerRef.current || !downloadSrc) return;
    let disposed = false;
    let ws: WaveSurfer | undefined;
    const current = () => !disposed && wavesurferRef.current === ws;
    const play = () =>
      ws?.play().catch(() => {
        if (current()) setIsPlaying(false);
      });
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
        height: settings.current.compact ? 40 : 54,
        normalize: true,
        url: downloadSrc,
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
      ws.on("ready", (length) => {
        if (!current() || !ws) return;
        setIsReady(true);
        setDuration(length);
        setError(null);
        containerRef.current?.querySelectorAll("canvas").forEach((canvas) => {
          canvas.setAttribute("aria-hidden", "true");
        });
        ws.setMuted(settings.current.isMuted);
        ws.setVolume(settings.current.volume);
        ws.setPlaybackRate(settings.current.playbackRate);
        const pending = pendingSeek.current;
        pendingSeek.current = null;
        if (pending && sameSource(pending, { src, file, originalSrc })) {
          const target = Math.min(pending.time, length);
          ws.setTime(target);
          setCurrentTime(target);
          if (pending.resume) void play();
        }
      });
      ws.on("play", () => {
        if (current()) setIsPlaying(true);
      });
      ws.on("pause", () => {
        if (!current() || !ws) return;
        setIsPlaying(false);
        setCurrentTime(ws.getCurrentTime());
      });
      ws.on("finish", () => {
        if (!current() || !ws) return;
        if (settings.current.isLooping) {
          ws.setTime(0);
          void play();
        } else {
          setIsPlaying(false);
          setCurrentTime(ws.getCurrentTime());
        }
      });
      // WaveSurfer paints each frame; React only needs a readable time display.
      let publishedTime = 0;
      ws.on("timeupdate", (time) => {
        if (current() && (Math.abs(time - publishedTime) >= 0.1 || time === 0)) {
          publishedTime = time;
          setCurrentTime(time);
        }
      });
      ws.on("seeking", (time) => {
        if (!current()) return;
        publishedTime = time;
        setCurrentTime(time);
      });
      ws.on("error", () => {
        if (!current()) return;
        setError("Failed to decode audio file");
        setIsReady(false);
        setIsPlaying(false);
      });
    } catch {
      setError("Failed to initialize waveform");
    }
    return () => {
      // destroy() can emit media events and outstanding loads can reject later.
      // Retired instances must never overwrite a newer source's state.
      disposed = true;
      if (wavesurferRef.current === ws) wavesurferRef.current = null;
      try {
        ws?.destroy();
      } catch {
        // A partially initialized media backend may already be disposed.
      }
    };
  }, [downloadSrc, nearViewport, src, file, originalSrc]);

  useEffect(() => {
    const ws = wavesurferRef.current;
    ws?.setVolume(volume);
    ws?.setMuted(isMuted);
    ws?.setPlaybackRate(playbackRate);
  }, [volume, isMuted, playbackRate]);

  useEffect(() => {
    wavesurferRef.current?.setOptions({ height: compact ? 40 : 54 });
  }, [compact]);

  function play() {
    const ws = wavesurferRef.current;
    if (isReady && ws)
      void ws.play().catch(() => {
        if (wavesurferRef.current === ws) setIsPlaying(false);
      });
  }
  function handlePlayPause() {
    const ws = wavesurferRef.current;
    if (!isReady || !ws) return;
    if (ws.isPlaying()) ws.pause();
    else play();
  }
  function seek(time: number) {
    if (!isReady) return;
    const target = Math.max(0, Math.min(duration, time));
    wavesurferRef.current?.setTime(target);
    setCurrentTime(target);
  }
  function handleScrubberKeyDown(event: KeyboardEvent) {
    if (!isReady) return;
    const step = event.shiftKey ? 10 : 5;
    switch (event.key) {
      case "ArrowLeft":
        seek(currentTime - step);
        break;
      case "ArrowRight":
        seek(currentTime + step);
        break;
      case "Home":
        seek(0);
        break;
      case "End":
        seek(duration);
        break;
      case " ":
      case "k":
      case "K":
        handlePlayPause();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  function handleTrackSwitch(track: Track) {
    if (track === activeTrack || (track === "original" && !originalSrc)) return;
    const ws = wavesurferRef.current;
    // Keep the last loaded track's position during rapid A/B switches.
    if (ws && isReady)
      pendingSeek.current = { src, file, originalSrc, time: ws.getCurrentTime(), resume: ws.isPlaying() };
    setComparison({ src, file, originalSrc, track });
  }
  function handleVolumeChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Math.max(0, Math.min(1, Number(event.target.value)));
    setVolume(next);
    setIsMuted(next === 0);
  }
  function toggleMute() {
    setIsMuted(!isMuted);
    if (isMuted && volume === 0) setVolume(0.5);
  }
  function cycleRate() {
    const rates = [1, 1.25, 1.5, 2, 0.5, 0.75];
    setPlaybackRate(rates[(rates.indexOf(playbackRate) + 1) % rates.length]);
  }
  return {
    containerRef,
    activeTrack,
    activeSrc,
    downloadSrc,
    isPlaying,
    currentTime,
    duration,
    isReady,
    volume,
    isMuted,
    isLooping,
    playbackRate,
    error,
    handlePlayPause,
    handleScrubberKeyDown,
    handleTrackSwitch,
    handleVolumeChange,
    toggleMute,
    cycleRate,
    toggleLoop: () => setIsLooping(!isLooping),
    handleRestart: () => {
      seek(0);
      play();
    },
  };
}
