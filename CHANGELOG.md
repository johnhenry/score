# Changelog

## Unreleased (first release will be 0.1.0)

First cut. Clean-room TypeScript, behaviour-compatible with the core of a notation-capable score editor.

- Score model, format version 1, PPQ 480; `schema/score.schema.json` shipped and exported as `@johnhenry/score/score.schema.json`.
- Tempo (by tick), meter and key (by measure) maps; ticks to seconds and back through the tempo map.
- Repeat unrolling (`playOrder`, voltas, `times > 2`, shared voltas, volta plus closing repeat on one measure, span guard) and `barlinesFor`.
- `buildPerformance`, `performanceTempo`, `scoreToEvents` / `scoreToNoteEvents`: `score -> performance -> { note, velocity, time, dur }`.
- `validateScore` / `isScore` / `assertScore` / `parseScore`: a zero-dependency validator driven by the schema, plus unique-id checks.
- Differences from the editor it was modelled on: tempo is clamped to 20..300 but no longer rounded to a whole number (the schema allows fractions); `linear` also requires that no measure is skipped.
- Zero runtime dependencies; no DOM; worker-safe.
