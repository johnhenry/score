import { buildMeterMap, measuresToCover, type MeterMap } from "./meter.js";
import { isLinear, performanceSpans, performanceTicksFor, playOrder, type PerformanceSpan } from "./repeats.js";
import { bpmAtTick, buildTempoMap } from "./tempo.js";
import { scoreEndTick, trackIsAudible } from "./time.js";
import type { Note, Score, TempoChange, Track } from "./types.js";

export interface PerformanceNote extends Note {
  /** Where this occurrence is heard. `startTick` stays the written position. */
  playTick: number;
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
    changes.push({ tick: span.startTick, bpm: bpmAtTick(written, span.sourceStartTick) });
    for (const point of written.points) {
      if (point.tick > span.sourceStartTick && point.tick < span.sourceEndTick) {
        changes.push({ tick: span.startTick + (point.tick - span.sourceStartTick), bpm: point.bpm });
      }
    }
  }
  // buildTempoMap drops the redundant restatements.
  return { bpm: score.bpm, tempoChanges: changes.filter((c) => c.tick > 0) };
}
