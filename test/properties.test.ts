import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTempoMap, durationSeconds, secondsAtTick, tickAtSeconds, bpmAtTick, buildMeterMap, measureStartTick, buildPerformance, performanceTempo,
  playOrder, performanceSpans, performanceTicksFor, sourceTickAt, scoreToEvents, writtenMeasureCount, validateScore,
  type Score, type RepeatMark, type TempoChange,
} from "../src/index.js";
import { METERS, int, note, rng, score, track } from "./helpers.js";

const RUNS = 300;

function randomTempo(r: () => number): { bpm: number; tempoChanges: TempoChange[] } {
  return {
    bpm: 20 + r() * 280,
    tempoChanges: Array.from({ length: int(r, 0, 12) }, () => ({ tick: int(r, 0, 40000), bpm: r() < 0.5 ? int(r, 20, 300) : 20 + r() * 280 })),
  };
}

describe("tempo properties", () => {
  test("tick(seconds(t)) ~ t over random maps", () => {
    const r = rng(1);
    for (let i = 0; i < RUNS; i++) {
      const map = buildTempoMap(randomTempo(r));
      for (let k = 0; k < 20; k++) {
        const t = r() * 60000;
        assert.ok(Math.abs(tickAtSeconds(map, secondsAtTick(map, t)) - t) < 1e-5, `t=${t}`);
      }
    }
  });
  test("seconds(tick(s)) ~ s", () => {
    const r = rng(2);
    for (let i = 0; i < RUNS; i++) {
      const map = buildTempoMap(randomTempo(r));
      for (let k = 0; k < 20; k++) {
        const s = r() * 400;
        assert.ok(Math.abs(secondsAtTick(map, tickAtSeconds(map, s)) - s) < 1e-9, `s=${s}`);
      }
    }
  });
  test("seconds is strictly increasing in ticks", () => {
    const r = rng(3);
    for (let i = 0; i < RUNS; i++) {
      const map = buildTempoMap(randomTempo(r));
      let prevT = 0;
      let prevS = 0;
      for (let k = 0; k < 30; k++) {
        const t = prevT + int(r, 1, 5000);
        const s = secondsAtTick(map, t);
        assert.ok(s > prevS);
        prevT = t;
        prevS = s;
      }
    }
  });
  test("durations are additive: dur(a, b-a) + dur(b, c-b) = dur(a, c-a)", () => {
    const r = rng(4);
    for (let i = 0; i < RUNS; i++) {
      const map = buildTempoMap(randomTempo(r));
      const a = int(r, 0, 30000);
      const b = a + int(r, 0, 5000);
      const c = b + int(r, 0, 5000);
      assert.ok(Math.abs(durationSeconds(map, a, b - a) + durationSeconds(map, b, c - b) - durationSeconds(map, a, c - a)) < 1e-9);
    }
  });
  test("the input order of changes does not matter (distinct ticks)", () => {
    const r = rng(5);
    for (let i = 0; i < RUNS; i++) {
      const { bpm } = randomTempo(r);
      const ticks = [...new Set(Array.from({ length: 8 }, () => int(r, 0, 9999)))];
      const changes = ticks.map((tick) => ({ tick, bpm: int(r, 20, 300) }));
      const shuffled = [...changes].sort(() => r() - 0.5);
      assert.deepEqual(buildTempoMap({ bpm, tempoChanges: shuffled }), buildTempoMap({ bpm, tempoChanges: changes }));
    }
  });
  test("a change to the tempo already in force is a no-op", () => {
    const r = rng(6);
    for (let i = 0; i < RUNS; i++) {
      const t = randomTempo(r);
      const map = buildTempoMap(t);
      const tick = int(r, 0, 50000);
      const same = buildTempoMap({ ...t, tempoChanges: [...t.tempoChanges, { tick, bpm: bpmAtTick(map, tick) }] });
      // Only a no-op when no existing change sits at that very tick (a same-tick change replaces).
      if (!map.points.some((p) => p.tick === tick) && !t.tempoChanges.some((c) => Math.round(c.tick) === tick)) {
        assert.equal(secondsAtTick(same, 60000), secondsAtTick(map, 60000));
        assert.deepEqual(same.points.map((p) => p.bpm), map.points.map((p) => p.bpm));
      }
    }
  });
  test("one change at tick 0 equals a different opening bpm", () => {
    const r = rng(7);
    for (let i = 0; i < RUNS; i++) {
      const t = randomTempo(r);
      const b = int(r, 20, 300);
      const noZero = t.tempoChanges.filter((c) => c.tick > 0);
      assert.deepEqual(buildTempoMap({ bpm: t.bpm, tempoChanges: [...noZero, { tick: 0, bpm: b }] }), buildTempoMap({ bpm: b, tempoChanges: noZero }));
    }
  });
});

