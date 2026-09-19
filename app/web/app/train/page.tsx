"use client";

import {
  Activity,
  ChevronDown,
  Cpu,
  Download,
  Flame,
  FolderUp,
  Layers,
  RefreshCw,
  Sliders,
  StopCircle,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import PageHeader from "../../components/layout/PageHeader";
import TrainingConsole from "../../components/train/TrainingConsole";
import CustomSelect from "../../components/ui/CustomSelect";
import SegmentedControl from "../../components/ui/SegmentedControl";
import SliderField from "../../components/ui/SliderField";
import { apiGet, errMsg, submitJob } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../lib/toast";

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

  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopTarget, setStopTarget] = useState("");

  async function loadDatasets(selectFirst = false): Promise<string[]> {
    try {
      const d = await apiGet<{ datasets: string[] }>("/api/train/datasets");
      setDatasets(d.datasets);
      if (selectFirst && d.datasets[0]) setDatasetPath(d.datasets[0]);
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
    apiGet<{ count: number | string; info: string }>("/api/train/gpus")
      .then((g) => {
        setGpuInfo(g.info);
        // NOTE: the API returns the GPU index spec as a string ("0", "0-1",
        // ...), NOT a count — a raw `g.count > 0` is always false for those
        // strings, which stuck every GPU host on "-" and crashed train.py's
        // cuda parsing. Use a valid spec as-is; "-" only when there is none.
        const raw = g.count;
        const gpuId =
          typeof raw === "number"
            ? raw > 0
              ? "0"
              : "-"
            : /^\d+(-\d+)*$/.test(String(raw).trim())
              ? String(raw).trim()
              : "-";
        setGpuCount(gpuId);
      })
      .catch(() => setGpuInfo(t("GPU query failed (CPU-only host)")));
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
    if (!datasetPath) {
      toast(t("Please select or upload a dataset."), "error");
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
    if (!datasetPath) {
      toast(t("Please select or upload a dataset."), "error");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { jobId: id } = await submitJob("/api/train/pipeline", {
        modelName: modelName.trim(),
        datasetPath,
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
      <div className="card space-y-4">
        <div className="border-b border-white/10 pb-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-white" />
              <h2 className="text-base font-bold text-white m-0">{t("Model & Compute Hardware")}</h2>
            </div>
          </div>
          <p className="text-xs text-neutral-400 m-0 leading-relaxed">
            {t("Define project identity and target compute device configuration.")}
          </p>
        </div>
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
            <label htmlFor="train-gpu-count">{t("GPU")}</label>
            <input
              id="train-gpu-count"
              type="text"
              value={gpuCount}
              onChange={(e) => setGpuCount(e.target.value)}
              placeholder={t("0 (or - for CPU)")}
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
          <div
            role="alert"
            aria-live="assertive"
            className="mt-2 p-3 rounded-lg border border-[var(--err)] text-[var(--err)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)]"
          >
            {error}
          </div>
        )}
      </div>

      {/* 1. AUTOMATED 1-CLICK PIPELINE VIEW */}
      {trainMode === "pipeline" && (
        <div id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" className="space-y-4">
          <div className="card border border-white/20">
            <div className="border-b border-white/10 pb-3.5 space-y-1 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white m-0">{t("1-Click Complete Pipeline")}</h2>
                </div>
              </div>
              <p className="text-xs text-neutral-400 m-0 leading-relaxed">
                {t(
                  "Runs Preprocess, Feature Extraction, Model Training, and Feature Indexing in a single automated flow.",
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="pipeline-dataset-path" className="m-0">
                    {t("Dataset Folder (in assets/datasets)")}
                  </label>
                  <button
                    type="button"
                    className="ghost h-7 px-2 text-xs flex items-center gap-1"
                    onClick={() => loadDatasets()}
                    title={t("Refresh datasets")}
                    aria-label={t("Refresh datasets")}
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <CustomSelect
                  id="pipeline-dataset-path"
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder={t("Select dataset…")}
                  className="w-full mt-1"
                >
                  <option value="">{t("Select dataset…")}</option>
                  {datasets.map((d) => (
                    <option key={d} value={d}>
                      {d.split(/[\\/]/).pop() || d}
                    </option>
                  ))}
                </CustomSelect>
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
              <label className="flex items-center gap-2 cursor-pointer m-0">
                <input
                  type="checkbox"
                  checked={noiseReduction}
                  onChange={(e) => setNoiseReduction(e.target.checked)}
                />
                <span>{t("Noise Reduction")}</span>
              </label>
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
          </div>
        </div>
      )}

      {/* 2. STEP-BY-STEP TRAINING VIEW */}
      {trainMode === "steps" && (
        <div id="panel-steps" role="tabpanel" aria-labelledby="tab-steps" className="space-y-4">
          {/* Step 1: Preprocess */}
          <div className="card space-y-4">
            <div className="border-b border-white/10 pb-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-bold text-white flex items-center justify-center">
                    1
                  </span>
                  <Sliders size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white m-0">{t("Preprocess Dataset")}</h2>
                </div>
              </div>
              <p className="text-xs text-neutral-400 m-0 leading-relaxed">
                {t("Slice, clean, and normalize raw dataset audio samples for model ingestion.")}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prep-dataset-path" className="m-0">
                    {t("Dataset (assets/datasets)")}
                  </label>
                  <button
                    type="button"
                    className="ghost h-7 px-2 text-xs flex items-center gap-1"
                    onClick={() => loadDatasets()}
                    title={t("Refresh datasets")}
                    aria-label={t("Refresh datasets")}
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <CustomSelect
                  id="prep-dataset-path"
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder={t("Select dataset…")}
                  className="w-full mt-1"
                >
                  <option value="">{t("Select dataset…")}</option>
                  {datasets.map((d) => (
                    <option key={d} value={d}>
                      {d.split(/[\\/]/).pop() || d}
                    </option>
                  ))}
                </CustomSelect>
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
            <label htmlFor="prep-noise-reduction" className="flex items-center gap-2 cursor-pointer mt-3">
              <input
                id="prep-noise-reduction"
                type="checkbox"
                checked={noiseReduction}
                onChange={(e) => setNoiseReduction(e.target.checked)}
              />
              <span>{t("Noise Reduction")}</span>
            </label>
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
            <label htmlFor="prep-process-effects" className="flex items-center gap-2 cursor-pointer mt-3">
              <input
                id="prep-process-effects"
                type="checkbox"
                checked={processEffects}
                onChange={(e) => setProcessEffects(e.target.checked)}
              />
              <span>{t("Noise filter")}</span>
            </label>
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
                    datasetPath,
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
          </div>

          {/* Step 2: Feature Extraction */}
          <div className="card space-y-4">
            <div className="border-b border-white/10 pb-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-bold text-white flex items-center justify-center">
                    2
                  </span>
                  <Activity size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white m-0">{t("Extract Features")}</h2>
                </div>
              </div>
              <p className="text-xs text-neutral-400 m-0 leading-relaxed">
                {t("Extract pitch contours and speech representations with your chosen embedder.")}
              </p>
            </div>
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
          </div>

          {/* Step 3: Train */}
          <div className="card space-y-4">
            <div className="border-b border-white/10 pb-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-xs font-bold text-white flex items-center justify-center">
                    3
                  </span>
                  <Flame size={18} className="text-white" />
                  <h2 className="text-base font-bold text-white m-0">{t("Model Training")}</h2>
                </div>
              </div>
              <p className="text-xs text-neutral-400 m-0 leading-relaxed">
                {t("Train generator and discriminator weights and compile the feature index.")}
              </p>
            </div>
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

            <label htmlFor="train-step-pretrained" className="flex items-center gap-2 cursor-pointer mt-3">
              <input
                id="train-step-pretrained"
                type="checkbox"
                checked={pretrained}
                onChange={(e) => setPretrained(e.target.checked)}
              />
              <span>{t("Use pretrained model")}</span>
            </label>
            <details>
              <summary>{t("Checkpoints & performance")}</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <label
                  htmlFor="train-step-save-latest"
                  className="flex items-center gap-2 cursor-pointer mt-3"
                >
                  <input
                    id="train-step-save-latest"
                    type="checkbox"
                    checked={saveOnlyLatest}
                    onChange={(e) => setSaveOnlyLatest(e.target.checked)}
                  />
                  <span>{t("Save Only Latest")}</span>
                </label>
                <label
                  htmlFor="train-step-save-weights"
                  className="flex items-center gap-2 cursor-pointer mt-3"
                >
                  <input
                    id="train-step-save-weights"
                    type="checkbox"
                    checked={saveEveryWeights}
                    onChange={(e) => setSaveEveryWeights(e.target.checked)}
                  />
                  <span>{t("Save Every Weights")}</span>
                </label>
                <label htmlFor="train-step-cleanup" className="flex items-center gap-2 cursor-pointer mt-3">
                  <input
                    id="train-step-cleanup"
                    type="checkbox"
                    checked={cleanup}
                    onChange={(e) => setCleanup(e.target.checked)}
                  />
                  <span>{t("Fresh Training")}</span>
                </label>
                <label htmlFor="train-step-cache-gpu" className="flex items-center gap-2 cursor-pointer mt-3">
                  <input
                    id="train-step-cache-gpu"
                    type="checkbox"
                    checked={cacheGpu}
                    onChange={(e) => setCacheGpu(e.target.checked)}
                  />
                  <span>{t("Cache Dataset in GPU")}</span>
                </label>
                <label
                  htmlFor="train-step-checkpointing"
                  className="flex items-center gap-2 cursor-pointer mt-3"
                >
                  <input
                    id="train-step-checkpointing"
                    type="checkbox"
                    checked={checkpointing}
                    onChange={(e) => setCheckpointing(e.target.checked)}
                  />
                  <span>{t("Checkpointing")}</span>
                </label>
              </div>
            </details>
            <label htmlFor="train-step-custom-pre" className="flex items-center gap-2 cursor-pointer mt-3">
              <input
                id="train-step-custom-pre"
                type="checkbox"
                checked={customPre}
                onChange={(e) => setCustomPre(e.target.checked)}
              />
              <span>{t("Custom Pretrained")}</span>
            </label>
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
          </div>
        </div>
      )}

      {/* 3. UPLOADS VIEW */}
      {trainMode === "uploads" && (
        <div id="panel-uploads" role="tabpanel" aria-labelledby="tab-uploads" className="card space-y-4">
          <div className="border-b border-white/10 pb-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderUp size={18} className="text-white" />
                <h2 className="text-base font-bold text-white m-0">{t("Dataset & Checkpoint Uploads")}</h2>
              </div>
            </div>
            <p className="text-xs text-neutral-400 m-0 leading-relaxed">
              {t("Upload local dataset files or pretrained generator checkpoints directly.")}
            </p>
          </div>
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
        </div>
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
        <div className="card space-y-4 mt-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <StopCircle size={18} className="text-white" />
              <h2 className="text-base font-bold text-white m-0">{t("Stop Training Process")}</h2>
            </div>
          </div>
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
        </div>
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
