"use client";

import { FileText, Music, Type, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ConversionParameters from "@/components/ConversionParameters";
import { JobError } from "@/components/JobStatus";
import ModelPresetStatus from "@/components/ModelPresetStatus";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  FileInput,
  FormField,
  SegmentedControl,
  SliderField,
  VoiceModelField,
} from "@/components/ui";
import { apiGet, apiSend, errMsg, fetchModels, fileBasename, outputUrl, postForm, stopJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { SETTING_HELP } from "@/lib/setting-help";
import { useConversionParameters } from "@/lib/useConversionParameters";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";

interface Voice {
  shortName: string;
  friendlyName: string;
  gender: string;
  locale: string;
}

export default function TtsForm() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [textSource, setTextSource] = useState<"write" | "upload">("write");
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(0);
  const [pthPath, setPthPath] = useState("");
  const [indexes, setIndexes] = useState<string[]>([]);
  const [indexPath, setIndexPath] = useState("");
  const conversion = useConversionParameters(pthPath);
  const [sid, setSid] = useState(0);
  const [jobId, setJobId] = usePersistentJobId("tts");
  const { job, error, setError } = useJob(jobId);
  const [busy, setBusy] = useState(false);

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  const handleModelSelect = useCallback((selected: string, idxList: string[]) => {
    setPthPath(selected);
    setIndexPath(matchIndex(selected, idxList));
    setSid(0);
    if (selected) {
      void apiSend("/api/models/preload", "POST", { pthPath: selected }).catch(() => {});
    }
  }, []);

  function handleUnloadModel() {
    setPthPath("");
    setIndexPath("");
    setSid(0);
  }

  const loadModels = useCallback(
    (force = true) => {
      fetchModels(force)
        .then((m) => {
          setModels(m.models);
          setIndexes(m.indexes);
          if (m.models.length > 0 && !pthPath) handleModelSelect(m.models[0], m.indexes);
        })
        .catch(() => {});
    },
    [pthPath, handleModelSelect],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    apiGet<{ voices: Voice[] }>("/api/tts/voices")
      .then((v) => {
        setVoices(v.voices);
        if (v.voices[0]) setVoice(v.voices[0].shortName);
      })
      .catch((e) => setError(errMsg(e)));
    loadModels(true);
  }, []);

  useEffect(() => {
    const onFocus = () => loadModels(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadModels]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conversion.loaded) {
      setError(t("Loading model settings…"));
      return;
    }
    setError("");
    if (!text && !file) {
      setError(t("Enter text or upload a .txt file."));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("ttsText", text);
      if (file) fd.append("txt_file", file);
      fd.append("ttsVoice", voice);
      fd.append("ttsRate", String(rate));
      fd.append("pthPath", pthPath);
      fd.append("indexPath", indexPath);
      for (const [key, value] of Object.entries(conversion.values)) {
        fd.append(key, String(value));
      }
      fd.append("sid", String(sid));
      const { jobId: id } = await postForm<{ jobId: string }>("/api/tts", fd);
      setJobId(id);
    } catch (err) {
      setError(errMsg(err) || t("Submit failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      <form onSubmit={onSubmit} className="card-stack">
        {/* Card 1: Speech Synthesis Source */}
        <Card as="section" className="space-y-4">
          <CardHeader
            icon={<FileText size={18} className="text-white" />}
            title={t("Speech Synthesis Source")}
            description={t("Enter text or upload a text file to synthesize speech before voice conversion.")}
            action={
              <Badge variant="neutral" size="sm">
                {voices.length} {t("voices available")}
              </Badge>
            }
          />

          <div className="space-y-3">
            <SegmentedControl
              value={textSource}
              onChange={(v) => {
                setTextSource(v);
                if (v === "write") setFile(null);
                else setText("");
              }}
              ariaLabel={t("Text source")}
              options={[
                { value: "write", label: t("Write text"), icon: Type },
                { value: "upload", label: t("Upload file"), icon: Upload },
              ]}
            />
            {textSource === "write" ? (
              <FormField
                label={t("Text to Synthesize")}
                htmlFor="tts-text-input"
                description={t(SETTING_HELP.ttsText)}
              >
                <textarea
                  id="tts-text-input"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t("Hello, this is Applio.")}
                  className="w-full resize-y"
                  aria-describedby={`${"tts-text-input"}-desc`}
                />
              </FormField>
            ) : (
              <FormField
                label={t("Text file")}
                htmlFor="tts-file-input"
                description={t(SETTING_HELP.textFile)}
              >
                <FileInput id="tts-file-input" accept=".txt" onFileSelect={setFile} />
              </FormField>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <FormField label={t("TTS Voices")} htmlFor="tts-voice-select">
                <CustomSelect
                  id="tts-voice-select"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full mt-1"
                  searchable
                  description={t(SETTING_HELP.ttsVoice)}
                >
                  {voices.slice(0, 400).map((v) => (
                    <option key={v.shortName} value={v.shortName}>
                      {v.friendlyName} ({v.gender})
                    </option>
                  ))}
                </CustomSelect>
              </FormField>

              <div>
                <SliderField
                  id="tts-speaking-rate"
                  label={t("TTS Speed")}
                  value={rate}
                  min={-100}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={setRate}
                  description={t(SETTING_HELP.ttsSpeed)}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Card 2: Target Voice Model */}
        <Card as="section" className="space-y-4">
          <CardHeader
            icon={<Music size={18} className="text-white" />}
            title={t("Voice Model")}
            description={t("Select the target voice model and feature index for speech timbre conversion.")}
            action={
              pthPath ? (
                <Badge variant="success" size="sm" dot>
                  {t("Ready")}
                </Badge>
              ) : undefined
            }
          />

          <div className="space-y-3">
            <VoiceModelField
              models={models}
              selectedModel={pthPath}
              indexes={indexes}
              indexPath={indexPath}
              indexSelectId="tts-index-file"
              onSelect={(selected) => handleModelSelect(selected, indexes)}
              onUnload={handleUnloadModel}
              onRefresh={loadModels}
              onIndexChange={setIndexPath}
            />
            <ModelPresetStatus />

            {speakers.length > 1 && (
              <div className="max-w-md">
                <FormField label={t("Speaker ID (Multi-Speaker Model)")} htmlFor="tts-speaker-id">
                  <CustomSelect
                    id="tts-speaker-id"
                    value={String(sid)}
                    onChange={(e) => setSid(Number(e.target.value))}
                    className="w-full mt-1"
                    description={t(SETTING_HELP.speaker)}
                  >
                    {speakers.map((s) => (
                      <option key={s} value={String(s)}>
                        {t("Speaker")} {s}
                      </option>
                    ))}
                  </CustomSelect>
                </FormField>
              </div>
            )}
          </div>
        </Card>

        <ConversionParameters
          idPrefix="tts"
          values={conversion.values}
          setters={conversion.setters}
          onReset={conversion.reset}
        />

        {/* Card 4: Action & Output Card */}
        <Card as="section" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  !conversion.loaded ||
                  busy ||
                  job?.status === "running" ||
                  job?.status === "queued" ||
                  !pthPath ||
                  (!text.trim() && !file)
                }
                icon={<Wand2 size={16} />}
              >
                {busy ? t("Submitting…") : t("Convert Speech")}
              </Button>

              {job && (job.status === "running" || job.status === "queued") && (
                <Button variant="danger" onClick={() => stopJob(job.id).catch((e) => setError(errMsg(e)))}>
                  {t("Cancel")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {job && (
                <Badge
                  variant={
                    job.status === "done"
                      ? "success"
                      : job.status === "error"
                        ? "danger"
                        : job.status === "running"
                          ? "info"
                          : "neutral"
                  }
                  dot
                >
                  {job.status === "done"
                    ? t("Completed")
                    : job.status === "running"
                      ? t("In Progress")
                      : job.status === "error"
                        ? t("Failed")
                        : t("Queued")}
                </Badge>
              )}
            </div>
          </div>

          {/* Conversion In Progress Live Progress Bar */}
          {job && (job.status === "running" || job.status === "queued") && (
            <div
              className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2 animate-in fade-in duration-200"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-xs text-neutral-300">
                <span className="font-medium">{t("Synthesizing speech & converting timbre…")}</span>
                <span className="text-neutral-400 capitalize">{job.status}</span>
              </div>
              <div
                className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("Synthesizing speech & converting timbre…")}
              >
                <div className="h-full bg-white rounded-full transition-all duration-300 animate-pulse w-3/4" />
              </div>
            </div>
          )}

          {error && <Alert variant="error">{error}</Alert>}

          {job && job.status === "error" && !error && (
            <JobError
              message={job.error || t("Speech conversion failed.")}
              details={job.errorDetails}
              logs={job.logs}
              jobId={job.id}
            />
          )}

          {/* Synthesized Output Waveform Player */}
          {job?.outputFile && job.status === "done" && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
                <span className="font-semibold text-white">{t("Synthesized Speech Output")}</span>
                <Badge variant="success" size="sm" dot>
                  {t("Ready")}
                </Badge>
              </div>
              <AudioWavePlayer
                src={outputUrl(job.outputFile)}
                title={`${t("TTS Output:")} ${fileBasename(pthPath || "speech").replace(/\.(pth|onnx)$/i, "")}`}
                filename={fileBasename(job.outputFile)}
              />
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
