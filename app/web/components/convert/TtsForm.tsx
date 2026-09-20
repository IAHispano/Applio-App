"use client";

import { FileText, Music, RotateCcw, Sliders, Volume2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  Disclosure,
  FormField,
  ModelDropdown,
  RadioGroup,
  SliderField,
  ToggleField,
} from "@/components/ui";
import {
  apiGet,
  errMsg,
  fetchJob,
  fetchModels,
  fileBasename,
  type Job,
  outputUrl,
  pollJob,
  postForm,
  stopJob,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { usePersistentJobId } from "@/lib/useJob";
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
  const [filter, setFilter] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(0);
  const [pthPath, setPthPath] = useState("");
  const [indexes, setIndexes] = useState<string[]>([]);
  const [indexPath, setIndexPath] = useState("");
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0.75);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1);
  const [protect, setProtect] = useState(0.5);
  const [f0Method, setF0Method] = useState("rmvpe");
  const [embedderModel, setEmbedderModel] = useState("contentvec");
  const [embedderModelCustom, setEmbedderModelCustom] = useState("");
  const [exportFormat, setExportFormat] = useState("WAV");
  const [splitAudio, setSplitAudio] = useState(false);
  const [f0Autotune, setF0Autotune] = useState(false);
  const [f0AutotuneStrength, setF0AutotuneStrength] = useState(1);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [proposedPitchThreshold, setProposedPitchThreshold] = useState(155);
  const [cleanAudio, setCleanAudio] = useState(false);
  const [cleanStrength, setCleanStrength] = useState(0.5);
  const [sid, setSid] = useState(0);
  const [jobId, setJobId] = usePersistentJobId("tts");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let stop = () => {};
    fetchJob(jobId)
      .then(({ job: j }) => {
        setJob(j);
        if (j.status !== "done" && j.status !== "error") {
          stop = pollJob(jobId, setJob);
        }
      })
      .catch((e) => setError(errMsg(e)));
    return () => stop();
  }, [jobId]);

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  function handleModelSelect(selected: string, idxList = indexes) {
    setPthPath(selected);
    setIndexPath(matchIndex(selected, idxList));
    setSid(0);
  }

  function handleUnloadModel() {
    setPthPath("");
    setIndexPath("");
    setSid(0);
  }

  function loadModels() {
    fetchModels()
      .then((m) => {
        setModels(m.models);
        setIndexes(m.indexes);
        if (m.models.length > 0) handleModelSelect(m.models[0], m.indexes);
      })
      .catch(() => {});
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    apiGet<{ voices: Voice[] }>("/api/tts/voices")
      .then((v) => {
        setVoices(v.voices);
        if (v.voices[0]) setVoice(v.voices[0].shortName);
      })
      .catch((e) => setError(errMsg(e)));
    loadModels();
  }, []);

  const resetDefaults = () => {
    setPitch(0);
    setIndexRate(0.75);
    setVolumeEnvelope(1);
    setProtect(0.5);
    setF0Method("rmvpe");
    setEmbedderModel("contentvec");
    setEmbedderModelCustom("");
    setRate(0);
    setSplitAudio(false);
    setF0Autotune(false);
    setF0AutotuneStrength(1);
    setProposedPitch(false);
    setProposedPitchThreshold(155);
    setCleanAudio(false);
    setCleanStrength(0.5);
  };

  const shown = voices.filter(
    (v) =>
      !filter ||
      v.shortName.toLowerCase().includes(filter.toLowerCase()) ||
      v.friendlyName.toLowerCase().includes(filter.toLowerCase()),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      fd.append("pitch", String(pitch));
      fd.append("indexRate", String(indexRate));
      fd.append("volumeEnvelope", String(volumeEnvelope));
      fd.append("protect", String(protect));
      fd.append("f0Method", f0Method);
      fd.append("embedderModel", embedderModel);
      if (embedderModel === "custom" && embedderModelCustom) {
        fd.append("embedderModelCustom", embedderModelCustom);
      }
      fd.append("exportFormat", exportFormat);
      fd.append("splitAudio", String(splitAudio));
      fd.append("f0Autotune", String(f0Autotune));
      fd.append("f0AutotuneStrength", String(f0AutotuneStrength));
      fd.append("proposedPitch", String(proposedPitch));
      fd.append("proposedPitchThreshold", String(proposedPitchThreshold));
      fd.append("cleanAudio", String(cleanAudio));
      fd.append("cleanStrength", String(cleanStrength));
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

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Card 1: Speech Synthesis Source */}
        <Card as="section" className="space-y-4">
          <CardHeader
            icon={<FileText size={18} className="text-white" />}
            title={t("Speech Synthesis Source")}
            description={t("Enter text or upload a text file to synthesize speech before voice conversion.")}
            action={
              <Badge variant="neutral" size="sm">
                {shown.length} {t("voices available")}
              </Badge>
            }
          />

          <div className="space-y-3">
            <FormField label={t("Text to Synthesize")} htmlFor="tts-text-input">
              <textarea
                id="tts-text-input"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("Hello, this is Applio.")}
                className="w-full resize-y"
              />
            </FormField>

            <FormField label={t("Or upload a .txt file")} htmlFor="tts-file-input">
              <input
                id="tts-file-input"
                type="file"
                accept=".txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </FormField>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <FormField label={t("Voice filter")} htmlFor="tts-voice-filter">
                <input
                  id="tts-voice-filter"
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("e.g. en-US, Aria, Guy…")}
                />
              </FormField>

              <FormField label={t("TTS Voices")} htmlFor="tts-voice-select">
                <CustomSelect
                  id="tts-voice-select"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full mt-1"
                  searchable
                >
                  {shown.slice(0, 400).map((v) => (
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
            <ModelDropdown
              models={models}
              selectedModel={pthPath}
              indexes={indexes}
              onSelect={handleModelSelect}
              onUnload={handleUnloadModel}
              onRefresh={loadModels}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              {pthPath && (
                <FormField label={t("Index File")} htmlFor="tts-index-file">
                  <CustomSelect
                    id="tts-index-file"
                    value={indexPath}
                    onChange={(e) => setIndexPath(e.target.value)}
                    className="w-full mt-1"
                  >
                    <option value="">{t("None")}</option>
                    {indexes.map((idx) => (
                      <option key={idx} value={idx}>
                        {fileBasename(idx)} ({idx})
                      </option>
                    ))}
                  </CustomSelect>
                </FormField>
              )}

              <FormField label={t("Speaker ID")} htmlFor="tts-speaker-id">
                <CustomSelect
                  id="tts-speaker-id"
                  value={String(sid)}
                  onChange={(e) => setSid(Number(e.target.value))}
                  disabled={speakers.length <= 1}
                  className="w-full mt-1"
                >
                  {speakers.map((s) => (
                    <option key={s} value={String(s)}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </FormField>

              <FormField label={t("Export Format")} htmlFor="tts-export-format">
                <CustomSelect
                  id="tts-export-format"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="w-full mt-1"
                >
                  {["WAV", "MP3", "FLAC", "OGG", "M4A"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </CustomSelect>
              </FormField>
            </div>
          </div>
        </Card>

        {/* Card 3: Conversion Parameters */}
        <Card as="section" className="space-y-4">
          <CardHeader
            icon={<Sliders size={18} className="text-white" />}
            title={t("Conversion Parameters")}
            description={t("Adjust pitch shifting, feature index retrieval, and acoustic post-processing.")}
            action={
              <button
                type="button"
                onClick={resetDefaults}
                className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} className="text-white" />
                <span>{t("Reset Defaults")}</span>
              </button>
            }
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <SliderField
              id="tts-pitch"
              label={t("Pitch")}
              value={pitch}
              min={-24}
              max={24}
              step={1}
              unit="st"
              onChange={setPitch}
            />
            <SliderField
              id="tts-index-rate"
              label={t("Search Feature Ratio")}
              value={indexRate}
              min={0}
              max={1}
              step={0.05}
              onChange={setIndexRate}
            />
            <SliderField
              id="tts-volume-envelope"
              label={t("Volume Envelope")}
              value={volumeEnvelope}
              min={0}
              max={1}
              step={0.05}
              onChange={setVolumeEnvelope}
            />
            <SliderField
              id="tts-protect"
              label={t("Protect Voiceless Consonants")}
              value={protect}
              min={0}
              max={0.5}
              step={0.01}
              onChange={setProtect}
            />
          </div>

          <div className="space-y-4 pt-2 border-t border-white/5">
            <RadioGroup
              label={t("Pitch extraction algorithm")}
              name="f0-convert"
              options={[
                "rmvpe",
                "fcpe",
                "crepe",
                "crepe-tiny",
                "hybrid[crepe+rmvpe]",
                "hybrid[crepe+fcpe]",
                "hybrid[rmvpe+fcpe]",
              ]}
              value={f0Method}
              onChange={setF0Method}
              variant="pills"
            />

            <RadioGroup
              label={t("Embedder Model")}
              name="embedder-convert"
              options={[
                "contentvec",
                "spin",
                "spin-v2",
                "chinese-hubert-base",
                "japanese-hubert-base",
                "korean-hubert-base",
                "custom",
              ]}
              value={embedderModel}
              onChange={setEmbedderModel}
              variant="pills"
            />

            {embedderModel === "custom" && (
              <FormField label={t("Select Custom Embedder")} htmlFor="tts-custom-embedder">
                <input
                  id="tts-custom-embedder"
                  type="text"
                  value={embedderModelCustom}
                  onChange={(e) => setEmbedderModelCustom(e.target.value)}
                  placeholder="rvc/models/embedders/embedders_custom/my-embedder"
                />
              </FormField>
            )}
          </div>

          <Disclosure title={t("Advanced Settings")} icon={<Sliders size={15} />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <ToggleField label={t("Split Audio")} checked={splitAudio} onChange={setSplitAudio} />
                <ToggleField label={t("Autotune")} checked={f0Autotune} onChange={setF0Autotune} />
                <ToggleField
                  label={t("Proposed Pitch")}
                  checked={proposedPitch}
                  onChange={setProposedPitch}
                />
                <ToggleField label={t("Clean Audio")} checked={cleanAudio} onChange={setCleanAudio} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SliderField
                  id="tts-autotune-strength"
                  label={t("Autotune Strength")}
                  value={f0AutotuneStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setF0AutotuneStrength}
                />
                <SliderField
                  id="tts-proposed-threshold"
                  label={t("Proposed Pitch Threshold")}
                  value={proposedPitchThreshold}
                  min={50}
                  max={1200}
                  step={1}
                  unit="Hz"
                  onChange={setProposedPitchThreshold}
                />
                <SliderField
                  id="tts-clean-strength"
                  label={t("Clean Strength")}
                  value={cleanStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setCleanStrength}
                />
              </div>
            </div>
          </details>
        </Card>

        {/* Card 4: Action & Output Card */}
        <Card as="section" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy} icon={<Wand2 size={16} />}>
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
            >
              <div className="flex items-center justify-between text-xs text-neutral-300">
                <span className="font-medium">{t("Synthesizing speech & converting timbre…")}</span>
                <span className="text-neutral-400 capitalize">{job.status}</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-300 animate-pulse w-3/4" />
              </div>
            </div>
          )}

          {(error || (job && job.status === "error")) && (
            <Alert variant="error">{error || job?.error || t("Speech conversion failed.")}</Alert>
          )}

          {/* Synthesized Output Waveform Player */}
          {job && job.outputFile && job.status === "done" && (
            <div className="space-y-2 pt-2 border-t border-white/5 animate-in fade-in duration-200">
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
