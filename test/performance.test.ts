import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PPQ, buildPerformance, performanceTempo, writtenMeasureCount, buildTempoMap, bpmAtTick, trackIsAudible, scoreEndTick,
  scoreToEvents, scoreToNoteEvents, createScore, createTrack, createNote, type Score,
} from "../src/index.js";
import { TPM, note, score, track } from "./helpers.js";

const REPEAT = [{ measure: 1, end: { times: 2 } }];

describe("buildPerformance", () => {
  test("is the written score when nothing repeats", () => {
    const p = buildPerformance(score());
    assert.equal(p.linear, true);
    assert.deepEqual(p.tracks[0]!.notes.map((n) => n.playTick), [0, TPM]);
  });
  test("sounds a repeated section's notes once per pass", () => {
    const p = buildPerformance(score({ repeats: REPEAT }));
    assert.equal(p.linear, false);
    assert.deepEqual(p.tracks[0]!.notes.map((n) => n.playTick), [0, TPM, TPM * 2, TPM * 3]);
  });
  test("keeps the written position on each occurrence", () => {
    const p = buildPerformance(score({ repeats: REPEAT }));
    assert.deepEqual(p.tracks[0]!.notes.filter((n) => n.startTick === 0).map((n) => n.playTick), [0, TPM * 2]);
  });
  test("ends where the last note stops; the span end is the written grid", () => {
    const p = buildPerformance(score());
    assert.equal(p.endTick, TPM + PPQ);
    assert.equal(p.spanEndTick, TPM * 3);
  });
  test("extends both when a section repeats", () => {
    const p = buildPerformance(score({ repeats: REPEAT }));
    assert.equal(p.endTick, TPM * 3 + PPQ);
    assert.equal(p.spanEndTick, TPM * 5);
  });
  test("drops muted tracks only when asked", () => {
    const s = score({ tracks: [track({ muted: true })] });
    assert.equal(buildPerformance(s).tracks.length, 1);
    assert.equal(buildPerformance(s, { audibleOnly: true }).tracks.length, 0);
  });
  test("counts measures from the notes when the score understates them", () => {
    const long = track({ notes: [note({ id: "x", startTick: TPM * 9 })] });
    assert.equal(writtenMeasureCount(score({ tracks: [long], measures: 2 })), 10);
    assert.equal(writtenMeasureCount(score({ tracks: [], measures: undefined })), 1);
  });
  test("carries per-track mix fields through", () => {
    const p = buildPerformance(score({ tracks: [track({ volume: 0.5, pan: -1, sends: [{ bus: "a" }] })] }));
    assert.equal(p.tracks[0]!.volume, 0.5);
    assert.equal(p.tracks[0]!.pan, -1);
    assert.deepEqual(p.tracks[0]!.sends, [{ bus: "a" }]);
  });
  test("does not mutate the score", () => {
    const s = score({ repeats: REPEAT });
    const before = JSON.stringify(s);
    buildPerformance(s);
    scoreToEvents(s);
    assert.equal(JSON.stringify(s), before);
  });
  test("scoreEndTick", () => {
    assert.equal(scoreEndTick(score()), TPM + PPQ);
    assert.equal(scoreEndTick({ tracks: [] }), 0);
  });
});

describe("performanceTempo", () => {
  test("passes a linear score's tempo through", () => {
    const s = score({ tempoChanges: [{ tick: TPM, bpm: 60 }] });
    const t = performanceTempo(s, buildPerformance(s));
    assert.equal(t.bpm, 120);
    assert.deepEqual(t.tempoChanges, [{ tick: TPM, bpm: 60 }]);
  });
  test("re-places a tempo change inside a repeat so it recurs on every pass", () => {
    const s = score({ repeats: REPEAT, tempoChanges: [{ tick: TPM, bpm: 60 }] });
    const map = buildTempoMap(performanceTempo(s, buildPerformance(s)));
    assert.deepEqual([0, TPM, TPM * 2, TPM * 3].map((t) => bpmAtTick(map, t)), [120, 60, 120, 60]);
  });
  test("a constant-tempo repeat yields a single point", () => {
    const s = score({ repeats: REPEAT });
    assert.equal(buildTempoMap(performanceTempo(s, buildPerformance(s))).points.length, 1);
  });
  test("the second pass restates the tempo in force at its source", () => {
    // Tempo drops at bar 1; repeat only bar 1 (start at 1). Pass 2 must stay at 60.
    const s = score({ repeats: [{ measure: 1, start: true }, { measure: 1, end: { times: 2 } }], tempoChanges: [{ tick: TPM, bpm: 60 }] });
    const map = buildTempoMap(performanceTempo(s, buildPerformance(s)));
    assert.deepEqual([0, TPM, TPM * 2].map((t) => bpmAtTick(map, t)), [120, 60, 60]);
  });
});

