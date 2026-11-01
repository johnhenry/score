import type { KeyChange, Score } from "./types.js";

/** Key as a function of position, keyed by measure, in fifths. A key change moves no barlines. */
export interface KeyMap {
  /** Sorted by measure, always starting at measure 0. */
  readonly points: readonly KeyChange[];
}

/** Clamp to -7..7 and round. Non-finite becomes 0. */
export function clampFifths(fifths: number): number {
  if (!Number.isFinite(fifths)) return 0;
  return Math.max(-7, Math.min(7, Math.round(fifths)));
}

export function buildKeyMap(score: Pick<Score, "keySignature" | "keyChanges">): KeyMap {
  const sorted = (score.keyChanges ?? [])
    .filter((c) => Number.isFinite(c.measure) && Number.isFinite(c.fifths))
    .map((c) => ({ measure: Math.max(0, Math.round(c.measure)), fifths: clampFifths(c.fifths) }))
    .sort((a, b) => a.measure - b.measure);

  const points: KeyChange[] = [{ measure: 0, fifths: clampFifths(score.keySignature ?? 0) }];
  for (const change of sorted) {
    const last = points[points.length - 1]!;
    if (last.measure === change.measure) points[points.length - 1] = change;
    else if (last.fifths !== change.fifths) points.push(change);
  }
  const clean: KeyChange[] = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (last && last.fifths === p.fifths) continue;
    clean.push(p);
  }
  return { points: clean };
}

/** The key in force at `measure`. */
export function fifthsAt(map: KeyMap, measure: number): number {
  const m = Math.max(0, measure);
  let lo = 0;
  let hi = map.points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (map.points[mid]!.measure <= m) lo = mid;
    else hi = mid - 1;
  }
  return map.points[lo]!.fifths;
}

export function isUniformKey(map: KeyMap): boolean {
  return map.points.length === 1;
}

/** Whether a new key signature must be DRAWN at `measure` (never at measure 0). */
export function keyChangesAt(map: KeyMap, measure: number): boolean {
  return measure > 0 && map.points.some((p) => p.measure === measure);
}
