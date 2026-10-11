export function inputDecibels(rms: number | null): number | null {
  return rms !== null && Number.isFinite(rms) && rms >= 0
    ? rms === 0
      ? Number.NEGATIVE_INFINITY
      : 20 * Math.log10(rms)
    : null;
}

// Health reflects recent counter changes; totals still describe the whole session.
export class RealtimeHealthWindow {
  private samples: { at: number; dropped: number; underrun: number }[] = [];
  push(at: number, dropped: number, underrun: number) {
    const previous = this.samples[this.samples.length - 1];
    if (previous && (dropped < previous.dropped || underrun < previous.underrun)) this.samples = [];
    this.samples.push({ at, dropped, underrun });
    while (this.samples.length > 1 && this.samples[1].at <= at - 2000) this.samples.shift();
    const oldest = this.samples[0];
    return {
      recentDroppedBlocks: Math.max(0, dropped - oldest.dropped),
      recentUnderrunMs: Math.max(0, underrun - oldest.underrun),
    };
  }
}
