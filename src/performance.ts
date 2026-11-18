import { buildMeterMap, measuresToCover, type MeterMap } from "./meter.js";
import { isLinear, performanceSpans, performanceTicksFor, playOrder, type PerformanceSpan } from "./repeats.js";
import { bpmAtTick, buildTempoMap } from "./tempo.js";
import { scoreEndTick, trackIsAudible } from "./time.js";
import { controllerLane, pitchBendLane } from "./controllers.js";
import type { Note, Score, TempoChange, Track } from "./types.js";

export interface PerformanceNote extends Note {
  /** Where this occurrence is heard. `startTick` stays the written position. */
  playTick: number;
}

export interface PerformanceController {
  playTick: number;
  cc: number;
  value: number;
}

export interface PerformanceBend {
  playTick: number;
  value: number;
}

export interface PerformanceTrack {
  trackId: string;
  instrumentId: string;
  volume?: number;
  pan?: number;
  effects?: Track["effects"];
  sends?: Track["sends"];
  /** Sorted by `playTick`, then pitch. */
  notes: PerformanceNote[];
  /** Controller lane on the performance timeline; absent when the track has none. */
  controllers?: PerformanceController[];
  /** Pitch bend on the performance timeline; absent when the track has none. */
  pitchBend?: PerformanceBend[];
}

/** A score as it is HEARD: repeats taken, notes on a flat timeline. */
export interface Performance {
  tracks: PerformanceTrack[];
  spans: PerformanceSpan[];
  /** Tick the last note stops sounding (what render wants). */
  endTick: number;
  /** Tick the written grid ends, trailing empty bars included (what a transport runs to). */
  spanEndTick: number;
  meter: MeterMap;
  /** False when repeats actually change the order. */
  linear: boolean;
}

/** Measures the written score occupies: the larger of `measures` and what the notes need (at least 1). */
export function writtenMeasureCount(score: Score): number {
  const meter = buildMeterMap(score);
  return Math.max(1, score.measures ?? 0, measuresToCover(meter, scoreEndTick(score)));
}

/**
 * Place a lane's events on the performance timeline. Linear: as written. With
 * repeats: each event once per span covering it, plus, at each span start, the
 * value each controller held just before it (so a jump back resumes the pedal
 * and bend state of the bar being replayed). `key` groups restated controllers.
 */
function unrollLane<E extends { tick: number }, O extends { playTick: number }>(
  lane: readonly E[],
  spans: readonly PerformanceSpan[],
  linear: boolean,
  make: (e: E, playTick: number) => O,
  key: (e: E) => number,
): O[] {
  if (linear) return lane.map((e) => make(e, e.tick));
  const out: O[] = [];
  for (const span of spans) {
    const held = new Map<number, E>();
    for (const e of lane) {
      if (e.tick >= span.sourceStartTick) break;
      held.set(key(e), e);
    }
    for (const e of held.values()) out.push(make(e, span.startTick));
    for (const e of lane) {
      if (e.tick < span.sourceStartTick) continue;
      if (e.tick >= span.sourceEndTick) break;
      out.push(make(e, span.startTick + (e.tick - span.sourceStartTick)));
    }
  }
  return out;
}

/**
 * `score -> performance`. `audibleOnly` drops muted tracks and honours solo
 * (playback, render); leave it off for an export, which keeps muted parts.
 */
