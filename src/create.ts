import { PPQ, SCORE_VERSION, type Note, type Score, type Track } from "./types.js";

/** A valid empty-ish Score with defaults (`120 bpm`, `4/4`, C major, 4 measures, no tracks). Fields in `init` win. */
export function createScore(init: Partial<Score> = {}): Score {
  return {
    title: "",
    bpm: 120,
    timeSignature: "4/4",
    keySignature: 0,
    measures: 4,
    tracks: [],
    ...init,
    version: SCORE_VERSION,
    ppq: PPQ,
  };
}

/** A track with defaults (`muted`/`soloed` false, treble clef, one staff). Fields in `init` win. */
export function createTrack(init: Pick<Track, "id"> & Partial<Track>): Track {
  return {
    name: init.id,
    instrumentId: "piano",
    notes: [],
    muted: false,
    soloed: false,
    clef: "treble",
    staffCount: 1,
    ...init,
  };
}

/** A note with velocity 0.8 unless given. */
export function createNote(init: Pick<Note, "id" | "startTick" | "durationTicks" | "pitch"> & Partial<Note>): Note {
  return { velocity: 0.8, ...init };
}
