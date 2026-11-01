// Run against a fresh `npm run build`: imports the package by its published
// name (ESM and CJS), plays a tiny score, and checks the bundle stays
// DOM-free and dependency-free (worker-safe).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as esm from "@johnhenry/score";

const cjs = createRequire(import.meta.url)("@johnhenry/score");
for (const lib of [esm, cjs]) {
  const s = lib.createScore({
    repeats: [{ measure: 0, end: { times: 2 } }],
    tracks: [lib.createTrack({ id: "t", notes: [lib.createNote({ id: "n", startTick: 0, durationTicks: 480, pitch: 60 })] })],
  });
  assert.ok(lib.isScore(s));
  assert.deepEqual(lib.scoreToNoteEvents(s).map((e) => e.time), [0, 2]);
}
assert.equal(esm.scoreSchema.$id.endsWith("score.schema.json"), true);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(pkg.dependencies, undefined, "zero runtime dependencies");

// Evaluate the CJS bundle in a context with no globals except the module
// plumbing: a worker has no DOM, no process, no Buffer.
const code = readFileSync(new URL("../dist/index.cjs", import.meta.url), "utf8");
const mod = { exports: {} };
runInNewContext(code, { module: mod, exports: mod.exports });
assert.equal(typeof mod.exports.scoreToNoteEvents, "function");
for (const bad of ["document", "window", "require(", "process.", "Buffer"]) {
  assert.ok(!code.includes(bad), `bundle mentions ${bad}`);
}
console.log("smoke ok");
