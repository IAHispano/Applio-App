"use client";

import { Activity, AudioWaveform, LineChart } from "lucide-react";
import { useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import F0CurveExtractor from "@/components/extra/F0CurveExtractor";
import NativeAnalyzer from "@/components/extra/NativeAnalyzer";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardHeader, CustomSelect } from "@/components/ui";
import { fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreviewUrl } from "@/lib/usePreviewUrl";

export default function ExtraPage() {
  const { t } = useI18n();
  const [audio, setAudio] = useState<File | null>(null);
  const [inputPath, setInputPath] = useState("");
  const [audios, setAudios] = useState<string[]>([]);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setAudios(m.audios);
        if (m.audios.length > 0) setInputPath(m.audios[0]);
      })
      .catch(() => {});
  }, []);

  const previewUrl = usePreviewUrl(audio, audio ? undefined : inputPath);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Extra Audio Analysis & Processing")}
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
              onChange={(e) => {
                setInputPath(e.target.value);
                if (e.target.value) setAudio(null);
              }}
              placeholder={t("Choose from assets/audios…")}
              className="w-full mt-1"
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
          <div className="mt-4 pt-3 border-t border-white/10">
            <span className="text-xs text-neutral-400 block mb-1 font-medium">
              {t("Source Audio Preview:")}
            </span>
            <AudioWavePlayer src={previewUrl} title={audio?.name || inputPath} showAnalyzerLink={false} />
          </div>
        )}
      </Card>

      {/* Grid: Analyzer & F0 Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
