"use client";

import { Loader2, Music, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ModelPresetStatus from "@/components/ModelPresetStatus";
import type { ModelMetadata } from "@/components/models/ModelInfoCard";
import { Alert, Badge, Card, CardHeader, VoiceModelField } from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import IconButton from "@/components/ui/IconButton";
import type { VoiceModelFieldProps } from "@/components/ui/VoiceModelField";
import { apiGet, cachedModelInspection, errMsg, fileBasename, inspectModel } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { loadModelPresets } from "@/lib/model-presets";
import { SETTING_HELP } from "@/lib/setting-help";

interface ModelDetail {
  pthPath: string;
  pthSize: number;
  indexSize: number | null;
  modifiedAt: string;
  folder: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface VoiceModelCardProps extends Omit<VoiceModelFieldProps, "compact" | "label" | "indexLabel"> {
  speakers: number[];
  sid: number;
  onSpeakerChange: (sid: number) => void;
  className?: string;
  step?: number;
  onMetadata?: (metadata: ModelMetadata) => void;
}

export default function VoiceModelCard({
  models,
  selectedModel: pthPath,
  indexes,
  indexPath,
  indexSelectId,
  onSelect: handleModelSelect,
  onUnload: handleUnloadModel,
  onRefresh,
  onOpen,
  onIndexChange: setIndexPath,
  speakers,
  sid,
  onSpeakerChange: setSid,
  className = "",
  step,
  onMetadata,
}: VoiceModelCardProps) {
  const { t } = useI18n();
  const [library, setLibrary] = useState<ModelDetail[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [inspectMeta, setInspectMeta] = useState<ModelMetadata | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const metadataCallback = useRef(onMetadata);
  useEffect(() => {
    metadataCallback.current = onMetadata;
  }, [onMetadata]);
  const refreshModels = () => {
    onRefresh();
    setRefreshVersion((previous) => previous + 1);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload filesystem metadata when the model changes or the user refreshes
  useEffect(() => {
    let active = true;
    apiGet<{ models: ModelDetail[] }>("/api/models/library", { force: refreshVersion > 0 })
      .then((result) => {
        if (active) setLibrary(result.models || []);
      })
      .catch(() => {
        if (active) setLibrary([]);
      });
    return () => {
      active = false;
    };
  }, [pthPath, refreshVersion]);
  const selectedMeta = useMemo(
    () => library.find((model) => model.pthPath === pthPath) ?? null,
    [library, pthPath],
  );
  // Extract model information when checkpoint is loaded
  useEffect(() => {
    if (!pthPath) {
      setInspectMeta(null);
      setInspectLoading(false);
      setInspectError("");
      return;
    }

    let cancelled = false;
    // Clear previous model's details immediately so stale arch info never
    // lingers while the new checkpoint inspects (skeletons show instead).
    const cached = cachedModelInspection<{ metadata: ModelMetadata }>(pthPath);
    setInspectMeta(cached?.metadata ?? null);
    setInspectLoading(!cached);
    setInspectError("");

    inspectModel<{ ok: boolean; metadata: ModelMetadata }>(pthPath, refreshVersion > 0)
      .then(async (res) => {
        await loadModelPresets();
        if (cancelled) return;
        if (res?.metadata) {
          setInspectMeta(res.metadata);
          metadataCallback.current?.(res.metadata);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setInspectError(errMsg(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInspectLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pthPath, refreshVersion]);

  return (
    <Card className={`flex flex-col ${className}`}>
      <CardHeader
        step={step}
        icon={<Music size={18} className="text-white" />}
        title={t("Voice Model")}
        action={
          <div className="flex items-center gap-2">
            {pthPath && (
              <Badge variant="success" size="sm" dot>
                {t("Ready")}
              </Badge>
            )}
            <IconButton icon={<RefreshCw size={14} />} label={t("Refresh")} onClick={refreshModels} />
          </div>
        }
      />

      {/* Shared voice model picker (dropdown + linked index) */}
      <VoiceModelField
        models={models}
        selectedModel={pthPath}
        indexes={indexes}
        indexPath={indexPath}
        indexSelectId={indexSelectId}
        compact
        onSelect={handleModelSelect}
        onUnload={handleUnloadModel}
        onRefresh={refreshModels}
        onOpen={onOpen}
        onIndexChange={setIndexPath}
      />
      <ModelPresetStatus />
      {/* Enriched Model Metadata with deep inspection extraction */}
      {pthPath && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-400 px-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-neutral-300">{t("Model Architecture")}</span>
              {inspectLoading && (
                <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                  <Loader2 size={11} className="animate-spin text-neutral-300" />
                  <span>{t("Extracting info…")}</span>
                </span>
              )}
              {inspectMeta?.version && inspectMeta.version !== "None" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white font-sans uppercase border border-white/10">
                  {inspectMeta.version}
                </span>
              )}
            </div>
            {inspectMeta?.author && inspectMeta.author !== "None" && (
              <span className="text-[11px] text-neutral-300 truncate max-w-[150px]">
                {t("by")} <strong className="text-white font-medium">{inspectMeta.author}</strong>
              </span>
            )}
          </div>

          {inspectError && !inspectLoading && <Alert variant="warning">{inspectError}</Alert>}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-neutral-400 bg-black/30 p-2.5 rounded-xl border border-white/5 [&>div]:min-w-0">
            <div>
              <dt>{t("Weights")}</dt>
              <dd className="text-white font-medium">
                {selectedMeta?.pthSize ? humanSize(selectedMeta.pthSize) : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Index")}</dt>
              <dd className="text-white font-medium">
                {selectedMeta?.indexSize
                  ? humanSize(selectedMeta.indexSize)
                  : indexPath
                    ? fileBasename(indexPath)
                    : "—"}
              </dd>
            </div>
            {(
              [
                { label: t("Epochs"), value: inspectMeta?.epochs },
                { label: t("Training Steps"), value: inspectMeta?.step, numeric: true },
                { label: t("Sample Rate"), value: inspectMeta?.sr, sampleRate: true },
                { label: t("Pitch extraction algorithm"), value: inspectMeta?.f0, pitch: true },
                { label: t("Embedder Model"), value: inspectMeta?.embedder_model, truncate: true },
              ] as Array<{
                label: string;
                value?: string;
                numeric?: boolean;
                sampleRate?: boolean;
                pitch?: boolean;
                truncate?: boolean;
              }>
            ).map((row) => {
              const value = row.value ?? "";
              const missing =
                value === "" || value === "None" || (row.numeric && Number.isNaN(Number(value)));
              return (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className="text-white font-medium">
                    {inspectLoading ? (
                      <span
                        aria-hidden="true"
                        className="block h-3.5 w-20 rounded bg-white/10 animate-pulse"
                      />
                    ) : missing ? (
                      "—"
                    ) : row.numeric ? (
                      Number(value).toLocaleString()
                    ) : row.sampleRate ? (
                      value.endsWith("k") ? (
                        `${value}Hz`
                      ) : (
                        `${Number(value) / 1000} kHz`
                      )
                    ) : row.pitch ? (
                      value === "1" || value === "True" || value === "true" ? (
                        t("Yes")
                      ) : (
                        t("No (pitchless)")
                      )
                    ) : row.truncate ? (
                      <span className="block truncate" title={value}>
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>{t("Speakers")}</dt>
              <dd className="text-white font-medium">
                {speakers.length > 0 ? speakers.length : inspectMeta?.speakers_id || 1}
              </dd>
            </div>
            {selectedMeta?.folder && (
              <div>
                <dt>{t("Folder")}</dt>
                <dd className="text-white font-medium truncate" title={selectedMeta.folder}>
                  {selectedMeta.folder}
                </dd>
              </div>
            )}
            {selectedMeta?.modifiedAt && (
              <div>
                <dt>{t("Modified")}</dt>
                <dd className="text-white font-medium">
                  {new Date(selectedMeta.modifiedAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Empty state: the card is as tall as the audio one, so use the
                room to say where models come from instead of leaving a void. */}
      {!pthPath && (
        <div className="flex flex-col items-center justify-center text-center gap-3 flex-1 py-6">
          <Music size={26} className="text-neutral-600" />
          <p className="text-xs text-neutral-400 m-0 max-w-[240px] leading-relaxed">
            {models.length === 0
              ? t("No models found in logs/. Download one or train your own to get started.")
              : t("Pick a voice model above — its index file is paired automatically.")}
          </p>
          {models.length === 0 && (
            <Link href="/models" className="ghost-link">
              {t("Go to Download")}
            </Link>
          )}
        </div>
      )}

      {/* Multi-speaker ID selector */}
      {speakers.length > 1 && (
        <div>
          <label htmlFor={`${indexSelectId}-speaker`} className="text-xs font-medium text-neutral-300">
            {t("Speaker ID (Multi-Speaker Model)")}
          </label>
          <CustomSelect
            id={`${indexSelectId}-speaker`}
            value={String(sid)}
            onChange={(e) => setSid(Number(e.target.value))}
            className="w-full mt-1"
            description={t(SETTING_HELP.speaker)}
          >
            {speakers.map((s) => (
              <option key={s} value={String(s)}>
                {t("Speaker")} {s}
              </option>
            ))}
          </CustomSelect>
        </div>
      )}
    </Card>
  );
}
