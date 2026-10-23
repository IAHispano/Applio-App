"use client";

import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Alert, Button, CustomSelect, Disclosure, FileInput, FormField } from "@/components/ui";
import { apiGet, errMsg, postForm } from "@/lib/api";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

export function ttsModelName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const parent = parts.at(-2) || "";
  const folder = /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(parent) ? parts.at(-3) : parent;
  return (folder || parts.at(-1) || "")
    .replace(/-[a-f0-9]{8}-[a-f0-9-]{27,}$/i, "")
    .replace(/\.pt$/i, "")
    .replace(/[_-]+/g, " ");
}

export function TtsModelSelect({
  id,
  value,
  models,
  onChange,
  disabled = false,
  required = false,
  label = "TTS model",
  showTrainingLink = false,
}: {
  id: string;
  value: string;
  models: string[];
  onChange: (path: string) => void;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  showTrainingLink?: boolean;
}) {
  const { t } = useI18n();
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const options = [...new Set([...(discovered ?? models), ...(value ? [value] : [])])];
  const refresh = () =>
    apiGet<{ frontends: string[] }>("/api/tts/frontends")
      .then(({ frontends }) => {
        setDiscovered(frontends);
        setError("");
      })
      .catch((error) => setError(errMsg(error)));
  return (
    <FormField label={t(label)} htmlFor={id} required={required}>
      <CustomSelect
        id={id}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        required={required}
        onOpen={refresh}
        placeholder={t("Select a TTS model.")}
        options={options.map((path) => ({ value: path, label: ttsModelName(path) }))}
      />
      <Disclosure title={t("Manage TTS models")} icon={<FolderOpen size={15} />}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={refresh}
            disabled={disabled}
          >
            {t("Refresh")}
          </Button>
          {value && <TtsModelDownload frontend={value} />}
          {showTrainingLink && (
            <Button href="/train?mode=text" variant="ghost" size="sm" icon={<Plus size={14} />}>
              {t("Enable TTS for a voice")}
            </Button>
          )}
        </div>
        <TtsModelImport
          disabled={disabled}
          onImport={(path) => {
            setDiscovered((current) => [...new Set([...(current ?? models), path])]);
            onChange(path);
          }}
        />
      </Disclosure>
      {!options.length && (
        <p className="field-help m-0">{t("Import a pretrained TTS model to get started.")}</p>
      )}
      {error && <Alert variant="error">{error}</Alert>}
    </FormField>
  );
}

export function TtsModelImport({
  disabled = false,
  onImport,
}: {
  disabled?: boolean;
  onImport: (path: string) => void;
}) {
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File | null) {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await postForm<{ frontend: string }>("/api/tts/frontends", body);
      onImport(result.frontend);
    } catch (error) {
      setError(t(errMsg(error)));
    } finally {
      setUploading(false);
    }
  }
  if (remote) return null;
  return (
    <div className="space-y-2">
      <FileInput
        accept=".pt"
        disabled={disabled || uploading}
        buttonText={uploading ? t("Uploading…") : t("Upload model file")}
        ariaLabel={`${t("Upload")}: ${t("TTS model")}`}
        onFileSelect={upload}
      />
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}

export function TtsModelDownload({ frontend }: { frontend: string }) {
  const { t } = useI18n();
  const { remote } = useRemoteBridge();
  if (remote || !frontend) return null;
  const href = `/api/train/export-file?file=${encodeURIComponent(frontend)}`;
  return (
    <Button href={href} download="frontend.pt" variant="ghost" size="sm">
      {t("Download")}: {t("TTS model")}
    </Button>
  );
}
