// The different-engine control: what agreement means, and which lines are compared (R3, WI-12).
//
// This file holds the SEMANTICS of the control and nothing else — no engine, no process, no store.
// It exists separately because the semantics are the part that was MEASURED, and the part that a
// later engine swap must not quietly change.
//
// WHAT WAS MEASURED, and therefore what is implemented here:
//
//   • Fifteen lines were cropped from documents the first round never used, kept ONLY where the two
//     engines agreed, and served to the owner with no proposal shown. He typed all fifteen from the
//     image alone. Fifteen of fifteen exact, mean character error 0.000.
//   • The rule that selected those fifteen was `a.strip() === b.strip()` — trimmed, and otherwise
//     BYTE-EXACT. Not NFKC-folded. The bake-off folds for its error METRIC, and the two are
//     different questions: folding would make 12345 and １２３４５ agree, and full-width digits in a
//     case number or an amount are precisely where this engine is least reliable (0.31 character
//     error at six characters or fewer). Shipping a looser rule than the one that was validated
//     would accept pairs the evidence never covered.
//   • Zero failures in fifteen trials bounds the true failure rate near ONE IN FIVE at 95%
//     confidence. So agreement PRIORITISES the owner's attention. It never certifies, and nothing
//     built on this file may say that it does.
//
// WHICH LINES ARE COMPARED. Two engines segment a page differently, so pairing them by index is a
// hope, not a method: one engine merging two columns shifts every later line, and every comparison
// after it is meaningless. They are paired by POSITION, and only where the correspondence is
// UNAMBIGUOUS — one control line on this primary line's row, and that control line on no other
// primary line's row. Anything less strict marks a fragment as a whole line; see `pairByPosition`
// for the reproduced case, which is an amount that loses its unit and is then reported as agreed.
//
// SAME ROW IS NOT THE SAME AS OVERLAPPING BOXES, and the difference was measured. An earlier version
// of this file treated any box intersection as evidence of correspondence. Run against 26 pages of
// the real corpus — 1710 Vision lines against 882 PaddleOCR lines, both engines given the identical
// 150-dpi render so that rendering differences could not be mistaken for recognition differences —
// that rule paired 20% of lines and left 84% carrying a verdict the panel words as "the second
// engine read a different result". That sentence was false for almost all of them, and it made every
// one of the 26 pages read as disputed. `sameRow` is what replaced it, and the same corpus says the
// stricter-looking rule is also the more generous one: it pairs 28% of lines rather than 20%.
//
// No threshold appears anywhere in this file. A minimum overlap would be a number this project has
// no measurement for, and every rule here is chosen so that none is needed.

/** A line to compare: its text, and where it sits on the render. */
export interface ControlLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What the control can say about one line.
 *
 * `uncompared` is the verdict this file exists to make possible. It is not a softer `disagreed`: it
 * says the second engine ran and did not divide the page the way the first one did, so these two
 * readings were never set against each other. Reporting that as a disagreement is the difference
 * between a control that directs the owner's eye and one that flags the whole page — measured on the
 * real corpus at 109 lines the engines genuinely read differently against 1215 they never compared.
 */
export type ControlVerdict = "agreed" | "disagreed" | "uncompared";

/**
 * The characters Python's `str.strip()` removes, which is NOT the set JavaScript's `trim()` removes.
 *
 * This matters because the selection rule that produced the 15/15 result was Python. The two sets
 * disagree at both ends: `trim()` removes U+FEFF and `strip()` does not, so a byte-order mark would
 * make two different readings agree here and not there; `strip()` removes U+0085 and U+001C–U+001F
 * and `trim()` does not, so those would make two identical readings disagree. Both were reproduced.
 * Writing the set out is the only way the word "copied" in the header above is true.
 */
