import { PPQ, type Score, type Track } from "./types.js";

/** Parse `"num/den"`. Returns null for anything that is not a positive pair. */
export function parseTimeSignature(timeSignature: string): { num: number; den: number } | null {
  const m = /^([0-9]+)\/([0-9]+)$/.exec(timeSignature);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!(num > 0) || !(den > 0)) return null;
  return { num, den };
}

/** Quarter notes in a measure of this meter (`6/8` is 3). Unparseable meters count as 4/4. */
export function beatsPerMeasure(timeSignature: string): number {
  const ts = parseTimeSignature(timeSignature);
  return ts ? ts.num * (4 / ts.den) : 4;
}

/** Ticks in one measure: `round(num * 4 / den * 480)`. */
export function ticksPerMeasure(timeSignature: string): number {
  return Math.round(beatsPerMeasure(timeSignature) * PPQ);
}

/** Muted tracks are silent; when any track is soloed only soloed tracks sound, and mute still wins. */
export function trackIsAudible(track: Pick<Track, "muted" | "soloed">, allTracks: readonly Pick<Track, "soloed">[]): boolean {
  const anySolo = allTracks.some((t) => t.soloed === true);
  if (anySolo) return track.soloed === true && track.muted !== true;
  return track.muted !== true;
}

/** The tick the last note stops (0 for an empty score), in written time. */
export function scoreEndTick(score: Pick<Score, "tracks">): number {
  let end = 0;
  for (const t of score.tracks) {
    for (const n of t.notes) end = Math.max(end, n.startTick + n.durationTicks);
  }
  return end;
}
