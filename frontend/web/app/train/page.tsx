"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Check,
  Cpu,
  Database,
  Flame,
  Layers,
  Play,
  RefreshCw,
  Sliders,
  StopCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import GpuSelect, { type GpuDevice } from "@/components/train/GpuSelect";
import TrainingConsole from "@/components/train/TrainingConsole";
import { Alert, Badge, Button, Card, CardHeader, Modal, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { apiGet, errMsg, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { toast } from "@/lib/toast";
import { usePersistentJobId } from "@/lib/useJob";

type TrainMode = "auto" | "manual";
type StepModal = null | "preprocess" | "extract" | "train" | "index";

export default function TrainPage() {
  const { t } = useI18n();
  const [trainMode, setTrainMode] = useState<TrainMode>("auto");
  const [activeModal, setActiveModal] = useState<StepModal>(null);

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
  const [hostCores, setHostCores] = useState(16);
  const cpuTouchedRef = useRef(false);
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

  const srOptions = vocoder === "RefineGAN" ? ["24000", "32000"] : ["32000", "40000", "48000"];

  function pickVocoder(v: string) {
    setVocoder(v);
    if (v === "RefineGAN" && (sampleRate === "40000" || sampleRate === "48000")) setSampleRate("32000");
    if (v !== "RefineGAN" && sampleRate === "24000") setSampleRate("40000");
  }

  const [jobId, setJobId] = usePersistentJobId("train");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<NonNullable<StepModal>>>(new Set());

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
    apiGet<{ cpus: number }>("/api/report/info")
      .then((r) => {
        const cores = r.cpus > 0 ? r.cpus : 16;
        setHostCores(cores);
        // Default to the maximum; clamp a pre-load choice that exceeds it.
        setCpuCores((prev) => {
          if (!cpuTouchedRef.current || prev === "") return String(cores);
          return Number(prev) > cores ? String(cores) : prev;
        });
      })
      .catch(() => {
        setCpuCores((prev) => (!cpuTouchedRef.current || prev === "" ? "16" : prev));
      });
  }, []);

  // Step completion is per-project: switching models starts a fresh trail.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is intentionally keyed on modelName only
  useEffect(() => {
    setCompletedSteps(new Set());
  }, [modelName]);

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

  function cleanDatasetPath(): string {
    return datasetPath.trim().replace(/^["']|["']$/g, "");
  }

  async function run(path: string, body: unknown, stepKey?: NonNullable<StepModal>) {
    setError("");
    setBusy(true);
    try {
      const { jobId: id } = await submitJob(path, body);
      setJobId(id);
      if (stepKey) setCompletedSteps((prev) => new Set(prev).add(stepKey));
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runPipeline() {
    if (!modelName.trim()) {
      toast(t("Please enter a model name."), "error");
      return;
    }
    const cleanDataset = cleanDatasetPath();
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

  async function runPreprocess() {
    if (!needDataset()) return;
    const ok = await run(
      "/api/train/preprocess",
      {
        modelName,
        datasetPath: cleanDatasetPath(),
        sampleRate,
        ...(cpuCores ? { cpuCores: Number(cpuCores) } : {}),
        cutPreprocess: cut,
        chunkLen: chunk,
        overlapLen: overlap,
        noiseReduction,
        cleanStrength,
        processEffects,
        normalizationMode,
      },
      "preprocess",
    );
    if (ok) setActiveModal(null);
  }

  async function runExtract() {
    if (!needModel()) return;
    const ok = await run(
      "/api/train/extract",
      {
        modelName,
        f0Method,
        gpu: gpuCount,
        sampleRate,
        ...(cpuCores ? { cpuCores: Number(cpuCores) } : {}),
        embedderModel: embedder,
        ...(embedder === "custom" && embedderCustom ? { embedderModelCustom: embedderCustom } : {}),
        includeMutes,
      },
      "extract",
    );
    if (ok) setActiveModal(null);
  }

  async function runTrainStep() {
    if (!needModel()) return;
    const ok = await run(
      "/api/train/train",
      {
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
      },
      "train",
    );
    if (ok) setActiveModal(null);
  }

  async function runIndex() {
    if (!needModel()) return;
    const ok = await run("/api/train/index", { modelName, indexAlgorithm: indexAlgo }, "index");
    if (ok) setActiveModal(null);
  }

  async function stop() {
    try {
      await fetch("/api/train/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: jobId || undefined, modelName }),
      });
      toast(t("Training stopped."));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const isCpu = gpuCount === "-";

  const pipelinePhases = [
    { n: 1, icon: <Sliders size={13} className="text-white" />, label: t("Preprocess") },
    { n: 2, icon: <Activity size={13} className="text-white" />, label: t("Extract") },
    { n: 3, icon: <Flame size={13} className="text-white" />, label: t("Train") },
    { n: 4, icon: <Database size={13} className="text-white" />, label: t("Index") },
  ];

  const manualSteps: Array<{
    key: NonNullable<StepModal>;
    icon: LucideIcon;
    title: string;
    desc: string;
    action: string;
  }> = [
    {
      key: "preprocess",
      icon: Sliders,
      title: t("Preprocess Dataset"),
      desc: t("Slice, clean, and normalize raw audio for ingestion."),
      action: t("Run Preprocess"),
    },
    {
      key: "extract",
      icon: Activity,
      title: t("Extract Features"),
      desc: t("Pitch contours and speech representations."),
      action: t("Run Extraction"),
    },
    {
      key: "train",
      icon: Flame,
      title: t("Model Training"),
      desc: t("Generator and discriminator weights."),
      action: t("Start Training"),
    },
    {
      key: "index",
      icon: Database,
      title: t("Feature Index"),
      desc: t("FAISS/KMeans index for inference retrieval."),
      action: t("Generate Index"),
    },
  ];

  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader
        title={t("Training")}
        description={t("First set up your project below, then choose Automatic or Manual training.")}
      />

      {/* Shared top section: Model & Compute Hardware */}
      <Card>
        <CardHeader
          step={1}
          icon={<Cpu size={18} className="text-white" />}
          title={t("Model & Compute Hardware")}
          description={t("Applies to both Automatic and Manual training.")}
          action={
            <Badge variant={isCpu ? "warning" : "success"} dot>
              {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
            </Badge>
          }
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
              aria-describedby={`${"train-model-name"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.modelName)} controlId={"train-model-name"} />
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
            <SliderField
              id="train-cpu-cores"
              label={t("CPU Cores")}
              value={cpuCores === "" ? hostCores : Math.min(Number(cpuCores), hostCores)}
              min={1}
              max={hostCores}
              step={1}
              onChange={(v) => {
                cpuTouchedRef.current = true;
                setCpuCores(String(v));
              }}
              description={t(SETTING_HELP.cpu)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-neutral-400 mt-3">
          <span className="truncate">{gpuInfo || t("Detecting GPU acceleration…")}</span>
          <span className="text-neutral-500 shrink-0">
            {t("Output saved to")} <code>logs/{modelName || "…"}/</code>
          </span>
        </div>
        {error && (
          <Alert variant="error" onDismiss={() => setError("")} className="mt-3">
            {error}
          </Alert>
        )}
      </Card>

      {/* Step 2: choose mode only after the project setup above */}
      <Card>
        <CardHeader
          step={2}
          icon={<Layers size={18} className="text-white" />}
          title={t("Choose Training Mode")}
          description={t(
            "Automatic runs the full pipeline at once. Manual opens each step for custom parameters.",
          )}
        />
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <SegmentedControl
            value={trainMode}
            onChange={setTrainMode}
            ariaLabel={t("Training mode")}
            tabPanels
            options={[
              { value: "auto", label: t("Automatic"), icon: Zap },
              { value: "manual", label: t("Manual"), icon: Layers },
            ]}
          />
          {!modelName.trim() && (
            <p className="text-xs text-amber-400 m-0">
              {t("Set a model name in Step 1 first — every training run needs a project identity.")}
            </p>
          )}
        </div>
      </Card>

      {/* AUTOMATIC VIEW */}
      {trainMode === "auto" && (
        <div id="panel-auto" role="tabpanel" aria-labelledby="tab-auto" className="space-y-4">
          <Card>
            <CardHeader
              step={3}
              icon={<Zap size={18} className="text-white" />}
              title={t("Automatic Training")}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadDatasets()}
                  icon={<RefreshCw size={14} />}
                >
                  {t("Refresh Datasets")}
                </Button>
              }
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {pipelinePhases.map((p) => (
                <div
                  key={p.n}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-black/20 border border-white/10 min-w-0"
                >
                  <span className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                    {p.icon}
                  </span>
                  <span className="text-xs text-neutral-400 shrink-0">{p.n}</span>
                  <span className="text-xs font-medium text-neutral-200 truncate">{p.label}</span>
                </div>
              ))}
            </div>

            <h3 className="text-xs text-neutral-400 m-0 pt-1">{t("Dataset & Audio")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="auto-dataset-path">{t("Dataset Path")}</label>
                <input
                  id="auto-dataset-path"
                  type="text"
                  list="auto-dataset-list"
                  value={datasetPath}
                  onChange={(e) => setDatasetPath(e.target.value)}
                  placeholder={t("e.g. assets/datasets/my-dataset or C:/path/to/dataset")}
                  aria-describedby={`${"auto-dataset-path"}-help`}
                />
                <SettingHelp text={t(SETTING_HELP.dataset)} controlId={"auto-dataset-path"} />
                <datalist id="auto-dataset-list">
                  {datasets.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="auto-sample-rate">{t("Target Sampling Rate")}</label>
                <CustomSelect
                  id="auto-sample-rate"
                  value={sampleRate}
                  onChange={(e) => setSampleRate(e.target.value)}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.sampleRate)}
                >
                  {srOptions.map((s) => (
                    <option key={s} value={s}>
                      {s} Hz
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <label htmlFor="auto-f0-method">{t("Pitch extraction algorithm")}</label>
                <CustomSelect
                  id="auto-f0-method"
                  value={f0Method}
                  onChange={(e) => setF0Method(e.target.value)}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.pitchMethod)}
                >
                  {["rmvpe", "fcpe", "swift", "crepe"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </CustomSelect>
              </div>
              <div>
                <label htmlFor="auto-vocoder">{t("Vocoder Architecture")}</label>
                <CustomSelect
                  id="auto-vocoder"
                  value={vocoder}
                  onChange={(e) => pickVocoder(e.target.value)}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.vocoder)}
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
                  id="auto-total-epoch"
                  label={t("Total Epoch")}
                  value={totalEpoch}
                  min={10}
                  max={1000}
                  step={10}
                  onChange={setTotalEpoch}
                  description={t(SETTING_HELP.epochs)}
                />
              </div>
              <div>
                <SliderField
                  id="auto-batch-size"
                  label={t("Batch Size")}
                  value={batchSize}
                  min={1}
                  max={32}
                  step={1}
                  onChange={setBatchSize}
                  description={t(SETTING_HELP.batchSize)}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <ToggleField
                id="auto-noise-reduction"
                label={t("Noise Reduction")}
                checked={noiseReduction}
                onChange={setNoiseReduction}
                description={t(SETTING_HELP.clean)}
              />
              <button
                type="button"
                onClick={() => setTrainMode("manual")}
                className="bg-transparent border-0 p-0 text-xs text-neutral-400 hover:text-white cursor-pointer text-left sm:text-right"
              >
                {t("Advanced training options")}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Button
                loading={busy}
                onClick={runPipeline}
                icon={<Zap size={16} />}
                disabled={busy}
                className="w-full sm:w-auto"
              >
                {busy ? t("Pipeline Running…") : t("Start Automatic Training")}
              </Button>
              {busy && (
                <Button
                  variant="danger"
                  onClick={stop}
                  icon={<StopCircle size={16} />}
                  className="w-full sm:w-auto"
                >
                  {t("Stop Pipeline")}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* MANUAL VIEW: vertical stepper + per-step modals */}
      {trainMode === "manual" && (
        <div id="panel-manual" role="tabpanel" aria-labelledby="tab-manual" className="space-y-4">
          <Card>
            <CardHeader
              step={3}
              icon={<Layers size={18} className="text-white" />}
              title={t("Manual Training Setup")}
              description={t("Run steps 1–4 in order. Each step opens a dialog with its settings.")}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadDatasets()}
                  icon={<RefreshCw size={14} />}
                >
                  {t("Refresh Datasets")}
                </Button>
              }
            />
            <ol className="m-0 p-0 list-none flex flex-col gap-3">
              {manualSteps.map((s, i) => {
                const done = completedSteps.has(s.key);
                const StepIcon = s.icon;
                return (
                  <li key={s.key} className="relative flex gap-3 sm:gap-4 m-0 p-0">
                    <div className="flex flex-col items-center shrink-0 pt-4" aria-hidden="true">
                      {done ? (
                        <span className="w-7 h-7 rounded-full bg-emerald-500 text-black flex items-center justify-center">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 rounded-xl border border-white/10 bg-black/20 p-4 transition-colors hover:border-white/25">
                      <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                        <span className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                          <StepIcon size={16} className="text-white" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-bold text-white m-0 truncate">{s.title}</p>
                          </div>
                          <p className="text-[11px] text-neutral-400 m-0 truncate">{s.desc}</p>
                        </div>
                        <Button size="sm" onClick={() => setActiveModal(s.key)} icon={<Play size={13} />}>
                          {s.action}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}

      {/* Step 1 modal: Preprocess */}
      <Modal
        isOpen={activeModal === "preprocess"}
        onClose={() => setActiveModal(null)}
        title={t("Step 1 — Preprocess Dataset")}
        description={t("Slice, clean, and normalize audio before feature extraction.")}
        size="lg"
        icon={<Sliders size={18} className="text-white" />}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
        </div>
        <h3 className="text-xs text-neutral-400 m-0">{t("Source")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div className="sm:col-span-2">
            <label htmlFor="modal-prep-dataset-path">{t("Dataset Path")}</label>
            <input
              id="modal-prep-dataset-path"
              type="text"
              list="modal-prep-dataset-list"
              value={datasetPath}
              onChange={(e) => setDatasetPath(e.target.value)}
              placeholder={t("e.g. assets/datasets/my-dataset or C:/path/to/dataset")}
              aria-describedby={`${"modal-prep-dataset-path"}-help`}
            />
            <SettingHelp text={t(SETTING_HELP.dataset)} controlId={"modal-prep-dataset-path"} />
            <datalist id="modal-prep-dataset-list">
              {datasets.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="modal-prep-sample-rate">{t("Sampling Rate")}</label>
            <CustomSelect
              id="modal-prep-sample-rate"
              value={sampleRate}
              onChange={(e) => setSampleRate(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.sampleRate)}
            >
              {srOptions.map((s) => (
                <option key={s} value={s}>
                  {s} Hz
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-prep-norm-mode">{t("Normalization mode")}</label>
            <CustomSelect
              id="modal-prep-norm-mode"
              value={normalizationMode}
              onChange={(e) => setNormalizationMode(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.normalize)}
            >
              {["none", "pre", "post"].map((s) => (
                <option key={s} value={s}>
                  {s === "none" ? t("None") : t(s)}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <h3 className="text-xs text-neutral-400 m-0 pt-1">{t("Slicing")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-prep-cut-method">{t("Audio cutting")}</label>
            <CustomSelect
              id="modal-prep-cut-method"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.cutting)}
            >
              {["Skip", "Simple", "Automatic"].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <SliderField
              id="modal-prep-chunk"
              label={t("Chunk length")}
              value={chunk}
              min={0.5}
              max={5}
              step={0.1}
              unit="s"
              onChange={setChunk}
              description={t(SETTING_HELP.trainChunk)}
            />
          </div>
          <div>
            <SliderField
              id="modal-prep-overlap"
              label={t("Overlap length")}
              value={overlap}
              min={0}
              max={0.4}
              step={0.1}
              unit="s"
              onChange={setOverlap}
              description={t(SETTING_HELP.trainOverlap)}
            />
          </div>
        </div>
        <h3 className="text-xs text-neutral-400 m-0 pt-1">{t("Cleanup")}</h3>
        <div className="space-y-1">
          <ToggleField
            id="modal-prep-noise-reduction"
            label={t("Noise Reduction")}
            checked={noiseReduction}
            onChange={setNoiseReduction}
            description={t(SETTING_HELP.clean)}
          />
          {noiseReduction && (
            <SliderField
              id="modal-prep-clean-strength"
              label={t("Clean strength")}
              value={cleanStrength}
              min={0}
              max={1}
              step={0.05}
              onChange={setCleanStrength}
              description={t(SETTING_HELP.cleanStrength)}
            />
          )}
          <ToggleField
            id="modal-prep-process-effects"
            label={t("Noise filter")}
            checked={processEffects}
            onChange={setProcessEffects}
            description={t(SETTING_HELP.noiseFilter)}
          />
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button loading={busy} onClick={runPreprocess} icon={<Play size={14} />} disabled={busy}>
            {busy ? t("Running…") : t("Run Preprocess")}
          </Button>
        </div>
      </Modal>

      {/* Step 2 modal: Extract */}
      <Modal
        isOpen={activeModal === "extract"}
        onClose={() => setActiveModal(null)}
        title={t("Step 2 — Extract Features")}
        description={t("Pitch contours and speech representations for the preprocessed dataset.")}
        size="lg"
        icon={<Activity size={18} className="text-white" />}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
          <Badge variant="outline">{sampleRate} Hz</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-ext-pitch-method">{t("Pitch extraction algorithm")}</label>
            <CustomSelect
              id="modal-ext-pitch-method"
              value={f0Method}
              onChange={(e) => setF0Method(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.pitchMethod)}
            >
              {["rmvpe", "fcpe", "swift", "crepe"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-ext-embedder-model">{t("Embedder Model")}</label>
            <CustomSelect
              id="modal-ext-embedder-model"
              value={embedder}
              onChange={(e) => setEmbedder(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.embedder)}
            >
              {["contentvec", "spin-v2", "custom"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          {embedder === "custom" && (
            <div className="sm:col-span-2">
              <label htmlFor="modal-ext-custom-embedder">{t("Select Custom Embedder")}</label>
              <input
                id="modal-ext-custom-embedder"
                type="text"
                value={embedderCustom}
                onChange={(e) => setEmbedderCustom(e.target.value)}
                placeholder="rvc/models/embedders/embedders_custom/my-embedder"
                aria-describedby={`${"modal-ext-custom-embedder"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.customEmbedder)} controlId={"modal-ext-custom-embedder"} />
            </div>
          )}
          <div>
            <SliderField
              id="modal-ext-include-mutes"
              label={t("Silent training files")}
              value={includeMutes}
              min={0}
              max={10}
              step={1}
              onChange={setIncludeMutes}
              description={t(SETTING_HELP.mutes)}
            />
          </div>
          <div>
            <label htmlFor="modal-ext-sample-rate">{t("Sampling Rate")}</label>
            <CustomSelect
              id="modal-ext-sample-rate"
              value={sampleRate}
              onChange={(e) => setSampleRate(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.sampleRate)}
            >
              {srOptions.map((s) => (
                <option key={s} value={s}>
                  {s} Hz
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button loading={busy} onClick={runExtract} icon={<Play size={14} />} disabled={busy}>
            {busy ? t("Running…") : t("Run Extraction")}
          </Button>
        </div>
      </Modal>

      {/* Step 3 modal: Train */}
      <Modal
        isOpen={activeModal === "train"}
        onClose={() => setActiveModal(null)}
        title={t("Step 3 — Model Training")}
        description={t("Generator and discriminator weights with automatic index build.")}
        size="xl"
        icon={<Flame size={18} className="text-white" />}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
          <Badge variant="outline">{vocoder}</Badge>
        </div>
        <h3 className="text-xs text-neutral-400 m-0">{t("Architecture")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
          <div>
            <label htmlFor="modal-train-vocoder">{t("Vocoder")}</label>
            <CustomSelect
              id="modal-train-vocoder"
              value={vocoder}
              onChange={(e) => pickVocoder(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.vocoder)}
            >
              {["HiFi-GAN", "MRF HiFi-GAN", "RefineGAN"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="modal-train-index-algo">{t("Index Algorithm")}</label>
            <CustomSelect
              id="modal-train-index-algo"
              value={indexAlgo}
              onChange={(e) => setIndexAlgo(e.target.value)}
              className="w-full mt-1"
              description={t(SETTING_HELP.indexAlgorithm)}
            >
              {["Auto", "Faiss", "KMeans"].map((s) => (
                <option key={s} value={s}>
                  {s === "Auto" ? t("Auto") : s}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <SliderField
              id="modal-train-total-epoch"
              label={t("Total Epoch")}
              value={totalEpoch}
              min={1}
              max={10000}
              step={1}
              onChange={setTotalEpoch}
              description={t(SETTING_HELP.epochs)}
            />
          </div>
          <div>
            <SliderField
              id="modal-train-batch-size"
              label={t("Batch Size")}
              value={batchSize}
              min={1}
              max={64}
              step={1}
              onChange={setBatchSize}
              description={t(SETTING_HELP.batchSize)}
            />
          </div>
          <div className="sm:col-span-2">
            <SliderField
              id="modal-train-save-every"
              label={t("Save Every Epoch")}
              value={saveEvery}
              min={1}
              max={100}
              step={1}
              onChange={setSaveEvery}
              description={t(SETTING_HELP.saveEvery)}
            />
          </div>
        </div>

        <h3 className="text-xs text-neutral-400 m-0 pt-1">{t("Checkpoints & performance")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-white/10 bg-black/20 p-3 [&>*]:min-w-0">
          <ToggleField
            id="modal-train-pretrained"
            label={t("Use pretrained model")}
            description={t(SETTING_HELP.pretrained)}
            checked={pretrained}
            onChange={setPretrained}
          />
          <ToggleField
            id="modal-train-save-latest"
            label={t("Save Only Latest")}
            checked={saveOnlyLatest}
            onChange={setSaveOnlyLatest}
            description={t(SETTING_HELP.saveLatest)}
          />
          <ToggleField
            id="modal-train-save-weights"
            label={t("Save Every Weights")}
            checked={saveEveryWeights}
            onChange={setSaveEveryWeights}
            description={t(SETTING_HELP.saveWeights)}
          />
          <ToggleField
            id="modal-train-cleanup"
            label={t("Fresh Training")}
            checked={cleanup}
            onChange={setCleanup}
            description={t(SETTING_HELP.fresh)}
          />
          <ToggleField
            id="modal-train-cache-gpu"
            label={t("Cache Dataset in GPU")}
            checked={cacheGpu}
            onChange={setCacheGpu}
            description={t(SETTING_HELP.cacheGPU)}
          />
          <ToggleField
            id="modal-train-checkpointing"
            label={t("Checkpointing")}
            checked={checkpointing}
            onChange={setCheckpointing}
            description={t(SETTING_HELP.checkpointing)}
          />
          <ToggleField
            id="modal-train-custom-pre"
            label={t("Custom Pretrained")}
            checked={customPre}
            onChange={setCustomPre}
            description={t(SETTING_HELP.customPretrained)}
          />
        </div>
        {customPre && (
          <div className="grid2">
            <div>
              <label htmlFor="modal-train-gpath">{t("Custom Pretrained G")}</label>
              {pretG.length > 0 ? (
                <CustomSelect
                  id="modal-train-gpath"
                  value={gPath}
                  onChange={(e) => setGPath(e.target.value)}
                  placeholder={t("Select pretrained G…")}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.pretrainedG)}
                >
                  <option value="">{t("Select pretrained G model…")}</option>
                  {pretG.map((p) => (
                    <option key={p} value={p}>
                      {p.split(/[\\/]/).pop() || p}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="modal-train-gpath"
                    type="text"
                    value={gPath}
                    onChange={(e) => setGPath(e.target.value)}
                    placeholder="assets/pretrained_v2/f0G40k.pth"
                    aria-describedby={`${"modal-train-gpath"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.pretrainedG)} controlId={"modal-train-gpath"} />
                </>
              )}
            </div>
            <div>
              <label htmlFor="modal-train-dpath">{t("Custom Pretrained D")}</label>
              {pretD.length > 0 ? (
                <CustomSelect
                  id="modal-train-dpath"
                  value={dPath}
                  onChange={(e) => setDPath(e.target.value)}
                  placeholder={t("Select pretrained D…")}
                  className="w-full mt-1"
                  description={t(SETTING_HELP.pretrainedD)}
                >
                  <option value="">{t("Select pretrained D model…")}</option>
                  {pretD.map((p) => (
                    <option key={p} value={p}>
                      {p.split(/[\\/]/).pop() || p}
                    </option>
                  ))}
                </CustomSelect>
              ) : (
                <>
                  <input
                    id="modal-train-dpath"
                    type="text"
                    value={dPath}
                    onChange={(e) => setDPath(e.target.value)}
                    placeholder="assets/pretrained_v2/f0D40k.pth"
                    aria-describedby={`${"modal-train-dpath"}-help`}
                  />
                  <SettingHelp text={t(SETTING_HELP.pretrainedD)} controlId={"modal-train-dpath"} />
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button loading={busy} onClick={runTrainStep} icon={<Play size={14} />} disabled={busy}>
            {busy ? t("Running…") : t("Start Training")}
          </Button>
        </div>
      </Modal>

      {/* Step 4 modal: Index */}
      <Modal
        isOpen={activeModal === "index"}
        onClose={() => setActiveModal(null)}
        title={t("Step 4 — Generate Index")}
        description={t("Re-runnable after training. Improves inference similarity.")}
        size="md"
        icon={<Database size={18} className="text-white" />}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant="outline">{indexAlgo}</Badge>
        </div>
        <div>
          <label htmlFor="modal-index-algo">{t("Index Algorithm")}</label>
          <CustomSelect
            id="modal-index-algo"
            value={indexAlgo}
            onChange={(e) => setIndexAlgo(e.target.value)}
            className="w-full mt-1"
            description={t(SETTING_HELP.indexAlgorithm)}
          >
            {["Auto", "Faiss", "KMeans"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </CustomSelect>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button loading={busy} onClick={runIndex} icon={<Play size={14} />} disabled={busy}>
            {busy ? t("Running…") : t("Generate Index")}
          </Button>
        </div>
      </Modal>

      <TrainingConsole jobId={jobId} modelName={modelName} totalEpochs={totalEpoch} onStop={stop} />
    </div>
  );
}
