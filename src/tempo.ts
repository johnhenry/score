import { MAX_BPM, MIN_BPM, PPQ, type Score, type TempoChange } from "./types.js";

/**
 * Tempo as a function of position, keyed by tick: a step function (each tempo
 * holds until the next change) except where a change has `ramp: "linear"`.
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

/** True when `points[i]` ramps to `points[i + 1]` (normalised maps only keep a ramp that has a different next tempo). */
function ramps(points: readonly TempoChange[], i: number): boolean {
  return points[i]!.ramp === "linear" && i + 1 < points.length;
}

/** The tempo `x` ticks into the ramp from `p` to `q`. */
function rampBpm(p: TempoChange, q: TempoChange, x: number): number {
  return p.bpm + ((q.bpm - p.bpm) * x) / (q.tick - p.tick);
}

/** Seconds the first `x` ticks of the ramp `p -> q` last: `(T / 8 / delta) * ln(bpm(x) / p.bpm)`; a ramp that did not move is a flat step. */
function rampSeconds(p: TempoChange, q: TempoChange, x: number): number {
  const delta = q.bpm - p.bpm;
  const span = q.tick - p.tick;
  return (span / (8 * delta)) * Math.log(rampBpm(p, q, x) / p.bpm);
}

/**
 * Build the map from `score.bpm` (tick 0) and `score.tempoChanges`.
 *
 * Sorted; non-finite entries dropped; ticks rounded and floored at 0; a second
 * change at one tick wins; a change to the tempo already in force is dropped; a
 * change at tick 0 overrides the opening `bpm`.
 *
 * A `ramp: "linear"` change moves the tempo in a straight line to the next
 * change's bpm. A ramp with no next change, or whose next change has the same
 * bpm, is a plain step and the flag is dropped. A change that is the target of
 * a ramp is kept even when its bpm equals an earlier one.
 */
export function buildTempoMap(score: Pick<Score, "bpm" | "tempoChanges">): TempoMap {
  const sorted = (score.tempoChanges ?? [])
    .filter((c) => Number.isFinite(c.tick) && Number.isFinite(c.bpm))
    .map((c): TempoChange => {
      const out: TempoChange = { tick: Math.max(0, Math.round(c.tick)), bpm: clampBpm(c.bpm) };
      if (c.ramp === "linear") out.ramp = "linear";
      return out;
    })
    // Array.prototype.sort is stable, so the later of two equal ticks stays later.
    .sort((a, b) => a.tick - b.tick);

  // Step 1: one point per tick, the later one winning. The opening bpm is a step at 0.
  const points: TempoChange[] = [{ tick: 0, bpm: clampBpm(score.bpm) }];
  for (const change of sorted) {
    const last = points[points.length - 1]!;
    if (last.tick === change.tick) points[points.length - 1] = change;
    else points.push(change);
  }
  // Step 2: drop a ramp with nothing to ramp to, then drop redundant steps
  // (same bpm as the point before, which cannot itself be a live ramp).
  const clean: TempoChange[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    const live = p.ramp === "linear" && next !== undefined && next.bpm !== p.bpm;
    const entry: TempoChange = live ? p : { tick: p.tick, bpm: p.bpm };
    const last = clean[clean.length - 1];
    if (last && last.bpm === entry.bpm && !live) continue;
    clean.push(entry);
  }

  const secondsAt: number[] = [0];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!;
    const here = clean[i]!;
    const seg = prev.ramp === "linear" ? rampSeconds(prev, here, here.tick - prev.tick) : (here.tick - prev.tick) * secondsPerTick(prev.bpm);
    secondsAt.push(secondsAt[i - 1]! + seg);
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

/** The tempo in force at `tick` (inside a ramp, the interpolated tempo). */
export function bpmAtTick(map: TempoMap, tick: number): number {
  const t = Math.max(0, tick);
  const i = indexAtTick(map, t);
  const p = map.points[i]!;
  if (ramps(map.points, i)) return rampBpm(p, map.points[i + 1]!, t - p.tick);
  return p.bpm;
}

/** Seconds elapsed at `tick`: the stored seconds at the last point `t_i <= tick`, plus a step or ramp segment. Negative input is 0. */
export function secondsAtTick(map: TempoMap, tick: number): number {
  const t = Math.max(0, tick);
  const i = indexAtTick(map, t);
  const p = map.points[i]!;
  if (ramps(map.points, i)) return map.secondsAt[i]! + rampSeconds(p, map.points[i + 1]!, t - p.tick);
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
  const local = s - map.secondsAt[lo]!;
  if (ramps(map.points, lo)) {
    const q = map.points[lo + 1]!;
    const span = q.tick - p.tick;
    // bpm(x) = p.bpm * exp(8 * delta * local / span); then x = span * (bpm - p.bpm) / delta.
    const delta = q.bpm - p.bpm;
    const bpm = p.bpm * Math.exp((8 * delta * local) / span);
    return p.tick + (span * (bpm - p.bpm)) / delta;
  }
  return p.tick + local / secondsPerTick(p.bpm);
}

/** How long `durationTicks` lasts when it STARTS at `startTick`: `seconds(start + len) - seconds(start)`. */
export function durationSeconds(map: TempoMap, startTick: number, durationTicks: number): number {
  return secondsAtTick(map, startTick + durationTicks) - secondsAtTick(map, startTick);
}

/** True when the tempo never changes (no steps and no ramps), so callers can take a fast path. */
export function isConstantTempo(map: TempoMap): boolean {
  return map.points.length === 1;
}
