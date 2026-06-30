// a10HyperlinkDegradation.ts — A10-T2 hyperlink degradation (WI-EVIDENCE-A10-T2-HYPERLINK-DEGRADATION-00).
//
// Per docs/adr/ADR-evidence-a10-court-fileable-export.md §3/§6/§13 step 2: "every in-app link → textual
// 卷X页Y OR the matching ExportCitationFlag; bijection; never dropped/silently-wrong." This is a standalone
// apps-layer slice over the A10-T1 contract (a10CitationContract.ts) — it does NOT edit services, the
// A10-T1 module, linkHandlers, the live export IPC pipeline, or invent CanonicalExportModel.
//
// COURT-FILEABLE AUTHORITY (review-plan-mr09ymaa fix #1): the authoritative court-fileable value is the
// textual `text` (卷X页Y) OR the `flag`. `internalHref` is APP-INTERNAL, NON-AUTHORITATIVE navigation
// metadata ONLY (so named) — it MUST NOT be treated as the court-fileable authority and MUST NOT be
// rendered into final court `.docx`/PDF artifacts unless a later WI explicitly authorizes it. Court-fileable
// degradation is text-or-flag only; the href is a convenience for in-app navigation.
//
// SAFE HREF (review-plan-mr09ymaa fix #2): the href is MINTED only from the citation's own
// documentId+physicalPageIndex as `lawbar://citation/<encodeURIComponent(documentId)>/<physicalPageIndex>`
// and validated STRICTLY (not prefix-alone): exact internal scheme, single canonically-encoded doc segment
// (round-trips, no `.`/`..`/slash/backslash/control/encoded-traversal after decode), non-negative-integer
// page index. Anything that fails degrades to text-only (`internalHref: null`) — never an empty/fake/unsafe
// or external (http(s)/javascript/data/file/mailto/vbscript) href.
//
// Total + bijective: every input yields EXACTLY one of {text, optionally with internalHref} XOR {flag}.
// Deterministic (pure function; no timestamps/machine-paths/locale). Writes nothing.

import type { A10RenderedCitation, A10ExportCitationFlag } from "./a10CitationContract.js";
import { A10CitationContractError } from "./a10CitationContract.js";

/** The app-internal citation-navigation scheme. NON-authoritative; never a court-fileable artifact href. */
export const INTERNAL_CITATION_SCHEME = "lawbar://citation/" as const;

export interface A10HyperlinkCitation {
  readonly linkId: string;
  readonly citationFormatVersion: A10RenderedCitation["citationFormatVersion"];
  readonly exportTemplateVersion: A10RenderedCitation["exportTemplateVersion"];
  /** Court-fileable authority — the 卷X页Y text. `null` iff the citation degraded to a `flag`. */
  readonly text: string | null;
  /**
   * APP-INTERNAL, NON-AUTHORITATIVE navigation metadata only (never the court-fileable authority; never
   * auto-rendered into court artifacts). Non-null ONLY when `text` is non-null AND a safe internal href
   * could be minted; otherwise `null` (text-only degradation).
   */
  readonly internalHref: string | null;
  /** The explicit degradation flag — `null` iff a (clean) `text` is present. */
  readonly flag: A10ExportCitationFlag | null;
}

function isNonNegativeSafeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

// Control + format + bidi/zero-width/separator chars that have no place in an opaque documentId and could
// produce a misleading/invisible href: C0 (\u0000-\u001f), DEL (\u007f), C1 (\u0080-\u009f), Arabic letter
// mark (\u061c), zero-width + LRM/RLM (\u200b-\u200f), line/paragraph separators (\u2028 \u2029), bidi
// embeds/overrides (\u202a-\u202e), word-joiner/invisible-ops/bidi-isolates/deprecated-format (\u2060-\u206f),
// BOM/ZWNBSP (\ufeff), and interlinear-annotation controls (\ufff9-\ufffb).
const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

// Iteratively percent-decode until stable (or malformed), so a DOUBLE- (or N-) encoded traversal/separator
// (e.g. `%252e%252e` -> `%2e%2e` -> `..`) cannot hide behind a single decode + canonical round-trip.
// FAIL-CLOSED: returns null on malformed encoding OR if any percent-escape still remains after the bounded
// loop (an over-deeply-nested or non-resolving input is hostile, never a legit minted href — mint encodes
// a documentId exactly once, so a valid href fully resolves in 1-2 passes). The caller treats null as unsafe.
function fullyPercentDecode(s: string): string | null {
  let cur = s;
  for (let i = 0; i < 8 && /%[0-9a-fA-F]{2}/.test(cur); i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return null; // malformed percent-encoding at some depth
    }
    if (next === cur) break; // no further decoding possible
    cur = next;
  }
  // Any surviving percent-escape (over-depth / stable-with-escape) -> fail closed.
  return /%[0-9a-fA-F]{2}/.test(cur) ? null : cur;
}

