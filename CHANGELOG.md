# Changelog

## 0.2.0

Additive: scores without the new fields behave exactly as before (format stays version 1).

- Tempo ramps: `TempoChange.ramp: "linear"` moves the tempo in a straight line (bpm over ticks) to the next change. `bpmAtTick`, `secondsAtTick`, `tickAtSeconds`, `durationSeconds` and `performanceTempo` (repeats replaying a bar inside a ramp) handle it. `performanceTempo` now keeps a change at tick 0 instead of dropping it.
- Controller lane: `Track.controllers` (`{ tick, cc, value }`) and `Track.pitchBend` (`{ tick, value }` in -1..1), in the schema, validated, unrolled through repeats by `buildPerformance`, and returned in seconds by `scoreToEvents`.
- `scoreToEvents(score, { sustain: true })` applies CC 64 to note durations; `applySustain`, lane readers and 14-bit bend helpers are exported.

## 0.1.0 (2026-10-31)

First cut. Clean-room TypeScript, behaviour-compatible with the core of a notation-capable score editor.

- Score model, format version 1, PPQ 480; `schema/score.schema.json` shipped and exported as `@johnhenry/score/score.schema.json`.
- Tempo (by tick), meter and key (by measure) maps; ticks to seconds and back through the tempo map.
- Repeat unrolling (`playOrder`, voltas, `times > 2`, shared voltas, volta plus closing repeat on one measure, span guard) and `barlinesFor`.
- `buildPerformance`, `performanceTempo`, `scoreToEvents` / `scoreToNoteEvents`: `score -> performance -> { note, velocity, time, dur }`.
- `validateScore` / `isScore` / `assertScore` / `parseScore`: a zero-dependency validator driven by the schema, plus unique-id checks.
- Differences from the editor it was modelled on: tempo is clamped to 20..300 but no longer rounded to a whole number (the schema allows fractions); `linear` also requires that no measure is skipped.
- Zero runtime dependencies; no DOM; worker-safe.
