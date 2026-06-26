// A3 headless export-citation builder (WI-A3-EXPORT-T1).
//
// Realizes the A3-EXPORT-00 export-degradation contract (docs/adr/
// ADR-evidence-a3-export-degradation.md): how an A3 link becomes a court-fileable
// export citation, degrading visibly when the link is needs_review/broken/non-citable/
// ambiguous so a stale, unresolved, or missing anchor can NEVER export as a
// silently-valid citation (A1/A10 citation trust).
//
// Flow (A3-EXPORT-00 §6): the builder runs the existing resolver
// `resolveLinkStatuses(db, scope)` FIRST to refresh `case_box_links.status` for the
// scope — the ONLY write — then derives, READ-ONLY, one deterministic export-citation
// object per link. The resolver status is the single source of truth; the builder does
// NOT fork its own validity computation (A3-EXPORT-00 §5/§6).
//
// exportFlag precedence (A3-EXPORT-00 §3 + the V12 durable-unlink override, A3-UNLINK-SCHEMA-00 §6;
// exactly one flag per link):
//   unlinked_at IS NOT NULL     -> exportFlag UNLINKED     (V12 durable EXPLICIT-UNLINK marker, read directly —
//                                                           HIGHEST precedence; distinct from a structural BROKEN;
//                                                           non-clean, never dropped — A10 no-drop. `status` is the
//                                                           trust gate, but the marker is the clean-export override.)
//   linkStatus === broken       -> exportFlag BROKEN       (no 卷X页Y / rect claim; best-effort source +
//                                                           best-effort document/page identity when the anchor exists)
//   linkStatus === needs_review -> exportFlag NEEDS_REVIEW (DocumentPage identity preserved best-effort when
//                                                           available, but flagged review-required; never clean)
//   linkStatus === valid        -> a clean citation (exportFlag null, 卷X页Y from DocumentPage identity) ONLY if
//                                  the page is citable AND the citation label is unambiguous; else
//                                  NON_CITABLE (no usable identity / isCitable false) or
//                                  AMBIGUOUS (the (citationVolume, citationPageLabel) maps to >1 physical page in
//                                  the link's document scope — A1: refuse/disambiguate, never guess).
// `valid` is necessary but NOT sufficient for a clean citation (A3-EXPORT-00 §3 review-L1); a `valid` link
// NEVER yields REPLACED. REPLACED + audit events are DEFERRED (A3-EXPORT-00 §7/§10) — none is emitted here.
//
// Citation identity (A3-EXPORT-00 §2/§4; user decision 2026-06-24 / handover §A1): the human-facing citation
// fields (citationVolume / citationPageLabel / isCitable) live in the V9 `case_box_document_pages.payload_json`
// (no dedicated columns / no formal contract type today). The builder reads them from payload_json; a page is
// citable only when payload_json carries a non-empty string citationVolume + citationPageLabel AND
// isCitable !== false. A malformed payload degrades deterministically to NON_CITABLE — it never crashes the
// export. Citation identity is DocumentPage-only — never viewport/rendered coordinates, never an
// OptimizedDocumentRendition.
//
// A10 no-drop: every in-scope link yields EXACTLY ONE export-citation object — a missing page/geometry/anchor
// produces a deterministic BROKEN object (best-effort identity, empty citation), never a silent omission.
//
// NO SQLite FK / NO schema change: all bindings are app-layer invariants. This export module changes no
// schema, no migration, no UI, no export-file rendering, no cascade, no dependency. (WI-A3-UNLINK-RESOLVE
// added V12 unlinked-marker awareness here + a sibling resolver rung; neither writes the marker or changes
// the schema — the marker is read-only, set/cleared only by the future unlink operation WI-A3-UNLINK-T1.)

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";
import { resolveLinkStatuses } from "./linkStatusResolverQueries.js";
import type { ResolvedLinkStatus, ResolveLinkStatusScope } from "./linkStatusResolverQueries.js";

// Composite map-key separator. NUL can never appear in a ULID/id or a citation label, so it is a
// collision-proof join — written here as an explicit escape so the source stays plain text (not binary).
const KEY_SEP = "\u0000";

