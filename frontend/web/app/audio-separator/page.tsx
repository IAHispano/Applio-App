"use client";

import {
  Download,
  FileAudio,
  FlaskConical,
  Music4,
  Plus,
  RefreshCw,
  RotateCcw,
  Split,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import ImportModelDialog from "@/components/ImportModelDialog";
import { JobPanelContent } from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import type { GpuDevice } from "@/components/train/GpuSelect";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  Disclosure,
  SliderField,
  ToggleField,
} from "@/components/ui";
import AudioDropzone from "@/components/ui/AudioDropzone";
import SettingHelp from "@/components/ui/SettingHelp";
import { apiGet, errMsg, fetchModels, postForm } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

interface UvrModel {
  filename: string;
  name: string;
  type: string;
  stems: string[];
  target_stem: string | null;
  downloaded?: boolean;
}

interface UvrStem {
  label: string;
  file: string;
  url: string;
}

// Profiles change processing effort, never model, chunk size, batch or export settings.
const PROFILES = {
  VR: [
    [1024, false],
    [512, false],
    [320, true],
  ],
  MDX: [
    [0.1, false],
    [0.25, false],
    [0.5, true],
  ],
  MDXC: [[2], [8], [16]],
  DEMUCS: [
    [0.1, 0],
    [0.25, 2],
    [0.5, 4],
  ],
  ROFORMER: [
    [1, false],
    [2, false],
    [4, true],
  ],
} as const;
const PROFILE_LABELS = ["Fast", "Balanced", "Detailed"] as const;
// What each profile costs and buys, per the separation guide: a higher overlap
// and extra passes clean the separation up but take much longer.
const PROFILE_DESCRIPTIONS = [
  "Fewest passes and the lowest overlap: quickest, with some bleed between stems.",
  "Middle ground between speed and quality. Good for most songs.",
  "Highest overlap and extra passes: cleaner separation, but noticeably slower.",
] as const;

const DEFAULT_MODEL = "UVR-MDX-NET-Voc_FT.onnx";

function pickDefaultModel(models: UvrModel[]): string {
  const downloaded = models.find((m) => m.downloaded);
  if (downloaded) return downloaded.filename;
  if (models.some((m) => m.filename === DEFAULT_MODEL)) return DEFAULT_MODEL;
  const vocals = models.find((m) => (m.target_stem ?? "").toLowerCase().includes("vocal"));
  return vocals?.filename ?? models[0]?.filename ?? "";
}

