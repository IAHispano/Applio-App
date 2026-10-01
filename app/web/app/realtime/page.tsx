"use client";

import { ChevronDown, Disc, Gauge, Layers, ListMusic, Play, Radio, Square, Wand2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Disclosure,
  EmbedderSelect,
  PitchMethodSelect,
  REALTIME_F0_METHODS,
  ToggleField,
  VoiceModelField,
} from "@/components/ui";
import CustomSelect from "@/components/ui/CustomSelect";
import SliderField from "@/components/ui/SliderField";
import { apiGet, apiSend, errMsg, fetchModels } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { matchIndex } from "@/lib/model-index";
import { realtimeWsUrl } from "@/lib/realtime-ws";
import { useSpeakers } from "@/lib/useSpeakers";

function apiWs(path: string): string {
  return realtimeWsUrl(path);
}

const INPUT_WORKLET = `
class InputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(96000);
    this.buffered = 0;
    this.block = 0;
    this.port.onmessage = (e) => {
      this.block = e.data.block_frame || 0;
      if (e.data.reset) this.buffered = 0;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) {
      if (this.buffered + ch.length > this.buffer.length) {
        const nextBuf = new Float32Array(Math.max(this.buffer.length * 2, this.buffered + ch.length));
        nextBuf.set(this.buffer.subarray(0, this.buffered));
        this.buffer = nextBuf;
      }
      this.buffer.set(ch, this.buffered);
      this.buffered += ch.length;
    }
    if (this.block > 0) {
      while (this.buffered >= this.block) {
        const out = new Float32Array(this.block);
        out.set(this.buffer.subarray(0, this.block));
        this.port.postMessage({ chunk: out }, [out.buffer]);
        this.buffer.copyWithin(0, this.block, this.buffered);
        this.buffered -= this.block;
      }
    }
    return true;
  }
}
registerProcessor('input-processor', InputProcessor);`;

