"use client";

import { Check, Sliders, StopCircle, Zap } from "lucide-react";
import type React from "react";
import { JobProgress, JobStage } from "@/components/JobStatus";
import { Alert, Badge, Button, Card, CardHeader, Disclosure } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { useI18n } from "@/lib/i18n";
import { SETTING_HELP } from "@/lib/setting-help";

interface AutomaticTrainingPanelProps {
  activeTraining: boolean;
  automaticJob: import("@/lib/api").Job | null;
  pipelinePhases: { n: number; label: string; stage: string }[];
  indexAlgo: string;
  currentPhase: number;
  cleanDatasetPath: () => string;
  modelName: string;
  busy: boolean;
  sampleRate: string;
  setSampleRate: React.Dispatch<React.SetStateAction<string>>;
  srOptions: string[];
  totalEpoch: number;
  setTotalEpoch: React.Dispatch<React.SetStateAction<number>>;
  batchSize: number;
  setBatchSize: React.Dispatch<React.SetStateAction<number>>;
  f0Method: string;
  setF0Method: React.Dispatch<React.SetStateAction<string>>;
  vocoder: string;
  pickVocoder: (v: string) => void;
  setIndexAlgo: React.Dispatch<React.SetStateAction<string>>;
  runPipeline: () => Promise<void>;
  automaticDisabledReason: string;
  stop: () => Promise<void>;
}

export default function AutomaticTrainingPanel({ controls }: { controls: AutomaticTrainingPanelProps }) {
  const { t } = useI18n();
  const {
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
  } = controls;
  return (
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
          const skipIndex = index === 3 && (automaticJob?.params?.indexAlgorithm ?? indexAlgo) === "Skip";
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
              <Badge variant={done ? "success" : failed ? "danger" : running ? "info" : "neutral"} size="sm">
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
              activeTraining && automaticJob ? automaticJob.params?.datasetPath || "" : cleanDatasetPath(),
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

      <fieldset disabled={busy || activeTraining} className="min-w-0 border-0 px-0 pt-0 pb-4 m-0 space-y-4">
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
  );
}
