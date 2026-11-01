import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  validateScore, isScore, assertScore, parseScore, ScoreValidationError, scoreSchema, SUPPORTED_KEYWORDS, createScore,
} from "../src/index.js";
import { int, note, rng, score, track } from "./helpers.js";
import { readFileSync } from "node:fs";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("validateScore", () => {
  test("accepts a minimal and a full score", () => {
    assert.ok(isScore({ version: 1, ppq: 480, bpm: 120, timeSignature: "4/4", tracks: [] }));
    assert.ok(isScore(score({
      tempoChanges: [{ tick: 480, bpm: 100.5 }], meterChanges: [{ measure: 2, timeSignature: "6/8" }], keyChanges: [{ measure: 1, fifths: -3 }],
      repeats: [{ measure: 0, start: true }, { measure: 1, end: { times: 3 }, ending: { numbers: [1, 2], stop: true } }],
      keySignature: 2, patches: [{ anything: true }], buses: [{}],
      tracks: [track({ notes: [note({ id: "a", tuplet: { num: 3, den: 2 }, articulations: ["staccato", "accent"], dynamic: "mf", voice: 2, staff: 1, accidental: "sharp" })], rests: [{ id: "r", startTick: 0, durationTicks: 1 }] })],
    })));
  });
  test("rejects non-objects, wrong version and wrong ppq", () => {
    for (const v of [null, 3, "x", [], {}]) assert.equal(isScore(v), false);
    assert.equal(isScore({ ...score(), version: 2 }), false);
    assert.equal(isScore({ ...score(), ppq: 960 }), false);
  });
  test("reports paths", () => {
    const s = score();
    (s.tracks[0]!.notes[1] as { pitch: number }).pitch = 200;
    const r = validateScore(s);
    assert.ok(!r.ok);
    assert.deepEqual(r.errors.map((e) => e.path), ["/tracks/0/notes/1/pitch"]);
  });
  test("reports missing required fields", () => {
    const r = validateScore({ version: 1, ppq: 480 });
    assert.ok(!r.ok);
    assert.deepEqual(r.errors.map((e) => e.path).sort(), ["/bpm", "/timeSignature", "/tracks"]);
  });
  test("enforces bounds", () => {
    const bad = (patch: Record<string, unknown>) => assert.equal(isScore({ ...score(), ...patch }), false, JSON.stringify(patch));
    bad({ bpm: 19 });
    bad({ bpm: 301 });
    bad({ bpm: Number.NaN });
    bad({ timeSignature: "4/3" });
    bad({ timeSignature: "0/4" });
    bad({ timeSignature: "4/4 " });
    bad({ measures: 0 });
    bad({ measures: 4097 });
    bad({ keySignature: 8 });
    bad({ keySignature: 1.5 });
    bad({ title: "x".repeat(201) });
    bad({ tempoChanges: [{ tick: -1, bpm: 100 }] });
    bad({ tempoChanges: [{ tick: 1.5, bpm: 100 }] });
    bad({ tempoChanges: [{ tick: 2 ** 31, bpm: 100 }] });
    bad({ meterChanges: [{ measure: 4096, timeSignature: "4/4" }] });
    bad({ repeats: [{ measure: 0, end: { times: 1 } }] });
    bad({ repeats: [{ measure: 0, ending: { numbers: [], stop: true } }] });
    bad({ repeats: [{ measure: 0, ending: { numbers: [1, 1], stop: true } }] });
    bad({ tracks: Array.from({ length: 65 }, (_, i) => track({ id: `t${i}`, notes: [] })) });
    bad({ buses: [{}, {}, {}, {}, {}] });
  });
  test("enforces note bounds", () => {
    const bad = (n: Record<string, unknown>) => assert.equal(isScore(score({ tracks: [track({ notes: [{ ...note({ id: "a" }), ...n } as never] })] })), false, JSON.stringify(n));
    bad({ durationTicks: 0 });
    bad({ velocity: 1.1 });
    bad({ velocity: -0.1 });
    bad({ pitch: -1 });
    bad({ pitch: 60.5 });
    bad({ startTick: -1 });
    bad({ id: "" });
    bad({ id: "x".repeat(65) });
    bad({ voice: 5 });
    bad({ staff: 3 });
    bad({ accidental: "up" });
    bad({ articulations: ["staccato", "staccato"] });
    bad({ dynamic: "fff" });
    bad({ tuplet: { num: 1, den: 1 } });
  });
  test("ignores unknown fields (they belong to a later version, e.g. patterns and clips)", () => {
    const s = { ...score(), patterns: [{ id: "p1" }], clips: [], track: 1 };
    const r = validateScore(s);
    assert.ok(r.ok);
    assert.equal(r.score, s);
    assert.ok(isScore({ ...score(), tracks: [{ ...track(), lane: 3 }] }));
  });
  test("semantic: duplicate ids are errors, and can be turned off", () => {
    const dupNotes = score({ tracks: [track({ notes: [note({ id: "a" }), note({ id: "a" })] })] });
    const r = validateScore(dupNotes);
    assert.ok(!r.ok);
    assert.equal(r.errors[0]!.path, "/tracks/0/notes/1/id");
    assert.ok(validateScore(dupNotes, { semantic: false }).ok);
    assert.equal(isScore(score({ tracks: [track({ id: "x" }), track({ id: "x", notes: [] })] })), false);
    assert.equal(isScore(score({ tracks: [track({ id: "x" }), track({ id: "y", notes: [note({ id: "a" })] })] })), false); // "a" reused across tracks
  });
  test("caps errors for hostile input", () => {
    const r = validateScore(score({ tracks: [track({ notes: Array.from({ length: 5000 }, (_, i) => note({ id: `n${i}`, pitch: 999 })) })] }));
    assert.ok(!r.ok);
    assert.equal(r.errors.length, 100);
    const r2 = validateScore(score({ tracks: [track({ notes: Array.from({ length: 5000 }, (_, i) => note({ id: `n${i}`, pitch: 999 })) })] }), { maxErrors: 3 });
    assert.ok(!r2.ok && r2.errors.length === 3);
  });
  test("an oversized array is rejected without walking it", () => {
    const notes = Array.from({ length: 65537 }, (_, i) => note({ id: `n${i}`, startTick: i }));
    const r = validateScore(score({ tracks: [track({ notes })] }));
    assert.ok(!r.ok);
    assert.deepEqual(r.errors.map((e) => e.path), ["/tracks/0/notes"]);
  });
  test("assertScore and parseScore", () => {
    assert.throws(() => assertScore({}), ScoreValidationError);
    assert.throws(() => parseScore("{"), SyntaxError);
    const s = createScore();
    assert.deepEqual(parseScore(JSON.stringify(s)), s);
    try {
      assertScore({ version: 1 });
      assert.fail();
    } catch (e) {
      assert.ok(e instanceof ScoreValidationError);
      assert.ok(e.errors.length >= 3);
      assert.match(e.message, /Invalid score/);
    }
  });
  test("createScore validates", () => {
    assert.ok(isScore(createScore()));
  });
});

