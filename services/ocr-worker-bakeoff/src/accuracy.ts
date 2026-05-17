// Character Error Rate (CER) implementation for the engine bakeoff.
//
// =======================  NORMATIVE CER SPECIFICATION  =======================
//
// CER = Levenshtein distance / max(len(reference), len(candidate)), where
// both strings are first NORMALIZED into a sequence of single-codepoint
// "characters" according to the rules below. The result is in [0, 1+):
// 0 means perfect transcription; values above 0 penalize substitutions,
// insertions, and deletions equally.
//
// Normalization rules (applied in this order, before tokenization):
//
//   1. **Unicode NFC normalization.** Both reference and candidate are
//      passed through `String.prototype.normalize("NFC")`. This ensures
//      canonically equivalent representations (e.g. precomposed vs
//      combining-mark form) are treated as identical.
//
//   2. **Line-break unification.** Any `\r\n`, `\r`, or `\n` is replaced
//      with a single ASCII space `" "`. Line breaks are not informative
//      for CER on OCR output (the engine may or may not emit them).
//
//   3. **Whitespace-run collapse.** Any maximal run of Unicode whitespace
//      (`\s+` regex semantics) is collapsed to a single ASCII space `" "`.
//
//   4. **Edge trim.** Leading and trailing whitespace removed.
//
//   5. **NO case folding.** Latin letters stay in the case the engine
//      emitted. `A` vs `a` is a substitution and counts toward CER.
//
//   6. **NO punctuation folding.** Full-width vs half-width punctuation
//      (e.g. `，` vs `,`) is NOT normalized. Engines are judged on what
//      they actually emit; folding would hide a real character-level
//      difference.
//
//   7. **Tokenization.** After the four normalization steps, the string
//      is split into a sequence of Unicode code points via the JavaScript
//      string iterator (`Array.from(s)`). Each element of that array
//      counts as exactly one "character" for the CER calculation:
//
//        - A CJK ideograph counts as 1.
//        - An ASCII letter counts as 1.
//        - An ASCII digit counts as 1.
//        - The ASCII space (the canonical inter-token separator after
//          normalization) counts as 1.
//        - Full-width punctuation counts as 1 (per code point).
//        - Multi-codepoint emoji (e.g. ZWJ sequences) count as one per
//          code point — emoji are not expected in legal-document
//          fixtures; if they appear, this rule is conservative.
//
// Special cases:
//   - Both strings empty → CER 0.
//   - Reference empty, candidate non-empty → CER 1.0.
//   - Reference non-empty, candidate empty → CER 1.0.
//
// =============================================================================

/**
 * Normalize a string for CER comparison per the spec above. Exported so
 * harness implementations and tests can introspect the tokenization.
 */
export function normalizeForCer(s: string): string[] {
  const nfc = s.normalize("NFC");
  // Step 2: unify line breaks before run-collapse.
  const noLineBreaks = nfc.replace(/\r\n|\r|\n/g, " ");
  // Step 3: collapse whitespace runs.
  const collapsed = noLineBreaks.replace(/\s+/g, " ");
  // Step 4: trim edges.
  const trimmed = collapsed.replace(/^\s+|\s+$/g, "");
  // Step 7: split into Unicode code points.
  return Array.from(trimmed);
}

/**
 * Compute Character Error Rate. Returns a non-negative number; 0 means
 * the two strings normalize to the same sequence.
 *
 * Both edges (empty reference + empty candidate) return 0; either edge
 * empty while the other is non-empty returns 1.
 */
export function computeCER(reference: string, candidate: string): number {
  const refTokens = normalizeForCer(reference);
  const candTokens = normalizeForCer(candidate);

  if (refTokens.length === 0 && candTokens.length === 0) return 0;
  if (refTokens.length === 0 || candTokens.length === 0) return 1;

  const distance = levenshtein(refTokens, candTokens);
  // Denominator: max of the two lengths. Using reference length alone
  // can produce CER > 1 for insertion-heavy candidates and is harder to
  // average across fixtures; max keeps each fixture's score in [0, 1].
  const denom = Math.max(refTokens.length, candTokens.length);
  return distance / denom;
}

// ---------------------------------------------------------------------------
// Levenshtein over arbitrary token arrays. Two-row dynamic programming;
// O(N*M) time, O(min(N,M)) memory. Sufficient for fixture-sized inputs;
// CER on a multi-page document is a separate aggregation.
// ---------------------------------------------------------------------------

function levenshtein(a: readonly string[], b: readonly string[]): number {
  // Ensure b is the shorter array for memory.
  if (a.length < b.length) return levenshtein(b, a);
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}
