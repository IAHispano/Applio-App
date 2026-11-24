"use client";

import { FileText, Type, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ConversionParameters from "@/components/ConversionParameters";
import ConversionStatusCard from "@/components/ConversionStatusCard";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CustomSelect,
  FileInput,
  FormField,
  SegmentedControl,
  SliderField,
} from "@/components/ui";
import VoiceModelCard from "@/components/VoiceModelCard";
import {
  apiGet,
  apiSend,
  cachedModels,
  errMsg,
  fetchModels,
  fileBasename,
  onModelsChanged,
  outputUrl,
  postForm,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { SETTING_HELP } from "@/lib/setting-help";
import { useConversionParameters } from "@/lib/useConversionParameters";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";
import { useWorkspaceState } from "@/lib/workspace-state";

interface Voice {
  shortName: string;
  friendlyName: string;
  gender: string;
  locale: string;
}

export default function TtsForm() {
  const [voices, setVoices] = useWorkspaceState<Voice[]>("TtsForm:components:voices", []);
  const [models, setModels] = useWorkspaceState<string[]>(
    "TtsForm:components:models",
    () => cachedModels()?.models ?? [],
  );
  const { t } = useI18n();
  const [text, setText] = useWorkspaceState("TtsForm:components:text", "");
  const [file, setFile] = useWorkspaceState<File | null>("TtsForm:components:file", null);
  const [textSource, setTextSource] = useWorkspaceState<"write" | "upload">(
    "TtsForm:components:textSource",
    "write",
  );
  const [voice, setVoice] = useWorkspaceState("TtsForm:components:voice", "");
  const [rate, setRate] = useWorkspaceState("TtsForm:components:rate", 0);
  const [pthPath, setPthPath] = useWorkspaceState("TtsForm:components:pthPath", "");
  const [indexes, setIndexes] = useWorkspaceState<string[]>(
    "TtsForm:components:indexes",
    () => cachedModels()?.indexes ?? [],
  );
  const [indexPath, setIndexPath] = useWorkspaceState("TtsForm:components:indexPath", "");
  const conversion = useConversionParameters(pthPath);
  // Latest conversion values for callbacks that must not depend on them.
  const conversionValuesRef = useRef(conversion.values);
  conversionValuesRef.current = conversion.values;
  const primedRef = useRef("");
  const [sid, setSid] = useWorkspaceState("TtsForm:components:sid", 0);
  const [jobId, setJobId] = usePersistentJobId("tts");
  const { job: watchedJob, error, setError, stop } = useJob(jobId);
  const job = watchedJob?.id === jobId ? watchedJob : null;
  const awaitingJob = Boolean(jobId && !job && !error);
  const [busy, setBusy] = useState(false);
  const [voicesError, setVoicesError] = useState("");

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid, setSid]);

  const handleModelSelect = useCallback(
    (selected: string, idxList: string[]) => {
      setPthPath(selected);
      setIndexPath(matchIndex(selected, idxList));
      setSid(0);
      if (selected) {
        primedRef.current = selected;
        void apiSend("/api/models/preload", "POST", {
          pthPath: selected,
          prime: true,
          params: {
            ...conversionValuesRef.current,
            pthPath: selected,
            indexPath: matchIndex(selected, idxList),
            sid: 0,
            exportFormat: "WAV",
          },
        }).catch(() => {});
      }
    },
    [setSid, setPthPath, setIndexPath],
  );

  // Warm a model restored from presets, so the first conversion does not sit
  // on model loading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: prime once per selected model
  useEffect(() => {
    if (!conversion.loaded || !pthPath || primedRef.current === pthPath) return;
    primedRef.current = pthPath;
    void apiSend("/api/models/preload", "POST", {
      pthPath,
      prime: true,
      params: {
        ...conversionValuesRef.current,
        pthPath,
        indexPath: matchIndex(pthPath, indexes),
        sid: 0,
        exportFormat: "WAV",
      },
    }).catch(() => {});
  }, [conversion.loaded, pthPath]);

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
    [pthPath, handleModelSelect, setModels, setIndexes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    apiGet<{ voices: Voice[] }>("/api/tts/voices")
      .then((v) => {
        setVoices(v.voices);
        if (v.voices[0]) setVoice((current) => current || v.voices[0].shortName);
      })
      .catch((e) => setVoicesError(errMsg(e)));
    loadModels(false);
  }, []);

  useEffect(() => {
    const unsubscribe = onModelsChanged((models) => {
      setModels(models.models);
      setIndexes(models.indexes);
    });
    const onFocus = () => loadModels(false);
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [loadModels, setIndexes, setModels]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || awaitingJob || job?.status === "queued" || job?.status === "running") return;
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

  const disabledReason = !conversion.loaded
    ? t("Loading model settings…")
    : !pthPath
      ? t("Select a voice model.")
      : !text.trim() && !file
        ? t("Enter text or upload a .txt file.")
        : "";
  const resultModel = job?.params?.pthPath;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="card-stack">
        <div className="grid grid-cols-1 xl:grid-cols-2 card-grid">
          {/* Card 1: Speech Synthesis Source */}
          <Card as="section" className="space-y-4">
            <CardHeader
              icon={<FileText size={18} className="text-white" />}
              title={t("Speech Synthesis Source")}
              step={1}
              description={t(
                "Enter text or upload a text file to synthesize speech before voice conversion.",
              )}
              action={
                <Badge variant="neutral" size="sm">
                  {voices.length} {t("voices available")}
                </Badge>
              }
            />
            {voicesError && (
              <Alert variant="error" onDismiss={() => setVoicesError("")}>
                {voicesError}
              </Alert>
            )}

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
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("Hello, this is Applio.")}
                    className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-3 text-[var(--text)]"
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
                    options={voices.map((v) => ({
                      value: v.shortName,
                      label: `${v.friendlyName} (${v.gender})`,
                    }))}
                  />
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

          <VoiceModelCard
            step={2}
            models={models}
            selectedModel={pthPath}
            indexes={indexes}
            indexPath={indexPath}
            indexSelectId="tts-index-file"
            onSelect={(selected) => handleModelSelect(selected, indexes)}
            onUnload={handleUnloadModel}
            onRefresh={loadModels}
            onOpen={() => loadModels(false)}
            onIndexChange={setIndexPath}
            speakers={speakers}
            sid={sid}
            onSpeakerChange={setSid}
          />
        </div>

        <ConversionParameters
          step={3}
          idPrefix="tts"
          cleanupStage="output"
          simplified
          values={conversion.values}
          setters={conversion.setters}
          onReset={conversion.reset}
        />

        <ConversionStatusCard
          label={t("Convert Speech")}
          disabledReason={disabledReason}
          pending={busy ? "submitting" : awaitingJob ? "loading" : undefined}
          job={job}
          onStop={stop}
          error={error}
          onDismissError={() => setError("")}
          failureMessage={t("Speech conversion failed.")}
          missingOutput={
            job?.status === "done" && !job.outputFile
              ? t("TTS finished but no output file was found.")
              : undefined
          }
        />
        {job?.outputFile && job.status === "done" && (
          <AudioWavePlayer
            key={job.id}
            src={outputUrl(job.outputFile)}
            resultLabel={t("Synthesized Speech Output")}
            title={fileBasename(
              typeof resultModel === "string" && resultModel ? resultModel : "speech",
            ).replace(/\.(pth|onnx)$/i, "")}
            filename={fileBasename(job.outputFile)}
          />
        )}
      </form>
    </div>
  );
}
