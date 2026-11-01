import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PPQ, buildTempoMap, bpmAtTick, secondsAtTick, tickAtSeconds, durationSeconds, isConstantTempo, clampBpm,
  buildMeterMap, meterAt, ticksInMeasure, measureStartTick, measureAtTick, totalTicks, measuresToCover,
  beatsInMeasure, barBeat, isUniformMeter, ticksPerMeasure, beatsPerMeasure,
  buildKeyMap, fifthsAt, keyChangesAt, isUniformKey,
} from "../src/index.js";
import { METERS, TPM, int, rng } from "./helpers.js";

describe("tempo map", () => {
  test("starts at tick 0 with the score's own bpm", () => {
    const m = buildTempoMap({ bpm: 90 });
    assert.deepEqual(m.points, [{ tick: 0, bpm: 90 }]);
    assert.ok(isConstantTempo(m));
  });
  test("an explicit change at tick 0 overrides the opening bpm", () => {
    assert.deepEqual(buildTempoMap({ bpm: 90, tempoChanges: [{ tick: 0, bpm: 140 }] }).points, [{ tick: 0, bpm: 140 }]);
  });
  test("sorts changes given out of order", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 960, bpm: 60 }, { tick: 480, bpm: 80 }] });
    assert.deepEqual(m.points.map((p) => p.tick), [0, 480, 960]);
  });
  test("drops a change to the tempo already in force", () => {
    assert.equal(buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 100 }] }).points.length, 1);
    assert.equal(buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 80 }, { tick: 960, bpm: 80 }] }).points.length, 2);
  });
  test("keeps the last of two changes at one tick", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 80 }, { tick: 480, bpm: 70 }] });
    assert.deepEqual(m.points[1], { tick: 480, bpm: 70 });
  });
  test("a same-tick replacement that restores the tempo in force leaves no redundant point", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 80 }, { tick: 480, bpm: 100 }] });
    assert.equal(m.points.length, 1);
  });
  test("one change at tick 0 equals a different opening bpm", () => {
    const a = buildTempoMap({ bpm: 120, tempoChanges: [{ tick: 0, bpm: 90 }] });
    const b = buildTempoMap({ bpm: 90 });
    assert.deepEqual(a, b);
  });
  test("ignores malformed entries rather than producing NaN", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: Number.NaN, bpm: 80 }, { tick: 480, bpm: Number.POSITIVE_INFINITY }] });
    assert.equal(m.points.length, 1);
    assert.ok(Number.isFinite(secondsAtTick(m, 5000)));
  });
  test("clamps to 20..300 and keeps fractions", () => {
    assert.equal(clampBpm(5), 20);
    assert.equal(clampBpm(9999), 300);
    assert.equal(clampBpm(120.5), 120.5);
    assert.equal(clampBpm(Number.NaN), 120);
  });
  test("matches tick * 60 / (bpm * 480) at a constant tempo", () => {
    const m = buildTempoMap({ bpm: 120 });
    assert.equal(secondsAtTick(m, PPQ), 0.5);
    assert.equal(secondsAtTick(m, TPM), 2);
  });
  test("uses the new tempo after a change and interpolates inside a segment", () => {
    const m = buildTempoMap({ bpm: 120, tempoChanges: [{ tick: TPM, bpm: 60 }] });
    assert.equal(secondsAtTick(m, TPM), 2);
    assert.equal(secondsAtTick(m, TPM + PPQ), 3); // one quarter at 60bpm = 1s
    assert.equal(secondsAtTick(m, TPM / 2), 1);
    assert.equal(bpmAtTick(m, TPM - 1), 120);
    assert.equal(bpmAtTick(m, TPM), 60);
  });
  test("a duration depends on where it starts", () => {
    const m = buildTempoMap({ bpm: 120, tempoChanges: [{ tick: TPM, bpm: 60 }] });
    assert.equal(durationSeconds(m, 0, PPQ), 0.5);
    assert.equal(durationSeconds(m, TPM, PPQ), 1);
    assert.equal(durationSeconds(m, TPM - PPQ, 2 * PPQ), 0.5 + 1); // straddles the change
  });
  test("treats negative input as the start", () => {
    const m = buildTempoMap({ bpm: 120 });
    assert.equal(secondsAtTick(m, -50), 0);
    assert.equal(tickAtSeconds(m, -1), 0);
    assert.equal(bpmAtTick(m, -1), 120);
  });
  test("round-trips tick -> seconds -> tick across many changes", () => {
    const changes = Array.from({ length: 40 }, (_, i) => ({ tick: (i + 1) * 300, bpm: 40 + ((i * 37) % 200) }));
    const m = buildTempoMap({ bpm: 100, tempoChanges: changes });
    for (let t = 0; t < 14000; t += 77) assert.ok(Math.abs(tickAtSeconds(m, secondsAtTick(m, t)) - t) < 1e-6);
  });
  test("seconds are monotonic", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 100, bpm: 300 }, { tick: 200, bpm: 20 }] });
    let prev = -1;
    for (let t = 0; t < 1000; t++) {
      const s = secondsAtTick(m, t);
      assert.ok(s > prev);
      prev = s;
    }
  });
});

