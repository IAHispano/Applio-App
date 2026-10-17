"use client";

import { Disc, Gauge, Headphones, ListMusic, Play, RefreshCw, Sparkles, Square, Wand2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import RealtimeCalibration from "@/components/RealtimeCalibration";
import RealtimeDiagnostics from "@/components/RealtimeDiagnostics";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Disclosure,
  EMBEDDER_MODELS,
  EmbedderSelect,
  FormField,
  IconButton,
  PitchMethodSelect,
  REALTIME_F0_METHODS,
  ToggleField,
} from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SettingHelp from "@/components/ui/SettingHelp";
import SliderField from "@/components/ui/SliderField";
import VoiceModelCard from "@/components/VoiceModelCard";
import { apiGet, apiSend, errMsg, fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { getModelPreset, loadModelPresets, saveModelPreset, useModelPresets } from "@/lib/model-presets";
import { INPUT_WORKLET, PLAYBACK_WORKLET, RealtimeAudioSender } from "@/lib/realtime-audio";
import {
  CALIBRATION_CANDIDATES,
  CalibrationMeter,
  type CalibrationResult,
  calibrationDelay,
} from "@/lib/realtime-calibration";
import { RealtimeHealthWindow } from "@/lib/realtime-diagnostics";
import { connectRealtimeOutput } from "@/lib/realtime-output";
import { RealtimeSettingsSender } from "@/lib/realtime-settings";
import { realtimeWsUrl } from "@/lib/realtime-ws";
import { SETTING_HELP } from "@/lib/setting-help";
import { useRealtimeTray } from "@/lib/useRealtimeTray";
import { useSpeakers } from "@/lib/useSpeakers";
import { connectVoiceFocus, type VoiceFocusVariant } from "@/lib/voice-focus";

function apiWs(path: string): string {
  return realtimeWsUrl(path);
}

interface RtStatus {
  running: boolean;
  startedAt: string | null;
  logs: string[];
}

function Stage({
  step,
  title,
  description,
  icon,
  children,
  disabled = false,
}: {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Card as="section" aria-label={`${step}. ${title}`}>
      <CardHeader step={step} title={title} description={description} icon={icon} />
      <fieldset disabled={disabled} className="min-w-0 border-0 m-0 p-0">
        {children}
      </fieldset>
    </Card>
  );
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
  const [outDev, setOutDev] = useState("");
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
  const [calibrating, setCalibrating] = useState(false);
  const [realtimeToolsOpen, setRealtimeToolsOpen] = useState(false);
  const [calibrationResults, setCalibrationResults] = useState<CalibrationResult[]>([]);
  const [calibrationError, setCalibrationError] = useState("");
  const [calibrationCurrent, setCalibrationCurrent] = useState(0);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationActivity, setCalibrationActivity] = useState("Preparing…");
  const [calibrationKey, setCalibrationKey] = useState("");
  const calibrationControllerRef = useRef<AbortController | null>(null);
  const calibrationMeterRef = useRef(new CalibrationMeter());
  const calibrationCountersRef = useRef({ droppedBlocks: 0, underrunMs: 0, playbackDroppedMs: 0 });
  const [inputLevel, setInputLevel] = useState<{ rms: number | null; at: number }>({ rms: null, at: 0 });
  const [msg, setMsg] = useState("");
  const [recOn, setRecOn] = useState(false);
  const [recPath, setRecPath] = useState("assets/audios/record_audio.wav");
  const [recFormat, setRecFormat] = useState("WAV");

  const speakers = useSpeakers(model);

  useEffect(() => {
    if (!speakers.includes(sid)) setSid(0);
  }, [speakers, sid]);

  const sessRef = useRef<{
    ws: WebSocket;
    ctx: AudioContext;
    stream: MediaStream;
    nodes: AudioNode[];
    playback: AudioWorkletNode;
    els: HTMLAudioElement[];
    settings: RealtimeSettingsSender;
    inputBridge?: AudioNode;
    outputBridge?: AudioNode;
    inputLatencyMs: number;
    blockFrame: number;
  } | null>(null);
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
    setFormantTimbre(num(values.formant_timbre, 0, 16, 1));
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
    setFormantTimbre(num(rt.formant_timbre, 0, 16, 1));
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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void apiSend("/api/realtime/config", "PUT", settingsRef.current).catch(() => {});
      }
      for (const timer of Object.values(configDebounceRef.current)) clearTimeout(timer);
    };
  }, []);

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

  // Require concrete devices: default aliases can silently change routing.
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
      setInputs(ins);
      setOutputs(outs);
      // Drop selections (e.g. restored from last session) that no longer exist.
      setInDev((cur) => (cur && !ins.some((d) => d.id === cur) ? "" : cur));
      setOutDev((cur) => (cur && !outs.some((d) => d.id === cur) ? "" : cur));
    } catch {
      setMsg(t("Microphone permission denied — device list unavailable."));
    }
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
        audio: {
          deviceId: { exact: inDev },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          ...(voiceFocus !== "off"
            ? { noiseSuppression: false, autoGainControl: false, echoCancellation: false }
            : {}),
        },
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
      if (voiceFocus === "off") src.connect(inNode);
      else {
        openingVoiceFocusCleanup = await connectVoiceFocus(ctx, src, inNode, stream, voiceFocus);
        if (openingEpoch !== streamEpochRef.current) throw new Error("Stream start cancelled");
        voiceFocusCleanupRef.current = openingVoiceFocusCleanup;
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

  async function calibrateHardware() {
    const session = sessRef.current;
    if (
      !streaming ||
      !session ||
      calibrationControllerRef.current ||
      session.settings.busy ||
      recOn ||
      passthrough ||
      inGain === 0
    )
      return;
    const controller = new AbortController();
    calibrationControllerRef.current = controller;
    calibrationMeterRef.current.stop();
    setCalibrating(true);
    setCalibrationResults([]);
    setCalibrationError("");
    setCalibrationProgress(0);
    const original = { block_frame: session.blockFrame, automatic_block_size: autoChunk };
    const context = calibrationContextRef.current;
    const results: CalibrationResult[] = [];
    try {
      for (const [index, chunk] of CALIBRATION_CANDIDATES.entries()) {
        controller.signal.throwIfAborted();
        if (sessRef.current !== session || calibrationContextRef.current !== context)
          throw new Error("The realtime model or audio settings changed. Run calibration again.");
        setCalibrationCurrent(chunk);
        setCalibrationActivity("Applying settings…");
        const actualFrames = await session.settings.apply({
          automatic_block_size: false,
          block_frame: chunk * 48,
        });
        if (actualFrames !== chunk * 48)
          throw new Error("The engine did not apply the requested calibration buffer.");
        setCalibrationActivity("Warming up…");
        await calibrationDelay(1500, controller.signal);
        setCalibrationActivity("Measuring latency…");
        calibrationMeterRef.current.begin(calibrationCountersRef.current);
        await calibrationDelay(6000, controller.signal);
        if (session.ctx.state !== "running" || sessRef.current !== session)
          throw new Error("The audio session paused during calibration.");
        if (calibrationContextRef.current !== context)
          throw new Error("The realtime model or audio settings changed. Run calibration again.");
        results.push(calibrationMeterRef.current.finish(chunk, calibrationCountersRef.current));
        setCalibrationResults([...results]);
        setCalibrationProgress(Math.round(((index + 1) / CALIBRATION_CANDIDATES.length) * 100));
      }
      setCalibrationKey(context);
    } catch (error) {
      setCalibrationResults([]);
      setCalibrationError(
        t(
          controller.signal.aborted
            ? "Calibration cancelled. Original buffer settings restored."
            : errMsg(error),
        ),
      );
    } finally {
      calibrationMeterRef.current.stop();
      setCalibrationActivity("Restoring settings…");
      if (sessRef.current === session && session.ws.readyState === WebSocket.OPEN) {
        try {
          const restored = await session.settings.apply(original);
          setChunkMs(restored / 48);
        } catch (error) {
          setCalibrationResults([]);
          setCalibrationError(
            t("Could not restore buffer settings. Realtime has been stopped: {message}", {
              message: errMsg(error),
            }),
          );
          stopStream(true);
        }
      }
      calibrationControllerRef.current = null;
      setCalibrating(false);
    }
  }

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) calibrationControllerRef.current?.abort();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  useEffect(() => {
    if (!model || !settingsLoadedRef.current || !modelPresets.loaded) return;
    const values = realtimePreset(JSON.parse(settingsKey));
    const timer = setTimeout(() => saveModelPreset("realtime", model, values), 500);
    return () => {
      clearTimeout(timer);
      saveModelPreset("realtime", model, values);
    };
    // Snapshot includes every model parameter; global changes are deduplicated below.
  }, [model, settingsKey, modelPresets.loaded]);

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

  useEffect(() => {
    const session = sessRef.current;
    if (!streaming || !session) return;
    if (!inDev) {
      controlRef.current.stop();
      setMsg(t("Select input and output devices before starting realtime."));
      return;
    }
    const previous = { ...audioRoutingRef.current };
    if (previous.input === inDev && previous.focus === voiceFocus) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      audioApplyCountRef.current++;
      setApplyingAudio(true);
      void (async () => {
        let stream: MediaStream | undefined;
        let source: MediaStreamAudioSourceNode | undefined;
        let bridge: GainNode | undefined;
        let cleanup: (() => Promise<void>) | undefined;
        let committed = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: inDev },
              channelCount: { ideal: 1 },
              sampleRate: { ideal: 48000 },
              ...(voiceFocus !== "off"
                ? { noiseSuppression: false, autoGainControl: false, echoCancellation: false }
                : {}),
            },
          });
          if (cancelled || sessRef.current !== session) return;
          source = session.ctx.createMediaStreamSource(stream);
          bridge = session.ctx.createGain();
          if (voiceFocus === "off") source.connect(bridge);
          else cleanup = await connectVoiceFocus(session.ctx, source, bridge, stream, voiceFocus);
          if (cancelled || sessRef.current !== session) return;
          const oldStream = session.stream;
          const oldSource = session.nodes[0];
          const oldBridge = session.inputBridge;
          const oldCleanup = voiceFocusCleanupRef.current;
          bridge.connect(session.nodes[1]);
          source.connect(session.playback);
          oldSource.disconnect();
          oldBridge?.disconnect();
          session.stream = stream;
          session.nodes[0] = source;
          session.nodes = session.nodes.filter((node) => node !== oldBridge);
          session.nodes.push(bridge);
          session.inputBridge = bridge;
          session.inputLatencyMs =
            ((stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number })
              ?.latency || 0) * 1000;
          voiceFocusCleanupRef.current = cleanup || null;
          audioRoutingRef.current.input = inDev;
          audioRoutingRef.current.focus = voiceFocus;
          committed = true;
          oldStream.getTracks().forEach((track) => {
            track.stop();
          });
          void oldCleanup?.().catch(() => {});
          setMsg(t("Settings applied"));
        } catch (error) {
          if (!cancelled && sessRef.current === session) {
            setInDev(previous.input);
            setVoiceFocus(previous.focus);
            setMsg(t("Could not apply settings: {message}", { message: t(errMsg(error)) }));
          }
        } finally {
          if (!committed) {
            stream?.getTracks().forEach((track) => {
              track.stop();
            });
            source?.disconnect();
            bridge?.disconnect();
            await cleanup?.().catch(() => {});
          }
          audioApplyCountRef.current--;
          setApplyingAudio(audioApplyCountRef.current > 0);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inDev, voiceFocus, streaming, t]);

  useEffect(() => {
    const session = sessRef.current;
    if (!streaming || !session || audioRoutingRef.current.output === outDev) return;
    if (!outDev) {
      controlRef.current.stop();
      setMsg(t("Select input and output devices before starting realtime."));
      return;
    }
    const previous = audioRoutingRef.current.output;
    let cancelled = false;
    const timer = setTimeout(() => {
      audioApplyCountRef.current++;
      setApplyingAudio(true);
      void (async () => {
        const bridge = session.ctx.createGain();
        let elements: HTMLAudioElement[] = [];
        let committed = false;
        try {
          elements = await connectRealtimeOutput(session.ctx, bridge, outDev);
          if (cancelled || sessRef.current !== session) return;
          const gain = outGainNodeRef.current;
          if (!gain) return;
          gain.disconnect();
          gain.connect(bridge);
          session.outputBridge?.disconnect();
          session.nodes = session.nodes.filter((node) => node !== session.outputBridge);
          session.nodes.push(bridge);
          session.outputBridge = bridge;
          session.els.forEach((element) => {
            element.pause();
            element.srcObject = null;
          });
          session.els = elements;
          audioRoutingRef.current.output = outDev;
          committed = true;
          setMsg(t("Settings applied"));
        } catch (error) {
          if (!cancelled && sessRef.current === session) {
            setOutDev(previous);
            setMsg(t("Could not apply settings: {message}", { message: t(errMsg(error)) }));
          }
        } finally {
          if (!committed) {
            bridge.disconnect();
            elements.forEach((element) => {
              element.pause();
              element.srcObject = null;
            });
          }
          audioApplyCountRef.current--;
          setApplyingAudio(audioApplyCountRef.current > 0);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [outDev, streaming, t]);

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
  }, [selectedLiveKey, streaming]);

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

      <Stage
        disabled={calibrating}
        step={2}
        title={t("Audio Devices")}
        description={t("Select your input and output devices.")}
        icon={<ListMusic size={18} className="text-white" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4">
          <FormField label={t("Input Device")} htmlFor="rt-in-dev" required>
            <CustomSelect
              id="rt-in-dev"
              value={inDev}
              onChange={(e) => setInDev(e.target.value)}
              className="w-full"
              description={t(SETTING_HELP.inputDevice)}
            >
              <option value="" disabled>
                {t("Select an input device")}
              </option>
              {inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </CustomSelect>
          </FormField>
          <FormField label={t("Output Device")} htmlFor="rt-out-dev" required>
            <CustomSelect
              id="rt-out-dev"
              value={outDev}
              onChange={(e) => setOutDev(e.target.value)}
              className="w-full"
              description={t(SETTING_HELP.outputDevice)}
            >
              <option value="" disabled>
                {t("Select an output device")}
              </option>
              {outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </CustomSelect>
          </FormField>
          <div className="flex items-start sm:pt-[30px]">
            <IconButton
              label={t("Refresh audio devices")}
              icon={<RefreshCw size={14} />}
              size="md"
              onClick={() => void enumDevices()}
            />
          </div>
        </div>
        <p className="text-xs text-neutral-400">
          {t(
            "Choose your microphone as input. To send converted audio to another app, select a virtual cable as output and select its paired input in that app.",
          )}
        </p>
      </Stage>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div>
              <SliderField
                id="rt-index-rate"
                label={t("Search Feature Ratio")}
                value={indexRate}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => {
                  setIndexRate(v);
                  if (streaming) changeConfigDebounced("index_rate", v);
                }}
                description={t(SETTING_HELP.indexRate)}
              />
            </div>
            <div>
              <SliderField
                id="rt-protect"
                label={t("Protect Voiceless Consonants")}
                value={protect}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(v) => {
                  setProtect(v);
                  if (streaming) changeConfigDebounced("protect", v);
                }}
                description={t(SETTING_HELP.protect)}
              />
            </div>
            <div>
              <SliderField
                id="rt-volume-envelope"
                label={t("Volume Envelope")}
                value={volumeEnvelope}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => {
                  setVolumeEnvelope(v);
                  if (streaming) changeConfigDebounced("volume_envelope", v);
                }}
                description={t(SETTING_HELP.envelope)}
              />
            </div>

            <PitchMethodSelect
              id="rt-f0-method"
              label={t("Pitch extraction algorithm")}
              value={f0Method}
              onChange={setF0Method}
              methods={REALTIME_F0_METHODS}
            />
            <EmbedderSelect
              id="rt-embedder"
              label={t("Embedder Model")}
              value={embedder}
              onChange={setEmbedder}
            />
            {embedder === "custom" && (
              <div>
                <label htmlFor="rt-custom-embedder">{t("Custom embedder path")}</label>
                <input
                  id="rt-custom-embedder"
                  type="text"
                  value={embedderCustom}
                  onChange={(e) => setEmbedderCustom(e.target.value)}
                  placeholder="rvc/models/embedders/embedders_custom/my-embedder"
                  aria-describedby={`${"rt-custom-embedder"}-help`}
                />
                <SettingHelp text={t(SETTING_HELP.customEmbedder)} controlId={"rt-custom-embedder"} />
              </div>
            )}
          </div>
          <Disclosure
            title={t("Voice cleanup (autotune / proposed pitch)")}
            icon={<Wand2 size={15} />}
            description={t(SETTING_HELP.autotune)}
          >
            <div className="row">
              <div className="min-w-0 flex-1">
                <label htmlFor="rt-autotune" className="flex items-center gap-2 cursor-pointer">
                  <input
                    id="rt-autotune"
                    type="checkbox"
                    checked={autotune}
                    onChange={(e) => {
                      setAutotune(e.target.checked);
                      if (streaming) changeConfig("autotune", e.target.checked);
                    }}
                    aria-describedby={`${"rt-autotune"}-help`}
                  />{" "}
                  {t("Autotune")}
                </label>
                <SettingHelp text={t(SETTING_HELP.autotune)} controlId={"rt-autotune"} />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="rt-proposed-pitch" className="flex items-center gap-2 cursor-pointer">
                  <input
                    id="rt-proposed-pitch"
                    type="checkbox"
                    checked={proposedPitch}
                    onChange={(e) => {
                      setProposedPitch(e.target.checked);
                      if (streaming) changeConfig("proposed_pitch", e.target.checked);
                    }}
                    aria-describedby={`${"rt-proposed-pitch"}-help`}
                  />{" "}
                  {t("Proposed Pitch")}
                </label>
                <SettingHelp text={t(SETTING_HELP.proposed)} controlId={"rt-proposed-pitch"} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ marginTop: 8 }}>
              <div>
                <SliderField
                  id="rt-autotune-strength"
                  label={t("Autotune Strength")}
                  value={autotuneStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => {
                    setAutotuneStrength(v);
                    if (streaming) changeConfigDebounced("autotune_strength", v);
                  }}
                  description={t(SETTING_HELP.autotuneStrength)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-proposed-threshold"
                  label={t("Proposed Pitch Threshold")}
                  value={proposedPitchThreshold}
                  min={50}
                  max={1200}
                  step={1}
                  unit="Hz"
                  onChange={(v) => {
                    setProposedPitchThreshold(v);
                    if (streaming) changeConfigDebounced("proposed_pitch_threshold", v);
                  }}
                  description={t(SETTING_HELP.proposedThreshold)}
                />
              </div>
            </div>
          </Disclosure>
          <Disclosure
            title={t("Formant Shifting")}
            icon={<Sparkles size={15} />}
            description={t(SETTING_HELP.formant)}
          >
            <ToggleField
              id="rt-formant-shifting"
              label={t("Enable Formant Shifting")}
              checked={formantShifting}
              onChange={(checked) => {
                setFormantShifting(checked);
                if (streaming) changeConfig("formant_shifting", checked);
              }}
              description={t(SETTING_HELP.formant)}
            />
            {formantShifting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <SliderField
                  id="rt-formant-qfrency"
                  label={t("Quefrency for formant shifting")}
                  value={formantQfrency}
                  min={0}
                  max={16}
                  step={0.1}
                  onChange={(v) => {
                    setFormantQfrency(v);
                    if (streaming) changeConfigDebounced("formant_qfrency", v);
                  }}
                  description={t("Modifies formants width and spectral envelope")}
                />
                <SliderField
                  id="rt-formant-timbre"
                  label={t("Timbre for formant shifting")}
                  value={formantTimbre}
                  min={0}
                  max={16}
                  step={0.1}
                  onChange={(v) => {
                    setFormantTimbre(v);
                    if (streaming) changeConfigDebounced("formant_timbre", v);
                  }}
                  description={t("Adjusts vocal tract length / timbre brightness")}
                />
              </div>
            )}
          </Disclosure>
          <Disclosure
            title={t("Latency / VAD / gains")}
            icon={<Gauge size={15} />}
            description={
              <>
                {t(SETTING_HELP.chunk)} {t(SETTING_HELP.vad)}
              </>
            }
          >
            <div className="mb-4 space-y-3">
              <ToggleField
                id="rt-decoder-fp16"
                label={t("FP16 HiFi-GAN decoder (CUDA)")}
                checked={decoderFp16}
                onChange={(checked) => {
                  setDecoderFp16(checked);
                  if (streaming) changeConfig("decoder_fp16", checked);
                }}
                description={t(SETTING_HELP.fp16)}
              />
              <label htmlFor="rt-voice-focus" className="text-xs text-neutral-300">
                {t("Voice Focus")}
              </label>
              <CustomSelect
                id="rt-voice-focus"
                value={voiceFocus}
                onChange={(e) => setVoiceFocus(e.target.value as VoiceFocusVariant)}
                options={[
                  { value: "off", label: t("Off") },
                  { value: "c20", label: "Voice Focus c20" },
                  { value: "c50", label: "Voice Focus c50" },
                  { value: "c100", label: "Voice Focus c100" },
                ]}
                description={t(SETTING_HELP.voiceFocus)}
              />
              <p className="text-xs text-neutral-400">
                {t(
                  "Voice Focus processes microphone audio locally. Model assets download from AWS when enabled.",
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div>
                <SliderField
                  id="rt-chunk-ms"
                  label={t("Chunk Size (ms)")}
                  value={chunkMs}
                  min={20}
                  max={1000}
                  step={10}
                  unit="ms"
                  onChange={(value) => {
                    setChunkMs(value);
                    setAutoChunk(false);
                  }}
                  description={t(SETTING_HELP.chunk)}
                />
                <ToggleField
                  label={t("Auto chunk size")}
                  checked={autoChunk}
                  onChange={setAutoChunk}
                  description={t(SETTING_HELP.autoChunk)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-crossfade"
                  label={t("Crossfade Overlap Size (s)")}
                  value={crossfade}
                  min={0.05}
                  max={0.2}
                  step={0.01}
                  unit="s"
                  onChange={(v) => {
                    setCrossfade(v);
                    if (streaming) changeConfigDebounced("cross_fade_overlap_size", v);
                  }}
                  description={t(SETTING_HELP.crossfade)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-extra-size"
                  label={t("Extra Conversion Size (s)")}
                  value={extraSize}
                  min={0.1}
                  max={5}
                  step={0.1}
                  unit="s"
                  onChange={(v) => {
                    setExtraSize(v);
                    if (streaming) changeConfigDebounced("extra_convert_size", v);
                  }}
                  description={t(SETTING_HELP.context)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-silent-threshold"
                  label={t("Silence Threshold (dB)")}
                  value={silent}
                  min={-90}
                  max={-30}
                  step={1}
                  unit="dB"
                  onChange={(v) => {
                    setSilent(v);
                    if (streaming) changeConfigDebounced("silent_threshold", v);
                  }}
                  description={t(SETTING_HELP.silence)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-in-gain"
                  label={t("Input Gain (%)")}
                  value={inGain}
                  min={0}
                  max={200}
                  step={1}
                  unit="%"
                  onChange={(v) => {
                    setInGain(v);
                    if (streaming) changeConfigDebounced("input_audio_gain", v);
                  }}
                  description={t(SETTING_HELP.inputGain)}
                />
              </div>
              <div>
                <SliderField
                  id="rt-out-gain"
                  label={`${t("Output Gain (%)")} ${t("(local)")}`}
                  value={outGain}
                  min={0}
                  max={200}
                  step={1}
                  unit="%"
                  onChange={setOutGain}
                  description={t(SETTING_HELP.outputGain)}
                />
              </div>
            </div>
            <ToggleField
              id="rt-vad-enabled"
              label={t("Enable VAD")}
              checked={vad}
              onChange={(checked) => {
                setVad(checked);
                if (streaming) changeConfig("vad_enabled", checked);
              }}
              className="mt-3"
              description={t(SETTING_HELP.vad)}
            />
          </Disclosure>
          <Disclosure
            title={t("Monitor")}
            icon={<Headphones size={15} />}
            description={t(SETTING_HELP.outputDevice)}
          >
            <div className="space-y-4">
              <ToggleField
                id="rt-monitor-enabled"
                label={t("Hear myself")}
                description={t(
                  "Play the converted output on this device's speakers/headphones while streaming. The stream sent to the output device is unaffected.",
                )}
                checked={monitorSelf}
                onChange={setMonitorSelf}
              />
              {monitorSelf && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <SliderField
                    id="rt-monitor-volume"
                    label={t("Monitor volume")}
                    value={monitorVolume}
                    min={0}
                    max={200}
                    step={1}
                    unit="%"
                    onChange={setMonitorVolume}
                    description={t("Local playback volume. Does not change the streamed output.")}
                  />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-neutral-300">{t("Output level")}</span>
                      <span className="text-[11px] text-neutral-400 tabular-nums" aria-live="off">
                        {streaming || connecting ? `${outLevel}%` : "—"}
                      </span>
                    </div>
                    <meter
                      className="h-2 w-full overflow-hidden rounded-full bg-white/10 [&::-webkit-meter-bar]:bg-transparent [&::-webkit-meter-optimum-value]:bg-[var(--accent)] [&::-moz-meter-bar]:bg-[var(--accent)]"
                      min={0}
                      max={100}
                      value={streaming || connecting ? outLevel : 0}
                      aria-label={t("Output level")}
                    />
                    <p className="text-[11px] text-neutral-400 m-0 leading-tight">
                      {t("Use headphones to avoid feedback when monitoring.")}
                    </p>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <ToggleField
                  id="rt-passthrough"
                  disabled={!streaming}
                  label={t("Passthrough")}
                  checked={passthrough}
                  onChange={(value) => {
                    if (streaming) setPassthrough(value);
                  }}
                  description={t(
                    "Send your microphone directly to the output. Conversion stays ready for instant switching; recordings still use the converted voice.",
                  )}
                />
                <div className="space-y-2 pl-6">
                  <label htmlFor="rt-passthrough-hotkey" className="block text-xs text-neutral-300">
                    {t("Passthrough hotkey")}
                  </label>
                  <input
                    id="rt-passthrough-hotkey"
                    value={passthroughHotkey}
                    maxLength={80}
                    onChange={(event) => setPassthroughHotkey(event.target.value)}
                    aria-describedby="rt-passthrough-hotkey-help"
                    autoComplete="off"
                    spellCheck={false}
                    className="block w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-sans focus:border-white/25 focus:outline-none"
                  />
                  <p
                    id="rt-passthrough-hotkey-help"
                    className="max-w-xl text-[11px] leading-relaxed text-neutral-400"
                  >
                    {t(
                      "Desktop shortcut: CommandOrControl+Alt+V switches while another app is focused. Clear it to disable.",
                    )}
                  </p>
                  {!hotkeyAvailable && (
                    <p className="text-xs text-amber-300" role="status">
                      {t("Hotkey unavailable. Choose another combination.")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Disclosure>
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

          {streaming && active && (
            <RealtimeDiagnostics
              latency={latency}
              roundTrip={roundTrip}
              input={inputLevel}
              silentThreshold={silent}
              chunkMs={calibrating ? calibrationCurrent : chunkMs}
              autoChunk={calibrating ? false : autoChunk}
              diagnostics={diagnostics}
            />
          )}
        </div>
      </Stage>
      <Disclosure
        title={t("Recording & Calibration")}
        icon={<Disc size={16} />}
        open={realtimeToolsOpen}
        onToggle={setRealtimeToolsOpen}
      >
        <RealtimeCalibration
          streaming={streaming}
          disabled={
            connecting ||
            applyingSettings ||
            applyingAudio ||
            recOn ||
            passthrough ||
            inGain === 0 ||
            !!sessRef.current?.settings.busy
          }
          running={calibrating}
          current={calibrationCurrent}
          results={calibrationResults}
          stale={!!calibrationKey && calibrationKey !== calibrationContextKey}
          error={calibrationError}
          progress={calibrationProgress}
          activity={calibrationActivity}
          onStart={() => void calibrateHardware()}
          onCancel={() => calibrationControllerRef.current?.abort()}
          onApply={(size) => {
            setChunkMs(size);
            setAutoChunk(false);
          }}
        />
        <Card aria-label={t("Record Output")}>
          <CardHeader
            icon={<Disc size={18} className="text-white" />}
            title={t("Record Output")}
            description={t("Records the converted stream server-side via the engine.")}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label htmlFor="rt-rec-path">{t("Recording path (server)")}</label>
              <input
                id="rt-rec-path"
                disabled={calibrating}
                type="text"
                value={recPath}
                onChange={(e) => setRecPath(e.target.value)}
                aria-describedby={`${"rt-rec-path"}-help`}
              />
              <SettingHelp text={t(SETTING_HELP.recordPath)} controlId={"rt-rec-path"} />
            </div>
            <div>
              <label htmlFor="rt-rec-format">{t("Export Format")}</label>
              <CustomSelect
                id="rt-rec-format"
                disabled={calibrating}
                value={recFormat}
                onChange={(e) => setRecFormat(e.target.value)}
                className="w-full mt-1"
                description={t(SETTING_HELP.export)}
              >
                {["WAV", "MP3", "FLAC", "OGG", "M4A"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </CustomSelect>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant={recOn ? "ghost" : "primary"}
              onClick={toggleRecord}
              disabled={calibrating || !streaming}
              icon={<Disc size={16} className={recOn ? "animate-pulse text-white" : undefined} />}
            >
              {recOn ? t("Stop Recording") : t("Start Recording")}
            </Button>
          </div>
        </Card>
      </Disclosure>
    </div>
  );
}
