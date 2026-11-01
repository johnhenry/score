import { ticksPerMeasure } from "./time.js";
import { PPQ, type MeterChange, type Score } from "./types.js";

export interface MeterSegment {
  /** First measure (0-based) of this meter. */
  measure: number;
  timeSignature: string;
  /** Ticks in one measure of this meter. */
  ticks: number;
  /** Tick this segment's first measure begins at. */
  startTick: number;
}

/**
 * Meter as a function of position, keyed by MEASURE (a meter taking effect
 * mid-bar is not notatable). "Bar N starts at N * ticksPerMeasure" is false once
 * the meter changes; everything that turns a bar into a tick comes through here.
 */
export interface MeterMap {
  /** Sorted by measure, always starting at measure 0. */
  readonly segments: readonly MeterSegment[];
}

function segmentAt(map: MeterMap, measure: number): MeterSegment {
  const m = Math.max(0, measure);
  let lo = 0;
  let hi = map.segments.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (map.segments[mid]!.measure <= m) lo = mid;
    else hi = mid - 1;
  }
  return map.segments[lo]!;
}

/** Sorted, de-duplicated (later change at a measure wins; a change to the meter in force is dropped). */
export function buildMeterMap(score: Pick<Score, "timeSignature" | "meterChanges">): MeterMap {
  const sorted = (score.meterChanges ?? [])
    .filter((c) => Number.isFinite(c.measure) && typeof c.timeSignature === "string")
    .map((c) => ({ measure: Math.max(0, Math.round(c.measure)), timeSignature: c.timeSignature }))
    .sort((a, b) => a.measure - b.measure);

  const chosen: MeterChange[] = [{ measure: 0, timeSignature: score.timeSignature }];
  for (const change of sorted) {
    const last = chosen[chosen.length - 1]!;
    if (last.measure === change.measure) chosen[chosen.length - 1] = change;
    else if (last.timeSignature !== change.timeSignature) chosen.push(change);
  }
  const deduped: MeterChange[] = [];
  for (const c of chosen) {
    const last = deduped[deduped.length - 1];
    if (last && last.timeSignature === c.timeSignature) continue;
    deduped.push(c);
  }

  const segments: MeterSegment[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const c = deduped[i]!;
    const ticks = ticksPerMeasure(c.timeSignature);
    const prev = segments[i - 1];
    const startTick = prev ? prev.startTick + (c.measure - prev.measure) * prev.ticks : 0;
    segments.push({ measure: c.measure, timeSignature: c.timeSignature, ticks, startTick });
  }
  return { segments };
}

/** The time signature in force at `measure`. */
export function meterAt(map: MeterMap, measure: number): string {
  return segmentAt(map, measure).timeSignature;
}

export function ticksInMeasure(map: MeterMap, measure: number): number {
  return segmentAt(map, measure).ticks;
}

/** The tick `measure` begins at. */
export function measureStartTick(map: MeterMap, measure: number): number {
  const m = Math.max(0, Math.round(measure));
  const seg = segmentAt(map, m);
  return seg.startTick + (m - seg.measure) * seg.ticks;
}

/** The bar a tick falls in, and how far into it. */
export function measureAtTick(map: MeterMap, tick: number): { measure: number; offsetTicks: number } {
  const t = Math.max(0, tick);
  let lo = 0;
  let hi = map.segments.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (map.segments[mid]!.startTick <= t) lo = mid;
    else hi = mid - 1;
  }
  const seg = map.segments[lo]!;
  const into = t - seg.startTick;
  return { measure: seg.measure + Math.floor(into / seg.ticks), offsetTicks: into % seg.ticks };
}

/** Ticks spanned by `measureCount` measures from the top. */
export function totalTicks(map: MeterMap, measureCount: number): number {
  return measureStartTick(map, Math.max(0, measureCount));
}

/** Measures needed to cover `tick` (a partial bar counts). */
export function measuresToCover(map: MeterMap, tick: number): number {
  if (tick <= 0) return 0;
  const at = measureAtTick(map, tick);
  return at.offsetTicks > 0 ? at.measure + 1 : at.measure;
}

export function isUniformMeter(map: MeterMap): boolean {
  return map.segments.length === 1;
}

/** Beats in the bar containing `measure` (the numerator). */
export function beatsInMeasure(map: MeterMap, measure: number): number {
  const num = Number(meterAt(map, measure).split("/")[0]);
  return Math.max(1, num || 4);
}

/** 1-based `bar.beat` for a tick; the beat unit is the denominator of the bar's OWN meter. */
export function barBeat(map: MeterMap, tick: number): { bar: number; beat: number } {
  const { measure, offsetTicks } = measureAtTick(map, tick);
  const den = Number(meterAt(map, measure).split("/")[1]) || 4;
  const beatTicks = (PPQ * 4) / den;
  return { bar: measure + 1, beat: Math.floor(offsetTicks / beatTicks) + 1 };
}
