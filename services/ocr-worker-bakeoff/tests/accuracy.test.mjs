// Golden tests pinning the CER normative spec in src/accuracy.ts.
//
// Every test here corresponds to a numbered rule in the spec docstring.
// A rule change MUST update both the spec and the golden test for it,
// or the test must catch the drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCER, normalizeForCer } from "../dist/index.js";

// ---------------------------------------------------------------------------
// Spec rule 1: Unicode NFC normalization
// ---------------------------------------------------------------------------

test("CER: NFC-equivalent strings score 0 (precomposed vs combining)", () => {
  // U+00E9 "é" (precomposed) vs "e" + U+0301 (combining acute accent).
  const composed = "café";
  const decomposed = "café";
  // Sanity: they are byte-distinct.
  assert.notEqual(composed, decomposed);
  // After NFC, they normalize to the same form → CER 0.
  assert.equal(computeCER(composed, decomposed), 0);
});

// ---------------------------------------------------------------------------
// Spec rule 2: Line-break unification
// ---------------------------------------------------------------------------

test("CER: line-break-only difference (LF) scores 0", () => {
  assert.equal(computeCER("一二\n三", "一二 三"), 0);
});

test("CER: line-break-only difference (CRLF) scores 0", () => {
  assert.equal(computeCER("foo\r\nbar", "foo bar"), 0);
});

// ---------------------------------------------------------------------------
// Spec rule 3: Whitespace-run collapse
// ---------------------------------------------------------------------------

test("CER: whitespace run collapses to single ASCII space", () => {
  assert.equal(computeCER("foo   bar", "foo bar"), 0);
});

test("CER: tab+space mix collapses identically", () => {
  assert.equal(computeCER("foo\t \t  bar", "foo bar"), 0);
});

// ---------------------------------------------------------------------------
// Spec rule 4: Edge trim
// ---------------------------------------------------------------------------

test("CER: leading/trailing whitespace trimmed", () => {
  assert.equal(computeCER("  foo bar  ", "foo bar"), 0);
});

// ---------------------------------------------------------------------------
// Spec rule 5: NO case folding
// ---------------------------------------------------------------------------

test("CER: Latin case difference is a substitution", () => {
  // "ABC" vs "abc" — three substitutions, length 3 → CER 1.0.
  assert.equal(computeCER("ABC", "abc"), 1.0);
});

// ---------------------------------------------------------------------------
// Spec rule 6: NO punctuation folding
// ---------------------------------------------------------------------------

test("CER: full-width vs half-width punctuation NOT folded", () => {
  // "一，二" vs "一,二" — one substitution at the punctuation slot, length 3 → CER 1/3.
  const cer = computeCER("一，二", "一,二");
  assert.ok(cer > 0, "punctuation must not fold");
  assert.equal(cer, 1 / 3);
});

// ---------------------------------------------------------------------------
// Spec rule 7: Tokenization (one code point = one token)
// ---------------------------------------------------------------------------

test("CER: one substitution scores 1/N", () => {
  // "一二三" vs "一二四" — one substitution at position 2, length 3.
  assert.equal(computeCER("一二三", "一二四"), 1 / 3);
});

test("CER: one insertion scores 1/N where N = max(len)", () => {
  // "一二" vs "一二三" — one insertion, max length 3.
  assert.equal(computeCER("一二", "一二三"), 1 / 3);
});

test("CER: one deletion scores 1/N where N = max(len)", () => {
  // "一二三" vs "一二" — one deletion, max length 3.
  assert.equal(computeCER("一二三", "一二"), 1 / 3);
});

test("CER: Latin letters, digits, and CJK each count as one token", () => {
  // "A1中" → 3 tokens. One substitution at the digit → CER 1/3.
  assert.equal(computeCER("A1中", "A2中"), 1 / 3);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("CER: both empty scores 0", () => {
  assert.equal(computeCER("", ""), 0);
});

test("CER: empty reference + non-empty candidate scores 1", () => {
  assert.equal(computeCER("", "abc"), 1);
});

test("CER: non-empty reference + empty candidate scores 1", () => {
  assert.equal(computeCER("abc", ""), 1);
});

// ---------------------------------------------------------------------------
// Tokenization introspection
// ---------------------------------------------------------------------------

test("normalizeForCer: returns single-codepoint tokens after the normalization pipeline", () => {
  const tokens = normalizeForCer("  一二\n  三  ");
  assert.deepEqual(tokens, ["一", "二", " ", "三"]);
});

test("normalizeForCer: preserves Latin case and punctuation forms", () => {
  const tokens = normalizeForCer("Aa，,");
  assert.deepEqual(tokens, ["A", "a", "，", ","]);
});
