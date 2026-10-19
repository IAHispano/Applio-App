"use client";

import { Moon, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { buildMountainKingScore } from "@/lib/haunted-score";
import { useI18n } from "@/lib/i18n";

const EMBERS = Array.from({ length: 12 }, (_, offset) => ({ id: `ember-${offset}`, offset }));

function Cobweb({ mirror = false }: { mirror?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`haunt-web ${mirror ? "haunt-web-right" : ""}`}
      viewBox="0 0 240 240"
      fill="none"
    >
      <path d="M0 0 232 22M0 0 218 84M0 0 174 156M0 0 103 211M0 0 28 235" />
      {[0.24, 0.45, 0.68, 0.92].map((scale) => (
        <path
          key={scale}
          transform={`scale(${scale})`}
          d="M232 22Q196 46 218 84Q174 104 174 156Q126 152 103 211Q62 184 28 235"
        />
      ))}
    </svg>
  );
}

function Spider({ className }: { className: string }) {
  return (
    <div className={`haunt-spider ${className}`}>
      <div className="haunt-silk" />
      <svg aria-hidden="true" viewBox="0 0 100 90" fill="none">
        <g className="haunt-legs">
          <path d="M42 44 23 26 8 34M40 49 17 43 3 55M40 55 18 62 9 78M44 60 32 76 29 88M58 44 77 26 92 34M60 49 83 43 97 55M60 55 82 62 91 78M56 60 68 76 71 88" />
        </g>
        <ellipse cx="50" cy="39" rx="14" ry="20" fill="#21132c" stroke="#9e658d" />
        <ellipse cx="50" cy="58" rx="11" ry="12" fill="#160c20" stroke="#9e658d" />
        <path d="m44 31 6 9 6-9-6 4Z" fill="#dc7139" />
        <g className="haunt-spider-eyes" fill="#ffb654">
          <circle cx="46" cy="58" r="2.4" />
          <circle cx="54" cy="58" r="2.4" />
        </g>
      </svg>
    </div>
  );
}

function Pumpkin({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`haunt-pumpkin ${small ? "haunt-pumpkin-small" : ""}`}
      viewBox="0 0 120 120"
      fill="none"
    >
      <path d="m57 35 3-19 13-5-6 23" fill="#747647" stroke="#aaa265" strokeWidth="2" />
      <path
        d="M60 34C29 17 6 47 13 79c6 27 26 33 47 26 22 8 44 0 49-28 6-31-18-59-49-43Z"
        fill="#592515"
        stroke="#c66a31"
        strokeWidth="2"
      />
      <path
        d="M42 34C19 57 27 91 40 105M78 34c22 24 14 58 1 71M60 35v68"
        stroke="#d67b38"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <g className="haunt-candle" fill="#ffc35d" stroke="#ff9b42" strokeWidth="1.5">
        <path d="m31 53 20 14-23 1ZM88 53 68 67l24 1ZM60 67l-6 12h12ZM30 81l14 5 6-5 8 9 9-8 7 5 15-7c-6 22-46 25-59 1Z" />
      </g>
    </svg>
  );
}

// The theme plays Grieg's "In the Hall of the Mountain King" as a music box
// over the bass line; the score lives in lib/haunted-score as plain note data.
const AMBIENCE_SCORE = buildMountainKingScore();

