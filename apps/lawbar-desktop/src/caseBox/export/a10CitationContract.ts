// a10CitationContract.ts — A10-T1 citation-render CONTRACT (WI-EVIDENCE-A10-T1-CITATION-RENDER-CONTRACT-00).
//
// The single APPS-LAYER authority for the court-fileable citation contract, per
// docs/adr/ADR-evidence-a10-court-fileable-export.md (A10-DESIGN-00 §3, §6). A10-T1 does NOT re-render
// citation strings: the citation text is produced ONCE, from DocumentPage identity, by the services
// renderer `buildExportCitations` (services/case-box-persistence) as `卷X页Y` (A1 / A1-T5). This module
// is the contract OVER that output — it pins the format/template versions, owns the canonical
// `ExportCitationFlag` vocabulary, and maps each services `ExportCitation` into a versioned
// `A10RenderedCitation` that A10-T6 (golden CanonicalExportModel) will later serialize.
//
// Single-source discipline (ADR §3 "no module formats citations independently"): the mapper RETURNS the
// services-provided `citation.text` verbatim. It computes `卷{vol}页{label}` ONLY as an invariant/drift
// CHECK; on mismatch it THROWS loudly (A10CitationContractError) — it never reconstructs or silently
// "repairs" the string (that would make this a second formatter). It is deterministic (pure function of
// its input + the pinned version constants — no timestamps, machine paths, locale, or renderer metadata),
// and total+bijective (every input yields EXACTLY one rendered citation OR one flag).
//
// It implements NO CanonicalExportModel, NO golden export, NO forms, NO preview hashing, NO .docx/PDF, NO
// A8, and is NOT wired into the live export IPC handler (a later A10 slice). It writes nothing.

import type { ExportCitationResult } from "case-box-persistence";

/** The services `ExportCitation` shape (derived from the package's exported result type). */
export type ServicesExportCitation = ExportCitationResult["citations"][number];

/** Pinned versions (ADR §6): citation syntax vs export layout. Bumping either is a contract change. */
export const CITATION_FORMAT_VERSION = "a10.citation.v1" as const;
export const EXPORT_TEMPLATE_VERSION = "a10.template.v1" as const;

/**
 * The canonical A10 export-citation flag vocabulary (ADR §6 reconciliation).
 * - The five EMITTABLE flags mirror the built services contract (A3-EXPORT-00), incl. `UNLINKED`
 *   (the V12 durable explicit-unlink marker — RETAINED, distinct from structural `BROKEN`).
 * - `REPLACED` is part of the handover contract but is SPEC-PENDING: it is declared here for vocabulary
 *   completeness/forward-compat but is NEVER emitted until document replacement lifecycle + status-reason
 *   support exist (`emittable: false`). The mapper refuses to produce it.
 */
export const A10_EXPORT_CITATION_FLAGS = {
  NEEDS_REVIEW: { zh: "引用待核", en: "NEEDS_REVIEW", emittable: true },
  BROKEN: { zh: "引用缺失", en: "BROKEN", emittable: true },
  NON_CITABLE: { zh: "不可引用", en: "NON_CITABLE", emittable: true },
  AMBIGUOUS: { zh: "引用歧义", en: "AMBIGUOUS", emittable: true },
  UNLINKED: { zh: "引用已解除", en: "UNLINKED", emittable: true },
  REPLACED: { zh: "文档已替换", en: "REPLACED", emittable: false },
} as const;

export type A10ExportCitationFlag = keyof typeof A10_EXPORT_CITATION_FLAGS;

/** The flags the mapper may emit (excludes spec-pending REPLACED). */
export const EMITTABLE_A10_FLAGS: ReadonlyArray<A10ExportCitationFlag> =
  (Object.keys(A10_EXPORT_CITATION_FLAGS) as A10ExportCitationFlag[]).filter(
    (f) => A10_EXPORT_CITATION_FLAGS[f].emittable,
  );

