"use client";

import type { LucideIcon } from "lucide-react";
import { Activity, Check, Database, Flame, Layers, Play, RefreshCw, Sliders, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import AutomaticTrainingPanel from "@/components/train/AutomaticTrainingPanel";
import ExtractionModal from "@/components/train/ExtractionModal";
import type { GpuDevice } from "@/components/train/GpuSelect";
import IndexModal from "@/components/train/IndexModal";
import PreprocessModal from "@/components/train/PreprocessModal";
import TrainingConsole from "@/components/train/TrainingConsole";
import TrainingModal from "@/components/train/TrainingModal";
import TrainingProjectSetup from "@/components/train/TrainingProjectSetup";
import { Button, Card, CardHeader } from "@/components/ui";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { apiGet, apiSend, errMsg, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";

type TrainMode = "auto" | "manual";
type StepModal = null | "preprocess" | "extract" | "train" | "index";

export default function TrainPage() {
  const { t } = useI18n();
  const [trainMode, setTrainMode] = useWorkspaceState<TrainMode>("page:train:trainMode", "auto");
  const [activeModal, setActiveModal] = useState<StepModal>(null);

  const [modelName, setModelName] = useWorkspaceState("page:train:modelName", "my-project");
  const [datasets, setDatasets] = useWorkspaceState<string[]>("page:train:datasets", []);
  const [pretG, setPretG] = useWorkspaceState<string[]>("page:train:pretG", []);
  const [pretD, setPretD] = useWorkspaceState<string[]>("page:train:pretD", []);
  const [gpuInfo, setGpuInfo] = useWorkspaceState("page:train:gpuInfo", "");
  const [gpuCount, setGpuCount] = useWorkspaceState("page:train:gpuCount", "0");
  const [gpuDevices, setGpuDevices] = useWorkspaceState<GpuDevice[]>("page:train:gpuDevices", []);

  const [datasetPath, setDatasetPath] = useWorkspaceState("page:train:datasetPath", "");
  const [sampleRate, setSampleRate] = useWorkspaceState("page:train:sampleRate", "40000");
  const [cpuCores, setCpuCores] = useWorkspaceState("page:train:cpuCores", "");
  const [hostCores, setHostCores] = useWorkspaceState("page:train:hostCores", 16);
  const cpuTouchedRef = useRef(cpuCores !== "");
  const [cut, setCut] = useWorkspaceState("page:train:cut", "Automatic");
  const [chunk, setChunk] = useWorkspaceState("page:train:chunk", 3.0);
  const [overlap, setOverlap] = useWorkspaceState("page:train:overlap", 0.3);
  const [processEffects, setProcessEffects] = useWorkspaceState("page:train:processEffects", false);
  const [normalizationMode, setNormalizationMode] = useWorkspaceState("page:train:normalizationMode", "none");
  const [f0Method, setF0Method] = useWorkspaceState("page:train:f0Method", "rmvpe");
  const [embedder, setEmbedder] = useWorkspaceState("page:train:embedder", "contentvec");
  const [embedderCustom, setEmbedderCustom] = useWorkspaceState("page:train:embedderCustom", "");
  const [includeMutes, setIncludeMutes] = useWorkspaceState("page:train:includeMutes", 2);
  const [vocoder, setVocoder] = useWorkspaceState("page:train:vocoder", "HiFi-GAN");
  const [totalEpoch, setTotalEpoch] = useWorkspaceState("page:train:totalEpoch", 200);
  const [batchSize, setBatchSize] = useWorkspaceState("page:train:batchSize", 4);
  const [saveEvery, setSaveEvery] = useWorkspaceState("page:train:saveEvery", 10);
  const [pretrained, setPretrained] = useWorkspaceState("page:train:pretrained", true);
  const [saveOnlyLatest, setSaveOnlyLatest] = useWorkspaceState("page:train:saveOnlyLatest", true);
  const [saveEveryWeights, setSaveEveryWeights] = useWorkspaceState("page:train:saveEveryWeights", true);
  const [cleanup, setCleanup] = useWorkspaceState("page:train:cleanup", false);
  const [cacheGpu, setCacheGpu] = useWorkspaceState("page:train:cacheGpu", false);
  const [checkpointing, setCheckpointing] = useWorkspaceState("page:train:checkpointing", false);
  const [indexAlgo, setIndexAlgo] = useWorkspaceState("page:train:indexAlgo", "Auto");
  const [customPre, setCustomPre] = useWorkspaceState("page:train:customPre", false);
  const [gPath, setGPath] = useWorkspaceState("page:train:gPath", "");
  const [dPath, setDPath] = useWorkspaceState("page:train:dPath", "");

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
  const [reviewBusy, setReviewBusy] = useState(false);
  const onUploadBusyChange = useCallback((uploading: boolean) => {
    setUploadsInProgress((count) => count + (uploading ? 1 : -1));
  }, []);
  const onDatasetUploaded = useCallback(
    (path: string) => {
      setDatasets((current) => (current.includes(path) ? current : [...current, path].sort()));
      setDatasetPath(path);
    },
    [setDatasets, setDatasetPath],
  );
  const [completedSteps, setCompletedSteps] = useWorkspaceState<Set<NonNullable<StepModal>>>(
    "page:train:completedSteps",
    new Set(),
  );

  async function loadDatasets(force = false): Promise<string[]> {
    try {
      const d = await apiGet<{ datasets: string[] }>("/api/train/datasets", { force });
      setDatasets(d.datasets);
      return d.datasets;
    } catch {
      return [];
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-time fetch only; t is a stable dictionary lookup
  useEffect(() => {
    loadDatasets();
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
        setGpuCount((current) =>
          current.split("-").every((id) => devs.some((device) => device.id === id)) ? current : gpuId,
        );
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

  const previousProject = useRef(modelName);

  // Step completion is per-project: switching models starts a fresh trail.
  // Steps are marked done only when their job succeeds, never on submit,
  // so a failed run (e.g. training exit code 1) can't show green checks.
  useEffect(() => {
    if (previousProject.current !== modelName) setCompletedSteps(new Set());
    previousProject.current = modelName;
  }, [modelName, setCompletedSteps]);

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
    trainingJob?.status,
    trainingJob?.params?.step,
    trainingJob?.params?.modelName,
    modelName,
    setCompletedSteps,
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
      // fetch() does not reject on 4xx/5xx, so a plain fetch would report
      // success even when the API refused to stop the run.
      await apiSend("/api/train/stop", "POST", { jobId: jobId || undefined, modelName });
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
      <TrainingProjectSetup
        controls={{
          isCpu,
          gpuCount,
          activeTraining,
          modelName,
          setModelName,
          setGpuCount,
          gpuDevices,
          cpuCores,
          hostCores,
          cpuTouchedRef,
          setCpuCores,
          datasetPath,
          busy,
          reviewBusy,
          uploadsInProgress,
          setDatasetPath,
          datasets,
          refreshDatasets: () => loadDatasets(true),
          onDatasetUploaded,
          onUploadBusyChange,
          setReviewBusy,
          gpuInfo,
          error,
          setError,
        }}
      />

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
          <AutomaticTrainingPanel
            controls={{
              activeTraining,
              automaticJob,
              pipelinePhases,
              indexAlgo,
              currentPhase,
              cleanDatasetPath,
              modelName,
              busy,
              sampleRate,
              setSampleRate,
              srOptions,
              totalEpoch,
              setTotalEpoch,
              batchSize,
              setBatchSize,
              f0Method,
              setF0Method,
              vocoder,
              pickVocoder,
              setIndexAlgo,
              runPipeline,
              automaticDisabledReason,
              stop,
            }}
          />
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
                  onClick={() => loadDatasets(true)}
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
      <PreprocessModal
        controls={{
          activeModal,
          setActiveModal,
          modelName,
          isCpu,
          gpuCount,
          datasetPath,
          setDatasetPath,
          datasets,
          refreshDatasets: () => loadDatasets(true),
          busy,
          activeTraining,
          reviewBusy,
          uploadsInProgress,
          onDatasetUploaded,
          onUploadBusyChange,
          sampleRate,
          setSampleRate,
          srOptions,
          normalizationMode,
          setNormalizationMode,
          cut,
          setCut,
          chunk,
          setChunk,
          overlap,
          setOverlap,
          processEffects,
          setProcessEffects,
          runPreprocess,
        }}
      />

      {/* Step 2 modal: Extract */}
      <ExtractionModal
        controls={{
          activeModal,
          setActiveModal,
          modelName,
          isCpu,
          gpuCount,
          sampleRate,
          f0Method,
          setF0Method,
          embedder,
          setEmbedder,
          embedderCustom,
          setEmbedderCustom,
          busy,
          activeTraining,
          uploadsInProgress,
          onUploadBusyChange,
          includeMutes,
          setIncludeMutes,
          setSampleRate,
          srOptions,
          runExtract,
        }}
      />

      {/* Step 3 modal: Train */}
      <TrainingModal
        controls={{
          activeModal,
          setActiveModal,
          modelName,
          isCpu,
          gpuCount,
          vocoder,
          pickVocoder,
          indexAlgo,
          setIndexAlgo,
          totalEpoch,
          setTotalEpoch,
          batchSize,
          setBatchSize,
          saveEvery,
          setSaveEvery,
          pretrained,
          setPretrained,
          saveOnlyLatest,
          setSaveOnlyLatest,
          saveEveryWeights,
          setSaveEveryWeights,
          cleanup,
          setCleanup,
          cacheGpu,
          setCacheGpu,
          checkpointing,
          setCheckpointing,
          customPre,
          setCustomPre,
          pretG,
          gPath,
          setGPath,
          onUploadBusyChange,
          busy,
          setPretG,
          pretD,
          dPath,
          setDPath,
          setPretD,
          runTrainStep,
          activeTraining,
          uploadsInProgress,
        }}
      />

      {/* Step 4 modal: Index */}
      <IndexModal
        controls={{
          activeModal,
          setActiveModal,
          modelName,
          indexAlgo,
          setIndexAlgo,
          busy,
          runIndex,
          activeTraining,
          uploadsInProgress,
        }}
      />

      <TrainingConsole jobId={jobId} modelName={modelName} totalEpochs={totalEpoch} onStop={stop} />
    </div>
  );
}
