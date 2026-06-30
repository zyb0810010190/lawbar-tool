// a10CanonicalExportModel.ts — A10-T6 golden CanonicalExportModel (WI-EVIDENCE-A10-T6-GOLDEN-CANONICAL-EXPORT-00).
//
// Per docs/adr/ADR-evidence-a10-court-fileable-export.md §4 (CanonicalExportModel, transcribed from the
// handover — NOT invented) and §8 (A10-T6 golden-export): the CanonicalExportModel is the deterministic
// LOGICAL reproducibility layer whose serialization is byte-identical across display / re-export / restore.
// `canonicalModelSha256` = SHA-256 of a deterministic serialization with stable key/row order, normalized
// Unicode (NFC), no timestamps unless court-facing, and no machine paths / renderer metadata.
//
// This is a standalone apps-layer slice OVER the merged A10-T1 (a10CitationContract.ts) + A10-T2
// (a10HyperlinkDegradation.ts) contracts. It does NOT wire the live export pipeline, build the native
// `golden-export` harness, touch A8, forms, schema, custody, confidential fixtures, the JS shim, or render
// any `.docx`/PDF. It hashes the canonical LOGICAL model — NEVER raw `.docx`/PDF bytes (ADR §3, evidence
// invariant 9). It writes nothing.
//
// COURT-FILEABLE AUTHORITY: every row carries EXACTLY one of { citationText (卷X页Y) } XOR { flag }. The A10-T2
// `internalHref` (non-authoritative in-app navigation metadata) is DELIBERATELY EXCLUDED from the canonical
// model — it is never a court-fileable value, so it can never leak into a reproducibility hash or a filing.

import type { A10RenderedCitation, A10ExportCitationFlag } from "./a10CitationContract.js";
import { CITATION_FORMAT_VERSION, EXPORT_TEMPLATE_VERSION } from "./a10CitationContract.js";
import { toA10HyperlinkCitations } from "./a10HyperlinkDegradation.js";
import { createHash } from "node:crypto";

// Pinned serializer/schema version for callers who tag the serializer OUT-OF-BAND (e.g. a future
// ExportPreview). It is DELIBERATELY NOT a field of CanonicalExportModel and is NOT serialized/hashed —
// the hashed model stays faithful to the ADR §4 transcribed shape (review-plan-mr0fhoa8 fix #1).
export const CANONICAL_EXPORT_MODEL_VERSION = "a10.canonical.v1" as const;

/**
 * One court-fileable export row: a stable link id and EXACTLY one of { citationText } XOR { flag } — by
 * KEY PRESENCE, not a null sentinel. A clean citation row carries only `citationText` (卷X页Y); a degraded
 * row carries only `flag`. This keeps the canonical model all-strings (no nulls) and faithful to "exactly one".
 */
export type CanonicalExportRow =
  | { readonly linkId: string; readonly citationText: string }
  | { readonly linkId: string; readonly flag: A10ExportCitationFlag };

/** A clean citation's canonical projection (flag-free). */
export interface CanonicalCitation {
  readonly linkId: string;
  readonly citationVolume: string;
  readonly citationPageLabel: string;
  readonly text: string;
}

/** A degraded link's canonical projection (no citation text; an explicit, reviewable flag). */
export interface CanonicalLinkDegradation {
  readonly linkId: string;
  readonly flag: A10ExportCitationFlag;
}

/**
 * The deterministic logical export model (ADR §4). All arrays are in a stable, content-derived order
 * (rows/citations/degradations by `linkId`; flags + sourceObjectIds + warnings sorted) so serialization is
 * byte-identical across runs and machines. No `internalHref`, no timestamps, no machine paths.
 */
export interface CanonicalExportModel {
  readonly exportType: string;
  readonly citationFormatVersion: typeof CITATION_FORMAT_VERSION;
  readonly exportTemplateVersion: typeof EXPORT_TEMPLATE_VERSION;
  readonly rows: ReadonlyArray<CanonicalExportRow>;
  readonly citations: ReadonlyArray<CanonicalCitation>;
  readonly linkDegradations: ReadonlyArray<CanonicalLinkDegradation>;
  readonly flags: ReadonlyArray<A10ExportCitationFlag>;
  readonly warnings: ReadonlyArray<string>;
  readonly sourceObjectIds: ReadonlyArray<string>;
  /** Optional (ADR §4 `generatedFromSnapshotId?`). OMITTED from the model + serialization when absent. */
  readonly generatedFromSnapshotId?: string;
}

