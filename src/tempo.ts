import { MAX_BPM, MIN_BPM, PPQ, type Score, type TempoChange } from "./types.js";

/**
 * Tempo as a function of position: a step function (each tempo holds until the
 * next change), keyed by tick.
 *
 * Ticks are authoritative. Seconds exist only at the audio boundary and are
 * derived here, and only here.
 */
export interface TempoMap {
  /** Sorted by tick, always starting at tick 0, no redundant entries. */
  readonly points: readonly TempoChange[];
  /** Seconds elapsed at each point, precomputed so lookups need no sum. */
  readonly secondsAt: readonly number[];
}

/** Clamp to 20..300. Fractions are kept (a real .mid can say 120.5). Non-finite becomes 120. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

/** Seconds one tick lasts at `bpm`: `60 / (bpm * 480)`. */
export function secondsPerTick(bpm: number): number {
  return 60 / (clampBpm(bpm) * PPQ);
}

/**
 * Build the map from `score.bpm` (tick 0) and `score.tempoChanges`.
 *
 * Sorted; non-finite entries dropped; ticks rounded and floored at 0; a second
 * change at one tick wins; a change to the tempo already in force is dropped; a
 * change at tick 0 overrides the opening `bpm`.
 */
export function buildTempoMap(score: Pick<Score, "bpm" | "tempoChanges">): TempoMap {
  const sorted = (score.tempoChanges ?? [])
    .filter((c) => Number.isFinite(c.tick) && Number.isFinite(c.bpm))
    .map((c) => ({ tick: Math.max(0, Math.round(c.tick)), bpm: clampBpm(c.bpm) }))
    // Array.prototype.sort is stable, so the later of two equal ticks stays later.
    .sort((a, b) => a.tick - b.tick);

  const points: TempoChange[] = [{ tick: 0, bpm: clampBpm(score.bpm) }];
  for (const change of sorted) {
    const last = points[points.length - 1]!;
    if (last.tick === change.tick) points[points.length - 1] = change;
    else if (last.bpm !== change.bpm) points.push(change);
  }
  // A same-tick replacement may have restored the previous tempo: re-dedup.
  const clean: TempoChange[] = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (last && last.bpm === p.bpm) continue;
    clean.push(p);
  }

  const secondsAt: number[] = [0];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!;
    secondsAt.push(secondsAt[i - 1]! + (clean[i]!.tick - prev.tick) * secondsPerTick(prev.bpm));
  }
  return { points: clean, secondsAt };
}

function indexAtTick(map: TempoMap, tick: number): number {
  let lo = 0;
  let hi = map.points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (map.points[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The tempo in force at `tick`. */
export function bpmAtTick(map: TempoMap, tick: number): number {
  return map.points[indexAtTick(map, Math.max(0, tick))]!.bpm;
}

/** `seconds(tick) = S_i + (tick - t_i) * spt(b_i)` for the last point `t_i <= tick`. Negative input is 0. */
export function secondsAtTick(map: TempoMap, tick: number): number {
  const t = Math.max(0, tick);
  const i = indexAtTick(map, t);
  const p = map.points[i]!;
  return map.secondsAt[i]! + (t - p.tick) * secondsPerTick(p.bpm);
}

/** Inverse of {@link secondsAtTick}. A float tick: round only where a tick is stored. */
export function tickAtSeconds(map: TempoMap, seconds: number): number {
  const s = Math.max(0, seconds);
  let lo = 0;
  let hi = map.secondsAt.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (map.secondsAt[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  const p = map.points[lo]!;
  return p.tick + (s - map.secondsAt[lo]!) / secondsPerTick(p.bpm);
}

/** How long `durationTicks` lasts when it STARTS at `startTick`: `seconds(start + len) - seconds(start)`. */
export function durationSeconds(map: TempoMap, startTick: number, durationTicks: number): number {
  return secondsAtTick(map, startTick + durationTicks) - secondsAtTick(map, startTick);
}

/** True when the tempo never changes, so callers can take a fast path. */
export function isConstantTempo(map: TempoMap): boolean {
  return map.points.length === 1;
}
