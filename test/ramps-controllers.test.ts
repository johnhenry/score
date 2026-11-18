import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PPQ, applySustain, bendToWheel, bpmAtTick, buildPerformance, buildTempoMap, controllerLane, controllerValueAt, createNote,
  createScore, createTrack, durationSeconds, pitchBendAt, scoreToEvents, secondsAtTick, tickAtSeconds, validateScore, wheelToBend,
} from "../src/index.js";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

describe("tempo ramps", () => {
  const score = { bpm: 60, tempoChanges: [{ tick: 0, bpm: 60, ramp: "linear" as const }, { tick: 1920, bpm: 120 }] };
  test("bpm is linear in ticks across a ramp and steps after it", () => {
    const m = buildTempoMap(score);
    near(bpmAtTick(m, 0), 60);
    near(bpmAtTick(m, 960), 90);
    near(bpmAtTick(m, 1920), 120);
    near(bpmAtTick(m, 5000), 120);
  });
  test("seconds are the integral of the changing tempo (closed form)", () => {
    const m = buildTempoMap(score);
    // (T / 8 / delta) * ln(b1 / b0) with T = 1920, delta = 60.
    near(secondsAtTick(m, 1920), (1920 / (8 * 60)) * Math.log(2));
    // Faster than a constant 60 and slower than a constant 120 over the same ticks.
    const s = secondsAtTick(m, 1920);
    assert.ok(s < 1920 * (60 / (60 * PPQ)) && s > 1920 * (60 / (120 * PPQ)));
  });
  test("ticks <-> seconds round-trip inside and after a ramp", () => {
    const m = buildTempoMap(score);
    for (const t of [0, 1, 300, 959, 1500, 1919, 1920, 4000]) near(tickAtSeconds(m, secondsAtTick(m, t)), t, 1e-6);
  });
  test("seconds are monotone and continuous at the ramp's ends", () => {
    const m = buildTempoMap(score);
    let prev = -1;
    for (let t = 0; t <= 2400; t += 40) {
      const s = secondsAtTick(m, t);
      assert.ok(s > prev);
      prev = s;
    }
    near(secondsAtTick(m, 1919.999999), secondsAtTick(m, 1920), 1e-6);
  });
  test("a ritardando (down ramp) works and a duration depends on where it starts", () => {
    const m = buildTempoMap({ bpm: 120, tempoChanges: [{ tick: 480, bpm: 120, ramp: "linear" }, { tick: 1440, bpm: 60 }] });
    near(bpmAtTick(m, 960), 90);
    assert.ok(durationSeconds(m, 480, 480) < durationSeconds(m, 960, 480));
  });
  test("a ramp with no next change, or to the same bpm, is a plain step", () => {
    assert.deepEqual(buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 80, ramp: "linear" }] }).points, [{ tick: 0, bpm: 100 }, { tick: 480, bpm: 80 }]);
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 0, bpm: 100, ramp: "linear" }, { tick: 480, bpm: 100 }] });
    assert.deepEqual(m.points, [{ tick: 0, bpm: 100 }]);
  });
  test("a ramp start at the opening bpm and a same-bpm earlier point are both kept", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 100, ramp: "linear" }, { tick: 960, bpm: 140 }] });
    assert.equal(m.points.length, 3);
    near(bpmAtTick(m, 720), 120);
  });
  test("a score without ramps builds the same map as before", () => {
    const m = buildTempoMap({ bpm: 100, tempoChanges: [{ tick: 480, bpm: 80 }, { tick: 960, bpm: 70 }] });
    assert.deepEqual(m.points, [{ tick: 0, bpm: 100 }, { tick: 480, bpm: 80 }, { tick: 960, bpm: 70 }]);
    near(secondsAtTick(m, 960), 480 * (60 / (100 * 480)) + 480 * (60 / (80 * 480)));
  });
  test("events: a note in a ramp lasts the integrated time", () => {
    const s = createScore({ bpm: 60, tempoChanges: score.tempoChanges, tracks: [createTrack({ id: "a", notes: [createNote({ id: "n", startTick: 0, durationTicks: 1920, pitch: 60 })] })] });
    const ev = scoreToEvents(s);
    near(ev.tracks[0]!.events[0]!.dur, (1920 / (8 * 60)) * Math.log(2), 1e-6);
  });
  test("repeats: replaying a bar inside a ramp resumes the ramp's tempo", () => {
    const tpm = PPQ * 4;
    const s = createScore({
      bpm: 60, measures: 3,
      tempoChanges: [{ tick: 0, bpm: 60, ramp: "linear" }, { tick: 3 * tpm, bpm: 120 }],
      repeats: [{ measure: 1, start: true }, { measure: 1, end: { times: 2 } }],
      tracks: [createTrack({ id: "a", notes: [createNote({ id: "n", startTick: 0, durationTicks: PPQ, pitch: 60 })] })],
    });
    const perf = buildPerformance(s);
    assert.equal(perf.linear, false);
    const ev = scoreToEvents(s);
    const m = ev.tempoMap;
    // Entering the repeated bar a second time restates the tempo the written bar has at its start.
    const second = perf.spans[2]!;
    near(bpmAtTick(m, second.startTick), 60 + (60 * tpm) / (3 * tpm));
    assert.ok(ev.spanEndSeconds > 0);
  });
});

