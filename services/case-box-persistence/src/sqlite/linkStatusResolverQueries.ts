// A3 link-status resolver (WI-A3-T5-RESOLVE).
//
// Realizes the A3-RESOLVE-00 resolver-behavior ADR (docs/adr/
// ADR-evidence-a3-resolver-status-transitions.md): how a `case_box_links.status`
// is COMPUTED from the merged V9-V11 schema + `case_box_documents`. Headless,
// deterministic, idempotent. READS the four A3 tables + `case_box_documents`;
// WRITES ONLY `case_box_links.status`, and only when the computed status differs
// from the stored one (no spurious writes / audit churn — A3-RESOLVE-00 §5).
//
// Status precedence ladder (A3-RESOLVE-00 §3), strict + ordered; the first
// matching rung wins so a combined failure yields exactly ONE status:
//   1. broken       — missing anchor target, OR missing V9 page identity, OR
//                     missing V10 geometry record (A3-RESOLVE-00 §3 rung 1; INV-A3-8).
//   2. needs_review — geometry-version mismatch (anchor.geometry_captured_at !=
//                     the single-current V10 captured_at for that page; INV-A3-6,
//                     no stale coordinate stays valid), OR the anchor's document is
//                     superseded. (A3-RESOLVE-00 §3 rung 2.)
//   3. valid        — else (anchor + page + geometry present, version matches,
//                     document not superseded). The LOWEST rung; NEVER a default
//                     (consistent with the V11 LinkStatus NOT NULL, no DEFAULT).
//
// Document-replacement reconciliation (Option 1, user-authorized 2026-06-24;
// review-plan review-plan-mqsrp52g-rvwkmq OPTION1-RECONCILIATION ACCEPTED-POINTER-ONLY):
// the persisted `case_box_documents.status` enum is the OCR/triage pipeline
// (registered|ocr_pending|ocr_complete|ocr_failed|triaged|tagged|reviewed) and carries
// NONE of the Evidence DocumentStatus lifecycle values (canonical|replaced_pending_review|
// superseded). This resolver therefore detects replacement ONLY from the persisted
// signal that exists today: a document D is superseded iff another `case_box_documents`
// row has `supersedes_document_id == D.id` (reverse lookup). It does NOT key the Evidence
// canonical/replaced/superseded lifecycle off `case_box_documents.status`, and does NOT
// infer replacement from OCR/triage statuses. The full Evidence document lifecycle
// (A1-T7 replacement quarantine) is DEFERRED to a future schema WI.
//
// Scoped meaning (review-plan Low L1): `valid` here means "anchor/document-status
// validity", NOT final full Link validity across every future source table. Source-identity
// resolution (source_type/source_id) is a future WI — most M0 source types
// (note/question/calcTerm/claimElement) have no persistence table yet.
//
// STATUS-ONLY (A3-RESOLVE-00 §7): this WI writes `case_box_links.status` and emits
// NO audit event — the audit-event shape is deferred + non-inferable; none is invented.
//
// NO SQLite FK (case-box convention): all bindings are app-layer invariants. This
// resolver creates/deletes NO links or anchors and resolves NO anchor-delete/cascade
// policy (still UNRESOLVED — A3-CONTRACT-00 decision 9 / A3-SCHEMA-00 decision 5).

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";

/** The three computed link statuses (V11 `case_box_links.status` domain). */
export type ResolvedLinkStatus = "valid" | "needs_review" | "broken";

/** Tenant + matter scope for one resolver run. The unit of atomicity. */
export interface ResolveLinkStatusScope {
  readonly tenant_id: string;
  readonly matter_id: string;
}

/** Summary of one resolver run. Deterministic for a given DB state + scope. */
export interface LinkStatusResolutionResult {
  /** Links scanned in scope. */
  readonly scanned: number;
  /** Links whose status changed (a row was written for each). */
  readonly updated: number;
  /** Count of links by their RESULTING (post-resolution) computed status. */
  readonly byStatus: Readonly<Record<ResolvedLinkStatus, number>>;
}

