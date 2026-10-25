"use client";

import { Headphones } from "lucide-react";
import type React from "react";
import { Disclosure, ToggleField } from "@/components/ui";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface RealtimeMonitorSettingsProps {
  monitorSelf: boolean;
  setMonitorSelf: React.Dispatch<React.SetStateAction<boolean>>;
  monitorVolume: number;
  setMonitorVolume: React.Dispatch<React.SetStateAction<number>>;
  streaming: boolean;
  connecting: boolean;
  outLevel: number;
  passthrough: boolean;
  setPassthrough: React.Dispatch<React.SetStateAction<boolean>>;
  passthroughHotkey: string;
  setPassthroughHotkey: React.Dispatch<React.SetStateAction<string>>;
  hotkeyAvailable: boolean;
}

export default function RealtimeMonitorSettings({ controls }: { controls: RealtimeMonitorSettingsProps }) {
  const { t } = useI18n();
  const {
    monitorSelf,
    setMonitorSelf,
    monitorVolume,
    setMonitorVolume,
    streaming,
    connecting,
    outLevel,
    passthrough,
    setPassthrough,
    passthroughHotkey,
    setPassthroughHotkey,
    hotkeyAvailable,
  } = controls;
  return (
    <Disclosure
      title={t("Monitor")}
      icon={<Headphones size={15} />}
      description={t(SETTING_HELP.outputDevice)}
    >
      <div className="space-y-4">
        <ToggleField
          id="rt-monitor-enabled"
          label={t("Hear myself")}
          description={t(
            "Play the converted output on this device's speakers/headphones while streaming. The stream sent to the output device is unaffected.",
          )}
          checked={monitorSelf}
          onChange={setMonitorSelf}
        />
        {monitorSelf && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <SliderField
              id="rt-monitor-volume"
              label={t("Monitor volume")}
              value={monitorVolume}
              min={0}
              max={200}
              step={1}
              unit="%"
              onChange={setMonitorVolume}
              description={t("Local playback volume. Does not change the streamed output.")}
            />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-neutral-300">{t("Output level")}</span>
                <span className="text-[11px] text-neutral-400 tabular-nums" aria-live="off">
                  {streaming || connecting ? `${outLevel}%` : "—"}
                </span>
              </div>
              <meter
                className="h-2 w-full overflow-hidden rounded-full bg-white/10 [&::-webkit-meter-bar]:bg-transparent [&::-webkit-meter-optimum-value]:bg-[var(--accent)] [&::-moz-meter-bar]:bg-[var(--accent)]"
                min={0}
                max={100}
                value={streaming || connecting ? outLevel : 0}
                aria-label={t("Output level")}
              />
              <p className="text-[11px] text-neutral-400 m-0 leading-tight">
                {t("Use headphones to avoid feedback when monitoring.")}
              </p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <ToggleField
            id="rt-passthrough"
            disabled={!streaming}
            label={t("Passthrough")}
            checked={passthrough}
            onChange={(value) => {
              if (streaming) setPassthrough(value);
            }}
            description={t(
              "Send your microphone directly to the output. Conversion stays ready for instant switching; recordings still use the converted voice.",
            )}
          />
          <div className="space-y-2 pl-6">
            <label htmlFor="rt-passthrough-hotkey" className="block text-xs text-neutral-300">
              {t("Passthrough hotkey")}
            </label>
            <input
              id="rt-passthrough-hotkey"
              value={passthroughHotkey}
              maxLength={80}
              onChange={(event) => setPassthroughHotkey(event.target.value)}
              aria-describedby="rt-passthrough-hotkey-help"
              autoComplete="off"
              spellCheck={false}
              className="block w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-sans focus:border-white/25 focus:outline-none"
            />
            <p
              id="rt-passthrough-hotkey-help"
              className="max-w-xl text-[11px] leading-relaxed text-neutral-400"
            >
              {t(
                "Desktop shortcut: CommandOrControl+Alt+V switches while another app is focused. Clear it to disable.",
              )}
            </p>
            {!hotkeyAvailable && (
              <p className="text-xs text-amber-300" role="status">
                {t("Hotkey unavailable. Choose another combination.")}
              </p>
            )}
          </div>
        </div>
      </div>
    </Disclosure>
  );
}