describe("the schema is the source of truth", () => {
  const packaged = JSON.parse(readFileSync(new URL("../schema/score.schema.json", import.meta.url), "utf8")) as unknown;

  test("the schema the validator uses is the packaged file", () => {
    assert.deepEqual(scoreSchema, packaged);
  });
  test("it only uses keywords the interpreter implements", () => {
    const unsupported = new Set<string>();
    const walk = (node: unknown, inProperties = false): void => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n));
      if (node === null || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (!inProperties && !SUPPORTED_KEYWORDS.has(k)) unsupported.add(k);
        // `properties` and `$defs` map names to schemas; their keys are not keywords.
        if (k === "properties" || k === "$defs") Object.values(v as object).forEach((c) => walk(c));
        else if (k === "default" || k === "const" || k === "enum") continue;
        else walk(v);
      }
    };
    walk(scoreSchema);
    assert.deepEqual([...unsupported], []);
  });

  // Cross-check the interpreter against a reference validator on random mutations.
  test("agrees with ajv (draft 2020-12) on random valid and mutated scores", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: false });
    const validate = ajv.compile(scoreSchema as object);
    const r = rng(2026);
    const base = (): any => clone(score({
      tempoChanges: [{ tick: 480, bpm: 90 }], meterChanges: [{ measure: 1, timeSignature: "3/4" }], keyChanges: [{ measure: 1, fifths: 2 }],
      repeats: [{ measure: 1, end: { times: 2 }, ending: { numbers: [1], stop: true } }],
      tracks: [track({ notes: [note({ id: "a", tuplet: { num: 3, den: 2 }, articulations: ["tenuto"] })] })],
    }));
    const junk: unknown[] = [null, -1, 0, 1, 1.5, 2 ** 31, 300, 19, 128, "", "x", "4/4", "7/3", true, [], {}, [1, 1], "x".repeat(300), Number.MAX_SAFE_INTEGER];
    const paths = [
      ["bpm"], ["ppq"], ["version"], ["title"], ["timeSignature"], ["keySignature"], ["measures"], ["tracks", 0, "name"], ["tracks", 0, "id"],
      ["tracks", 0, "notes", 0, "pitch"], ["tracks", 0, "notes", 0, "velocity"], ["tracks", 0, "notes", 0, "durationTicks"],
      ["tracks", 0, "notes", 0, "startTick"], ["tracks", 0, "notes", 0, "tuplet"], ["tracks", 0, "notes", 0, "articulations"],
      ["tracks", 0, "notes", 0, "voice"], ["tracks", 0, "clef"], ["tracks", 0, "volume"], ["tracks", 0, "pan"],
      ["tempoChanges", 0, "tick"], ["tempoChanges", 0, "bpm"], ["meterChanges", 0, "measure"], ["meterChanges", 0, "timeSignature"],
      ["keyChanges", 0, "fifths"], ["repeats", 0, "end", "times"], ["repeats", 0, "ending", "numbers"], ["repeats", 0, "ending", "stop"],
      ["repeats", 0, "measure"], ["tracks"], ["repeats"], ["patches"],
    ];
    let valid = 0;
    let invalid = 0;
    for (let i = 0; i < 2500; i++) {
      const s = base();
      for (let k = int(r, 1, 3); k > 0; k--) {
        const path = paths[int(r, 0, paths.length - 1)]!;
        let target: any = s;
        for (const p of path.slice(0, -1)) target = target?.[p];
        if (target && typeof target === "object") {
          if (r() < 0.15) delete target[path[path.length - 1]!];
          else target[path[path.length - 1]!] = junk[int(r, 0, junk.length - 1)];
        }
      }
      const mine = validateScore(s, { semantic: false }).ok;
      const ref = validate(s) as boolean;
      assert.equal(mine, ref, `${JSON.stringify(s)} -> ajv ${ref}, ours ${mine}`);
      if (ref) valid++; else invalid++;
    }
    assert.ok(valid > 50 && invalid > 50, `valid=${valid} invalid=${invalid}`);
  });
});