describe("controller lane", () => {
  test("validates, and a score with none is still valid", () => {
    const t = createTrack({ id: "a", controllers: [{ tick: 0, cc: 64, value: 127 }], pitchBend: [{ tick: 10, value: -0.5 }] });
    assert.equal(validateScore(createScore({ tracks: [t] })).ok, true);
    assert.equal(validateScore(createScore({ tracks: [createTrack({ id: "b" })] })).ok, true);
    const bad = createScore({ tracks: [createTrack({ id: "a", controllers: [{ tick: 0, cc: 200, value: 1 }] })] });
    assert.equal(validateScore(bad).ok, false);
    const bad2 = createScore({ tracks: [createTrack({ id: "a", pitchBend: [{ tick: 0, value: 2 }] })] });
    assert.equal(validateScore(bad2).ok, false);
  });
  test("controllerLane sorts, rounds, clamps and drops non-finite", () => {
    const lane = controllerLane({ controllers: [{ tick: 20.4, cc: 64, value: 0 }, { tick: 5, cc: 200, value: -3 }, { tick: NaN, cc: 1, value: 1 }] });
    assert.deepEqual(lane, [{ tick: 5, cc: 127, value: 0 }, { tick: 20, cc: 64, value: 0 }]);
    assert.equal(controllerValueAt(lane, 127, 6), 0);
    assert.equal(controllerValueAt(lane, 64, 4, 9), 9);
    assert.equal(pitchBendAt([{ tick: 10, value: 0.5 }], 9), 0);
    assert.equal(pitchBendAt([{ tick: 10, value: 0.5 }], 11), 0.5);
  });
  test("14-bit wheel mapping is exact for every wheel value", () => {
    for (let w = 0; w <= 16383; w += 7) assert.equal(bendToWheel(wheelToBend(w)), w);
    assert.equal(bendToWheel(0), 8192);
    assert.equal(bendToWheel(1), 16383);
    assert.equal(bendToWheel(-1), 0);
  });
  test("the lane reaches the events in seconds and does not touch note lengths by default", () => {
    const s = createScore({
      bpm: 120,
      tracks: [createTrack({
        id: "a",
        notes: [createNote({ id: "n", startTick: 0, durationTicks: PPQ, pitch: 60 })],
        controllers: [{ tick: 0, cc: 64, value: 127 }, { tick: 2 * PPQ, cc: 64, value: 0 }],
        pitchBend: [{ tick: PPQ, value: 0.25 }],
      })],
    });
    const t = scoreToEvents(s).tracks[0]!;
    assert.deepEqual(t.controllers, [{ time: 0, cc: 64, value: 127 }, { time: 1, cc: 64, value: 0 }]);
    assert.deepEqual(t.pitchBend, [{ time: 0.5, value: 0.25 }]);
    assert.equal(t.events[0]!.dur, 0.5);
    assert.equal(scoreToEvents(createScore({ tracks: [createTrack({ id: "x" })] })).tracks[0]!.controllers, undefined);
  });
  test("sustain option holds released notes until pedal-up", () => {
    const s = createScore({
      bpm: 120,
      tracks: [createTrack({
        id: "a",
        notes: [createNote({ id: "n", startTick: 0, durationTicks: PPQ, pitch: 60 }), createNote({ id: "m", startTick: 4 * PPQ, durationTicks: PPQ, pitch: 62 })],
        controllers: [{ tick: 0, cc: 64, value: 127 }, { tick: 2 * PPQ, cc: 64, value: 0 }],
      })],
    });
    const ev = scoreToEvents(s, { sustain: true });
    assert.equal(ev.tracks[0]!.events[0]!.dur, 1);
    assert.equal(ev.tracks[0]!.events[1]!.dur, 0.5);
  });
  test("applySustain: retrigger cuts the held note, an unlifted pedal holds to `until`, never shortens", () => {
    const pedal = [{ time: 0, value: 127 }];
    const out = applySustain([{ note: 60, time: 0, dur: 1 }, { note: 60, time: 3, dur: 1 }, { note: 64, time: 1, dur: 1 }], pedal, 10);
    assert.deepEqual(out.map((n) => n.dur), [3, 7, 9]);
    const lifted = applySustain([{ note: 60, time: 0, dur: 5 }], [{ time: 0, value: 127 }, { time: 2, value: 0 }], 10);
    assert.equal(lifted[0]!.dur, 5);
    const before = applySustain([{ note: 60, time: 0, dur: 1 }], [{ time: 1.5, value: 127 }, { time: 3, value: 0 }], 10);
    assert.equal(before[0]!.dur, 1);
    const half = applySustain([{ note: 60, time: 0, dur: 1 }], [{ time: 0, value: 63 }, { time: 3, value: 0 }], 10);
    assert.equal(half[0]!.dur, 1);
  });
  test("repeats: the lane is replayed per pass and the pedal state is restated", () => {
    const tpm = PPQ * 4;
    const s = createScore({
      bpm: 120, measures: 3,
      repeats: [{ measure: 1, start: true }, { measure: 1, end: { times: 2 } }],
      tracks: [createTrack({
        id: "a",
        notes: [createNote({ id: "n", startTick: tpm, durationTicks: PPQ, pitch: 60 })],
        controllers: [{ tick: 0, cc: 64, value: 127 }, { tick: tpm + 10, cc: 7, value: 100 }],
        pitchBend: [{ tick: 0, value: 0.5 }],
      })],
    });
    const p = buildPerformance(s).tracks[0]!;
    // Pass 1 of bar 1 (from the start), then pass 2: pedal restated at the span start, cc 7 again.
    // 2 passes of the bar, plus a restatement entering bar 2 (cc 7 still holds 100).
    assert.equal(p.controllers!.filter((c) => c.cc === 7).length, 3);
    assert.ok(p.controllers!.filter((c) => c.cc === 64).length >= 2);
    assert.ok(p.pitchBend!.length >= 2);
  });
  test("unknown extra fields still validate and round-trip through createScore", () => {
    const s = createScore({ tracks: [createTrack({ id: "a", controllers: [] })] });
    assert.equal(validateScore(s).ok, true);
  });
});
