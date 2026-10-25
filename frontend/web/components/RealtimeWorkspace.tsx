"use client";

import { Gauge, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import RealtimeDiagnostics from "@/components/RealtimeDiagnostics";
import RealtimeAudioSettings from "@/components/realtime/RealtimeAudioSettings";
import RealtimeConversionSettings from "@/components/realtime/RealtimeConversionSettings";
import RealtimeDevices from "@/components/realtime/RealtimeDevices";
import RealtimeFormantSettings from "@/components/realtime/RealtimeFormantSettings";
import RealtimeMonitorSettings from "@/components/realtime/RealtimeMonitorSettings";
import Stage from "@/components/realtime/RealtimeStage";
import RealtimeTools from "@/components/realtime/RealtimeTools";
import RealtimeVoiceCleanup from "@/components/realtime/RealtimeVoiceCleanup";
import type { RealtimeAudioSession } from "@/components/realtime/types";
import { useRealtimeAudioRouting } from "@/components/realtime/useRealtimeAudioRouting";
import { useRealtimeCalibration } from "@/components/realtime/useRealtimeCalibration";
import { Badge, Button, Disclosure, EMBEDDER_MODELS, REALTIME_F0_METHODS } from "@/components/ui";
import SliderField from "@/components/ui/SliderField";
import VoiceModelCard from "@/components/VoiceModelCard";
import { apiGet, apiSend, errMsg, fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { getModelPreset, loadModelPresets, saveModelPreset, useModelPresets } from "@/lib/model-presets";
import { INPUT_WORKLET, PLAYBACK_WORKLET, RealtimeAudioSender } from "@/lib/realtime-audio";
import { RealtimeHealthWindow } from "@/lib/realtime-diagnostics";
import { connectRealtimeOutput, DEFAULT_REALTIME_OUTPUT } from "@/lib/realtime-output";
import { setRealtimeGpuReserved } from "@/lib/realtime-presence";
import { RealtimeSettingsSender } from "@/lib/realtime-settings";
import { realtimeWsUrl } from "@/lib/realtime-ws";
import { SETTING_HELP } from "@/lib/setting-help";
import { useRealtimeTray } from "@/lib/useRealtimeTray";
import { useSpeakers } from "@/lib/useSpeakers";
import {
  connectVoiceFocus,
  realtimeMicrophoneConstraints,
  type VoiceFocusVariant,
  voiceFocusSupported,
} from "@/lib/voice-focus";

function apiWs(path: string): string {
  return realtimeWsUrl(path);
}

interface RtStatus {
  running: boolean;
  startedAt: string | null;
  logs: string[];
  scheduling?: { realtime?: boolean } | null;
}

const REALTIME_PRESET_DEFAULTS = {
  pitch: 0,
  index_rate: 0,
  protect: 0.5,
  volume_envelope: 1,
  autotune: false,
  autotune_strength: 1,
  proposed_pitch: false,
  proposed_pitch_threshold: 155,
  formant_shifting: false,
  formant_qfrency: 1,
  formant_timbre: 1,
  sid: 0,
  f0_method: "fcpe",
  embedder_model: "contentvec",
  embedder_model_custom: "",
};

function realtimePreset(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(REALTIME_PRESET_DEFAULTS).map(([key, fallback]) => [key, values[key] ?? fallback]),
  ) as Record<string, string | number | boolean>;
}
export default function RealtimeWorkspace({ active = true }: { active?: boolean }) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const { t } = useI18n();
  const [engine, setEngine] = useState<RtStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [index, setIndex] = useState("");
  const [inputs, setInputs] = useState<Array<{ id: string; label: string }>>([]);
  const [outputs, setOutputs] = useState<Array<{ id: string; label: string }>>([]);
  const [inDev, setInDev] = useState("");
  const [selectedOutDev, setOutDev] = useState("");
  // Settings restoration and device enumeration finish independently. Keep
  // the fallback usable even if saved settings arrive after the device list.
  const outDev = outputs.some((device) => device.id === DEFAULT_REALTIME_OUTPUT)
    ? DEFAULT_REALTIME_OUTPUT
    : selectedOutDev;
  const inputSelected = inputs.some((device) => device.id === inDev);
  const outputSelected = outputs.some((device) => device.id === outDev);
  const devicesSelected = inputSelected && outputSelected;
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0);
  const [protect, setProtect] = useState(0.5);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1);
  const [sid, setSid] = useState(0);
  const [f0Method, setF0Method] = useState("fcpe");
  const [embedder, setEmbedder] = useState("contentvec");
  const [embedderCustom, setEmbedderCustom] = useState("");
  const [autotune, setAutotune] = useState(false);
  const [decoderFp16, setDecoderFp16] = useState(false);
  const [voiceFocus, setVoiceFocus] = useState<VoiceFocusVariant>("off");
  const [voiceFocusUnsupported, setVoiceFocusUnsupported] = useState(false);
  const [voiceFocusError, setVoiceFocusError] = useState("");
  const voiceFocusCleanupRef = useRef<(() => Promise<void>) | null>(null);
  const [autotuneStrength, setAutotuneStrength] = useState(1);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [proposedPitchThreshold, setProposedPitchThreshold] = useState(155);
  const [formantShifting, setFormantShifting] = useState(false);
  const [formantQfrency, setFormantQfrency] = useState(1);
  const [formantTimbre, setFormantTimbre] = useState(1);
  const [chunkMs, setChunkMs] = useState(30);
  const [autoChunk, setAutoChunk] = useState(true);
  const [crossfade, setCrossfade] = useState(0.05);
  const [extraSize, setExtraSize] = useState(2.5);
  const [silent, setSilent] = useState(-60);
  const [vad, setVad] = useState(true);
  const [inGain, setInGain] = useState(100);
  const [passthrough, setPassthrough] = useState(false);
  const [passthroughHotkey, setPassthroughHotkey] = useState("CommandOrControl+Alt+V");
  const [hotkeyAvailable, setHotkeyAvailable] = useState(true);
  const [outGain, setOutGain] = useState(100);
  const [monitorSelf, setMonitorSelf] = useState(false);
  const [monitorVolume, setMonitorVolume] = useState(100);
  const [outLevel, setOutLevel] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [latency, setLatency] = useState(0);
  const [diagnostics, setDiagnostics] = useState({
    estimatedMs: 0,
    queuedBlocks: 0,
    droppedBlocks: 0,
    playbackQueuedMs: 0,
    playbackDroppedMs: 0,
    underrunMs: 0,
    recentDroppedBlocks: 0,
    recentUnderrunMs: 0,
  });
  const [roundTrip, setRoundTrip] = useState(0);
  const [realtimeToolsOpen, setRealtimeToolsOpen] = useState(false);
  const {
    calibrating,
    calibrationResults,
    calibrationError,
    calibrationCurrent,
    calibrationProgress,
    calibrationActivity,
    calibrationKey,
    calibrationControllerRef,
    calibrationMeterRef,
    calibrationCountersRef,
    calibrateHardware,
  } = useRealtimeCalibration({
    getSession: () => sessRef.current,
    canStart: () => streaming && !recOn && !passthrough && inGain !== 0,
    autoChunk,
    getContext: () => calibrationContextRef.current,
    setChunkMs,
    onRestoreFailure: () => stopStream(true),
  });
  // Preset values waiting for the debounce window to close.
  const pendingPresetRef = useRef<{
    model: string;
    values: Record<string, string | number | boolean>;
  } | null>(null);
  const [inputLevel, setInputLevel] = useState<{ rms: number | null; at: number }>({ rms: null, at: 0 });
  const [msg, setMsg] = useState("");
  const [recOn, setRecOn] = useState(false);
  const [recPath, setRecPath] = useState("assets/audios/record_audio.wav");
  const [recFormat, setRecFormat] = useState("WAV");

  const speakers = useSpeakers(model);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  const sessRef = useRef<RealtimeAudioSession | null>(null);
  const streamEpochRef = useRef(0);
  const [applyingSettings, setApplyingSettings] = useState(false);
  const [applyingAudio, setApplyingAudio] = useState(false);
  const audioApplyCountRef = useRef(0);
  const audioRoutingRef = useRef({ input: "", output: "", focus: "off" as VoiceFocusVariant });
  const outGainNodeRef = useRef<GainNode | null>(null);
  const monitorGainNodeRef = useRef<GainNode | null>(null);
  const outAnalyserRef = useRef<AnalyserNode | null>(null);
  const micMeterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorElRef = useRef<HTMLAudioElement | null>(null);

  // Keep local output/monitor gains in sync without reconnecting.
  useEffect(() => {
    if (outGainNodeRef.current) {
      outGainNodeRef.current.gain.setTargetAtTime(
        outGain / 100,
        outGainNodeRef.current.context.currentTime,
        0.02,
      );
    }
  }, [outGain]);

  useEffect(() => {
    if (monitorGainNodeRef.current) {
      const target = monitorSelf ? monitorVolume / 100 : 0;
      monitorGainNodeRef.current.gain.setTargetAtTime(
        target,
        monitorGainNodeRef.current.context.currentTime,
        0.02,
      );
    }
    // (Re)trigger local playback within the user's gesture.
    if (monitorSelf) monitorElRef.current?.play().catch(() => {});
  }, [monitorSelf, monitorVolume]);

  useEffect(() => {
    return () => {
      if (micMeterTimerRef.current) clearInterval(micMeterTimerRef.current);
    };
  }, []);

  function startOutMeter() {
    if (micMeterTimerRef.current) clearInterval(micMeterTimerRef.current);
    const analyser = outAnalyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    micMeterTimerRef.current = setInterval(() => {
      if (!activeRef.current || document.hidden) return;
      try {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        setOutLevel(Math.round(Math.min(1, peak * 1.4) * 100));
      } catch {
        /* ignore */
      }
    }, 120);
  }

  function stopOutMeter() {
    if (micMeterTimerRef.current) clearInterval(micMeterTimerRef.current);
    micMeterTimerRef.current = null;
    outAnalyserRef.current = null;
    setOutLevel(0);
  }

  const refreshEngine = useCallback(async () => {
    try {
      // Status polls must bypass the apiGet cache or engine state freezes.
      setEngine(await apiGet<RtStatus>("/api/realtime/status", { ttlMs: 0 }));
    } catch (e) {
      setMsg(errMsg(e));
    }
  }, []);

  function loadModels() {
    fetchModels()
      .then((m) => {
        setModels(m.models);
        setIndexes(m.indexes);
        // Keep the current voice on manual refresh; otherwise prefer last
        // session's model when it still exists.
        const saved = savedModelRef.current;
        const keep =
          model && m.models.includes(model)
            ? model
            : saved && m.models.includes(saved)
              ? saved
              : (m.models[0] ?? "");
        if (!keep) return;
        let idx: string;
        if (keep === model) {
          idx = m.indexes.includes(index) ? index : matchIndex(keep, m.indexes);
        } else {
          const savedIdx = savedIndexRef.current;
          idx =
            keep === saved && savedIdx && m.indexes.includes(savedIdx)
              ? savedIdx
              : matchIndex(keep, m.indexes);
        }
        setModel(keep);
        setIndex(idx);
        if (keep !== model && (getModelPreset("realtime", keep) || keep !== saved))
          restoreRealtimePreset(keep);
      })
      .catch(() => {})
      .finally(() => {
        settingsLoadedRef.current = true;
      });
  }

  const modelPresets = useModelPresets();
  function restoreRealtimePreset(selected: string) {
    const values = { ...REALTIME_PRESET_DEFAULTS, ...getModelPreset("realtime", selected) };
    const num = (v: unknown, min: number, max: number, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
    const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
    setPitch(num(values.pitch, -24, 24, 0));
    setIndexRate(num(values.index_rate, 0, 1, 0));
    setProtect(num(values.protect, 0, 0.5, 0.5));
    setVolumeEnvelope(num(values.volume_envelope, 0, 1, 1));
    setAutotune(bool(values.autotune, false));
    setAutotuneStrength(num(values.autotune_strength, 0, 1, 1));
    setProposedPitch(bool(values.proposed_pitch, false));
    setProposedPitchThreshold(num(values.proposed_pitch_threshold, 50, 1200, 155));
    setFormantShifting(bool(values.formant_shifting, false));
    setFormantQfrency(num(values.formant_qfrency, 0, 16, 1));
    setFormantTimbre(num(values.formant_timbre, 0.1, 16, 1));
    setSid(num(values.sid, 0, 63, 0));
    const method = str(values.f0_method, "fcpe");
    setF0Method(REALTIME_F0_METHODS.includes(method) ? method : "fcpe");
    const embedder = str(values.embedder_model, "contentvec");
    setEmbedder(EMBEDDER_MODELS.includes(embedder) ? embedder : "contentvec");
    setEmbedderCustom(str(values.embedder_model_custom));
  }

  const configDebounceRef = useRef<Record<string, NodeJS.Timeout>>({});

  // ---- Persisted settings (server config.json "realtime" section) ----
  const settingsLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedModelRef = useRef("");
  const savedIndexRef = useRef("");
  const settingsRef = useRef<Record<string, unknown>>({});

  function applyRealtimeSettings(rt: Record<string, unknown>) {
    const num = (v: unknown, min: number, max: number, fb: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
    const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
    const str = (v: unknown, fb = "") => (typeof v === "string" ? v : fb);
    const device = (v: unknown) => {
      const id = str(v);
      return id === "default" || id === "communications" ? "" : id;
    };
    if (typeof rt.model_file === "string" && rt.model_file) savedModelRef.current = rt.model_file;
    if (typeof rt.index_file === "string" && rt.index_file) savedIndexRef.current = rt.index_file;
    setInDev(device(rt.input_device));
    setOutDev(device(rt.output_device));
    setPitch(num(rt.pitch, -24, 24, 0));
    setIndexRate(num(rt.index_rate, 0, 1, 0));
    setProtect(num(rt.protect, 0, 0.5, 0.5));
    setVolumeEnvelope(num(rt.volume_envelope, 0, 1, 1));
    setSid(Math.max(0, Math.round(num(rt.sid, 0, 63, 0))));
    if (typeof rt.f0_method === "string" && REALTIME_F0_METHODS.includes(rt.f0_method))
      setF0Method(rt.f0_method);
    if (typeof rt.embedder_model === "string" && EMBEDDER_MODELS.includes(rt.embedder_model))
      setEmbedder(rt.embedder_model);
    setEmbedderCustom(str(rt.embedder_model_custom));
    setAutotune(bool(rt.autotune, false));
    setDecoderFp16(bool(rt.decoder_fp16, false));
    if (["off", "c20", "c50", "c100"].includes(String(rt.voice_focus)))
      setVoiceFocus(rt.voice_focus as VoiceFocusVariant);
    setAutotuneStrength(num(rt.autotune_strength, 0, 1, 1));
    setProposedPitch(bool(rt.proposed_pitch, false));
    setProposedPitchThreshold(num(rt.proposed_pitch_threshold, 50, 1200, 155));
    setFormantShifting(bool(rt.formant_shifting, false));
    setFormantQfrency(num(rt.formant_qfrency, 0, 16, 1));
    setFormantTimbre(num(rt.formant_timbre, 0.1, 16, 1));
    setChunkMs(num(rt.chunk_ms, 20, 1000, 30));
    setAutoChunk(bool(rt.auto_chunk, true));
    setCrossfade(num(rt.cross_fade_overlap_size, 0.05, 0.2, 0.05));
    setExtraSize(num(rt.extra_convert_size, 0.1, 5, 2.5));
    setSilent(num(rt.silent_threshold, -90, -30, -60));
    setVad(bool(rt.vad_enabled, true));
    setInGain(num(rt.input_audio_gain, 0, 200, 100));
    setPassthroughHotkey(str(rt.passthrough_hotkey, "CommandOrControl+Alt+V"));
    setOutGain(num(rt.output_audio_gain, 0, 200, 100));
    setMonitorSelf(bool(rt.monitor_enabled, false));
    setMonitorVolume(num(rt.monitor_volume, 0, 200, 100));
    setRecPath(str(rt.record_audio_path, "assets/audios/record_audio.wav"));
    if (
      typeof rt.export_format === "string" &&
      ["WAV", "MP3", "FLAC", "OGG", "M4A"].includes(rt.export_format)
    )
      setRecFormat(rt.export_format);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch and unmount cleanup
  useEffect(() => {
    refreshEngine();
    // Restore last session's settings before picking defaults.
    void apiGet<{ realtime?: Record<string, unknown> }>("/api/realtime/config", { ttlMs: 0 })
      .then((cfg) => {
        if (cfg?.realtime) applyRealtimeSettings(cfg.realtime);
      })
      .catch(() => {})
      .finally(() => {
        void loadModelPresets().then(() => loadModels());
      });
    void apiSend("/api/realtime/prewarm", "POST").catch(() => {});
    void enumDevices();
    const refreshDevices = () => void enumDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    const t = setInterval(refreshEngine, 5000);
    return () => {
      clearInterval(t);
      navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
      stopStream(true);
      setRealtimeGpuReserved(false);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void apiSend("/api/realtime/config", "PUT", settingsRef.current).catch(() => {});
      }
      for (const timer of Object.values(configDebounceRef.current)) clearTimeout(timer);
    };
  }, []);

  // The scheduler reserves the GPU for the whole streaming session, so keep
  // the app-wide warning banner in sync with the engine status poll.
  useEffect(() => {
    setRealtimeGpuReserved(Boolean(engine?.scheduling?.realtime));
  }, [engine]);

  function handleModelSelect(selected: string, idxList = indexes) {
    if (selected === model) return;
    if (model && settingsLoadedRef.current)
      saveModelPreset("realtime", model, realtimePreset(settingsRef.current));
    // Cancel pending slider updates from the previous voice before restoring.
    for (const timer of Object.values(configDebounceRef.current)) clearTimeout(timer);
    configDebounceRef.current = {};
    restoreRealtimePreset(selected);
    setModel(selected);
    setIndex(matchIndex(selected, idxList));
  }

  function handleUnloadModel() {
    if (streaming) stopStream(false);
    setModel("");
    setIndex("");
    setSid(0);
  }

  // Prefer concrete devices so default aliases cannot silently change routing.
  function dedupeDevices(devs: Array<{ id: string; label: string }>) {
    const seen = new Set<string>();
    return devs.filter((d) => {
      if (!d.id || d.id === "default" || d.id === "communications") return false;
      const base = d.label.replace(/^(Default|Communications)\s*-\s*/i, "").trim() || d.label;
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    });
  }

  async function enumDevices() {
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => {
        track.stop();
      });
      const devs = await navigator.mediaDevices.enumerateDevices();
      const ins = dedupeDevices(
        devs
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` })),
      );
      const outs = dedupeDevices(
        devs
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })),
      );
      // Some browsers expose microphones but no output devices. Web Audio can
      // still play through the system default without enumerating that output.
      const defaultOutput = outs.length === 0;
      if (defaultOutput) outs.push({ id: DEFAULT_REALTIME_OUTPUT, label: t("Default") });
      setInputs(ins);
      setOutputs(outs);
      // Drop selections (e.g. restored from last session) that no longer exist.
      setInDev((cur) => (cur && !ins.some((d) => d.id === cur) ? "" : cur));
      setOutDev((cur) =>
        defaultOutput ? DEFAULT_REALTIME_OUTPUT : cur && !outs.some((d) => d.id === cur) ? "" : cur,
      );
    } catch {
      setMsg(t("Microphone permission denied — device list unavailable."));
    }
  }

  async function selectVoiceFocus(next: VoiceFocusVariant) {
    setVoiceFocusError("");
    if (next === "off") {
      setVoiceFocus("off");
      return;
    }
    if (voiceFocusUnsupported) {
      setMsg(t("Voice Focus is not available on this system."));
      return;
    }
    if (!(await voiceFocusSupported())) {
      setVoiceFocusUnsupported(true);
      setMsg(t("Voice Focus is not available on this system."));
      return;
    }
    setVoiceFocus(next);
  }

  async function startStream() {
    if (connecting || sessRef.current) return;
    if (!modelPresets.loaded || !settingsLoadedRef.current) {
      setMsg(t("Loading model settings…"));
      return;
    }
    setMsg("");
    if (!model) {
      setMsg(t("Select a voice model."));
      return;
    }
    if (!devicesSelected) {
      setMsg(t("Select input and output devices before starting realtime."));
      document.getElementById(!inputSelected ? "rt-in-dev" : "rt-out-dev")?.focus();
      return;
    }
    setConnecting(true);
    const openingEpoch = ++streamEpochRef.current;
    // Start the backend engine on demand so there is no separate step.
    if (!engine?.running) {
      setMsg(t("Starting real-time audio service…"));
      try {
        await apiSend("/api/realtime/start", "POST");
        if (openingEpoch !== streamEpochRef.current) return;
        const st = await apiGet<RtStatus>("/api/realtime/status", { ttlMs: 0 });
        if (openingEpoch !== streamEpochRef.current) return;
        setEngine(st);
        if (!st.running) throw new Error(t("Real-time audio service did not start."));
      } catch (e) {
        if (openingEpoch !== streamEpochRef.current) return;
        setConnecting(false);
        setMsg(errMsg(e));
        return;
      }
    }
    let openingStream: MediaStream | undefined;
    let openingContext: AudioContext | undefined;
    let openingVoiceFocusCleanup: (() => Promise<void>) | undefined;
    try {
      let block = Math.round(((autoChunk ? 100 : chunkMs) * 48000) / 1000);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: realtimeMicrophoneConstraints(inDev, voiceFocus),
      });
      openingStream = stream;
      if (openingEpoch !== streamEpochRef.current) throw new Error("Stream start cancelled");
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
      openingContext = ctx;
      const inputBlob = new Blob([INPUT_WORKLET], { type: "application/javascript" });
      const inputBlobUrl = URL.createObjectURL(inputBlob);
      try {
        await ctx.audioWorklet.addModule(inputBlobUrl);
      } finally {
        URL.revokeObjectURL(inputBlobUrl);
      }

      const playbackBlob = new Blob([PLAYBACK_WORKLET], { type: "application/javascript" });
      const playbackBlobUrl = URL.createObjectURL(playbackBlob);
      try {
        await ctx.audioWorklet.addModule(playbackBlobUrl);
      } finally {
        URL.revokeObjectURL(playbackBlobUrl);
      }
      const src = ctx.createMediaStreamSource(stream);
      const inNode = new AudioWorkletNode(ctx, "input-processor");
      // This worklet sends samples over its message port and writes silence
      // to its output. Keep it connected so WebKit pulls the entire capture
      // branch, including Voice Focus, even while playback has no data yet.
      inNode.connect(ctx.destination);
      if (voiceFocus === "off") src.connect(inNode);
      else {
        try {
          openingVoiceFocusCleanup = await connectVoiceFocus(ctx, src, inNode, stream, voiceFocus);
        } catch (error) {
          // Voice Focus needs worklets and CDN assets that stripped-down
          // system WebViews can reject. Keep the microphone live on the raw
          // path instead of failing the whole stream.
          openingVoiceFocusCleanup = undefined;
          setVoiceFocusUnsupported(true);
          setVoiceFocusError(errMsg(error));
          setVoiceFocus("off");
          await stream.getAudioTracks()[0]?.applyConstraints(realtimeMicrophoneConstraints(inDev, "off"));
          src.connect(inNode);
          setMsg(
            t("Voice Focus could not start, using the raw microphone: {message}", {
              message: t(errMsg(error)),
            }),
          );
        }
        if (openingEpoch !== streamEpochRef.current) throw new Error("Stream start cancelled");
        if (openingVoiceFocusCleanup) voiceFocusCleanupRef.current = openingVoiceFocusCleanup;
      }
      const playNode = new AudioWorkletNode(ctx, "playback-processor", { outputChannelCount: [2] });
      src.connect(playNode);
      playNode.port.postMessage({ passthrough: false, inputGain: inGain / 100 });
      const gain = ctx.createGain();
      gain.gain.value = outGain / 100;
      playNode.connect(gain);
      const outputElements = await connectRealtimeOutput(ctx, gain, outDev);
      if (openingEpoch !== streamEpochRef.current) {
        outputElements.forEach((element) => {
          element.pause();
        });
        throw new Error("Stream start cancelled");
      }
      // Local monitor: converted output -> monitor gain -> default playback
      // device, independent of the selected output device (e.g. a virtual
      // cable feeding a voice call). Keep muted until enabled to avoid feedback.
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = monitorSelf ? monitorVolume / 100 : 0;
      const monitorDest = ctx.createMediaStreamDestination();
      playNode.connect(monitorGain);
      monitorGain.connect(monitorDest);
      const monitorEl = new Audio();
      monitorEl.srcObject = monitorDest.stream;
      monitorEl.play().catch(() => {
        /* retried on user gesture via the monitor toggle/volume effect */
      });
      monitorElRef.current = monitorEl;
      const outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 512;
      playNode.connect(outAnalyser);
      outGainNodeRef.current = gain;
      monitorGainNodeRef.current = monitorGain;
      outAnalyserRef.current = outAnalyser;
      startOutMeter();

      const ws = new WebSocket(apiWs("/api/realtime/ws-audio"));
      ws.binaryType = "arraybuffer";
      let sentAt = 0;
      let lastRoundTrip = 0;
      let lastCaptureQueueMs = 0;
      let lastProcessingMs = 0;
      let lastInputRms = 0;
      let retryEager = false;
      const sender = new RealtimeAudioSender((chunk) => {
        lastCaptureQueueMs = sender.queueDelayMs;
        sentAt = performance.now();
        ws.send(chunk);
      });
      const liveSettings = new RealtimeSettingsSender(
        sender,
        (message) => ws.send(message),
        (frames) => {
          if (frames !== block) {
            block = frames;
            if (sessRef.current?.ws === ws) sessRef.current.blockFrame = frames;
            if (!calibrationControllerRef.current) setChunkMs(frames / 48);
            inNode.port.postMessage({ block_frame: frames, reset: true });
          }
        },
        (applying, error, fatal) => {
          if (sessRef.current?.ws !== ws) return;
          setApplyingSettings(applying);
          if (fatal) stopStream(true);
          if (error) setMsg(t("Could not apply settings: {message}", { message: error }));
          else if (!applying) setMsg(t("Settings applied"));
        },
      );
      setInputLevel({ rms: null, at: 0 });
      setDiagnostics({
        estimatedMs: 0,
        queuedBlocks: 0,
        droppedBlocks: 0,
        playbackQueuedMs: 0,
        playbackDroppedMs: 0,
        underrunMs: 0,
        recentDroppedBlocks: 0,
        recentUnderrunMs: 0,
      });
      const inputLatency =
        (stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ||
        0;
      const healthWindow = new RealtimeHealthWindow();
      let nextDiagnosticsAt = 0;
      let nextTelemetryAt = 0;
      const telemetryInterval = () => (activeRef.current && !document.hidden ? 100 : 1000);
      calibrationCountersRef.current = { droppedBlocks: 0, underrunMs: 0, playbackDroppedMs: 0 };
      playNode.port.onmessage = (event) => {
        const stats = event.data.stats;
        if (!stats || sessRef.current?.ws !== ws) return;
        calibrationCountersRef.current = {
          droppedBlocks: sender.droppedBlocks,
          underrunMs: (stats.underrunFrames / ctx.sampleRate) * 1000,
          playbackDroppedMs: (stats.droppedFrames / ctx.sampleRate) * 1000,
        };
        const now = performance.now();
        const health = healthWindow.push(
          now,
          sender.droppedBlocks,
          (stats.underrunFrames / ctx.sampleRate) * 1000,
        );
        if (now < nextDiagnosticsAt) return;
        nextDiagnosticsAt = now + telemetryInterval();
        setDiagnostics({
          ...health,
          estimatedMs:
            (block / ctx.sampleRate) * 1000 +
            crossfade * 1000 +
            (sessRef.current?.inputLatencyMs ?? inputLatency * 1000) +
            lastCaptureQueueMs +
            lastRoundTrip +
            stats.queuedMs +
            (ctx.outputLatency || ctx.baseLatency || 0) * 1000,
          queuedBlocks: sender.queuedBlocks,
          droppedBlocks: sender.droppedBlocks,
          playbackQueuedMs: stats.queuedMs,
          playbackDroppedMs: (stats.droppedFrames / ctx.sampleRate) * 1000,
          underrunMs: (stats.underrunFrames / ctx.sampleRate) * 1000,
        });
      };
      sessRef.current = {
        ws,
        ctx,
        stream,
        nodes: [src, inNode, playNode, gain, monitorGain, monitorDest, outAnalyser],
        playback: playNode,
        els: outputElements,
        settings: liveSettings,
        inputLatencyMs: inputLatency * 1000,
        blockFrame: block,
      };
      audioRoutingRef.current = { input: inDev, output: outDev, focus: voiceFocus };
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "init",
            block_frame: block,
            automatic_block_size: autoChunk,
            cross_fade_overlap_size: crossfade,
            extra_convert_size: extraSize,
            model_path: model,
            index_path: index || "",
            f0_method: f0Method,
            embedder_model: embedder,
            embedder_model_custom: embedder === "custom" ? embedderCustom : "",
            silent_threshold: silent,
            vad_enabled: vad,
            sid,
            input_audio_gain: inGain,
            f0_up_key: pitch,
            index_rate: indexRate,
            protect,
            volume_envelope: volumeEnvelope,
            autotune,
            decoder_fp16: decoderFp16,
            autotune_strength: autotuneStrength,
            proposed_pitch: proposedPitch,
            proposed_pitch_threshold: proposedPitchThreshold,
            formant_shifting: formantShifting,
            formant_qfrency: formantQfrency,
            formant_timbre: formantTimbre,
          }),
        );
        setMsg(t("Preparing realtime model…"));
        apiSend("/api/realtime/config", "PUT", { model_file: model, index_file: index }).catch(() => {});
      };
      inNode.port.onmessage = (e) => {
        const chunk: Float32Array = e.data.chunk;
        if (ws.readyState === WebSocket.OPEN && chunk.length === block) sender.capture(chunk);
      };
      ws.onmessage = (ev) => {
        if (sessRef.current?.ws !== ws) return;
        if (typeof ev.data === "string") {
          try {
            const m = JSON.parse(ev.data);
            if (liveSettings.receive(m)) return;
            if (m.type === "retry_eager") retryEager = true;
            if (m.type === "error") setMsg(String(m.message));
            if (m.type === "ready") {
              if (Number.isInteger(m.block_frame) && m.block_frame >= 480 && m.block_frame <= 48000) {
                block = m.block_frame;
                if (sessRef.current?.ws === ws) sessRef.current.blockFrame = block;
                setChunkMs(Math.round(block / 48));
              }
              setConnecting(false);
              sender.start();
              inNode.port.postMessage({ block_frame: block, reset: true });
              setStreaming(true);
              setMsg(t("Streaming ✓ speak into your microphone."));
            }
            if (m.type === "latency" && Number.isFinite(m.value)) {
              lastProcessingMs = m.value;
            }
            if (typeof m.volume === "number" && Number.isFinite(m.volume) && m.volume >= 0)
              lastInputRms = m.volume;
          } catch {
            /* ignore */
          }
        } else {
          lastRoundTrip = performance.now() - sentAt;
          const now = performance.now();
          if (now >= nextTelemetryAt) {
            nextTelemetryAt = now + telemetryInterval();
            setRoundTrip(lastRoundTrip);
            setLatency(lastProcessingMs);
            setInputLevel({ rms: lastInputRms, at: now });
          }
          if (calibrationControllerRef.current) {
            const rendered = new Float32Array(ev.data);
            const convertedSignal = rendered.some((sample) => Math.abs(sample) > 0.00001);
            calibrationMeterRef.current.reply(lastProcessingMs, lastRoundTrip, lastInputRms, convertedSignal);
          }
          playNode.port.postMessage({ chunk: ev.data }, [ev.data]);
          sender.acknowledge();
        }
      };
      ws.onclose = () => {
        if (sessRef.current?.ws !== ws) return;
        stopStream(true);
        if (retryEager) {
          const recoveryEpoch = streamEpochRef.current;
          setMsg(t("Restarting realtime with compatible inference…"));
          apiSend("/api/realtime/start", "POST", {})
            .then(() => {
              if (streamEpochRef.current === recoveryEpoch) return reconnectRef.current();
            })
            .catch((error) => setMsg(errMsg(error)));
        }
      };
      ws.onerror = () => {
        if (sessRef.current?.ws === ws) setMsg(t("WebSocket error — is the engine running?"));
      };
    } catch (e) {
      if (openingEpoch === streamEpochRef.current) {
        setConnecting(false);
        setMsg(t(errMsg(e)));
        stopStream(true);
      }
      await openingVoiceFocusCleanup?.().catch(() => {});
      openingStream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (openingContext?.state !== "closed") await openingContext?.close();
    }
  }

  const reconnectRef = useRef(startStream);
  reconnectRef.current = startStream;
  const beforeMuteGainRef = useRef(100);
  useRealtimeTray(
    {
      connecting,
      streaming,
      model,
      processingMs: latency,
      roundTripMs: roundTrip,
      muted: inGain === 0,
      monitor: monitorSelf,
    },
    (action) => {
      if (calibrationControllerRef.current && action !== "stop") return;
      if (action === "start") void startStream();
      else if (action === "stop") stopStream(false);
      else if (streaming) {
        if (action === "monitor-on" || action === "monitor-off") setMonitorSelf(action === "monitor-on");
        else if (action === "passthrough-toggle") setPassthrough((value) => !value);
        else {
          if (action === "mute" && inGain > 0) beforeMuteGainRef.current = inGain;
          const gain = action === "mute" ? 0 : beforeMuteGainRef.current;
          setInGain(gain);
          void changeConfig("input_audio_gain", gain);
        }
      }
    },
  );

  // Latest controls for tray-driven start/stop (Tauri) and autostart.
  const controlRef = useRef({ start: () => {}, stop: (_silent?: boolean) => {} });
  controlRef.current = {
    start: () => void startStream(),
    stop: (silent = false) => stopStream(silent),
  };
  const trayAutoStartedRef = useRef(false);

  useEffect(() => {
    if (streaming) sessRef.current?.playback.port.postMessage({ passthrough, inputGain: inGain / 100 });
  }, [passthrough, inGain, streaming]);

  useEffect(() => {
    let cancelled = false;
    const bridge = (
      window as unknown as {
        applio?: { setPassthroughHotkey: (accelerator: string) => Promise<{ registered: boolean }> };
      }
    ).applio;
    if (!bridge?.setPassthroughHotkey) return;
    // Register only while streaming; shortcuts stay free for other apps at idle.
    const timer = setTimeout(() => {
      void bridge
        .setPassthroughHotkey(streaming ? passthroughHotkey.trim() : "")
        .then((result) => {
          if (!cancelled) setHotkeyAvailable(result.registered);
        })
        .catch(() => {
          if (!cancelled) setHotkeyAvailable(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void bridge.setPassthroughHotkey("");
    };
  }, [passthroughHotkey, streaming]);

  // Tray "Start Realtime" navigates here with #autostart when the tab is not
  // mounted yet: begin streaming once settings and the voice are ready.
  useEffect(() => {
    if (trayAutoStartedRef.current) return;
    if (typeof window === "undefined" || window.location.hash !== "#autostart") return;
    if (!settingsLoadedRef.current || !model) return;
    trayAutoStartedRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    controlRef.current.start();
  });

  function stopStream(silentStop = false) {
    calibrationControllerRef.current?.abort();
    calibrationMeterRef.current.stop();
    setPassthrough(false);
    const cleanup = voiceFocusCleanupRef.current;
    voiceFocusCleanupRef.current = null;
    void cleanup?.().catch(() => {});
    ++streamEpochRef.current;
    setConnecting(false);
    stopOutMeter();
    outGainNodeRef.current = null;
    monitorGainNodeRef.current = null;
    const mel = monitorElRef.current;
    monitorElRef.current = null;
    try {
      mel?.pause();
    } catch {
      /* noop */
    }
    try {
      if (mel) mel.srcObject = null;
    } catch {
      /* noop */
    }
    const s = sessRef.current;
    s?.settings.dispose();
    setApplyingSettings(false);
    sessRef.current = null;
    try {
      s?.ws.close();
    } catch {
      /* noop */
    }
    try {
      s?.stream.getTracks().forEach((t) => {
        t.stop();
      });
    } catch {
      /* noop */
    }
    try {
      s?.nodes.forEach((n) => {
        n.disconnect();
      });
    } catch {
      /* noop */
    }
    try {
      s?.els.forEach((el) => {
        el.pause();
      });
    } catch {
      /* noop */
    }
    try {
      s?.ctx.close();
    } catch {
      /* noop */
    }
    setStreaming(false);
    // The backend also stops the engine when the audio socket closes, but
    // stop it explicitly so no dead service lingers (including a prewarmed
    // engine when leaving the page without ever streaming).
    void apiSend("/api/realtime/stop", "POST")
      .catch(() => {})
      .finally(() => refreshEngine());
    if (!silentStop) setMsg(t("Stopped."));
  }

  function changeConfig(key: string, value: number | string | boolean, ifKwargs = false) {
    if (key !== "output_audio_gain") sessRef.current?.settings.update(key, value, ifKwargs);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: debounced config wrapper
  const changeConfigDebounced = useCallback(
    (key: string, value: number | string | boolean, ifKwargs = false) => {
      if (configDebounceRef.current[key]) clearTimeout(configDebounceRef.current[key]);
      configDebounceRef.current[key] = setTimeout(() => {
        changeConfig(key, value, ifKwargs);
      }, 100);
    },
    [],
  );

  async function toggleRecord() {
    setMsg("");
    if (!streaming) {
      setMsg(t("Start streaming first."));
      return;
    }
    try {
      const r = await apiSend<{ type: string; value: string; button: string; path: string | null }>(
        "/api/realtime/record",
        "POST",
        {
          record_button: recOn ? "Stop" : "Start",
          record_audio_path: recPath || undefined,
          export_format: recFormat,
        },
      );
      setRecOn(r.button === "Stop");
      setMsg(r.value + (r.path ? `: ${r.path}` : ""));
    } catch (e) {
      setMsg(errMsg(e));
    }
  }

  // Snapshot of every persistable setting. Serialized so the debounced
  // save effect below has a single stable dependency.
  const settingsSnapshot: Record<string, unknown> = {
    model_file: model,
    index_file: index,
    input_device: inDev,
    output_device: outDev,
    pitch,
    index_rate: indexRate,
    protect,
    volume_envelope: volumeEnvelope,
    sid,
    f0_method: f0Method,
    embedder_model: embedder,
    embedder_model_custom: embedderCustom,
    autotune,
    decoder_fp16: decoderFp16,
    voice_focus: voiceFocus,
    autotune_strength: autotuneStrength,
    proposed_pitch: proposedPitch,
    proposed_pitch_threshold: proposedPitchThreshold,
    formant_shifting: formantShifting,
    formant_qfrency: formantQfrency,
    formant_timbre: formantTimbre,
    chunk_ms: chunkMs,
    auto_chunk: autoChunk,
    cross_fade_overlap_size: crossfade,
    extra_convert_size: extraSize,
    silent_threshold: silent,
    vad_enabled: vad,
    passthrough_hotkey: passthroughHotkey,
    input_audio_gain: inGain,
    output_audio_gain: outGain,
    monitor_enabled: monitorSelf,
    monitor_volume: monitorVolume,
    record_audio_path: recPath,
    export_format: recFormat,
  };
  settingsRef.current = settingsSnapshot;
  const settingsKey = JSON.stringify(settingsSnapshot);
  const calibrationContextKey = JSON.stringify({
    ...settingsSnapshot,
    chunk_ms: undefined,
    auto_chunk: undefined,
  });
  const calibrationContextRef = useRef(calibrationContextKey);
  calibrationContextRef.current = calibrationContextKey;

  useEffect(() => {
    if (!model || !settingsLoadedRef.current || !modelPresets.loaded) return;
    const values = realtimePreset(JSON.parse(settingsKey));
    pendingPresetRef.current = { model, values };
    const timer = setTimeout(() => {
      pendingPresetRef.current = null;
      saveModelPreset("realtime", model, values);
    }, 500);
    // Only the timer is cleared here. Saving on every cleanup would defeat the
    // debounce and write the preset file on each slider tick.
    return () => clearTimeout(timer);
    // Snapshot includes every model parameter; global changes are deduplicated below.
  }, [model, settingsKey, modelPresets.loaded]);

  // Switching model or unmounting must not lose the last pending preset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cleanup must run when the model changes
  useEffect(() => {
    return () => {
      const pending = pendingPresetRef.current;
      if (!pending) return;
      pendingPresetRef.current = null;
      saveModelPreset("realtime", pending.model, pending.values);
    };
  }, [model]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    // No cleanup clear here: the mount effect flushes any pending save on
    // unmount, and a stray fire-and-forget PUT after unmount is harmless.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      try {
        const body = JSON.parse(settingsKey) as Record<string, unknown>;
        void apiSend("/api/realtime/config", "PUT", body).catch(() => {});
      } catch {
        /* noop */
      }
    }, 800);
  }, [settingsKey]);

  useRealtimeAudioRouting({
    sessRef,
    streaming,
    inDev,
    controlRef,
    setMsg,
    audioRoutingRef,
    voiceFocus,
    audioApplyCountRef,
    setApplyingAudio,
    voiceFocusCleanupRef,
    setVoiceFocusError,
    setInDev,
    setVoiceFocus,
    outDev,
    outGainNodeRef,
    setOutDev,
  });

  const selectedLiveSettings = {
    ...realtimePreset(settingsSnapshot),
    f0_up_key: pitch,
    model_path: model,
    index_path: index,
    sid,
    f0_method: f0Method,
    embedder_model: embedder,
    embedder_model_custom: embedderCustom,
    automatic_block_size: autoChunk,
    block_frame: Math.round(chunkMs * 48),
  };
  const selectedLiveKey = JSON.stringify(selectedLiveSettings);
  const previousLiveSettingsRef = useRef(selectedLiveSettings);
  useEffect(() => {
    const current = JSON.parse(selectedLiveKey) as typeof selectedLiveSettings;
    const previous = previousLiveSettingsRef.current;
    previousLiveSettingsRef.current = current;
    if (!streaming || !sessRef.current || calibrationControllerRef.current) return;
    for (const [key, value] of Object.entries(current)) {
      if (key === "block_frame" && current.automatic_block_size) continue;
      if (key === "pitch") continue;
      if (value !== previous[key as keyof typeof previous]) {
        const effect = ![
          "sid",
          "f0_method",
          "embedder_model",
          "embedder_model_custom",
          "f0_up_key",
          "index_rate",
          "protect",
          "volume_envelope",
          "autotune",
          "autotune_strength",
          "proposed_pitch",
          "proposed_pitch_threshold",
          "formant_shifting",
          "formant_qfrency",
          "formant_timbre",
          "model_path",
          "index_path",
          "automatic_block_size",
          "block_frame",
        ].includes(key);
        sessRef.current.settings.update(key, value, effect);
      }
    }
  }, [selectedLiveKey, streaming, calibrationControllerRef]);

  useEffect(() => {
    if (calibrating || recOn) setRealtimeToolsOpen(true);
  }, [calibrating, recOn]);

  return (
    <div className="w-full max-w-[1920px] mx-auto page-stack">
      <PageHeader
        title={t("Realtime")}
        description={t(
          "Stream low-latency live microphone audio through voice conversion models in real time.",
        )}
      >
        <Badge variant={engine?.running ? "success" : "neutral"} dot>
          {engine?.running ? t("active") : t("stopped")}
        </Badge>
      </PageHeader>
      <p className="text-xs text-neutral-400" role="status" aria-live="polite">
        {applyingSettings || applyingAudio ? t("Applying settings…") : t("Settings apply while streaming.")}
      </p>
      {msg && (
        <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
          {msg}
        </p>
      )}

      <fieldset disabled={calibrating} className="min-w-0 border-0 m-0 p-0">
        <VoiceModelCard
          step={1}
          models={models}
          selectedModel={model}
          indexes={indexes}
          indexPath={index}
          indexSelectId="rt-index-file"
          onSelect={handleModelSelect}
          onUnload={handleUnloadModel}
          onRefresh={loadModels}
          onIndexChange={setIndex}
          speakers={speakers}
          sid={sid}
          onSpeakerChange={(value) => {
            setSid(value);
            if (streaming) changeConfig("sid", value);
          }}
        />
      </fieldset>

      <RealtimeDevices
        controls={{ calibrating, inDev, setInDev, inputs, outDev, setOutDev, outputs, enumDevices }}
      />

      <Stage
        disabled={calibrating}
        step={3}
        title={t("Tune & Go Live")}
        description={t("Shape the voice, then start streaming from your microphone.")}
        icon={<Play size={18} className="text-white" />}
      >
        <div>
          <SliderField
            id="rt-pitch"
            label={t("Pitch")}
            value={pitch}
            min={-24}
            max={24}
            step={1}
            unit="st"
            onChange={(v) => {
              setPitch(v);
              if (streaming) changeConfigDebounced("f0_up_key", v);
            }}
            description={t(SETTING_HELP.pitch)}
          />
        </div>
        <Disclosure
          title={t("Advanced Settings")}
          icon={<Gauge size={16} />}
          description={t("Fine-tune pitch shifting, index feature retrieval, and audio envelope response.")}
        >
          <RealtimeConversionSettings
            controls={{
              indexRate,
              setIndexRate,
              streaming,
              changeConfigDebounced,
              protect,
              setProtect,
              volumeEnvelope,
              setVolumeEnvelope,
              f0Method,
              setF0Method,
              embedder,
              setEmbedder,
              embedderCustom,
              setEmbedderCustom,
            }}
          />
          <RealtimeVoiceCleanup
            controls={{
              autotune,
              setAutotune,
              streaming,
              changeConfig,
              proposedPitch,
              setProposedPitch,
              autotuneStrength,
              setAutotuneStrength,
              changeConfigDebounced,
              proposedPitchThreshold,
              setProposedPitchThreshold,
            }}
          />
          <RealtimeFormantSettings
            controls={{
              formantShifting,
              setFormantShifting,
              streaming,
              changeConfig,
              formantQfrency,
              setFormantQfrency,
              changeConfigDebounced,
              formantTimbre,
              setFormantTimbre,
            }}
          />
          <RealtimeAudioSettings
            controls={{
              decoderFp16,
              setDecoderFp16,
              streaming,
              changeConfig,
              voiceFocus,
              selectVoiceFocus,
              voiceFocusUnsupported,
              voiceFocusError,
              chunkMs,
              setChunkMs,
              setAutoChunk,
              autoChunk,
              crossfade,
              setCrossfade,
              changeConfigDebounced,
              extraSize,
              setExtraSize,
              silent,
              setSilent,
              inGain,
              setInGain,
              outGain,
              setOutGain,
              vad,
              setVad,
            }}
          />
          <RealtimeMonitorSettings
            controls={{
              monitorSelf,
              setMonitorSelf,
              monitorVolume,
              setMonitorVolume,
              streaming,
              connecting,
              outLevel,
              passthrough,
              setPassthrough,
              passthroughHotkey,
              setPassthroughHotkey,
              hotkeyAvailable,
            }}
          />
        </Disclosure>
        <div className="space-y-4 pt-3">
          <div className="flex items-center gap-3 flex-wrap">
            {!streaming ? (
              <Button
                onClick={startStream}
                disabled={connecting || !devicesSelected}
                icon={<Play size={16} />}
              >
                {connecting ? t("Preparing…") : t("Start Streaming")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => stopStream()}
                icon={<Square size={16} className="text-white" />}
              >
                {t("Stop Streaming")}
              </Button>
            )}
            {!streaming && !devicesSelected && (
              <span className="text-xs text-neutral-400">
                {t("Select input and output devices before starting realtime.")}
              </span>
            )}
            <Badge variant={streaming ? "success" : "neutral"} dot>
              {streaming ? t("live") : connecting ? t("connecting…") : t("idle")}
            </Badge>
            {msg && (
              <span className="text-xs text-neutral-400" role="status">
                {msg}
              </span>
            )}
          </div>

          {!streaming && (
            <p className="text-xs text-neutral-400 m-0">
              {t(
                "While streaming, the GPU is reserved for realtime. Other jobs (inference, TTS, training, separation) wait until you stop.",
              )}
            </p>
          )}

          {streaming && active && (
            <RealtimeDiagnostics
              latency={latency}
              roundTrip={roundTrip}
              input={inputLevel}
              silentThreshold={silent}
              chunkMs={calibrating ? calibrationCurrent : chunkMs}
              autoChunk={calibrating ? false : autoChunk}
              diagnostics={{
                ...diagnostics,
                estimatedMs:
                  diagnostics.estimatedMs +
                  (formantShifting && formantQfrency >= 0.0625 && formantTimbre !== 1 && !passthrough
                    ? 64
                    : 0),
              }}
            />
          )}
        </div>
      </Stage>
      <RealtimeTools
        controls={{
          realtimeToolsOpen,
          setRealtimeToolsOpen,
          streaming,
          connecting,
          applyingSettings,
          applyingAudio,
          recOn,
          passthrough,
          inGain,
          settingsBusy: !!sessRef.current?.settings.busy,
          calibrating,
          calibrationCurrent,
          calibrationResults,
          calibrationKey,
          calibrationContextKey,
          calibrationError,
          calibrationProgress,
          calibrationActivity,
          calibrateHardware,
          cancelCalibration: () => calibrationControllerRef.current?.abort(),
          setChunkMs,
          setAutoChunk,
          recPath,
          setRecPath,
          recFormat,
          setRecFormat,
          toggleRecord,
        }}
      />
    </div>
  );
}
