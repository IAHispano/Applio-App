"use client";

import { Activity, AudioWaveform, LineChart } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardHeader, CustomSelect } from "@/components/ui";
import { fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { usePreviewUrl } from "@/lib/usePreviewUrl";

function ExtraLoading({ analyzer }: { analyzer: boolean }) {
  const { t } = useI18n();
  return (
    <div className="p-8 text-center text-xs text-[var(--muted)]">
      {t(analyzer ? "Loading audio analyzer…" : "Loading F0 extractor…")}
    </div>
  );
}

const NativeAnalyzer = dynamic(() => import("@/components/extra/NativeAnalyzer"), {
  ssr: false,
  loading: () => <ExtraLoading analyzer />,
});

const F0CurveExtractor = dynamic(() => import("@/components/extra/F0CurveExtractor"), {
  ssr: false,
  loading: () => <ExtraLoading analyzer={false} />,
});

export default function ExtraPage() {
  const { t } = useI18n();
  const [audio, setAudio] = useState<File | null>(null);
  const [inputPath, setInputPath] = useState("");
  const [audios, setAudios] = useState<string[]>([]);

  const refreshAudios = useCallback(async () => {
    try {
      const m = await fetchModels(true);
      if (m?.audios) {
        setAudios(m.audios);
        setInputPath((prev) => (prev && m.audios.includes(prev) ? prev : m.audios[0] || ""));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshAudios();
    const onFocus = () => refreshAudios();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAudios]);

  const previewUrl = usePreviewUrl(audio, audio ? undefined : inputPath);

  return (
    <div className="page-stack">
      <PageHeader
        title={t("Audio Tools")}
        description={t(
          "Inspect acoustic waveforms, plot frequency spectrograms, and extract pitch contours.",
        )}
      />

      {/* Shared Audio Input Card */}
      <Card>
        <CardHeader
          icon={<AudioWaveform size={18} />}
          title={t("Input Audio Source")}
          description={t(
            "This audio file will be analyzed by both the Audio Analyzer and the F0 Curve Extractor.",
          )}
        />

        <div className="grid2">
          <div>
            <label htmlFor="extra-audio-file">{t("Upload local audio file")}</label>
            <input
              id="extra-audio-file"
              type="file"
              accept=".wav,.mp3,.flac,.ogg,.opus,.m4a,.mp4,.aac,.alac,.wma,.aiff,.webm,.ac3"
              onChange={(e) => {
                setAudio(e.target.files?.[0] || null);
                if (e.target.files?.[0]) setInputPath("");
              }}
            />
          </div>
          <div>
            <label htmlFor="extra-audio-path">{t("…or pick from assets/audios")}</label>
            <CustomSelect
              id="extra-audio-path"
              value={inputPath}
              onOpen={refreshAudios}
              onChange={(e) => {
                setInputPath(e.target.value);
                if (e.target.value) setAudio(null);
              }}
              placeholder={t("Choose from assets/audios…")}
              className="w-full mt-1"
              description={t(SETTING_HELP.audioSource)}
            >
              <option value="">{t("None (use uploaded file)")}</option>
              {audios.map((a) => (
                <option key={a} value={a}>
                  {a.split(/[\\/]/).pop() || a}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>

        {/* Audio Preview Player */}
        {previewUrl && (
          <div className="mt-4">
            <span className="text-xs text-neutral-400 block mb-1 font-medium">
              {t("Source Audio Preview:")}
            </span>
            <AudioWavePlayer src={previewUrl} title={audio?.name || inputPath} showAnalyzerLink={false} />
          </div>
        )}
      </Card>

      {/* Grid: Analyzer & F0 Curve */}
      <div className="grid grid-cols-1 xl:grid-cols-2 card-grid items-start">
        {/* Tool 1: Audio Analyzer */}
        <Card>
          <CardHeader
            icon={<Activity size={18} />}
            title={t("Audio Analyzer")}
            description={t(
              "Waveform, spectrogram and file stats rendered instantly in your browser — no waiting on a server job.",
            )}
          />

          <NativeAnalyzer file={audio} fallbackPath={audio ? undefined : inputPath} />
        </Card>

        {/* Tool 2: F0 Curve Extractor */}
        <Card>
          <CardHeader
            icon={<LineChart size={18} />}
            title={t("F0 Pitch Curve Extractor")}
            description={t(
              "Extracts frame-by-frame fundamental pitch frequencies (Hz) across time and exports both a high-resolution plot and a CSV data curve.",
            )}
          />

          <F0CurveExtractor file={audio} fallbackPath={audio ? undefined : inputPath} />
        </Card>
      </div>
    </div>
  );
}
