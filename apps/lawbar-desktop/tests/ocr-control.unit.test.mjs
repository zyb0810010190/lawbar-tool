// The control's SEMANTICS (product plan R3, WI-12).
//
// This suite guards the part that was measured rather than designed. Fifteen blind lines, selected
// by `a.strip() === b.strip()` and typed by the owner from the image alone, came back fifteen of
// fifteen. Every assertion below exists so that rule cannot drift into a looser one that the 15/15
// result would not cover — and a looser one is the tempting mistake, because folding full-width
// digits together would raise the agreement rate and quietly lower what agreement is worth.
//
// The second thing it guards is the difference between "the two engines read this differently" and
// "the two engines never compared this line". Collapsing those was a real defect, found by running
// the committed rule over 26 pages of the real corpus: it marked 1440 of 1710 lines as read
// differently and made all 26 pages read as disputed. Several tests below exist only to keep that
// distinction, and they name it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { agrees, compareLines, pairByPosition, sameRow } from "../dist/src/ocr/control.js";

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
  //
  // The price of that strictness is now measured rather than assumed: of 486 lines both engines saw
  // as one line, 27 differed ONLY by these forms and 29 only by whitespace inside the reading. All
  // 56 land on the disagreed side, which is the safe direction and the only one the evidence covers.
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

test("the same ROW is not the same as overlapping boxes, and the two axes mean different things", () => {
  const line = { text: "a", x: 0.1, y: 0.5, w: 0.8, h: 0.04 };
  assert.equal(sameRow(line, line), true, "a line is its own row");
  assert.equal(sameRow(line, { text: "b", x: 0.1, y: 0.6, w: 0.8, h: 0.04 }), false, "a different row is a different line");
  assert.equal(sameRow(line, { text: "b", x: 0.95, y: 0.5, w: 0.04, h: 0.04 }), false,
    "same row, but sharing none of the same column");
  // The whole reason for the vertical rule. This box hangs down into the line's band and would count
  // as touching under any intersection test, but its middle is above the line's top: it is the row
  // above, with generous padding, and calling it a candidate is what flooded the corpus.
  const above = { text: "b", x: 0.1, y: 0.535, w: 0.8, h: 0.02 };
  assert.ok(above.y < line.y + line.h, "the fixture must actually overlap, or it tests nothing");
  assert.equal(sameRow(line, above), false);
  assert.equal(sameRow(above, line), false, "and it is symmetric — a row is a row from either side");

  // EITHER direction counts, and only a nested pair can show it. A short box sitting inside a tall
  // one has its centre inside the tall box while the tall box's centre is nowhere near the short
  // one — so exactly one of the two containments holds. It must still be a candidate: it is part of
  // that line, and a rule that dropped it let a FRAGMENT pair uniquely and be reported as agreed.
  // Asserting BOTH orders kills either half of the disjunction on its own.
  const tall = { text: "region", x: 0.1, y: 0.2, w: 0.8, h: 0.1 };
  const short = { text: "part of it", x: 0.1, y: 0.21, w: 0.8, h: 0.02 };
  assert.equal(short.y + short.h / 2 > tall.y && short.y + short.h / 2 < tall.y + tall.h, true,
    "the short box's centre must really be inside the tall one, or the fixture proves nothing");
  assert.equal(tall.y + tall.h / 2 < short.y + short.h, false, "and the tall box's centre must not");
  assert.equal(sameRow(tall, short), true);
  assert.equal(sameRow(short, tall), true, "and it is symmetric — a row is a row from either side");
});

test("a FRAGMENT set slightly lower than its number is still a candidate, so it still blocks", () => {
  // Found by audit against the first version of this file, which required BOTH centres to be inside
  // the other box. Reproduced exactly: the unit is set lower than the number, so the primary's
  // centre lands on the unit box's lower EDGE and the strict comparison excluded it. The number then
  // became the only candidate, the pairing was one to one, and an amount that has lost its unit came
  // back AGREED — the single outcome this file exists to prevent, reachable by moving one box by a
  // thirty-second of a page.
  const primary = [{ text: "10000", x: 0.125, y: 0.5, w: 0.5, h: 0.0625 }];
  const control = [
    { text: "10000", x: 0.125, y: 0.5, w: 0.3125, h: 0.0625 },
    { text: "万元", x: 0.4375, y: 0.53125, w: 0.1875, h: 0.03125 },
  ];
  assert.equal(primary[0].y + primary[0].h / 2, control[1].y,
    "the fixture must sit exactly on the boundary, or it is not the case that was found");
  assert.ok(control.every((c) => sameRow(primary[0], c)), "both pieces must be candidates");
  assert.deepEqual(compareLines(primary, control), ["uncompared"]);
});

