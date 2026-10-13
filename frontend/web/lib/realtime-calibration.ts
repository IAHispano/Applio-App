export interface CalibrationCounters {
  droppedBlocks: number;
  underrunMs: number;
  playbackDroppedMs: number;
}
export interface CalibrationResult {
  chunkMs: number;
  samples: number;
  activeSamples: number;
  processingP95: number;
  roundTripP95: number;
  droppedBlocks: number;
  underrunMs: number;
  playbackDroppedMs: number;
  stable: boolean;
  inconclusive: boolean;
}
export const CALIBRATION_CANDIDATES = [40, 80, 120, 200, 360, 640];

export function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
}

/** Collect only real replies; silence cannot produce a successful recommendation. */
export class CalibrationMeter {
  private samples: { processing: number; roundTrip: number; active: boolean }[] = [];
  private baseline?: CalibrationCounters;
  private enabled = false;

  begin(counters: CalibrationCounters) {
    this.samples = [];
    this.baseline = { ...counters };
    this.enabled = true;
  }
  stop() {
    this.enabled = false;
  }
  reply(processing: number, roundTrip: number, rms: number, convertedSignal = true) {
    if (
      !this.enabled ||
      ![processing, roundTrip, rms].every(Number.isFinite) ||
      processing < 0 ||
      roundTrip < 0
    )
      return;
    this.samples.push({
      processing,
      roundTrip,
      active: convertedSignal && rms >= 10 ** (-45 / 20) && processing > 0,
    });
  }
  finish(chunkMs: number, counters: CalibrationCounters): CalibrationResult {
    this.enabled = false;
    const active = this.samples.filter((sample) => sample.active);
    const processingP95 = percentile95(active.map((sample) => sample.processing));
    const roundTripP95 = percentile95(active.map((sample) => sample.roundTrip));
    const baseline = this.baseline || counters;
    const droppedBlocks = Math.max(0, counters.droppedBlocks - baseline.droppedBlocks);
    const underrunMs = Math.max(0, counters.underrunMs - baseline.underrunMs);
    const playbackDroppedMs = Math.max(0, counters.playbackDroppedMs - baseline.playbackDroppedMs);
    const inconclusive = active.length < 5 || active.length < this.samples.length * 0.4;
    return {
      chunkMs,
      samples: this.samples.length,
      activeSamples: active.length,
      processingP95,
      roundTripP95,
      droppedBlocks,
      underrunMs,
      playbackDroppedMs,
      inconclusive,
      stable:
        !inconclusive &&
        processingP95 <= chunkMs * 0.75 &&
        roundTripP95 <= chunkMs * 0.9 &&
        droppedBlocks === 0 &&
        underrunMs <= 30 &&
        playbackDroppedMs === 0,
    };
  }
}

export function recommendCalibration(results: CalibrationResult[]): CalibrationResult | null {
  return [...results].filter((result) => result.stable).sort((a, b) => a.chunkMs - b.chunkMs)[0] || null;
}

export function calibrationDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("Calibration cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
