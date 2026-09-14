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
// UNAMBIGUOUS — one control line overlapping this primary line, and that control line overlapping
// no other. Anything less strict marks a fragment as a whole line; see `pairByPosition` for the
// reproduced case, which is an amount that loses its unit and is then reported as agreed.
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

export type ControlVerdict = "agreed" | "disagreed";

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
 */
export function agrees(a: string, b: string): boolean {
  const left = strip(a);
  const right = strip(b);
  return left.length > 0 && left === right;
}

/** Intersection over union of two boxes. 0 when they do not overlap. */
export function overlap(a: ControlLine, b: ControlLine): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Pair each primary line with the control line that is UNAMBIGUOUSLY the same line.
 *
 * One to one in the overlap graph: a primary line is paired only when exactly one control line
 * overlaps it AND that control line overlaps exactly this one primary line. Returns an index into
 * `control` for each primary line, or -1 where the correspondence is not one to one.
 *
 * WHY NOT "BEST OVERLAP". Best-overlap pairing marks a FRAGMENT as a whole line, and it does so on
 * exactly the field that matters. Reproduced: the primary reads an amount without its unit while
 * keeping the whole field's box; the control reads the number and the unit as two lines. The number
 * fragment wins on overlap (0.625 against 0.375), the texts match character for character, and the
 * line is reported AGREED — while the page actually carries a unit the reader is never shown. The
 * blind round compared whole line against whole line on the same crop; agreement between spans that
 * are not the same span was never measured, and must not be claimed.
 *
 * NO THRESHOLD ANYWHERE. A minimum overlap would be a number this project has no measurement for.
 * Degree in the overlap graph needs none, and it errs toward MORE of the owner's attention, never
 * less: where two engines did not see the same lines, nothing is marked agreed.
 */
export function pairByPosition(
  primary: readonly ControlLine[],
  control: readonly ControlLine[],
): readonly number[] {
  const touches = primary.map((p) => control.map((c) => overlap(p, c) > 0));
  return primary.map((_, i) => {
    const row = touches[i]!;
    const hits = row.flatMap((t, j) => (t ? [j] : []));
    if (hits.length !== 1) return -1;
    const j = hits[0]!;
    // And from the control line's side: it must see only this one.
    const claimants = touches.reduce((n, r) => n + (r[j] === true ? 1 : 0), 0);
    return claimants === 1 ? j : -1;
  });
}

/**
 * A verdict for every primary line.
 *
 * A line with no unambiguous counterpart is DISAGREED, not unchecked. The second engine ran over
 * this page; either it found nothing there, or it did not divide the page the same way, and in
 * both cases the two readings have not been shown to say the same thing. That is a reason for the
 * reader's eye to go there. `unchecked` means no control ran at all, which is a fact about the run
 * rather than about the line, and it is the caller's to record.
 */
export function compareLines(
  primary: readonly ControlLine[],
  control: readonly ControlLine[],
): readonly ControlVerdict[] {
  const pairs = pairByPosition(primary, control);
  return primary.map((p, i) => {
    const j = pairs[i] ?? -1;
    if (j < 0) return "disagreed";
    return agrees(p.text, control[j]!.text) ? "agreed" : "disagreed";
  });
}
