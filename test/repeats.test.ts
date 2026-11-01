import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  playOrder, isLinear, performanceSpans, performanceTicksFor, sourceTickAt, barlinesFor, buildMeterMap, MAX_SPANS,
  type RepeatMark,
} from "../src/index.js";
import { TPM } from "./helpers.js";

const measures = (repeats: RepeatMark[], count: number) => playOrder({ repeats }, count).map((s) => s.measure);

describe("playOrder", () => {
  test("is the written order when there are no repeats", () => {
    const order = playOrder({}, 4);
    assert.deepEqual(order.map((s) => s.measure), [0, 1, 2, 3]);
    assert.ok(isLinear(order, 4));
  });
  test("repeats back to the start when there is no opening sign", () => {
    assert.deepEqual(measures([{ measure: 1, end: { times: 2 } }], 4), [0, 1, 0, 1, 2, 3]);
  });
  test("repeats back to an explicit opening sign", () => {
    assert.deepEqual(measures([{ measure: 1, start: true }, { measure: 2, end: { times: 2 } }], 4), [0, 1, 2, 1, 2, 3]);
  });
  test("honours a repeat played more than twice", () => {
    assert.deepEqual(measures([{ measure: 0, end: { times: 3 } }], 2), [0, 0, 0, 1]);
  });
  test("times of 1 or 0 is no repeat rather than a loop", () => {
    assert.deepEqual(measures([{ measure: 0, end: { times: 1 } }], 2), [0, 1]);
    assert.deepEqual(measures([{ measure: 0, end: { times: 0 } }], 2), [0, 1]);
  });
  test("counts passes", () => {
    assert.deepEqual(playOrder({ repeats: [{ measure: 1, end: { times: 2 } }] }, 3), [
      { measure: 0, pass: 1 }, { measure: 1, pass: 1 }, { measure: 0, pass: 2 }, { measure: 1, pass: 2 }, { measure: 2, pass: 1 },
    ]);
  });
  test("a first ending plays on the first pass only, a second on the second", () => {
    assert.deepEqual(
      measures([{ measure: 2, ending: { numbers: [1], stop: true }, end: { times: 2 } }, { measure: 3, ending: { numbers: [2], stop: true } }], 5),
      [0, 1, 2, 0, 1, 3, 4],
    );
  });
  test("a bracket shared by passes [1, 2] with times 3", () => {
    assert.deepEqual(
      measures([{ measure: 1, ending: { numbers: [1, 2], stop: true }, end: { times: 3 } }, { measure: 2, ending: { numbers: [3], stop: true } }], 4),
      [0, 1, 0, 1, 0, 2, 3],
    );
  });
  test("skips a multi-measure bracket entirely", () => {
    assert.deepEqual(
      measures([
        { measure: 1, ending: { numbers: [1], stop: false } },
        { measure: 2, ending: { numbers: [1], stop: true }, end: { times: 2 } },
        { measure: 3, ending: { numbers: [2], stop: true } },
      ], 5),
      [0, 1, 2, 0, 3, 4],
    );
  });
  test("restarts the pass count at a new section", () => {
    assert.deepEqual(
      measures([{ measure: 1, end: { times: 2 } }, { measure: 2, start: true }, { measure: 3, end: { times: 2 } }], 4),
      [0, 1, 0, 1, 2, 3, 2, 3],
    );
  });
  test("a volta and a closing repeat on one measure (marks merged)", () => {
    assert.deepEqual(
      measures([{ measure: 1, ending: { numbers: [1], stop: true } }, { measure: 1, end: { times: 2 } }], 3),
      [0, 1, 0, 2],
    );
  });
  test("a missing closing repeat plays straight through", () => {
    assert.deepEqual(measures([{ measure: 1, start: true }], 3), [0, 1, 2]);
  });
  test("terminates on an enormous repeat count (span guard)", () => {
    const order = playOrder({ repeats: [{ measure: 0, end: { times: 1e9 } }] }, 2);
    assert.ok(order.length > 0 && order.length <= MAX_SPANS);
  });
  test("does not run off the end on a bracket that never closes", () => {
    assert.deepEqual(measures([{ measure: 1, ending: { numbers: [2], stop: false } }], 3), [0]);
  });
  test("handles an empty score", () => {
    assert.deepEqual(playOrder({ repeats: [{ measure: 0, end: { times: 2 } }] }, 0), []);
  });
  test("a repeat is not linear", () => {
    assert.equal(isLinear(playOrder({ repeats: [{ measure: 1, end: { times: 2 } }] }, 3), 3), false);
  });
});

