"use client";

import { useEffect, useRef } from "react";
import type { RealtimeTrayCommand, RealtimeTraySnapshot } from "../../desktop/src/realtime-types";

interface TrayBridge {
  onRealtimeCommand?: (callback: (action: RealtimeTrayCommand) => void) => () => void;
  reportRealtimeState?: (state: RealtimeTraySnapshot | null) => void;
}

export function useRealtimeTray(
  snapshot: RealtimeTraySnapshot,
  onCommand: (action: RealtimeTrayCommand) => void,
) {
  const current = useRef({ snapshot, onCommand });
  current.current = { snapshot, onCommand };
  const report = useRef(() => {});

  useEffect(() => {
    const bridge = (window as unknown as { applio?: TrayBridge }).applio;
    if (!bridge) return;
    const off = bridge.onRealtimeCommand?.((action) => current.current.onCommand(action));
    let previous = "";
    let sentAt = 0;
    report.current = () => {
      const value = current.current.snapshot;
      const signature = JSON.stringify(value);
      const now = performance.now();
      // Keep the native ten-second freshness window alive without rebuilding
      // unchanged menus every second. Timing changes still update once a second.
      if (signature === previous && now - sentAt < 5000) return;
      bridge.reportRealtimeState?.(value);
      previous = signature;
      sentAt = now;
    };
    report.current();
    const timer = setInterval(() => report.current(), 1000);
    return () => {
      clearInterval(timer);
      report.current = () => {};
      off?.();
      bridge.reportRealtimeState?.(null);
    };
  }, []);

  // Controls should react immediately; rapidly changing timing data is sampled
  // by the interval above, rather than crossing IPC on every audio update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Control fields trigger immediate reports; timing changes are deliberately sampled by the interval.
  useEffect(() => {
    report.current();
  }, [snapshot.connecting, snapshot.streaming, snapshot.model, snapshot.muted, snapshot.monitor]);
}
