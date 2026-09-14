// The control's SEMANTICS (product plan R3, WI-12).
//
// This suite guards the part that was measured rather than designed. Fifteen blind lines, selected
// by `a.strip() === b.strip()` and typed by the owner from the image alone, came back fifteen of
// fifteen. Every assertion below exists so that rule cannot drift into a looser one that the 15/15
// result would not cover — and a looser one is the tempting mistake, because folding full-width
// digits together would raise the agreement rate and quietly lower what agreement is worth.

import { test } from "node:test";
import assert from "node:assert/strict";

import { agrees, compareLines, overlap, pairByPosition } from "../dist/src/ocr/control.js";

/** A line at a given row of the page, so a test reads as a page rather than as coordinates. */
const at = (row, text, over = {}) => ({ text, x: 0.1, y: 0.9 - row * 0.06, w: 0.8, h: 0.05, ...over });

// ---------------------------------------------------------------------------
// What agreement is
// ---------------------------------------------------------------------------

test("agreement is TRIMMED and otherwise EXACT — the rule the blind round actually used", () => {
  assert.equal(agrees("本院经审理查明", "本院经审理查明"), true);
  assert.equal(agrees("  本院经审理查明 ", "本院经审理查明"), true, "leading and trailing space is not a difference");
  assert.equal(agrees("本院经审理查明", "本院经审理查朗"), false, "one character apart is not agreement");
});

test("agreement is NOT folded: full-width and half-width digits are DIFFERENT readings", () => {
  // The bake-off folds with NFKC for its error METRIC, and that is a different question. Folding
  // here would make these agree — and a case number or an amount in full-width digits is exactly
  // the short field where this engine is least reliable, 0.31 character error at six characters or
  // fewer. A rule looser than the one that was validated accepts pairs the evidence never covered.
  assert.equal(agrees("12345", "１２３４５"), false);
  assert.equal(agrees("（2024）", "(2024)"), false);
  assert.equal(agrees("１０万元", "10万元"), false);
  // Nor any OTHER normalisation. NFC would pass the three assertions above while still changing the
  // rule, and dropping internal whitespace would too — so both are refused by name.
  assert.equal(agrees("e\u0301", "\u00e9"), false, "a combining acute is not the precomposed letter");
  assert.equal(agrees("1 000", "1000"), false, "internal whitespace is part of the reading");
});

test("stripping is PYTHON's, because Python is what selected the fifteen", () => {
  // The two sets genuinely differ, and both directions were reproduced against the real functions.
  // A byte-order mark: JavaScript's trim() removes it, Python's strip() does not — so trim() would
  // make two DIFFERENT readings agree.
  assert.equal(agrees("\ufeff本院", "本院"), false);
  // U+0085 and U+001C-001F: Python removes them, JavaScript does not — so trim() would make two
  // IDENTICAL readings disagree.
  assert.equal(agrees("\u0085本院", "本院"), true);
  assert.equal(agrees("\u001c本院\u001f", "本院"), true);
});

test("two empty readings are NOT agreement", () => {
  // Otherwise a page both engines failed to read would come back looking confirmed.
  assert.equal(agrees("", ""), false);
  assert.equal(agrees("   ", "\t\n"), false, "REAL whitespace; an earlier version of this line held literal backslashes and tested nothing");
  assert.equal(agrees("", "\t"), false);
  assert.equal(agrees("", "本院"), false);
});

// ---------------------------------------------------------------------------
// Which lines are compared
// ---------------------------------------------------------------------------

test("overlap is intersection over union, and boxes that do not touch score zero", () => {
  const a = { text: "a", x: 0, y: 0, w: 1, h: 1 };
  assert.equal(overlap(a, a), 1, "a box overlaps itself completely");
  assert.equal(overlap(a, { text: "b", x: 2, y: 2, w: 1, h: 1 }), 0, "disjoint boxes do not overlap");
  // Half of one inside the other: intersection 0.5, union 1.5.
  assert.ok(Math.abs(overlap(a, { text: "b", x: 0.5, y: 0, w: 1, h: 1 }) - 1 / 3) < 1e-9);
});

test("lines are paired by POSITION, so a second engine that misses one does not shift every verdict after it", () => {
  // Index pairing is the tempting shortcut and it is a hope, not a method: drop the control's
  // middle line and index pairing compares line 3 against line 2 for the whole rest of the page.
  const primary = [at(0, "第一行"), at(1, "第二行"), at(2, "第三行")];
  const control = [at(0, "第一行"), at(2, "第三行")];
  assert.deepEqual(pairByPosition(primary, control), [0, -1, 1], "the missing middle costs one line, not three");
  assert.deepEqual(compareLines(primary, control), ["agreed", "disagreed", "agreed"]);
});


test("a FRAGMENT is never accepted as a whole line, however exactly its characters match", () => {
  // The case that killed best-overlap pairing, in the numbers it was reproduced with. The primary
  // reads an amount WITHOUT its unit but keeps the whole field's box; the control reads the number
  // and the unit as two lines. The number fragment wins on overlap 0.625 to 0.375 and its characters
  // match exactly — so best-overlap reported AGREED on a line that has lost its unit. For an amount
  // that is the worst possible thing to accept, and it is outside what the blind round measured:
  // that compared whole line against whole line, on the same crop.
  const primary = [{ text: "10000", x: 0.125, y: 0.5, w: 0.5, h: 0.0625 }];
  const control = [
    { text: "10000", x: 0.125, y: 0.5, w: 0.3125, h: 0.0625 },
    { text: "万元", x: 0.4375, y: 0.5, w: 0.1875, h: 0.0625 },
  ];
  assert.ok(overlap(primary[0], control[0]) > overlap(primary[0], control[1]), "the fixture must actually tempt best-overlap");
  assert.deepEqual(compareLines(primary, control), ["disagreed"]);
});

