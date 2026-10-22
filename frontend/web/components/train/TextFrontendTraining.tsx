"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { JobBadge, JobError, JobProgress, JobStage } from "@/components/JobStatus";
import { TtsModelDownload, TtsModelImport } from "@/components/TtsModelFiles";
import { Alert, Button, Card, CardHeader, CustomSelect, FormField } from "@/components/ui";
import { apiGet, errMsg, fetchModels, stopJob, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useWorkspaceState } from "@/lib/workspace-state";
import type { GpuDevice } from "./GpuSelect";

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
  const { t } = useI18n();
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
    <FormField label={t("Pretrained")} htmlFor={id}>
      <input
        id={id}
        type="text"
        list={`${id}-options`}
        value={value}
        placeholder={t(required ? "Select a TTS model." : "None")}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <datalist id={`${id}-options`}>
        {frontends.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <TtsModelImport
        disabled={disabled}
        onImport={(path) => {
          onChange(path);
          setFrontends((current) => [...new Set([...current, path])]);
        }}
      />
      {error && <Alert variant="error">{error}</Alert>}
    </FormField>
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
  const [steps, setSteps] = useWorkspaceState("train:text:steps", 10000);
  const [batchSize, setBatchSize] = useWorkspaceState("train:text:batch", 4);
  const [device, setDevice] = useWorkspaceState("train:text:device", "cpu");
  const [language, setLanguage] = useWorkspaceState("train:text:language", "en");
  const [devices, setDevices] = useState<GpuDevice[]>([]);
  const [jobId, setJobId] = usePersistentJobId("train-text");
  const { job, isActive, error, setError } = useJob(jobId);
  const [submitting, setSubmitting] = useState(false);
  const busy = isActive || submitting;
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

  return (
    <Card as="section" className="space-y-4">
      <CardHeader
        title={t("Enable TTS for a voice")}
        description={t(
          "Enable TTS for an existing RVC voice. Use clips of 0.25–12 seconds with a matching UTF-8 .txt transcript beside each audio file. Alignment models download on first use.",
        )}
      />
      {error && (
        <Alert variant="error" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}
      <form onSubmit={start} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label={t("Model Name")} htmlFor="text-train-name">
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
          <FormField label={t("Dataset Path")} htmlFor="text-train-dataset">
            <input
              id="text-train-dataset"
              type="text"
              value={dataset}
              onChange={(event) => setDataset(event.target.value)}
              required
              disabled={busy}
            />
          </FormField>
          <FormField label={t("Voice Model")} htmlFor="text-train-voice">
            <CustomSelect
              id="text-train-voice"
              value={voice}
              onValueChange={setVoice}
              options={voices.map((value) => ({ value, label: value }))}
              disabled={busy}
            />
          </FormField>
          <TextFrontendInitialization
            id="text-train-initial"
            value={initial}
            onChange={setInitial}
            disabled={busy}
          />
          <FormField label={t("Training steps")} htmlFor="text-train-steps">
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
          <TextFrontendLanguage
            id="text-train-language"
            value={language}
            onChange={setLanguage}
            disabled={busy}
          />
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
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" disabled={busy || !voice}>
            {submitting ? t("Submitting…") : t("Train")}
          </Button>
          {isActive && jobId && (
            <Button variant="danger" onClick={() => stopJob(jobId).catch((error) => setError(errMsg(error)))}>
              {t("Cancel")}
            </Button>
          )}
          {job && (
            <>
              <JobBadge status={job.status} error={job.error} />
              <JobStage job={job} />
            </>
          )}
          {job?.status === "done" && <TtsModelDownload frontend={String(job.result?.frontend || "")} />}
          {job?.status === "done" && (
            <Link
              href={`/tts?provider=rvc&frontend=${encodeURIComponent(String(job.result?.frontend || ""))}&pth=${encodeURIComponent(String(job.result?.pthPath || voice))}`}
              className="underline"
            >
              {t("Text to Speech")}
            </Link>
          )}
        </div>
      </form>
      {job && <JobProgress status={job.status} progress={job.progress} job={job} />}
      {job?.status === "error" && (
        <JobError message={job.error} details={job.errorDetails} logs={job.logs} jobId={job.id} />
      )}
      {job?.logs?.length ? (
        <details>
          <summary>{t("Training")}</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{job.logs.join("\n")}</pre>
        </details>
      ) : null}
    </Card>
  );
}