export default function UvrPage() {
  const { t } = useI18n();
  const [models, setModels] = useWorkspaceState<UvrModel[]>("page:audio-separator:models", []);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [audioFile, setAudioFile] = useWorkspaceState<File | null>("page:audio-separator:audioFile", null);
  const [inputPath, setInputPath] = useWorkspaceState("page:audio-separator:inputPath", "");
  const [sampleAudios, setSampleAudios] = useWorkspaceState<string[]>(
    "page:audio-separator:sampleAudios",
    [],
  );
  const [model, setModel] = useWorkspaceState("page:audio-separator:model", DEFAULT_MODEL);
  const [format, setFormat] = useWorkspaceState("page:audio-separator:format", "WAV");
  const [stemMode, setStemMode] = useWorkspaceState("page:audio-separator:stemMode", "all");
  const [vrAggression, setVrAggression] = useWorkspaceState("page:audio-separator:vrAggression", 5);
  const [vrWindow, setVrWindow] = useWorkspaceState("page:audio-separator:vrWindow", 512);
  const [vrBatch, setVrBatch] = useWorkspaceState("page:audio-separator:vrBatch", 1);
  const [vrTta, setVrTta] = useWorkspaceState("page:audio-separator:vrTta", false);
  const [vrHighEnd, setVrHighEnd] = useWorkspaceState("page:audio-separator:vrHighEnd", false);
  const [vrPostProcess, setVrPostProcess] = useWorkspaceState("page:audio-separator:vrPostProcess", false);
  const [vrPostThreshold, setVrPostThreshold] = useWorkspaceState(
    "page:audio-separator:vrPostThreshold",
    0.2,
  );
  const [mdxSegment, setMdxSegment] = useWorkspaceState("page:audio-separator:mdxSegment", 256);
  const [mdxOverlap, setMdxOverlap] = useWorkspaceState("page:audio-separator:mdxOverlap", 0.25);
  const [mdxBatch, setMdxBatch] = useWorkspaceState("page:audio-separator:mdxBatch", 1);
  const [mdxHop, setMdxHop] = useWorkspaceState("page:audio-separator:mdxHop", 1024);
  const [mdxDenoise, setMdxDenoise] = useWorkspaceState("page:audio-separator:mdxDenoise", false);
  const [mdxcSegment, setMdxcSegment] = useWorkspaceState("page:audio-separator:mdxcSegment", 256);
  const [mdxcOverlap, setMdxcOverlap] = useWorkspaceState("page:audio-separator:mdxcOverlap", 8);
  const [mdxcBatch, setMdxcBatch] = useWorkspaceState("page:audio-separator:mdxcBatch", 1);
  const [mdxcOverrideSegment, setMdxcOverrideSegment] = useWorkspaceState(
    "page:audio-separator:mdxcOverrideSegment",
    false,
  );
  const [mdxcPitchShift, setMdxcPitchShift] = useWorkspaceState("page:audio-separator:mdxcPitchShift", 0);
  const [demucsSegment, setDemucsSegment] = useWorkspaceState("page:audio-separator:demucsSegment", "");
  const [demucsShifts, setDemucsShifts] = useWorkspaceState("page:audio-separator:demucsShifts", 2);
  const [demucsOverlap, setDemucsOverlap] = useWorkspaceState("page:audio-separator:demucsOverlap", 0.25);
  const [demucsSplit, setDemucsSplit] = useWorkspaceState("page:audio-separator:demucsSplit", true);
  const [roformerChunk, setRoformerChunk] = useWorkspaceState("page:audio-separator:roformerChunk", "");
  const [roformerOverlap, setRoformerOverlap] = useWorkspaceState("page:audio-separator:roformerOverlap", 2);
  const [roformerBatch, setRoformerBatch] = useWorkspaceState("page:audio-separator:roformerBatch", 1);
  const [roformerDenoise, setRoformerDenoise] = useWorkspaceState(
    "page:audio-separator:roformerDenoise",
    false,
  );
  const [device, setDevice] = useWorkspaceState("page:audio-separator:device", "auto");
  const [gpuDevices, setGpuDevices] = useWorkspaceState<GpuDevice[]>("page:audio-separator:gpuDevices", []);
  const [jobId, setJobId] = usePersistentJobId("uvr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activity = useJob(jobId);
  const { job } = activity;

  const [importOpen, setImportOpen] = useState(false);

  const modelsRequest = useRef(0);
  const loadModels = useCallback(
    async (showLoading = true) => {
      const request = ++modelsRequest.current;
      if (showLoading) setModelsLoading(true);
      try {
        const data = await apiGet<{ models: UvrModel[] }>("/api/uvr/models", { force: true });
        if (request !== modelsRequest.current) return;
        setModels(data.models);
        setModel((cur) =>
          data.models.some((m) => m.filename === cur) ? cur : pickDefaultModel(data.models),
        );
        setError("");
      } catch (e) {
        if (request === modelsRequest.current) setError(errMsg(e));
      } finally {
        if (request === modelsRequest.current) setModelsLoading(false);
      }
    },
    [setModels, setModel],
  );

  // After an import completes: refresh the catalog, select the new model and
  // close the dialog (the dialog itself is already reset).
  const handleImported = useCallback(
    async (filename: string) => {
      setImportOpen(false);
      await loadModels();
      if (filename) setModel(filename);
    },
    [loadModels, setModel],
  );

  const refreshSampleAudios = useCallback(async () => {
    try {
      const m = await fetchModels(true);
      if (m?.audios) setSampleAudios(m.audios);
    } catch {
      /* ignore */
    }
  }, [setSampleAudios]);

  useEffect(() => {
    loadModels();
    refreshSampleAudios();
    const onFocus = () => {
      refreshSampleAudios();
      void loadModels(false);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      modelsRequest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [loadModels, refreshSampleAudios]);

  useEffect(() => {
    apiGet<{
      count: number | string;
      info: string;
      devices?: GpuDevice[];
      gpus?: { id: string; name: string; kind?: string }[];
    }>("/api/train/gpus")
      .then((g) => {
        if (g.devices && g.devices.length > 0) setGpuDevices(g.devices.filter((d) => d.kind !== "mps"));
        else if (g.gpus && g.gpus.length > 0) {
          setGpuDevices(
            g.gpus
              .filter((x) => x.kind !== "mps" && x.id !== "-" && !x.id.includes("-"))
              .map((x) => ({ id: x.id, name: x.name })),
          );
        }
      })
      .catch(() => setGpuDevices([]));
  }, [setGpuDevices]);

  useEffect(() => {
    if (job?.id && job.status === "done") void loadModels(false);
  }, [job?.id, job?.status, loadModels]);

  const selectedModel = useMemo(() => models.find((m) => m.filename === model), [models, model]);
  const modelStems = useMemo(() => {
    const list = (selectedModel?.stems ?? []).filter((s) => s && s !== "Unknown");
    return list.length > 0 ? list : ["Vocals", "Instrumental"];
  }, [selectedModel]);
  const arch = (selectedModel?.type ?? "").toUpperCase();

  const profileArchitecture = arch in PROFILES ? (arch as keyof typeof PROFILES) : null;
  const currentProfileSettings =
    arch === "VR"
      ? [vrWindow, vrTta]
      : arch === "MDX"
        ? [mdxOverlap, mdxDenoise]
        : arch === "MDXC"
          ? [mdxcOverlap]
          : arch === "DEMUCS"
            ? [demucsOverlap, demucsShifts]
            : arch === "ROFORMER"
              ? [roformerOverlap, roformerDenoise]
              : [];
  const profileIndex = profileArchitecture
    ? PROFILES[profileArchitecture].findIndex((values) =>
        values.every((value, index) => value === currentProfileSettings[index]),
      )
    : -1;
  // The values the active profile sets, shown as chips under the profile picker.
  const profileSummary: { label: string; value: string }[] =
    arch === "VR"
      ? [
          { label: t("VR Window Size"), value: String(vrWindow) },
          { label: t("Test-Time Augmentation"), value: t(vrTta ? "Yes" : "No") },
        ]
      : arch === "MDX"
        ? [
            { label: t("MDX Overlap"), value: String(mdxOverlap) },
            { label: t("Denoise Output"), value: t(mdxDenoise ? "Yes" : "No") },
          ]
        : arch === "MDXC"
          ? [{ label: t("MDXC Overlap"), value: String(mdxcOverlap) }]
          : arch === "DEMUCS"
            ? [
                { label: t("Demucs Overlap"), value: String(demucsOverlap) },
                { label: t("Demucs Shifts"), value: String(demucsShifts) },
              ]
            : arch === "ROFORMER"
              ? [
                  { label: t("Roformer Overlap"), value: String(roformerOverlap) },
                  { label: t("Denoise Output"), value: t(roformerDenoise ? "Yes" : "No") },
                ]
              : [];

  function applyProfile(value: string) {
    if (!profileArchitecture || !["0", "1", "2"].includes(value)) return;
    const index = Number(value) as 0 | 1 | 2;
    if (arch === "VR") {
      const [window, tta] = PROFILES.VR[index];
      setVrWindow(window);
      setVrTta(tta);
    } else if (arch === "MDX") {
      const [overlap, denoise] = PROFILES.MDX[index];
      setMdxOverlap(overlap);
      setMdxDenoise(denoise);
    } else if (arch === "MDXC") {
      setMdxcOverlap(PROFILES.MDXC[index][0]);
    } else if (arch === "DEMUCS") {
      const [overlap, shifts] = PROFILES.DEMUCS[index];
      setDemucsOverlap(overlap);
      setDemucsShifts(shifts);
    } else if (arch === "ROFORMER") {
      const [overlap, denoise] = PROFILES.ROFORMER[index];
      setRoformerOverlap(overlap);
      setRoformerDenoise(denoise);
    }
  }

  function handleModelChange(filename: string) {
    setModel(filename);
    setStemMode("all");
  }
  const stems = useMemo(
    () => ((job?.result?.stems as UvrStem[] | undefined) ?? []).filter((s) => s?.file),
    [job],
  );
  const running = job?.status === "running" || job?.status === "queued";

  function resetSettings() {
    if (arch === "VR") {
      setVrAggression(5);
      setVrWindow(512);
      setVrBatch(1);
      setVrTta(false);
      setVrHighEnd(false);
      setVrPostProcess(false);
      setVrPostThreshold(0.2);
    } else if (arch === "MDX") {
      setMdxSegment(256);
      setMdxOverlap(0.25);
      setMdxBatch(1);
      setMdxHop(1024);
      setMdxDenoise(false);
    } else if (arch === "MDXC") {
      setMdxcSegment(256);
      setMdxcOverlap(8);
      setMdxcBatch(1);
      setMdxcOverrideSegment(false);
      setMdxcPitchShift(0);
    } else if (arch === "DEMUCS") {
      setDemucsSegment("");
      setDemucsShifts(2);
      setDemucsOverlap(0.25);
      setDemucsSplit(true);
    } else if (arch === "ROFORMER") {
      setRoformerChunk("");
      setRoformerOverlap(2);
      setRoformerBatch(1);
      setRoformerDenoise(false);
    }
  }

  async function separate() {
    setError("");
    if (!audioFile && !inputPath.trim()) {
      setError(t("Choose an audio file or enter a server path."));
      return;
    }
    if (!model) {
      setError(t("Pick a separation model first."));
      return;
    }
    const fd = new FormData();
    if (audioFile) fd.append("audio", audioFile);
    else fd.append("inputPath", inputPath.trim());
    fd.append("model", model);
    fd.append("outputFormat", format);
    fd.append("singleStem", stemMode);
    fd.append("vrAggression", String(vrAggression));
    fd.append("vrWindow", String(vrWindow));
    fd.append("vrBatch", String(vrBatch));
    fd.append("vrTta", String(vrTta));
    fd.append("vrHighEnd", String(vrHighEnd));
    fd.append("vrPostProcess", String(vrPostProcess));
    fd.append("vrPostThreshold", String(vrPostThreshold));
    fd.append("mdxSegment", String(mdxSegment));
    fd.append("mdxOverlap", String(mdxOverlap));
    fd.append("mdxBatch", String(mdxBatch));
    fd.append("mdxHop", String(mdxHop));
    fd.append("mdxDenoise", String(mdxDenoise));
    fd.append("mdxcSegment", String(mdxcSegment));
    fd.append("mdxcOverlap", String(mdxcOverlap));
    fd.append("mdxcBatch", String(mdxcBatch));
    fd.append("mdxcOverrideSegment", String(mdxcOverrideSegment));
    fd.append("mdxcPitchShift", String(mdxcPitchShift));
    fd.append("demucsSegment", demucsSegment.trim() || "Default");
    fd.append("demucsShifts", String(demucsShifts));
    fd.append("demucsOverlap", String(demucsOverlap));
    fd.append("demucsSplit", String(demucsSplit));
    if (roformerChunk.trim()) fd.append("roformerChunk", roformerChunk.trim());
    fd.append("roformerOverlap", String(roformerOverlap));
    fd.append("roformerBatch", String(roformerBatch));
    fd.append("roformerDenoise", String(roformerDenoise));
    fd.append("device", device);
    setBusy(true);
    try {
      const { jobId: id } = await postForm<{ jobId: string }>("/api/uvr/separate", fd);
      setJobId(id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col page-stack">
      <PageHeader
        title={t("Audio Separator")}
        description={t(
          "Split songs into vocals, instrumental, drums, bass and more — locally, with downloaded community models.",
        )}
      />

      <div className="grid grid-cols-1 gap-5 items-start">
        <Card className="min-w-0">
          <CardHeader
            icon={<FileAudio size={18} />}
            step={1}
            title={t("Source & Model")}
            description={t("Pick the song to split and the separation engine to use.")}
            action={
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setImportOpen(true)}
                  icon={<Plus size={12} />}
                >
                  {t("Import model")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void loadModels()}
                  disabled={modelsLoading}
                  icon={<RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />}
                >
                  {t("Reload models")}
                </Button>
              </div>
            }
          />

          <div className="space-y-5">
            <AudioDropzone
              audioFile={audioFile}
              inputPath={inputPath}
              sampleAudios={sampleAudios}
              onFileSelect={setAudioFile}
              onPathSelect={setInputPath}
              onRefreshAudios={refreshSampleAudios}
              youtube
            />
            <div className="space-y-4 pt-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="uvr-model">{t("Separation model")}</label>
                  <CustomSelect
                    id="uvr-model"
                    value={model}
                    onValueChange={handleModelChange}
                    disabled={modelsLoading || models.length === 0}
                    placeholder={modelsLoading ? t("Loading models…") : t("Select a model")}
                    className="w-full"
                    options={models.map((m) => ({
                      value: m.filename,
                      label: m.name,
                      description: (m.stems ?? []).map((stem) => t(stem)).join(" / "),
                      // The badge carries the status; the name already says the
                      // architecture and the description lists the stems.
                      badge: m.downloaded ? t("Downloaded") : m.type,
                    }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="uvr-format">{t("Output format")}</label>
                  <CustomSelect
                    id="uvr-format"
                    value={format}
                    onValueChange={setFormat}
                    className="w-full"
                    options={["WAV", "MP3", "FLAC"]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="uvr-stems">{t("Stems to keep")}</label>
                  <CustomSelect
                    id="uvr-stems"
                    value={stemMode}
                    onValueChange={setStemMode}
                    className="w-full"
                    options={[
                      { value: "all", label: t("All stems") },
                      ...modelStems.map((s) => ({ value: s, label: t("Only {stem}", { stem: t(s) }) })),
                    ]}
                  />
                </div>
              </div>

              {selectedModel && !selectedModel.downloaded && (
                <p className="field-help m-0">
                  {t("Models download on first use and are reused for offline separation.")}
                </p>
              )}
            </div>
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader
            step={2}
            icon={<FlaskConical size={18} />}
            title={t("Separation Settings")}
            description={
              arch
                ? t(
                    "Quality / VRAM trade-offs specific to the {arch} architecture. Defaults suit most songs.",
                    { arch },
                  )
                : t("Pick a model above to tune its separation settings.")
            }
          />
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              {profileArchitecture && (
                <div className="space-y-1.5">
                  <label htmlFor="uvr-profile">{t("Processing profile")}</label>
                  <CustomSelect
                    id="uvr-profile"
                    value={String(profileIndex)}
                    onValueChange={applyProfile}
                    className="w-full"
                    options={[
                      ...PROFILE_LABELS.map((label, index) => ({
                        value: String(index),
                        label: t(label),
                        description: t(PROFILE_DESCRIPTIONS[index]),
                      })),
                      ...(profileIndex === -1 ? [{ value: "-1", label: t("Custom…") }] : []),
                    ]}
                    description={
                      // The values the profile applies, in place of a second
                      // paragraph under the control.
                      profileSummary.length
                        ? profileSummary.map((item, index) => (
                            <span key={item.label}>
                              {index > 0 && " · "}
                              {item.label} <span className="text-[var(--text)]">{item.value}</span>
                            </span>
                          ))
                        : undefined
                    }
                  />
                </div>
              )}
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="uvr-device" className="block text-xs text-[var(--muted)]">
                  {t("Device")}
                </label>
                <CustomSelect
                  id="uvr-device"
                  value={device}
                  onValueChange={setDevice}
                  className="w-full"
                  options={[
                    { value: "auto", label: t("Auto (GPU if available)") },
                    { value: "cpu", label: t("CPU (saves VRAM)") },
                    ...gpuDevices.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                  description={t(SETTING_HELP.gpu)}
                />
              </div>
            </div>
            <Disclosure className="!mt-0" icon={<FlaskConical size={16} />} title={t("Advanced Settings")}>
              <div className="flex items-center justify-between gap-3">
                {arch && <Badge>{arch}</Badge>}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!arch}
                  icon={<RotateCcw size={13} />}
                  onClick={resetSettings}
                >
                  {t("Reset defaults")}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {arch === "VR" && (
                  <>
                    <SliderField
                      id="uvr-vr-aggr"
                      label={t("VR Aggression")}
                      value={vrAggression}
                      min={1}
                      max={100}
                      step={1}
                      onChange={setVrAggression}
                      description={t(
                        "Intensity of primary stem extraction — higher removes more but can damage instruments.",
                      )}
                    />
                    <SliderField
                      id="uvr-vr-window"
                      label={t("VR Window Size")}
                      value={vrWindow}
                      min={320}
                      max={1024}
                      step={32}
                      onChange={setVrWindow}
                      description={t("Lower windows give cleaner output but take longer.")}
                    />
                    <SliderField
                      id="uvr-vr-batch"
                      label={t("VR Batch Size")}
                      value={vrBatch}
                      min={1}
                      max={16}
                      step={1}
                      onChange={setVrBatch}
                      description={t("Higher batches run faster but use more VRAM.")}
                    />
                    <ToggleField
                      id="uvr-vr-tta"
                      label={t("Test-Time Augmentation")}
                      checked={vrTta}
                      onChange={setVrTta}
                      description={t("Slow second pass that improves quality.")}
                    />
                    <ToggleField
                      id="uvr-vr-high-end"
                      label={t("High-End Process")}
                      checked={vrHighEnd}
                      onChange={setVrHighEnd}
                      description={t("Mirror the missing high-frequency range of the output.")}
                    />
                    <ToggleField
                      id="uvr-vr-post-process"
                      label={t("Post-Process Vocals")}
                      checked={vrPostProcess}
                      onChange={setVrPostProcess}
                      description={t("Mute low-volume vocals left in the instrumental.")}
                    />
                    {vrPostProcess && (
                      <SliderField
                        id="uvr-vr-post-threshold"
                        label={t("Post-Process Threshold")}
                        value={vrPostThreshold}
                        min={0.01}
                        max={0.3}
                        step={0.01}
                        onChange={setVrPostThreshold}
                        description={t("Lower values remove more leftover residues.")}
                      />
                    )}
                  </>
                )}
                {arch === "MDX" && (
                  <>
                    <SliderField
                      id="uvr-mdx-seg"
                      label={t("MDX Segment Size")}
                      value={mdxSegment}
                      min={32}
                      max={4000}
                      step={32}
                      onChange={setMdxSegment}
                      description={t("Larger consumes more resources, but may give better results.")}
                    />
                    <SliderField
                      id="uvr-mdx-overlap"
                      label={t("MDX Overlap")}
                      value={mdxOverlap}
                      min={0}
                      max={0.99}
                      step={0.01}
                      onChange={setMdxOverlap}
                      description={t(
                        "Higher overlap is cleaner but slower. Above ~0.93 gets tremendously slow with little gain.",
                      )}
                    />
                    <SliderField
                      id="uvr-mdx-batch"
                      label={t("MDX Batch Size")}
                      value={mdxBatch}
                      min={1}
                      max={16}
                      step={1}
                      onChange={setMdxBatch}
                      description={t(
                        "Larger batches can improve speed when the model supports them; fixed-batch models keep their required size.",
                      )}
                    />
                    <SliderField
                      id="uvr-mdx-hop"
                      label={t("MDX Hop Length")}
                      value={mdxHop}
                      min={32}
                      max={2048}
                      step={32}
                      onChange={setMdxHop}
                      description={t("Stride of the network — only change if you know what you're doing.")}
                    />
                    <ToggleField
                      id="uvr-mdx-denoise"
                      label={t("Denoise Output")}
                      checked={mdxDenoise}
                      onChange={setMdxDenoise}
                      description={t("Dual-pass denoise; reduces MDX noise but can muddy instrumentals.")}
                    />
                  </>
                )}
                {arch === "MDXC" && (
                  <>
                    <SliderField
                      id="uvr-mdxc-seg"
                      label={t("MDXC Segment Size")}
                      value={mdxcSegment}
                      min={32}
                      max={4000}
                      step={32}
                      onChange={setMdxcSegment}
                      description={t("Larger consumes more resources, but may give better results.")}
                    />
                    <SliderField
                      id="uvr-mdxc-overlap"
                      label={t("MDXC Overlap")}
                      value={mdxcOverlap}
                      min={1}
                      max={50}
                      step={1}
                      onChange={setMdxcOverlap}
                      description={t("Overlapping prediction windows — higher is cleaner but slower.")}
                    />
                    <SliderField
                      id="uvr-mdxc-batch"
                      label={t("MDXC Batch Size")}
                      value={mdxcBatch}
                      min={1}
                      max={16}
                      step={1}
                      onChange={setMdxcBatch}
                      description={t("Higher batches run faster but use more VRAM.")}
                    />
                    <ToggleField
                      id="uvr-mdxc-override-segment"
                      label={t("Override Model Segment Size")}
                      checked={mdxcOverrideSegment}
                      onChange={setMdxcOverrideSegment}
                      description={t(
                        "Always use the segment size above instead of the larger automatic one selected for short songs.",
                      )}
                    />
                    <SliderField
                      id="uvr-mdxc-pitch-shift"
                      label={t("MDXC Pitch Shift")}
                      value={mdxcPitchShift}
                      min={-12}
                      max={12}
                      step={1}
                      onChange={setMdxcPitchShift}
                      description={t(
                        "Shift audio pitch by a number of semitones while processing. May improve output for deep/high vocals.",
                      )}
                    />
                  </>
                )}
                {arch === "DEMUCS" && (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor="uvr-demucs-seg">{t("Demucs Segment Size (seconds)")}</label>
                      <input
                        id="uvr-demucs-seg"
                        type="number"
                        min={1}
                        value={demucsSegment}
                        onChange={(e) => setDemucsSegment(e.target.value)}
                        placeholder={t("Default (optimal size)")}
                        className="w-full mt-1"
                        aria-describedby={`${"uvr-demucs-seg"}-help`}
                      />
                      <SettingHelp text={t(SETTING_HELP.demucsSegment)} controlId={"uvr-demucs-seg"} />
                    </div>
                    <SliderField
                      id="uvr-demucs-shifts"
                      label={t("Demucs Shifts")}
                      value={demucsShifts}
                      min={0}
                      max={20}
                      step={1}
                      onChange={setDemucsShifts}
                      description={t("More shifted predictions average out artifacts but take longer.")}
                    />
                    <SliderField
                      id="uvr-demucs-overlap"
                      label={t("Demucs Overlap")}
                      value={demucsOverlap}
                      min={0}
                      max={0.99}
                      step={0.01}
                      onChange={setDemucsOverlap}
                      description={t("Impacts quality more than shifts; above ~0.75 gets very slow.")}
                    />
                    <ToggleField
                      id="uvr-demucs-split"
                      label={t("Chunk Splitting")}
                      checked={demucsSplit}
                      onChange={setDemucsSplit}
                      description={t("Split the track into chunks to save VRAM.")}
                      className="mt-3"
                    />
                  </>
                )}
                {arch === "ROFORMER" && (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor="uvr-roformer-chunk">{t("Roformer Chunk Size (seconds)")}</label>
                      <input
                        id="uvr-roformer-chunk"
                        type="number"
                        min={1}
                        value={roformerChunk}
                        onChange={(e) => setRoformerChunk(e.target.value)}
                        placeholder={t("Model default (from config)")}
                        className="w-full mt-1"
                        aria-describedby={`${"uvr-roformer-chunk"}-help`}
                      />
                      <SettingHelp text={t(SETTING_HELP.roformerChunk)} controlId={"uvr-roformer-chunk"} />
                      <p className="text-[11px] text-neutral-500 m-0 leading-relaxed">
                        {t(
                          "Higher than the training value can help until quality degrades; lower it if you run out of VRAM.",
                        )}
                      </p>
                    </div>
                    <SliderField
                      id="uvr-roformer-overlap"
                      label={t("Roformer Overlap")}
                      value={roformerOverlap}
                      min={1}
                      max={32}
                      step={1}
                      onChange={setRoformerOverlap}
                      description={t(
                        "4 is balanced for speed and quality; higher is slightly cleaner but much slower.",
                      )}
                    />
                    <SliderField
                      id="uvr-roformer-batch"
                      label={t("Roformer Batch Size")}
                      value={roformerBatch}
                      min={1}
                      max={16}
                      step={1}
                      onChange={setRoformerBatch}
                      description={t("Higher batches run faster but use more VRAM.")}
                    />
                    <ToggleField
                      id="uvr-roformer-denoise"
                      label={t("Denoise Output")}
                      checked={roformerDenoise}
                      onChange={setRoformerDenoise}
                      description={t("Dual-pass Roformer denoise; reduces noise but doubles inference time.")}
                    />
                  </>
                )}
                {arch !== "VR" &&
                  arch !== "MDX" &&
                  arch !== "MDXC" &&
                  arch !== "DEMUCS" &&
                  arch !== "ROFORMER" && (
                    <p className="text-xs text-neutral-400 m-0 sm:col-span-2">
                      {t("Pick a model above to tune its separation settings.")}
                    </p>
                  )}
              </div>
            </Disclosure>
            <div className="space-y-3 pt-4">
              {error && (
                <Alert variant="error" onDismiss={() => setError("")}>
                  {error}
                </Alert>
              )}

              <Button
                onClick={separate}
                disabled={
                  busy || running || modelsLoading || (!audioFile && !inputPath.trim()) || !selectedModel
                }
                loading={busy}
                icon={<Split size={16} />}
                className="w-full"
              >
                {running ? t("Separating…") : t("Separate Stems")}
              </Button>
              {running && (
                <span className="text-xs text-neutral-400 sm:col-span-2">
                  {t("Downloading weights on first run takes a while.")}
                </span>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Results */}
      {(jobId || busy) && (
        <Card>
          <CardHeader
            icon={<Music4 size={18} />}
            title={t("Separated Stems")}
            description={t("Preview each stem and download what you need.")}
          />
          <JobPanelContent jobId={jobId} activity={activity} embedded showOutput={false} />
          {stems.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {stems.map((s) => (
                <div
                  key={s.file}
                  className="p-4 min-w-0 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant={/vocals/i.test(s.label) ? "success" : "neutral"} dot>
                      {t(s.label)}
                    </Badge>
                    <Button
                      href={s.url}
                      download
                      variant="ghost"
                      size="xs"
                      icon={<Download size={13} />}
                      aria-label={`${t("Download")} ${t(s.label)}`}
                    >
                      {t("Download")}
                    </Button>
                  </div>
                  <AudioWavePlayer src={s.url} filename={s.file.split("/").pop() ?? s.file} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 m-0 flex items-center gap-2">
              <Wand2 size={14} />
              {t("Stems appear here after separation.")}
            </p>
          )}
        </Card>
      )}

      <ImportModelDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />
    </div>
  );
}