function midiToHz(midi: number): number {
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

// Music box voice: an inharmonic partial stack under a fast-decaying body.
function playBell(
  context: AudioContext,
  out: AudioNode,
  midi: number,
  time: number,
  level: number,
  duration: number,
) {
  const frequency = midiToHz(midi);
  const decay = Math.min(1.2, Math.max(0.22, duration * 0.8));
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(level, time + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  envelope.connect(out);
  const partials = [
    [1, 1, decay],
    [2.76, 0.26, decay * 0.42],
    [5.4, 0.09, decay * 0.2],
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

// Organ bed: a detuned saw pair through a low pass, with a slow swell.
function playPad(
  context: AudioContext,
  out: AudioNode,
  midi: number,
  time: number,
  duration: number,
  level: number,
) {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 820;
  filter.Q.value = 0.6;
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + 1.6);
  envelope.gain.setValueAtTime(level, time + Math.max(1.7, duration - 2));
  envelope.gain.linearRampToValueAtTime(0.0001, time + duration);
  filter.connect(envelope).connect(out);
  for (const detune of [-8, 8]) {
    const osc = context.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiToHz(midi);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + duration + 0.1);
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
  const osc = context.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = midiToHz(midi);
  const attack = Math.min(0.5, duration * 0.35);
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, time);
  envelope.gain.linearRampToValueAtTime(level, time + attack);
  envelope.gain.setValueAtTime(level, time + Math.max(attack + 0.05, duration * 0.55));
  envelope.gain.linearRampToValueAtTime(0.0001, time + duration);
  osc.connect(envelope).connect(out);
  osc.start(time);
  osc.stop(time + duration + 0.1);
}

// Distant wind: filtered noise with a slow gust.
function playWind(context: AudioContext, out: AudioNode) {
  const length = Math.floor(context.sampleRate * 4);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 380;
  const gain = context.createGain();
  gain.gain.value = 0.075;
  const gust = context.createOscillator();
  gust.frequency.value = 0.07;
  const gustDepth = context.createGain();
  gustDepth.gain.value = 0.028;
  gust.connect(gustDepth).connect(gain.gain);
  source.connect(filter).connect(gain).connect(out);
  source.start();
  gust.start();
}

// Builds the whole ambience graph and returns a stop function.
export function startAmbience(context: AudioContext): () => void {
  const master = context.createGain();
  master.gain.value = 0.9;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 3;
  master.connect(compressor).connect(context.destination);

  const reverb = context.createConvolver();
  reverb.buffer = createImpulse(context, 3.4);
  const wet = context.createGain();
  wet.gain.value = 0.6;
  const dry = context.createGain();
  dry.gain.value = 0.55;
  reverb.connect(wet).connect(master);
  dry.connect(master);

  const bus = (level: number) => {
    const gain = context.createGain();
    gain.gain.value = level;
    gain.connect(dry);
    gain.connect(reverb);
    return gain;
  };
  const bellBus = bus(1);
  const padBus = bus(0.9);
  const bassBus = bus(0.8);
  const windBus = bus(1);

  playWind(context, windBus);

  // Lookahead scheduler: notes are queued slightly ahead of the clock and
  // the score repeats for as long as the ambience stays on.
  const score = AMBIENCE_SCORE;
  const loopSeconds = score.reduce((longest, note) => Math.max(longest, note.time + note.duration), 0);
  let index = 0;
  let cycleStart = context.currentTime + 0.3;
  // Absolute clock time of the next note, which is what the queue compares
  // against; the cycle start alone drifts into the past as the loop runs.
  let nextAt = cycleStart;
  const timer = setInterval(() => {
    if (nextAt < context.currentTime - 1) {
      // The clock ran ahead of the score (a frozen tab): restart the loop.
      index = 0;
      cycleStart = context.currentTime + 0.2;
      nextAt = cycleStart;
    }
    const horizon = context.currentTime + 0.4;
    while (index < score.length && nextAt <= horizon) {
      const note = score[index++];
      const when = nextAt;
      if (note.voice === "bell") {
        playBell(context, bellBus, note.pitch, when, note.level, note.duration);
      } else if (note.voice === "pad") {
        playPad(context, padBus, note.pitch, when, note.duration, note.level);
      } else {
        playBass(context, bassBus, note.pitch, when, note.duration, note.level);
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
    for (const node of [bellBus, padBus, bassBus, windBus, dry, wet, reverb, master, compressor]) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
  };
}

export function useHauntedSound(enabled: boolean, quiet: boolean) {
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
  useEffect(() => {
    const context = audio.current;
    if (!enabled || quiet || !context) return;
    const stop = startAmbience(context);
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

function HauntedScene() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [sound, setSound] = useState(false);
  const quiet = pathname === "/realtime" || pathname === "/report";
  const unlockSound = useHauntedSound(sound, quiet);
  useEffect(() => {
    if (quiet) setSound(false);
  }, [quiet]);

  return (
    <>
      <div className="haunt-scene" aria-hidden="true">
        <div className="haunt-moon">
          <Moon size={72} strokeWidth={0.6} />
        </div>
        <Cobweb />
        <Cobweb mirror />
        <Spider className="haunt-spider-left" />
        <Spider className="haunt-spider-right" />
        <div className="haunt-bats">
          {[0, 1, 2].map((bat) => (
            <svg
              aria-hidden="true"
              key={bat}
              className={`haunt-bat haunt-bat-${bat}`}
              viewBox="0 0 100 50"
              fill="currentColor"
            >
              <g className="haunt-wing-left">
                <path d="M49 27C32 4 16 20 2 4c0 20 10 26 19 30 2-9 13-7 15 2 5-6 9-3 13-1Z" />
              </g>
              <g className="haunt-wing-right">
                <path d="M51 27C68 4 84 20 98 4c0 20-10 26-19 30-2-9-13-7-15 2-5-6-9-3-13-1Z" />
              </g>
              <path d="m45 16 5 5 5-5 3 17-8 12-8-12Z" />
              <path d="M47 28h2m2 0h2" stroke="#ffb654" strokeWidth="2" />
            </svg>
          ))}
        </div>
        <div className="haunt-eyes">
          <i />
          <i />
        </div>
        <div className="haunt-pumpkins">
          <Pumpkin />
          <Pumpkin small />
        </div>
        <div className="haunt-fog haunt-fog-back" />
        <div className="haunt-fog" />
        <div className="haunt-embers">
          {EMBERS.map((ember) => (
            <i key={ember.id} style={{ "--ember": ember.offset } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="haunt-controls">
        <IconButton
          icon={sound && !quiet ? <Volume2 size={15} /> : <VolumeX size={15} />}
          label={t(
            quiet
              ? "Halloween sounds are paused on this page"
              : sound
                ? "Mute Halloween sounds"
                : "Enable Halloween sounds",
          )}
          aria-pressed={sound && !quiet}
          disabled={quiet}
          onClick={() => {
            if (sound) setSound(false);
            else if (unlockSound()) setSound(true);
          }}
        />
      </div>
    </>
  );
}

export default function HalloweenEffects() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setActive(root.dataset.themeEffects === "halloween");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme-effects"] });
    return () => observer.disconnect();
  }, []);
  return active ? <HauntedScene /> : null;
}
