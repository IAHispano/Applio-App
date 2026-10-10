"use client";

import {
  Activity,
  Disc,
  Gauge,
  Headphones,
  Layers,
  ListMusic,
  Play,
  RefreshCw,
  Square,
  Wand2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Disclosure,
  EMBEDDER_MODELS,
  EmbedderSelect,
  IconButton,
  PitchMethodSelect,
  REALTIME_F0_METHODS,
  StatTile,
  ToggleField,
  VoiceModelField,
} from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { apiGet, apiSend, errMsg, fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { INPUT_WORKLET, PLAYBACK_WORKLET, RealtimeAudioSender } from "@/lib/realtime-audio";
import { connectRealtimeOutput } from "@/lib/realtime-output";
import { realtimeWsUrl } from "@/lib/realtime-ws";
import { useSpeakers } from "@/lib/useSpeakers";

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
}: {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card as="section" aria-label={`${step}. ${title}`}>
      <CardHeader step={step} title={title} description={description} icon={icon} />
      <div>{children}</div>
    </Card>
  );
}

export default function RealtimePage() {
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
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0);
  const [protect, setProtect] = useState(0.5);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1);
  const [sid, setSid] = useState(0);
  const [f0Method, setF0Method] = useState("fcpe");
  const [embedder, setEmbedder] = useState("contentvec");
  const [embedderCustom, setEmbedderCustom] = useState("");
  const [autotune, setAutotune] = useState(false);
  const [autotuneStrength, setAutotuneStrength] = useState(1);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [proposedPitchThreshold, setProposedPitchThreshold] = useState(155);
  const [cleanAudio, setCleanAudio] = useState(false);
  const [cleanStrength, setCleanStrength] = useState(0.5);
  const [chunkMs, setChunkMs] = useState(30);
  const [autoChunk, setAutoChunk] = useState(true);
  const [crossfade, setCrossfade] = useState(0.05);
  const [extraSize, setExtraSize] = useState(2.5);
  const [silent, setSilent] = useState(-60);
  const [vad, setVad] = useState(true);
  const [inGain, setInGain] = useState(100);
  const [outGain, setOutGain] = useState(100);
  const [monitorSelf, setMonitorSelf] = useState(false);
  const [monitorVolume, setMonitorVolume] = useState(100);
  const [outLevel, setOutLevel] = useState(0);
  // Post-process FX rack (parity with Gradio realtime tab: post_process + 10 pedalboard FX)
  const [postProcess, setPostProcess] = useState(false);
  const [reverb, setReverb] = useState(false);
  const [reverbRoomSize, setReverbRoomSize] = useState(0.5);
  const [reverbDamping, setReverbDamping] = useState(0.5);
  const [reverbWetGain, setReverbWetGain] = useState(0.5);
  const [reverbDryGain, setReverbDryGain] = useState(0.5);
  const [reverbWidth, setReverbWidth] = useState(0.5);
  const [reverbFreezeMode, setReverbFreezeMode] = useState(0.5);
  const [pitchShiftFx, setPitchShiftFx] = useState(false);
  const [pitchShiftSemitones, setPitchShiftSemitones] = useState(0);
  const [limiter, setLimiter] = useState(false);
  const [limiterThreshold, setLimiterThreshold] = useState(-6);
  const [limiterReleaseTime, setLimiterReleaseTime] = useState(0.01);
  const [gainFx, setGainFx] = useState(false);
  const [gainDb, setGainDb] = useState(0);
  const [distortion, setDistortion] = useState(false);
  const [distortionGain, setDistortionGain] = useState(25);
  const [chorus, setChorus] = useState(false);
  const [chorusRate, setChorusRate] = useState(1.0);
  const [chorusDepth, setChorusDepth] = useState(0.25);
  const [chorusCenterDelay, setChorusCenterDelay] = useState(7);
  const [chorusFeedback, setChorusFeedback] = useState(0.0);
  const [chorusMix, setChorusMix] = useState(0.5);
  const [bitcrush, setBitcrush] = useState(false);
  const [bitcrushBitDepth, setBitcrushBitDepth] = useState(8);
  const [clipping, setClipping] = useState(false);
  const [clippingThreshold, setClippingThreshold] = useState(-6);
  const [compressor, setCompressor] = useState(false);
  const [compressorThreshold, setCompressorThreshold] = useState(0);
  const [compressorRatio, setCompressorRatio] = useState(1);
  const [compressorAttack, setCompressorAttack] = useState(1.0);
  const [compressorRelease, setCompressorRelease] = useState(100);
  const [delayFx, setDelayFx] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(0.5);
  const [delayFeedback, setDelayFeedback] = useState(0.0);
  const [delayMix, setDelayMix] = useState(0.5);
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
  });
  const [roundTrip, setRoundTrip] = useState(0);
  const [volume, setVolume] = useState(-90);
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
    els: HTMLAudioElement[];
  } | null>(null);
  const streamEpochRef = useRef(0);
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
        if (keep !== model) setSid(0);
      })
      .catch(() => {})
      .finally(() => {
        settingsLoadedRef.current = true;
      });
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
    if (typeof rt.model_file === "string" && rt.model_file) savedModelRef.current = rt.model_file;
    if (typeof rt.index_file === "string" && rt.index_file) savedIndexRef.current = rt.index_file;
    setInDev(str(rt.input_device));
    setOutDev(str(rt.output_device));
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
    setAutotuneStrength(num(rt.autotune_strength, 0, 1, 1));
    setProposedPitch(bool(rt.proposed_pitch, false));
    setProposedPitchThreshold(num(rt.proposed_pitch_threshold, 50, 1200, 155));
    setCleanAudio(bool(rt.clean_audio, false));
    setCleanStrength(num(rt.clean_strength, 0, 1, 0.5));
    setChunkMs(num(rt.chunk_ms, 20, 1000, 30));
    setAutoChunk(bool(rt.auto_chunk, true));
    setCrossfade(num(rt.cross_fade_overlap_size, 0.05, 0.2, 0.05));
    setExtraSize(num(rt.extra_convert_size, 0.1, 5, 2.5));
    setSilent(num(rt.silent_threshold, -90, -60, -60));
    setVad(bool(rt.vad_enabled, true));
    setInGain(num(rt.input_audio_gain, 0, 200, 100));
    setOutGain(num(rt.output_audio_gain, 0, 200, 100));
    setMonitorSelf(bool(rt.monitor_enabled, false));
    setMonitorVolume(num(rt.monitor_volume, 0, 200, 100));
    setPostProcess(bool(rt.post_process, false));
    setReverb(bool(rt.reverb, false));
    setReverbRoomSize(num(rt.reverb_room_size, 0, 1, 0.5));
    setReverbDamping(num(rt.reverb_damping, 0, 1, 0.5));
    setReverbWetGain(num(rt.reverb_wet_level, 0, 1, 0.5));
    setReverbDryGain(num(rt.reverb_dry_level, 0, 1, 0.5));
    setReverbWidth(num(rt.reverb_width, 0, 1, 0.5));
    setReverbFreezeMode(num(rt.reverb_freeze_mode, 0, 1, 0.5));
    setPitchShiftFx(bool(rt.pitch_shift, false));
    setPitchShiftSemitones(num(rt.pitch_shift_semitones, -12, 12, 0));
    setLimiter(bool(rt.limiter, false));
    setLimiterThreshold(num(rt.limiter_threshold, -60, 0, -6));
    setLimiterReleaseTime(num(rt.limiter_release, 0.01, 1, 0.01));
    setGainFx(bool(rt.gain, false));
    setGainDb(num(rt.gain_db, -60, 60, 0));
    setDistortion(bool(rt.distortion, false));
    setDistortionGain(num(rt.distortion_gain, -60, 60, 25));
    setChorus(bool(rt.chorus, false));
    setChorusRate(num(rt.chorus_rate, 0, 100, 1.0));
    setChorusDepth(num(rt.chorus_depth, 0, 1, 0.25));
    setChorusCenterDelay(num(rt.chorus_delay, 7, 8, 7));
    setChorusFeedback(num(rt.chorus_feedback, 0, 1, 0.0));
    setChorusMix(num(rt.chorus_mix, 0, 1, 0.5));
    setBitcrush(bool(rt.bitcrush, false));
    setBitcrushBitDepth(Math.round(num(rt.bitcrush_bit_depth, 1, 32, 8)));
    setClipping(bool(rt.clipping, false));
    setClippingThreshold(num(rt.clipping_threshold, -60, 0, -6));
    setCompressor(bool(rt.compressor, false));
    setCompressorThreshold(num(rt.compressor_threshold, -60, 0, 0));
    setCompressorRatio(num(rt.compressor_ratio, 1, 20, 1));
    setCompressorAttack(num(rt.compressor_attack, 0, 100, 1.0));
    setCompressorRelease(num(rt.compressor_release, 0.01, 100, 100));
    setDelayFx(bool(rt.delay, false));
    setDelaySeconds(num(rt.delay_seconds, 0, 5, 0.5));
    setDelayFeedback(num(rt.delay_feedback, 0, 1, 0.0));
    setDelayMix(num(rt.delay_mix, 0, 1, 0.5));
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
      .finally(() => loadModels());
    void apiSend("/api/realtime/prewarm", "POST").catch(() => {});
    void enumDevices();
    const t = setInterval(refreshEngine, 5000);
    return () => {
      clearInterval(t);
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
    setModel(selected);
    setIndex(matchIndex(selected, idxList));
    setSid(0);
  }

  function handleUnloadModel() {
    setModel("");
    setIndex("");
    setSid(0);
  }

  // Windows exposes each physical device up to 3 times ("Default - X",
  // "Communications - X", "X"). Collapse those to one entry per device.
  function dedupeDevices(devs: Array<{ id: string; label: string }>) {
    const seen = new Set<string>();
    return devs.filter((d) => {
      const base = d.label.replace(/^(Default|Communications)\s*-\s*/i, "").trim() || d.label;
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    });
  }

  async function enumDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
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
    setMsg("");
    if (!model) {
      setMsg(t("Select a voice model."));
      return;
    }
    setConnecting(true);
    ++streamEpochRef.current;
    // Start the backend engine on demand so there is no separate step.
    if (!engine?.running) {
      setMsg(t("Starting real-time audio service…"));
      try {
        await apiSend("/api/realtime/start", "POST");
        const st = await apiGet<RtStatus>("/api/realtime/status", { ttlMs: 0 });
        setEngine(st);
        if (!st.running) throw new Error(t("Real-time audio service did not start."));
      } catch (e) {
        setConnecting(false);
        setMsg(errMsg(e));
        return;
      }
    }
    let openingStream: MediaStream | undefined;
    let openingContext: AudioContext | undefined;
    try {
      let block = Math.round(((autoChunk ? 30 : chunkMs) * 48000) / 1000);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(inDev ? { deviceId: { exact: inDev } } : {}),
          channelCount: { exact: 1 },
          sampleRate: { exact: 48000 },
        },
      });
      openingStream = stream;
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
      src.connect(inNode);
      const playNode = new AudioWorkletNode(ctx, "playback-processor", { outputChannelCount: [2] });
      const gain = ctx.createGain();
      gain.gain.value = outGain / 100;
      playNode.connect(gain);
      const outputElements = await connectRealtimeOutput(ctx, gain, outDev);
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
      let retryEager = false;
      const sender = new RealtimeAudioSender((chunk) => {
        lastCaptureQueueMs = sender.queueDelayMs;
        sentAt = performance.now();
        ws.send(chunk);
      });
      setDiagnostics({
        estimatedMs: 0,
        queuedBlocks: 0,
        droppedBlocks: 0,
        playbackQueuedMs: 0,
        playbackDroppedMs: 0,
        underrunMs: 0,
      });
      const inputLatency =
        (stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ||
        0;
      playNode.port.onmessage = (event) => {
        const stats = event.data.stats;
        if (!stats || sessRef.current?.ws !== ws) return;
        setDiagnostics({
          estimatedMs:
            (block / ctx.sampleRate) * 1000 +
            crossfade * 1000 +
            inputLatency * 1000 +
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
        els: outputElements,
      };
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
            autotune_strength: autotuneStrength,
            proposed_pitch: proposedPitch,
            proposed_pitch_threshold: proposedPitchThreshold,
            clean_audio: cleanAudio,
            clean_strength: cleanStrength,
            post_process: postProcess,
            kwargs: {
              reverb,
              pitch_shift: pitchShiftFx,
              limiter,
              gain: gainFx,
              distortion,
              chorus,
              bitcrush,
              clipping,
              compressor,
              delay: delayFx,
              reverb_room_size: reverbRoomSize,
              reverb_damping: reverbDamping,
              reverb_wet_level: reverbWetGain,
              reverb_dry_level: reverbDryGain,
              reverb_width: reverbWidth,
              reverb_freeze_mode: reverbFreezeMode,
              pitch_shift_semitones: pitchShiftSemitones,
              limiter_threshold: limiterThreshold,
              limiter_release: limiterReleaseTime,
              gain_db: gainDb,
              distortion_gain: distortionGain,
              chorus_rate: chorusRate,
              chorus_depth: chorusDepth,
              chorus_delay: chorusCenterDelay,
              chorus_feedback: chorusFeedback,
              chorus_mix: chorusMix,
              bitcrush_bit_depth: bitcrushBitDepth,
              clipping_threshold: clippingThreshold,
              compressor_threshold: compressorThreshold,
              compressor_ratio: compressorRatio,
              compressor_attack: compressorAttack,
              compressor_release: compressorRelease,
              delay_seconds: delaySeconds,
              delay_feedback: delayFeedback,
              delay_mix: delayMix,
            },
          }),
        );
        setMsg(t("Preparing realtime model…"));
        apiSend("/api/realtime/config", "PUT", { model_file: model, index_file: index }).catch(() => {});
      };
      inNode.port.onmessage = (e) => {
        const chunk: Float32Array = e.data.chunk;
        if (ws.readyState === WebSocket.OPEN) sender.capture(chunk);
      };
      ws.onmessage = (ev) => {
        if (sessRef.current?.ws !== ws) return;
        if (typeof ev.data === "string") {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === "retry_eager") retryEager = true;
            if (m.type === "error") setMsg(String(m.message));
            if (m.type === "ready") {
              if (Number.isInteger(m.block_frame) && m.block_frame >= 480 && m.block_frame <= 48000) {
                block = m.block_frame;
                setChunkMs(Math.round(block / 48));
              }
              setConnecting(false);
              sender.start();
              inNode.port.postMessage({ block_frame: block, reset: true });
              setStreaming(true);
              setMsg(t("Streaming ✓ speak into your microphone."));
            }
            if (m.type === "latency") setLatency(m.value);
            if (typeof m.volume === "number") setVolume(m.volume);
          } catch {
            /* ignore */
          }
        } else {
          lastRoundTrip = performance.now() - sentAt;
          setRoundTrip(lastRoundTrip);
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
      setConnecting(false);
      setMsg(errMsg(e));
      stopStream(true);
      openingStream?.getTracks().forEach((track) => {
        track.stop();
      });
      if (openingContext?.state !== "closed") await openingContext?.close();
    }
  }

  const reconnectRef = useRef(startStream);
  reconnectRef.current = startStream;

  // Latest controls for tray-driven start/stop (Electron) and autostart.
  const controlRef = useRef({ start: () => {}, stop: (_silent?: boolean) => {} });
  controlRef.current = {
    start: () => void startStream(),
    stop: (silent = false) => stopStream(silent),
  };
  const trayAutoStartedRef = useRef(false);

  // Tray commands from the desktop shell (no-op in the browser).
  useEffect(() => {
    const bridge = (
      window as unknown as {
        applio?: { onRealtimeCommand?: (cb: (action: "start" | "stop") => void) => () => void };
      }
    ).applio;
    const off = bridge?.onRealtimeCommand?.((action) => {
      if (action === "stop") controlRef.current.stop(false);
      else controlRef.current.start();
    });
    return () => off?.();
  }, []);

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

  async function changeConfig(key: string, value: number | string | boolean, ifKwargs = false) {
    // Output gain is applied to the local GainNode instead.
    if (key === "output_audio_gain") return;
    try {
      const ws = new WebSocket(apiWs("/api/realtime/change-config"));
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("change-config unreachable"));
        setTimeout(() => reject(new Error("change-config timeout")), 5000);
      });
      ws.send(JSON.stringify({ type: "init", key, value, if_kwargs: ifKwargs }));
      setTimeout(() => ws.close(), 500);
    } catch (e) {
      setMsg(errMsg(e));
    }
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
      setMsg(r.value + (r.path ? ` → ${r.path}` : ""));
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
    autotune_strength: autotuneStrength,
    proposed_pitch: proposedPitch,
    proposed_pitch_threshold: proposedPitchThreshold,
    clean_audio: cleanAudio,
    clean_strength: cleanStrength,
    chunk_ms: chunkMs,
    auto_chunk: autoChunk,
    cross_fade_overlap_size: crossfade,
    extra_convert_size: extraSize,
    silent_threshold: silent,
    vad_enabled: vad,
    input_audio_gain: inGain,
    output_audio_gain: outGain,
    monitor_enabled: monitorSelf,
    monitor_volume: monitorVolume,
    post_process: postProcess,
    reverb,
    reverb_room_size: reverbRoomSize,
    reverb_damping: reverbDamping,
    reverb_wet_level: reverbWetGain,
    reverb_dry_level: reverbDryGain,
    reverb_width: reverbWidth,
    reverb_freeze_mode: reverbFreezeMode,
    pitch_shift: pitchShiftFx,
    pitch_shift_semitones: pitchShiftSemitones,
    limiter,
    limiter_threshold: limiterThreshold,
    limiter_release: limiterReleaseTime,
    gain: gainFx,
    gain_db: gainDb,
    distortion,
    distortion_gain: distortionGain,
    chorus,
    chorus_rate: chorusRate,
    chorus_depth: chorusDepth,
    chorus_delay: chorusCenterDelay,
    chorus_feedback: chorusFeedback,
    chorus_mix: chorusMix,
    bitcrush,
    bitcrush_bit_depth: bitcrushBitDepth,
    clipping,
    clipping_threshold: clippingThreshold,
    compressor,
    compressor_threshold: compressorThreshold,
    compressor_ratio: compressorRatio,
    compressor_attack: compressorAttack,
    compressor_release: compressorRelease,
    delay: delayFx,
    delay_seconds: delaySeconds,
    delay_feedback: delayFeedback,
    delay_mix: delayMix,
    record_audio_path: recPath,
    export_format: recFormat,
  };
  settingsRef.current = settingsSnapshot;
  const settingsKey = JSON.stringify(settingsSnapshot);

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

  return (
    <div className="w-full max-w-[1920px] mx-auto space-y-6">
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
      <div>
        {msg && (
          <p className="text-xs text-neutral-400 m-0" role="status" aria-live="polite">
            {msg}
          </p>
        )}
      </div>

      <Stage
        step={1}
        title={t("Voice & Devices")}
        description={t("Pick the target voice model and your input/output devices.")}
        icon={<ListMusic size={18} className="text-white" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="sm:col-span-2 xl:col-span-4 space-y-2">
            <VoiceModelField
              label={t("Voice Model")}
              models={models}
              selectedModel={model}
              indexes={indexes}
              indexPath={index}
              indexSelectId="rt-index-file"
              onSelect={handleModelSelect}
              onUnload={handleUnloadModel}
              onRefresh={loadModels}
              onIndexChange={setIndex}
            />
          </div>
          <div>
            <label htmlFor="rt-in-dev">{t("Input Device")}</label>
            <CustomSelect
              id="rt-in-dev"
              value={inDev}
              onChange={(e) => setInDev(e.target.value)}
              className="w-full mt-1"
            >
              <option value="">{t("System default input")}</option>
              {inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="rt-out-dev">{t("Output Device")}</label>
            <CustomSelect
              id="rt-out-dev"
              value={outDev}
              onChange={(e) => setOutDev(e.target.value)}
              className="w-full mt-1"
            >
              <option value="">{t("System default output")}</option>
              {outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div className="flex items-end pb-1">
            <IconButton
              label={t("Refresh audio devices")}
              icon={<RefreshCw size={14} />}
              onClick={() => void enumDevices()}
            />
          </div>
        </div>
      </Stage>

      <Stage
        step={2}
        title={t("Tune & Go Live")}
        description={t("Shape the voice, then start streaming from your microphone.")}
        icon={<Play size={18} className="text-white" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
            />
          </div>
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
            />
          </div>
          {speakers.length > 1 && (
            <div>
              <label htmlFor="rt-speaker-id">{t("Speaker ID (Multi-Speaker Model)")}</label>
              <CustomSelect
                id="rt-speaker-id"
                value={String(sid)}
                onChange={(e) => {
                  setSid(Number(e.target.value));
                  if (streaming) changeConfig("sid", Number(e.target.value));
                }}
                className="w-full mt-1"
              >
                {speakers.map((s) => (
                  <option key={s} value={String(s)}>
                    {t("Speaker")} {s}
                  </option>
                ))}
              </CustomSelect>
            </div>
          )}
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
              <label htmlFor="rt-custom-embedder">{t("Custom embedder path (reconnect to apply)")}</label>
              <input
                id="rt-custom-embedder"
                type="text"
                value={embedderCustom}
                onChange={(e) => setEmbedderCustom(e.target.value)}
                placeholder="rvc/models/embedders/embedders_custom/my-embedder"
              />
            </div>
          )}
        </div>
        <Disclosure title={t("Voice cleanup (autotune / proposed pitch / clean)")} icon={<Wand2 size={15} />}>
          <div className="row">
            <label htmlFor="rt-autotune" className="flex items-center gap-2 cursor-pointer">
              <input
                id="rt-autotune"
                type="checkbox"
                checked={autotune}
                onChange={(e) => {
                  setAutotune(e.target.checked);
                  if (streaming) changeConfig("autotune", e.target.checked);
                }}
              />{" "}
              {t("Autotune")}
            </label>
            <label htmlFor="rt-proposed-pitch" className="flex items-center gap-2 cursor-pointer">
              <input
                id="rt-proposed-pitch"
                type="checkbox"
                checked={proposedPitch}
                onChange={(e) => {
                  setProposedPitch(e.target.checked);
                  if (streaming) changeConfig("proposed_pitch", e.target.checked);
                }}
              />{" "}
              {t("Proposed Pitch")}
            </label>
            <label htmlFor="rt-clean-audio" className="flex items-center gap-2 cursor-pointer">
              <input
                id="rt-clean-audio"
                type="checkbox"
                checked={cleanAudio}
                onChange={(e) => {
                  setCleanAudio(e.target.checked);
                  if (streaming) changeConfig("clean_audio", e.target.checked);
                }}
              />{" "}
              {t("Clean Audio")}
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginTop: 8 }}>
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
              />
            </div>
            <div>
              <SliderField
                id="rt-clean-strength"
                label={t("Clean Strength")}
                value={cleanStrength}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => {
                  setCleanStrength(v);
                  if (streaming) changeConfigDebounced("clean_strength", v);
                }}
              />
            </div>
          </div>
        </Disclosure>
        <Disclosure title={t("Latency / VAD / gains")} icon={<Gauge size={15} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <SliderField
                id="rt-chunk-ms"
                label={`${t("Chunk Size (ms)")} ${t("(reconnect to apply)")}`}
                value={chunkMs}
                min={20}
                max={1000}
                step={10}
                unit="ms"
                onChange={(value) => {
                  setChunkMs(value);
                  setAutoChunk(false);
                }}
              />
              <ToggleField label={t("Auto chunk size")} checked={autoChunk} onChange={setAutoChunk} />
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
              />
            </div>
            <div>
              <SliderField
                id="rt-silent-threshold"
                label={t("Silence Threshold (dB)")}
                value={silent}
                min={-90}
                max={-60}
                step={1}
                unit="dB"
                onChange={(v) => {
                  setSilent(v);
                  if (streaming) changeConfigDebounced("silent_threshold", v);
                }}
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
          />
        </Disclosure>
        <Disclosure title={t("Monitor")} icon={<Headphones size={15} />}>
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
        </Disclosure>
        <Disclosure
          title={t("Post-Process")}
          icon={<Layers size={15} />}
          open={postProcess}
          onToggle={(open) => {
            setPostProcess(open);
            if (streaming) changeConfig("post_process", open);
          }}
        >
          {postProcess && (
            <div className="space-y-4 pt-2">
              {/* Reverb */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={reverb}
                    onChange={(e) => {
                      setReverb(e.target.checked);
                      if (streaming) changeConfig("reverb", e.target.checked, true);
                    }}
                  />
                  <span>{t("Reverb")}</span>
                </label>
                {reverb && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <SliderField
                      id="rt-reverb-room"
                      label={t("Reverb Room Size")}
                      value={reverbRoomSize}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbRoomSize(v);
                        if (streaming) changeConfigDebounced("reverb_room_size", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-reverb-damping"
                      label={t("Reverb Damping")}
                      value={reverbDamping}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbDamping(v);
                        if (streaming) changeConfigDebounced("reverb_damping", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-reverb-wet"
                      label={t("Reverb Wet Gain")}
                      value={reverbWetGain}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbWetGain(v);
                        if (streaming) changeConfigDebounced("reverb_wet_level", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-reverb-dry"
                      label={t("Reverb Dry Gain")}
                      value={reverbDryGain}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbDryGain(v);
                        if (streaming) changeConfigDebounced("reverb_dry_level", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-reverb-width"
                      label={t("Reverb Width")}
                      value={reverbWidth}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbWidth(v);
                        if (streaming) changeConfigDebounced("reverb_width", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-reverb-freeze"
                      label={t("Reverb Freeze Mode")}
                      value={reverbFreezeMode}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setReverbFreezeMode(v);
                        if (streaming) changeConfigDebounced("reverb_freeze_mode", v, true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Pitch Shift */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={pitchShiftFx}
                    onChange={(e) => {
                      setPitchShiftFx(e.target.checked);
                      if (streaming) changeConfig("pitch_shift", e.target.checked, true);
                    }}
                  />
                  <span>{t("Pitch Shift")}</span>
                </label>
                {pitchShiftFx && (
                  <SliderField
                    id="rt-fx-pitch-semi"
                    label={t("Pitch Shift Semitones")}
                    value={pitchShiftSemitones}
                    min={-12}
                    max={12}
                    step={1}
                    onChange={(v) => {
                      setPitchShiftSemitones(v);
                      if (streaming) changeConfigDebounced("pitch_shift_semitones", v, true);
                    }}
                  />
                )}
              </div>

              {/* Delay */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={delayFx}
                    onChange={(e) => {
                      setDelayFx(e.target.checked);
                      if (streaming) changeConfig("delay", e.target.checked, true);
                    }}
                  />
                  <span>{t("Delay")}</span>
                </label>
                {delayFx && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SliderField
                      id="rt-fx-delay-s"
                      label={t("Delay Seconds")}
                      value={delaySeconds}
                      min={0}
                      max={5}
                      step={0.05}
                      unit="s"
                      onChange={(v) => {
                        setDelaySeconds(v);
                        if (streaming) changeConfigDebounced("delay_seconds", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-delay-fb"
                      label={t("Delay Feedback")}
                      value={delayFeedback}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setDelayFeedback(v);
                        if (streaming) changeConfigDebounced("delay_feedback", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-delay-mix"
                      label={t("Delay Mix")}
                      value={delayMix}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setDelayMix(v);
                        if (streaming) changeConfigDebounced("delay_mix", v, true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Limiter */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={limiter}
                    onChange={(e) => {
                      setLimiter(e.target.checked);
                      if (streaming) changeConfig("limiter", e.target.checked, true);
                    }}
                  />
                  <span>{t("Limiter")}</span>
                </label>
                {limiter && (
                  <div className="space-y-2">
                    <SliderField
                      id="rt-fx-lim-thr"
                      label={t("Limiter Threshold dB")}
                      value={limiterThreshold}
                      min={-60}
                      max={0}
                      step={0.5}
                      unit="dB"
                      onChange={(v) => {
                        setLimiterThreshold(v);
                        if (streaming) changeConfigDebounced("limiter_threshold", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-lim-rel"
                      label={t("Limiter Release Time")}
                      value={limiterReleaseTime}
                      min={0.01}
                      max={1}
                      step={0.01}
                      unit="s"
                      onChange={(v) => {
                        setLimiterReleaseTime(v);
                        if (streaming) changeConfigDebounced("limiter_release", v, true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Gain */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={gainFx}
                    onChange={(e) => {
                      setGainFx(e.target.checked);
                      if (streaming) changeConfig("gain", e.target.checked, true);
                    }}
                  />
                  <span>{t("Gain")}</span>
                </label>
                {gainFx && (
                  <SliderField
                    id="rt-fx-gain-db"
                    label={t("Gain dB")}
                    value={gainDb}
                    min={-60}
                    max={60}
                    step={0.5}
                    unit="dB"
                    onChange={(v) => {
                      setGainDb(v);
                      if (streaming) changeConfigDebounced("gain_db", v, true);
                    }}
                  />
                )}
              </div>

              {/* Distortion */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={distortion}
                    onChange={(e) => {
                      setDistortion(e.target.checked);
                      if (streaming) changeConfig("distortion", e.target.checked, true);
                    }}
                  />
                  <span>{t("Distortion")}</span>
                </label>
                {distortion && (
                  <SliderField
                    id="rt-fx-dist"
                    label={t("Distortion Gain")}
                    value={distortionGain}
                    min={-60}
                    max={60}
                    step={1}
                    unit="dB"
                    onChange={(v) => {
                      setDistortionGain(v);
                      if (streaming) changeConfigDebounced("distortion_gain", v, true);
                    }}
                  />
                )}
              </div>

              {/* Chorus */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={chorus}
                    onChange={(e) => {
                      setChorus(e.target.checked);
                      if (streaming) changeConfig("chorus", e.target.checked, true);
                    }}
                  />
                  <span>{t("Chorus")}</span>
                </label>
                {chorus && (
                  <div className="space-y-2">
                    <SliderField
                      id="rt-fx-ch-rate"
                      label={t("Chorus Rate Hz")}
                      value={chorusRate}
                      min={0}
                      max={100}
                      step={0.1}
                      unit="Hz"
                      onChange={(v) => {
                        setChorusRate(v);
                        if (streaming) changeConfigDebounced("chorus_rate", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-ch-depth"
                      label={t("Chorus Depth")}
                      value={chorusDepth}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setChorusDepth(v);
                        if (streaming) changeConfigDebounced("chorus_depth", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-ch-delay"
                      label={t("Chorus Center Delay ms")}
                      value={chorusCenterDelay}
                      min={7}
                      max={8}
                      step={0.1}
                      unit="ms"
                      onChange={(v) => {
                        setChorusCenterDelay(v);
                        if (streaming) changeConfigDebounced("chorus_delay", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-ch-fb"
                      label={t("Chorus Feedback")}
                      value={chorusFeedback}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setChorusFeedback(v);
                        if (streaming) changeConfigDebounced("chorus_feedback", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-ch-mix"
                      label={t("Chorus Mix")}
                      value={chorusMix}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => {
                        setChorusMix(v);
                        if (streaming) changeConfigDebounced("chorus_mix", v, true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Compressor */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={compressor}
                    onChange={(e) => {
                      setCompressor(e.target.checked);
                      if (streaming) changeConfig("compressor", e.target.checked, true);
                    }}
                  />
                  <span>{t("Compressor")}</span>
                </label>
                {compressor && (
                  <div className="space-y-2">
                    <SliderField
                      id="rt-fx-comp-thr"
                      label={t("Compressor Threshold dB")}
                      value={compressorThreshold}
                      min={-60}
                      max={0}
                      step={1}
                      unit="dB"
                      onChange={(v) => {
                        setCompressorThreshold(v);
                        if (streaming) changeConfigDebounced("compressor_threshold", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-comp-ratio"
                      label={t("Compressor Ratio")}
                      value={compressorRatio}
                      min={1}
                      max={20}
                      step={0.5}
                      formatValue={(v) => `${v}:1`}
                      onChange={(v) => {
                        setCompressorRatio(v);
                        if (streaming) changeConfigDebounced("compressor_ratio", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-comp-atk"
                      label={t("Compressor Attack ms")}
                      value={compressorAttack}
                      min={0}
                      max={100}
                      step={1}
                      unit="ms"
                      onChange={(v) => {
                        setCompressorAttack(v);
                        if (streaming) changeConfigDebounced("compressor_attack", v, true);
                      }}
                    />
                    <SliderField
                      id="rt-fx-comp-rel"
                      label={t("Compressor Release ms")}
                      value={compressorRelease}
                      min={0.01}
                      max={100}
                      step={0.5}
                      unit="ms"
                      onChange={(v) => {
                        setCompressorRelease(v);
                        if (streaming) changeConfigDebounced("compressor_release", v, true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Bitcrush */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={bitcrush}
                    onChange={(e) => {
                      setBitcrush(e.target.checked);
                      if (streaming) changeConfig("bitcrush", e.target.checked, true);
                    }}
                  />
                  <span>{t("Bitcrush")}</span>
                </label>
                {bitcrush && (
                  <SliderField
                    id="rt-fx-bit"
                    label={t("Bitcrush Bit Depth")}
                    value={bitcrushBitDepth}
                    min={1}
                    max={32}
                    step={1}
                    onChange={(v) => {
                      setBitcrushBitDepth(v);
                      if (streaming) changeConfigDebounced("bitcrush_bit_depth", v, true);
                    }}
                  />
                )}
              </div>

              {/* Clipping */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-white text-xs">
                  <input
                    type="checkbox"
                    checked={clipping}
                    onChange={(e) => {
                      setClipping(e.target.checked);
                      if (streaming) changeConfig("clipping", e.target.checked, true);
                    }}
                  />
                  <span>{t("Clipping")}</span>
                </label>
                {clipping && (
                  <SliderField
                    id="rt-fx-clip"
                    label={t("Clipping Threshold")}
                    value={clippingThreshold}
                    min={-60}
                    max={0}
                    step={0.5}
                    unit="dB"
                    onChange={(v) => {
                      setClippingThreshold(v);
                      if (streaming) changeConfigDebounced("clipping_threshold", v, true);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </Disclosure>
        <div className="space-y-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-3 flex-wrap">
            {!streaming ? (
              <Button onClick={startStream} disabled={connecting} icon={<Play size={16} />}>
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
            <Badge variant={streaming ? "success" : "neutral"} dot>
              {streaming ? t("live") : connecting ? t("connecting…") : t("idle")}
            </Badge>
            {msg && (
              <span className="text-xs text-neutral-400" role="status">
                {msg}
              </span>
            )}
          </div>

          {streaming && (
            <div
              className="rounded-xl bg-black/30 border border-white/5 p-3 space-y-3"
              role="status"
              aria-live="polite"
              aria-label={t("Live status")}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-white shrink-0" aria-hidden="true" />
                  <p className="text-xs font-medium text-white m-0">{t("Live status")}</p>
                </div>
                <Badge
                  variant={
                    diagnostics.droppedBlocks > 10 || diagnostics.underrunMs > 500
                      ? "danger"
                      : diagnostics.playbackQueuedMs > 300 || diagnostics.underrunMs > 50
                        ? "warning"
                        : "success"
                  }
                  dot
                >
                  {diagnostics.droppedBlocks > 10 || diagnostics.underrunMs > 500
                    ? t("unstable")
                    : diagnostics.playbackQueuedMs > 300 || diagnostics.underrunMs > 50
                      ? t("buffering")
                      : t("healthy")}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                <StatTile label={t("Processing")} value={`${latency.toFixed(0)} ms`} />
                <StatTile label={t("Round trip")} value={`${roundTrip.toFixed(0)} ms`} />
                <StatTile
                  label={t("Voice level")}
                  value={volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : "−∞ dB"}
                />
                <StatTile label={t("Estimated delay")} value={`${diagnostics.estimatedMs.toFixed(0)} ms`} />
                <StatTile
                  label={t("Playback queue")}
                  value={`${diagnostics.playbackQueuedMs.toFixed(0)} ms`}
                />
                <StatTile label={t("Waiting blocks")} value={String(diagnostics.queuedBlocks)} />
                <StatTile label={t("Dropped input")} value={String(diagnostics.droppedBlocks)} />
                <StatTile
                  label={t("Dropped playback")}
                  value={`${diagnostics.playbackDroppedMs.toFixed(0)} ms`}
                />
                <StatTile label={t("Underruns")} value={`${diagnostics.underrunMs.toFixed(0)} ms`} />
                <StatTile
                  label={t("Chunk")}
                  value={`${chunkMs} ms`}
                  subtext={autoChunk ? t("auto") : undefined}
                />
              </div>
              <p className="text-[11px] text-neutral-500 m-0 leading-relaxed">
                {t(
                  "Delay combines capture, transport and output buffering. If underruns or dropped blocks grow, raise the chunk size or close heavy apps.",
                )}
              </p>
            </div>
          )}
        </div>
      </Stage>

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
              type="text"
              value={recPath}
              onChange={(e) => setRecPath(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rt-rec-format">{t("Export Format")}</label>
            <CustomSelect
              id="rt-rec-format"
              value={recFormat}
              onChange={(e) => setRecFormat(e.target.value)}
              className="w-full mt-1"
            >
              {["WAV", "MP3", "FLAC", "OGG", "M4A"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <div className="pt-3.5 border-t border-white/5 flex justify-end">
          <Button
            variant={recOn ? "ghost" : "primary"}
            onClick={toggleRecord}
            icon={<Disc size={16} className={recOn ? "animate-pulse text-white" : undefined} />}
          >
            {recOn ? t("Stop Recording") : t("Start Recording")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
