import type { ControllerEvent, PitchBendEvent, Track } from "./types.js";

/** The sustain pedal's controller number. */
export const CC_SUSTAIN = 64;
/** A sustain value at or above this is pedal down (the MIDI convention). */
export const SUSTAIN_DOWN = 64;

/**
 * A track's controller lane in order: finite events only, ticks rounded and
 * floored at 0, `cc`/`value` clamped to 0..127, sorted by tick. Entries at one
 * tick and cc keep their input order, so the later one wins when read.
 */
export function controllerLane(track: Pick<Track, "controllers">): ControllerEvent[] {
  return (track.controllers ?? [])
    .filter((e) => Number.isFinite(e.tick) && Number.isFinite(e.cc) && Number.isFinite(e.value))
    .map((e) => ({
      tick: Math.max(0, Math.round(e.tick)),
      cc: Math.max(0, Math.min(127, Math.round(e.cc))),
      value: Math.max(0, Math.min(127, Math.round(e.value))),
    }))
    .sort((a, b) => a.tick - b.tick);
}

/** A track's pitch-bend lane in order: finite events, ticks rounded and floored at 0, value clamped to -1..1, sorted by tick. */
export function pitchBendLane(track: Pick<Track, "pitchBend">): PitchBendEvent[] {
  return (track.pitchBend ?? [])
    .filter((e) => Number.isFinite(e.tick) && Number.isFinite(e.value))
    .map((e) => ({ tick: Math.max(0, Math.round(e.tick)), value: Math.max(-1, Math.min(1, e.value)) }))
    .sort((a, b) => a.tick - b.tick);
}

/** The value of controller `cc` at `tick` (the last event at or before it), or `fallback` (default 0) before the first. */
export function controllerValueAt(lane: readonly ControllerEvent[], cc: number, tick: number, fallback = 0): number {
  let value = fallback;
  for (const e of lane) {
    if (e.tick > tick) break;
    if (e.cc === cc) value = e.value;
  }
  return value;
}

/** The pitch bend at `tick`, 0 (centred) before the first event. */
export function pitchBendAt(lane: readonly PitchBendEvent[], tick: number): number {
  let value = 0;
  for (const e of lane) {
    if (e.tick > tick) break;
    value = e.value;
  }
  return value;
}

/** 14-bit wheel value (0..16383, centre 8192) for a -1..1 bend. */
export function bendToWheel(value: number): number {
  return Math.max(0, Math.min(16383, Math.round(Math.max(-1, Math.min(1, value)) * 8192 + 8192)));
}

/** -1..1 for a 14-bit wheel value (exact for every integer 0..16383). */
export function wheelToBend(wheel: number): number {
  return (Math.max(0, Math.min(16383, Math.round(wheel))) - 8192) / 8192;
}

/** A sounding note in any unit of time: `end = time + dur`. */
export interface SustainableNote {
  note: number;
  time: number;
  dur: number;
}

/**
 * Hold released notes while the sustain pedal is down.
 *
 * `pedal` is the CC 64 lane in the same unit as the notes (seconds), sorted by
 * time. A note whose natural end falls while the pedal is down sounds until the
 * pedal comes up (or `until`, if it never does). A held note is cut by the next
 * onset of the same pitch (a retrigger), and never shortened. Returns copies.
 */
export function applySustain<T extends SustainableNote>(
  notes: readonly T[],
  pedal: readonly { time: number; value: number }[],
  until: number,
): T[] {
  // Down intervals [downAt, upAt).
  const intervals: [number, number][] = [];
  let downAt: number | null = null;
  for (const e of pedal) {
    if (e.value >= SUSTAIN_DOWN) {
      if (downAt === null) downAt = e.time;
    } else if (downAt !== null) {
      intervals.push([downAt, e.time]);
      downAt = null;
    }
  }
  if (downAt !== null) intervals.push([downAt, Math.max(until, downAt)]);
  if (intervals.length === 0) return notes.map((n) => ({ ...n }));

  const onsets = new Map<number, number[]>();
  for (const n of notes) {
    const list = onsets.get(n.note);
    if (list) list.push(n.time);
    else onsets.set(n.note, [n.time]);
  }
  for (const list of onsets.values()) list.sort((a, b) => a - b);

  return notes.map((n) => {
    const end = n.time + n.dur;
    const held = intervals.find(([d, u]) => d <= end && end < u);
    if (!held) return { ...n };
    let release = held[1];
    const retrigger = (onsets.get(n.note) ?? []).find((t) => t > n.time);
    if (retrigger !== undefined && retrigger < release) release = Math.max(end, retrigger);
    return { ...n, dur: Math.max(n.dur, release - n.time) };
  });
}