test("an exactly-half overlap is NOT one line, because admitting it would manufacture agreement", () => {
  // Every coordinate here is a dyadic fraction, so the arithmetic is exact in binary and the fixture
  // really does sit on the boundary — an earlier version used 0.55 and 0.10 and missed it by one
  // unit in the last place, which would have made this test pass against either rule.
  //
  // Two boxes overlapping by exactly half their height: each centre lands precisely on the other's
  // edge. Admitting that as the same row adds a candidate, and here it is the ONLY candidate — so
  // the pairing becomes unique and the line is reported AGREED on geometry that says nothing. That
  // is why the comparison is strict: at the boundary, refusing costs a confirmation, and admitting
  // invents one. A mutant loosening it to >= and <= turns the last assertion into "agreed".
  const lower = { text: "甲", x: 0.1, y: 0.5, w: 0.8, h: 0.125 };
  const upper = { text: "甲", x: 0.1, y: 0.5625, w: 0.8, h: 0.125 };
  assert.equal(lower.y + lower.h / 2, upper.y, "the fixture must sit exactly on the edge");
  assert.equal(upper.y + upper.h / 2, lower.y + lower.h, "and so must the other side");
  assert.equal(sameRow(lower, upper), false);
  assert.equal(sameRow(upper, lower), false);
  assert.deepEqual(compareLines([lower], [upper]), ["uncompared"],
    "the boxes overlap, so the control DID read here — it just did not read this line");
});

test("an EMPTY reading is not a reading: a box around nothing does not count as the control looking", () => {
  // `agrees` already refuses two empty strings, and `asLines` permits an empty text with a valid
  // box, so an engine that finds a text region and reads nothing from it is reachable. Treating that
  // box as coverage turns "one engine saw text where the other saw none" — which belongs in front of
  // the owner — into "the engines divided the page differently", which does not.
  const primary = [at(0, "被告应支付违约金")];
  assert.deepEqual(compareLines(primary, [at(0, "")]), ["disagreed"]);
  assert.deepEqual(compareLines(primary, [at(0, "   ")]), ["disagreed"], "whitespace is not a reading either");
  // And it must not make a real counterpart ambiguous: the empty box is not a candidate at all.
  assert.deepEqual(compareLines(primary, [at(0, ""), at(0, "被告应支付违约金")]), ["agreed"]);
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
  //
  // It is UNCOMPARED rather than DISAGREED: the second engine did read this part of the page, and
  // what it produced cannot be set against this line. Saying the readings differ would be a claim
  // about the text that nothing here supports.
  const primary = [{ text: "10000", x: 0.125, y: 0.5, w: 0.5, h: 0.0625 }];
  const control = [
    { text: "10000", x: 0.125, y: 0.5, w: 0.3125, h: 0.0625 },
    { text: "万元", x: 0.4375, y: 0.5, w: 0.1875, h: 0.0625 },
  ];
  assert.ok(control.every((c) => sameRow(primary[0], c)), "the fixture must actually tempt a looser rule");
  assert.deepEqual(compareLines(primary, control), ["uncompared"]);
});

test("a MERGE is refused from the other side too: one control line covering two primary lines", () => {
  const merged = { text: "第一行第二行", x: 0.1, y: 0.845, w: 0.8, h: 0.11 };
  const primary = [at(0, "第一行"), at(1, "第二行")];
  assert.deepEqual(compareLines(primary, [merged]), ["uncompared", "uncompared"],
    "neither line has been shown to say what the other engine read");
});

test("a control line that covers TWO primary lines matches NEITHER, even where its text matches one", () => {
  // The claimants check earns its place only here. Where the merged control line's text DISAGREES
  // with both rows, dropping that check changes nothing — so the merge test above cannot see it.
  // Give the merged line text that exactly matches the first row and the check becomes the whole
  // difference between "agreed" and the truth: the second engine did not read this row on its own.
  const primary = [at(0, "本院经审理查明"), at(1, "被告应支付违约金")];
  const spanning = { text: "本院经审理查明", x: 0.1, y: 0.845, w: 0.8, h: 0.11 };
  assert.deepEqual(compareLines(primary, [spanning]), ["uncompared", "uncompared"],
    "a counterpart shared with another line is not a counterpart");
});

test("ONE control line on the same row as TWO primary cells matches neither — the table case", () => {
  // This is not a hypothetical: it is what the two engines actually do to a table. Measured over the
  // real corpus, Vision emits a box per CELL (median width 0.062 of the page) where PaddleOCR emits
  // a box per ROW (0.88 to 0.96), and 111 of the unpaired lines on the pilot pages were cells
  // sharing one row box. Both cells are genuinely on the row's line, so `hits.length` is 1 for each
  // and only the claimants check refuses them — a mutant that dropped it survived every other test
  // in this file, and shipped it would report the LEFT cell as agreed while the row also carries a
  // right-hand cell the reader is never told about.
  const primary = [
    { text: "赔偿金额", x: 0.10, y: 0.5, w: 0.25, h: 0.03 },
    { text: "12,345.67元", x: 0.40, y: 0.5, w: 0.35, h: 0.03 },
  ];
  const row = [{ text: "赔偿金额", x: 0.10, y: 0.5, w: 0.65, h: 0.03 }];
  assert.ok(primary.every((c) => sameRow(c, row[0])), "both cells must really be on the row, or the fixture is idle");
  assert.deepEqual(pairByPosition(primary, row), [-1, -1]);
  assert.deepEqual(compareLines(primary, row), ["uncompared", "uncompared"],
    "a row box shared with another cell is not this cell's counterpart, however exactly its text matches");
});