/** NFC-normalize a string (Unicode normalization is part of the determinism rule). */
function nfc(s: string): string {
  return s.normalize("NFC");
}

/** Stable ascending comparator on a string key (locale-independent, code-unit order). */
function byString<T>(key: (t: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/** Distinct, ascending-sorted copy of a string list. */
function distinctSorted(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values.map(nfc))).sort();
}

/**
 * Build the canonical export model from the A10-T1 rendered citations. The hyperlink-degraded view
 * (A10-T2) supplies the per-row text-or-flag authority; `internalHref` is intentionally discarded here.
 * `warnings` are caller-supplied (e.g. ambiguity/needs-review notes) and sorted for determinism.
 */
export function buildCanonicalExportModel(params: {
  exportType: string;
  rendered: ReadonlyArray<A10RenderedCitation>;
  warnings?: ReadonlyArray<string>;
  generatedFromSnapshotId?: string | null;
}): CanonicalExportModel {
  const { exportType, rendered } = params;
  const hyperlinks = toA10HyperlinkCitations(rendered); // A10-T2: text XOR flag (href dropped below)

  const rows: CanonicalExportRow[] = hyperlinks
    .map((h): CanonicalExportRow => {
      if (h.text !== null) return { linkId: h.linkId, citationText: nfc(h.text) };
      if (h.flag !== null) return { linkId: h.linkId, flag: h.flag };
      // Unreachable: A10-T2 is total+bijective (text XOR flag). Fail loud rather than emit an empty row.
      throw new Error(`link ${h.linkId}: hyperlink citation carries neither text nor flag`);
    })
    .sort(byString((r) => r.linkId));

  const citations: CanonicalCitation[] = rendered
    .filter((r) => r.flag === null && r.citation !== null)
    .map((r) => ({
      linkId: r.linkId,
      citationVolume: nfc(r.citation!.citationVolume),
      citationPageLabel: nfc(r.citation!.citationPageLabel),
      text: nfc(r.citation!.text),
    }))
    .sort(byString((c) => c.linkId));

  const linkDegradations: CanonicalLinkDegradation[] = rendered
    .filter((r) => r.flag !== null)
    .map((r) => ({ linkId: r.linkId, flag: r.flag as A10ExportCitationFlag }))
    .sort(byString((d) => d.linkId));

  const flags = Array.from(new Set(linkDegradations.map((d) => d.flag))).sort() as A10ExportCitationFlag[];
  const sourceObjectIds = distinctSorted(rendered.map((r) => r.sourceId));
  const warnings = distinctSorted(params.warnings ?? []);

  return {
    exportType: nfc(exportType),
    citationFormatVersion: CITATION_FORMAT_VERSION,
    exportTemplateVersion: EXPORT_TEMPLATE_VERSION,
    rows,
    citations,
    linkDegradations,
    flags,
    warnings,
    sourceObjectIds,
    // ADR §4 marks this optional: include it ONLY when supplied; otherwise omit (never serialize `null`).
    ...(params.generatedFromSnapshotId != null
      ? { generatedFromSnapshotId: nfc(params.generatedFromSnapshotId) }
      : {}),
  };
}

/**
 * Deterministic serialization (ADR §4 rule): recursively sort object keys, NFC-normalize every string,
 * preserve the (already content-stable) array order, emit compact JSON. No timestamps, machine paths, or
 * renderer metadata are present in the model, so the output is byte-identical across runs and machines.
 */
export function serializeCanonicalExportModel(model: CanonicalExportModel): string {
  return stableStringify(model);
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(nfc(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not canonically serializable");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  throw new Error(`unserializable value of type ${typeof value}`);
}

/** SHA-256 (hex) of the deterministic serialization — the reproducibility unit (ADR §4). */
export function canonicalModelSha256(model: CanonicalExportModel): string {
  return createHash("sha256").update(serializeCanonicalExportModel(model), "utf8").digest("hex");
}