describe("performance spans", () => {
  const meter = buildMeterMap({ timeSignature: "4/4" });
  const repeat = performanceSpans(playOrder({ repeats: [{ measure: 1, end: { times: 2 } }] }, 3), meter);

  test("lays repeated measures end to end", () => {
    assert.deepEqual(repeat.map((s) => [s.measure, s.sourceStartTick, s.startTick]), [
      [0, 0, 0], [1, TPM, TPM], [0, 0, TPM * 2], [1, TPM, TPM * 3], [2, TPM * 2, TPM * 4],
    ]);
  });
  test("a note inside a repeat sounds once per pass; after it, once but later", () => {
    assert.deepEqual(performanceTicksFor(repeat, 480), [480, TPM * 2 + 480]);
    assert.deepEqual(performanceTicksFor(repeat, TPM * 2), [TPM * 4]);
  });
  test("lays out by each bar's own length under a meter change", () => {
    const m = buildMeterMap({ timeSignature: "4/4", meterChanges: [{ measure: 1, timeSignature: "3/4" }] });
    const spans = performanceSpans(playOrder({ repeats: [{ measure: 1, end: { times: 2 } }] }, 2), m);
    assert.deepEqual(spans.map((s) => s.startTick), [0, 1920, 3360, 5280]);
  });
  test("maps a performance position back to where it is written", () => {
    assert.equal(sourceTickAt(repeat, TPM * 2 + 240), 240);
    assert.equal(sourceTickAt(repeat, 240), 240);
    assert.equal(sourceTickAt(repeat, TPM * 99), null);
  });
  test("is the identity when nothing repeats", () => {
    const spans = performanceSpans(playOrder({}, 4), meter);
    assert.deepEqual(performanceTicksFor(spans, 700), [700]);
    assert.equal(sourceTickAt(spans, 700), 700);
  });
});

describe("barlinesFor", () => {
  test("plain barlines when nothing repeats", () => {
    assert.deepEqual(barlinesFor({}, 2), [{ repeatStart: false, repeatEnd: false }, { repeatStart: false, repeatEnd: false }]);
  });
  test("marks the repeat signs on their own measures", () => {
    const lines = barlinesFor({ repeats: [{ measure: 1, start: true }, { measure: 3, end: { times: 2 } }] }, 4);
    assert.equal(lines[1]!.repeatStart, true);
    assert.equal(lines[3]!.repeatEnd, true);
  });
  test("a one-measure ending opens and closes", () => {
    assert.deepEqual(barlinesFor({ repeats: [{ measure: 1, ending: { numbers: [1], stop: true } }] }, 3)[1]!.volta, { role: "beginEnd", label: "1." });
  });
  test("labels only the first measure of a multi-measure bracket", () => {
    const lines = barlinesFor({
      repeats: [
        { measure: 1, ending: { numbers: [1], stop: false } },
        { measure: 2, ending: { numbers: [1], stop: false } },
        { measure: 3, ending: { numbers: [1], stop: true } },
      ],
    }, 5);
    assert.deepEqual(lines[1]!.volta, { role: "begin", label: "1." });
    assert.deepEqual(lines[2]!.volta, { role: "mid", label: "" });
    assert.deepEqual(lines[3]!.volta, { role: "end", label: "" });
    assert.equal(lines[4]!.volta, undefined);
  });
  test("new bracket when the numbers change, even back to back", () => {
    const lines = barlinesFor({ repeats: [{ measure: 1, ending: { numbers: [1], stop: true } }, { measure: 2, ending: { numbers: [2], stop: true } }] }, 3);
    assert.deepEqual(lines[2]!.volta, { role: "beginEnd", label: "2." });
  });
  test("several numbers in one bracket", () => {
    assert.equal(barlinesFor({ repeats: [{ measure: 0, ending: { numbers: [1, 2], stop: true } }] }, 1)[0]!.volta?.label, "1, 2.");
  });
});
