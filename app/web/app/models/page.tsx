"use client";

import {
  ArrowRight,
  Database,
  Download,
  FileCheck,
  FileX,
  Folder,
  Info,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import BlenderPanel from "@/components/models/BlenderPanel";
import DownloadPanel from "@/components/models/DownloadPanel";
import ModelInfoCard, { type ModelMetadata } from "@/components/models/ModelInfoCard";
import { Button, Card, CardHeader, EmptyState, IconButton, Modal, SegmentedControl } from "@/components/ui";
import { apiGet, apiSend, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ModelItem {
  id: string;
  name: string;
  pthPath: string;
  pthSize: number;
  indexPath: string | null;
  indexSize: number | null;
  modifiedAt: string;
  folder: string;
}

type Section = "library" | "download" | "blend" | "inspect";

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export default function ModelsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("library");

  // Library state
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<ModelItem[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Inspect modal state
  const [inspectModal, setInspectModal] = useState<ModelItem | null>(null);
  const [inspectMeta, setInspectMeta] = useState<ModelMetadata | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");

  // Custom path inspect (subtab)
  const [customPth, setCustomPth] = useState("");
  const [customMeta, setCustomMeta] = useState<ModelMetadata | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState("");

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<{ models: ModelItem[] }>("/api/models/library");
      setModels(res.models || []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "library") {
      loadLibrary();
    }
  }, [section, loadLibrary]);

  async function openInspect(item: ModelItem) {
    setInspectModal(item);
    setInspectMeta(null);
    setInspectError("");
    setInspectLoading(true);
    try {
      const res = await apiSend<{ ok: boolean; metadata: ModelMetadata }>("/api/models/inspect", "POST", {
        pthPath: item.pthPath,
      });
      setInspectMeta(res.metadata);
    } catch (e) {
      setInspectError(errMsg(e));
    } finally {
      setInspectLoading(false);
    }
  }

  // One on-disk target per request: models sharing a folder delete together.
  function deleteKey(m: ModelItem): string {
    return m.folder !== "root" ? m.folder : m.name;
  }

  async function confirmDelete() {
    if (deleteTargets.length === 0 || deleting) return;
    setDeleting(true);
    const seen = new Set<string>();
    const queue = deleteTargets.filter((m) => {
      const key = deleteKey(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const failed: string[] = [];
    const deletedKeys = new Set<string>();
    for (const m of queue) {
      const key = deleteKey(m);
      try {
        await apiSend(`/api/models/${encodeURIComponent(key)}`, "DELETE");
        deletedKeys.add(key);
      } catch {
        failed.push(m.name);
      }
    }
    setDeleteTargets([]);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of deleteTargets) {
        if (deletedKeys.has(deleteKey(m))) next.delete(m.id);
      }
      return next;
    });
    setDeleting(false);
    if (failed.length > 0) setError(`${t("Could not delete:")} ${failed.join(", ")}`);
    await loadLibrary();
  }

  function openInInference(item: ModelItem) {
    const url = `/inference?model=${encodeURIComponent(item.pthPath)}${
      item.indexPath ? `&index=${encodeURIComponent(item.indexPath)}` : ""
    }`;
    router.push(url);
  }

  async function inspectCustom() {
    if (!customPth.trim()) {
      setCustomError(t("Please enter or select a .pth model path."));
      return;
    }
    setCustomError("");
    setCustomLoading(true);
    setCustomMeta(null);
    try {
      const res = await apiSend<{ ok: boolean; metadata: ModelMetadata }>("/api/models/inspect", "POST", {
        pthPath: customPth.trim(),
      });
      setCustomMeta(res.metadata);
    } catch (e) {
      setCustomError(errMsg(e));
    } finally {
      setCustomLoading(false);
    }
  }

  const filteredModels = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.folder.toLowerCase().includes(search.toLowerCase()) ||
      m.pthPath.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedCount = selected.size;
  const allFilteredSelected = filteredModels.length > 0 && filteredModels.every((m) => selected.has(m.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const m of filteredModels) next.delete(m.id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const m of filteredModels) next.add(m.id);
        return next;
      });
    }
  }

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
      <PageHeader
        title={t("Voice Models")}
        description={t(
          "Manage your voice model collection, inspect checkpoint metadata, and blend or download weights.",
        )}
      >
        <SegmentedControl
          value={section}
          onChange={setSection}
          ariaLabel={t("Model sections")}
          tabPanels
          options={[
            { value: "library", label: t("Model Library"), icon: Database },
            { value: "download", label: t("Download Models"), icon: Download },
            { value: "blend", label: t("Voice Blender"), icon: Layers },
            { value: "inspect", label: t("Inspect Model"), icon: Info },
          ]}
        />
      </PageHeader>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 p-3 rounded-lg border border-[var(--err)] text-[var(--err)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)]"
        >
          {error}
        </div>
      )}

      {/* 1. MODEL LIBRARY VIEW */}
      {section === "library" && (
        <div id="panel-library" role="tabpanel" aria-labelledby="tab-library" className="space-y-4">
          {/* Controls bar: Search, Refresh, Download CTA */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center w-full sm:flex-1 sm:min-w-0 sm:max-w-md 2xl:max-w-lg px-1">
              <Search
                size={15}
                className="text-neutral-500 shrink-0 mr-2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder={t("Search models by name or folder…")}
                aria-label={t("Search models by name or folder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent border-0 py-2 px-0 text-sm text-white placeholder:text-neutral-600 focus:outline-none w-full"
              />
              {search && (
                <IconButton icon={<X size={14} />} label={t("Clear search")} onClick={() => setSearch("")} />
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none mr-1">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allFilteredSelected && selectedCount > 0;
                  }}
                  onChange={toggleSelectAllFiltered}
                  disabled={filteredModels.length === 0}
                  aria-label={t("Select all models")}
                />
                <span>{t("All")}</span>
              </label>
              <Button
                variant="ghost"
                onClick={loadLibrary}
                disabled={loading}
                icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
              >
                {t("Refresh models and indexes")}
              </Button>

              <Button onClick={() => setSection("download")} icon={<Download size={14} />}>
                {t("Get Models")}
              </Button>

              {selectedCount > 0 && (
                <span
                  className="flex items-center gap-2 pl-2 ml-1 border-l border-white/10"
                  role="status"
                  aria-live="polite"
                >
                  <span className="text-xs text-neutral-200 font-medium tabular-nums whitespace-nowrap">
                    {selectedCount} {t("selected")}
                  </span>
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={() => setDeleteTargets(models.filter((m) => selected.has(m.id)))}
                    icon={<Trash2 size={13} />}
                  >
                    {t("Delete selected")}
                  </Button>
                  <IconButton
                    icon={<X size={13} />}
                    label={t("Clear selection")}
                    onClick={() => setSelected(new Set())}
                  />
                </span>
              )}
            </div>
          </div>

          {/* Model Cards Grid */}
          {filteredModels.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Database size={40} />}
                title={t("No voice models found")}
                description={
                  search
                    ? t("No models match your search.")
                    : t(
                        "Your models directory (logs/) is currently empty. Download community weights or train your own voice model to get started.",
                      )
                }
                action={
                  <div className="flex justify-center gap-3">
                    <Button onClick={() => setSection("download")} icon={<Download size={16} />}>
                      {t("Download a Model")}
                    </Button>
                    <Link href="/train" className="inline-flex">
                      <button type="button" className="ghost">
                        {t("Train New Model")}
                      </button>
                    </Link>
                  </div>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1800px]:grid-cols-5 gap-4 items-stretch">
              {filteredModels.map((m) => {
                const isSelected = selected.has(m.id);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: card click toggles selection; the checkbox inside is the keyboard control
                  <div
                    key={m.id}
                    onClick={() => toggleSelect(m.id)}
                    className={`card m-0 h-full transition-all flex flex-col justify-between cursor-pointer ${
                      isSelected ? "border-white/30 bg-white/[0.05]" : "hover:border-white/20"
                    }`}
                  >
                    <div>
                      {/* Header: Select, Title & Folder */}
                      <div className="flex items-start gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(m.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${t("Select model")} ${m.name}`}
                          className="mt-1 shrink-0 cursor-pointer"
                        />
                        <h3
                          className="font-semibold text-white text-base truncate m-0 flex-1 min-w-0"
                          title={m.name}
                        >
                          {m.name}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-neutral-300 flex items-center gap-1 shrink-0 min-w-0 max-w-[42%]">
                          <Folder size={12} className="shrink-0" />
                          <span className="truncate">{m.folder}</span>
                        </span>
                      </div>

                      {/* Stats & Index status */}
                      <div className="space-y-1.5 text-xs text-neutral-400 my-3">
                        <div className="flex justify-between">
                          <span>{t("Weights (.pth):")}</span>
                          <span className="text-neutral-200 tabular-nums">{formatBytes(m.pthSize)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>{t("Feature Index:")}</span>
                          {m.indexPath ? (
                            <span className="text-neutral-200 flex items-center gap-1">
                              <FileCheck size={12} />
                              <span>{formatBytes(m.indexSize || 0)}</span>
                            </span>
                          ) : (
                            <span className="text-neutral-500 flex items-center gap-1">
                              <FileX size={12} />
                              <span>{t("None")}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between text-neutral-500 pt-1 border-t border-white/5">
                          <span>{t("Modified:")}</span>
                          <span>{new Date(m.modifiedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions Footer (clicks here don't toggle selection) */}
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: bubbling guard only, no interaction */}
                    <div
                      className="flex items-center justify-between gap-2 pt-3 border-t border-white/10 mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="xs" onClick={() => openInInference(m)} icon={<Sparkles size={13} />}>
                        {t("Use")}
                      </Button>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openInspect(m)}
                          title={t("View checkpoint metadata")}
                          aria-label={`${t("Inspect model metadata for")} ${m.name}`}
                          icon={<Info size={13} aria-hidden="true" />}
                        >
                          {t("Inspect")}
                        </Button>
                        <IconButton
                          variant="danger"
                          icon={<Trash2 size={13} aria-hidden="true" />}
                          label={`${t("Delete model")} ${m.name}`}
                          onClick={() => setDeleteTargets([m])}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. DOWNLOAD PANEL */}
      {section === "download" && (
        <div id="panel-download" role="tabpanel" aria-labelledby="tab-download">
          <DownloadPanel />
        </div>
      )}

      {/* 3. VOICE BLENDER PANEL */}
      {section === "blend" && (
        <div id="panel-blend" role="tabpanel" aria-labelledby="tab-blend">
          <BlenderPanel />
        </div>
      )}

      {/* 4. INSPECT CUSTOM PATH */}
      {section === "inspect" && (
        <div id="panel-inspect" role="tabpanel" aria-labelledby="tab-inspect" className="space-y-4">
          <Card>
            <CardHeader
              icon={<Info size={18} />}
              title={t("Inspect Model File")}
              description={t(
                "Enter any repository-relative or absolute path to a .pth checkpoint to read its architecture and training parameters.",
              )}
            />
            <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
              <label htmlFor="custom-pth-input" className="sr-only">
                {t("Path to .pth checkpoint")}
              </label>
              <input
                id="custom-pth-input"
                type="text"
                value={customPth}
                onChange={(e) => setCustomPth(e.target.value)}
                placeholder="logs/my-model/my-model.pth"
                className="flex-1 h-10 px-3 text-sm rounded-xl bg-white/5 border border-white/10"
              />
              <Button onClick={inspectCustom} icon={<Info size={16} />}>
                {t("Inspect File")}
              </Button>
            </div>
          </Card>
          <ModelInfoCard
            metadata={customMeta}
            loading={customLoading}
            error={customError}
            pthPath={customPth}
          />
        </div>
      )}

      {/* INSPECT METADATA MODAL */}
      <Modal
        isOpen={!!inspectModal}
        onClose={() => setInspectModal(null)}
        title={inspectModal?.name || t("Model Metadata")}
        icon={<Info size={18} className="text-white" />}
      >
        {inspectLoading && <p className="muted text-sm">{t("Reading model checkpoint…")}</p>}
        {inspectError && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3 rounded-lg border border-[var(--err)] text-[var(--err)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)]"
          >
            {inspectError}
          </div>
        )}

        {inspectMeta && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Model Name")}</span>
              <span className="font-medium text-white">{inspectMeta.model_name || t("None")}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Author")}</span>
              <span className="font-medium text-white">{inspectMeta.author || t("Anonymous")}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Epochs")}</span>
              <span className="font-medium text-white">{inspectMeta.epochs || t("None")}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Training Steps")}</span>
              <span className="font-medium text-white">{inspectMeta.step || t("None")}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Sampling Rate")}</span>
              <span className="font-medium text-white">{inspectMeta.sr || t("None")}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Pitch Guidance (F0)")}</span>
              <span className="font-medium text-white">
                {inspectMeta.f0 === "1" ? t("Yes") : inspectMeta.f0 || t("None")}
              </span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Vocoder")}</span>
              <span className="font-medium text-white">{inspectMeta.vocoder || "HiFi-GAN"}</span>
            </div>
            <div className="bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Embedder Model")}</span>
              <span className="font-medium text-white">{inspectMeta.embedder_model || "contentvec"}</span>
            </div>
            <div className="col-span-2 bg-black/30 p-2.5 rounded-lg border border-white/5">
              <span className="text-neutral-400 text-xs block">{t("Creation Date")}</span>
              <span className="font-medium text-white">{inspectMeta.creation_date || t("Unknown")}</span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10 mt-4">
          <Button variant="ghost" onClick={() => setInspectModal(null)}>
            {t("Close")}
          </Button>
          <Button
            onClick={() => {
              const m = inspectModal;
              setInspectModal(null);
              if (m) openInInference(m);
            }}
            iconAfter={<ArrowRight size={14} />}
          >
            {t("Use in Inference")}
          </Button>
        </div>
      </Modal>

      {/* DELETE CONFIRMATION MODAL (single or bulk) */}
      <Modal
        isOpen={deleteTargets.length > 0}
        onClose={() => setDeleteTargets([])}
        title={deleteTargets.length > 1 ? t("Delete Models?") : t("Delete Model?")}
        size="sm"
        danger
      >
        {deleteTargets.length > 1 ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-300 m-0">
              {t("Permanently delete these models from disk? Their .pth and .index files will be removed.")}
            </p>
            <ul className="m-0 p-0 list-none space-y-1.5 max-h-44 overflow-y-auto">
              {deleteTargets.map((m) => (
                <li
                  key={m.id}
                  className="text-xs text-neutral-200 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/5 truncate"
                  title={m.name}
                >
                  {m.name}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-neutral-300">
            {t("Are you sure you want to permanently delete")} <strong>{deleteTargets[0]?.name}</strong>{" "}
            {t("from disk? This will remove its .pth and .index files.")}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-4 border-t border-white/10 mt-4">
          <Button variant="ghost" onClick={() => setDeleteTargets([])} disabled={deleting}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" onClick={confirmDelete} loading={deleting}>
            {deleting
              ? t("Deleting…")
              : deleteTargets.length > 1
                ? `${t("Delete Models")} (${deleteTargets.length})`
                : t("Delete Model")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
