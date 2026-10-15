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
import { useCallback, useEffect, useRef, useState } from "react";
import { JobProgress, JobStage } from "@/components/JobStatus";
import PageHeader from "@/components/layout/PageHeader";
import DatasetReview from "@/components/train/DatasetReview";
import GpuSelect, { type GpuDevice } from "@/components/train/GpuSelect";
import TrainingConsole from "@/components/train/TrainingConsole";
import TrainingUpload from "@/components/train/TrainingUpload";
import { Alert, Badge, Button, Card, CardHeader, Disclosure, Modal, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import { apiGet, errMsg, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";
import { toast } from "@/lib/toast";
import { useJob, usePersistentJobId } from "@/lib/useJob";

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
  const trainingActivity = useJob(jobId);
  const trainingJob = trainingActivity.job;
  const activeTraining =
    trainingActivity.isActive || Boolean(jobId && trainingJob?.id !== jobId && !trainingActivity.error);
  const automaticJob =
    trainingJob?.id === jobId &&
    trainingJob?.params?.pipeline &&
    (activeTraining ||
      (trainingJob.params.modelName === modelName.trim() &&
        trainingJob.params.datasetPath === cleanDatasetPath()))
      ? trainingJob
      : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadsInProgress, setUploadsInProgress] = useState(0);
  const onUploadBusyChange = useCallback((uploading: boolean) => {
    setUploadsInProgress((count) => count + (uploading ? 1 : -1));
  }, []);
  const onDatasetUploaded = useCallback((path: string) => {
    setDatasets((current) => (current.includes(path) ? current : [...current, path].sort()));
    setDatasetPath(path);
  }, []);
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
  // Steps are marked done only when their job succeeds, never on submit,
  // so a failed run (e.g. training exit code 1) can't show green checks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is intentionally keyed on modelName only
  useEffect(() => {
    setCompletedSteps(new Set());
  }, [modelName]);

  useEffect(() => {
    const step = trainingJob?.params?.step as string | undefined;
    if (
      trainingJob?.status === "done" &&
      trainingJob.params?.modelName === modelName.trim() &&
      (step === "preprocess" || step === "extract" || step === "train" || step === "index")
    ) {
      setCompletedSteps((prev) => {
        if (prev.has(step as NonNullable<StepModal>)) return prev;
        return new Set(prev).add(step as NonNullable<StepModal>);
      });
    }
  }, [
    trainingJob?.id,
    trainingJob?.status,
    trainingJob?.params?.step,
    trainingJob?.params?.modelName,
    modelName,
  ]);

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

  async function run(path: string, body: unknown, _stepKey?: NonNullable<StepModal>) {
    if (busy || activeTraining || uploadsInProgress > 0) return false;
    setError("");
    setBusy(true);
    try {
      const { jobId: id } = await submitJob(path, body);
      setJobId(id);
      // Completion is recorded by the effect watching trainingJob status,
      // so failed jobs never mark their step as done.
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runPipeline() {
    if (busy || activeTraining || uploadsInProgress > 0) return;
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
    { n: 1, label: t("Preprocess"), stage: "Preprocessing dataset…" },
    { n: 2, label: t("Extract"), stage: "Extracting features…" },
    { n: 3, label: t("Train"), stage: "Training model…" },
    { n: 4, label: t("Index"), stage: "Generating index…" },
  ];
  const currentPhase =
    automaticJob?.stage === "Checking output…"
      ? pipelinePhases.length
      : pipelinePhases.findIndex((phase) => phase.stage === automaticJob?.stage);
  const automaticDisabledReason =
    busy || activeTraining
      ? t("Pipeline Running…")
      : uploadsInProgress > 0
        ? t("Uploading…")
        : !modelName.trim()
          ? t("Please enter a model name.")
          : !cleanDatasetPath()
            ? t("Please enter a dataset path.")
            : "";

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
              disabled={activeTraining}
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
              disabled={activeTraining}
              value={gpuCount}
              onChange={setGpuCount}
              devices={gpuDevices}
              className="w-full"
            />
          </div>
          <div>
            <SliderField
              id="train-cpu-cores"
              disabled={activeTraining}
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
      <DatasetReview
        datasetPath={datasetPath}
        datasets={datasets}
        onDatasetChange={setDatasetPath}
        onUploadBusyChange={onUploadBusyChange}
        onDatasetUploaded={onDatasetUploaded}
      />
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
              description={t("Preprocess, extract, train, and index.")}
              action={
                <Badge
                  variant={activeTraining ? "info" : automaticJob?.status === "done" ? "success" : "neutral"}
                  dot
                >
                  {activeTraining
                    ? t(automaticJob?.status === "queued" ? "Queued" : "In Progress")
                    : automaticJob?.status === "done"
                      ? t("Completed")
                      : t("Automatic")}
                </Badge>
              }
            />

            <ol
              className="grid grid-cols-2 xl:grid-cols-4 gap-3 list-none p-0 m-0"
              aria-label={t("Automatic Training")}
            >
              {pipelinePhases.map((phase, index) => {
                const skipIndex =
                  index === 3 && (automaticJob?.params?.indexAlgorithm ?? indexAlgo) === "Skip";
                const done = !skipIndex && (automaticJob?.status === "done" || currentPhase > index);
                const running = !skipIndex && automaticJob?.status === "running" && currentPhase === index;
                const failed = !skipIndex && automaticJob?.status === "error" && currentPhase === index;
                const status = skipIndex
                  ? "Skipped"
                  : done
                    ? "Completed"
                    : failed
                      ? "Failed"
                      : running
                        ? "In Progress"
                        : "Pending";
                return (
                  <li
                    key={phase.n}
                    aria-current={running ? "step" : undefined}
                    className={`rounded-xl border p-3 space-y-2 ${running ? "border-[var(--focus-border)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--input-bg)]"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-[var(--surface)] text-xs shrink-0">
                        {done ? <Check size={13} /> : phase.n}
                      </span>
                      <span className="text-sm font-medium text-[var(--heading)]">{phase.label}</span>
                    </div>
                    <Badge
                      variant={done ? "success" : failed ? "danger" : running ? "info" : "neutral"}
                      size="sm"
                    >
                      {t(status)}
                    </Badge>
                  </li>
                );
              })}
            </ol>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-[var(--surface)] p-4 text-xs m-0">
              <div className="min-w-0">
                <dt className="text-[var(--muted)] mb-1">{t("Dataset Path")}</dt>
                <dd className="m-0 break-words">
                  {String(
                    activeTraining && automaticJob
                      ? automaticJob.params?.datasetPath || ""
                      : cleanDatasetPath(),
                  ) || t("Please enter a dataset path.")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--muted)] mb-1">{t("Output saved to")}</dt>
                <dd className="m-0 break-words">
                  logs/
                  {String(
                    activeTraining && automaticJob ? automaticJob.params?.modelName || modelName : modelName,
                  ) || "…"}
                  /
                </dd>
              </div>
            </dl>

            <fieldset
              disabled={busy || activeTraining}
              className="min-w-0 border-0 px-0 pt-0 pb-4 m-0 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
              <Disclosure
                title={t("Advanced training options")}
                description={t("Adjust pitch extraction, vocoder, index generation, and noise reduction.")}
                icon={<Sliders size={16} />}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    <label htmlFor="auto-index-algo">{t("Index Algorithm")}</label>
                    <CustomSelect
                      id="auto-index-algo"
                      value={indexAlgo}
                      onChange={(event) => setIndexAlgo(event.target.value)}
                      description={t(SETTING_HELP.indexAlgorithm)}
                      className="w-full mt-1"
                    >
                      {["Auto", "Faiss", "KMeans", "Skip"].map((value) => (
                        <option key={value} value={value}>
                          {value === "Skip" ? t("Skip") : value}
                        </option>
                      ))}
                    </CustomSelect>
                  </div>
                </div>
              </Disclosure>
            </fieldset>

            {automaticJob && (automaticJob.status === "running" || automaticJob.status === "queued") && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-4 space-y-3">
                <JobStage job={automaticJob} />
                <JobProgress status={automaticJob.status} progress={automaticJob.progress} />
              </div>
            )}
            {automaticJob?.status === "error" && <Alert variant="error">{automaticJob.error}</Alert>}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button
                loading={busy}
                onClick={runPipeline}
                icon={<Zap size={16} />}
                disabled={Boolean(automaticDisabledReason)}
                aria-describedby={automaticDisabledReason ? "auto-training-help" : undefined}
                className="w-full sm:w-auto"
              >
                {busy || activeTraining ? t("Pipeline Running…") : t("Start Automatic Training")}
              </Button>
              {activeTraining && (
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
            {automaticDisabledReason && (
              <p id="auto-training-help" className="field-help m-0" role="status">
                {automaticDisabledReason}
              </p>
            )}
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
                        <span className="w-7 h-7 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center leading-none tabular-nums">
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
        <div className="modal-context">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
        </div>
        <section className="modal-section" aria-label={t("Source")}>
          <h3 className="modal-section-title">{t("Source")}</h3>
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
              <TrainingUpload
                kind="dataset"
                disabled={busy || activeTraining || uploadsInProgress > 0}
                onUploaded={onDatasetUploaded}
                onBusyChange={onUploadBusyChange}
              />
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
        </section>
        <section className="modal-section" aria-label={t("Slicing")}>
          <h3 className="modal-section-title">{t("Slicing")}</h3>
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
        </section>
        <section className="modal-section" aria-label={t("Cleanup")}>
          <h3 className="modal-section-title">{t("Cleanup")}</h3>
          <div className="modal-option-grid">
            <ToggleField
              id="modal-prep-process-effects"
              label={t("Noise filter")}
              checked={processEffects}
              onChange={setProcessEffects}
              description={t(SETTING_HELP.noiseFilter)}
            />
          </div>
        </section>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={busy}
            onClick={runPreprocess}
            icon={<Play size={14} />}
            disabled={busy || activeTraining || uploadsInProgress > 0}
          >
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
        <div className="modal-context">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
          <Badge variant="outline">{sampleRate} Hz</Badge>
        </div>
        <section className="modal-section" aria-label={t("Analysis models")}>
          <h3 className="modal-section-title">{t("Analysis models")}</h3>
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
                <TrainingUpload
                  kind="embedder"
                  disabled={busy || activeTraining || uploadsInProgress > 0}
                  onUploaded={setEmbedderCustom}
                  onBusyChange={onUploadBusyChange}
                />
              </div>
            )}
          </div>
        </section>
        <section className="modal-section" aria-label={t("Dataset")}>
          <h3 className="modal-section-title">{t("Dataset")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>*]:min-w-0">
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
        </section>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={busy}
            onClick={runExtract}
            icon={<Play size={14} />}
            disabled={busy || activeTraining || uploadsInProgress > 0}
          >
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
        <div className="modal-context">
          <Badge variant="neutral">{modelName || "…"}</Badge>
          <Badge variant={isCpu ? "warning" : "success"} dot>
            {isCpu ? t("CPU") : `${t("GPU")} ${gpuCount}`}
          </Badge>
          <Badge variant="outline">{vocoder}</Badge>
        </div>
        <section className="modal-section" aria-label={t("Architecture")}>
          <h3 className="modal-section-title">{t("Architecture")}</h3>
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
        </section>

        <section className="modal-section" aria-label={t("Checkpoints & performance")}>
          <h3 className="modal-section-title">{t("Checkpoints & performance")}</h3>
          <div className="modal-option-grid">
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
        </section>
        {customPre && (
          <section className="modal-section" aria-label={t("Custom pretrained weights")}>
            <h3 className="modal-section-title">{t("Custom pretrained weights")}</h3>
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
                <TrainingUpload
                  kind="pretrained"
                  label={t("Custom Pretrained G")}
                  onBusyChange={onUploadBusyChange}
                  disabled={busy}
                  onUploaded={(path) => {
                    setPretG((current) => (current.includes(path) ? current : [...current, path].sort()));
                    setGPath(path);
                  }}
                />
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
                <TrainingUpload
                  kind="pretrained"
                  label={t("Custom Pretrained D")}
                  onBusyChange={onUploadBusyChange}
                  disabled={busy}
                  onUploaded={(path) => {
                    setPretD((current) => (current.includes(path) ? current : [...current, path].sort()));
                    setDPath(path);
                  }}
                />
              </div>
            </div>
          </section>
        )}

        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={busy}
            onClick={runTrainStep}
            icon={<Play size={14} />}
            disabled={busy || activeTraining || uploadsInProgress > 0}
          >
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
        <div className="modal-context">
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
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setActiveModal(null)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={busy}
            onClick={runIndex}
            icon={<Play size={14} />}
            disabled={busy || activeTraining || uploadsInProgress > 0}
          >
            {busy ? t("Running…") : t("Generate Index")}
          </Button>
        </div>
      </Modal>

      <TrainingConsole jobId={jobId} modelName={modelName} totalEpochs={totalEpoch} onStop={stop} />
    </div>
  );
}
