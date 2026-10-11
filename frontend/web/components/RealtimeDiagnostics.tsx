"use client";

import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, StatTile } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { inputDecibels } from "@/lib/realtime-diagnostics";

type LevelSample = { rms: number | null; at: number };
export interface RealtimeDiagnosticsProps {
  latency: number;
  roundTrip: number;
  input: LevelSample;
  silentThreshold: number;
  chunkMs: number;
  autoChunk: boolean;
  diagnostics: {
    estimatedMs: number;
    queuedBlocks: number;
    droppedBlocks: number;
    playbackQueuedMs: number;
    playbackDroppedMs: number;
    underrunMs: number;
    recentDroppedBlocks: number;
    recentUnderrunMs: number;
  };
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <StatTile label={label} value={value} title={help}>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{help}</p>
    </StatTile>
  );
}

export default function RealtimeDiagnostics({
  latency,
  roundTrip,
  input,
  silentThreshold,
  chunkMs,
  autoChunk,
  diagnostics,
}: RealtimeDiagnosticsProps) {
  const { t } = useI18n();
  const [history, setHistory] = useState<LevelSample[]>([]);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!input.at) return;
    setHistory((previous) =>
      [...previous.filter((sample) => sample.at >= input.at - 10000), input].slice(-600),
    );
    setNow(input.at);
  }, [input]);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const db = inputDecibels(input.rms);
  const level =
    db === null || now - input.at > 1500
      ? "—"
      : db === Number.NEGATIVE_INFINITY
        ? "−∞ dBFS"
        : `${db.toFixed(1)} dBFS`;
  const y = (value: number) => 12 + (Math.max(-90, Math.min(0, value)) / -90) * 108;
  let path = "";
  let previousAt = 0;
  for (const sample of history) {
    if (sample.at < now - 10000) continue;
    const value = inputDecibels(sample.rms);
    if (value === null) {
      previousAt = 0;
      continue;
    }
    const x = 48 + Math.max(0, Math.min(1, (sample.at - (now - 10000)) / 10000)) * 940;
    path += `${previousAt && sample.at - previousAt < Math.max(1500, chunkMs * 2) ? "L" : "M"}${x.toFixed(1)},${y(value).toFixed(1)} `;
    previousAt = sample.at;
  }
  const unstable = diagnostics.recentDroppedBlocks > 10 || diagnostics.recentUnderrunMs > 500;
  const buffering = diagnostics.playbackQueuedMs > 300 || diagnostics.recentUnderrunMs > 50;
  return (
    <section
      className="rounded-xl bg-black/30 border border-white/5 p-4 space-y-4"
      aria-label={t("Live status")}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-xs font-medium text-white">
          <Activity size={15} aria-hidden="true" />
          {t("Live status")}
        </h3>
        <Badge variant={unstable ? "danger" : buffering ? "warning" : "success"} dot>
          {unstable ? t("unstable") : buffering ? t("buffering") : t("healthy")}
        </Badge>
      </div>
      <div className="rounded-xl border border-white/5 bg-black/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <span className="font-medium text-neutral-200">{t("Input level")} · RMS</span>
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            <span className="text-amber-400/80">
              {t("Silence Threshold (dB)")}: {silentThreshold}
            </span>
            <span className="tabular-nums text-white">{level}</span>
          </div>
        </div>
        <div className="relative pl-9">
          <div className="absolute left-0 top-0 h-32 w-7" aria-hidden="true">
            {[0, -30, -60, -90].map((tick) => (
              <span
                key={tick}
                className="absolute text-[10px] text-neutral-400 -translate-y-1/2"
                style={{ top: `${(y(tick) / 132) * 100}%` }}
              >
                {tick}
              </span>
            ))}
          </div>
          <svg
            viewBox="48 0 940 132"
            preserveAspectRatio="none"
            className="block w-full h-32"
            role="img"
            aria-label={t("Input level")}
          >
            {[-90, -60, -30, 0].map((tick) => (
              <line
                key={tick}
                x1="48"
                x2="988"
                y1={y(tick)}
                y2={y(tick)}
                stroke="currentColor"
                className="text-white/10"
              />
            ))}
            <line
              x1="48"
              x2="988"
              y1={y(silentThreshold)}
              y2={y(silentThreshold)}
              stroke="currentColor"
              className="text-amber-400/70"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path}
              stroke="currentColor"
              className="text-emerald-400"
              strokeWidth="2"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="flex justify-between text-[10px] text-neutral-400" aria-hidden="true">
            <span>−10 s</span>
            <span>0 s</span>
          </div>
        </div>
        <p className="text-[11px] text-neutral-400 leading-relaxed">
          {t(
            "Input RMS after gain, before VAD. Negative dBFS is normal; −∞ means silence. The dashed line is the silence threshold, not the VAD decision.",
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        <Metric
          label={t("Processing")}
          value={`${latency.toFixed(0)} ms`}
          help={t("Engine time to convert one block. This is part of round trip.")}
        />
        <Metric
          label={t("Round trip")}
          value={`${roundTrip.toFixed(0)} ms`}
          help={t("Time from sending a block until converted audio returns, including processing.")}
        />
        <Metric
          label={t("Estimated delay")}
          value={`${diagnostics.estimatedMs.toFixed(0)} ms`}
          help={t("Estimated capture, round trip and playback delay. Not a measured end-to-end latency.")}
        />
        <Metric
          label={t("Playback queue")}
          value={`${diagnostics.playbackQueuedMs.toFixed(0)} ms`}
          help={t("Converted audio currently waiting to play.")}
        />
        <Metric
          label={t("Chunk")}
          value={`${chunkMs} ms${autoChunk ? ` · ${t("auto")}` : ""}`}
          help={t(
            "Audio collected per block. Smaller blocks reduce delay but leave less processing headroom.",
          )}
        />
        <Metric
          label={t("Waiting blocks")}
          value={String(diagnostics.queuedBlocks)}
          help={t("Captured blocks waiting to be sent while conversion is busy.")}
        />
        <Metric
          label={t("Dropped input")}
          value={String(diagnostics.droppedBlocks)}
          help={t("Total input blocks replaced by fresher audio to prevent backlog.")}
        />
        <Metric
          label={t("Dropped playback")}
          value={`${diagnostics.playbackDroppedMs.toFixed(0)} ms`}
          help={t("Total queued audio discarded to keep playback current.")}
        />
        <Metric
          label={t("Underruns")}
          value={`${diagnostics.underrunMs.toFixed(0)} ms`}
          help={t("Total time playback had no converted audio ready. Increasing values can mean gaps.")}
        />
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        {t("Health uses the last two seconds; dropped audio and underrun totals cover the whole session.")}
      </p>
    </section>
  );
}
