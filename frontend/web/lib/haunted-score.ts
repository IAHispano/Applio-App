// Halloween ambience score.
//
// The theme plays the opening of Grieg's "In the Hall of the Mountain King",
// the piece most horror films borrow their mood from. The note data below was
// read out of the public-domain score published by the Mutopia Project
// (Music ID Mutopia-2013/12/07-1888, Public Domain / CC0) and is kept here as
// plain data so the app ships no audio file and no extra dependency.
//
// The upper staff becomes a music box and the lower staff the bass; both are
// slowed and transposed for a background loop.

export type Voice = "bell" | "bass" | "pad";

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

/** [start, duration, pitch] in eighth notes from the start of the loop. */
type ScoreEntry = [number, number, number];

/** Length of an eighth note at the written tempo of the score. */
const EIGHTH_SECONDS = 0.217967;
/** The loop runs slower than the written tempo, which suits a background. */
const TEMPO_SCALE = 0.62;
/** The music box sits an octave above the score, the bass line as well. */
const MELODY_OCTAVE = 12;
const BASS_OCTAVE = 12;
const MELODY_LEVEL = 0.55;
const BASS_LEVEL = 0.15;
/** A slow organ bed on the tonic triad, which the bare score never spells out. */
const PAD_LEVEL = 0.05;
const PAD_CHORD = [35, 38, 42];

const MOUNTAIN_KING_MELODY: ScoreEntry[] = [
  // bar 1
  [0, 7, 54],
  [0, 7, 66],
  // bar 2
  [8, 0.5, 35],
  [9, 0.5, 37],
  [10, 0.5, 38],
  [11, 0.5, 40],
  [12, 0.5, 42],
  [13, 0.5, 38],
  [14, 1, 42],
  // bar 3
  [16, 0.5, 41],
  [17, 0.5, 37],
  [18, 1, 41],
  [20, 0.5, 40],
  [21, 0.5, 36],
  [22, 1, 40],
  // bar 4
  [24, 0.5, 35],
  [25, 0.5, 37],
  [26, 0.5, 38],
  [27, 0.5, 40],
  [28, 0.5, 42],
  [29, 0.5, 38],
  [30, 0.5, 42],
  [31, 0.5, 47],
  // bar 5
  [32, 0.5, 45],
  [33, 0.5, 42],
  [34, 0.5, 38],
  [35, 0.5, 42],
  [36, 3.5, 45],
  // bar 6
  [40, 0.5, 47],
  [41, 0.5, 49],
  [42, 0.5, 50],
  [43, 0.5, 52],
  [44, 0.5, 54],
  [45, 0.5, 50],
  [46, 1, 54],
  // bar 7
  [48, 0.5, 53],
  [49, 0.5, 49],
  [50, 1, 53],
  [52, 0.5, 52],
  [53, 0.5, 48],
  [54, 1, 52],
  // bar 8
  [56, 0.5, 47],
  [57, 0.5, 49],
  [58, 0.5, 50],
  [59, 0.5, 52],
  [60, 0.5, 54],
  [61, 0.5, 50],
  [62, 0.5, 54],
  [63, 0.5, 59],
  // bar 9
  [64, 0.5, 57],
  [65, 0.5, 54],
  [66, 0.5, 50],
  [67, 0.5, 54],
  [68, 3.5, 45],
  [68, 3.5, 57],
  // bar 10
  [72, 0.5, 42],
  [73, 0.5, 44],
  [74, 0.5, 46],
  [75, 0.5, 47],
  [76, 0.5, 49],
  [77, 0.5, 46],
  [78, 1, 49],
  // bar 11
  [80, 0.5, 50],
  [81, 0.5, 46],
  [82, 1, 50],
  [84, 0.5, 49],
  [85, 0.5, 46],
  [86, 1, 49],
  // bar 12
  [88, 0.5, 42],
  [89, 0.5, 44],
  [90, 0.5, 46],
  [91, 0.5, 47],
  [92, 0.5, 49],
  [93, 0.5, 46],
  [94, 1, 49],
  // bar 13
  [96, 0.5, 50],
  [97, 0.5, 46],
  [98, 1, 50],
  [100, 3.5, 49],
  // bar 14
  [104, 0.5, 54],
  [105, 0.5, 56],
  [106, 0.5, 58],
  [107, 0.5, 59],
  [108, 0.5, 61],
  [109, 0.5, 58],
  [110, 1, 61],
  // bar 15
  [112, 0.5, 62],
  [113, 0.5, 58],
  [114, 1, 62],
  [116, 0.5, 61],
  [117, 0.5, 58],
  [118, 1, 61],
  // bar 16
  [120, 0.5, 54],
  [121, 0.5, 56],
  [122, 0.5, 58],
  [123, 0.5, 59],
  [124, 0.5, 61],
  [125, 0.5, 58],
  [126, 1, 61],
];

