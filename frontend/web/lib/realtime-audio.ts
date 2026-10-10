// Capture starts only after the engine is ready. Keep at most one request in
// flight and one latest block, so slow processing cannot build a stale backlog.
export class RealtimeAudioSender {
  private ready = false;
  private inFlight = false;
  private latest: Float32Array | null = null;
  private latestAt = 0;
  droppedBlocks = 0;
  queueDelayMs = 0;
  get queuedBlocks(): number {
    return this.latest ? 1 : 0;
  }

  constructor(private readonly send: (chunk: Float32Array) => void) {}

  start(): void {
    this.ready = true;
    this.latest = null;
  }

  capture(chunk: Float32Array): void {
    if (!this.ready) return;
    if (this.inFlight) {
      if (this.latest) this.droppedBlocks++;
      this.latest = chunk;
      this.latestAt = performance.now();
      return;
    }
    this.inFlight = true;
    this.send(chunk);
  }

  acknowledge(): void {
    this.inFlight = false;
    const latest = this.latest;
    this.queueDelayMs = latest ? performance.now() - this.latestAt : 0;
    this.latest = null;
    if (latest) this.capture(latest);
  }
}

export const INPUT_WORKLET = `
class InputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(96000);
    this.buffered = 0;
    this.block = 0;
    this.port.onmessage = (e) => {
      this.block = e.data.block_frame || 0;
      if (e.data.reset) this.buffered = 0;
    };
  }
  process(inputs) {
    if (this.block <= 0) return true;
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) {
      if (this.buffered + ch.length > this.buffer.length) {
        const nextBuf = new Float32Array(Math.max(this.buffer.length * 2, this.buffered + ch.length));
        nextBuf.set(this.buffer.subarray(0, this.buffered));
        this.buffer = nextBuf;
      }
      this.buffer.set(ch, this.buffered);
      this.buffered += ch.length;
    }
    while (this.buffered >= this.block) {
      const out = new Float32Array(this.block);
      out.set(this.buffer.subarray(0, this.block));
      this.port.postMessage({ chunk: out }, [out.buffer]);
      this.buffer.copyWithin(0, this.block, this.buffered);
      this.buffered -= this.block;
    }
    return true;
  }
}
registerProcessor('input-processor', InputProcessor);`;

export const PLAYBACK_WORKLET = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(98304);
    this.rp = 0;
    this.wp = 0;
    this.buffered = 0;
    this.dropped = 0;
    this.underruns = 0;
    this.reportFrames = 0;
    this.started = false;
    this.port.onmessage = (e) => {
      const c = new Float32Array(e.data.chunk);
      this.started = true;
      // A burst of replies must not leave seconds of old audio to play.
      // Retain at most two blocks, including the newly arrived block.
      const limit = Math.min(this.ring.length, c.length * 2);
      const skip = Math.max(0, c.length - limit);
      const incoming = c.length - skip;
      const drop = Math.max(0, this.buffered + incoming - limit);
      this.dropped += drop + skip;
      this.rp = (this.rp + drop) % this.ring.length;
      this.buffered -= drop;
      for (let i = skip; i < c.length; i++) {
        this.ring[this.wp] = c[i];
        this.wp = (this.wp + 1) % this.ring.length;
      }
      this.buffered += incoming;
    };
  }
  process(inputs, outputs) {
    const outL = outputs[0] && outputs[0][0];
    const outR = outputs[0] && outputs[0][1];
    if (!outL) return true;
    for (let i = 0; i < outL.length; i++) {
      let s = 0;
      if (this.buffered > 0) {
        s = this.ring[this.rp];
        this.rp = (this.rp + 1) % this.ring.length;
        this.buffered--;
      } else if (this.started) {
        this.underruns++;
      }
      outL[i] = s;
      if (outR) outR[i] = s;
    }
    this.reportFrames += outL.length;
    if (this.reportFrames >= sampleRate / 4) {
      this.reportFrames = 0;
      this.port.postMessage({ stats: { queuedMs: this.buffered / sampleRate * 1000, droppedFrames: this.dropped, underrunFrames: this.underruns } });
    }
    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);`;
