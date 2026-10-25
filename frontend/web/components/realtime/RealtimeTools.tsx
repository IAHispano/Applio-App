"use client";

import { Disc } from "lucide-react";
import type React from "react";
import RealtimeCalibration from "@/components/RealtimeCalibration";
import { Button, Card, CardHeader, Disclosure } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import { useI18n } from "@/lib/i18n";
import type { CalibrationResult } from "@/lib/realtime-calibration";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeToolsProps {
  realtimeToolsOpen: boolean;
  setRealtimeToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: boolean;
  connecting: boolean;
  applyingSettings: boolean;
  applyingAudio: boolean;
  recOn: boolean;
  passthrough: boolean;
  inGain: number;
  settingsBusy: boolean;
  calibrating: boolean;
  calibrationCurrent: number;
  calibrationResults: CalibrationResult[];
  calibrationKey: string;
  calibrationContextKey: string;
  calibrationError: string;
  calibrationProgress: number;
  calibrationActivity: string;
  calibrateHardware: () => Promise<void>;
  cancelCalibration: () => void;
  setChunkMs: React.Dispatch<React.SetStateAction<number>>;
  setAutoChunk: React.Dispatch<React.SetStateAction<boolean>>;
  recPath: string;
  setRecPath: React.Dispatch<React.SetStateAction<string>>;
  recFormat: string;
  setRecFormat: React.Dispatch<React.SetStateAction<string>>;
  toggleRecord: () => Promise<void>;
}

export default function RealtimeTools({ controls }: { controls: RealtimeToolsProps }) {
  const { t } = useI18n();
  const {
    realtimeToolsOpen,
    setRealtimeToolsOpen,
    streaming,
    connecting,
    applyingSettings,
    applyingAudio,
    recOn,
    passthrough,
    inGain,
    settingsBusy,
    calibrating,
    calibrationCurrent,
    calibrationResults,
    calibrationKey,
    calibrationContextKey,
    calibrationError,
    calibrationProgress,
    calibrationActivity,
    calibrateHardware,
    cancelCalibration,
    setChunkMs,
    setAutoChunk,
    recPath,
    setRecPath,
    recFormat,
    setRecFormat,
    toggleRecord,
  } = controls;
  return (
    <Disclosure
      title={t("Recording & Calibration")}
      icon={<Disc size={16} />}
      open={realtimeToolsOpen}
      onToggle={setRealtimeToolsOpen}
    >
      <RealtimeCalibration
        streaming={streaming}
        disabled={
          connecting ||
          applyingSettings ||
          applyingAudio ||
          recOn ||
          passthrough ||
          inGain === 0 ||
          settingsBusy
        }
        running={calibrating}
        current={calibrationCurrent}
        results={calibrationResults}
        stale={!!calibrationKey && calibrationKey !== calibrationContextKey}
        error={calibrationError}
        progress={calibrationProgress}
        activity={calibrationActivity}
        onStart={() => void calibrateHardware()}
        onCancel={cancelCalibration}
        onApply={(size) => {
          setChunkMs(size);
          setAutoChunk(false);
        }}
      />
      <Card aria-label={t("Record Output")}>
        <CardHeader
          icon={<Disc size={18} className="text-white" />}
          title={t("Record Output")}
          description={t("Records the converted stream server-side via the engine.")}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label htmlFor="rt-rec-path">{t("Recording path (server)")}</label>
            <input
              id="rt-rec-path"
              disabled={calibrating}
              type="text"
              value={recPath}
              onChange={(e) => setRecPath(e.target.value)}
              aria-describedby={`${"rt-rec-path"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.recordPath)} controlId={"rt-rec-path"} />
          </div>
          <div>
            <label htmlFor="rt-rec-format">{t("Export Format")}</label>
            <CustomSelect
              id="rt-rec-format"
              disabled={calibrating}
              value={recFormat}
              onChange={(e) => setRecFormat(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.export)}
            >
              {["WAV", "MP3", "FLAC", "OGG", "M4A"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant={recOn ? "ghost" : "primary"}
            onClick={toggleRecord}
            disabled={calibrating || !streaming}
            icon={<Disc size={16} className={recOn ? "animate-pulse text-white" : undefined} />}
          >
            {recOn ? t("Stop Recording") : t("Start Recording")}
          </Button>
        </div>
      </Card>
    </Disclosure>
  );
}
