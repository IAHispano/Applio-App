"use client";

import { Activity, AudioWaveform, Brain, FolderUp, Layers, LineChart, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import PageHeader from "@/components/layout/PageHeader";
import { Button, Card, CardHeader, CustomSelect, FileInput } from "@/components/ui";
import SettingHelp from "@/components/ui/SettingHelp";
import { errMsg, fetchModels } from "@/lib/api";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
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
  const { remote } = useRemoteBridge();
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

      {/* Training data uploads */}
      {!remote && (
        <Card>
          <CardHeader
            icon={<FolderUp size={18} />}
            title={t("Dataset & Checkpoint Uploads")}
            description={t(
              "Upload local dataset files, pretrained weights, or custom embedders for training.",
            )}
          />
          <div className="grid grid-cols-1 xl:grid-cols-3 card-grid items-stretch">
            <UploadBox
              icon={<AudioWaveform size={20} />}
              accept=".wav,.mp3,.flac"
              fileLabel={t("Audio files")}
              path="/api/train/upload-dataset"
              fields={[{ name: "datasetName", label: t("Dataset name (e.g. my_vocals)") }]}
              files="files"
              multiple
              label={t("Dataset audio files (WAV/MP3/FLAC)")}
            />
            <UploadBox
              icon={<Layers size={20} />}
              accept=".pth"
              fileLabel={t("Weights")}
              path="/api/train/upload-pretrained"
              fields={[]}
              files="file"
              label={t("Custom pretrained weights (.pth)")}
            />
            <UploadBox
              icon={<Brain size={20} />}
              accept=".bin"
              fileLabel=".bin"
              path="/api/train/upload-embedder"
              fields={[{ name: "folderName", label: t("Folder Name") }]}
              files="bin"
              extra="config"
              label={t("Custom Embedder (.bin + .json)")}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function UploadBox({
  icon,
  accept,
  fileLabel,
  path,
  fields,
  files,
  extra,
  multiple,
  label,
}: {
  icon: ReactNode;
  accept: string;
  fileLabel: string;
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
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = Boolean(
    picked?.length && (!extra || picked2?.length) && fields.every((f) => vals[f.name]?.trim()),
  );
  async function send() {
    if (busy || !ready) return;
    setBusy(true);
    setFailed(false);
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
      setFailed(true);
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="min-w-0 rounded-xl bg-[var(--input-bg)] p-5 flex flex-col gap-5"
      aria-labelledby={`upload-${files}-title`}
    >
      <div className="space-y-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--text)]"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h3
          id={`upload-${files}-title`}
          className="text-base font-bold text-[var(--heading)] m-0 xl:min-h-12"
        >
          {label}
        </h3>
      </div>
      <div className="flex-1 space-y-4">
        {fields.map((f) => (
          <div key={f.name} className="space-y-2">
            <label className="field-label block" htmlFor={`upload-${files}-${f.name}`}>
              {f.label}
            </label>
            <input
              id={`upload-${files}-${f.name}`}
              type="text"
              disabled={busy}
              aria-describedby={`upload-${files}-${f.name}-help`}
              value={vals[f.name] || ""}
              onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
            />
            <SettingHelp text={t(SETTING_HELP.uploadName)} controlId={`upload-${files}-${f.name}`} />
          </div>
        ))}
        <div className="space-y-2">
          <label className="field-label block" htmlFor={`upload-${files}-file`}>
            {fileLabel}
          </label>
          <FileInput
            id={`upload-${files}-file`}
            ariaLabel={`${label}: ${fileLabel}`}
            accept={accept}
            multiple={multiple}
            disabled={busy}
            onChange={setPicked}
            className="w-full"
          />
        </div>
        {extra && (
          <div className="space-y-2">
            <label className="field-label block" htmlFor={`upload-${files}-config`}>
              .json
            </label>
            <FileInput
              id={`upload-${files}-config`}
              ariaLabel={`${label}: .json`}
              accept=".json"
              disabled={busy}
              onChange={setPicked2}
              className="w-full"
            />
          </div>
        )}
      </div>
      <div className="space-y-3">
        {msg && (
          <p
            className={`field-help m-0 ${failed ? "!text-[var(--err)]" : "!text-[var(--ok)]"}`}
            role="status"
            aria-live="polite"
          >
            {msg}
          </p>
        )}
        <Button
          variant="ghost"
          block
          loading={busy}
          disabled={!ready}
          icon={<Upload size={16} />}
          onClick={send}
        >
          {t("Upload")}
        </Button>
      </div>
    </section>
  );
}