test("a MERGE is refused from the other side too: one control line covering two primary lines", () => {
  const merged = { text: "第一行第二行", x: 0.1, y: 0.845, w: 0.8, h: 0.11 };
  const primary = [at(0, "第一行"), at(1, "第二行")];
  assert.deepEqual(compareLines(primary, [merged]), ["disagreed", "disagreed"],
    "neither line has been shown to say what the other engine read");
});

test("a control line that covers TWO primary lines agrees with NEITHER, even where its text matches one", () => {
  // The claimants check earns its place only here. Where the merged control line's text DISAGREES
  // with both rows, dropping that check changes nothing — so the merge test above cannot see it.
  // Give the merged line text that exactly matches the first row and the check becomes the whole
  // difference between "agreed" and the truth: the second engine did not read this row on its own.
  const primary = [at(0, "本院经审理查明"), at(1, "被告应支付违约金")];
  const spanning = { text: "本院经审理查明", x: 0.1, y: 0.845, w: 0.8, h: 0.11 };
  assert.deepEqual(compareLines(primary, [spanning]), ["disagreed", "disagreed"],
    "a counterpart shared with another line is not a counterpart");
});

test("a line the second engine found nothing for is DISAGREED, not unchecked", () => {
  // The control RAN over this page. "Nothing there" is a difference between two readings, and the
  // reader's eye should go to it. `unchecked` is a fact about the run, not about the line.
  const primary = [at(0, "被告应支付违约金")];
  assert.deepEqual(compareLines(primary, []), ["disagreed"]);
});

test("a page where both engines read the same thing, line for line", () => {
  const lines = ["本院经审理查明", "被告应支付违约金", "如不服本判决可上诉"];
  const primary = lines.map((t, i) => at(i, t));
  const control = lines.map((t, i) => at(i, t, { x: 0.105, w: 0.79 }));
  assert.deepEqual(compareLines(primary, control), ["agreed", "agreed", "agreed"],
    "slightly different boxes are the same line; two engines never draw identical rectangles");
});

test("one line differing marks THAT line and leaves the rest alone", () => {
  // The entire reason the verdict is per line. A page-level answer would have to call this page
  // either wholly agreed or wholly disputed, and both are false.
  const primary = [at(0, "本院经审理查明"), at(1, "赔偿12,345.67元"), at(2, "如不服本判决可上诉")];
  const control = [at(0, "本院经审理查明"), at(1, "赔偿12,345.87元"), at(2, "如不服本判决可上诉")];
  assert.deepEqual(compareLines(primary, control), ["agreed", "disagreed", "agreed"]);
});

test("an empty page compares to nothing and produces no verdicts", () => {
  assert.deepEqual(compareLines([], [at(0, "第二引擎看到了字")]), []);
  assert.deepEqual(compareLines([], []), []);
});

test("the comparison does not depend on the order the engines happen to emit their lines in", () => {
  const primary = [at(0, "第一行"), at(1, "第二行"), at(2, "第三行")];
  const forwards = [at(0, "第一行"), at(1, "第二行"), at(2, "第三行")];
  const backwards = [...forwards].reverse();
  assert.deepEqual(compareLines(primary, forwards), compareLines(primary, backwards),
    "reading order is the engine's business; position is the page's");
});

test("a TIE is resolved deterministically, not by whichever the loop happened to see last", () => {
  // Two control lines can overlap a primary line equally — a second engine that split one line into
  // symmetric halves does exactly that. Which one wins must not depend on iteration order, or the
  // same page would get different verdicts on different runs and neither would be reproducible.
  const primary = [{ text: "甲乙", x: 0.0, y: 0.5, w: 0.4, h: 0.1 }];
  const left  = { text: "甲乙", x: -0.1, y: 0.5, w: 0.4, h: 0.1 };
  const right = { text: "丙丁", x: 0.1, y: 0.5, w: 0.4, h: 0.1 };
  assert.equal(overlap(primary[0], left), overlap(primary[0], right), "the fixture must actually tie");
  // NEITHER wins. An earlier version picked the first and therefore gave opposite verdicts for the
  // two orderings — which contradicted the reproducibility this test claims to be about. Two
  // candidates means the correspondence is not one to one, and that is the whole answer.
  assert.deepEqual(compareLines(primary, [left, right]), ["disagreed"]);
  assert.deepEqual(compareLines(primary, [right, left]), ["disagreed"],
    "the same page must give the same verdict whichever order the engine emitted its lines in");
});

test("a partial overlap does not become agreement just because it was seen first", () => {
  // The assertions above could all be satisfied by taking the FIRST overlapping candidate rather
  // than requiring an unambiguous one. Here the first candidate overlaps slightly and disagrees,
  // the second matches the box exactly and agrees — and the right answer is still neither, because
  // two candidates is not a correspondence.
  const primary = [at(0, "本院经审理查明")];
  const grazing = at(0, "别的字", { y: 0.895, h: 0.02 });
  const exact = at(0, "本院经审理查明");
  assert.ok(overlap(primary[0], exact) > overlap(primary[0], grazing), "the fixture must have a clear better match");
  assert.deepEqual(compareLines(primary, [grazing, exact]), ["disagreed"]);
  assert.deepEqual(compareLines(primary, [exact, grazing]), ["disagreed"]);
});
