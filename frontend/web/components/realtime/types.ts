import type { RealtimeSettingsSender } from "@/lib/realtime-settings";

export interface RealtimeAudioSession {
  ws: WebSocket;
  ctx: AudioContext;
  stream: MediaStream;
  nodes: AudioNode[];
  playback: AudioWorkletNode;
  els: HTMLAudioElement[];
  settings: RealtimeSettingsSender;
  inputBridge?: AudioNode;
  outputBridge?: AudioNode;
  inputLatencyMs: number;
  blockFrame: number;
}
