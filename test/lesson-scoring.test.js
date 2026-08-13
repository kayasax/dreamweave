"use strict";
// lesson-scoring.test.js -- Unit tests for scoreLessonIndex (#538 SLM).
//
// Exercises the pure cosine scoring and filtering logic exported from recall.js.
// No DB, no embed model, no subprocess. All computation is in-process.

const { scoreLessonIndex } = require("../src/recall");

const ACT_COS_FLOOR = 0.30;
const LESSON_INDEX_TOP_K = 3;

// ---- Helpers ----------------------------------------------------------------

function entry(id, embedding) {
  return { id, statement: `Statement for ${id}`, trigger: "assert-fact", enforcement: "inject", severity: "normal", embedding };
}

function unitVec(dims, dim0) {
  const v = new Array(dims).fill(0);
  v[0] = dim0 !== undefined ? dim0 : 1.0;
  return v;
}

function assertNoThrow(fn, label) {
  try { fn(); }
  catch (e) { throw new Error(`${label}: unexpected throw: ${e.message}`); }
}

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${e.message}`);
    fail++;
  }
}

// ---- Tests ------------------------------------------------------------------

test("returns empty array for null lessonIndex", () => {
  const r = scoreLessonIndex(unitVec(384), null);
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected [], got ${JSON.stringify(r)}`);
});

test("returns empty array for undefined lessonIndex", () => {
  const r = scoreLessonIndex(unitVec(384), undefined);
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected [], got ${JSON.stringify(r)}`);
});

test("returns empty array for index with no entries", () => {
  const r = scoreLessonIndex(unitVec(384), { entries: [] });
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected [], got ${JSON.stringify(r)}`);
});

test("returns empty array when entry embedding is null", () => {
  const idx = { entries: [{ id: "l1", statement: "X", embedding: null }] };
  const r = scoreLessonIndex(unitVec(384), idx);
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected [], got ${JSON.stringify(r)}`);
});

test("returns empty array when entry embedding is not an array", () => {
  const idx = { entries: [{ id: "l2", statement: "X", embedding: "not-an-array" }] };
  const r = scoreLessonIndex(unitVec(384), idx);
  if (!Array.isArray(r) || r.length !== 0) throw new Error(`expected [], got ${JSON.stringify(r)}`);
});

test(`filters entries below ACT_COS_FLOOR (${ACT_COS_FLOOR})`, () => {
  // dot([0.1,0,...],[1,0,...]) = 0.1 < 0.30
  const q = unitVec(384, 0.1);
  const idx = { entries: [entry("below-floor", unitVec(384))] };
  const r = scoreLessonIndex(q, idx);
  if (r.length !== 0) throw new Error(`expected [] for below-floor sim, got ${JSON.stringify(r)}`);
});

test("returns entry when similarity >= ACT_COS_FLOOR", () => {
  // dot([1,0,...],[1,0,...]) = 1.0 >= 0.30
  const idx = { entries: [entry("above-floor", unitVec(384))] };
  const r = scoreLessonIndex(unitVec(384), idx);
  if (r.length !== 1) throw new Error(`expected 1 result, got ${r.length}`);
  if (r[0].id !== "above-floor") throw new Error(`wrong id: ${r[0].id}`);
  if (r[0].similarity < ACT_COS_FLOOR) throw new Error(`similarity ${r[0].similarity} below floor`);
});

test("sorts results descending by similarity", () => {
  const q = unitVec(4);
  const idx = {
    entries: [
      entry("low",  [0.4, 0, 0, 0]),
      entry("high", [0.9, 0, 0, 0]),
      entry("mid",  [0.6, 0, 0, 0]),
    ],
  };
  const r = scoreLessonIndex(q, idx);
  if (r.length !== 3) throw new Error(`expected 3 results, got ${r.length}`);
  if (r[0].id !== "high") throw new Error(`top result should be 'high', got '${r[0].id}'`);
  if (r[1].id !== "mid")  throw new Error(`second result should be 'mid', got '${r[1].id}'`);
  if (r[2].id !== "low")  throw new Error(`third result should be 'low', got '${r[2].id}'`);
  if (r[0].similarity < r[1].similarity || r[1].similarity < r[2].similarity)
    throw new Error("results not sorted descending");
});

test(`caps results at LESSON_INDEX_TOP_K (${LESSON_INDEX_TOP_K})`, () => {
  const q = unitVec(4);
  const idx = {
    entries: Array.from({ length: 6 }, (_, i) =>
      entry(`l${i}`, [0.9 - i * 0.05, 0, 0, 0])
    ),
  };
  const r = scoreLessonIndex(q, idx);
  if (r.length > LESSON_INDEX_TOP_K) throw new Error(`expected <= ${LESSON_INDEX_TOP_K}, got ${r.length}`);
});

test("result entries include all required fields", () => {
  const idx = { entries: [entry("shape-check", unitVec(4))] };
  const r = scoreLessonIndex(unitVec(4), idx);
  if (r.length !== 1) throw new Error("expected 1 result");
  const e = r[0];
  for (const field of ["id", "statement", "trigger", "enforcement", "severity", "similarity"]) {
    if (!(field in e)) throw new Error(`missing field: ${field}`);
  }
});

test("similarity value is rounded to 4 decimal places", () => {
  const idx = { entries: [entry("rounding", [0.7, 0.7, 0, 0])] };
  const q = [1, 0, 0, 0];
  const r = scoreLessonIndex(q, idx);
  if (r.length !== 1) throw new Error("expected 1 result");
  const s = r[0].similarity;
  if (String(s).replace(/^[^.]+\.?/, "").length > 4)
    throw new Error(`similarity ${s} exceeds 4 decimal places`);
});

test("qFloat and embedding dimension mismatch is handled safely (min-length)", () => {
  // 4-dim query vs 6-dim embedding: should use min(4,6)=4 dims
  const q = [0.9, 0, 0, 0];
  const idx = { entries: [entry("dim-mismatch", [0.9, 0, 0, 0, 0.5, 0.5])] };
  assertNoThrow(() => scoreLessonIndex(q, idx), "dim mismatch");
});

// ---- Summary ----------------------------------------------------------------

console.log(`\nlesson-scoring: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