// Set-based status computation: one SELECT joins links -> anchors -> V9 pages ->
// V10 geometries (LEFT JOINs so a missing record surfaces as NULL -> broken) and a
// scoped reverse-supersession subquery, deriving the target status via the §3 ladder
// in a CASE expression. No per-link N+1 (review-plan Low L4): pages/geometries are
// joined on the index keys (tenant_id, matter_id, document_id, physical_page_index)
// and the superseded set is a single scoped DISTINCT subquery.
const COMPUTE_SQL = `
  SELECT
    l.id     AS link_id,
    l.status AS current_status,
    CASE
      WHEN a.id IS NULL THEN 'broken'
      WHEN p.id IS NULL THEN 'broken'
      WHEN g.id IS NULL THEN 'broken'
      WHEN a.geometry_captured_at <> g.captured_at THEN 'needs_review'
      WHEN sup.superseded_id IS NOT NULL THEN 'needs_review'
      ELSE 'valid'
    END AS computed_status
  FROM case_box_links l
  LEFT JOIN case_box_anchors a
    ON a.id = l.anchor_id AND a.tenant_id = l.tenant_id AND a.matter_id = l.matter_id
  LEFT JOIN case_box_document_pages p
    ON p.tenant_id = l.tenant_id AND p.matter_id = l.matter_id
   AND p.document_id = a.document_id AND p.physical_page_index = a.physical_page_index
  LEFT JOIN case_box_document_page_geometries g
    ON g.tenant_id = l.tenant_id AND g.matter_id = l.matter_id
   AND g.document_id = a.document_id AND g.physical_page_index = a.physical_page_index
  LEFT JOIN (
    SELECT DISTINCT supersedes_document_id AS superseded_id
    FROM case_box_documents
    WHERE tenant_id = @tenant_id AND matter_id = @matter_id
      AND supersedes_document_id IS NOT NULL
  ) sup ON sup.superseded_id = a.document_id
  WHERE l.tenant_id = @tenant_id AND l.matter_id = @matter_id
  ORDER BY l.id ASC
`;

interface ComputeRow {
  readonly link_id: string;
  readonly current_status: string;
  readonly computed_status: ResolvedLinkStatus;
}

/**
 * Resolve `case_box_links.status` for every link in `scope`, per the A3-RESOLVE-00
 * §3 ladder. Deterministic (same DB state + scope -> same statuses) and idempotent
 * (re-running on unchanged inputs writes nothing). All affected links are updated
 * atomically in one transaction (A3-RESOLVE-00 §6 per-matter scope); no partial-update
 * state is observable. Returns the run summary.
 *
 * Reads: case_box_links, case_box_anchors, case_box_document_pages (V9),
 * case_box_document_page_geometries (V10), case_box_documents (reverse-supersession
 * signal only). Writes: ONLY case_box_links.status, and only for changed rows.
 */
export function resolveLinkStatuses(
  db: Database,
  scope: ResolveLinkStatusScope,
): LinkStatusResolutionResult {
  if (typeof scope?.tenant_id !== "string" || scope.tenant_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "resolveLinkStatuses: tenant_id is required");
  }
  if (typeof scope?.matter_id !== "string" || scope.matter_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "resolveLinkStatuses: matter_id is required");
  }

  const bind = { tenant_id: scope.tenant_id, matter_id: scope.matter_id };

  // Compute AND apply inside ONE transaction so the resolver acts on a single
  // consistent snapshot (A3-RESOLVE-00 §6): the COMPUTE_SELECT and the UPDATEs are
  // one atomic unit, so no concurrent writer can change anchors/pages/geometries/
  // supersession between the read and the write and leave statuses based on stale
  // inputs. `.immediate()` issues BEGIN IMMEDIATE — the write lock is taken up front,
  // before the read — and better-sqlite3 rolls back on throw. Only rows whose computed
  // status differs from the stored one are written, so the run stays idempotent.
  const run = db.transaction((): LinkStatusResolutionResult => {
    const rows = db.prepare(COMPUTE_SQL).all(bind) as ComputeRow[];

    const byStatus: Record<ResolvedLinkStatus, number> = { valid: 0, needs_review: 0, broken: 0 };
    for (const r of rows) byStatus[r.computed_status] += 1;

    const update = db.prepare(
      "UPDATE case_box_links SET status = ? WHERE id = ? AND tenant_id = ? AND matter_id = ?",
    );
    let updated = 0;
    for (const r of rows) {
      if (r.computed_status !== r.current_status) {
        updated += update.run(r.computed_status, r.link_id, bind.tenant_id, bind.matter_id).changes;
      }
    }
    return { scanned: rows.length, updated, byStatus };
  });

  return run.immediate();
}
