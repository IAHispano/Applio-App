import type { RealtimeAudioSender } from "./realtime-audio";

type SettingValue = string | number | boolean;

// Coalesce slider changes and serialize configuration with audio on one socket.
export class RealtimeSettingsSender {
  private changes: Record<string, SettingValue> = {};
  private effects: Record<string, SettingValue> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { id: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private sequence = 0;
  private stopped = false;
  private applying = false;

  constructor(
    private readonly audio: RealtimeAudioSender,
    private readonly send: (message: string) => void,
    private readonly resize: (blockFrame: number) => void,
    private readonly status: (applying: boolean, error?: string, fatal?: boolean) => void,
  ) {}

  update(key: string, value: SettingValue, effect = false): void {
    if (this.stopped) return;
    (effect ? this.effects : this.changes)[key] = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 120);
  }

  private async flush(): Promise<void> {
    if (
      this.stopped ||
      this.applying ||
      (!Object.keys(this.changes).length && !Object.keys(this.effects).length)
    )
      return;
    this.applying = true;
    this.status(true);
    const id = ++this.sequence;
    // Include waiting for the last audio reply in the timeout.
    this.pending = { id, timer: setTimeout(() => this.finish("Realtime settings timed out", true), 60000) };
    await this.audio.suspend();
    if (this.stopped || this.pending?.id !== id) return;
    const changes = this.changes;
    const kwargs = this.effects;
    this.changes = {};
    this.effects = {};
    try {
      this.send(JSON.stringify({ type: "configure", id, changes, kwargs }));
    } catch (error) {
      this.finish(error instanceof Error ? error.message : String(error), true);
    }
  }

  receive(message: { type?: string; id?: number; block_frame?: number; message?: string }): boolean {
    if (message.type !== "config_applied" && message.type !== "config_error") return false;
    if (!this.pending || message.id !== this.pending.id) return true;
    if (message.type === "config_error") this.finish(message.message || "Realtime settings failed");
    else if (
      !Number.isInteger(message.block_frame) ||
      (message.block_frame ?? 0) < 480 ||
      (message.block_frame ?? 0) > 48000 ||
      (message.block_frame ?? 0) % 480 !== 0
    )
      this.finish("Invalid realtime block size", true);
    else {
      this.resize(message.block_frame as number);
      this.finish();
    }
    return true;
  }

  private finish(error?: string, fatal = false): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
    this.applying = false;
    if (this.stopped) return;
    if (fatal) {
      this.dispose();
      this.status(false, error, true);
      return;
    }
    this.audio.start();
    this.status(false, error);
    if (Object.keys(this.changes).length || Object.keys(this.effects).length) void this.flush();
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    this.changes = {};
    this.effects = {};
  }
}
