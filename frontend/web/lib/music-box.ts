// Shared season ambience engine.
//
// Christmas theme ambience. Springs from a public-domain MIDI of Jingle Bells
// converted to plain note data (lib/jingle-bells.ts), voiced as piano + choir
// over a real drum pattern. Halloween uses a public-domain orchestral recording
// instead of synthesis, so no Halloween voices live here.

import { useEffect, useRef } from "react";

export type Voice = "piano" | "choir" | "bass" | "kick" | "snare" | "hat" | "sleigh";

export interface ScoreNote {
  /** Seconds from the start of the loop. */
  time: number;
  /** MIDI note number. */
  pitch: number;
  /** Seconds. */
  duration: number;
  /** Playback level, 0..1. */
  level: number;
  voice: Voice;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// A decaying noise burst is a serviceable cathedral impulse response.
function createImpulse(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2.6;
    }
  }
  return impulse;
}

// Grand piano voice: fundamental plus decaying inharmonic partials.
function playPiano(
  context: AudioContext,
  out: AudioNode,
  midi: number,
  time: number,
  level: number,
  duration: number,
) {
  const frequency = midiToHz(midi);
  const decay = Math.min(2.4, Math.max(0.4, duration * 0.95));
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  envelope.connect(out);
  const partials = [
    [1, 1, decay],
    [2, 0.45, decay * 0.7],
    [3, 0.18, decay * 0.45],
    [4.2, 0.08, decay * 0.28],
  ];
  for (const [ratio, weight, partialDecay] of partials) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency * ratio;
    const gain = context.createGain();
    gain.gain.setValueAtTime(weight, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + partialDecay);
    osc.connect(gain).connect(envelope);
    osc.start(time);
    osc.stop(time + partialDecay + 0.05);
  }
}

// Choir voice: two detuned sawtooths through a low pass with a soft swell.
function playChoir(
  context: AudioContext,
  out: AudioNode,
  midi: number,
  time: number,
  level: number,
  duration: number,
) {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1100;
  filter.Q.value = 0.7;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.09);
  envelope.gain.setValueAtTime(level, time + Math.max(0.12, duration - 0.18));
  envelope.gain.linearRampToValueAtTime(0.0001, time + duration + 0.12);
  filter.connect(envelope).connect(out);
  for (const detune of [-9, 9]) {
    const osc = context.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiToHz(midi);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + duration + 0.15);
  }
}

function playBass(
  context: AudioContext,
  out: AudioNode,
  midi: number,
  time: number,
  duration: number,
  level: number,
) {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.5;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.07);
  envelope.gain.setValueAtTime(level, time + Math.max(0.08, duration - 0.1));
  envelope.gain.linearRampToValueAtTime(0.0001, time + duration + 0.08);
  const osc = context.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = midiToHz(midi);
  osc.connect(filter);
  filter.connect(envelope).connect(out);
  osc.start(time);
  osc.stop(time + duration + 0.1);
}

function playKick(context: AudioContext, out: AudioNode, time: number, level: number) {
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(43, time + 0.11);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(level, time);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
  osc.connect(envelope).connect(out);
  osc.start(time);
  osc.stop(time + 0.25);
}

function playSnare(context: AudioContext, out: AudioNode, time: number, level: number) {
  const noise = noiseSource(context, 0.2);
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1900;
  band.Q.value = 0.9;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(level, time);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
  noise.connect(band).connect(envelope).connect(out);
  noise.start(time);
  const tone = context.createOscillator();
  tone.type = "triangle";
  tone.frequency.value = 184;
  const toneEnv = context.createGain();
  toneEnv.gain.setValueAtTime(level * 0.5, time);
  toneEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
  tone.connect(toneEnv).connect(out);
  tone.start(time);
  tone.stop(time + 0.12);
}

function playHat(context: AudioContext, out: AudioNode, time: number, level: number) {
  const noise = noiseSource(context, 0.05);
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 7200;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(level, time);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
  noise.connect(high).connect(envelope).connect(out);
  noise.start(time);
}

// Sleigh bells: metallic jingle struck together.
function playSleigh(context: AudioContext, out: AudioNode, time: number, level: number) {
  for (const ratio of [1, 1.19, 1.51]) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 2600 * ratio;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(level * (1 / ratio), time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(envelope).connect(out);
    osc.start(time);
    osc.stop(time + 0.25);
  }
  const noise = noiseSource(context, 0.08);
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 5200;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(level * 0.6, time);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  noise.connect(high).connect(envelope).connect(out);
  noise.start(time);
}

