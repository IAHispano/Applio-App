// Christmas ambience score.
//
// The theme plays "Jingle Bells" (James Lord Pierpont, 1857; public domain)
// as a danceable instrumental, transcribed from the full public-domain MIDI
// "Jingle Bells full Ab.mid" by Hyacinth (Wikimedia Commons, PDM 1.0),
// so the app ships no audio file.
//
// The source arrangement is kept intact (piano + choir over 72 bars at
// 120 BPM) and a driving drum pattern is added underneath so the loop has
// actual rhythm — no drone wash, no filler.

import { BASS, BPM, CHOIR, type JingleNote, MELODY, TICKS_PER_QUARTER, TOTAL_TICKS } from "./jingle-bells";
import type { ScoreNote, Voice } from "./music-box";

const TICK_SECONDS = 60 / BPM / TICKS_PER_QUARTER;
export const JINGLE_BELLS_SECONDS = TOTAL_TICKS * TICK_SECONDS;

function toNotes(notes: readonly JingleNote[], voice: Voice, scale: number): ScoreNote[] {
  return notes.map(([start, duration, pitch, vel]) => ({
    time: start * TICK_SECONDS,
    duration: duration * TICK_SECONDS,
    pitch,
    level: (vel / 127) * scale,
    voice,
  }));
}

// Drum pattern per 4/4 bar at 120 BPM (2 s): kick on all four beats, snare on
// 2 & 4 (backbeat), hats/sleigh bells on eighths with a sleigh accent on 2 & 4.
function drums(): ScoreNote[] {
  const notes: ScoreNote[] = [];
  const bars = Math.floor(TOTAL_TICKS / (TICKS_PER_QUARTER * 4));
  const eighth = TICK_SECONDS * (TICKS_PER_QUARTER / 2);
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * 4 * TICKS_PER_QUARTER * TICK_SECONDS;
    for (let step = 0; step < 8; step++) {
      const time = barStart + step * eighth;
      if (step % 2 === 0) {
        notes.push({ time, duration: 0.1, pitch: 36, level: step % 4 === 0 ? 0.85 : 0.75, voice: "kick" });
      }
      if (step === 2 || step === 6) {
        notes.push({ time, duration: 0.09, pitch: 38, level: 0.55, voice: "snare" });
      }
      notes.push({ time, duration: 0.03, pitch: 42, level: step % 2 === 0 ? 0.4 : 0.26, voice: "hat" });
      notes.push({
        time,
        duration: 0.08,
        pitch: 83,
        level: step === 2 || step === 6 ? 0.42 : 0.24,
        voice: "sleigh",
      });
    }
  }
  return notes;
}

export function buildJingleBellsScore(): ScoreNote[] {
  return [
    ...toNotes(MELODY, "piano", 0.92),
    ...toNotes(CHOIR, "choir", 0.5),
    ...toNotes(BASS, "bass", 0.85),
    ...drums(),
  ].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
