import schema from "../schema/score.schema.json" with { type: "json" };
import type { Score } from "./types.js";

/**
 * Validation against `schema/score.schema.json`, which is the source of truth.
 *
 * The package has no runtime dependencies, so this is a small interpreter for
 * the subset of JSON Schema that file uses (a test fails if the schema ever
 * uses a keyword this does not implement). Unknown object properties are
 * ignored, as the schema says readers must.
 */

/** The Score JSON Schema (2020-12), also exported as `@johnhenry/score/score.schema.json`. */
export const scoreSchema = schema;

export interface ValidationError {
  /** JSON-pointer-like path, e.g. `/tracks/0/notes/3/pitch`. Empty string is the root. */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; score: Score } | { ok: false; errors: ValidationError[] };

export interface ValidateOptions {
  /** Also check what a schema cannot say: unique track ids and unique note/rest ids. Default true. */
  semantic?: boolean;
  /** Stop collecting after this many errors. Default 100 (input may be untrusted and enormous). */
  maxErrors?: number;
}

/** Keywords the interpreter implements (plus annotation-only ones it ignores). */
export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$ref", "type", "const", "enum", "minimum", "maximum", "minLength", "maxLength", "pattern",
  "items", "required", "properties", "minItems", "maxItems", "uniqueItems",
  // annotations
  "$schema", "$id", "$defs", "title", "description", "default",
]);

type Json = unknown;
interface SchemaNode {
  [k: string]: Json;
}

class Done extends Error {}

const typeOf = (v: Json): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

function deepEqual(a: Json, b: Json): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function resolve(ref: string): SchemaNode {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  let node: Json = schema;
  for (const part of ref.slice(2).split("/")) node = (node as SchemaNode)[part];
  if (!node || typeof node !== "object") throw new Error(`unresolved $ref ${ref}`);
  return node as SchemaNode;
}

const regexCache = new Map<string, RegExp>();

function check(node: SchemaNode, value: Json, path: string, errors: ValidationError[], max: number): void {
  const fail = (message: string) => {
    errors.push({ path, message });
    if (errors.length >= max) throw new Done();
  };

  if (typeof node["$ref"] === "string") {
    check(resolve(node["$ref"]), value, path, errors, max);
    return;
  }

  const type = node["type"];
  if (typeof type === "string") {
    const actual = typeOf(value);
    const ok = type === actual || (type === "number" && actual === "integer");
    if (!ok) {
      fail(`expected ${type}, got ${actual}`);
      return;
    }
  }
  if ("const" in node && !deepEqual(value, node["const"])) fail(`must equal ${JSON.stringify(node["const"])}`);
  if (Array.isArray(node["enum"]) && !node["enum"].some((e) => deepEqual(e, value))) {
    fail(`must be one of ${(node["enum"] as Json[]).map((e) => JSON.stringify(e)).join(", ")}`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("must be finite");
    if (typeof node["minimum"] === "number" && value < node["minimum"]) fail(`must be >= ${node["minimum"]}`);
    if (typeof node["maximum"] === "number" && value > node["maximum"]) fail(`must be <= ${node["maximum"]}`);
  }

  if (typeof value === "string") {
    if (typeof node["minLength"] === "number" && value.length < node["minLength"]) fail(`must have length >= ${node["minLength"]}`);
    if (typeof node["maxLength"] === "number" && value.length > node["maxLength"]) fail(`must have length <= ${node["maxLength"]}`);
    if (typeof node["pattern"] === "string") {
      let re = regexCache.get(node["pattern"]);
      if (!re) regexCache.set(node["pattern"], (re = new RegExp(node["pattern"])));
      if (!re.test(value)) fail(`must match ${node["pattern"]}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof node["minItems"] === "number" && value.length < node["minItems"]) fail(`must have >= ${node["minItems"]} items`);
    if (typeof node["maxItems"] === "number" && value.length > node["maxItems"]) {
      fail(`must have <= ${node["maxItems"]} items`);
      return; // do not walk an oversized array
    }
    if (node["uniqueItems"] === true) {
      const seen = new Set<string>();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          fail("items must be unique");
          break;
        }
        seen.add(key);
      }
    }
    const items = node["items"];
    if (items && typeof items === "object") {
      for (let i = 0; i < value.length; i++) check(items as SchemaNode, value[i], `${path}/${i}`, errors, max);
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, Json>;
    if (Array.isArray(node["required"])) {
      for (const key of node["required"] as string[]) {
        if (!(key in obj) || obj[key] === undefined) {
          errors.push({ path: `${path}/${key}`, message: "is required" });
          if (errors.length >= max) throw new Done();
        }
      }
    }
    const props = node["properties"] as Record<string, SchemaNode> | undefined;
    if (props) {
      for (const key of Object.keys(props)) {
        if (key in obj && obj[key] !== undefined) check(props[key]!, obj[key], `${path}/${key}`, errors, max);
      }
    }
  }
}

function semantic(score: Score, errors: ValidationError[], max: number): void {
  const push = (path: string, message: string) => {
    errors.push({ path, message });
    if (errors.length >= max) throw new Done();
  };
  const trackIds = new Set<string>();
  const noteIds = new Set<string>();
  score.tracks.forEach((track, ti) => {
    if (trackIds.has(track.id)) push(`/tracks/${ti}/id`, `duplicate track id "${track.id}"`);
    trackIds.add(track.id);
    track.notes.forEach((n, ni) => {
      if (noteIds.has(n.id)) push(`/tracks/${ti}/notes/${ni}/id`, `duplicate note id "${n.id}"`);
      noteIds.add(n.id);
    });
    (track.rests ?? []).forEach((r, ri) => {
      if (noteIds.has(r.id)) push(`/tracks/${ti}/rests/${ri}/id`, `duplicate id "${r.id}"`);
      noteIds.add(r.id);
    });
  });
}

/** Validate an unknown value. On success, `score` is the same object, typed. */
export function validateScore(value: unknown, options: ValidateOptions = {}): ValidationResult {
  const max = options.maxErrors ?? 100;
  const errors: ValidationError[] = [];
  try {
    check(schema as SchemaNode, value, "", errors, max);
    if (errors.length === 0 && options.semantic !== false) semantic(value as Score, errors, max);
  } catch (e) {
    if (!(e instanceof Done)) throw e;
  }
  return errors.length === 0 ? { ok: true, score: value as Score } : { ok: false, errors };
}

export function isScore(value: unknown): value is Score {
  return validateScore(value, { maxErrors: 1 }).ok;
}

export class ScoreValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`Invalid score: ${errors.slice(0, 5).map((e) => `${e.path || "/"} ${e.message}`).join("; ")}${errors.length > 5 ? `; and ${errors.length - 5} more` : ""}`);
    this.name = "ScoreValidationError";
    this.errors = errors;
  }
}

/** Throws {@link ScoreValidationError} unless `value` is a valid Score. */
export function assertScore(value: unknown, options?: ValidateOptions): asserts value is Score {
  const r = validateScore(value, options);
  if (!r.ok) throw new ScoreValidationError(r.errors);
}

/** `JSON.parse` then {@link assertScore}. */
export function parseScore(json: string, options?: ValidateOptions): Score {
  const value: unknown = JSON.parse(json);
  assertScore(value, options);
  return value;
}
