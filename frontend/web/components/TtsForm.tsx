"use client";

import { FileText, Type, Upload, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ConversionParameters from "@/components/ConversionParameters";
import { JobError, JobProgress, JobStage } from "@/components/JobStatus";
import { TtsModelDownload, TtsModelImport } from "@/components/TtsModelFiles";
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
  stopJob,
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
  licenseUrl?: string;
}

export default function TtsForm() {
  const [savedProvider, setProvider] = useWorkspaceState("TtsForm:components:provider", "edge");
  const provider = savedProvider === "rvc" ? "rvc" : "edge";
  const direct = provider === "rvc";
  const [frontend, setFrontend] = useWorkspaceState("TtsForm:frontend", "");
  const [frontends, setFrontends] = useState<string[]>([]);
  const [voiceCatalogs, setVoiceCatalogs] = useWorkspaceState<Record<string, Voice[]>>(
    "TtsForm:components:voiceCatalogs",
    {},
  );
  const voices = voiceCatalogs[provider] ?? [];
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
  const selectedVoice = voice;
  const setSelectedVoice = setVoice;
  const [rate, setRate] = useWorkspaceState("TtsForm:components:rate", 0);
  const [pthPath, setPthPath] = useWorkspaceState("TtsForm:components:pthPath", "");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("provider") === "rvc") {
      setProvider("rvc");
      const path = query.get("frontend");
      if (path) setFrontend(path);
      const voice = query.get("pth");
      if (voice) setPthPath(voice);
    }
  }, [setProvider, setFrontend, setPthPath]);
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
  const { job, error, setError } = useJob(jobId);
  const [busy, setBusy] = useState(false);

  const speakers = useSpeakers(pthPath);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid, setSid]);

  const handleModelSelect = useCallback(
    (selected: string, idxList: string[]) => {
      setPthPath(selected);
      setIndexPath(matchIndex(selected, idxList));
      setSid(0);
      if (selected && !direct) {
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
    [direct, setSid, setPthPath, setIndexPath],
  );

  // Warm a model restored from presets, so the first conversion does not sit
  // on model loading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: prime once per selected model
  useEffect(() => {
    if (direct || !conversion.loaded || !pthPath || primedRef.current === pthPath) return;
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
  }, [direct, conversion.loaded, pthPath]);

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
          if (m.models.length > 0 && !pthPath && !new URLSearchParams(window.location.search).get("pth"))
            handleModelSelect(m.models[0], m.indexes);
        })
        .catch(() => {});
    },
    [pthPath, handleModelSelect, setModels, setIndexes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    loadModels(false);
  }, []);

  useEffect(() => {
    let active = true;
    if (provider === "rvc") {
      apiGet<{ frontends: string[] }>("/api/tts/frontends")
        .then(({ frontends }) => {
          if (!active) return;
          setFrontends(frontends);
          setFrontend((current) => current || frontends[0] || "");
        })
        .catch((error) => {
          if (active) setError(errMsg(error));
        });
      return () => {
        active = false;
      };
    }
    apiGet<{ voices: Voice[] }>(`/api/tts/voices?provider=${provider}`)
      .then(({ voices: entries }) => {
        if (!active) return;
        setVoiceCatalogs((current) => ({ ...current, [provider]: entries }));
        setVoice((current) =>
          entries.some((entry) => entry.shortName === current) ? current : (entries[0]?.shortName ?? ""),
        );
      })
      .catch((e) => {
        if (active) setError(errMsg(e));
      });
    return () => {
      active = false;
    };
  }, [provider, setError, setVoice, setVoiceCatalogs, setFrontend]);

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
      fd.append("ttsProvider", provider);
      fd.append("ttsFrontend", frontend);
      fd.append("ttsText", text);
      if (file) fd.append("txt_file", file);
      fd.append("ttsVoice", selectedVoice);
      fd.append("ttsRate", String(rate));
      fd.append("pthPath", pthPath);
      fd.append("indexPath", direct ? "" : indexPath);
      if (direct) {
        fd.append("exportFormat", "WAV");
      } else {
        for (const [key, value] of Object.entries(conversion.values)) {
          fd.append(key, String(value));
        }
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

  const disabledReason =
    busy || job?.status === "running" || job?.status === "queued"
      ? t("Wait for the current conversion to finish.")
      : !conversion.loaded
        ? t("Loading model settings…")
        : !pthPath
          ? t("Select a voice model.")
          : direct
            ? !frontend.trim()
              ? t("Select a TTS model.")
              : !text.trim() && !file
                ? t("Enter text or upload a .txt file.")
                : ""
            : !voices.some((entry) => entry.shortName === selectedVoice)
              ? t("Select…")
              : !text.trim() && !file
                ? t("Enter text or upload a .txt file.")
                : "";

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
            step={1}
            description={
              direct
                ? t("Generate speech locally using your voice model and trained TTS model.")
                : t("Enter text or upload a text file to synthesize speech before voice conversion.")
            }
            action={
              <Badge variant="neutral" size="sm">
                {direct ? (
                  t("Applio TTS")
                ) : (
                  <>
                    {voices.length} {t("voices available")}
                  </>
                )}
              </Badge>
            }
          />

          <div className="space-y-3">
            <FormField label={t("TTS engine")} htmlFor="tts-provider-select">
              <CustomSelect
                id="tts-provider-select"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                options={[
                  { value: "edge", label: "Edge TTS" },
                  { value: "rvc", label: t("Applio TTS") },
                ]}
                description={
                  direct
                    ? t("Generate speech locally using your voice model and trained TTS model.")
                    : t("Online speech synthesis. Your text is sent to {provider}.", {
                        provider: "Microsoft",
                      })
                }
              />
            </FormField>
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
                  className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[var(--text)]"
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
              {direct ? (
                <FormField label={t("TTS model")} htmlFor="tts-frontend">
                  <input
                    id="tts-frontend"
                    type="text"
                    value={frontend}
                    onChange={(event) => setFrontend(event.target.value)}
                    list="tts-frontend-models"
                    required
                  />
                  <datalist id="tts-frontend-models">
                    {frontends.map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                  <TtsModelImport
                    disabled={busy}
                    onImport={(path) => {
                      setFrontend(path);
                      setFrontends((current) => [...new Set([...current, path])]);
                    }}
                  />
                  {frontend && <TtsModelDownload frontend={frontend} />}
                  <Link className="field-help underline" href="/train?mode=text">
                    {t("Enable TTS for a voice")}
                  </Link>
                </FormField>
              ) : (
                <FormField label={t("TTS Voices")} htmlFor="tts-voice-select">
                  <CustomSelect
                    id="tts-voice-select"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="w-full mt-1"
                    searchable
                    description={t(SETTING_HELP.ttsVoice)}
                    options={voices.map((v) => ({
                      value: v.shortName,
                      label: v.gender ? `${v.friendlyName} (${v.gender})` : v.friendlyName,
                    }))}
                  />
                </FormField>
              )}

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
          hideIndex={direct}
          showPresetStatus={!direct}
          description={direct ? t("Select a voice model.") : undefined}
          step={2}
          models={models}
          selectedModel={pthPath}
          indexes={indexes}
          indexPath={direct ? "" : indexPath}
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

        {!direct && (
          <ConversionParameters
            step={3}
            idPrefix="tts"
            cleanupStage="output"
            simplified
            values={conversion.values}
            setters={conversion.setters}
            onReset={conversion.reset}
          />
        )}

        {/* Card 4: Action & Output Card */}
        <Card as="section" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={Boolean(disabledReason)}
                aria-describedby={disabledReason ? "tts-convert-help" : undefined}
                icon={<Wand2 size={16} />}
              >
                {busy ? t("Submitting…") : t("Generate Speech")}
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

          {disabledReason && (
            <p id="tts-convert-help" className="field-help m-0" role="status" aria-live="polite">
              {disabledReason}
            </p>
          )}

          {/* Conversion In Progress Live Progress Bar */}
          {(busy || (job && (job.status === "running" || job.status === "queued"))) && (
            <div
              className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-2 animate-in fade-in duration-200"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-xs text-neutral-300">
                <span className="font-medium">
                  {busy ? t("Submitting…") : job ? <JobStage job={job} /> : t("Working…")}
                </span>
                <span className="text-neutral-400 capitalize">
                  {busy ? t("Submitting…") : job?.status === "queued" ? t("Queued") : t("In Progress")}
                </span>
              </div>
              <JobProgress
                status={busy ? "running" : (job?.status ?? "running")}
                progress={!busy && job?.status === "running" ? job.progress : undefined}
              />
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
        </Card>
        {job?.outputFile && job.status === "done" && (
          <AudioWavePlayer
            src={outputUrl(job.outputFile)}
            resultLabel={t("Synthesized Speech Output")}
            title={fileBasename(
              typeof job.params?.pthPath === "string" ? job.params.pthPath : job.outputFile,
            ).replace(/\.(pth|onnx)$/i, "")}
            filename={fileBasename(job.outputFile)}
          />
        )}
      </form>
    </div>
  );
}
