import { PPQ, type Note, type Score, type Track } from "../src/index.js";

export const TPM = PPQ * 4;

/** Small seeded PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

export function note(over: Partial<Note> & Pick<Note, "id">): Note {
  return { startTick: 0, durationTicks: PPQ, pitch: 60, velocity: 0.7, ...over };
}

export function track(over: Partial<Track> = {}): Track {
  return {
    id: "t1",
    name: "T",
    instrumentId: "saw-lead",
    muted: false,
    soloed: false,
    clef: "treble",
    notes: [note({ id: "a" }), note({ id: "b", startTick: TPM, pitch: 64 })],
    ...over,
  };
}

export function score(over: Partial<Score> = {}): Score {
  return { version: 1, ppq: 480, title: "S", bpm: 120, timeSignature: "4/4", measures: 3, tracks: [track()], ...over };
}

export const METERS = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8", "3/2", "2/2", "5/16"];