test("a line the second engine found NOTHING on is DISAGREED — that one really is a difference", () => {
  // The control RAN over this page and produced no reading on this row. One engine seeing text where
  // the other sees none is a difference between two readings, and the reader's eye should go to it.
  // This is the one unpaired case that is NOT `uncompared`, and the distinction is the point:
  // `uncompared` means the engines divided the page differently, not that one of them saw blank.
  const primary = [at(0, "被告应支付违约金")];
  assert.deepEqual(compareLines(primary, []), ["disagreed"]);
  assert.deepEqual(compareLines(primary, [at(3, "别处的字")]), ["disagreed"],
    "a control line somewhere else on the page is still nothing on THIS row");
});

test("UNCOMPARED and DISAGREED are different answers, and a page produces both", () => {
  // The defect this file was rewritten for. Every line here is unpaired or differing, and an
  // implementation that collapses the two would return one word for all four — which is what the
  // real corpus produced: 1440 of 1710 lines marked "read differently", all 26 pages disputed.
  const primary = [at(0, "本院经审理查明"), at(1, "赔偿12,345.67元"), at(2, "第三行甲"), at(3, "无人读到")];
  const control = [
    at(0, "本院经审理查明"),
    at(1, "赔偿12,345.87元"),
    // Row 2 split in two by the second engine: both are genuinely on that row (y 0.78), so the
    // correspondence is ambiguous rather than absent. Row 3 gets nothing at all.
    { text: "第三行", x: 0.1, y: 0.78, w: 0.4, h: 0.05 },
    { text: "甲", x: 0.5, y: 0.78, w: 0.4, h: 0.05 },
  ];
  assert.deepEqual(compareLines(primary, control), ["agreed", "disagreed", "uncompared", "disagreed"]);
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
  // Two control lines can share a primary line's row equally — a second engine that split one line
  // into halves does exactly that. Which one wins must not depend on iteration order, or the same
  // page would get different verdicts on different runs and neither would be reproducible.
  const primary = [{ text: "甲乙", x: 0.0, y: 0.5, w: 0.4, h: 0.1 }];
  const left = { text: "甲乙", x: -0.1, y: 0.5, w: 0.4, h: 0.1 };
  const right = { text: "丙丁", x: 0.1, y: 0.5, w: 0.4, h: 0.1 };
  assert.ok(sameRow(primary[0], left) && sameRow(primary[0], right), "the fixture must actually tie");
  // NEITHER wins. An earlier version picked the first and therefore gave opposite verdicts for the
  // two orderings — which contradicted the reproducibility this test claims to be about. Two
  // candidates means the correspondence is not one to one, and that is the whole answer.
  assert.deepEqual(compareLines(primary, [left, right]), ["uncompared"]);
  assert.deepEqual(compareLines(primary, [right, left]), ["uncompared"],
    "the same page must give the same verdict whichever order the engine emitted its lines in");
});

test("a second candidate on the same row does not become agreement just because one of them matches", () => {
  // The assertions above could all be satisfied by taking the FIRST candidate rather than requiring
  // an unambiguous one. Here one candidate disagrees and the other matches exactly, both genuinely
  // on this row — and the right answer is still neither, because two candidates is not a
  // correspondence.
  //
  // The earlier version of this fixture used a box that merely grazed the line's padding. Under the
  // row rule that box is the row above and stops being a candidate at all, so the fixture would have
  // passed while testing nothing. It was rebuilt rather than deleted, and rather than edited to
  // match the new output: both halves must be real candidates for the ambiguity to be real.
  const primary = [{ text: "本院经审理查明", x: 0.1, y: 0.5, w: 0.8, h: 0.05 }];
  const other = { text: "别的字", x: 0.1, y: 0.505, w: 0.3, h: 0.04 };
  const exact = { text: "本院经审理查明", x: 0.45, y: 0.505, w: 0.45, h: 0.04 };
  assert.ok(sameRow(primary[0], other) && sameRow(primary[0], exact), "both must really be on this row");
  assert.deepEqual(compareLines(primary, [other, exact]), ["uncompared"]);
  assert.deepEqual(compareLines(primary, [exact, other]), ["uncompared"]);
});
