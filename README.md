# @johnhenry/score

A piece of music as data, and the maths that reads it.

- **The model**: a `Score` of tracks and notes on a tick timeline (480 ticks to the quarter note), with tempo, meter and key maps and repeat marks. JSON-serialisable, versioned (`version: 1`), described by a JSON Schema that ships in the package.
- **The maths**: ticks to seconds and back, repeat unrolling, and `score -> performance -> note events`: the flat `{ note, velocity, time, dur }` list an audio engine plays.
- **Pure**: zero runtime dependencies, no DOM, no timers, no I/O. It runs in a Worker, a browser, Node, Deno or Bun. ESM and CJS.

It carries the *behaviour* of a notation-capable score editor's core (repeats with voltas, meter changes, tempo changes that survive being unrolled) in a form other tools can reuse: a MIDI importer, a plot of pitch data, a CLI, a drag-and-drop composer.

```sh
npm install @johnhenry/score
```

```ts
import { createScore, createTrack, createNote, scoreToNoteEvents, validateScore } from "@johnhenry/score";

const score = createScore({
  bpm: 100,
  measures: 2,
  // bar 1 is played twice
  repeats: [{ measure: 0, end: { times: 2 } }],
  tempoChanges: [{ tick: 1920, bpm: 60 }], // bar 2 slows down
  tracks: [
    createTrack({
      id: "lead",
      instrumentId: "piano",
      notes: [
        createNote({ id: "a", startTick: 0, durationTicks: 480, pitch: 60 }),
        createNote({ id: "b", startTick: 1920, durationTicks: 480, pitch: 64 }),
      ],
    }),
  ],
});

validateScore(score); // { ok: true, score }
scoreToNoteEvents(score);
// [ { note: 60, velocity: 0.8, time: 0,   dur: 0.6 },
//   { note: 60, velocity: 0.8, time: 2.4, dur: 0.6 },   // second pass of bar 1
//   { note: 64, velocity: 0.8, time: 4.8, dur: 1 } ]    // bar 2 at 60 bpm
```

## Ticks are authoritative

Positions and lengths are integer ticks, `PPQ = 480`: a quarter is 480, an eighth 240, a sixteenth 120, a triplet eighth 160. Tuplets are notation (the note's `tuplet` field says how it is written; its ticks say how long it sounds). **Seconds exist only at the audio boundary** and are derived through the tempo map; editing the music edits `tempoChanges`, never an audio clock.

Tempo is a step function: each tempo holds until the next change (no accelerando). With the points `(t_i, b_i)` and `S_i` the seconds at each point:

- `seconds(tick) = S_i + (tick - t_i) * 60 / (b_i * 480)` for the last `t_i <= tick`
- `tick(s) = t_i + (s - S_i) / spt(b_i)` for the last `S_i <= s` (a float; round only where a tick is stored)
- a duration depends on where it starts: `dur = seconds(start + len) - seconds(start)`.

Meter and key changes are keyed by **measure**, not tick (a meter taking effect mid-bar is not notatable). Once the meter changes, "bar N starts at N x ticksPerMeasure" is false; use `measureStartTick`.

## API

All of it is exported from the package root.

**Model**: `Score`, `Track`, `Note`, `Rest`, `RepeatMark`, `TempoChange`, `MeterChange`, `KeyChange`; `PPQ`, `SCORE_VERSION`, `MIN_BPM`, `MAX_BPM`; `createScore`, `createTrack`, `createNote`.

**Validation** (against `schema/score.schema.json`): `validateScore(value, { semantic?, maxErrors? })` returns `{ ok: true, score } | { ok: false, errors: { path, message }[] }`; `isScore`, `assertScore`, `parseScore(json)`, `ScoreValidationError`, `scoreSchema`. `semantic` (default on) also checks what a schema cannot: unique track ids and unique note/rest ids. Errors stop at 100 by default, so hostile input stays cheap. The schema is also importable as `@johnhenry/score/score.schema.json`.

**Maps** (built from a score, derived and never stored):

| | build | query |
|---|---|---|
| tempo (by tick) | `buildTempoMap` | `bpmAtTick`, `secondsAtTick`, `tickAtSeconds`, `durationSeconds`, `isConstantTempo`, `clampBpm` |
| meter (by measure) | `buildMeterMap` | `meterAt`, `ticksInMeasure`, `measureStartTick`, `measureAtTick`, `totalTicks`, `measuresToCover`, `beatsInMeasure`, `barBeat` |
| key (by measure, in fifths) | `buildKeyMap` | `fifthsAt`, `keyChangesAt`, `clampFifths` |

Building sorts, drops non-finite entries, clamps (tempo 20..300, key -7..7), seeds with the opening value, lets a later change at the same position win, and drops a change equal to the value in force.

**Repeats**: `playOrder(score, measureCount)` gives the measures actually played (`{ measure, pass }[]`); `performanceSpans` lays them end to end by each bar's own length; `performanceTicksFor` and `sourceTickAt` map written to heard and back (what a playhead needs); `barlinesFor` says what each barline draws (repeat signs, volta brackets). Rules: at a closing repeat return to the latest opening repeat (or the start) until the section has played `times` in total; skip a volta whose `numbers` lack the current pass; a volta may share passes (`[2, 3]`) and sit on the same measure as a closing repeat; capped at `MAX_SPANS = 4000` measures.

**Performance and events**:

- `buildPerformance(score, { audibleOnly? })` is the score as heard: repeats taken, one `playTick` per occurrence, `endTick` (last note stops), `spanEndTick` (the written grid's end, for a transport), `linear` (no repeat changes the order).
- `performanceTempo(score, performance)` re-places tempo changes onto the unrolled timeline: entering a span restates the tempo in force at its source.
- `scoreToEvents(score, { audibleOnly? })` is the full adapter: per-track `{ trackId, instrumentId, volume?, pan?, events }`, plus `endSeconds`, `spanEndSeconds` and the unrolled `tempoMap`. `scoreToNoteEvents(score)` is the flat, time-sorted list. Muted tracks are dropped and solo is honoured (mute wins over solo); pass `audibleOnly: false` for an export. `time` and `dur` are seconds rounded to the microsecond so equal scores give equal JSON.

## Scope and limits

- **Format 1** has no tempo ramps, no CC or pitch-bend lanes, and one lyric syllable per note. Each would be an added optional field, not a version bump.
- **Fractional tempos are kept** (`120.5` stays `120.5`); they are clamped to 20..300 but not rounded.
- **Patterns and clips** (a drag-and-drop composer's lanes of clips over the shared tick timeline) are not modelled yet. They are meant to arrive as new optional top-level fields beside `tracks`, with `tracks` staying "instruments, not lanes". The schema and this package ignore unknown fields and the functions here never drop them, so a writer can already carry them.
- **Not here**: Standard MIDI Files, MusicXML, engraving, audio. Those are separate packages that depend on the Score shape.
- Immutable edit operations are a later addition.

## Development

```sh
npm ci
npm run typecheck && npm test && npm run build && npm run smoke
```

`schema/score.schema.json` is the source of truth. The validator interprets it directly (a test fails if the schema uses a keyword the validator lacks) and a test cross-checks it against Ajv on thousands of random mutations; Ajv is a dev dependency only.

Releases: this repo publishes from `main` through the fleet's reusable workflow. A push whose `package.json` version is not on npm yet is published (via npm trusted publishing), tagged `v<version>` and released; any other push is a no-op.

## License

MIT
