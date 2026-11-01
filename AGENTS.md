# Agent playbook

`@johnhenry/score`: a music Score model, tempo/meter/key maps, repeats, and `score -> note events`. Single package, Node >= 26, TypeScript, tests via `node --test` + `tsx`, built with `tsup` (ESM + CJS). Zero runtime dependencies, no DOM: keep it that way (`scripts/smoke.mjs` checks the bundle).

`CLAUDE.md` is a symlink to this file.

## Verification loop (before every push)

1. `npm run typecheck`
2. `npm test`
3. `npm run build && npm run smoke && npm pack --dry-run` (read the file list: `dist`, `schema`, README, CHANGELOG, LICENSE)
4. A fresh clone: `git clone . /tmp/score-verify && cd /tmp/score-verify && npm ci && npm run typecheck && npm test && npm run build && npm run smoke`

## Rules

- `schema/score.schema.json` is the source of truth for the Score shape. If you change it, update `src/types.ts`, and if it uses a new JSON Schema keyword, teach `src/validate.ts` (a test fails otherwise).
- Ticks are authoritative; seconds appear only in `tempo.ts` and `events.ts`.
- Do not rename `.github/workflows/release.yml`: npm trusted publishing is keyed to the workflow filename.
- Releases: main is the release branch. Bump `version` + CHANGELOG, merge; the workflow publishes if the version is not on npm.