function noiseSource(context: AudioContext, seconds: number): AudioBufferSourceNode {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

// Builds the whole ambience graph and returns a stop function.
export function startSeasonalAmbience(context: AudioContext, score: ScoreNote[]): () => void {
  const master = context.createGain();
  master.gain.value = 0.22;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 3;
  master.connect(compressor).connect(context.destination);

  const reverb = context.createConvolver();
  reverb.buffer = createImpulse(context, 1.8);
  const wet = context.createGain();
  wet.gain.value = 0.28;
  const dry = context.createGain();
  dry.gain.value = 0.85;
  reverb.connect(wet).connect(master);
  dry.connect(master);

  const bus = (level: number) => {
    const gain = context.createGain();
    gain.gain.value = level;
    gain.connect(dry);
    gain.connect(reverb);
    return gain;
  };
  const pianoBus = bus(1);
  const choirBus = bus(0.9);
  const bassBus = bus(0.75);
  const kickBus = bus(1.4);
  const snareBus = bus(1.1);
  const hatBus = bus(1);
  const sleighBus = bus(0.9);

  // Lookahead scheduler: notes are queued slightly ahead of the clock and
  // the score repeats for as long as the ambience stays on.
  const loopSeconds = score.reduce((longest, note) => Math.max(longest, note.time + note.duration), 0);
  let index = 0;
  let cycleStart = context.currentTime + 0.3;
  let nextAt = cycleStart;
  const timer = setInterval(() => {
    if (nextAt < context.currentTime - 1) {
      index = 0;
      cycleStart = context.currentTime + 0.2;
      nextAt = cycleStart;
    }
    const horizon = context.currentTime + 0.4;
    while (index < score.length && nextAt <= horizon) {
      const note = score[index++];
      const when = nextAt;
      if (note.voice === "piano") {
        playPiano(context, pianoBus, note.pitch, when, note.level, note.duration);
      } else if (note.voice === "choir") {
        playChoir(context, choirBus, note.pitch, when, note.level, note.duration);
      } else if (note.voice === "bass") {
        playBass(context, bassBus, note.pitch, when, note.duration, note.level);
      } else if (note.voice === "kick") {
        playKick(context, kickBus, when, note.level);
      } else if (note.voice === "snare") {
        playSnare(context, snareBus, when, note.level);
      } else if (note.voice === "hat") {
        playHat(context, hatBus, when, note.level);
      } else if (note.voice === "sleigh") {
        playSleigh(context, sleighBus, when, note.level);
      }
      nextAt = cycleStart + (index < score.length ? score[index].time : loopSeconds);
    }
    if (index >= score.length) {
      index = 0;
      cycleStart += loopSeconds;
      nextAt = cycleStart + (score[0]?.time ?? 0);
    }
  }, 80);

  return () => {
    clearInterval(timer);
    for (const node of [
      pianoBus,
      choirBus,
      bassBus,
      kickBus,
      snareBus,
      hatBus,
      sleighBus,
      dry,
      wet,
      reverb,
      master,
      compressor,
    ]) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
  };
}

export function useSeasonalAmbience(enabled: boolean, quiet: boolean, score: ScoreNote[]) {
  const audio = useRef<AudioContext | null>(null);
  // WebKit needs the user gesture itself to unlock audio.
  const unlock = () => {
    try {
      const context = new AudioContext();
      audio.current = context;
      void context.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
  const scoreRef = useRef(score);
  scoreRef.current = score;
  useEffect(() => {
    const context = audio.current;
    if (!enabled || quiet || !context) return;
    const stop = startSeasonalAmbience(context, scoreRef.current);
    let disposed = false;
    const update = () => {
      if (disposed) return;
      const playing = Array.from(document.querySelectorAll<HTMLMediaElement>("audio, video")).some(
        (media) => !media.paused && !media.ended && !media.muted,
      );
      if (document.hidden || playing) void context.suspend().catch(() => {});
      else void context.resume().catch(() => {});
    };
    update();
    document.addEventListener("visibilitychange", update);
    for (const event of ["play", "pause", "ended", "volumechange"])
      document.addEventListener(event, update, true);
    return () => {
      disposed = true;
      stop();
      if (audio.current === context) audio.current = null;
      void context.close().catch(() => {});
      document.removeEventListener("visibilitychange", update);
      for (const event of ["play", "pause", "ended", "volumechange"])
        document.removeEventListener(event, update, true);
    };
  }, [enabled, quiet]);
  useEffect(
    () => () => {
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
    },
    [],
  );
  return unlock;
}
