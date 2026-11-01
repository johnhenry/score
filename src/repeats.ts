import { measureStartTick, type MeterMap } from "./meter.js";
import type { RepeatMark, Score } from "./types.js";

/** One measure of the play order. */
export interface PlaySpan {
  /** Measure index in the written score. */
  measure: number;
  /** Which pass through the enclosing repeat this is, 1-based. */
  pass: number;
}

/** One played measure placed on the performance timeline. */
export interface PerformanceSpan extends PlaySpan {
  /** Where the music is written. */
  sourceStartTick: number;
  sourceEndTick: number;
  /** When it is heard. */
  startTick: number;
}

/** What a measure's barlines have to draw. */
export interface MeasureBarlines {
  repeatStart: boolean;
  repeatEnd: boolean;
  volta?: {
    role: "begin" | "beginEnd" | "mid" | "end";
    /** Printed in the bracket; only the opening measure carries it. */
    label: string;
  };
}

/** Guard against malformed marks producing an endless sequence: at most this many measures are played. */
export const MAX_SPANS = 4000;

function marksByMeasure(repeats: readonly RepeatMark[]): Map<number, RepeatMark> {
  const map = new Map<number, RepeatMark>();
  for (const mark of repeats) {
    const existing = map.get(mark.measure);
    // A measure can carry both a volta and a closing repeat: merge, do not overwrite.
    map.set(mark.measure, existing ? { ...existing, ...mark } : mark);
  }
  return map;
}

/**
 * Repeat marks to the flat list of measures actually played.
 *
 * Walk forward. On a closing repeat return to the latest opening repeat (or the
 * start) until the section has played its `times` (the TOTAL plays; `times <= 1`
 * is no repeat). Skip a volta bracket whose `numbers` lack the current pass.
 * Stops at {@link MAX_SPANS}.
 */
export function playOrder(score: Pick<Score, "repeats">, measureCount: number): PlaySpan[] {
  const marks = marksByMeasure(score.repeats ?? []);
  const total = Math.max(0, Math.round(measureCount));
  if (marks.size === 0) {
    return Array.from({ length: total }, (_, measure) => ({ measure, pass: 1 }));
  }

  const out: PlaySpan[] = [];
  const passes = new Map<number, number>();
  let sectionStart = 0;
  let pass = 1;
  let m = 0;

  while (m < total && out.length < MAX_SPANS) {
    const mark = marks.get(m);
    if (mark?.start && m !== sectionStart) {
      sectionStart = m;
      pass = 1;
    }
    if (mark?.ending && !mark.ending.numbers.includes(pass)) {
      m = skipBracket(marks, m, total);
      continue;
    }
    out.push({ measure: m, pass });

    if (mark?.end) {
      const played = (passes.get(m) ?? 0) + 1;
      passes.set(m, played);
      if (played < Math.max(1, mark.end.times)) {
        pass = played + 1;
        m = sectionStart;
        continue;
      }
      pass = 1;
    }
    m++;
  }
  return out;
}

/** First measure after the volta bracket starting at `from`. A bracket that never closes ends at the next one. */
function skipBracket(marks: Map<number, RepeatMark>, from: number, total: number): number {
  for (let m = from; m < total; m++) {
    const mark = marks.get(m);
    if (mark?.ending?.stop) return m + 1;
    if (m > from && mark?.ending) return m;
  }
  return total;
}

/** True when the marks change nothing about the written order. */
export function isLinear(order: readonly PlaySpan[], measureCount: number): boolean {
  return order.length === measureCount && order.every((s, i) => s.measure === i && s.pass === 1);
}

/** Lay the play order end to end, each bar by its OWN length. */
export function performanceSpans(order: readonly PlaySpan[], meter: MeterMap): PerformanceSpan[] {
  let startTick = 0;
  return order.map((span) => {
    const sourceStartTick = measureStartTick(meter, span.measure);
    const sourceEndTick = measureStartTick(meter, span.measure + 1);
    const out = { ...span, sourceStartTick, sourceEndTick, startTick };
    startTick += sourceEndTick - sourceStartTick;
    return out;
  });
}

/**
 * Every performance tick at which a note written at `sourceTick` is heard.
 * Notes are placed by their START: one that rings past a barline keeps its length.
 */
export function performanceTicksFor(spans: readonly PerformanceSpan[], sourceTick: number): number[] {
  const out: number[] = [];
  for (const span of spans) {
    if (sourceTick >= span.sourceStartTick && sourceTick < span.sourceEndTick) {
      out.push(span.startTick + (sourceTick - span.sourceStartTick));
    }
  }
  return out;
}

/** The written position for a performance position (what a playhead needs). Null past the end. */
export function sourceTickAt(spans: readonly PerformanceSpan[], performanceTick: number): number | null {
  if (spans.length === 0) return performanceTick;
  const t = Math.max(0, performanceTick);
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (spans[mid]!.startTick <= t) lo = mid;
    else hi = mid - 1;
  }
  const span = spans[lo]!;
  const into = t - span.startTick;
  if (into >= span.sourceEndTick - span.sourceStartTick && lo === spans.length - 1) return null;
  return span.sourceStartTick + into;
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/** Barline drawing info per measure, derived from the marks so the two can never disagree. */
export function barlinesFor(score: Pick<Score, "repeats">, measureCount: number): MeasureBarlines[] {
  const marks = marksByMeasure(score.repeats ?? []);
  const out: MeasureBarlines[] = [];
  for (let m = 0; m < measureCount; m++) {
    const mark = marks.get(m);
    const line: MeasureBarlines = { repeatStart: mark?.start === true, repeatEnd: mark?.end !== undefined };
    const ending = mark?.ending;
    if (ending) {
      const prev = marks.get(m - 1)?.ending;
      const isFirst = !prev || prev.stop || !sameNumbers(prev.numbers, ending.numbers);
      const isLast = ending.stop;
      line.volta = {
        role: isFirst && isLast ? "beginEnd" : isFirst ? "begin" : isLast ? "end" : "mid",
        label: isFirst ? `${ending.numbers.join(", ")}.` : "",
      };
    }
    out.push(line);
  }
  return out;
}
