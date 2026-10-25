"use client";

import { useEffect, useRef, useState } from "react";

import { errMsg } from "@/lib/api";

import { useI18n } from "@/lib/i18n";

import {
  CALIBRATION_CANDIDATES,
  CalibrationMeter,
  type CalibrationResult,
  calibrationDelay,
} from "@/lib/realtime-calibration";

import type { RealtimeAudioSession } from "./types";

interface CalibrationOptions {
  getSession: () => RealtimeAudioSession | null;

  canStart: () => boolean;

  autoChunk: boolean;

  getContext: () => string;

  setChunkMs: (size: number) => void;

  onRestoreFailure: () => void;
}

export function useRealtimeCalibration(options: CalibrationOptions) {
  const { t } = useI18n();

  const latest = useRef(options);

  latest.current = options;

  const [calibrating, setCalibrating] = useState(false);

  const [calibrationResults, setCalibrationResults] = useState<CalibrationResult[]>([]);

  const [calibrationError, setCalibrationError] = useState("");

  const [calibrationCurrent, setCalibrationCurrent] = useState(0);

  const [calibrationProgress, setCalibrationProgress] = useState(0);

  const [calibrationActivity, setCalibrationActivity] = useState("Preparing…");

  const [calibrationKey, setCalibrationKey] = useState("");

  const calibrationControllerRef = useRef<AbortController | null>(null);

  const calibrationMeterRef = useRef(new CalibrationMeter());

  const calibrationCountersRef = useRef({ droppedBlocks: 0, underrunMs: 0, playbackDroppedMs: 0 });

  async function calibrateHardware() {
    const { getSession, canStart, autoChunk, getContext, setChunkMs, onRestoreFailure } = latest.current;

    const session = getSession();

    if (!canStart() || !session || calibrationControllerRef.current || session.settings.busy) return;

    const controller = new AbortController();

    calibrationControllerRef.current = controller;

    calibrationMeterRef.current.stop();

    setCalibrating(true);

    setCalibrationResults([]);

    setCalibrationError("");

    setCalibrationProgress(0);

    const original = { block_frame: session.blockFrame, automatic_block_size: autoChunk };

    const context = getContext();

    const results: CalibrationResult[] = [];

    try {
      for (const [index, chunk] of CALIBRATION_CANDIDATES.entries()) {
        controller.signal.throwIfAborted();

        if (getSession() !== session || getContext() !== context)
          throw new Error("The realtime model or audio settings changed. Run calibration again.");

        setCalibrationCurrent(chunk);

        setCalibrationActivity("Applying settings…");

        const actualFrames = await session.settings.apply({
          automatic_block_size: false,

          block_frame: chunk * 48,
        });

        if (actualFrames !== chunk * 48)
          throw new Error("The engine did not apply the requested calibration buffer.");

        setCalibrationActivity("Warming up…");

        await calibrationDelay(1500, controller.signal);

        setCalibrationActivity("Measuring latency…");

        calibrationMeterRef.current.begin(calibrationCountersRef.current);

        await calibrationDelay(6000, controller.signal);

        if (session.ctx.state !== "running" || getSession() !== session)
          throw new Error("The audio session paused during calibration.");

        if (getContext() !== context)
          throw new Error("The realtime model or audio settings changed. Run calibration again.");

        results.push(calibrationMeterRef.current.finish(chunk, calibrationCountersRef.current));

        setCalibrationResults([...results]);

        setCalibrationProgress(Math.round(((index + 1) / CALIBRATION_CANDIDATES.length) * 100));
      }

      setCalibrationKey(context);
    } catch (error) {
      setCalibrationResults([]);

      setCalibrationError(
        t(
          controller.signal.aborted
            ? "Calibration cancelled. Original buffer settings restored."
            : errMsg(error),
        ),
      );
    } finally {
      calibrationMeterRef.current.stop();

      setCalibrationActivity("Restoring settings…");

      if (getSession() === session && session.ws.readyState === WebSocket.OPEN) {
        try {
          const restored = await session.settings.apply(original);

          setChunkMs(restored / 48);
        } catch (error) {
          setCalibrationResults([]);

          setCalibrationError(
            t("Could not restore buffer settings. Realtime has been stopped: {message}", {
              message: errMsg(error),
            }),
          );

          onRestoreFailure();
        }
      }

      calibrationControllerRef.current = null;

      setCalibrating(false);
    }
  }

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) calibrationControllerRef.current?.abort();
    };

    document.addEventListener("visibilitychange", hidden);

    return () => {
      document.removeEventListener("visibilitychange", hidden);

      calibrationControllerRef.current?.abort();

      calibrationMeterRef.current.stop();
    };
  }, []);

  return {
    calibrating,
    calibrationResults,
    calibrationError,
    calibrationCurrent,
    calibrationProgress,

    calibrationActivity,
    calibrationKey,
    calibrationControllerRef,
    calibrationMeterRef,
    calibrationCountersRef,
    calibrateHardware,
  };
}
