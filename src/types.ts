/** Ticks per quarter note. Fixed by format 1 (the schema's `ppq` const). */
export const PPQ = 480;
/** The Score format this package reads and writes. */
export const SCORE_VERSION = 1;

export const MIN_BPM = 20;
export const MAX_BPM = 300;

export type Clef = "treble" | "bass" | "alto" | "tenor";
export type Accidental = "sharp" | "flat" | "natural" | "double-sharp" | "double-flat";
export type Articulation = "staccato" | "accent" | "tenuto" | "marcato" | "fermata";
export type Dynamic = "pp" | "p" | "mp" | "mf" | "f" | "ff";

/**
 * One note. The first five fields are all that playback needs; the rest are
 * notation-only and never change what is heard.
 */
export interface Note {
  /** Unique within the score; edits address notes by it. */
  id: string;
  startTick: number;
  durationTicks: number;
  /** MIDI note number, 60 = middle C. */
  pitch: number;
  /** 0..1 */
  velocity: number;
  lyric?: string;
  lyricHyphen?: boolean;
  staff?: 1 | 2;
  voice?: 1 | 2 | 3 | 4 | number;
  accidental?: Accidental;
  tiedToNext?: boolean;
  slurStart?: boolean;
  slurStop?: boolean;
  hairpin?: "cresc" | "dim";
  hairpinStop?: boolean;
  /** `{ num: 3, den: 2 }` is a triplet. Notation only. */
  tuplet?: { num: number; den: number };
  articulations?: Articulation[];
  dynamic?: Dynamic;
}

export interface Rest {
  id: string;
  startTick: number;
  durationTicks: number;
  voice?: number;
  staff?: 1 | 2;
}

export interface ClefChange {
  tick: number;
  clef: Clef;
}

/**
 * A track is an instrument (a part), not a clip lane. Clips and patterns
 * (viaframe #828) are a different shape and will live beside `tracks`, not
 * inside it.
 */
export interface Track {
  id: string;
  name: string;
  /** A pointer: a GM preset id, `patch:<id>`, or `sample:<id>`. */
  instrumentId: string;
  notes: Note[];
  muted?: boolean;
  soloed?: boolean;
  clef?: Clef;
  staffCount?: 1 | 2;
  lowerClef?: Clef;
  clefChanges?: ClefChange[];
  rests?: Rest[];
  volume?: number;
  pan?: number;
  /** Shape owned by the audio side; carried through untouched. */
  effects?: Record<string, unknown>[];
  sends?: Record<string, unknown>[];
  hidden?: boolean;
}

export interface TempoChange {
  tick: number;
  bpm: number;
}

export interface MeterChange {
  /** 0-based measure. */
  measure: number;
  timeSignature: string;
}

export interface KeyChange {
  /** 0-based measure. */
  measure: number;
  /** +n sharps, -n flats. */
  fifths: number;
}

export interface RepeatMark {
  measure: number;
  /** Repeat sign on the measure's left barline. */
  start?: boolean;
  /** Repeat sign on the right barline; `times` is the TOTAL number of plays. */
  end?: { times: number };
  /** A volta bracket beginning at this measure. */
  ending?: { numbers: number[]; stop: boolean };
}

/**
 * A Score (format 1). Shape: `schema/score.schema.json`, which is the source
 * of truth.
 *
 * Unknown fields are ignored by readers and kept by writers that round-trip:
 * every function here returns the caller's extra fields intact when it copies a
 * score, and none rejects them. That is where patterns and clips (viaframe
 * #828) will go: new optional top-level fields, not a new `version`.
 */
export interface Score {
  version: 1;
  ppq: 480;
  title?: string;
  /** Quarter notes a minute at tick 0. */
  bpm: number;
  /** The meter at measure 0, `"num/den"`. */
  timeSignature: string;
  /** The key at measure 0, in fifths. */
  keySignature?: number;
  /** Measures the written grid shows; a reader takes the larger of this and what the notes need. */
  measures?: number;
  tempoChanges?: TempoChange[];
  meterChanges?: MeterChange[];
  keyChanges?: KeyChange[];
  repeats?: RepeatMark[];
  tracks: Track[];
  /** Open-shaped: owned by the audio side. */
  patches?: Record<string, unknown>[];
  buses?: Record<string, unknown>[];
}