const PY_STRIP = /^[\t\n\v\f\r \u001c-\u001f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u001c-\u001f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;

/** Trim exactly as the measurement's Python did. */
const strip = (s: string): string => s.replace(PY_STRIP, "");

/**
 * Do two readings of the same line agree?
 *
 * Stripped, then exact. This is the rule the blind round used to select its fifteen lines, copied
 * deliberately rather than reinvented: any normalisation added here would accept pairs the 15/15
 * result does not cover. Two empty readings are NOT agreement — there is nothing to agree about,
 * and calling it agreement would let a page both engines failed to read look confirmed. (That last
 * clause is a restriction the Python rule did not need, because it only ever saw non-empty crops.)
 *
 * It stays strict even though the cost of that is now measured. Of 486 lines both engines saw as one
 * line, 29 differed only by whitespace inside the reading and 27 only by half-width against
 * full-width forms. Those 56 fall on the disagreed side and should: PaddleOCR emits five times the
 * internal spaces Vision does, so the whitespace difference is a one-sided artifact of the engine
 * rather than a property of the page, and closing it would need its own blind round instead of a
 * normalisation applied here on the strength of nothing.
 */
export function agrees(a: string, b: string): boolean {
  const left = strip(a);
  const right = strip(b);
  return left.length > 0 && left === right;
}

/**
 * Are these two boxes on the same LINE OF THE PAGE?
 *
 * Horizontally they must overlap at all: how a line is divided across the page is exactly what the
 * two engines disagree about, and any horizontal rule stricter than "they share some of the same
 * column" would start deciding which division is right. Vertically it is enough that EITHER box's
 * centre falls inside the other's extent, which is what makes this a statement about rows: a box
 * whose middle sits above another box's top is a different line of text, however far its padding
 * reaches down, while a box sitting inside another's band is part of that same line.
 *
 * The two axes are treated differently because they mean different things, and the measurement says
 * so. The hypothesis that Vision simply draws taller boxes was tested and is false — median line
 * height 0.0230 against PaddleOCR's 0.0231, ratio 1.00. What actually differs is division: on the
 * table pages of the corpus Vision emits a box per CELL, median width 0.062 of the page, where
 * PaddleOCR emits a box per ROW at 0.88 to 0.96. Requiring mere intersection let a box that grazes
 * the next row's padding count as a candidate; a centre inside the other's band does not, and needs
 * no threshold to say it.
 *
 * WHY EITHER DIRECTION AND NOT BOTH. Requiring both was the first version and it let the fragment
 * back in, which is the one thing this file exists to refuse. Found by audit, reproduced: a unit set
 * slightly lower than its number — control boxes `10000` at y 0.5 h 0.0625 and the unit at y 0.53125
 * h 0.03125, against a primary covering the whole field — has the primary's centre exactly on the
 * unit box's lower edge. With both directions required the unit is not a candidate, the number is
 * the ONLY candidate, the pairing is one to one, and an amount that has lost its unit is reported
 * AGREED. Uniqueness cannot establish correspondence unless every box that is part of the line is a
 * candidate for it. Either direction makes it so: the shorter box's centre lies in the taller one's
 * band whenever one is nested in the other, so both fragments count and the pairing is ambiguous —
 * which is the truth about it.
 *
 * PRECONDITION: real boxes, normalised to the page. `asLines` in helper.ts refuses a line whose w or
 * h is not positive, whose x/y/w/h fall outside 0..1, or whose x+w or y+h exceeds the page, so a
 * zero-area or off-page box cannot reach here through the helper. This function does not re-check
 * it, and on a degenerate box its answer is not meaningful.
 */
export function sameRow(a: ControlLine, b: ControlLine): boolean {
  // STRICT at the edges, and that is a decision rather than an accident. Two boxes overlapping by
  // exactly half their height have each centre sitting precisely on the other's edge, and nothing
  // about the page says they are one line. Admitting that case adds a CANDIDATE, and a candidate is
  // not always more caution: where a line has no other, it turns an absent correspondence into a
  // unique one, and a pair that was `uncompared` becomes `agreed` — less of the owner's attention,
  // not more, on the most ambiguous geometry there is. (An earlier version of this comment argued
  // the opposite and was wrong; the case above is the counterexample.) Strict refuses it, which
  // costs at most a confirmation and never manufactures one.
  const centreInside = (inner: ControlLine, outer: ControlLine): boolean => {
    const centre = inner.y + inner.h / 2;
    return centre > outer.y && centre < outer.y + outer.h;
  };
  return overlaps(a, b) && (centreInside(a, b) || centreInside(b, a));
}

/**
 * Did this engine actually read something here?
 *
 * An empty reading is not a reading — `agrees` already says so, refusing two empty strings as
 * agreement — and a box around no characters must not count as the control having covered this part
 * of the page. Without this, a control that emitted a text region it could not read anything from
 * would turn "one engine saw text where the other saw none", which belongs in front of the owner,
 * into "the engines divided the page differently", which does not. `asLines` permits an empty text
 * with a valid box, so this is reachable rather than theoretical.
 */
const hasReading = (l: ControlLine): boolean => strip(l.text).length > 0;

/**
 * Do these two boxes cover any of the same page at all?
 *
 * This is deliberately the weakest question in the file, and it answers only one thing: did the
 * second engine read ANYTHING where this line sits? It is not evidence that two boxes are the same
 * line — treating it as that is the rule this file replaced — but its negation is evidence, and the
 * only evidence there is for "the control found nothing here".
 */
function overlaps(a: ControlLine, b: ControlLine): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
    && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
}

