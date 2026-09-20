"use client";

import { Download, FileAudio, FlaskConical, Music4, RefreshCw, Split, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import JobPanel from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import type { GpuDevice } from "@/components/train/GpuSelect";
import { Alert, Badge, Button, Card, CardHeader, CustomSelect, SliderField } from "@/components/ui";
import AudioDropzone from "@/components/ui/AudioDropzone";
import { apiGet, errMsg, fetchModels, postForm } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob, usePersistentJobId } from "@/lib/useJob";

interface UvrModel {
  filename: string;
  name: string;
  type: string;
  stems: string[];
  target_stem: string | null;
}

interface UvrStem {
  label: string;
  file: string;
  url: string;
}

const DEFAULT_MODEL = "UVR-MDX-NET-Voc_FT.onnx";

function pickDefaultModel(models: UvrModel[]): string {
  if (models.some((m) => m.filename === DEFAULT_MODEL)) return DEFAULT_MODEL;
  const vocals = models.find((m) => (m.target_stem ?? "").toLowerCase().includes("vocal"));
  return vocals?.filename ?? models[0]?.filename ?? "";
}

export default function UvrPage() {
  const { t } = useI18n();
  const [models, setModels] = useState<UvrModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [inputPath, setInputPath] = useState("");
  const [sampleAudios, setSampleAudios] = useState<string[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [format, setFormat] = useState("WAV");
  const [stemMode, setStemMode] = useState("all");
  const [vrAggression, setVrAggression] = useState(5);
  const [vrWindow, setVrWindow] = useState(512);
  const [mdxSegment, setMdxSegment] = useState(256);
  const [mdxOverlap, setMdxOverlap] = useState(0.25);
  const [device, setDevice] = useState("auto");
  const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>([]);
  const [jobId, setJobId] = usePersistentJobId("uvr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { job } = useJob(jobId);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await apiGet<{ models: UvrModel[] }>("/api/uvr/models", { force: true });
      setModels(data.models);
      setModel((cur) => (data.models.some((m) => m.filename === cur) ? cur : pickDefaultModel(data.models)));
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
    fetchModels()
      .then((m) => setSampleAudios(m.audios))
      .catch(() => {});
    apiGet<{
      count: number | string;
      info: string;
      devices?: GpuDevice[];
      gpus?: { id: string; name: string }[];
    }>("/api/train/gpus")
      .then((g) => {
        if (g.devices && g.devices.length > 0) setGpuDevices(g.devices);
        else if (g.gpus && g.gpus.length > 0) {
          setGpuDevices(
            g.gpus
              .filter((x) => x.id !== "-" && !x.id.includes("-"))
              .map((x) => ({ id: x.id, name: x.name })),
          );
        }
      })
      .catch(() => setGpuDevices([]));
  }, [loadModels]);

  const selectedModel = useMemo(() => models.find((m) => m.filename === model), [models, model]);
  const modelStems = useMemo(() => {
    const list = (selectedModel?.stems ?? []).filter((s) => s && s !== "Unknown");
    return list.length > 0 ? list : ["Vocals", "Instrumental"];
  }, [selectedModel]);
  const arch = selectedModel?.type ?? "";

  function handleModelChange(filename: string) {
    setModel(filename);
    setStemMode("all");
  }
  const stems = useMemo(
    () => ((job?.result?.stems as UvrStem[] | undefined) ?? []).filter((s) => s?.file),
    [job],
  );
  const running = job?.status === "running" || job?.status === "queued";

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
    fd.append("mdxSegment", String(mdxSegment));
    fd.append("mdxOverlap", String(mdxOverlap));
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
    <div className="w-full max-w-[1920px] mx-auto flex flex-col gap-6">
      <PageHeader
        title={t("Audio Separator")}
        description={t(
          "Split songs into vocals, instrumental, drums, bass and more — locally, with downloaded community models.",
        )}
      />

      <Alert variant="info">
        {t(
          "First run downloads the selected model weights (50–300 MB) into assets/uvr-models. Afterwards separation works fully offline.",
        )}
      </Alert>

      {/* Source & Model */}
      <Card>
        <CardHeader
          icon={<FileAudio size={18} className="text-white" />}
          title={t("Source & Model")}
          description={t("Pick the song to split and the separation engine to use.")}
          action={
            <Button
              size="xs"
              variant="ghost"
              onClick={loadModels}
              disabled={modelsLoading}
              icon={<RefreshCw size={12} className={modelsLoading ? "animate-spin" : ""} />}
            >
              {t("Reload models")}
            </Button>
          }
        />

        <AudioDropzone
          audioFile={audioFile}
          inputPath={inputPath}
          sampleAudios={sampleAudios}
          onFileSelect={setAudioFile}
          onPathSelect={setInputPath}
          youtube
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5 sm:col-span-1">
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
                description: `${m.type} · ${(m.stems ?? []).join(" / ") || "stems"}`,
                badge: m.type,
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
                ...modelStems.map((s) => ({ value: s, label: `${s} · ${t("only")}` })),
              ]}
            />
          </div>
        </div>

        {selectedModel && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="neutral">{selectedModel.type}</Badge>
            {(selectedModel.stems ?? []).slice(0, 6).map((s) => (
              <Badge key={s} variant={s === selectedModel.target_stem ? "success" : "outline"}>
                {s}
              </Badge>
            ))}
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex items-center gap-3 pt-3.5 border-t border-white/5 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="uvr-device" className="text-xs text-neutral-400 whitespace-nowrap">
              {t("Device")}
            </label>
            <CustomSelect
              id="uvr-device"
              value={device}
              onValueChange={setDevice}
              className="w-52"
              options={[
                { value: "auto", label: t("Auto (GPU if available)") },
                { value: "cpu", label: t("CPU (saves VRAM)") },
                ...gpuDevices.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          </div>
          <Button
            onClick={separate}
            disabled={busy || running || (!audioFile && !inputPath.trim()) || !model}
            loading={busy}
            icon={<Split size={16} />}
          >
            {running ? t("Separating…") : t("Separate Stems")}
          </Button>
          {running && (
            <span className="text-xs text-neutral-400">
              {t("Downloading weights on first run takes a while.")}
            </span>
          )}
        </div>
      </Card>

      {/* Engine tuning */}
      <Card>
        <CardHeader
          icon={<FlaskConical size={18} className="text-white" />}
          title={t("Engine Tuning")}
          description={t("Quality / VRAM trade-offs. Defaults suit most songs.")}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {arch === "VR" && (
            <>
              <SliderField
                id="uvr-vr-aggr"
                label={t("VR Aggression")}
                value={vrAggression}
                min={1}
                max={20}
                step={1}
                onChange={setVrAggression}
                description={t("Higher cuts vocals more aggressively.")}
              />
              <div className="space-y-1.5">
                <label htmlFor="uvr-vr-window">{t("VR Window Size")}</label>
                <CustomSelect
                  id="uvr-vr-window"
                  value={String(vrWindow)}
                  onValueChange={(v) => setVrWindow(Number(v))}
                  className="w-full"
                  options={["320", "512", "1024"]}
                />
              </div>
            </>
          )}
          {arch === "MDX" && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="uvr-mdx-seg">{t("MDX Segment Size")}</label>
                <CustomSelect
                  id="uvr-mdx-seg"
                  value={String(mdxSegment)}
                  onValueChange={(v) => setMdxSegment(Number(v))}
                  className="w-full"
                  options={["64", "128", "256", "512"]}
                />
              </div>
              <SliderField
                id="uvr-mdx-overlap"
                label={t("MDX Overlap")}
                value={mdxOverlap}
                min={0}
                max={0.9}
                step={0.05}
                onChange={setMdxOverlap}
                description={t("Higher overlap is cleaner but slower.")}
              />
            </>
          )}
          {arch !== "VR" && arch !== "MDX" && (
            <p className="text-xs text-neutral-400 m-0 sm:col-span-2 xl:col-span-4">
              {arch === "MDXC"
                ? t("Roformer models separate with built-in settings.")
                : arch === "Demucs"
                  ? t("Demucs models separate with built-in settings.")
                  : t("Pick a model above to tune its engine settings.")}
            </p>
          )}
        </div>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader
          icon={<Music4 size={18} className="text-white" />}
          title={t("Separated Stems")}
          description={t("Preview each stem and download what you need.")}
        />
        {stems.length > 0 ? (
          <div className="space-y-3">
            {stems.map((s) => (
              <div key={s.file} className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant={/vocals/i.test(s.label) ? "success" : "neutral"} dot>
                    {s.label}
                  </Badge>
                  <Button href={s.url} download variant="ghost" size="xs" icon={<Download size={13} />}>
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
        <JobPanel jobId={jobId} embedded />
      </Card>
    </div>
  );
}
