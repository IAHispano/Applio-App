// Halloween ambience score.
//
// Grieg's "In the Hall of the Mountain King", Op. 46 No. 4 — the complete
// piano transcription, not a fragment loop. The note data was read out of the
// public-domain Mutopia Project MIDI (ID Mutopia-2013/12/07-1888, Public
// Domain / CC0) and keeps the arranger's velocity crescendo (62 → 101) and
// the tempo marks (138 BPM, pushing to 154 BPM at bar 2). An octave above
// the score it sounds as the original music box over an organ sustain.

import { BASS, LEAD, TICKS_PER_QUARTER, TOTAL_TICKS } from "./mountain-king";
import type { ScoreNote } from "./music-box";

const SECS_PER_TICK_138 = 60 / 138 / TICKS_PER_QUARTER;
const SECS_PER_TICK_154 = 60 / 154 / TICKS_PER_QUARTER;
const ACCELERANDO_TICK = 196;

/** Tick-to-second conversion honoring the source's two tempo marks. */
function timeAt(tick: number): number {
  if (tick <= ACCELERANDO_TICK) return tick * SECS_PER_TICK_138;
  return ACCELERANDO_TICK * SECS_PER_TICK_138 + (tick - ACCELERANDO_TICK) * SECS_PER_TICK_154;
}

/** The music box sits an octave above the score, the bass line as well. */
const MELODY_OCTAVE = 12;
const BASS_OCTAVE = 12;
/** Peaks; the arranger's velocity curve scales each note below these. */
const MELODY_PEAK = 0.55;
const BASS_PEAK = 0.3;
/** A slow organ bed on the tonic triad (B minor), as in the original loop. */
const PAD_LEVEL = 0.05;
const PAD_CHORD = [35, 38, 42];

function voice(notes: typeof LEAD, voiceName: "bell" | "bass", octave: number, peak: number): ScoreNote[] {
  return notes.map(([start, duration, pitch, velocity]) => ({
    time: timeAt(start),
    duration: timeAt(start + duration) - timeAt(start),
    pitch: pitch + octave,
    level: (velocity / 101) * peak,
    voice: voiceName,
  }));
}

export function buildMountainKingScore(): ScoreNote[] {
  const loopSeconds = timeAt(TOTAL_TICKS);
  const notes: ScoreNote[] = [
    ...voice(LEAD, "bell", MELODY_OCTAVE, MELODY_PEAK),
    ...voice(BASS, "bass", BASS_OCTAVE, BASS_PEAK),
  ];
  for (const pitch of PAD_CHORD) {
    notes.push({
      time: 0,
      duration: loopSeconds,
      pitch,
      level: PAD_LEVEL,
      voice: "pad",
    });
  }
  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