// A fully-decoded doc segment must not be a dot-segment, contain a path separator, or contain any
// control/format/bidi char. Applied to BOTH the single-decode and the fully-decoded forms.
function isUnsafeDecodedSegment(decoded: string): boolean {
  return decoded === "." || decoded === ".." || /[/\\]/.test(decoded) || UNSAFE_CHARS.test(decoded);
}

/**
 * Strict validation of an internal citation href. Accepts ONLY `lawbar://citation/<docSeg>/<idx>` where
 * docSeg is a single, canonically percent-encoded path segment (round-trips; no `.`/`..`/slash/backslash/
 * control/encoded-traversal after decode) and idx is a plain non-negative integer. Rejects null/empty/
 * whitespace/control chars and every other (external/dangerous) scheme, case tricks, and traversal.
 */
export function isSafeCitationHref(href: unknown): boolean {
  if (typeof href !== "string" || href.length === 0) return false;
  if (href !== href.trim()) return false; // leading/trailing whitespace
  if (UNSAFE_CHARS.test(href)) return false; // control/format/bidi chars anywhere in the raw href
  if (!href.startsWith(INTERNAL_CITATION_SCHEME)) return false; // exact (case-sensitive) internal scheme
  const rest = href.slice(INTERNAL_CITATION_SCHEME.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return false; // exactly <docSeg>/<idx>
  const [docSeg, idx] = parts;
  if (docSeg.length === 0) return false;
  if (!/^[0-9]+$/.test(idx)) return false; // non-negative integer, no sign/decimal/encoding
  if (/%2e|%2f|%5c/i.test(docSeg)) return false; // encoded . / \ traversal
  let decoded: string;
  try {
    decoded = decodeURIComponent(docSeg);
  } catch {
    return false; // malformed percent-encoding
  }
  if (encodeURIComponent(decoded) !== docSeg) return false; // canonical encoding only (rejects %2e%2e etc.)
  if (isUnsafeDecodedSegment(decoded)) return false; // dot-segment / separator / control after one decode
  const deep = fullyPercentDecode(decoded);
  if (deep === null || isUnsafeDecodedSegment(deep)) return false; // double-encoded traversal / control
  return true;
}

/**
 * Mint the app-internal citation href, or `null` if it cannot be safely minted (empty documentId,
 * non-non-negative-integer physicalPageIndex, or the result fails strict validation).
 */
export function mintInternalCitationHref(documentId: string, physicalPageIndex: number): string | null {
  if (typeof documentId !== "string" || documentId.length === 0) return null;
  if (!isNonNegativeSafeInteger(physicalPageIndex)) return null;
  const href = `${INTERNAL_CITATION_SCHEME}${encodeURIComponent(documentId)}/${physicalPageIndex}`;
  return isSafeCitationHref(href) ? href : null;
}

/**
 * Map one A10-T1 rendered citation to its hyperlink-degraded form. Total + bijective: a flagged citation
 * yields the flag (text/href null); a clean citation yields the verbatim 卷X页Y text plus a safe
 * `internalHref` when one can be minted, else text-only. Never drops a citation; never emits an unsafe href.
 */
export function toA10HyperlinkCitation(rendered: A10RenderedCitation): A10HyperlinkCitation {
  const base = {
    linkId: rendered.linkId,
    citationFormatVersion: rendered.citationFormatVersion,
    exportTemplateVersion: rendered.exportTemplateVersion,
  };

  if (rendered.flag !== null) {
    // Degraded: the explicit, reviewable flag is the court-fileable form. No text, no href.
    return { ...base, text: null, internalHref: null, flag: rendered.flag };
  }

  if (rendered.citation === null) {
    // A10-T1 guarantees a clean citation (flag null) carries a citation payload. Defensive: never a silent
    // default — an inconsistent input throws loudly.
    throw new A10CitationContractError(
      `link ${rendered.linkId}: clean A10RenderedCitation (flag null) without a citation payload`,
    );
  }

  // Clean: the 卷X页Y text is the authority (reused verbatim from A10-T1 — single source). The internalHref
  // is non-authoritative nav metadata, minted ONLY from this citation's own document identity, else null.
  const internalHref =
    rendered.documentId !== null && rendered.physicalPageIndex !== null
      ? mintInternalCitationHref(rendered.documentId, rendered.physicalPageIndex)
      : null;
  return { ...base, text: rendered.citation.text, internalHref, flag: null };
}

/** Map a list of A10-T1 rendered citations, preserving order. */
export function toA10HyperlinkCitations(
  rendered: ReadonlyArray<A10RenderedCitation>,
): ReadonlyArray<A10HyperlinkCitation> {
  return rendered.map(toA10HyperlinkCitation);
}