/**
 * Pair each primary line with the control line that is UNAMBIGUOUSLY the same line.
 *
 * One to one in the same-row graph: a primary line is paired only when exactly one control line
 * shares its row AND that control line shares its row with exactly this one primary line. Returns an
 * index into `control` for each primary line, or -1 where the correspondence is not one to one.
 *
 * WHY NOT "BEST OVERLAP". Best-overlap pairing marks a FRAGMENT as a whole line, and it does so on
 * exactly the field that matters. Reproduced: the primary reads an amount without its unit while
 * keeping the whole field's box; the control reads the number and the unit as two lines. The number
 * fragment wins on overlap (0.625 against 0.375), the texts match character for character, and the
 * line is reported AGREED — while the page actually carries a unit the reader is never shown. The
 * blind round compared whole line against whole line on the same crop; agreement between spans that
 * are not the same span was never measured, and must not be claimed.
 *
 * Loosening this was measured and buys almost nothing. Best-mutual-overlap pairs 64% of lines
 * against 45% on the same pages and finds 95 agreements where this rule finds 93 — so 41 extra
 * pairs buy TWO extra agreements, and the other 39 are disagreements. The strictness is not what is
 * costing the owner his confirmations; it costs two of them, and it is what keeps a fragment from
 * being reported as a whole line. Comparing the whole shared SPAN instead — connected components of
 * the graph, each side joined in reading order — was measured too, at 23% against 22%, and it would
 * require inventing a separator for the join that no measurement supports. Both were refused on the
 * numbers rather than on taste.
 *
 * NO THRESHOLD ANYWHERE. A minimum overlap would be a number this project has no measurement for.
 * Degree in the same-row graph needs none, and it errs toward MORE of the owner's attention, never
 * less: where two engines did not divide the page the same way, nothing is marked agreed.
 */
export function pairByPosition(
  primary: readonly ControlLine[],
  control: readonly ControlLine[],
): readonly number[] {
  const rows = primary.map((p) => control.map((c) => hasReading(c) && sameRow(p, c)));
  return primary.map((_, i) => {
    const row = rows[i]!;
    const hits = row.flatMap((t, j) => (t ? [j] : []));
    if (hits.length !== 1) return -1;
    const j = hits[0]!;
    // And from the control line's side: it must see only this one.
    const claimants = rows.reduce((n, r) => n + (r[j] === true ? 1 : 0), 0);
    return claimants === 1 ? j : -1;
  });
}

/**
 * A verdict for every primary line.
 *
 * Three outcomes, and the third one is the point. A line the control read differently is
 * `disagreed`; a line the control covered but did not divide the same way is `uncompared`; and a
 * line the control's boxes do not touch at all is `disagreed`, because one engine seeing text where
 * the other sees none IS a difference between two readings and belongs in front of the owner.
 *
 * The distinction is not a nicety. Collapsing `uncompared` into `disagreed` was what the previous
 * version did, and on 26 pages of the real corpus it marked 1440 of 1710 lines as read differently
 * and made all 26 pages read as disputed — the failure that disqualified a page-level control,
 * reproduced at line level. Split three ways on the same pages: 386 agreed, 109 disagreed, 1215
 * uncompared, a median of FOUR lines per page for the owner's eye instead of fifty-five.
 *
 * `unchecked` is not produced here at all. It means no control ran, which is a fact about the run
 * rather than about the line, and it is the caller's to record.
 */
export function compareLines(
  primary: readonly ControlLine[],
  control: readonly ControlLine[],
): readonly ControlVerdict[] {
  const pairs = pairByPosition(primary, control);
  return primary.map((p, i) => {
    const j = pairs[i] ?? -1;
    if (j >= 0) return agrees(p.text, control[j]!.text) ? "agreed" : "disagreed";
    // Not paired, and the two cases are not the same fact. If the control read nothing that touches
    // this line at all, one engine saw text where the other saw none, and that IS a difference
    // between two readings. If it read something here that is not this line's row — a box spanning
    // two rows has its centre between them and belongs to neither — then the engines divided the
    // page differently, and saying they disagree would be a claim about the text that nothing
    // supports. The weaker test is the right one for the weaker question.
    return control.some((c) => hasReading(c) && overlaps(p, c)) ? "uncompared" : "disagreed";
  });
}