describe("mute and solo", () => {
  const band = (flags: Array<{ muted?: boolean; soloed?: boolean }>): Score =>
    score({ tracks: flags.map((f, i) => track({ id: `t${i}`, muted: f.muted ?? false, soloed: f.soloed ?? false, notes: [note({ id: `n${i}`, pitch: 60 + i })] })) });
  const heard = (s: Score) => buildPerformance(s, { audibleOnly: true }).tracks.map((t) => t.trackId);

  test("plays everything when nothing is muted or soloed", () => assert.deepEqual(heard(band([{}, {}, {}])), ["t0", "t1", "t2"]));
  test("drops every muted part", () => assert.deepEqual(heard(band([{ muted: true }, {}, { muted: true }])), ["t1"]));
  test("plays nothing when everything is muted", () => assert.deepEqual(heard(band([{ muted: true }, { muted: true }])), []));
  test("plays only the soloed part(s)", () => {
    assert.deepEqual(heard(band([{}, { soloed: true }, {}])), ["t1"]);
    assert.deepEqual(heard(band([{ soloed: true }, {}, { soloed: true }])), ["t0", "t2"]);
  });
  test("mute wins over solo on the same part", () => assert.deepEqual(heard(band([{ soloed: true, muted: true }, {}])), []));
  test("an export keeps muted parts", () => {
    assert.deepEqual(buildPerformance(band([{ muted: true }, { soloed: true }])).tracks.map((t) => t.trackId), ["t0", "t1"]);
  });
  test("a soloed empty part silences the song", () => {
    const s = score({ tracks: [track({ id: "a" }), track({ id: "b", soloed: true, notes: [] })] });
    assert.deepEqual(heard(s), ["b"]);
    assert.equal(buildPerformance(s, { audibleOnly: true }).endTick, 0);
  });
  test("trackIsAudible treats absent flags as false", () => {
    assert.equal(trackIsAudible({}, [{}]), true);
  });
});

describe("scoreToEvents (the viaframe adapter)", () => {
  test("constant tempo: time and dur are tick * 60 / (bpm * 480)", () => {
    const ev = scoreToNoteEvents(score());
    assert.deepEqual(ev, [
      { note: 60, velocity: 0.7, time: 0, dur: 0.5 },
      { note: 64, velocity: 0.7, time: 2, dur: 0.5 },
    ]);
  });
  test("a duration is measured where the note sits, not at the opening tempo", () => {
    const s = score({ tempoChanges: [{ tick: TPM, bpm: 60 }] });
    const ev = scoreToNoteEvents(s);
    assert.equal(ev[1]!.time, 2);
    assert.equal(ev[1]!.dur, 1);
  });
  test("a repeat emits one event per occurrence, and tempo is re-placed", () => {
    const s = score({ repeats: REPEAT, tempoChanges: [{ tick: TPM, bpm: 60 }] });
    const ev = scoreToNoteEvents(s);
    // bar0@120 (2s) bar1@60 (4s), twice: pass 2 starts at 6s.
    assert.deepEqual(ev.map((e) => e.time), [0, 2, 6, 8]);
    assert.deepEqual(ev.map((e) => e.dur), [0.5, 1, 0.5, 1]);
  });
  test("a repeat of N bars twice doubles the length", () => {
    const plain = scoreToEvents(score({ measures: 2, tracks: [] }));
    const doubled = scoreToEvents(score({ measures: 2, tracks: [], repeats: [{ measure: 1, end: { times: 2 } }] }));
    assert.equal(doubled.spanEndSeconds, plain.spanEndSeconds * 2);
  });
  test("muted tracks drop and solo is honoured, unless audibleOnly is false", () => {
    const s = score({ tracks: [track({ id: "a" }), track({ id: "b", muted: true })] });
    assert.deepEqual(scoreToEvents(s).tracks.map((t) => t.trackId), ["a"]);
    assert.deepEqual(scoreToEvents(s, { audibleOnly: false }).tracks.map((t) => t.trackId), ["a", "b"]);
  });
  test("rounds to the microsecond so equal scores give equal JSON", () => {
    const s = score({ bpm: 97, tracks: [track({ notes: [note({ id: "a", startTick: 1, durationTicks: 7 })] })] });
    const e = scoreToNoteEvents(s)[0]!;
    assert.equal(e.time, Math.round(e.time * 1e6) / 1e6);
    assert.equal(e.dur, Math.round(e.dur * 1e6) / 1e6);
    assert.ok(e.dur > 0);
  });
  test("endSeconds follows the last note, spanEndSeconds the grid", () => {
    const r = scoreToEvents(score());
    assert.equal(r.endSeconds, 2.5);
    assert.equal(r.spanEndSeconds, 6);
  });
  test("an empty score is fine", () => {
    const r = scoreToEvents(createScore());
    assert.deepEqual(r.tracks, []);
    assert.equal(r.endSeconds, 0);
    assert.equal(r.spanEndSeconds, 8);
  });
  test("a note written past the last measure still sounds because the grid grows", () => {
    const s = score({ measures: 1, tracks: [track({ notes: [note({ id: "z", startTick: TPM * 5 })] })] });
    assert.equal(scoreToNoteEvents(s).length, 1);
  });
});

describe("create helpers", () => {
  test("createScore, createTrack and createNote give a playable score", () => {
    const s = createScore({ tracks: [createTrack({ id: "p", notes: [createNote({ id: "n", startTick: 0, durationTicks: PPQ, pitch: 60 })] })] });
    assert.equal(s.version, 1);
    assert.equal(s.ppq, 480);
    assert.equal(scoreToNoteEvents(s).length, 1);
  });
  test("version and ppq cannot be overridden", () => {
    assert.equal(createScore({ ppq: 960 as unknown as 480 }).ppq, 480);
  });
});
