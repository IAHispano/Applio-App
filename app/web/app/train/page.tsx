"use client";

import {
  Activity,
  ChevronDown,
  Cpu,
  Download,
  Flame,
  FolderUp,
  Layers,
  Sliders,
  StopCircle,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import PageHeader from "../../components/layout/PageHeader";
import GpuSelect, { type GpuDevice } from "../../components/train/GpuSelect";
import TrainingConsole from "../../components/train/TrainingConsole";
import { Alert, Card, CardHeader, ToggleField } from "../../components/ui";
import CustomSelect from "../../components/ui/CustomSelect";
import SegmentedControl from "../../components/ui/SegmentedControl";
import SliderField from "../../components/ui/SliderField";
import { apiGet, errMsg, submitJob } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../lib/toast";
import { usePersistentJobId } from "../../lib/useJob";

type TrainMode = "pipeline" | "steps" | "uploads";

export default function TrainPage() {
  const { t } = useI18n();
  const [trainMode, setTrainMode] = useState<TrainMode>("pipeline");
  const [modelName, setModelName] = useState("my-project");
  const [datasets, setDatasets] = useState<string[]>([]);
  const [pretG, setPretG] = useState<string[]>([]);
  const [pretD, setPretD] = useState<string[]>([]);
  const [gpuInfo, setGpuInfo] = useState("");
  const [gpuCount, setGpuCount] = useState("0");
  const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>([]);

  const [datasetPath, setDatasetPath] = useState("");
  const [sampleRate, setSampleRate] = useState("40000");
  const [cpuCores, setCpuCores] = useState("");
  const [cut, setCut] = useState("Automatic");
  const [chunk, setChunk] = useState(3.0);
  const [overlap, setOverlap] = useState(0.3);
  const [noiseReduction, setNoiseReduction] = useState(false);
  const [cleanStrength, setCleanStrength] = useState(0.7);
  const [processEffects, setProcessEffects] = useState(false);
  const [normalizationMode, setNormalizationMode] = useState("none");
  const [f0Method, setF0Method] = useState("rmvpe");
  const [embedder, setEmbedder] = useState("contentvec");
  const [embedderCustom, setEmbedderCustom] = useState("");
  const [includeMutes, setIncludeMutes] = useState(2);
  const [vocoder, setVocoder] = useState("HiFi-GAN");
  const [totalEpoch, setTotalEpoch] = useState(200);
  const [batchSize, setBatchSize] = useState(4);
  const [saveEvery, setSaveEvery] = useState(10);
  const [pretrained, setPretrained] = useState(true);
  const [saveOnlyLatest, setSaveOnlyLatest] = useState(true);
  const [saveEveryWeights, setSaveEveryWeights] = useState(true);
  const [cleanup, setCleanup] = useState(false);
  const [cacheGpu, setCacheGpu] = useState(false);
  const [checkpointing, setCheckpointing] = useState(false);
  const [indexAlgo, setIndexAlgo] = useState("Auto");
  const [customPre, setCustomPre] = useState(false);
  const [gPath, setGPath] = useState("");
  const [dPath, setDPath] = useState("");
  const [expModels, setExpModels] = useState<string[]>([]);
  const [expIndexes, setExpIndexes] = useState<string[]>([]);
  const [expModel, setExpModel] = useState("");
  const [expIndex, setExpIndex] = useState("");

  const srOptions = vocoder === "RefineGAN" ? ["24000", "32000"] : ["32000", "40000", "48000"];

  function pickVocoder(v: string) {
    setVocoder(v);
    if (v === "RefineGAN" && (sampleRate === "40000" || sampleRate === "48000")) setSampleRate("32000");
    if (v !== "RefineGAN" && sampleRate === "24000") setSampleRate("40000");
  }

  const [jobId, setJobId] = usePersistentJobId("train");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopTarget, setStopTarget] = useState("");

  async function loadDatasets(selectFirst = false): Promise<string[]> {
    try {
      const d = await apiGet<{ datasets: string[] }>("/api/train/datasets");
      setDatasets(d.datasets);
      if (selectFirst) setDatasetPath((prev) => prev || d.datasets[0] || "");
      return d.datasets;
    } catch {
      return [];
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-time fetch only; t is a stable dictionary lookup
  useEffect(() => {
    loadDatasets(true);
    apiGet<{ g: string[]; d: string[] }>("/api/train/pretraineds")
      .then((p) => {
        setPretG(p.g);
        setPretD(p.d);
      })
      .catch(() => {});
    apiGet<{
      count: number | string;
      info: string;
      devices?: GpuDevice[];
      gpus?: { id: string; name: string }[];
    }>("/api/train/gpus")
      .then((g) => {
        setGpuInfo(g.info);
        let devs: GpuDevice[] = [];
        if (g.devices && Array.isArray(g.devices) && g.devices.length > 0) {
          devs = g.devices;
        } else if (g.gpus && Array.isArray(g.gpus) && g.gpus.length > 0) {
          devs = g.gpus.filter((x) => x.id !== "-" && !x.id.includes("-"));
        } else if (g.info && !g.info.toLowerCase().includes("no compatible gpu")) {
          const lines = g.info
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          for (const line of lines) {
            const m = line.match(/^(\d+):\s*(.*)$/);
            if (m) {
              devs.push({ id: m[1], name: `GPU ${m[1]}: ${m[2]}` });
            }
          }
        }
        setGpuDevices(devs);

        const raw = g.count;
        const gpuId =
          typeof raw === "number"
            ? raw > 0
              ? "0"
              : "-"
            : /^\d+(-\d+)*$/.test(String(raw).trim())
              ? String(raw).trim()
              : devs[0]?.id || "-";
        setGpuCount(gpuId);
      })
      .catch(() => {
        setGpuInfo(t("GPU query failed (CPU-only host)"));
        setGpuDevices([]);
        setGpuCount("-");
      });
    apiGet<{ models: string[]; indexes: string[] }>("/api/train/exports")
      .then((e) => {
        setExpModels(e.models || []);
        setExpIndexes(e.indexes || []);
        if (e.models?.[0]) setExpModel(e.models[0]);
        if (e.indexes?.[0]) setExpIndex(e.indexes[0]);
      })
      .catch(() => {});
  }, []);

  function needModel(): boolean {
    if (!modelName.trim()) {
      toast(t("Please enter a model name."), "error");
      return false;
    }
    return true;
  }

  function needDataset(): boolean {
    if (!needModel()) return false;
    if (!datasetPath.trim()) {
      toast(t("Please enter a dataset path."), "error");
      return false;
    }
    return true;
  }

  async function run(path: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      const { jobId: id } = await submitJob(path, body);
      setJobId(id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPipeline() {
    if (!modelName.trim()) {
      toast(t("Please enter a model name."), "error");
      return;
    }
    const cleanDataset = datasetPath.trim().replace(/^["']|["']$/g, "");
    if (!cleanDataset) {
      toast(t("Please enter a dataset path."), "error");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { jobId: id } = await submitJob("/api/train/pipeline", {
        modelName: modelName.trim(),
        datasetPath: cleanDataset,
        sampleRate,
        ...(cpuCores ? { cpuCores: Number(cpuCores) } : {}),
        cutPreprocess: cut,
        chunkLen: chunk,
        overlapLen: overlap,
        processEffects,
        noiseReduction,
        cleanStrength,
        normalizationMode,
        f0Method,
        embedderModel: embedder,
        ...(embedder === "custom" && embedderCustom ? { embedderModelCustom: embedderCustom } : {}),
        includeMutes,
        vocoder,
        totalEpoch,
        batchSize,
        saveEveryEpoch: saveEvery,
        saveOnlyLatest,
        saveEveryWeights,
        pretrained,
        customPretrained: customPre,
        ...(customPre && gPath ? { gPretrainedPath: gPath } : {}),
        ...(customPre && dPath ? { dPretrainedPath: dPath } : {}),
        cleanup,
        cacheDataInGpu: cacheGpu,
        checkpointing,
        gpu: gpuCount,
        indexAlgorithm: indexAlgo,
      });
      setJobId(id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport(file: string) {
    if (!file) return;
    setError("");
    try {
      const r = await fetch(`/api/train/export-file?file=${encodeURIComponent(file)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || t("Download failed"));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.split(/[\\/]/).pop() || "export";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function stop() {
    try {
      await fetch("/api/train/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: jobId || undefined, modelName: stopTarget || modelName }),
      });
      toast(t("Training stopped."));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      <PageHeader
        title={t("Training")}
        description={t(
          "Train custom RVC voice models from audio datasets with automated 1-click pipeline or step-by-step control.",
        )}
      >
        <SegmentedControl
          value={trainMode}
          onChange={setTrainMode}
          ariaLabel={t("Training mode")}
          tabPanels
          options={[
            { value: "pipeline", label: t("1-Click Pipeline"), icon: Zap },
            { value: "steps", label: t("Step-by-Step"), icon: Layers },
            { value: "uploads", label: t("Uploads"), icon: FolderUp },
          ]}
        />
      </PageHeader>

      {/* Global Model Name & Hardware Config Bar */}
      <Card>
        <CardHeader
          icon={<Cpu size={18} className="text-white" />}
          title={t("Model & Compute Hardware")}
          description={t("Define project identity and target compute device configuration.")}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="train-model-name">{t("Model Name")}</label>
            <input
              id="train-model-name"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("e.g. vocal-model")}
            />
          </div>
          <div>
            <label htmlFor="train-gpu">{t("GPU")}</label>
            <GpuSelect
              id="train-gpu"
              value={gpuCount}
              onChange={setGpuCount}
              devices={gpuDevices}
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="train-cpu-cores">{t("CPU Cores")}</label>
            <input
              id="train-cpu-cores"
              type="number"
              min={1}
              max={64}
              value={cpuCores}
              onChange={(e) => setCpuCores(e.target.value)}
              placeholder={t("auto")}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-400 mt-2">
          <span>{gpuInfo || t("Detecting GPU acceleration…")}</span>
          <span className="text-neutral-500">
            {t("Output saved to")} <code>logs/{modelName || "…"}/</code>
          </span>
        </div>
        {error && (
          <Alert variant="error" onDismiss={() => setError("")} className="mt-2">
            {error}
          </Alert>
        )}
      </Card>

      {/* 1. AUTOMATED 1-CLICK PIPELINE VIEW */}
      {trainMode === "pipeline" && (
        <div id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" className="space-y-4">
          <Card className="border border-white/20">
            <CardHeader
              icon={<Zap size={18} className="text-white" />}
              title={t("1-Click Complete Pipeline")}
              description={t(
                "Runs Preprocess, Feature Extraction, Model Training, and Feature Indexing in a single automated flow.",
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="pipeline-dataset-path">{t("Dataset Path")}</label>
                <input
                  id="pipeline-dataset-path"
                  type="text"
                  list="pipeline-dataset-list"
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder={t("e.g. assets/datasets/my-dataset or C:/path/to/dataset")}
                />
                <datalist id="pipeline-dataset-list">
                  {datasets.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="pipeline-sample-rate">{t("Target Sampling Rate")}</label>
                <CustomSelect
                  id="pipeline-sample-rate"
                  value={sampleRate}
                  onChange={(e) => setSampleRate(e.target.value)}
                  className="w-full mt-1"
                >
                  {srOptions.map((s) => (
                    <option key={s} value={s}>
                      {s} Hz
                    </option>
                  ))}
                </CustomSelect>
              </div>

              <div>
                <SliderField
                  id="pipeline-total-epoch"
                  label={t("Total Epoch")}
                  value={totalEpoch}
                  min={10}
                  max={1000}
                  step={10}
                  onChange={setTotalEpoch}
                />
              </div>

              <div>
                <SliderField
                  id="pipeline-batch-size"
                  label={t("Batch Size")}
                  value={batchSize}
                  min={1}
                  max={32}
                  step={1}
                  onChange={setBatchSize}
                />
              </div>

              <div>
                <label htmlFor="pipeline-f0-method">{t("Pitch extraction algorithm")}</label>
                <CustomSelect
                  id="pipeline-f0-method"
                  value={f0Method}
                  onChange={(e) => setF0Method(e.target.value)}
                  className="w-full mt-1"
                >
                  {["rmvpe", "crepe", "crepe-tiny"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>

              <div>
                <label htmlFor="pipeline-vocoder">{t("Vocoder Architecture")}</label>
                <CustomSelect
                  id="pipeline-vocoder"
                  value={vocoder}
                  onChange={(e) => pickVocoder(e.target.value)}
                  className="w-full mt-1"
                >
                  {["HiFi-GAN", "MRF HiFi-GAN", "RefineGAN"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/10">
              <ToggleField
                id="pipeline-noise-reduction"
                label={t("Noise Reduction")}
                checked={noiseReduction}
                onChange={setNoiseReduction}
              />
            </div>

            <div className="row mt-5 pt-3 border-t border-white/10">
              <button
                type="button"
                className="cta h-10 px-5 flex items-center gap-2 text-sm font-medium rounded-xl"
                disabled={busy}
                onClick={runPipeline}
              >
                <Zap size={16} className="shrink-0" />
                <span>{busy ? t("Pipeline Running…") : t("Start 1-Click Pipeline")}</span>
              </button>

              {busy && (
                <button
                  type="button"
                  className="ghost h-10 px-4 text-red-400 hover:text-red-300 border-red-500/30 flex items-center gap-2 text-sm font-medium rounded-xl"
                  onClick={stop}
                >
                  <StopCircle size={16} className="shrink-0" />
                  <span>{t("Stop Pipeline")}</span>
                </button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* 2. STEP-BY-STEP TRAINING VIEW */}
      {trainMode === "steps" && (
        <div id="panel-steps" role="tabpanel" aria-labelledby="tab-steps" className="space-y-4">
          {/* Step 1: Preprocess */}
          <Card>
            <CardHeader
              step={1}
              icon={<Sliders size={18} className="text-white" />}
              title={t("Preprocess Dataset")}
              description={t("Slice, clean, and normalize raw dataset audio samples for model ingestion.")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="prep-dataset-path">{t("Dataset Path")}</label>
                <input
                  id="prep-dataset-path"
                  type="text"
                  list="prep-dataset-list"
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder={t("e.g. assets/datasets/my-dataset or C:/path/to/dataset")}
                />
                <datalist id="prep-dataset-list">
                  {datasets.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="prep-sample-rate">{t("Sampling Rate")}</label>
                <CustomSelect
                  id="prep-sample-rate"
                  value={sampleRate}
                  onChange={(e) => setSampleRate(e.target.value)}
                  className="w-full mt-1"
                >
                  {srOptions.map((s) => (
                    <option key={s} value={s}>
                      {s} Hz
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <label htmlFor="prep-cut-method">{t("Audio cutting")}</label>
                <CustomSelect
                  id="prep-cut-method"
                  value={cut}
                  onChange={(e) => setCut(e.target.value)}
                  className="w-full mt-1"
                >
                  {["Skip", "Simple", "Automatic"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <SliderField
                  id="prep-chunk"
                  label={t("Chunk length")}
                  value={chunk}
                  min={0.5}
                  max={5}
                  step={0.1}
                  unit="s"
                  onChange={setChunk}
                />
              </div>
              <div>
                <SliderField
                  id="prep-overlap"
                  label={t("Overlap length")}
                  value={overlap}
                  min={0}
                  max={0.4}
                  step={0.1}
                  unit="s"
                  onChange={setOverlap}
                />
              </div>
            </div>
            <ToggleField
              id="prep-noise-reduction"
              label={t("Noise Reduction")}
              checked={noiseReduction}
              onChange={setNoiseReduction}
              className="mt-3"
            />
            {noiseReduction && (
              <div className="mt-2">
                <SliderField
                  id="prep-clean-strength"
                  label={t("Clean strength")}
                  value={cleanStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={setCleanStrength}
                />
              </div>
            )}
            <ToggleField
              id="prep-process-effects"
              label={t("Noise filter")}
              checked={processEffects}
              onChange={setProcessEffects}
              className="mt-3"
            />
            <div className="mt-2">
              <label htmlFor="prep-norm-mode">{t("Normalization mode")}</label>
              <CustomSelect
                id="prep-norm-mode"
                value={normalizationMode}
                onChange={(e) => setNormalizationMode(e.target.value)}
                className="w-full mt-1"
              >
                {["none", "pre", "post"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </CustomSelect>
            </div>
            <div className="row mt-4">
              <button
                type="button"
                className="cta"
                disabled={busy}
                onClick={() => {
                  if (!needDataset()) return;
                  run("/api/train/preprocess", {
                    modelName,
                    datasetPath: datasetPath.trim().replace(/^["']|["']$/g, ""),
                    sampleRate,
                    ...(cpuCores ? { cpuCores: Number(cpuCores) } : {}),
                    cutPreprocess: cut,
                    chunkLen: chunk,
                    overlapLen: overlap,
                    noiseReduction,
                    cleanStrength,
                    processEffects,
                    normalizationMode,
                  });
                }}
              >
                {t("Preprocess Dataset")}
              </button>
            </div>
          </Card>

          {/* Step 2: Feature Extraction */}
          <Card>
            <CardHeader
              step={2}
              icon={<Activity size={18} className="text-white" />}
              title={t("Extract Features")}
              description={t("Extract pitch contours and speech representations with your chosen embedder.")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="ext-pitch-method">{t("Pitch extraction algorithm")}</label>
                <CustomSelect
                  id="ext-pitch-method"
                  value={f0Method}
                  onChange={(e) => setF0Method(e.target.value)}
                  className="w-full mt-1"
                >
                  {["crepe", "crepe-tiny", "rmvpe"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <label htmlFor="ext-embedder-model">{t("Embedder Model")}</label>
                <CustomSelect
                  id="ext-embedder-model"
                  value={embedder}
                  onChange={(e) => setEmbedder(e.target.value)}
                  className="w-full mt-1"
                >
                  {["contentvec", "spin-v2", "custom"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
              {embedder === "custom" && (
                <div>
                  <label htmlFor="ext-custom-embedder">{t("Select Custom Embedder")}</label>
                  <input
                    id="ext-custom-embedder"
                    type="text"
                    value={embedderCustom}
                    onChange={(e) => setEmbedderCustom(e.target.value)}
                    placeholder="rvc/models/embedders/embedders_custom/my-embedder"
                  />
                </div>
              )}
              <div>
                <SliderField
                  id="ext-include-mutes"
                  label={t("Silent training files")}
                  value={includeMutes}
                  min={0}
                  max={10}
                  step={1}
                  onChange={setIncludeMutes}
                />
              </div>
            </div>
            <div className="row mt-4">
              <button
                type="button"
                className="cta"
                disabled={busy}
                onClick={() => {
                  if (!needModel()) return;
                  run("/api/train/extract", {
                    modelName,
                    f0Method,
                    gpu: gpuCount,
                    sampleRate,
                    ...(cpuCores ? { cpuCores: Number(cpuCores) } : {}),
                    embedderModel: embedder,
                    ...(embedder === "custom" && embedderCustom
                      ? { embedderModelCustom: embedderCustom }
                      : {}),
                    includeMutes,
                  });
                }}
              >
                {t("Extract Features")}
              </button>
            </div>
          </Card>

          {/* Step 3: Train */}
          <Card>
            <CardHeader
              step={3}
              icon={<Flame size={18} className="text-white" />}
              title={t("Model Training")}
              description={t("Train generator and discriminator weights and compile the feature index.")}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="train-step-vocoder">{t("Vocoder")}</label>
                <CustomSelect
                  id="train-step-vocoder"
                  value={vocoder}
                  onChange={(e) => pickVocoder(e.target.value)}
                  className="w-full mt-1"
                >
                  {["HiFi-GAN", "MRF HiFi-GAN", "RefineGAN"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <SliderField
                  id="train-step-total-epoch"
                  label={t("Total Epoch")}
                  value={totalEpoch}
                  min={1}
                  max={10000}
                  step={1}
                  onChange={setTotalEpoch}
                />
              </div>
              <div>
                <SliderField
                  id="train-step-batch-size"
                  label={t("Batch Size")}
                  value={batchSize}
                  min={1}
                  max={64}
                  step={1}
                  onChange={setBatchSize}
                />
              </div>
              <div>
                <SliderField
                  id="train-step-save-every"
                  label={t("Save Every Epoch")}
                  value={saveEvery}
                  min={1}
                  max={100}
                  step={1}
                  onChange={setSaveEvery}
                />
              </div>
              <div>
                <label htmlFor="train-step-index-algo">{t("Index Algorithm")}</label>
                <CustomSelect
                  id="train-step-index-algo"
                  value={indexAlgo}
                  onChange={(e) => setIndexAlgo(e.target.value)}
                  className="w-full mt-1"
                >
                  {["Auto", "Faiss", "KMeans"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
            </div>

            <ToggleField
              id="train-step-pretrained"
              label={t("Use pretrained model")}
              checked={pretrained}
              onChange={setPretrained}
              className="mt-3"
            />
            <details>
              <summary>{t("Checkpoints & performance")}</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <ToggleField
                  id="train-step-save-latest"
                  label={t("Save Only Latest")}
                  checked={saveOnlyLatest}
                  onChange={setSaveOnlyLatest}
                  className="mt-3"
                />
                <ToggleField
                  id="train-step-save-weights"
                  label={t("Save Every Weights")}
                  checked={saveEveryWeights}
                  onChange={setSaveEveryWeights}
                  className="mt-3"
                />
                <ToggleField
                  id="train-step-cleanup"
                  label={t("Fresh Training")}
                  checked={cleanup}
                  onChange={setCleanup}
                  className="mt-3"
                />
                <ToggleField
                  id="train-step-cache-gpu"
                  label={t("Cache Dataset in GPU")}
                  checked={cacheGpu}
                  onChange={setCacheGpu}
                  className="mt-3"
                />
                <ToggleField
                  id="train-step-checkpointing"
                  label={t("Checkpointing")}
                  checked={checkpointing}
                  onChange={setCheckpointing}
                  className="mt-3"
                />
              </div>
            </details>
            <ToggleField
              id="train-step-custom-pre"
              label={t("Custom Pretrained")}
              checked={customPre}
              onChange={setCustomPre}
              className="mt-3"
            />
            {customPre && (
              <div className="grid2 mt-2">
                <div>
                  <label htmlFor="train-step-gpath">{t("Custom Pretrained G")}</label>
                  {pretG.length > 0 ? (
                    <CustomSelect
                      id="train-step-gpath"
                      value={gPath}
                      onChange={(e) => setGPath(e.target.value)}
                      placeholder={t("Select pretrained G…")}
                      className="w-full mt-1"
                    >
                      <option value="">{t("Select pretrained G model…")}</option>
                      {pretG.map((p) => (
                        <option key={p} value={p}>
                          {p.split(/[\\/]/).pop() || p}
                        </option>
                      ))}
                    </CustomSelect>
                  ) : (
                    <input
                      id="train-step-gpath"
                      type="text"
                      value={gPath}
                      onChange={(e) => setGPath(e.target.value)}
                      placeholder="assets/pretrained_v2/f0G40k.pth"
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="train-step-dpath">{t("Custom Pretrained D")}</label>
                  {pretD.length > 0 ? (
                    <CustomSelect
                      id="train-step-dpath"
                      value={dPath}
                      onChange={(e) => setDPath(e.target.value)}
                      placeholder={t("Select pretrained D…")}
                      className="w-full mt-1"
                    >
                      <option value="">{t("Select pretrained D model…")}</option>
                      {pretD.map((p) => (
                        <option key={p} value={p}>
                          {p.split(/[\\/]/).pop() || p}
                        </option>
                      ))}
                    </CustomSelect>
                  ) : (
                    <input
                      id="train-step-dpath"
                      type="text"
                      value={dPath}
                      onChange={(e) => setDPath(e.target.value)}
                      placeholder="assets/pretrained_v2/f0D40k.pth"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="row mt-4">
              <button
                type="button"
                className="cta"
                disabled={busy}
                onClick={() => {
                  if (!needModel()) return;
                  run("/api/train/train", {
                    modelName,
                    vocoder,
                    totalEpoch,
                    batchSize,
                    saveEveryEpoch: saveEvery,
                    gpu: gpuCount,
                    sampleRate,
                    indexAlgorithm: indexAlgo,
                    customPretrained: customPre,
                    gPretrainedPath: gPath || undefined,
                    dPretrainedPath: dPath || undefined,
                    pretrained,
                    saveOnlyLatest,
                    saveEveryWeights,
                    cleanup,
                    cacheDataInGpu: cacheGpu,
                    checkpointing,
                  });
                }}
              >
                {t("Start Training")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (!needModel()) return;
                  run("/api/train/index", { modelName, indexAlgorithm: indexAlgo });
                }}
              >
                {t("Generate Index")}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* 3. UPLOADS VIEW */}
      {trainMode === "uploads" && (
        <Card as="div" id="panel-uploads" role="tabpanel" aria-labelledby="tab-uploads">
          <CardHeader
            icon={<FolderUp size={18} className="text-white" />}
            title={t("Dataset & Checkpoint Uploads")}
            description={t("Upload local dataset files or pretrained generator checkpoints directly.")}
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
      )}

      <details className="card mt-4 group">
        <summary className="cursor-pointer flex items-center justify-between gap-2 select-none">
          <span className="flex items-center gap-2">
            <Download size={18} className="text-white" />
            <span className="text-base font-bold text-white">{t("Export Model")}</span>
          </span>
          <ChevronDown size={16} className="text-neutral-400 transition-transform group-open:rotate-180" />
        </summary>
        <p className="muted text-sm m-0">{t("Download a trained .pth and its .index from logs/.")}</p>
        <div className="grid2">
          <div>
            <label htmlFor="train-exp-model">{t("Model (.pth)")}</label>
            <CustomSelect
              id="train-exp-model"
              value={expModel}
              onChange={(e) => setExpModel(e.target.value)}
              className="w-full mt-1"
            >
              <option value="">—</option>
              {expModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="train-exp-index">{t("Index (.index)")}</label>
            <CustomSelect
              id="train-exp-index"
              value={expIndex}
              onChange={(e) => setExpIndex(e.target.value)}
              className="w-full mt-1"
            >
              <option value="">—</option>
              {expIndexes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <div className="row mt-4">
          <button
            type="button"
            className="ghost"
            onClick={() => downloadExport(expModel)}
            disabled={!expModel}
          >
            {t("Download .pth")}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => downloadExport(expIndex)}
            disabled={!expIndex}
          >
            {t("Download .index")}
          </button>
        </div>
      </details>

      {jobId && (
        <Card className="mt-4">
          <CardHeader
            icon={<StopCircle size={18} className="text-white" />}
            title={t("Stop Training Process")}
          />
          <div className="row">
            <input
              type="text"
              placeholder={t("model name (fallback)")}
              aria-label={t("Model name (fallback)")}
              value={stopTarget}
              onChange={(e) => setStopTarget(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <button type="button" className="ghost" onClick={stop}>
              {t("Stop Training")}
            </button>
          </div>
        </Card>
      )}

      <TrainingConsole jobId={jobId} modelName={modelName} totalEpochs={totalEpoch} onStop={stop} />
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
        <button type="button" className="ghost text-xs" onClick={send}>
          {t("Upload")}
        </button>
        <span className="text-xs text-neutral-300">{msg}</span>
      </div>
    </div>
  );
}