describe("repeat properties", () => {
  function randomRepeats(r: () => number, bars: number): RepeatMark[] {
    // A well-formed section: optional start, closing repeat, optional voltas.
    const marks: RepeatMark[] = [];
    let at = 0;
    while (at < bars && marks.length < 8) {
      const len = int(r, 1, 4);
      const end = Math.min(bars - 1, at + len - 1);
      if (r() < 0.6) {
        if (r() < 0.5) marks.push({ measure: at, start: true });
        marks.push({ measure: end, end: { times: int(r, 2, 4) } });
      }
      at = end + 1;
    }
    return marks;
  }

  test("a repeat of N bars twice doubles the performance length (any meters)", () => {
    const r = rng(11);
    for (let i = 0; i < RUNS; i++) {
      const bars = int(r, 1, 8);
      const meterChanges = Array.from({ length: int(r, 0, 3) }, () => ({ measure: int(r, 0, bars), timeSignature: METERS[int(r, 0, METERS.length - 1)]! }));
      const base = score({ timeSignature: METERS[int(r, 0, METERS.length - 1)]!, meterChanges, measures: bars, tracks: [] });
      const plain = buildPerformance(base);
      const doubled = buildPerformance({ ...base, repeats: [{ measure: bars - 1, end: { times: 2 } }] });
      assert.equal(doubled.spanEndTick, plain.spanEndTick * 2);
      assert.equal(doubled.spans.length, plain.spans.length * 2);
      const a = scoreToEvents({ ...base, bpm: 100 });
      const b = scoreToEvents({ ...base, bpm: 100, repeats: [{ measure: bars - 1, end: { times: 2 } }] });
      assert.ok(Math.abs(b.spanEndSeconds - 2 * a.spanEndSeconds) < 1e-5);
    }
  });

  test("the second pass restates the tempo in force at its source", () => {
    const r = rng(12);
    for (let i = 0; i < RUNS; i++) {
      const bars = 6;
      const s = score({
        measures: bars, bpm: int(r, 40, 200), tracks: [],
        tempoChanges: Array.from({ length: int(r, 0, 4) }, () => ({ tick: int(r, 0, bars * 1920), bpm: int(r, 40, 200) })),
        repeats: randomRepeats(r, bars),
      });
      const perf = buildPerformance(s);
      const written = buildTempoMap(s);
      const unrolled = buildTempoMap(performanceTempo(s, perf));
      for (const span of perf.spans) {
        for (const off of [0, 1, 700, 1919]) {
          const src = span.sourceStartTick + off;
          assert.equal(bpmAtTick(unrolled, span.startTick + off), bpmAtTick(written, src));
        }
      }
    }
  });

  test("unroll then performance: every note sounds once per span covering its start", () => {
    const r = rng(13);
    for (let i = 0; i < RUNS; i++) {
      const bars = int(r, 2, 8);
      const notes = Array.from({ length: int(r, 1, 20) }, (_, k) => note({ id: `n${k}`, startTick: int(r, 0, bars * 1920 - 1), durationTicks: int(r, 1, 2000), pitch: int(r, 21, 108), velocity: r() }));
      const s = score({ measures: bars, repeats: randomRepeats(r, bars), bpm: int(r, 40, 220), tracks: [track({ notes })], meterChanges: [] });
      assert.ok(validateScore(s).ok);
      const meter = buildMeterMap(s);
      const spans = performanceSpans(playOrder(s, writtenMeasureCount(s)), meter);
      const perf = buildPerformance(s);
      const sounded = perf.tracks[0]!.notes;
      assert.equal(sounded.length, notes.reduce((n, x) => n + performanceTicksFor(spans, x.startTick).length, 0));
      for (const n of sounded) {
        assert.equal(sourceTickAt(spans, n.playTick), n.startTick); // playhead maps back to where it is written
        assert.ok(n.playTick >= 0 && n.playTick < perf.spanEndTick);
      }
      for (let k = 1; k < sounded.length; k++) assert.ok(sounded[k - 1]!.playTick <= sounded[k]!.playTick);
      // Events agree with the unrolled tempo map and are deterministic.
      const ev = scoreToEvents(s);
      const again = scoreToEvents(s);
      assert.equal(JSON.stringify(ev.tracks), JSON.stringify(again.tracks));
      const map = buildTempoMap(performanceTempo(s, perf));
      ev.tracks[0]!.events.forEach((e, k) => {
        const n = sounded[k]!;
        assert.ok(Math.abs(e.time - secondsAtTick(map, n.playTick)) < 1e-6);
        // Microsecond rounding is worth at most 1e-6 s = 0.0016 ticks at 300 bpm.
        assert.ok(Math.abs(tickAtSeconds(map, e.time) - n.playTick) < 0.01);
        assert.ok(e.dur > 0 && e.velocity === n.velocity && e.note === n.pitch);
      });
      assert.ok(Number.isFinite(ev.endSeconds));
    }
  });

  test("a linear score never changes the written order", () => {
    const r = rng(14);
    for (let i = 0; i < RUNS; i++) {
      const bars = int(r, 1, 10);
      const meterChanges = Array.from({ length: int(r, 0, 4) }, () => ({ measure: int(r, 0, bars), timeSignature: METERS[int(r, 0, METERS.length - 1)]! }));
      const s: Score = score({ measures: bars, meterChanges, tracks: [track({ notes: [note({ id: "a", startTick: int(r, 0, 1000) })] })] });
      const p = buildPerformance(s);
      assert.ok(p.linear);
      assert.equal(p.tracks[0]!.notes[0]!.playTick, s.tracks[0]!.notes[0]!.startTick);
      assert.equal(p.spanEndTick, measureStartTick(buildMeterMap(s), writtenMeasureCount(s)));
    }
  });
});
