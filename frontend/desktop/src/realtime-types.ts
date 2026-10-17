// Shared native/renderer contract. This module has no desktop-runtime imports.
export type RealtimeTrayCommand =
  | "passthrough-toggle"
  | "start"
  | "stop"
  | "mute"
  | "unmute"
  | "monitor-on"
  | "monitor-off";

export interface RealtimeTraySnapshot {
  connecting: boolean;
  streaming: boolean;
  model: string;
  processingMs: number;
  roundTripMs: number;
  muted: boolean;
  monitor: boolean;
}
