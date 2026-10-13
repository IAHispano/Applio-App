"use client";

import { Check, Upload } from "lucide-react";
import { useId, useState } from "react";
import { Alert, Button, Disclosure, FileInput, FormField } from "@/components/ui";
import { errMsg } from "@/lib/api";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

type UploadKind = "dataset" | "pretrained" | "embedder";

export default function TrainingUpload({
  kind,
  label,
  initialName = "",
  disabled = false,
  onUploaded,
  onBusyChange,
}: {
  kind: UploadKind;
  label?: string;
  initialName?: string;
  disabled?: boolean;
  onUploaded: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [files, setFiles] = useState<FileList | null>(null);
  const [config, setConfig] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const [selectionKey, setSelectionKey] = useState(0);
  const title =
    label ||
    t(
      kind === "dataset"
        ? "Dataset audio files (WAV/MP3/FLAC)"
        : kind === "embedder"
          ? "Custom Embedder (.bin + .json)"
          : "Custom pretrained weights (.pth)",
    );
  const ready = Boolean(
    files?.length && (kind === "pretrained" || name.trim()) && (kind !== "embedder" || config),
  );

  async function upload() {
    if (busy || disabled || !ready) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setUploaded(false);
    const body = new FormData();
    if (kind !== "pretrained") body.append(kind === "dataset" ? "datasetName" : "folderName", name.trim());
    for (const file of Array.from(files || []))
      body.append(kind === "dataset" ? "files" : kind === "embedder" ? "bin" : "file", file);
    if (config) body.append("config", config);
    try {
      const response = await fetch(`/api/train/upload-${kind}`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || t("Upload failed."));
      const path =
        kind === "dataset"
          ? result.dataset
          : kind === "pretrained"
            ? result.file
            : typeof result.folder === "string"
              ? `rvc/models/embedders/embedders_custom/${result.folder}`
              : undefined;
      if (typeof path !== "string" || !path) throw new Error(t("Upload failed."));
      onUploaded(path);
      setUploaded(true);
      setFiles(null);
      setConfig(null);
      setSelectionKey((key) => key + 1);
      setOpen(false);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  if (remote) return null;
  return (
    <div className="min-w-0">
      <Disclosure
        title={`${t("Upload")} · ${title}`}
        icon={<Upload size={15} />}
        open={open}
        onToggle={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <fieldset disabled={busy || disabled} className="border-0 p-0 m-0 min-w-0 space-y-3">
          {kind !== "pretrained" && (
            <FormField
              label={t(kind === "dataset" ? "Dataset name (e.g. my_vocals)" : "Folder Name")}
              htmlFor={`${id}-name`}
              required
            >
              <input
                id={`${id}-name`}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
          )}
          <FormField
            label={kind === "embedder" ? ".bin" : t(kind === "dataset" ? "Audio files" : "Weights")}
            htmlFor={`${id}-files`}
            required
          >
            <FileInput
              key={selectionKey}
              id={`${id}-files`}
              accept={kind === "dataset" ? ".wav,.mp3,.flac" : kind === "embedder" ? ".bin" : ".pth"}
              multiple={kind === "dataset"}
              disabled={busy || disabled}
              onChange={(selected) => {
                setFiles(selected);
                setUploaded(false);
                setError("");
                if (kind === "embedder" && !name && selected?.[0])
                  setName(selected[0].name.replace(/\.[^.]+$/, ""));
              }}
            />
          </FormField>
          {kind === "embedder" && (
            <FormField label=".json" htmlFor={`${id}-config`} required>
              <FileInput
                key={selectionKey}
                id={`${id}-config`}
                accept=".json"
                disabled={busy || disabled}
                onChange={(selected) => setConfig(selected?.[0] || null)}
              />
            </FormField>
          )}
          {error && <Alert variant="error">{error}</Alert>}
          <Button
            size="sm"
            loading={busy}
            disabled={disabled || !ready}
            icon={<Upload size={14} />}
            onClick={() => void upload()}
          >
            {t("Upload")}
          </Button>
        </fieldset>
      </Disclosure>
      {uploaded && (
        <p className="field-help flex items-center gap-1.5" role="status">
          <Check size={14} className="text-[var(--ok)]" />
          {t("Uploaded.")}
        </p>
      )}
    </div>
  );
}
