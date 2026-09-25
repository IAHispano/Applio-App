"use client";

import { ArrowRight, Calendar, Check, Copy, FileCheck, Hash, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, StatTile } from "@/components/ui";
import { fileBasename } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/lib/toast";

export interface ModelMetadata {
  model_name?: string;
  author?: string;
  epochs?: string;
  step?: string;
  sr?: string;
  f0?: string;
  vocoder?: string;
  embedder_model?: string;
  creation_date?: string;
  model_hash?: string;
  dataset_length?: string;
  speakers_id?: string | number;
  version?: string;
}

interface ModelInfoCardProps {
  metadata: ModelMetadata | null;
  loading?: boolean;
  error?: string;
  pthPath?: string;
  onClose?: () => void;
  onUseInInference?: () => void;
}

export default function ModelInfoCard({
  metadata,
  loading = false,
  error = "",
  pthPath = "",
  onClose,
  onUseInInference,
}: ModelInfoCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  if (!loading && !error && !metadata) return null;

  function copyHash(hashText: string) {
    if (!hashText) return;
    navigator.clipboard.writeText(hashText);
    setCopied(true);
    toast(t("Model hash copied to clipboard"));
    setTimeout(() => setCopied(false), 2000);
  }

  function handleUseInInference() {
    if (onUseInInference) {
      onUseInInference();
      return;
    }
    const path = pthPath || metadata?.model_name || "";
    if (path) {
      router.push(`/inference?model=${encodeURIComponent(path)}`);
    }
  }

  return (
    <section
      className="card space-y-5 animate-in fade-in duration-200"
      aria-label={t("Model Checkpoint Details")}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
            <FileCheck size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-white m-0 truncate">
                {metadata?.model_name && metadata.model_name !== "None"
                  ? metadata.model_name
                  : pthPath
                    ? fileBasename(pthPath).replace(/\.(pth|onnx)$/i, "")
                    : t("Model Checkpoint")}
              </h3>
              {metadata && (
                <Badge variant="success" size="sm" dot>
                  {t("Valid Checkpoint")}
                </Badge>
              )}
              {metadata?.version && metadata.version !== "None" && (
                <Badge variant="neutral" size="sm">
                  {metadata.version}
                </Badge>
              )}
              {loading && !metadata && (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-5 w-28 rounded-full bg-white/10 animate-pulse"
                  />
                  <span
                    aria-hidden="true"
                    className="inline-block h-5 w-14 rounded-full bg-white/10 animate-pulse"
                  />
                </>
              )}
            </div>
            <p className="text-xs text-neutral-400 m-0 mt-0.5 truncate">
              {pthPath ? pthPath : t("Checkpoint architecture metadata")}
            </p>
          </div>
        </div>
      </div>

      {/* Loading skeleton mirrors the loaded layout so content pops in place */}
      {loading && (
        <div className="space-y-4" role="status" aria-label={t("Loading model details")}>
          <div className="flex items-center gap-3 flex-wrap" aria-hidden="true">
            <div className="h-7 w-44 rounded-lg bg-white/5 border border-white/5 animate-pulse" />
            <div className="h-7 w-32 rounded-lg bg-white/5 border border-white/5 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-hidden="true">
            {["epochs", "steps", "sample-rate", "pitch", "vocoder", "embedder", "slices", "speakers"].map(
              (key) => (
                <div key={key} className="rounded-xl bg-black/30 border border-white/5 px-3 py-2 space-y-2">
                  <div className="h-2.5 w-16 rounded bg-white/10 animate-pulse" />
                  <div className="h-3.5 w-24 rounded bg-white/10 animate-pulse" />
                </div>
              ),
            )}
          </div>
          <div
            className="h-12 rounded-xl bg-black/40 border border-white/5 animate-pulse"
            aria-hidden="true"
          />
          <p className="text-xs text-neutral-400 font-medium text-center m-0">
            {t("Inspecting checkpoint weights and architecture…")}
          </p>
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}

      {/* Loaded metadata */}
      {!loading && !error && metadata && (
        <>
          {/* Top summary row */}
          <div className="flex items-center gap-3 text-xs text-neutral-400 flex-wrap">
            <span className="flex items-center gap-1.5 bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg">
              <User size={13} className="text-white shrink-0" />
              <strong className="text-white font-medium">
                {metadata.author && metadata.author !== "None" ? metadata.author : t("Unknown Creator")}
              </strong>
            </span>
            {metadata.creation_date && metadata.creation_date !== "None" && (
              <span className="flex items-center gap-1.5 bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg">
                <Calendar size={13} className="text-white shrink-0" />
                <span>{metadata.creation_date}</span>
              </span>
            )}
          </div>

          {/* Stat cards grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <StatTile
              label={t("Epochs")}
              value={metadata.epochs && metadata.epochs !== "None" ? metadata.epochs : "—"}
            />
            <StatTile
              label={t("Training Steps")}
              value={metadata.step && metadata.step !== "None" ? Number(metadata.step).toLocaleString() : "—"}
            />
            <StatTile
              label={t("Sample Rate")}
              value={metadata.sr && metadata.sr !== "None" ? `${Number(metadata.sr) / 1000} kHz` : "—"}
            />
            <StatTile
              label={t("Pitch Guidance (F0)")}
              value={
                metadata.f0 === "1" || metadata.f0 === "True" || metadata.f0 === "true"
                  ? t("Yes")
                  : metadata.f0 === "0" || metadata.f0 === "False" || metadata.f0 === "false"
                    ? t("No")
                    : metadata.f0 || "—"
              }
            />
            <StatTile
              label={t("Vocoder")}
              value={metadata.vocoder && metadata.vocoder !== "None" ? metadata.vocoder : "HiFi-GAN"}
            />
            <StatTile
              label={t("Feature Embedder")}
              value={
                metadata.embedder_model && metadata.embedder_model !== "None"
                  ? metadata.embedder_model
                  : "contentvec"
              }
            />
            <StatTile
              label={t("Dataset Slices")}
              value={
                metadata.dataset_length && metadata.dataset_length !== "None" ? metadata.dataset_length : "—"
              }
            />
            <StatTile
              label={t("Speakers ID")}
              value={metadata.speakers_id !== undefined ? String(metadata.speakers_id) : "0"}
            />
          </div>

          {/* Model Hash pill */}
          {metadata.model_hash && metadata.model_hash !== "None" && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Hash size={15} className="text-white shrink-0" />
                <span className="text-xs text-neutral-400 shrink-0">{t("SHA Hash:")}</span>
                <span className="text-xs text-neutral-200 font-medium truncate select-all">
                  {metadata.model_hash}
                </span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => copyHash(metadata.model_hash || "")}
                aria-label={t("Copy model hash")}
                icon={copied ? <Check size={13} className="text-white" /> : <Copy size={13} />}
              >
                {copied ? t("Copied") : t("Copy")}
              </Button>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/5">
            {onClose && (
              <Button variant="ghost" onClick={onClose}>
                {t("Close")}
              </Button>
            )}
            <Button onClick={handleUseInInference} iconAfter={<ArrowRight size={15} />}>
              {t("Use in Inference")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