const MOUNTAIN_KING_BASS: ScoreEntry[] = [
  // bar 2
  [8, 1, 23],
  [10, 1, 30],
  [12, 1, 23],
  [14, 1, 30],
  // bar 3
  [16, 1, 23],
  [18, 1, 30],
  [20, 1, 23],
  [22, 1, 30],
  // bar 4
  [24, 1, 23],
  [26, 1, 30],
  [28, 1, 23],
  [30, 1, 30],
  // bar 5
  [32, 1, 26],
  [34, 1, 33],
  [36, 1, 26],
  [38, 1, 33],
  // bar 6
  [40, 1, 23],
  [42, 1, 30],
  [44, 1, 23],
  [46, 1, 30],
  // bar 7
  [48, 1, 23],
  [50, 1, 30],
  [52, 1, 23],
  [54, 1, 30],
  // bar 8
  [56, 1, 23],
  [58, 1, 30],
  [60, 1, 23],
  [62, 1, 30],
  // bar 9
  [64, 1, 26],
  [66, 1, 33],
  [68, 1, 26],
  [70, 1, 33],
  // bar 10
  [72, 1.75, 30],
  [74, 1.75, 37],
  [76, 1.75, 30],
  [78, 1.75, 37],
  // bar 11
  [80, 1.75, 26],
  [82, 1.75, 34],
  [84, 1.75, 30],
  [86, 1.75, 37],
  // bar 12
  [88, 1.75, 30],
  [90, 1.75, 37],
  [92, 1.75, 30],
  [94, 1.75, 37],
  // bar 13
  [96, 1.75, 26],
  [98, 1.75, 34],
  [100, 1.75, 30],
  [102, 1.75, 37],
  // bar 14
  [104, 1.75, 30],
  [106, 1.75, 37],
  [108, 1.75, 30],
  [110, 1.75, 37],
  // bar 15
  [112, 1.75, 26],
  [114, 1.75, 34],
  [116, 1.75, 30],
  [118, 1.75, 37],
  // bar 16
  [120, 1.75, 30],
  [122, 1.75, 37],
  [124, 1.75, 30],
  [126, 1.75, 37],
];

export function buildMountainKingScore(): ScoreNote[] {
  const eighth = EIGHTH_SECONDS / TEMPO_SCALE;
  const notes: ScoreNote[] = [];
  for (const [start, duration, pitch] of MOUNTAIN_KING_MELODY) {
    notes.push({
      time: start * eighth,
      duration: duration * eighth,
      pitch: pitch + MELODY_OCTAVE,
      level: MELODY_LEVEL,
      voice: "bell",
    });
  }
  for (const [start, duration, pitch] of MOUNTAIN_KING_BASS) {
    notes.push({
      time: start * eighth,
      duration: duration * eighth,
      pitch: pitch + BASS_OCTAVE,
      level: BASS_LEVEL,
      voice: "bass",
    });
  }
  // The score leaves the harmony to the two-handed bass; a slow tonic bed
  // underneath keeps the loop from sounding like a bare ostinato.
  const unitsPerBar = 8;
  const phraseUnits = 8 * unitsPerBar;
  for (let bar = 0; bar < 16; bar += 8) {
    for (const pitch of PAD_CHORD) {
      notes.push({
        time: bar * unitsPerBar * eighth,
        duration: phraseUnits * eighth,
        pitch,
        level: PAD_LEVEL,
        voice: "pad",
      });
    }
  }
  return notes.sort((a, b) => a.time - b.time);
}
