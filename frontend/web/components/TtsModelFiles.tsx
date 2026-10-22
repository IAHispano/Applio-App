"use client";

import { useState } from "react";
import { Alert, Button, FileInput } from "@/components/ui";
import { errMsg, postForm } from "@/lib/api";
import { useRemoteBridge } from "@/lib/bridge-mode";
import { useI18n } from "@/lib/i18n";

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
