"use client";

import { Check, Gauge, Square } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { type CalibrationResult, recommendCalibration } from "@/lib/realtime-calibration";

export default function RealtimeCalibration({
  streaming,
  disabled,
  running,
  current,
  results,
  stale,
  error,
  progress,
  onStart,
  onCancel,
  onApply,
}: {
  streaming: boolean;
  disabled: boolean;
  running: boolean;
  current: number;
  results: CalibrationResult[];
  stale: boolean;
  error: string;
  progress: number;
  onStart: () => void;
  onCancel: () => void;
  onApply: (chunkMs: number) => void;
}) {
  const { t } = useI18n();
  const recommendation = recommendCalibration(results);
  return (
    <Card id="realtime-calibration">
      <CardHeader
        icon={<Gauge size={18} />}
        title={t("Hardware calibration")}
        description={t(
          "Test the selected model across six buffer sizes using your microphone and actual playback path.",
        )}
        action={
          running ? (
            <Badge variant="info" dot>
              {t("Testing {size} ms", { size: current })}
            </Badge>
          ) : undefined
        }
      />
      <p className="field-help m-0">
        {t(
          "Start streaming, then speak continuously for about 45 seconds. Use headphones and avoid other heavy workloads. Warmup and buffer changes are excluded from measurements. Your original buffer settings are restored after the test.",
        )}
      </p>
      <div className="flex gap-2 items-center flex-wrap">
        {running ? (
          <Button size="sm" variant="ghost" icon={<Square size={14} />} onClick={onCancel}>
            {t("Cancel calibration")}
          </Button>
        ) : (
          <Button size="sm" disabled={!streaming || disabled} icon={<Gauge size={15} />} onClick={onStart}>
            {t(results.length ? "Run calibration again" : "Calibrate hardware")}
          </Button>
        )}
        {!streaming && (
          <span className="field-help">{t("Start streaming with a model to enable calibration.")}</span>
        )}
      </div>
      {running && (
        <progress aria-label={t("Calibration progress")} value={progress} max={100} className="w-full h-2" />
      )}
      {error && <Alert variant="error">{error}</Alert>}
      {results.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs text-left whitespace-nowrap">
              <thead>
                <tr>
                  {[
                    "Buffer",
                    "Processing p95",
                    "Round trip p95",
                    "Dropped blocks",
                    "Playback gaps",
                    "Result",
                  ].map((label) => (
                    <th key={label} className="p-2 whitespace-nowrap text-[var(--muted)] font-medium">
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.chunkMs} className="border-t border-[var(--border)]">
                    <td className="p-2">{result.chunkMs} ms</td>
                    <td className="p-2">{result.processingP95.toFixed(1)} ms</td>
                    <td className="p-2">{result.roundTripP95.toFixed(1)} ms</td>
                    <td className="p-2">{result.droppedBlocks}</td>
                    <td className="p-2">{result.underrunMs.toFixed(0)} ms</td>
                    <td className="p-2">
                      <Badge
                        variant={result.inconclusive ? "neutral" : result.stable ? "success" : "warning"}
                      >
                        {t(result.inconclusive ? "Inconclusive" : result.stable ? "Stable" : "Struggling")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!running &&
            (stale ? (
              <Alert variant="warning">
                {t(
                  "Your model, device, or voice settings changed. Run calibration again before applying a recommendation.",
                )}
              </Alert>
            ) : recommendation ? (
              <Alert variant="success">
                <div className="space-y-2">
                  <p className="m-0 text-xs">
                    {t(
                      "Recommended buffer: {size} ms. This was the smallest stable candidate with processing headroom in this test.",
                      { size: recommendation.chunkMs },
                    )}
                  </p>
                  <Button
                    size="sm"
                    disabled={disabled}
                    icon={<Check size={14} />}
                    onClick={() => onApply(recommendation.chunkMs)}
                  >
                    {t("Apply recommended buffer")}
                  </Button>
                </div>
              </Alert>
            ) : (
              <Alert variant="warning">
                {t(
                  "No stable recommendation. Speak continuously and test again, or reduce model/effect workload. Silent input, silence-gated output, and too few active replies are inconclusive.",
                )}
              </Alert>
            ))}
          <p className="field-help m-0">
            {t(
              "p95 means 95% of measured replies were faster. Round trip covers the engine connection, not total perceived latency. A short test cannot guarantee stability under future load.",
            )}
          </p>
        </>
      )}
    </Card>
  );
}
