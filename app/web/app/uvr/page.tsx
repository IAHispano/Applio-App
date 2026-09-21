"use client";

import { Download, FileAudio, FlaskConical, Music4, RefreshCw, Split, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import JobPanel from "@/components/JobPanel";
import PageHeader from "@/components/layout/PageHeader";
import type { GpuDevice } from "@/components/train/GpuSelect";
import { Alert, Badge, Button, Card, CardHeader, CustomSelect, SliderField, ToggleField } from "@/components/ui";
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
  const [vrBatch, setVrBatch] = useState(1);
  const [vrTta, setVrTta] = useState(false);
  const [vrHighEnd, setVrHighEnd] = useState(false);
  const [vrPostProcess, setVrPostProcess] = useState(false);
  const [vrPostThreshold, setVrPostThreshold] = useState(0.2);
  const [mdxSegment, setMdxSegment] = useState(256);
  const [mdxOverlap, setMdxOverlap] = useState(0.25);
  const [mdxBatch, setMdxBatch] = useState(1);
  const [mdxHop, setMdxHop] = useState(1024);
  const [mdxDenoise, setMdxDenoise] = useState(false);
  const [mdxcSegment, setMdxcSegment] = useState(256);
  const [mdxcOverlap, setMdxcOverlap] = useState(8);
  const [mdxcBatch, setMdxcBatch] = useState(1);
  const [demucsSegment, setDemucsSegment] = useState("");
  const [demucsShifts, setDemucsShifts] = useState(2);
  const [demucsOverlap, setDemucsOverlap] = useState(0.25);
  const [demucsSplit, setDemucsSplit] = useState(true);
  const [roformerChunk, setRoformerChunk] = useState("");
  const [roformerOverlap, setRoformerOverlap] = useState(2);
  const [roformerBatch, setRoformerBatch] = useState(1);
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
  const arch = (selectedModel?.type ?? "").toUpperCase();

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
    fd.append("demucsSegment", demucsSegment.trim() || "Default");
    fd.append("demucsShifts", String(demucsShifts));
    fd.append("demucsOverlap", String(demucsOverlap));
    fd.append("demucsSplit", String(demucsSplit));
    if (roformerChunk.trim()) fd.append("roformerChunk", roformerChunk.trim());
    fd.append("roformerOverlap", String(roformerOverlap));
    fd.append("roformerBatch", String(roformerBatch));
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
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <label htmlFor="uvr-device" className="text-xs text-neutral-400 whitespace-nowrap">
              {t("Device")}
            </label>
            <CustomSelect
              id="uvr-device"
              value={device}
              onValueChange={setDevice}
              className="w-full sm:w-52"
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

      {/* Separation settings (per architecture) */}
      <Card>
        <CardHeader
          icon={<FlaskConical size={18} className="text-white" />}
          title={t("Separation Settings")}
          description={
            arch
              ? t(`Quality / VRAM trade-offs specific to the ${arch} architecture. Defaults suit most songs.`)
              : t("Pick a model above to tune its separation settings.")
          }
          action={
            arch ? (
              <Badge variant="neutral" size="sm">
                {arch}
              </Badge>
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
                description={t("Intensity of primary stem extraction — higher removes more but can damage instruments.")}
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
                description={t("Higher overlap is cleaner but slower. Above ~0.93 gets tremendously slow with little gain.")}
              />
              <SliderField
                id="uvr-mdx-batch"
                label={t("MDX Batch Size")}
                value={mdxBatch}
                min={1}
                max={16}
                step={1}
                onChange={setMdxBatch}
                description={t("Higher batches run faster but use more VRAM.")}
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
                />
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
                />
                <p className="text-[11px] text-neutral-500 m-0 leading-relaxed">
                  {t("Higher than the training value can help until quality degrades; lower it if you run out of VRAM.")}
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
                description={t("4 is balanced for speed and quality; higher is slightly cleaner but much slower.")}
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
            </>
          )}
          {arch !== "VR" && arch !== "MDX" && arch !== "MDXC" && arch !== "DEMUCS" && arch !== "ROFORMER" && (
            <p className="text-xs text-neutral-400 m-0 sm:col-span-2 xl:col-span-4">
              {t("Pick a model above to tune its separation settings.")}
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
