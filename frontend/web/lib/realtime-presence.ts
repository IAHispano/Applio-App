"use client";

import { useSyncExternalStore } from "react";

// True while the realtime streaming session owns the GPU. The backend
// scheduler queues every other GPU job until streaming stops, so the app
// shows a warning instead of leaving users to wonder why a job says "Queued".
let reserved = false;
const listeners = new Set<() => void>();

export function setRealtimeGpuReserved(value: boolean) {
  if (value === reserved) return;
  reserved = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRealtimeGpuReserved(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => reserved,
    () => false,
  );
}