export function buildPerformance(score: Score, options: { audibleOnly?: boolean } = {}): Performance {
  const meter = buildMeterMap(score);
  const measureCount = writtenMeasureCount(score);
  const order = playOrder(score, measureCount);
  const spans = performanceSpans(order, meter);
  const linear = isLinear(order, measureCount);

  const tracks: PerformanceTrack[] = [];
  for (const track of score.tracks) {
    if (options.audibleOnly && !trackIsAudible(track, score.tracks)) continue;
    const notes: PerformanceNote[] = [];
    for (const note of track.notes) {
      if (linear) {
        notes.push({ ...note, playTick: note.startTick });
        continue;
      }
      for (const playTick of performanceTicksFor(spans, note.startTick)) notes.push({ ...note, playTick });
    }
    notes.sort((a, b) => a.playTick - b.playTick || a.pitch - b.pitch);
    const out: PerformanceTrack = { trackId: track.id, instrumentId: track.instrumentId, notes };
    const cc = controllerLane(track);
    if (cc.length > 0) out.controllers = unrollLane(cc, spans, linear, (e, playTick) => ({ playTick, cc: e.cc, value: e.value }), (e) => e.cc);
    const bend = pitchBendLane(track);
    if (bend.length > 0) out.pitchBend = unrollLane(bend, spans, linear, (e, playTick) => ({ playTick, value: e.value }), () => 0);
    if (track.volume !== undefined) out.volume = track.volume;
    if (track.pan !== undefined) out.pan = track.pan;
    if (track.effects !== undefined) out.effects = track.effects;
    if (track.sends !== undefined) out.sends = track.sends;
    tracks.push(out);
  }

  let endTick = 0;
  for (const t of tracks) for (const n of t.notes) endTick = Math.max(endTick, n.playTick + n.durationTicks);
  const last = spans[spans.length - 1];
  return {
    tracks,
    spans,
    endTick,
    spanEndTick: last ? last.startTick + (last.sourceEndTick - last.sourceStartTick) : 0,
    meter,
    linear,
  };
}

/**
 * The tempo map re-expressed on the performance timeline. Entering each span
 * restates the tempo in force at its source position, and changes inside it are
 * shifted, so a jump backwards resumes the tempo of the bar being replayed.
 */
export function performanceTempo(
  score: Pick<Score, "bpm" | "tempoChanges">,
  performance: Pick<Performance, "linear" | "spans">,
): { bpm: number; tempoChanges: TempoChange[] } {
  if (performance.linear) return { bpm: score.bpm, tempoChanges: score.tempoChanges ?? [] };
  const written = buildTempoMap(score);
  const changes: TempoChange[] = [];
  for (const span of performance.spans) {
    const length = span.sourceEndTick - span.sourceStartTick;
    // Is a ramp running at the span's start, and does its target lie inside the span?
    const start: TempoChange = { tick: span.startTick, bpm: bpmAtTick(written, span.sourceStartTick) };
    let lastInside: TempoChange | undefined = rampSegmentAt(written.points, span.sourceStartTick);
    if (lastInside) start.ramp = "linear";
    changes.push(start);
    for (const point of written.points) {
      if (point.tick > span.sourceStartTick && point.tick < span.sourceEndTick) {
        const shifted: TempoChange = { tick: span.startTick + (point.tick - span.sourceStartTick), bpm: point.bpm };
        if (point.ramp === "linear") shifted.ramp = "linear";
        changes.push(shifted);
        lastInside = point.ramp === "linear" ? point : undefined;
      }
    }
    // A ramp still running at the span's end is cut there: close it one tick early, at the tempo it had reached,
    // because the next span restates its own tempo at the boundary.
    if (lastInside && lastInside.ramp === "linear") {
      const target = written.points[written.points.indexOf(lastInside) + 1];
      if (target && target.tick >= span.sourceEndTick && length > 1) {
        changes.push({ tick: span.startTick + length - 1, bpm: bpmAtTick(written, span.sourceEndTick - 1) });
      }
    }
  }
  // buildTempoMap drops the redundant restatements.
  return { bpm: score.bpm, tempoChanges: changes };
}

/** The ramping point whose segment covers `tick` (its own tick included), if any. */
function rampSegmentAt(points: readonly TempoChange[], tick: number): TempoChange | undefined {
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    if (p.ramp === "linear" && p.tick <= tick && tick < points[i + 1]!.tick) return p;
  }
  return undefined;
}