/** A versioned, court-fileable rendered citation — exactly one of `citation` / `flag` is non-null. */
export interface A10RenderedCitation {
  readonly linkId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentId: string | null;
  readonly physicalPageIndex: number | null;
  readonly citationFormatVersion: typeof CITATION_FORMAT_VERSION;
  readonly exportTemplateVersion: typeof EXPORT_TEMPLATE_VERSION;
  /** A clean citation — present iff `flag === null`. `text` is the services 卷X页Y, reused verbatim. */
  readonly citation: { readonly citationVolume: string; readonly citationPageLabel: string; readonly text: string } | null;
  /** A degradation flag — present iff `citation === null`. Never `REPLACED`. */
  readonly flag: A10ExportCitationFlag | null;
}

/** Thrown loudly on a citation-contract drift (e.g. services text != 卷{vol}页{label}). Never repaired. */
export class A10CitationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A10CitationContractError";
  }
}

/** The canonical 卷X页Y form — used ONLY as a drift check, never to produce the returned text. */
function expectedCitationText(citationVolume: string, citationPageLabel: string): string {
  return `卷${citationVolume}页${citationPageLabel}`;
}

/**
 * Map one services `ExportCitation` to the versioned A10 contract shape. Total + bijective:
 * - clean (exportFlag === null, citation present) -> a citation (text reused verbatim from services,
 *   asserted == 卷{vol}页{label} or it throws), flag null;
 * - degraded (exportFlag set) -> the canonical emittable flag, citation null;
 * Anything inconsistent (clean-but-no-citation, both-set, REPLACED, unknown flag) throws — never a
 * silent default.
 */
export function toA10RenderedCitation(ec: ServicesExportCitation): A10RenderedCitation {
  const base = {
    linkId: ec.linkId,
    sourceType: ec.sourceType,
    sourceId: ec.sourceId,
    documentId: ec.documentId,
    physicalPageIndex: ec.physicalPageIndex,
    citationFormatVersion: CITATION_FORMAT_VERSION,
    exportTemplateVersion: EXPORT_TEMPLATE_VERSION,
  };

  if (ec.exportFlag === null) {
    // Clean citation. The services renderer is the single source of the 卷X页Y text.
    if (ec.citation === null) {
      throw new A10CitationContractError(
        `link ${ec.linkId}: clean export citation (exportFlag null) without a citation payload`,
      );
    }
    const expected = expectedCitationText(ec.citation.citationVolume, ec.citation.citationPageLabel);
    if (ec.citation.text !== expected) {
      // Drift: a SECOND formatter would have produced a different string. Fail loud; do not repair.
      throw new A10CitationContractError(
        `link ${ec.linkId}: citation text drift — services "${ec.citation.text}" != contract "${expected}"`,
      );
    }
    return {
      ...base,
      citation: {
        citationVolume: ec.citation.citationVolume,
        citationPageLabel: ec.citation.citationPageLabel,
        text: ec.citation.text, // reused verbatim — single source
      },
      flag: null,
    };
  }

  // Degraded. A flagged citation MUST NOT also carry a citation payload (services contract: `citation`
  // is non-null ONLY for a clean citation). "Both set" is inconsistent input — throw, never silently
  // drop the payload.
  if (ec.citation !== null) {
    throw new A10CitationContractError(
      `link ${ec.linkId}: flagged citation (exportFlag "${ec.exportFlag}") must not carry a citation payload`,
    );
  }
  // The flag must be a known EMITTABLE canonical flag (never REPLACED).
  const flag = ec.exportFlag as A10ExportCitationFlag;
  if (!(flag in A10_EXPORT_CITATION_FLAGS)) {
    throw new A10CitationContractError(`link ${ec.linkId}: unknown export flag "${ec.exportFlag}"`);
  }
  if (!A10_EXPORT_CITATION_FLAGS[flag].emittable) {
    throw new A10CitationContractError(`link ${ec.linkId}: flag "${flag}" is spec-pending and must not be emitted`);
  }
  return { ...base, citation: null, flag };
}

/** Map a full services export result to the versioned A10 contract list, preserving deterministic order. */
export function toA10RenderedCitations(result: ExportCitationResult): ReadonlyArray<A10RenderedCitation> {
  return result.citations.map(toA10RenderedCitation);
}