describe("meter map", () => {
  test("ticks per measure for common and compound meters", () => {
    assert.equal(ticksPerMeasure("4/4"), 1920);
    assert.equal(ticksPerMeasure("3/4"), 1440);
    assert.equal(ticksPerMeasure("6/8"), 1440);
    assert.equal(ticksPerMeasure("12/8"), 2880);
    assert.equal(ticksPerMeasure("2/2"), 1920);
    assert.equal(ticksPerMeasure("5/16"), 600);
    assert.equal(beatsPerMeasure("6/8"), 3);
  });
  test("starts at measure 0 with the score's own meter", () => {
    const m = buildMeterMap({ timeSignature: "3/4" });
    assert.equal(m.segments.length, 1);
    assert.ok(isUniformMeter(m));
    assert.equal(meterAt(m, 99), "3/4");
  });
  test("a change at measure 0 overrides; a change to the meter in force is dropped", () => {
    assert.equal(meterAt(buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 0, timeSignature: "3/4" }] }), 0), "3/4");
    assert.equal(buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 3, timeSignature: "4/4" }] }).segments.length, 1);
  });
  test("sorts, and the last change at one measure wins", () => {
    const m = buildMeterMap({
      timeSignature: "4/4",
      meterChanges: [{ measure: 4, timeSignature: "6/8" }, { measure: 2, timeSignature: "3/4" }, { measure: 2, timeSignature: "2/4" }],
    });
    assert.deepEqual(m.segments.map((s) => [s.measure, s.timeSignature]), [[0, "4/4"], [2, "2/4"], [4, "6/8"]]);
  });
  test("bars are laid end to end by their own length across a change", () => {
    const m = buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 2, timeSignature: "3/4" }, { measure: 4, timeSignature: "6/8" }] });
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => measureStartTick(m, i)), [0, 1920, 3840, 5280, 6720, 8160]);
    assert.equal(ticksInMeasure(m, 3), 1440);
    assert.equal(totalTicks(m, 6), 9600);
  });
  test("maps a tick back to its bar and offset", () => {
    const m = buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 2, timeSignature: "3/4" }] });
    assert.deepEqual(measureAtTick(m, 3840 + 1440 + 100), { measure: 3, offsetTicks: 100 });
    assert.deepEqual(measureAtTick(m, 0), { measure: 0, offsetTicks: 0 });
  });
  test("counts the measures needed to cover a tick", () => {
    const m = buildMeterMap({ timeSignature: "4/4" });
    assert.equal(measuresToCover(m, 0), 0);
    assert.equal(measuresToCover(m, 1920), 1);
    assert.equal(measuresToCover(m, 1921), 2);
  });
  test("beats readout uses the bar's own meter", () => {
    const m = buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 1, timeSignature: "6/8" }] });
    assert.equal(beatsInMeasure(m, 0), 4);
    assert.equal(beatsInMeasure(m, 1), 6);
    assert.deepEqual(barBeat(m, 1920 + 240 * 2), { bar: 2, beat: 3 }); // eighth-note beats in 6/8
    assert.deepEqual(barBeat(m, 480), { bar: 1, beat: 2 });
  });
  test("negative positions are the start", () => {
    const m = buildMeterMap({ timeSignature: "4/4" });
    assert.deepEqual(measureAtTick(m, -10), { measure: 0, offsetTicks: 0 });
    assert.equal(measureStartTick(m, -3), 0);
  });
  test("measureStartTick, measureAtTick and ticksInMeasure agree for any mixture of meters", () => {
    const r = rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const changes = Array.from({ length: int(r, 0, 8) }, () => ({ measure: int(r, 0, 30), timeSignature: METERS[int(r, 0, METERS.length - 1)]! }));
      const m = buildMeterMap({ timeSignature: METERS[int(r, 0, METERS.length - 1)]!, meterChanges: changes });
      let prev = -1;
      for (let bar = 0; bar < 40; bar++) {
        const start = measureStartTick(m, bar);
        assert.ok(start > prev);
        prev = start;
        assert.equal(measureStartTick(m, bar + 1) - start, ticksInMeasure(m, bar));
        assert.deepEqual(measureAtTick(m, start), { measure: bar, offsetTicks: 0 });
        const last = start + ticksInMeasure(m, bar) - 1;
        assert.deepEqual(measureAtTick(m, last), { measure: bar, offsetTicks: ticksInMeasure(m, bar) - 1 });
      }
    }
  });
});

describe("key map", () => {
  test("starts with the score's key; absent means C major", () => {
    assert.deepEqual(buildKeyMap({ keySignature: 2 }).points, [{ measure: 0, fifths: 2 }]);
    assert.equal(fifthsAt(buildKeyMap({}), 5), 0);
    assert.ok(isUniformKey(buildKeyMap({})));
  });
  test("holds a key until the next change and drops a redundant one", () => {
    const m = buildKeyMap({ keySignature: 0, keyChanges: [{ measure: 2, fifths: 3 }, { measure: 4, fifths: 3 }, { measure: 6, fifths: -1 }] });
    assert.equal(m.points.length, 3);
    assert.deepEqual([0, 1, 2, 5, 6, 9].map((i) => fifthsAt(m, i)), [0, 0, 3, 3, -1, -1]);
  });
  test("a change at measure 0 overrides the opening key", () => {
    assert.equal(fifthsAt(buildKeyMap({ keySignature: 1, keyChanges: [{ measure: 0, fifths: -2 }] }), 0), -2);
  });
  test("sorts and clamps", () => {
    const m = buildKeyMap({ keyChanges: [{ measure: 3, fifths: 40 }, { measure: 1, fifths: -40 }] });
    assert.deepEqual(m.points.map((p) => p.fifths), [0, -7, 7]);
  });
  test("ignores malformed entries", () => {
    assert.equal(buildKeyMap({ keyChanges: [{ measure: Number.NaN, fifths: 1 }, { measure: 1, fifths: Number.NaN }] }).points.length, 1);
  });
  test("knows where a new signature must be drawn", () => {
    const m = buildKeyMap({ keyChanges: [{ measure: 0, fifths: 1 }, { measure: 4, fifths: 2 }] });
    assert.equal(keyChangesAt(m, 0), false);
    assert.equal(keyChangesAt(m, 4), true);
    assert.equal(keyChangesAt(m, 5), false);
  });
});
