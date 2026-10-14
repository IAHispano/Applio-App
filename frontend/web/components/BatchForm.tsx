"use client";

import { ArrowRight, CheckCircle2, Layers, StopCircle, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import BatchResults, { type BatchResult } from "@/components/BatchResults";
import ConversionParameters, { type ConversionParameterValues } from "@/components/ConversionParameters";
import { JobError, JobStage } from "@/components/JobStatus";
import ModelPresetStatus from "@/components/ModelPresetStatus";
import { Alert, Badge, Button, Card, CardHeader, SegmentedControl, ToggleField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import ProgressBar from "@/components/ui/ProgressBar";
import SettingHelp from "@/components/ui/SettingHelp";
import { apiSend, errMsg, fetchModels, fileBasename, stopJob, submitJob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { getModelPreset, saveModelPreset } from "@/lib/model-presets";
import { SETTING_HELP } from "@/lib/setting-help";
import { CONVERSION_DEFAULTS, useConversionParameters } from "@/lib/useConversionParameters";
import { useJob, usePersistentJobId } from "@/lib/useJob";
import { useSpeakers } from "@/lib/useSpeakers";

type ConversionParameterSetters = {
  [K in keyof ConversionParameterValues]: (value: ConversionParameterValues[K]) => void;
};

const BATCH_CONFIG_KEY = "applio:batch-config";

function loadBatchConfig(): {
  indexes: Record<string, string>;
  overrides: Record<string, Partial<ConversionParameterValues>>;
} {
  try {
    if (typeof sessionStorage === "undefined") return { indexes: {}, overrides: {} };
    const raw = sessionStorage.getItem(BATCH_CONFIG_KEY);
    if (!raw) return { indexes: {}, overrides: {} };
    const parsed = JSON.parse(raw) as {
      indexes?: Record<string, string>;
      overrides?: Record<string, Partial<ConversionParameterValues>>;
    };
    return {
      indexes: parsed.indexes && typeof parsed.indexes === "object" ? parsed.indexes : {},
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
    };
  } catch {
    return { indexes: {}, overrides: {} };
  }
}

export default function BatchForm() {
  const [models, setModels] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<string[]>([]);
  const { t } = useI18n();
  const [inputFolder, setInputFolder] = useState("assets/audios");
  const [inputPath, setInputPath] = useState("");
  const [sourceMode, setSourceMode] = useState<"folder" | "file">("folder");
  const [sourceFiles, setSourceFiles] = useState<{ name: string; bytes: number }[] | null>(null);
  const [excludedFiles, setExcludedFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [canBrowse, setCanBrowse] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [continueOnError, setContinueOnError] = useState(true);
  const scanVersion = useRef(0);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [modelIndexes, setModelIndexes] = useState<Record<string, string>>(() => loadBatchConfig().indexes);
  const [legacyOverrides] = useState(() => loadBatchConfig().overrides);
  const migratedPresets = useRef(false);
  const [editingTarget, setEditingTarget] = useState<string>("global");
  const [outputFolder, setOutputFolder] = useState("assets/audios/batch_output");
  const conversion = useConversionParameters(selectedModels.length === 1 ? selectedModels[0] : "");
  const {
    pitch,
    indexRate,
    volumeEnvelope,
    protect,
    f0Method,
    inferenceEngine,
    onnxPrecision,
    embedderModel,
    embedderModelCustom,
    exportFormat,
    splitAudio,
    f0Autotune,
    f0AutotuneStrength,
    proposedPitch,
    proposedPitchThreshold,
    formantShifting,
    formantQfrency,
    formantTimbre,
  } = conversion.values;
  const [sid, setSid] = useState(0);
  const [jobId, setJobId] = usePersistentJobId("batch");
  const { job, error, setError } = useJob(jobId);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const active =
    (!!jobId && job?.id !== jobId && !error) || job?.status === "running" || job?.status === "queued";
  const batchResult = job?.result as unknown as BatchResult | undefined;
  const selectedFileCount = (sourceFiles?.length || 0) - excludedFiles.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: A source change invalidates its review and any in-flight scan.
  useEffect(() => {
    scanVersion.current++;
    setSourceFiles(null);
    setExcludedFiles([]);
    setScanning(false);
    setSourceError("");
  }, [inputFolder, inputPath, sourceMode]);

  async function reviewFiles() {
    const version = ++scanVersion.current;
    setScanning(true);
    setError("");
    setSourceError("");
    try {
      const result = await apiSend<{ files: { name: string; bytes: number }[] }>(
        "/api/inference/batch/preview",
        "POST",
        {
          inputFolder,
          inputPath: sourceMode === "file" ? inputPath : "",
        },
      );
      if (version !== scanVersion.current) return;
      setSourceFiles(result.files);
      setExcludedFiles([]);
    } catch (error) {
      if (version === scanVersion.current) setSourceError(t(errMsg(error)));
    } finally {
      if (version === scanVersion.current) setScanning(false);
    }
  }

  async function chooseFolder(target: "input" | "output") {
    const desktop = (
      window as unknown as { applio?: { chooseFolder?: (path: string) => Promise<string | null> } }
    ).applio;
    if (!desktop?.chooseFolder) return;
    try {
      const value = await desktop.chooseFolder(target === "input" ? inputFolder : outputFolder);
      if (value) (target === "input" ? setInputFolder : setOutputFolder)(value);
    } catch (error) {
      setError(errMsg(error));
    }
  }

  const speakers = useSpeakers(selectedModels[0] ?? "");

  const filteredModels = modelQuery.trim()
    ? models.filter((m) => m.toLowerCase().includes(modelQuery.trim().toLowerCase()))
    : models;

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  const loadAvailableModels = useCallback((force = true) => {
    fetchModels(force)
      .then((m) => {
        setModels(m.models);
        setIndexes(m.indexes);
        if (m.models[0]) {
          setSelectedModels((prev) => (prev.length ? prev : [m.models[0]]));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAvailableModels(true);
    setCanBrowse(
      typeof (window as unknown as { applio?: { chooseFolder?: unknown } }).applio?.chooseFolder ===
        "function",
    );
    const onFocus = () => loadAvailableModels(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadAvailableModels]);

  const resetDefaults = conversion.reset;

  const globalValues = conversion.values;

  const globalSetters = conversion.setters;

  // Preserve existing session overrides once, then use the shared durable presets.
  useEffect(() => {
    if (!conversion.loaded || conversion.error || migratedPresets.current) return;
    migratedPresets.current = true;
    for (const [model, values] of Object.entries(legacyOverrides)) {
      if (!getModelPreset("conversion", model)) saveModelPreset("conversion", model, values);
    }
  }, [conversion.loaded, conversion.error, legacyOverrides]);
  useEffect(() => {
    if (!conversion.loaded || !migratedPresets.current) return;
    try {
      sessionStorage.setItem(BATCH_CONFIG_KEY, JSON.stringify({ indexes: modelIndexes }));
    } catch {
      /* index choices remain in memory */
    }
  }, [modelIndexes, conversion.loaded]);

  const indexFor = (model: string) => modelIndexes[model] ?? matchIndex(model, indexes);

  const overridesFor = (model: string) =>
    (getModelPreset("conversion", model) ?? {}) as Partial<ConversionParameterValues>;
  const overrideCount = (model: string) => Object.keys(overridesFor(model)).length;

  const setModelOverride = <K extends keyof ConversionParameterValues>(
    model: string,
    key: K,
    value: ConversionParameterValues[K],
  ) => {
    saveModelPreset("conversion", model, { [key]: value });
  };

  // Editing target for the shared Conversion Parameters card: global defaults
  // or one selected model. Each target keeps its own values.
  useEffect(() => {
    if (selectedModels.length < 2) {
      setEditingTarget("global");
    } else if (editingTarget !== "global" && !selectedModels.includes(editingTarget)) {
      setEditingTarget("global");
    }
  }, [selectedModels, editingTarget]);

  const editingModel = editingTarget !== "global" ? editingTarget : null;

  const paramsValues: ConversionParameterValues = editingModel
    ? { ...globalValues, ...overridesFor(editingModel) }
    : globalValues;

  const paramsSetters: ConversionParameterSetters = editingModel
    ? (Object.fromEntries(
        (Object.keys(globalValues) as (keyof ConversionParameterValues)[]).map((key) => [
          key,
          (value: ConversionParameterValues[typeof key]) => setModelOverride(editingModel, key, value),
        ]),
      ) as ConversionParameterSetters)
    : globalSetters;

  const paramsReset = editingModel
    ? () => saveModelPreset("conversion", editingModel, { ...CONVERSION_DEFAULTS })
    : resetDefaults;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!conversion.loaded) {
      setError(t("Loading model settings…"));
      return;
    }
    if (!selectedModels.length) {
      setError(t("Select a voice model."));
      return;
    }
    if (submitting.current || active) return;
    if (!sourceFiles || !selectedFileCount) {
      setError(t("Review and select audio files before converting."));
      return;
    }
    const singleFile = sourceMode === "file";
    if (!singleFile && !inputFolder.trim()) {
      setError(t("Provide an input folder or a single audio file."));
      return;
    }
    const derivedMode = singleFile ? "models" : selectedModels.length > 1 ? "both" : "files";
    setBusy(true);
    submitting.current = true;
    try {
      const { jobId: id } = await submitJob("/api/inference/batch", {
        pthPath: selectedModels[0],
        mode: derivedMode,
        inputPath: singleFile ? inputPath : "",
        excludedFiles,
        selectedFiles: sourceFiles
          .filter((file) => !excludedFiles.includes(file.name))
          .map((file) => file.name),
        continueOnError,
        models: selectedModels.map((model) => ({
          pthPath: model,
          indexPath: indexFor(model),
          ...(overrideCount(model) > 0 ? { overrides: overridesFor(model) } : {}),
        })),
        indexPath: indexFor(selectedModels[0]),
        inputFolder,
        outputFolder,
        pitch,
        indexRate,
        volumeEnvelope,
        protect,
        f0Method,
        inferenceEngine,
        onnxPrecision,
        exportFormat,
        embedderModel,
        ...(embedderModel === "custom" && embedderModelCustom ? { embedderModelCustom } : {}),
        splitAudio,
        f0Autotune,
        f0AutotuneStrength,
        proposedPitch,
        proposedPitchThreshold,
        formantShifting,
        formantQfrency,
        formantTimbre,
        sid: singleFile || selectedModels.length > 1 ? 0 : sid,
      });
      setJobId(id);
    } catch (err) {
      setError(errMsg(err) || t("Submit failed"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  const disabledReason =
    busy || active
      ? t("Wait for the current conversion to finish.")
      : !conversion.loaded
        ? t("Loading model settings…")
        : !selectedModels.length
          ? t("Select a voice model.")
          : !inputPath.trim() && !inputFolder.trim()
            ? t("Provide an input folder or a single audio file.")
            : !sourceFiles || !selectedFileCount
              ? t("Review and select audio files before converting.")
              : "";

  return (
    <form onSubmit={onSubmit} className="card-stack">
      <ModelPresetStatus />
      {/* 1. Models & Audio Source Card */}
      <Card>
        <CardHeader
          icon={<Layers size={18} className="text-white" />}
          title={t("Batch Source & Voice Model")}
          description={t(
            "Choose one model for many files, many models for one file, or many models for many files.",
          )}
          action={
            selectedModels.length && selectedFileCount ? (
              <Badge variant="success" size="sm" dot>
                {t("Ready")}
              </Badge>
            ) : undefined
          }
        />
        <fieldset className="space-y-2 m-0 p-0 border-0 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <legend className="text-xs font-medium text-neutral-300 p-0">{t("Voice models")}</legend>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ghost-link"
                onClick={() =>
                  setSelectedModels((current) => Array.from(new Set([...current, ...filteredModels])))
                }
                disabled={!models.length}
              >
                {t(modelQuery.trim() ? "Select matches" : "Select all")}
              </button>
              <button
                type="button"
                className="ghost-link"
                onClick={() => setSelectedModels([])}
                disabled={!selectedModels.length}
              >
                {t("Clear")}
              </button>
            </div>
          </div>
          <input
            id="batch-model-search"
            type="text"
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
            placeholder={t("Search models…")}
            className="w-full text-xs"
            aria-label={t("Search models…")}
          />
          <div className="max-h-80 overflow-y-auto space-y-2 p-1">
            {filteredModels.map((model) => {
              const checked = selectedModels.includes(model);
              return (
                <div key={model} className="rounded-xl border border-white/5 bg-black/20 px-2 py-1.5">
                  <label className="flex items-center gap-3 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedModels((current) =>
                          e.target.checked ? [...current, model] : current.filter((item) => item !== model),
                        )
                      }
                    />
                    <span className="truncate flex-1" title={model}>
                      {fileBasename(model).replace(/\.(pth|onnx)$/i, "")}
                    </span>
                    <Badge variant="neutral" size="sm">
                      {model.toLowerCase().endsWith(".onnx") ? "ONNX" : "PTH"}
                    </Badge>
                  </label>
                  {checked && (
                    <div className="mt-1.5 pl-6">
                      <label htmlFor={`batch-index-${model}`} className="sr-only">
                        {t("Index File")}
                      </label>
                      <CustomSelect
                        id={`batch-index-${model}`}
                        aria-describedby={`batch-index-${model}-help`}
                        value={indexFor(model)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setModelIndexes((prev) => ({ ...prev, [model]: v }));
                        }}
                        className="w-full"
                        options={[
                          { value: "", label: t("None") },
                          ...indexes.map((idx) => ({
                            value: idx,
                            label: fileBasename(idx).replace(/\.index$/i, ""),
                            badge: "INDEX",
                            description: idx,
                          })),
                        ]}
                      />
                      <div className="sr-only">
                        <SettingHelp text={t(SETTING_HELP.index)} controlId={`batch-index-${model}`} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {filteredModels.length === 0 && (
            <p className="text-xs text-neutral-400 m-0">
              {models.length === 0 ? t("No models found.") : t("No models match your search.")}
            </p>
          )}
          <p className="text-xs text-neutral-400 m-0">
            {t(
              "Each model uses its matching index unless you pick another, and writes to its own output folder.",
            )}
          </p>
        </fieldset>
        <div className="mt-4">
          <SegmentedControl
            value={sourceMode}
            onChange={setSourceMode}
            ariaLabel={t("Audio source")}
            options={[
              { value: "folder", label: t("Input Folder") },
              { value: "file", label: t("Single file") },
            ]}
          />
        </div>
        <div className="mt-3">
          {sourceMode === "folder" ? (
            <div>
              <label htmlFor="batch-input-folder" className="text-xs font-medium text-neutral-300">
                {t("Input Folder")}
              </label>
              <input
                id="batch-input-folder"
                type="text"
                value={inputFolder}
                onChange={(e) => setInputFolder(e.target.value)}
                className="w-full mt-1 text-xs"
                aria-describedby={`${"batch-input-folder"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.batchInput)} controlId={"batch-input-folder"} />
              {canBrowse && (
                <Button size="xs" variant="ghost" onClick={() => chooseFolder("input")} className="mt-2">
                  {t("Browse")}
                </Button>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="batch-input-file" className="text-xs font-medium text-neutral-300">
                {t("Single file")}
              </label>
              <input
                id="batch-input-file"
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                className="w-full mt-1 text-xs"
              />
            </div>
          )}
        </div>
        <p className="field-help m-0 break-words">
          {t("Output Folder")}: <span className="text-[var(--text)]">{outputFolder}</span>
        </p>
        <div className="mt-4 space-y-3">
          <Button
            size="sm"
            variant="ghost"
            loading={scanning}
            disabled={active || !(sourceMode === "file" ? inputPath.trim() : inputFolder.trim())}
            onClick={reviewFiles}
          >
            {t("Review audio files")}
          </Button>
          {sourceError && <Alert variant="error">{sourceError}</Alert>}
          {!sourceFiles && !sourceError && (
            <p className="field-help m-0">{t("Review and select audio files before converting.")}</p>
          )}
          {sourceFiles && (
            <div className="space-y-2">
              <div className="flex justify-between items-center gap-2">
                <p className="field-help m-0" role="status">
                  {t("{n} files selected", { n: selectedFileCount })}
                </p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setExcludedFiles(excludedFiles.length ? [] : sourceFiles.map((file) => file.name))
                  }
                >
                  {t(excludedFiles.length ? "Select all" : "Clear")}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] p-2 space-y-1">
                {sourceFiles.map((file) => (
                  <label
                    key={file.name}
                    className="flex items-center gap-3 p-2 text-xs min-h-10 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!excludedFiles.includes(file.name)}
                      onChange={(event) =>
                        setExcludedFiles((current) =>
                          event.target.checked
                            ? current.filter((name) => name !== file.name)
                            : [...current, file.name],
                        )
                      }
                    />
                    <span className="flex-1 min-w-0 break-all">{file.name}</span>
                    <span className="text-[var(--muted)] shrink-0">
                      {(file.bytes / 1048576).toFixed(1)} MB
                    </span>
                  </label>
                ))}
                {!sourceFiles.length && (
                  <p className="field-help p-2 m-0">{t("No supported audio files found")}</p>
                )}
              </div>
            </div>
          )}
        </div>
        {selectedModels.length > 0 && (
          <p className="text-xs text-neutral-300 m-0 mt-3" role="status">
            {t("Conversions: {n}", { n: selectedModels.length * selectedFileCount })}
          </p>
        )}
      </Card>

      <ConversionParameters
        idPrefix="batch"
        simplified
        additionalControls={
          <div className="space-y-4">
            {" "}
            <div className="mt-3">
              <label htmlFor="batch-output-folder" className="text-xs font-medium text-neutral-300">
                {t("Output Folder")}
              </label>
              <input
                id="batch-output-folder"
                type="text"
                value={outputFolder}
                onChange={(e) => setOutputFolder(e.target.value)}
                className="w-full mt-1 text-xs"
                aria-describedby={`${"batch-output-folder"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.batchOutput)} controlId={"batch-output-folder"} />
              {canBrowse && (
                <Button size="xs" variant="ghost" onClick={() => chooseFolder("output")} className="mt-2">
                  {t("Browse")}
                </Button>
              )}
            </div>
            <ToggleField
              id="batch-continue-on-error"
              checked={continueOnError}
              onChange={setContinueOnError}
              label={t("Continue after a failed file")}
            />
          </div>
        }
        onReset={paramsReset}
        values={paramsValues}
        setters={paramsSetters}
        targetSelect={
          selectedModels.length > 1 ? (
            <>
              <label htmlFor="batch-editing-target" className="sr-only">
                {t("Editing target")}
              </label>
              <CustomSelect
                id="batch-editing-target"
                value={editingTarget}
                onChange={(e) => setEditingTarget(e.target.value)}
                size="sm"
                description={t("Edit global defaults or one model's own settings.")}
              >
                <option value="global">{t("Global")}</option>
                {selectedModels.map((model) => (
                  <option key={model} value={model}>
                    {fileBasename(model)}
                  </option>
                ))}
              </CustomSelect>
            </>
          ) : undefined
        }
      />

      {/* 3. Action & Batch Output Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={Boolean(disabledReason)}
              aria-describedby={disabledReason ? "batch-convert-help" : undefined}
              icon={<Wand2 size={16} />}
            >
              {busy ? t("Converting Batch…") : t("Convert Batch")}
            </Button>

            {job && (job.status === "running" || job.status === "queued") && (
              <Button
                variant="danger"
                onClick={() => stopJob(job.id).catch((e) => setError(errMsg(e)))}
                icon={<StopCircle size={13} />}
              >
                {t("Cancel")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {job && (
              <Badge
                variant={
                  job.status === "done"
                    ? batchResult?.failed
                      ? "warning"
                      : "success"
                    : job.status === "error"
                      ? "danger"
                      : "info"
                }
                dot
              >
                {job.status === "done"
                  ? t(batchResult?.failed ? "Completed with errors" : "Completed")
                  : job.status === "running"
                    ? t("In Progress")
                    : job.status === "error"
                      ? t("Failed")
                      : t("Queued")}
              </Badge>
            )}
          </div>
        </div>

        {disabledReason && (
          <p id="batch-convert-help" className="field-help m-0" role="status" aria-live="polite">
            {disabledReason}
          </p>
        )}

        {/* Running State Live Progress Bar */}
        {job && (job.status === "running" || job.status === "queued") && (
          <div
            className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-3 animate-in fade-in duration-200"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="font-medium">{t("Batch Conversion in Progress…")}</span>
              <span className="text-[var(--muted)]">
                {t(job.status === "queued" ? "Queued" : "In Progress")}
              </span>
            </div>
            <ProgressBar
              progress={job.status === "running" ? job.progress : undefined}
              label={t("Batch Conversion in Progress…")}
              activity={<JobStage job={job} />}
            />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[11px] text-neutral-400 pt-1 break-all">
              <span>
                {t("Input:")} {String(job.params?.inputPath || job.params?.inputFolder || "")}
              </span>
              <span>
                {t("Output:")} {batchResult?.outputFolder || String(job.params?.outputFolder || "")}
              </span>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="error" className="animate-in fade-in duration-200">
            {error}
          </Alert>
        )}

        {job && job.status === "error" && !error && (
          <JobError
            message={job.error || t("Batch conversion failed.")}
            details={job.errorDetails}
            logs={job.logs}
            jobId={job.id}
            className="animate-in fade-in duration-200"
          />
        )}

        {job && job.status === "done" && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white m-0">{t("Batch Conversion Complete")}</h3>
                <p className="text-xs text-neutral-400 m-0 mt-0.5">
                  {batchResult?.failed
                    ? t("Completed with errors")
                    : t("All selected files and voice models have been processed.")}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-xs text-neutral-400 block">{t("Saved Output Directory")}</span>
              <span className="text-xs text-neutral-200 font-medium select-all block break-all">
                {batchResult?.outputFolder || String(job.params?.outputFolder || outputFolder)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1 flex-wrap">
              <Link
                href={`/inference?model=${encodeURIComponent(String(job.params?.pthPath || ""))}`}
                className="cta h-9 px-4 rounded-xl text-xs font-medium flex items-center gap-1.5"
              >
                <span>{t("Test in Single Inference")}</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}
        {job && <BatchResults key={job.id} job={job} />}
      </Card>
    </form>
  );
}
