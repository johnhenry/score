import { buildPerformance, performanceTempo, type Performance } from "./performance.js";
import { bpmAtTick, buildTempoMap, durationSeconds, secondsAtTick, secondsPerTick, type TempoMap } from "./tempo.js";
import type { Score } from "./types.js";

/** One sounding note, in seconds: the shape viaframe's audio side consumes. */
export interface NoteEvent {
  /** MIDI note number. */
  note: number;
  velocity: number;
  /** Seconds from the start, rounded to the microsecond. */
  time: number;
  /** Seconds, rounded to the microsecond; at least one tick long. */
  dur: number;
}

export interface TrackEvents {
  trackId: string;
  instrumentId: string;
  volume?: number;
  pan?: number;
  events: NoteEvent[];
}

export interface ScoreEvents {
  tracks: TrackEvents[];
  /** Seconds at which the last note stops. */
  endSeconds: number;
  /** Seconds at which the written grid (repeats taken) ends. */
  spanEndSeconds: number;
  /** The tempo map on the performance timeline, for ticks <-> seconds on the playhead. */
  tempoMap: TempoMap;
  performance: Performance;
}

export interface ScoreEventsOptions {
  /** Drop muted tracks and honour solo. Default true; an export wants false. */
  audibleOnly?: boolean;
}

/** Round to the microsecond so equal scores give equal JSON. */
export function roundSeconds(s: number): number {
  return Math.round(s * 1e6) / 1e6;
}

/**
 * `score -> performance -> note events`.
 *
 * 1. repeats are unrolled to spans; each note is emitted once per span covering its start;
 * 2. tempo changes are re-placed on the unrolled timeline and the tempo map is built from that;
 * 3. `playTick` and `durationTicks` become seconds through that map, so a
 *    duration depends on where it starts.
 */
export function scoreToEvents(score: Score, options: ScoreEventsOptions = {}): ScoreEvents {
  const performance = buildPerformance(score, { audibleOnly: options.audibleOnly ?? true });
  const tempoMap = buildTempoMap(performanceTempo(score, performance));

  const tracks: TrackEvents[] = performance.tracks.map((t) => {
    const out: TrackEvents = {
      trackId: t.trackId,
      instrumentId: t.instrumentId,
      events: t.notes.map((n) => {
        const dur = Math.max(
          durationSeconds(tempoMap, n.playTick, n.durationTicks),
          // A zero-length note makes no sound: floor at one tick at the start's tempo.
          secondsPerTick(bpmAtTick(tempoMap, n.playTick)),
        );
        return { note: n.pitch, velocity: n.velocity, time: roundSeconds(secondsAtTick(tempoMap, n.playTick)), dur: roundSeconds(dur) };
      }),
    };
    if (t.volume !== undefined) out.volume = t.volume;
    if (t.pan !== undefined) out.pan = t.pan;
    return out;
  });

  return {
    tracks,
    endSeconds: roundSeconds(secondsAtTick(tempoMap, performance.endTick)),
    spanEndSeconds: roundSeconds(secondsAtTick(tempoMap, performance.spanEndTick)),
    tempoMap,
    performance,
  };
}

/** The flat list for one pass over all audible tracks, sorted by time. */
export function scoreToNoteEvents(score: Score, options: ScoreEventsOptions = {}): NoteEvent[] {
  return scoreToEvents(score, options)
    .tracks.flatMap((t) => t.events)
    .sort((a, b) => a.time - b.time || a.note - b.note);
}
