"use client";

import { ChevronDown, Disc, Gauge, ListMusic, Play, Radio, Square, Wand2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import {
  Alert,
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
import { useSpeakers } from "@/lib/useSpeakers";

const API_HTTP = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
function apiWs(path: string): string {
  const u = API_HTTP.replace(/^http/, "ws");
  return `${u}${path}`;
}

const INPUT_WORKLET = `
class InputProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.ring = new Float32Array(48000); this.pos = 0; this.block = 0;
    this.port.onmessage = (e) => { this.block = e.data.block_frame || 0; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { for (let i = 0; i < ch.length; i++) { this.ring[this.pos] = ch[i]; this.pos = (this.pos + 1) % this.ring.length; } }
    if (this.block > 0 && this.pos % this.block === 0 && ch) {
      const out = new Float32Array(this.block);
      for (let i = 0; i < this.block; i++) out[i] = this.ring[(this.pos - this.block + i + this.ring.length) % this.ring.length];
      this.port.postMessage({ chunk: out }, [out.buffer]);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial model fetch
  useEffect(() => {
    refreshEngine();
    loadModels();
    const t = setInterval(refreshEngine, 5000);
    return () => clearInterval(t);
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
      await ctx.audioWorklet.addModule(
        URL.createObjectURL(new Blob([INPUT_WORKLET], { type: "application/javascript" })),
      );
      await ctx.audioWorklet.addModule(
        URL.createObjectURL(new Blob([PLAYBACK_WORKLET], { type: "application/javascript" })),
      );
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
            post_process: false,
            kwargs: {},
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
                if (streaming) changeConfig("f0_up_key", v);
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
                if (streaming) changeConfig("index_rate", v);
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
                if (streaming) changeConfig("protect", v);
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
                if (streaming) changeConfig("volume_envelope", v);
              }}
            />
          </div>
          <div>
            <label htmlFor="rt-speaker-id">{t("Speaker ID")}</label>
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
                  {s}
                </option>
              ))}
            </CustomSelect>
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
                  if (streaming) changeConfig("autotune_strength", v);
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
                  if (streaming) changeConfig("proposed_pitch_threshold", v);
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
                  if (streaming) changeConfig("clean_strength", v);
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
                  if (streaming) changeConfig("cross_fade_overlap_size", v);
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
                  if (streaming) changeConfig("extra_convert_size", v);
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
                  if (streaming) changeConfig("silent_threshold", v);
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