/**
 * The non-clean export degradation flags (A3-EXPORT-00 §3). `null` = a clean citation.
 * `UNLINKED` (WI-A3-UNLINK-RESOLVE) is the V12 durable-explicit-unlink flag — distinct from a
 * structural `BROKEN` — emitted when case_box_links.unlinked_at IS NOT NULL (A3-UNLINK-SCHEMA-00 §6).
 */
export type ExportCitationFlag = "NEEDS_REVIEW" | "BROKEN" | "NON_CITABLE" | "AMBIGUOUS" | "UNLINKED";

/** A resolved, court-fileable citation derived solely from DocumentPage identity (A1). */
export interface ExportCitation {
  readonly linkId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Best-effort DocumentPage identity from the anchor (present when the anchor row exists). */
  readonly documentId: string | null;
  readonly physicalPageIndex: number | null;
  /** The resolver's trusted status (the trust gate). */
  readonly linkStatus: ResolvedLinkStatus;
  /** The export classification; `null` ONLY for a clean citation. */
  readonly exportFlag: ExportCitationFlag | null;
  /** The 卷X页Y citation — present ONLY for a clean citation (exportFlag === null). */
  readonly citation: { readonly citationVolume: string; readonly citationPageLabel: string; readonly text: string } | null;
}

/** Deterministic result of one export run. */
export interface ExportCitationResult {
  readonly citations: ReadonlyArray<ExportCitation>;
  /** Count of links by their resulting export classification (CLEAN = a clean citation). */
  readonly byFlag: Readonly<Record<"CLEAN" | ExportCitationFlag, number>>;
}

interface CitationIdentity {
  readonly citationVolume: string;
  readonly citationPageLabel: string;
}

// A page is citable only when payload_json carries non-empty string citationVolume + citationPageLabel AND
// isCitable !== false. A malformed payload degrades to non-citable (returns null), never throws (review L1).
function readCitationIdentity(payloadJson: string): CitationIdentity | null {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.isCitable === false) return null;
  const vol = p.citationVolume;
  const label = p.citationPageLabel;
  if (typeof vol !== "string" || typeof label !== "string") return null;
  if (vol.trim().length === 0 || label.trim().length === 0) return null;
  return { citationVolume: vol, citationPageLabel: label };
}

interface LinkRow {
  readonly id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly anchor_id: string;
  readonly status: ResolvedLinkStatus;
  /** The V12 durable explicit-unlink marker (A3-UNLINK-SCHEMA-00 §2); non-null iff the link is unlinked. */
  readonly unlinked_at: string | null;
}

/**
 * Build deterministic export citations for every link in `scope`, per the A3-EXPORT-00 degradation contract.
 * Runs `resolveLinkStatuses(db, scope)` first (the only write), then derives — read-only — one export-citation
 * object per link, ordered by link id. Deterministic (same DB state + scope -> identical objects) and idempotent
 * (a repeated call writes nothing beyond the idempotent resolver refresh). Emits no audit events; mutates only
 * `case_box_links.status` via the resolver.
 */
