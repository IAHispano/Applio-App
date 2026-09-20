"use client";

import { Download, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Spectrogram from "wavesurfer.js/dist/plugins/spectrogram";
import { useI18n } from "../../lib/i18n";
import { StatTile } from "../ui";

interface NativeAnalyzerProps {
  file: File | null;
  fallbackPath?: string;
}

interface AudioStats {
  sampleRate: number;
  duration: number;
  channels: number;
  samples: number;
  peakDb: string;
  rmsDb: string;
}

const SPEC_HEIGHT = 420;
const WAVE_HEIGHT = 128;
const FFT_SAMPLES = 2048;

// Spek-style inferno palette: black -> indigo -> magenta -> red -> orange -> yellow -> white.
const SPEK_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [0, 0, 0]],
  [0.15, [20, 0, 60]],
  [0.3, [110, 0, 110]],
  [0.45, [200, 20, 20]],
  [0.6, [255, 110, 0]],
  [0.75, [255, 200, 0]],
  [0.9, [255, 255, 150]],
  [1.0, [255, 255, 255]],
];

function spekColorMap(): number[][] {
  const map: number[][] = [];
  for (let i = 0; i < 256; i++) {
    const p = i / 255;
    let a = SPEK_STOPS[0];
    let b = SPEK_STOPS[SPEK_STOPS.length - 1];
    for (let s = 0; s < SPEK_STOPS.length - 1; s++) {
      if (p >= SPEK_STOPS[s][0] && p <= SPEK_STOPS[s + 1][0]) {
        a = SPEK_STOPS[s];
        b = SPEK_STOPS[s + 1];
        break;
      }
    }
    const f = (p - a[0]) / Math.max(1e-6, b[0] - a[0]);
    map.push([
      Math.round(a[1][0] + (b[1][0] - a[1][0]) * f) / 255,
      Math.round(a[1][1] + (b[1][1] - a[1][1]) * f) / 255,
      Math.round(a[1][2] + (b[1][2] - a[1][2]) * f) / 255,
      1,
    ]);
  }
  return map;
}

