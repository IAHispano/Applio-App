"use client";

import { Mic } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { useMicrophoneRecording } from "./useMicrophoneRecording";

export default function MicrophoneSource({
  microphone,
  compact = false,
  disabled,
}: {
  microphone: ReturnType<typeof useMicrophoneRecording>;
  compact?: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { recording, recDuration, micError, startMic, stopMic } = microphone;
  const prefix = compact ? "picker" : "empty";
  const time = `${Math.floor(recDuration / 60)}:${String(recDuration % 60).padStart(2, "0")}`;
  return (
    <div
      id={`${prefix}-panel-mic`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-mic`}
      className={`${compact ? "py-4 space-y-3" : "p-6 bg-white/[0.03] border border-white/10 rounded-2xl space-y-4"} flex flex-col items-center justify-center text-center`}
    >
      <div
        className={`${compact ? "w-12 h-12" : "w-16 h-16"} rounded-full flex items-center justify-center transition-all ${recording ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40 scale-110" : "bg-white/10 text-white hover:bg-white/20"}`}
      >
        <Mic size={compact ? 22 : 28} />
      </div>
      <div>
        <p className={`${compact ? "text-xs text-neutral-300" : "text-sm font-semibold text-white"} m-0`}>
          {compact
            ? recording
              ? `${t("Recording")} (${time})`
              : t("Record a new take to replace current audio")
            : recording
              ? t("Recording in progress…")
              : t("Record directly with microphone")}
        </p>
        {!compact && (
          <p className="text-xs text-neutral-400 m-0 mt-1">
            {recording ? time : t("High quality voice capture")}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={recording ? stopMic : startMic}
        disabled={!recording && disabled}
        className={
          recording
            ? "px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shadow-md cursor-pointer"
            : "cta text-xs cursor-pointer"
        }
      >
        {recording ? t("Stop recording") : t("Start recording")}
      </button>
      {micError && <p className="text-xs text-red-400 m-0">{micError}</p>}
    </div>
  );
}