const PLAYBACK_WORKLET = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.ring = new Float32Array(98304); this.rp = 0; this.wp = 0;
    this.port.onmessage = (e) => { const c = new Float32Array(e.data.chunk);
      for (let i = 0; i < c.length; i++) { this.ring[this.wp] = c[i]; this.wp = (this.wp + 1) % this.ring.length; } }; }
  process(inputs, outputs) {
    const outL = outputs[0] && outputs[0][0];
    const outR = outputs[0] && outputs[0][1];
    if (!outL) return true;
    const len = outL.length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      if (this.rp !== this.wp) { s = this.ring[this.rp]; this.rp = (this.rp + 1) % this.ring.length; }
      outL[i] = s; if (outR) outR[i] = s;
    }
    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);`;

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
  const [chunkMs, setChunkMs] = useState(250);
  const [crossfade, setCrossfade] = useState(0.05);
  const [extraSize, setExtraSize] = useState(2.5);
  const [silent, setSilent] = useState(-60);
  const [vad, setVad] = useState(true);
  const [inGain, setInGain] = useState(100);
  const [outGain, setOutGain] = useState(100);
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
  const [latency, setLatency] = useState(0);
  const [volume, setVolume] = useState(-90);
  const [msg, setMsg] = useState("");
  const [recOn, setRecOn] = useState(false);
  const [recPath, setRecPath] = useState("assets/audios/record_audio.wav");
  const [recFormat, setRecFormat] = useState("WAV");

  const speakers = useSpeakers(model);

  const engineRunning = !!engine?.running;

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
        if (m.models.length > 0) handleModelSelect(m.models[0], m.indexes);
      })
      .catch(() => {});
  }

  const configDebounceRef = useRef<Record<string, NodeJS.Timeout>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch and unmount cleanup
  useEffect(() => {
    refreshEngine();
    loadModels();
    void apiSend("/api/realtime/prewarm", "POST").catch(() => {});
    const t = setInterval(refreshEngine, 5000);
    return () => {
      clearInterval(t);
      stopStream(true);
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

  async function startEngine() {
    setMsg(t("Starting real-time audio service…"));
    try {
      await apiSend("/api/realtime/start", "POST");
      setMsg(t("Real-time audio service running"));
      refreshEngine();
    } catch (e) {
      setMsg(errMsg(e));
    }
  }

  async function stopEngine() {
    await apiSend("/api/realtime/stop", "POST").catch(() => {});
    refreshEngine();
  }

  async function enumDevices() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devs = await navigator.mediaDevices.enumerateDevices();
      setInputs(
        devs
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` })),
      );
      setOutputs(
        devs
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })),
      );
    } catch {
      setMsg(t("Microphone permission denied — device list unavailable."));
    }
  }

  async function startStream() {
    setMsg("");
    if (!engine?.running) {
      setMsg(t("Start the engine first."));
      return;
    }
    if (!model) {
      setMsg(t("Select a voice model."));
      return;
    }
    try {
      const block = Math.round((chunkMs * 48000) / 1000);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(inDev ? { deviceId: { exact: inDev } } : {}),
          channelCount: { exact: 1 },
          sampleRate: { exact: 48000 },
        },
      });
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
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
      inNode.port.postMessage({ block_frame: block });
      src.connect(inNode);
      const playNode = new AudioWorkletNode(ctx, "playback-processor", { outputChannelCount: [2] });
      const gain = ctx.createGain();
      gain.gain.value = outGain / 100;
      playNode.connect(gain);
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      const el = new Audio();
      el.srcObject = dest.stream;
      const anyEl = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (outDev && anyEl.setSinkId) {
        try {
          await anyEl.setSinkId(outDev);
        } catch {
          /* Chrome-only; fall back to default output */
        }
      }
      await el.play();

      const ws = new WebSocket(apiWs("/api/realtime/ws-audio"));
      ws.binaryType = "arraybuffer";
      sessRef.current = { ws, ctx, stream, nodes: [src, inNode, playNode, gain], els: [el] };
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "init",
            block_frame: block,
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
        setStreaming(true);
        setMsg(t("Streaming ✓ speak into your microphone."));
        apiSend("/api/realtime/config", "PUT", { model_file: model, index_file: index }).catch(() => {});
      };
      inNode.port.onmessage = (e) => {
        const chunk: Float32Array = e.data.chunk;
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === "latency") setLatency(m.value);
            if (typeof m.volume === "number") setVolume(m.volume);
          } catch {
            /* ignore */
          }
        } else {
          playNode.port.postMessage({ chunk: ev.data }, [ev.data]);
        }
      };
      ws.onclose = () => {
        if (sessRef.current) stopStream(true);
      };
      ws.onerror = () => setMsg(t("WebSocket error — is the engine running?"));
    } catch (e) {
      setMsg(errMsg(e));
      stopStream(true);
    }
  }

  function stopStream(silentStop = false) {
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
    if (!engine?.running) {
      setMsg(t("Start the engine first."));
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
        title={t("Engine")}
        description={t("Start the real-time audio service on the backend.")}
        icon={<Radio size={18} className="text-white" />}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {!engineRunning ? (
            <Button onClick={startEngine} icon={<Play size={16} />}>
              {t("Start Service")}
            </Button>
          ) : (
            <Button variant="ghost" onClick={stopEngine} icon={<Square size={16} className="text-white" />}>
              {t("Stop Service")}
            </Button>
          )}
          <span className="text-xs text-neutral-400" role="status">
            {engineRunning ? t("Service running") : t("Service stopped")}
          </span>
        </div>
        {engine && engine.logs.length > 0 && (
          <details className="mt-2 text-xs text-neutral-400 group">
            <summary className="cursor-pointer hover:text-white transition-colors py-1 flex items-center gap-1 select-none">
              <ChevronDown size={14} className="transition-transform group-open:rotate-180 shrink-0" />
              <span>{t("Activity Details")}</span>
            </summary>
            <pre
              className="log mt-1 max-h-40 overflow-y-auto text-[11px] p-2 rounded-lg bg-black/40 border border-white/5 font-sans"
              role="log"
              aria-live="polite"
            >
              {engine.logs.slice(-10).join("\n")}
            </pre>
          </details>
        )}
      </Stage>

      <Stage
        step={2}
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
              <option value="">{t("Default")}</option>
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
              <option value="">{t("Default")}</option>
              {outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </CustomSelect>
          </div>
          <div className="flex items-end">
            <Button variant="ghost" onClick={enumDevices} icon={<ListMusic size={14} />}>
              {t("List Audio Devices")}
            </Button>
          </div>
        </div>
      </Stage>

      <Stage
        step={3}
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
                min={50}
                max={1000}
                step={10}
                unit="ms"
                onChange={setChunkMs}
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
                onChange={setInGain}
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
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/5">
          <div className="flex items-center gap-3">
            {!streaming ? (
              <Button onClick={startStream} icon={<Play size={16} />}>
                {t("Start Streaming")}
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
          </div>
          {streaming && (
            <span className="text-xs text-neutral-400 tabular-nums" role="status" aria-live="polite">
              latency {latency.toFixed(0)}ms · volume {volume.toFixed(0)}dB
            </span>
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