const DB_TICKS = [0, -20, -40, -60, -80, -100, -120];

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  if (sec < 60) return `${sec.toFixed(2)} s`;
  return `${(sec / 60).toFixed(2)} min`;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function NativeAnalyzer({ file, fallbackPath }: NativeAnalyzerProps) {
  const { t } = useI18n();
  const waveRef = useRef<HTMLDivElement | null>(null);
  const specRef = useRef<HTMLDivElement | null>(null);
  const freqRef = useRef<HTMLCanvasElement | null>(null);
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const viewsRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [zoomLabel, setZoomLabel] = useState("Fit");

  const durationRef = useRef(0);
  const zoomBaseRef = useRef(0);
  const zoomMultRef = useRef(1);
  const viewRef = useRef({ start: 0, end: 0 });
  const isReadyRef = useRef(false);

  function fitPxPerSec(): number {
    const w = waveRef.current?.clientWidth || 600;
    return Math.max(1, w / Math.max(0.01, durationRef.current || 1));
  }

  function applyZoom(mult: number) {
    const ws = wsRef.current;
    if (!ws || durationRef.current <= 0) return;
    zoomMultRef.current = mult;
    if (zoomBaseRef.current <= 0) zoomBaseRef.current = fitPxPerSec();
    ws.zoom(Math.max(1, zoomBaseRef.current * mult));
    setZoomLabel(mult <= 1 ? "Fit" : `${Math.round(mult * 100)}%`);
    requestAnimationFrame(() => drawRuler());
  }

  function drawFreqAxis(nyquist: number) {
    const cv = freqRef.current;
    if (!cv || typeof window === "undefined" || !(nyquist > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = SPEC_HEIGHT;
    if (w < 10) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const steps = [1000, 2000, 2500, 5000, 10000, 12000, 20000];
    const step = steps.find((s) => nyquist / s <= 7) ?? nyquist;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let f = 0; f <= nyquist + 1; f += step) {
      const y = h - (f / nyquist) * h;
      ctx.beginPath();
      ctx.moveTo(w - 5, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      const label = f >= 1000 ? `${Math.round((f / 1000) * 10) / 10}k` : `${Math.round(f)}`;
      ctx.fillText(f === 0 ? "0" : label, w - 7, Math.min(h - 6, Math.max(6, y)));
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("kHz", w - 7, 8);
  }

  function drawRuler() {
    const cv = rulerRef.current;
    if (!cv || typeof window === "undefined") return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = 20;
    if (w < 10) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const { start, end } = viewRef.current;
    const span = Math.max(0.001, end - start);
    const steps = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const step = steps.find((s) => span / s <= 8) ?? 1800;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "top";
    const first = Math.ceil(start / step) * step;
    for (let i = 0; ; i++) {
      const tt = Math.round((first + i * step) * 1000) / 1000;
      if (tt > end + 1e-9) break;
      const x = ((tt - start) / span) * w;
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, 10);
      ctx.stroke();
      if (x < w - 28) ctx.fillText(formatClock(tt), x + 3, 5);
    }
  }

  function movePlayhead(time: number) {
    const el = playheadRef.current;
    const dur = durationRef.current;
    if (!el || !(dur > 0)) return;
    el.style.left = `${Math.min(100, Math.max(0, (time / dur) * 100))}%`;
  }

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    if (!waveRef.current || !specRef.current) return;

    let blobUrl: string | null = null;
    let urlToLoad: string | null = null;
    if (file) {
      blobUrl = URL.createObjectURL(file);
      urlToLoad = blobUrl;
    } else if (fallbackPath) {
      urlToLoad = `/${fallbackPath.replace(/^[\\/]+/, "").replace(/\\/g, "/")}`;
    }
    if (!urlToLoad) return;

    setIsReady(false);
    setError("");
    let alive = true;
    setStats(null);
    setZoomLabel("Fit");
    zoomBaseRef.current = 0;
    zoomMultRef.current = 1;
    viewRef.current = { start: 0, end: 0 };
    movePlayhead(0);

    const specPlugin = Spectrogram.create({
      container: specRef.current,
      labels: false,
      height: SPEC_HEIGHT,
      fftSamples: FFT_SAMPLES,
      windowFunc: "hann",
      scale: "linear",
      gainDB: 0,
      rangeDB: 120,
      colorMap: spekColorMap(),
    });

    let ws: WaveSurfer | null = null;
    let zoomHost: HTMLDivElement | null = null;
    let onWheel: ((e: WheelEvent) => void) | null = null;
    try {
      ws = WaveSurfer.create({
        container: waveRef.current,
        waveColor: "rgba(255, 255, 255, 0.22)",
        progressColor: "#ffffff",
        cursorColor: "#ffffff",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 3,
        barRadius: 2,
        height: WAVE_HEIGHT,
        normalize: true,
        url: urlToLoad,
        plugins: [specPlugin],
      });
      wsRef.current = ws;

      specPlugin.on("click", (relX: number) => {
        if (durationRef.current > 0) {
          ws?.setTime(relX * durationRef.current);
        }
      });

      ws.on("ready", () => {
        setIsReady(true);
        try {
          const buf = ws?.getDecodedData();
          if (buf) {
            durationRef.current = buf.duration;
            zoomBaseRef.current = fitPxPerSec();
            viewRef.current = { start: 0, end: buf.duration };
            drawRuler();
            drawFreqAxis(buf.sampleRate / 2);
            movePlayhead(0);
            const ch0 = buf.getChannelData(0);
            let peak = 0;
            let sumSq = 0;
            for (let i = 0; i < ch0.length; i++) {
              const v = Math.abs(ch0[i]);
              if (v > peak) peak = v;
              sumSq += ch0[i] * ch0[i];
            }
            const rms = Math.sqrt(sumSq / Math.max(1, ch0.length));
            setStats({
              sampleRate: buf.sampleRate,
              duration: buf.duration,
              channels: buf.numberOfChannels,
              samples: buf.length,
              peakDb: peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dB` : "-∞",
              rmsDb: rms > 0 ? `${(20 * Math.log10(rms)).toFixed(1)} dB` : "-∞",
            });
          }
        } catch {
          /* stats are best-effort; views still render */
        }
      });
      ws.on("timeupdate", (time: number) => movePlayhead(time));
      ws.on("seeking", (time: number) => movePlayhead(typeof time === "number" ? time : 0));
      ws.on("scroll", (start: number, end: number) => {
        viewRef.current = { start, end };
        drawRuler();
      });
      ws.on("error", () => {
        setError(t("Failed to decode audio file"));
        setIsReady(false);
      });

      // Mouse-wheel zoom over the views. Attached here (not in a mount
      // effect) because the views only exist once an audio file is picked.
      // Native non-passive listener so the page doesn't scroll while zooming.
      zoomHost = viewsRef.current;
      onWheel = (e: WheelEvent) => {
        if (!wsRef.current || durationRef.current <= 0 || !isReadyRef.current) return;
        if (e.deltaY === 0) return;
        e.preventDefault();
        zoomStep(e.deltaY > 0 ? 1 / 1.25 : 1.25);
      };
      zoomHost?.addEventListener("wheel", onWheel, { passive: false });
    } catch {
      setError(t("Failed to initialize analyzer"));
    }

    return () => {
      alive = false;
      try {
        ws?.destroy();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (zoomHost && onWheel) zoomHost.removeEventListener("wheel", onWheel);
    };
  }, [file, fallbackPath, t]);

  useEffect(() => {
    function onResize() {
      drawRuler();
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  function zoomStep(factor: number) {
    applyZoom(Math.min(32, Math.max(1, zoomMultRef.current * factor)));
  }

  function downloadSpectrogram() {
    const canvases = specRef.current?.querySelectorAll("canvas");
    if (!canvases || canvases.length === 0) return;
    const main = [...canvases].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const out = document.createElement("canvas");
    out.width = main.width;
    out.height = main.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(main, 0, 0);
    const name = (file?.name || fallbackPath?.split(/[\\/]/).pop() || "audio").replace(/\.[a-z0-9]+$/i, "");
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `${name}_spectrogram.png`;
    a.click();
  }

  if (!file && !fallbackPath) return null;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400 font-medium">{t("Waveform")}</span>
        <button
          type="button"
          onClick={downloadSpectrogram}
          disabled={!isReady}
          className="ghost h-7 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-40"
        >
          <Download size={13} />
          <span>{t("Download Plot")}</span>
        </button>
      </div>

      <div
        ref={viewsRef}
        className="space-y-3"
        onDoubleClick={() => applyZoom(1)}
        title={t("Scroll to zoom • Double-click to reset")}
      >
        <div className="relative w-full rounded-xl bg-black/50 border border-white/10 overflow-hidden py-1 select-none">
          <div className="overflow-x-auto">
            <div ref={waveRef} className="w-full cursor-pointer" style={{ minHeight: WAVE_HEIGHT }} />
          </div>
          {!isReady && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-neutral-400 text-xs bg-black/60">
              <Loader2 size={14} className="animate-spin text-white" />
              <span>{t("Analyzing audio natively…")}</span>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="absolute inset-0 flex items-center justify-center text-red-400 text-xs px-3 text-center bg-red-950/40"
            >
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs text-neutral-400 font-medium">{t("Spectrogram")}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-neutral-400 tabular-nums text-center">{zoomLabel}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <canvas
              ref={freqRef}
              className="block w-11 shrink-0"
              style={{ height: SPEC_HEIGHT }}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black">
                <div ref={specRef} className="w-full" />
                <div
                  ref={playheadRef}
                  className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none"
                  style={{ left: "0%" }}
                />
              </div>
              <canvas ref={rulerRef} className="block w-full" style={{ height: 20 }} />
            </div>
            <div className="flex gap-1 shrink-0" style={{ height: SPEC_HEIGHT }} aria-hidden="true">
              <div
                className="w-3 rounded-full"
                style={{
                  background:
                    "linear-gradient(to bottom, #ffffff, #ffff96, #ffcc00, #ff6e00, #c81414, #6e006e, #14003c, #000000)",
                }}
              />
              <div className="flex flex-col justify-between py-0.5">
                {DB_TICKS.map((db) => (
                  <span key={db} className="text-[9px] font-mono text-neutral-500 leading-none tabular-nums">
                    {db === 0 ? "0 dB" : `${db} dB`}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-neutral-600 m-0">
            {t("Scroll over the views to zoom • Double-click to reset • Click the spectrogram to seek.")}
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatTile label={t("Sample Rate")} value={`${stats.sampleRate} Hz`} />
          <StatTile label={t("Duration")} value={formatDuration(stats.duration)} />
          <StatTile
            label={t("Channels")}
            value={stats.channels === 1 ? t("Mono (1)") : `${t("Stereo")} (${stats.channels})`}
          />
          <StatTile label={t("Samples")} value={stats.samples.toLocaleString()} />
          <StatTile label={t("Peak")} value={stats.peakDb} />
          <StatTile label={t("RMS")} value={stats.rmsDb} />
        </div>
      )}
    </div>
  );
}