export function buildExportCitations(db: Database, scope: ResolveLinkStatusScope): ExportCitationResult {
  if (typeof scope?.tenant_id !== "string" || scope.tenant_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "buildExportCitations: tenant_id is required");
  }
  if (typeof scope?.matter_id !== "string" || scope.matter_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "buildExportCitations: matter_id is required");
  }
  const bind = { tenant_id: scope.tenant_id, matter_id: scope.matter_id };

  // 1. Refresh link status first — the resolver is the source of truth (A3-EXPORT-00 §6). The only write.
  resolveLinkStatuses(db, scope);

  // 2. Load scope rows (read-only). Anchors by id; page citation identity by (document_id, physical_page_index);
  //    per-document label-occurrence counts for the A1 ambiguity check (scoped to tenant/matter/document over
  //    DocumentPage payload labels — never geometry/viewport; review L2).
  const links = db
    .prepare(
      `SELECT id, source_type, source_id, anchor_id, status, unlinked_at FROM case_box_links
       WHERE tenant_id = @tenant_id AND matter_id = @matter_id ORDER BY id ASC`,
    )
    .all(bind) as LinkRow[];

  const anchorsById = new Map<string, { document_id: string; physical_page_index: number }>();
  for (const a of db
    .prepare(
      `SELECT id, document_id, physical_page_index FROM case_box_anchors
       WHERE tenant_id = @tenant_id AND matter_id = @matter_id`,
    )
    .all(bind) as Array<{ id: string; document_id: string; physical_page_index: number }>) {
    anchorsById.set(a.id, { document_id: a.document_id, physical_page_index: a.physical_page_index });
  }

  const citationByPage = new Map<string, CitationIdentity | null>(); // (document_id KEY_SEP physical_page_index) -> identity
  const labelCountByDoc = new Map<string, Map<string, number>>(); // document_id -> ((vol KEY_SEP label) -> count)
  for (const pg of db
    .prepare(
      `SELECT document_id, physical_page_index, payload_json FROM case_box_document_pages
       WHERE tenant_id = @tenant_id AND matter_id = @matter_id`,
    )
    .all(bind) as Array<{ document_id: string; physical_page_index: number; payload_json: string }>) {
    const ident = readCitationIdentity(pg.payload_json);
    citationByPage.set(`${pg.document_id}${KEY_SEP}${pg.physical_page_index}`, ident);
    if (ident) {
      let byLabel = labelCountByDoc.get(pg.document_id);
      if (!byLabel) {
        byLabel = new Map<string, number>();
        labelCountByDoc.set(pg.document_id, byLabel);
      }
      const key = `${ident.citationVolume}${KEY_SEP}${ident.citationPageLabel}`;
      byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
    }
  }

  const byFlag: Record<"CLEAN" | ExportCitationFlag, number> = {
    CLEAN: 0,
    NEEDS_REVIEW: 0,
    BROKEN: 0,
    NON_CITABLE: 0,
    AMBIGUOUS: 0,
    UNLINKED: 0,
  };
  const citations: ExportCitation[] = [];

  for (const link of links) {
    const anchor = anchorsById.get(link.anchor_id) ?? null;
    const documentId = anchor ? anchor.document_id : null;
    const physicalPageIndex = anchor ? anchor.physical_page_index : null;

    let exportFlag: ExportCitationFlag | null;
    let citation: ExportCitation["citation"] = null;

    if (link.unlinked_at !== null) {
      // V12 durable EXPLICIT-UNLINK marker (A3-UNLINK-SCHEMA-00 §6): the HIGHEST-precedence export branch.
      // Read the marker directly (not only `status`) so an explicitly-unlinked link is DISTINGUISHABLE from a
      // structurally-`broken` one. It is non-clean (never a clean citation) and never dropped (A10 no-drop) —
      // it still gets exactly one object, with best-effort link/source identity. (The resolver already set its
      // status to 'broken' for the trust gate; the marker yields the distinct UNLINKED flag.)
      exportFlag = "UNLINKED";
    } else if (link.status === "broken") {
      exportFlag = "BROKEN";
    } else if (link.status === "needs_review") {
      exportFlag = "NEEDS_REVIEW";
    } else {
      // valid — necessary but NOT sufficient: apply the A1/A10 citation-contract checks (A3-EXPORT-00 §3).
      const ident = anchor ? citationByPage.get(`${documentId}${KEY_SEP}${physicalPageIndex}`) ?? null : null;
      if (!ident) {
        exportFlag = "NON_CITABLE";
      } else {
        const byLabel = documentId ? labelCountByDoc.get(documentId) : undefined;
        const occ = byLabel?.get(`${ident.citationVolume}${KEY_SEP}${ident.citationPageLabel}`) ?? 0;
        if (occ > 1) {
          exportFlag = "AMBIGUOUS"; // label maps to >1 physical page in document scope (A1)
        } else {
          exportFlag = null; // clean
          citation = {
            citationVolume: ident.citationVolume,
            citationPageLabel: ident.citationPageLabel,
            text: `卷${ident.citationVolume}页${ident.citationPageLabel}`,
          };
        }
      }
    }

    byFlag[exportFlag ?? "CLEAN"] += 1;
    citations.push({
      linkId: link.id,
      sourceType: link.source_type,
      sourceId: link.source_id,
      documentId,
      physicalPageIndex,
      linkStatus: link.status,
      exportFlag,
      citation,
    });
  }

  return { citations, byFlag };
}
