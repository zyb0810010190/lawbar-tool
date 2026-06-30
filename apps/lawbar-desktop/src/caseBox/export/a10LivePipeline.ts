// a10LivePipeline.ts — A10 live export-pipeline wiring (WI-EVIDENCE-A10-LIVE-PIPELINE-WIRING-00).
//
// The narrow adapter that lets the LIVE export path (exportLinkCitationsHandler) consume the A10 export
// contract already established by A10-T1/T2/T6 — without REDEFINING any of it. It is pure composition:
//
//   services buildExportCitations -> ExportCitationResult
//     -> toA10RenderedCitations            (A10-T1: citation-render contract; 卷X页Y from DocumentPage)
//     -> buildCanonicalExportModel         (A10-T6; internally drives A10-T2 toA10HyperlinkCitations for the
//                                           text-or-flag rows, excludes internalHref, total + deterministic)
//     -> canonicalModelSha256              (A10-T6; SHA-256 of the deterministic logical serialization)
//
// It adds NO citation-rendering, href-validation, or serialization logic of its own (all reused from the
// A10 modules), wires NO new IPC channel, mutates NO schema/persistence contract, and renders no
// `.docx`/PDF. The result is byte-identical to what the native A10 golden-export gate validates, so the
// live path is compatible with that gate by construction.

import type { ExportCitationResult } from "case-box-persistence";
import type { CanonicalExportModel } from "./a10CanonicalExportModel.js";
import { buildCanonicalExportModel, canonicalModelSha256 } from "./a10CanonicalExportModel.js";
import { toA10RenderedCitations } from "./a10CitationContract.js";

/** The stable export-type label for the live link-citation export. NOT a court form (T3/T4/T5 are separate). */
export const LIVE_EXPORT_TYPE = "evidence-citation-export" as const;

/** The A10 canonical-export view the live pipeline attaches to its result: the deterministic logical model
 *  plus its reproducibility hash. `internalHref` is never present (the model excludes it). */
export interface LiveCanonicalExport {
  readonly canonicalModel: CanonicalExportModel;
  readonly canonicalModelSha256: string;
}

/**
 * Build the A10 canonical export view from a services `ExportCitationResult`, reusing A10-T1/T2/T6 verbatim.
 * Deterministic and total: every services citation becomes exactly one canonical row (text XOR flag), no
 * dropped citation, no href in the model. `exportType` defaults to the live link-citation export label.
 */
export function buildLiveCanonicalExport(
  result: ExportCitationResult,
  exportType: string = LIVE_EXPORT_TYPE,
): LiveCanonicalExport {
  const canonicalModel = buildCanonicalExportModel({
    exportType,
    rendered: toA10RenderedCitations(result), // A10-T1 is the single source of the rendered citations
  });
  return { canonicalModel, canonicalModelSha256: canonicalModelSha256(canonicalModel) };
}
