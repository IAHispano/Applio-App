"use client";

import { ChevronDown, Mic, Music, SquarePlay, UploadCloud } from "lucide-react";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import MicrophoneSource from "@/components/audio-source/MicrophoneSource";
import SampleAudioSource from "@/components/audio-source/SampleAudioSource";
import { useMicrophoneRecording } from "@/components/audio-source/useMicrophoneRecording";
import { useYoutubeAudio } from "@/components/audio-source/useYoutubeAudio";
import YoutubeSource from "@/components/audio-source/YoutubeSource";
import { cachedSampleAudios, fetchSampleAudios, resolveAudioUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import Button from "./Button";
import SourceTabs, { type SourceTab, SourceTabPanel } from "./SourceTabs";

export interface AudioDropzoneProps {
  audioFile: File | null;
  inputPath: string;
  onFileSelect: (file: File | null) => void;
  onPathSelect: (path: string) => void;
  disabled?: boolean;
  /** Show the YouTube tab: paste a link, download to assets/audios, select it. */
  youtube?: boolean;
}

type DropzoneTab = "upload" | "samples" | "youtube" | "mic";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function AudioDropzoneInner({
  audioFile,
  inputPath,
  onFileSelect,
  onPathSelect,
  disabled = false,
  youtube = false,
}: AudioDropzoneProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DropzoneTab>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const sourceId = useId();
  const changeSourceRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocus = useRef<"change-source" | "current-tab" | null>(null);

  const [samples, setSamples] = useState<string[]>(() => cachedSampleAudios() ?? []);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const sampleRequest = useRef(0);

  const refreshSampleAudios = useCallback(async (force = false) => {
    const request = ++sampleRequest.current;
    setLoadingSamples(true);
    try {
      const paths = await fetchSampleAudios(force);
      if (request === sampleRequest.current) setSamples(paths);
    } catch {
      /* ignore */
    } finally {
      if (request === sampleRequest.current) setLoadingSamples(false);
    }
  }, []);

  // Refresh on user actions, not callback changes after the parent rerenders.
  const selectTab = (nextTab: DropzoneTab) => {
    if (nextTab === "samples" && tab !== "samples") void refreshSampleAudios(true);
    setTab(nextTab);
  };

  const toggleSourcePicker = () => {
    if (!showSourcePicker && tab === "samples") void refreshSampleAudios(true);
    setShowSourcePicker(!showSourcePicker);
  };

  const youtubeSource = useYoutubeAudio({
    enabled: youtube,
    disabled,
    onRefresh: () => refreshSampleAudios(true),
    onSelected: (path) => {
      onPathSelect(path);
      onFileSelect(null);
      setShowSourcePicker(false);
    },
  });
  const resetYoutube = youtubeSource.reset;

  const sourceTabs: SourceTab<DropzoneTab>[] = [
    { id: "upload", label: t("Upload file"), icon: <UploadCloud size={14} /> },
    { id: "samples", label: t("Sample Library"), icon: <Music size={14} /> },
    { id: "mic", label: t("Microphone"), icon: <Mic size={14} /> },
    ...(youtube ? [{ id: "youtube" as const, label: t("YouTube"), icon: <SquarePlay size={14} /> }] : []),
  ];

  const microphone = useMicrophoneRecording({
    disabled,
    onRecorded: (file) => {
      onFileSelect(file);
      onPathSelect("");
      setShowSourcePicker(false);
    },
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasAudio = !!audioFile || !!inputPath;
  const activeTab = tab === "youtube" && !youtube ? "upload" : tab;

  useEffect(() => {
    if (pendingFocus.current === "change-source" && hasAudio && !showSourcePicker) {
      changeSourceRef.current?.focus({ preventScroll: true });
      pendingFocus.current = null;
    } else if (pendingFocus.current === "current-tab" && !hasAudio) {
      document.getElementById(`${sourceId}-tab-${activeTab}`)?.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [activeTab, hasAudio, showSourcePicker, sourceId]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const file = droppedFiles[0];
      if (file.type.startsWith("audio/") || /\.(wav|mp3|flac)$/i.test(file.name)) {
        onFileSelect(file);
        onPathSelect("");
        resetYoutube();
        setShowSourcePicker(false);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      if (!hasAudio || showSourcePicker) pendingFocus.current = "change-source";
      onFileSelect(file);
      onPathSelect("");
      resetYoutube();
      setShowSourcePicker(false);
    }
  };

  const clearAudio = () => {
    pendingFocus.current = "current-tab";
    onFileSelect(null);
    onPathSelect("");
    setShowSourcePicker(false);
    resetYoutube();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  function handleSampleSelect(path: string) {
    pendingFocus.current = "change-source";
    resetYoutube();
    onPathSelect(path);
    onFileSelect(null);
    setShowSourcePicker(false);
  }

  const activeTitle = audioFile ? audioFile.name : inputPath.split(/[\\/]/).pop()?.split("?")[0] || inputPath;

  return (
    <div className="w-full space-y-3">
      {/* Hidden file input always available */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.flac"
        onChange={handleFileChange}
        disabled={disabled}
        className="hidden"
      />

      {/* When audio is active, show the modern WaveSurfer player preview */}
      {hasAudio && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400 px-1">
            <span className="flex items-center gap-1.5 font-medium text-neutral-300 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="truncate">{t("Audio Source Preview")}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {audioFile && <span className="text-neutral-400">{formatBytes(audioFile.size)}</span>}
              <Button
                ref={changeSourceRef}
                variant="ghost"
                onClick={toggleSourcePicker}
                aria-expanded={showSourcePicker}
                aria-controls={showSourcePicker ? sourceId : undefined}
                iconAfter={<ChevronDown className={showSourcePicker ? "rotate-180" : ""} />}
              >
                {showSourcePicker ? t("Hide selector") : t("Change source")}
              </Button>
            </div>
          </div>

          <AudioWavePlayer
            src={audioFile ? "" : resolveAudioUrl(inputPath)}
            file={audioFile}
            title={activeTitle}
            showAnalyzerLink={false}
            onRemove={clearAudio}
            onReplace={() => fileInputRef.current?.click()}
          />
        </div>
      )}

      {(!hasAudio || showSourcePicker) && (
        <div
          id={sourceId}
          className={
            hasAudio
              ? "p-3 bg-neutral-900/60 border border-white/10 rounded-2xl space-y-3 transition-all animate-in fade-in duration-200"
              : "space-y-3"
          }
        >
          <SourceTabs
            tabs={
              hasAudio
                ? sourceTabs
                : sourceTabs.map((item) =>
                    item.id === "upload" ? { ...item, label: t("Upload / Drag & Drop") } : item,
                  )
            }
            active={activeTab}
            onSelect={selectTab}
            idPrefix={sourceId}
            label={t("Audio source selection")}
          />

          <SourceTabPanel idPrefix={sourceId} tab="upload" active={activeTab} focusable={disabled}>
            {hasAudio ? (
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="w-full py-6 px-4 rounded-xl border border-dashed border-white/20 hover:border-white/40 bg-white/[0.02] hover:bg-white/[0.05] text-center cursor-pointer transition-all whitespace-normal"
              >
                <p className="text-xs font-medium text-white m-0">
                  {t("Click to choose a new audio file or drag & drop here")}
                </p>
              </button>
            ) : (
              <button
                type="button"
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className={`relative w-full py-9 px-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center whitespace-normal select-none ${
                  isDragging
                    ? "border-white bg-white/15 scale-[1.01] shadow-2xl"
                    : "border-white/15 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white mb-3 shadow-inner">
                  <UploadCloud size={24} />
                </div>

                <p className="text-sm font-semibold text-white m-0">
                  {isDragging ? t("Drop audio file here") : t("Click to browse or drag and drop audio")}
                </p>
                <p className="text-xs text-neutral-400 m-0 mt-1 max-w-sm">
                  {t("Max {size}", { size: "200 MB" })}
                </p>

                <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center">
                  {["WAV", "MP3", "FLAC"].map((fmt) => (
                    <span
                      key={fmt}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-neutral-300 border border-white/5"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </button>
            )}
          </SourceTabPanel>

          <SourceTabPanel
            idPrefix={sourceId}
            tab="samples"
            active={activeTab}
            focusable={!samples.length || disabled}
          >
            <SampleAudioSource
              audios={samples}
              loading={loadingSamples}
              value={inputPath}
              onSelect={handleSampleSelect}
              onRefresh={refreshSampleAudios}
              compact={hasAudio}
              disabled={disabled}
            />
          </SourceTabPanel>

          {youtube && (
            <SourceTabPanel idPrefix={sourceId} tab="youtube" active={activeTab} focusable={disabled}>
              <YoutubeSource source={youtubeSource} idSuffix={sourceId} disabled={disabled} />
            </SourceTabPanel>
          )}

          <SourceTabPanel idPrefix={sourceId} tab="mic" active={activeTab} focusable={disabled}>
            <MicrophoneSource microphone={microphone} disabled={disabled} compact={hasAudio} />
          </SourceTabPanel>
        </div>
      )}
    </div>
  );
}

const AudioDropzone = React.memo(AudioDropzoneInner);
export default AudioDropzone;
