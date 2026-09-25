"use client";

import { Activity, AudioWaveform, FolderUp, LineChart } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import PageHeader from "@/components/layout/PageHeader";
import { Button, Card, CardHeader, CustomSelect } from "@/components/ui";
import { errMsg, fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreviewUrl } from "@/lib/usePreviewUrl";

const NativeAnalyzer = dynamic(() => import("@/components/extra/NativeAnalyzer"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-xs text-neutral-500">Loading audio analyzer…</div>,
});

const F0CurveExtractor = dynamic(() => import("@/components/extra/F0CurveExtractor"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-xs text-neutral-500">Loading F0 extractor…</div>,
});

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

      {/* Training data uploads */}
      <Card>
        <CardHeader
          icon={<FolderUp size={18} />}
          title={t("Dataset & Checkpoint Uploads")}
          description={t("Upload local dataset files, pretrained weights, or custom embedders for training.")}
        />
        <UploadBox
          path="/api/train/upload-dataset"
          fields={[{ name: "datasetName", label: t("Dataset name (e.g. my_vocals)") }]}
          files="files"
          multiple
          label={t("Dataset Audio Files (WAV/MP3/FLAC) → assets/datasets/<name>/")}
        />
        <UploadBox
          path="/api/train/upload-pretrained"
          fields={[]}
          files="file"
          label={t("Custom Pretrained Weights (.pth) → rvc/models/pretraineds/custom/")}
        />
        <UploadBox
          path="/api/train/upload-embedder"
          fields={[{ name: "folderName", label: t("Folder Name") }]}
          files="bin"
          extra="config"
          label={t("Custom Embedder (.bin + .json)")}
        />
      </Card>
    </div>
  );
}

function UploadBox({
  path,
  fields,
  files,
  extra,
  multiple,
  label,
}: {
  path: string;
  fields: Array<{ name: string; label: string }>;
  files: string;
  extra?: string;
  multiple?: boolean;
  label: string;
}) {
  const { t } = useI18n();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<FileList | null>(null);
  const [picked2, setPicked2] = useState<FileList | null>(null);
  const [msg, setMsg] = useState("");
  async function send() {
    setMsg("");
    const fd = new FormData();
    for (const f of fields) fd.append(f.name, vals[f.name] || "");
    if (picked) for (const f of Array.from(picked)) fd.append(files, f);
    if (extra && picked2) for (const f of Array.from(picked2)) fd.append(extra, f);
    try {
      const r = await fetch(path, { method: "POST", body: fd });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error || t("Upload failed."));
      setMsg(t("Uploaded."));
    } catch (e) {
      setMsg(errMsg(e));
    }
  }
  return (
    <div className="bg-white/5 border border-white/5 rounded-lg p-3">
      <p className="text-xs font-medium text-neutral-300 mb-2">{label}</p>
      <div className="row flex-wrap gap-2">
        {fields.map((f) => (
          <input
            key={f.name}
            type="text"
            placeholder={f.label}
            aria-label={f.label}
            value={vals[f.name] || ""}
            onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
            style={{ maxWidth: 200 }}
          />
        ))}
        <input
          type="file"
          aria-label={label}
          multiple={multiple}
          onChange={(e) => setPicked(e.target.files)}
        />
        {extra && (
          <input
            type="file"
            aria-label={`${label} (${t("extra config")})`}
            onChange={(e) => setPicked2(e.target.files)}
          />
        )}
        <Button variant="ghost" onClick={send}>
          {t("Upload")}
        </Button>
        {msg && (
          <span className="text-xs text-neutral-300" role="status" aria-live="polite">
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
