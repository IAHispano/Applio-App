"use client";

import { Check, Clock, Database, Layers, Mic2, Play, Settings2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JobPanelContent } from "@/components/JobPanel";
import { TtsModelSelect } from "@/components/TtsModelFiles";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CustomSelect,
  Disclosure,
  FormField,
  ModelDropdown,
} from "@/components/ui";
import { apiGet, errMsg, fetchModels, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";
import type { GpuDevice } from "./GpuSelect";
import TrainingUpload from "./TrainingUpload";

const speechLanguages = ["en", "en-us", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "tr", "hi", "ar"];

export function TextFrontendInitialization({
  id,
  value,
  onChange,
  disabled,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
}) {
  const [frontends, setFrontends] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiGet<{ frontends: string[] }>("/api/tts/frontends")
      .then(({ frontends }) => {
        if (active) setFrontends(frontends);
      })
      .catch((error) => {
        if (active) setError(errMsg(error));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="min-w-0">
      <TtsModelSelect
        id={id}
        value={value}
        models={frontends}
        label="Pretrained"
        required={required}
        onChange={onChange}
        disabled={disabled}
      />
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}

export function TextFrontendLanguage({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t, code } = useI18n();
  const names = new Intl.DisplayNames([code.replace("_", "-")], { type: "language" });
  return (
    <FormField label={t("Speech language")} htmlFor={id}>
      <CustomSelect
        id={id}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        options={speechLanguages.map((language) => ({
          value: language,
          label: names.of(language) || language,
        }))}
      />
    </FormField>
  );
}

export default function TextFrontendTraining({ requestedVoice = "" }: { requestedVoice?: string }) {
  const { t } = useI18n();
  const [name, setName] = useWorkspaceState("train:text:name", "my-text-voice");
  const [dataset, setDataset] = useWorkspaceState("train:text:dataset", "");
  const [voice, setVoice] = useWorkspaceState("train:text:voice", "");
  const [voices, setVoices] = useState<string[]>([]);
  const [initial, setInitial] = useWorkspaceState("train:text:initial", "");
  const [steps, setSteps] = useWorkspaceState("train:text:steps", 1000);
  const [maxSeconds, setMaxSeconds] = useWorkspaceState("train:text:max-seconds", 60);
  const [batchSize, setBatchSize] = useWorkspaceState("train:text:batch", 4);
  const [device, setDevice] = useWorkspaceState("train:text:device", "cpu");
  const [language, setLanguage] = useWorkspaceState("train:text:language", "en");
  const [devices, setDevices] = useState<GpuDevice[]>([]);
  const [jobId, setJobId] = usePersistentJobId("train-text");
  const activity = useJob(jobId);
  const { job, isActive, error, setError } = activity;
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [datasets, setDatasets] = useState<string[]>([]);
  const busy = isActive || submitting || uploading;
  const appliedVoice = useRef("");

  useEffect(() => {
    const path = requestedVoice || new URLSearchParams(window.location.search).get("pth");
    if (!busy && path?.toLowerCase().endsWith(".pth") && appliedVoice.current !== path) {
      appliedVoice.current = path;
      setVoice(path);
    }
  }, [busy, requestedVoice, setVoice]);

  useEffect(() => {
    let active = true;
    apiGet<{ devices: GpuDevice[] }>("/api/train/gpus")
      .then((response) => {
        if (active) setDevices(response.devices);
      })
      .catch((error) => {
        if (active) setError(errMsg(error));
      });
    return () => {
      active = false;
    };
  }, [setError]);

  useEffect(() => {
    let active = true;
    apiGet<{ datasets: string[] }>("/api/train/datasets")
      .then(({ datasets }) => {
        if (active) setDatasets(datasets);
      })
      .catch((error) => {
        if (active) setError(errMsg(error));
      });
    return () => {
      active = false;
    };
  }, [setError]);

  useEffect(() => {
    let active = true;
    fetchModels(false)
      .then(({ models }) => {
        if (active) setVoices(models);
      })
      .catch((error) => {
        if (active) setError(errMsg(error));
      });
    return () => {
      active = false;
    };
  }, [setError]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { jobId } = await submitJob("/api/train/text-rvc", {
        datasetRoot: dataset,
        pthPath: voice,
        language,
        output: `logs/tts/${name}`,
        steps,
        maxSeconds,
        batchSize,
        hidden: 256,
        layers: 4,
        device,
        phoneticLoss: true,
        ...(initial.trim() ? { initializeFrom: initial.trim() } : {}),
      });
      setJobId(jobId);
    } catch (error) {
      setError(errMsg(error));
    } finally {
      setSubmitting(false);
    }
  }

  const disabledReason = busy
    ? t(uploading ? "Uploading…" : "Pipeline Running…")
    : !name.trim()
      ? t("Please enter a model name.")
      : !voice
        ? t("Select a voice model…")
        : !dataset.trim()
          ? t("Please enter a dataset path.")
          : !initial.trim()
            ? t("Select a TTS model.")
            : "";
  const submitted = job?.params?.training as Record<string, unknown> | undefined;
  const sameProject =
    job?.params?.modelName === name && submitted?.datasetRoot === dataset && submitted?.pthPath === voice;
  const showActivity = Boolean(jobId && (isActive || sameProject));

  return (
    <div className="space-y-5">
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      <form onSubmit={start} className="space-y-5">
        <Card as="section">
          <CardHeader
            step={1}
            icon={<Mic2 size={18} />}
            title={t("Training Project")}
            description={t("Choose an existing voice and give its TTS model a name.")}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t("Voice Model")} htmlFor="text-train-voice" required>
              <ModelDropdown
                id="text-train-voice"
                models={voices}
                selectedModel={voice}
                onSelect={setVoice}
                disabled={busy}
              />
            </FormField>
            <FormField label={t("Model Name")} htmlFor="text-train-name" required>
              <input
                id="text-train-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                pattern="[A-Za-z0-9_-]{1,80}"
                maxLength={80}
                disabled={busy}
              />
            </FormField>
          </div>
        </Card>

        <Card as="section">
          <CardHeader
            step={2}
            icon={<Database size={18} />}
            title={t("Recordings")}
            description={t("Add recordings. Applio creates the transcripts and prepares the clips for you.")}
            action={
              <Badge variant="info">
                <Sparkles size={12} className="inline mr-1" aria-hidden="true" />
                {t("Automatic transcripts")}
              </Badge>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t("Dataset Path")} htmlFor="text-train-dataset" required>
              <input
                id="text-train-dataset"
                type="text"
                value={dataset}
                onChange={(event) => setDataset(event.target.value)}
                required
                disabled={busy}
              />
            </FormField>
            <TextFrontendLanguage
              id="text-train-language"
              value={language}
              onChange={setLanguage}
              disabled={busy}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <TrainingUpload
              kind="dataset"
              initialName={name}
              disabled={isActive || submitting}
              onBusyChange={setUploading}
              onUploaded={(path) => {
                setDataset(path);
                setDatasets((current) => [...new Set([...current, path])]);
              }}
            />
            {datasets.length > 0 && (
              <FormField label={t("Existing datasets")} htmlFor="text-train-existing-dataset">
                <CustomSelect
                  id="text-train-existing-dataset"
                  value={datasets.includes(dataset) ? dataset : ""}
                  onValueChange={setDataset}
                  disabled={busy}
                  options={datasets.map((path) => ({
                    value: path,
                    label: path.split(/[\\/]/).filter(Boolean).at(-1) || path,
                  }))}
                />
              </FormField>
            )}
          </div>
          <p className="field-help m-0">
            {t("Your original recordings stay untouched. Matching transcripts are reused when available.")}
          </p>
        </Card>

        <Card as="section">
          <CardHeader
            step={3}
            icon={<Layers size={18} />}
            title={t("Applio TTS")}
            description={t("Start from a pretrained TTS model in your recordings’ language.")}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextFrontendInitialization
              id="text-train-initial"
              value={initial}
              onChange={setInitial}
              disabled={busy}
              required
            />
            <FormField label={t("Time limit (seconds)")} htmlFor="text-train-seconds" required>
              <input
                id="text-train-seconds"
                type="number"
                value={maxSeconds}
                onChange={(event) => setMaxSeconds(Number(event.target.value))}
                min={1}
                max={3600}
                step={1}
                required
                disabled={busy}
              />
              <p className="field-help m-0">
                {t(
                  "Preparation and adaptation share this limit, capped by the recorded voice training time when available. Cleanup and output checks may take a few extra seconds. The pretrained model is kept if adaptation cannot finish.",
                )}
              </p>
            </FormField>
          </div>
          <Disclosure title={t("Advanced training options")} icon={<Settings2 size={16} />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField label={t("Maximum TTS steps")} htmlFor="text-train-steps">
                <input
                  id="text-train-steps"
                  type="number"
                  value={steps}
                  onChange={(event) => setSteps(Number(event.target.value))}
                  min={1}
                  max={100000}
                  step={1}
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField label={t("Batch Size")} htmlFor="text-train-batch">
                <input
                  id="text-train-batch"
                  type="number"
                  value={batchSize}
                  onChange={(event) => setBatchSize(Number(event.target.value))}
                  min={1}
                  max={32}
                  step={1}
                  required
                  disabled={busy}
                />
              </FormField>
              <FormField label={t("GPU")} htmlFor="text-train-device">
                <CustomSelect
                  id="text-train-device"
                  value={device}
                  onValueChange={setDevice}
                  disabled={busy}
                  options={[
                    { value: "cpu", label: t("CPU") },
                    ...(devices.some((gpu) => gpu.kind !== "mps")
                      ? [{ value: "cuda", label: devices.find((gpu) => gpu.kind !== "mps")?.name || "GPU" }]
                      : []),
                    ...(devices.some((gpu) => gpu.kind === "mps")
                      ? [{ value: "mps", label: devices.find((gpu) => gpu.kind === "mps")?.name || "GPU" }]
                      : []),
                  ]}
                />
              </FormField>
            </div>
          </Disclosure>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              {disabledReason ? <Clock size={16} /> : <Check size={16} className="text-[var(--success)]" />}
              <span id="text-train-ready" role="status">
                {disabledReason || t("Ready to train")}
              </span>
            </div>
            <Button
              type="submit"
              icon={<Play size={16} />}
              disabled={Boolean(disabledReason)}
              loading={submitting}
              aria-describedby="text-train-ready"
            >
              {t("Start Training")}
            </Button>
          </div>
        </Card>
      </form>

      {showActivity && (
        <Card as="section">
          <CardHeader icon={<Layers size={18} />} title={t("Training Activity Console")} />
          <JobPanelContent jobId={jobId} activity={activity} embedded showLogs />
        </Card>
      )}
      {!showActivity && jobId && (
        <div className="flex justify-end">
          <Button href="/jobs" variant="ghost" size="sm">
            {t("Job history")}
          </Button>
        </div>
      )}
    </div>
  );
}
