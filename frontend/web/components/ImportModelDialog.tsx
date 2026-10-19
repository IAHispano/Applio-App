"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, CustomSelect, Dialog } from "@/components/ui";
import type { CustomSelectOption } from "@/components/ui/CustomSelect";
import FileInput from "@/components/ui/FileInput";
import ProgressBar from "@/components/ui/ProgressBar";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { apiGet, errMsg, postForm } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";

type Architecture = "roformer" | "mdxc" | "demucs";
type Source = "link" | "files";

/** Sentinel for a user-entered variant key; never collides with registry keys. */
const CUSTOM_VARIANT = "__custom__";

// Product names stay untranslated; variant keys are stable enum values.
const ARCH_LABELS: Record<Architecture, string> = {
  roformer: "Roformer",
  mdxc: "MDX23C",
  demucs: "Demucs",
};

interface ImportModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the weight filename once the import job completes. */
  onImported: (filename: string) => void;
}

export default function ImportModelDialog({ isOpen, onClose, onImported }: ImportModelDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [architecture, setArchitecture] = useState<Architecture>("roformer");
  const [source, setSource] = useState<Source>("link");
  const [variant, setVariant] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [variants, setVariants] = useState<CustomSelectOption[] | null>(null);
  const [official, setOfficial] = useState<string[]>([]);
  const [weightLink, setWeightLink] = useState("");
  const [configLink, setConfigLink] = useState("");
  const [weightFile, setWeightFile] = useState<File | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const { job, stop } = useJob(importJobId);

  useEffect(() => {
    if (!isOpen || architecture !== "roformer" || variants) return;
    let cancelled = false;
    apiGet<{ variants: string[]; official?: string[] }>("/api/uvr/variants")
      .then((data) => {
        if (cancelled) return;
        // Official (MSST-native) families first; the rest keeps registry order.
        setVariants(
          [
            ...(data.official ?? []),
            ...data.variants.filter((value) => !(data.official ?? []).includes(value)),
          ].map((value) => ({ value, label: value })),
        );
        setOfficial(data.official ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, architecture, variants]);

  const reset = useCallback(() => {
    setName("");
    setArchitecture("roformer");
    setSource("link");
    setVariant("");
    setCustomKey("");
    setVariants(null);
    setWeightLink("");
    setConfigLink("");
    setWeightFile(null);
    setConfigFile(null);
    setError("");
    setBusy(false);
    setImportJobId(null);
  }, []);

  // Reopening starts the form from scratch; closing while a job runs is not
  // possible, so no state is lost.
  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  const running = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!job || running) return;
    if (job.status === "done") {
      const filename = (job.result?.filename as string | undefined) ?? "";
      setImportJobId(null);
      reset();
      onImported(filename);
    } else {
      setError(job.error || t("Import failed."));
      setImportJobId(null);
    }
  }, [job, running, onImported, t, reset]);

  const submit = async () => {
    setBusy(true);
    setImportJobId(null);
    setError("");
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("architecture", architecture);
      if (architecture === "roformer") {
        fd.append("variant", variant === CUSTOM_VARIANT ? customKey.trim() : variant);
      }
      if (source === "link") {
        fd.append("weightLink", weightLink.trim());
        fd.append("configLink", configLink.trim());
      } else {
        if (weightFile) fd.append("weightFile", weightFile);
        if (configFile) fd.append("configFile", configFile);
      }
      const { jobId } = await postForm<{ jobId: string }>("/api/uvr/custom-models", fd);
      setImportJobId(jobId);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={running ? undefined : onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm modal-backdrop"
    >
      <div className="modal-panel w-full max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden min-w-0 bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] rounded-2xl shadow-2xl p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">{t("Import model")}</h2>
          <Button
            size="xs"
            variant="ghost"
            icon={<X size={14} />}
            onClick={running ? stop : onClose}
            disabled={busy && !running}
            aria-label={running ? t("Stop") : t("Cancel")}
          />
        </div>
        {importJobId && (!job || running) ? (
          <div className="space-y-2">
            <ProgressBar progress={Number(job?.progress ?? 0)} label={t("Importing…")} showValue={false} />
            <p className="text-xs text-white/50">
              {t("Once imported, the model is saved into data/rvc/models/uvr.")}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-white/60">
              {t("Add a custom model to the catalog with a download link or your own files.")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="import-model-name">{t("Model Name")}</label>
                <input
                  id="import-model-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("e.g. vocal-model")}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <span>{t("Architecture")}</span>
                <CustomSelect
                  aria-label={t("Architecture")}
                  value={architecture}
                  onValueChange={(value) => {
                    setArchitecture(value as Architecture);
                    setError("");
                  }}
                  options={(["roformer", "mdxc", "demucs"] as const).map((value) => ({
                    value,
                    label: ARCH_LABELS[value],
                  }))}
                  searchable={false}
                />
              </div>
            </div>

            {architecture === "roformer" && (
              <div className="space-y-1.5">
                <span>{t("Variant")}</span>
                <CustomSelect
                  aria-label={t("Variant")}
                  value={variant}
                  onValueChange={setVariant}
                  options={[
                    ...(variants ?? []).map((option) => ({
                      ...option,
                      badge: official.includes(option.value) ? t("Official") : t("Community"),
                    })),
                    { value: CUSTOM_VARIANT, label: t("Custom…") },
                  ]}
                  disabled={!variants?.length}
                  searchable={false}
                />
                {variant === CUSTOM_VARIANT && (
                  <>
                    <input
                      type="text"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      aria-label={t("Variant")}
                      autoComplete="off"
                    />
                    <p className="text-xs text-white/50">
                      {t(
                        "Save the architecture .py in data/rvc/models/uvr/custom_architectures/ — the file name without .py is the variant key to enter (e.g. my_arch.py).",
                      )}
                    </p>
                  </>
                )}
              </div>
            )}

            <SegmentedControl
              value={source}
              ariaLabel={t("Import model")}
              onChange={setSource}
              options={[
                { value: "link" as Source, label: t("From link") },
                { value: "files" as Source, label: t("My files") },
              ]}
            />

            {source === "link" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="import-weight-link">{t("Model file")}</label>
                  <input
                    id="import-weight-link"
                    type="text"
                    value={weightLink}
                    onChange={(e) => setWeightLink(e.target.value)}
                    placeholder={t("Paste a direct model file link.")}
                    autoComplete="off"
                    inputMode="url"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="import-config-link">{t("Config file (.yaml)")}</label>
                  <input
                    id="import-config-link"
                    type="text"
                    value={configLink}
                    onChange={(e) => setConfigLink(e.target.value)}
                    placeholder={t("Paste the model config (.yaml) link.")}
                    autoComplete="off"
                    inputMode="url"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span>{t("Model file")}</span>
                  <FileInput
                    ariaLabel={t("Model file")}
                    accept=".pth,.onnx,.ckpt,.th,.pt"
                    onFileSelect={setWeightFile}
                  />
                </div>
                <div className="space-y-1.5">
                  <span>{t("Config file (.yaml)")}</span>
                  <FileInput
                    ariaLabel={t("Config file (.yaml)")}
                    accept=".yaml,.yml"
                    onFileSelect={setConfigFile}
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-white/50">
              {t("Each model lives in its own folder inside data/rvc/models/uvr.")}
            </p>
            <p className="text-xs text-white/50">
              {t(
                "VR and MDX weights are hash-verified against the official catalogs, so custom files only work for Roformer, MDX23C and Demucs.",
              )}
            </p>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!running && (
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              icon={<Plus size={14} />}
              disabled={
                busy ||
                !name.trim() ||
                (architecture === "roformer" &&
                  (!variant || (variant === CUSTOM_VARIANT && !customKey.trim()))) ||
                (source === "link" ? !weightLink.trim() || !configLink.trim() : !weightFile || !configFile)
              }
            >
              {busy ? t("Importing…") : t("Import model")}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
