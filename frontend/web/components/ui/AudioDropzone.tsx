"use client";

import { ChevronDown, Mic, Music, SquarePlay, UploadCloud } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import MicrophoneSource from "@/components/audio-source/MicrophoneSource";
import SampleAudioSource from "@/components/audio-source/SampleAudioSource";
import { useMicrophoneRecording } from "@/components/audio-source/useMicrophoneRecording";
import { useYoutubeAudio } from "@/components/audio-source/useYoutubeAudio";
import YoutubeSource from "@/components/audio-source/YoutubeSource";
import { fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreviewUrl } from "@/lib/usePreviewUrl";
import SourceTabs, { type SourceTab } from "./SourceTabs";

export interface AudioDropzoneProps {
  audioFile: File | null;
  inputPath: string;
  sampleAudios: string[];
  onFileSelect: (file: File | null) => void;
  onPathSelect: (path: string) => void;
  disabled?: boolean;
  /** Show the YouTube tab: paste a link, download to assets/audios, select it. */
  youtube?: boolean;
  /** Optional callback when audios should be refreshed in parent */
  onRefreshAudios?: () => void;
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
  sampleAudios,
  onFileSelect,
  onPathSelect,
  disabled = false,
  youtube = false,
  onRefreshAudios,
}: AudioDropzoneProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DropzoneTab>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const [localSampleAudios, setLocalSampleAudios] = useState<string[]>(sampleAudios);

  useEffect(() => {
    setLocalSampleAudios(sampleAudios);
  }, [sampleAudios]);

  const refreshSampleAudios = useCallback(async () => {
    onRefreshAudios?.();
    try {
      const data = await fetchModels(true);
      if (data?.audios) {
        setLocalSampleAudios(data.audios);
      }
    } catch {
      /* ignore */
    }
  }, [onRefreshAudios]);

  // Refresh on user actions, not callback changes after the parent rerenders.
  const selectTab = (nextTab: DropzoneTab) => {
    if (nextTab === "samples" && tab !== "samples") void refreshSampleAudios();
    setTab(nextTab);
  };

  const toggleSourcePicker = () => {
    if (!showSourcePicker) void refreshSampleAudios();
    setShowSourcePicker(!showSourcePicker);
  };

  const youtubeSource = useYoutubeAudio({
    enabled: youtube,
    disabled,
    onRefresh: refreshSampleAudios,
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

  const previewSrc = usePreviewUrl(audioFile, inputPath) || "";

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
      onFileSelect(file);
      onPathSelect("");
      resetYoutube();
      setShowSourcePicker(false);
    }
  };

  const clearAudio = () => {
    onFileSelect(null);
    onPathSelect("");
    setShowSourcePicker(false);
    resetYoutube();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  function handleSampleSelect(path: string) {
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
      {hasAudio ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-neutral-400 px-1">
            <span className="flex items-center gap-1.5 font-medium text-neutral-300 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="truncate">{t("Audio Source Preview")}</span>
            </span>
            <div className="flex items-center gap-3 shrink-0">
              {audioFile && <span className="text-neutral-400">{formatBytes(audioFile.size)}</span>}
              <button
                type="button"
                onClick={toggleSourcePicker}
                className="text-xs text-white/80 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>{showSourcePicker ? t("Hide selector") : t("Change source")}</span>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${showSourcePicker ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>

          <AudioWavePlayer
            src={previewSrc}
            file={audioFile}
            title={activeTitle}
            showAnalyzerLink={false}
            onRemove={clearAudio}
            onReplace={() => fileInputRef.current?.click()}
          />

          {/* Quick source selector when toggled */}
          {showSourcePicker && (
            <div className="p-3 bg-neutral-900/60 border border-white/10 rounded-2xl space-y-3 transition-all animate-in fade-in duration-200">
              <SourceTabs
                tabs={sourceTabs}
                active={tab}
                onSelect={selectTab}
                idPrefix="picker"
                label={t("Audio source selection")}
              />

              {tab === "upload" && (
                <div id="picker-panel-upload" role="tabpanel" aria-labelledby="picker-tab-upload">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-6 px-4 rounded-xl border border-dashed border-white/20 hover:border-white/40 bg-white/[0.02] hover:bg-white/[0.05] text-center cursor-pointer transition-all"
                  >
                    <p className="text-xs font-medium text-white m-0">
                      {t("Click to choose a new audio file or drag & drop here")}
                    </p>
                  </button>
                </div>
              )}

              {tab === "samples" && (
                <SampleAudioSource
                  audios={localSampleAudios}
                  value={inputPath}
                  onSelect={handleSampleSelect}
                  onRefresh={refreshSampleAudios}
                  compact={true}
                />
              )}

              {youtube && tab === "youtube" && (
                <div id="picker-panel-youtube" role="tabpanel" aria-labelledby="picker-tab-youtube">
                  <YoutubeSource source={youtubeSource} idSuffix="change" disabled={disabled} />
                </div>
              )}

              {tab === "mic" && (
                <MicrophoneSource microphone={microphone} disabled={disabled} compact={true} />
              )}
            </div>
          )}
        </div>
      ) : (
        /* When no audio is selected, render tab switcher and picker contents */
        <div className="space-y-3">
          {/* Tab Switcher: Upload / Samples / Mic */}
          <div className="flex items-center justify-between gap-2 max-w-full">
            <SourceTabs
              tabs={sourceTabs.map((item) =>
                item.id === "upload" ? { ...item, label: t("Upload / Drag & Drop") } : item,
              )}
              active={tab}
              onSelect={selectTab}
              idPrefix="empty"
              label={t("Audio source selection")}
              className="min-w-0"
            />
          </div>

          {tab === "upload" && (
            <div id="empty-panel-upload" role="tabpanel" aria-labelledby="empty-tab-upload">
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
            </div>
          )}

          {tab === "samples" && (
            <SampleAudioSource
              audios={localSampleAudios}
              value={inputPath}
              onSelect={handleSampleSelect}
              onRefresh={refreshSampleAudios}
              compact={false}
            />
          )}

          {youtube && tab === "youtube" && (
            <div id="empty-panel-youtube" role="tabpanel" aria-labelledby="empty-tab-youtube">
              <YoutubeSource source={youtubeSource} idSuffix="empty" disabled={disabled} />
            </div>
          )}

          {tab === "mic" && <MicrophoneSource microphone={microphone} disabled={disabled} compact={false} />}
        </div>
      )}
    </div>
  );
}

function areAudioDropzonePropsEqual(prev: AudioDropzoneProps, next: AudioDropzoneProps): boolean {
  if (prev.audioFile !== next.audioFile) return false;
  if (prev.inputPath !== next.inputPath) return false;
  if (prev.disabled !== next.disabled) return false;
  if (prev.youtube !== next.youtube) return false;
  // Compare the entries, not just the count: a refreshed list can swap one
  // sample for another without changing its length.
  if (
    prev.sampleAudios.length !== next.sampleAudios.length ||
    prev.sampleAudios.some((audio, index) => audio !== next.sampleAudios[index])
  )
    return false;
  if (prev.onFileSelect !== next.onFileSelect) return false;
  if (prev.onPathSelect !== next.onPathSelect) return false;
  if (prev.onRefreshAudios !== next.onRefreshAudios) return false;
  return true;
}

const AudioDropzone = React.memo(AudioDropzoneInner, areAudioDropzonePropsEqual);
export default AudioDropzone;
