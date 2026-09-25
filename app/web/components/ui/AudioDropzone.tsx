"use client";

import { ChevronDown, Mic, Music, SquarePlay, UploadCloud } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import AudioWavePlayer from "@/components/AudioWavePlayer";
import CustomSelect from "@/components/ui/CustomSelect";
import { apiSend, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useJob } from "@/lib/useJob";
import { usePreviewUrl } from "@/lib/usePreviewUrl";
import Alert from "./Alert";
import Button from "./Button";

export interface AudioDropzoneProps {
  audioFile: File | null;
  inputPath: string;
  sampleAudios: string[];
  onFileSelect: (file: File | null) => void;
  onPathSelect: (path: string) => void;
  disabled?: boolean;
  /** Show the YouTube tab: paste a link, download to assets/audios, select it. */
  youtube?: boolean;
}

const YOUTUBE_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i;

type DropzoneTab = "upload" | "samples" | "youtube" | "mic";

async function blobToWavFile(blob: Blob, baseName: string): Promise<File> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const nCh = Math.min(audio.numberOfChannels, 2);
    const len = audio.length;
    const buf = new ArrayBuffer(44 + len * nCh * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + len * nCh * 2, true);
    str(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, nCh, true);
    v.setUint32(24, audio.sampleRate, true);
    v.setUint32(28, audio.sampleRate * nCh * 2, true);
    v.setUint16(32, nCh * 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, len * nCh * 2, true);
    const ch: Float32Array[] = [];
    for (let c = 0; c < nCh; c++) ch.push(audio.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++)
      for (let c = 0; c < nCh; c++) {
        const s = Math.max(-1, Math.min(1, ch[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    return new File([buf], `${baseName}.wav`, { type: "audio/wav" });
  } finally {
    void ctx.close().catch(() => {});
  }
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}

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
}: AudioDropzoneProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DropzoneTab>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [micError, setMicError] = useState("");
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytJobId, setYtJobId] = useState<string | null>(null);
  const [ytStarting, setYtStarting] = useState(false);
  const [ytError, setYtError] = useState("");
  const { job: ytJob } = useJob(youtube ? ytJobId : null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const hasAudio = !!audioFile || !!inputPath;

  const previewSrc = usePreviewUrl(audioFile, inputPath) || "";

  // Cleanup mic recording on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recRef.current?.stream.getTracks().forEach((trk) => {
        trk.stop();
      });
    };
  }, []);

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
      if (file.type.startsWith("audio/") || /\.(wav|mp3|flac|ogg|m4a|opus|webm|aac|aiff)$/i.test(file.name)) {
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

  const startMic = async () => {
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = () => {
        stream.getTracks().forEach((trk) => {
          trk.stop();
        });
        setRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        blobToWavFile(blob, `mic-recording-${Date.now()}`)
          .then((file) => {
            onFileSelect(file);
            onPathSelect("");
            setShowSourcePicker(false);
          })
          .catch(() => {
            setMicError(t("Could not process the recording — try uploading a WAV file."));
          });
      };

      recRef.current = { rec, chunks, stream };
      rec.start();
      setRecording(true);
      setRecDuration(0);

      timerRef.current = setInterval(() => {
        setRecDuration((d) => d + 1);
      }, 1000);
    } catch {
      setMicError(t("Microphone unavailable — check permissions."));
      setRecording(false);
    }
  };

  const stopMic = () => {
    recRef.current?.rec.stop();
  };

  const clearAudio = () => {
    onFileSelect(null);
    onPathSelect("");
    setShowSourcePicker(false);
    setYtJobId(null);
    setYtError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetYoutube = () => {
    setYtJobId(null);
    setYtError("");
  };

  const ytActive = ytStarting || ytJob?.status === "running" || ytJob?.status === "queued";

  // Adopt a finished YouTube download as the selected source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: adopt terminal states once
  useEffect(() => {
    if (!youtube || !ytJobId || !ytJob) return;
    if (ytJob.status === "done") {
      const file = (ytJob.result as { file?: string } | undefined)?.file;
      if (file) {
        onPathSelect(file);
        onFileSelect(null);
        setShowSourcePicker(false);
        setYtUrl("");
      } else {
        setYtError(t("Download finished without an audio file."));
      }
      setYtJobId(null);
    } else if (ytJob.status === "error") {
      setYtError(ytJob.error || t("YouTube download failed."));
      setYtJobId(null);
    }
  }, [youtube, ytJobId, ytJob]);

  async function startYoutubeDownload() {
    const url = ytUrl.trim();
    if (!YOUTUBE_RE.test(url)) {
      setYtError(t("Paste a single YouTube video link (watch, shorts or youtu.be)."));
      return;
    }
    setYtError("");
    setYtStarting(true);
    try {
      const { jobId } = await apiSend<{ jobId: string }>("/api/audio/youtube", "POST", {
        url,
        outputFormat: "wav",
      });
      setYtJobId(jobId);
    } catch (e) {
      setYtError(errMsg(e));
    } finally {
      setYtStarting(false);
    }
  }

  function renderYoutubePanel(idSuffix: string) {
    return (
      <div className="space-y-2 py-1">
        <label htmlFor={`yt-url-${idSuffix}`} className="text-xs font-medium text-neutral-300">
          {t("Paste a YouTube link")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`yt-url-${idSuffix}`}
            type="url"
            value={ytUrl}
            disabled={disabled || ytActive}
            onChange={(e) => setYtUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") startYoutubeDownload();
            }}
            placeholder="https://youtube.com/watch?v=…"
            className="flex-1 min-w-0"
          />
          <Button
            size="sm"
            onClick={startYoutubeDownload}
            disabled={disabled || ytActive || !ytUrl.trim()}
            loading={ytActive}
            icon={<SquarePlay size={14} />}
          >
            {t("Fetch audio")}
          </Button>
        </div>
        <p className="text-[11px] text-neutral-500 m-0">
          {ytActive
            ? t("Downloading… the track is saved to assets/audios when done.")
            : t("Single videos only — saved to assets/audios for reuse.")}
        </p>
        {ytError && <Alert variant="error">{ytError}</Alert>}
      </div>
    );
  }

  const activeTitle = audioFile ? audioFile.name : inputPath.split(/[\\/]/).pop()?.split("?")[0] || inputPath;

  return (
    <div className="w-full space-y-3">
      {/* Hidden file input always available */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.flac,.ogg,.opus,.m4a,.mp4,.aac,.aiff,.webm"
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
                onClick={() => setShowSourcePicker((prev) => !prev)}
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
              <div
                role="tablist"
                aria-label={t("Audio source selection")}
                className="flex items-center gap-1.5 border-b border-white/10 pb-2 overflow-x-auto hide-scrollbar max-w-full"
              >
                <button
                  type="button"
                  role="tab"
                  id="picker-tab-upload"
                  aria-selected={tab === "upload"}
                  aria-controls="picker-panel-upload"
                  onClick={() => setTab("upload")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                    tab === "upload"
                      ? "bg-white/10 text-white font-medium"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <UploadCloud size={14} />
                    <span>{t("Upload file")}</span>
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  id="picker-tab-samples"
                  aria-selected={tab === "samples"}
                  aria-controls="picker-panel-samples"
                  onClick={() => setTab("samples")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                    tab === "samples"
                      ? "bg-white/10 text-white font-medium"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Music size={14} />
                    <span>{t("Sample Library")}</span>
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  id="picker-tab-mic"
                  aria-selected={tab === "mic"}
                  aria-controls="picker-panel-mic"
                  onClick={() => setTab("mic")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                    tab === "mic" ? "bg-white/10 text-white font-medium" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Mic size={14} />
                    <span>{t("Microphone")}</span>
                  </span>
                </button>

                {youtube && (
                  <button
                    type="button"
                    role="tab"
                    id="picker-tab-youtube"
                    aria-selected={tab === "youtube"}
                    aria-controls="picker-panel-youtube"
                    onClick={() => setTab("youtube")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                      tab === "youtube"
                        ? "bg-white/10 text-white font-medium"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <SquarePlay size={14} />
                      <span>{t("YouTube")}</span>
                    </span>
                  </button>
                )}
              </div>

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
                <div
                  id="picker-panel-samples"
                  role="tabpanel"
                  aria-labelledby="picker-tab-samples"
                  className="space-y-2"
                >
                  <label
                    htmlFor="change-sample-audio-select"
                    className="text-xs font-medium text-neutral-300"
                  >
                    {t("Pick a sample audio from assets/audios")}
                  </label>
                  {sampleAudios.length === 0 ? (
                    <p className="text-xs text-neutral-400 m-0 py-2">
                      {t("No sample files found in assets/audios")}
                    </p>
                  ) : (
                    <CustomSelect
                      id="change-sample-audio-select"
                      value={inputPath}
                      onChange={(e) => {
                        if (e.target.value) {
                          onPathSelect(e.target.value);
                          onFileSelect(null);
                          setShowSourcePicker(false);
                        }
                      }}
                      placeholder={t("Choose a sample audio…")}
                      className="w-full"
                    >
                      <option value="">{t("Select an audio file…")}</option>
                      {sampleAudios.map((s) => {
                        const name = s.split(/[\\/]/).pop() || s;
                        return (
                          <option key={s} value={s}>
                            {name}
                          </option>
                        );
                      })}
                    </CustomSelect>
                  )}
                </div>
              )}

              {youtube && tab === "youtube" && (
                <div id="picker-panel-youtube" role="tabpanel" aria-labelledby="picker-tab-youtube">
                  {renderYoutubePanel("change")}
                </div>
              )}

              {tab === "mic" && (
                <div
                  id="picker-panel-mic"
                  role="tabpanel"
                  aria-labelledby="picker-tab-mic"
                  className="py-4 flex flex-col items-center justify-center text-center space-y-3"
                >
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                      recording
                        ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40 scale-110"
                        : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    <Mic size={22} />
                  </div>
                  <p className="text-xs text-neutral-300 m-0">
                    {recording
                      ? `${t("Recording")} (${Math.floor(recDuration / 60)}:${
                          recDuration % 60 < 10 ? "0" : ""
                        }${recDuration % 60})`
                      : t("Record a new take to replace current audio")}
                  </p>
                  {!recording ? (
                    <button
                      type="button"
                      onClick={startMic}
                      className="cta text-xs py-1.5 px-4 cursor-pointer"
                    >
                      {t("Start recording")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopMic}
                      className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shadow-md cursor-pointer"
                    >
                      {t("Stop recording")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* When no audio is selected, render tab switcher and picker contents */
        <div className="space-y-3">
          {/* Tab Switcher: Upload / Samples / Mic */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 max-w-full">
            <div
              role="tablist"
              aria-label={t("Audio source selection")}
              className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar max-w-full min-w-0"
            >
              <button
                type="button"
                role="tab"
                id="empty-tab-upload"
                aria-selected={tab === "upload"}
                aria-controls="empty-panel-upload"
                onClick={() => setTab("upload")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                  tab === "upload"
                    ? "bg-white/10 text-white font-medium"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <UploadCloud size={14} />
                  <span>{t("Upload / Drag & Drop")}</span>
                </span>
              </button>

              <button
                type="button"
                role="tab"
                id="empty-tab-samples"
                aria-selected={tab === "samples"}
                aria-controls="empty-panel-samples"
                onClick={() => setTab("samples")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                  tab === "samples"
                    ? "bg-white/10 text-white font-medium"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Music size={14} />
                  <span>{t("Sample Library")}</span>
                </span>
              </button>

              <button
                type="button"
                role="tab"
                id="empty-tab-mic"
                aria-selected={tab === "mic"}
                aria-controls="empty-panel-mic"
                onClick={() => setTab("mic")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                  tab === "mic" ? "bg-white/10 text-white font-medium" : "text-neutral-400 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Mic size={14} />
                  <span>{t("Microphone")}</span>
                </span>
              </button>

              {youtube && (
                <button
                  type="button"
                  role="tab"
                  id="empty-tab-youtube"
                  aria-selected={tab === "youtube"}
                  aria-controls="empty-panel-youtube"
                  onClick={() => setTab("youtube")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0 ${
                    tab === "youtube"
                      ? "bg-white/10 text-white font-medium"
                      : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <SquarePlay size={14} />
                    <span>{t("YouTube")}</span>
                  </span>
                </button>
              )}
            </div>
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
                className={`relative w-full py-9 px-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center select-none ${
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
                  {t("Supports WAV, MP3, FLAC, OGG, M4A, Opus, and AAC (max 200MB)")}
                </p>

                <div className="flex items-center gap-1.5 mt-4 flex-wrap justify-center">
                  {["WAV", "MP3", "FLAC", "OGG", "M4A"].map((fmt) => (
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
            <div
              id="empty-panel-samples"
              role="tabpanel"
              aria-labelledby="empty-tab-samples"
              className="space-y-2 py-1"
            >
              <label htmlFor="sample-audio-select" className="text-xs font-medium text-neutral-300">
                {t("Pick a sample audio from assets/audios")}
              </label>
              {sampleAudios.length === 0 ? (
                <p className="text-xs text-neutral-400 m-0 py-2">
                  {t("No sample files found in assets/audios")}
                </p>
              ) : (
                <CustomSelect
                  id="sample-audio-select"
                  value={inputPath}
                  onChange={(e) => {
                    if (e.target.value) {
                      onPathSelect(e.target.value);
                      onFileSelect(null);
                    }
                  }}
                  placeholder={t("Choose a sample audio…")}
                  className="w-full"
                >
                  <option value="">{t("Select an audio file…")}</option>
                  {sampleAudios.map((s) => {
                    const name = s.split(/[\\/]/).pop() || s;
                    return (
                      <option key={s} value={s}>
                        {name}
                      </option>
                    );
                  })}
                </CustomSelect>
              )}
            </div>
          )}

          {youtube && tab === "youtube" && (
            <div id="empty-panel-youtube" role="tabpanel" aria-labelledby="empty-tab-youtube">
              {renderYoutubePanel("empty")}
            </div>
          )}

          {tab === "mic" && (
            <div
              id="empty-panel-mic"
              role="tabpanel"
              aria-labelledby="empty-tab-mic"
              className="p-6 bg-white/[0.03] border border-white/10 rounded-2xl flex flex-col items-center justify-center text-center space-y-4"
            >
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                  recording
                    ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40 scale-110"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <Mic size={28} />
              </div>

              <div>
                <p className="text-sm font-semibold text-white m-0">
                  {recording ? t("Recording in progress…") : t("Record directly with microphone")}
                </p>
                <p className="text-xs text-neutral-400 m-0 mt-1">
                  {recording
                    ? `${Math.floor(recDuration / 60)}:${recDuration % 60 < 10 ? "0" : ""}${recDuration % 60}`
                    : t("High quality voice capture")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!recording ? (
                  <button type="button" onClick={startMic} className="cta text-xs cursor-pointer">
                    {t("Start recording")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopMic}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shadow-md cursor-pointer"
                  >
                    {t("Stop recording")}
                  </button>
                )}
              </div>

              {micError && <p className="text-xs text-red-400 m-0">{micError}</p>}
            </div>
          )}
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
  if (prev.sampleAudios.length !== next.sampleAudios.length) return false;
  if (prev.onFileSelect !== next.onFileSelect) return false;
  if (prev.onPathSelect !== next.onPathSelect) return false;
  return true;
}

const AudioDropzone = React.memo(AudioDropzoneInner, areAudioDropzonePropsEqual);
export default AudioDropzone;
