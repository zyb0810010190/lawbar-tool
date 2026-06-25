// A3 referenced-anchor-delete REFUSAL guard (WI-A3-DELETE-T1).
//
// Implements the app-layer refusal from `ADR-evidence-a3-anchor-delete-policy.md`
// (A3-CASCADE-00 §2/§9): a `case_box_anchors` row that is referenced by any
// `case_box_links` row MUST NOT be physically deleted — deleting it would either
// silently cascade-delete the links (destroying evidence links) or orphan them. This
// guard makes that refusal enforceable BEFORE any delete behavior exists.
//
// NEGATIVE-PATH / REFUSAL ONLY. `assertCanDeleteAnchor` throws a typed
// `CaseBoxPersistenceError` when an anchor is referenced (or missing in scope) and
// returns void when a delete would be allowable. It performs **no physical delete**:
// physically deleting an UNREFERENCED anchor stays gated on the product decision in
// WI-A3-UNREF-DELETE (A3-CASCADE-00 §3), and unlink/break-link is a separate future WI
// (§4). The resolver missing-anchor -> `broken` + export deterministic `BROKEN` behavior
// remains a corruption SAFETY NET (§5) — this guard does NOT rely on breaking anchors.
//
// Race-safe shape (A3-CASCADE-00 §9): because there is no SQLite FK, the existence-check
// and the scoped reference-check run inside ONE write transaction (BEGIN IMMEDIATE) so the
// FUTURE check+delete path (a later WI) can delete atomically with no orphan-link race.
// This WI deletes nothing, so the transaction proves the guard boundary only.
//
// Scope: the reference-check is tenant/matter-scoped (anchors are single-scope; a link in a
// different tenant/matter is inconsistent state in its own scope, not a blocker here). No
// audit events (a non-destructive refusal; A3-CASCADE-00 §7). No SQLite FK / ON DELETE
// CASCADE. No schema change. No resolver/export change.

import type { Database } from "better-sqlite3";

import { CaseBoxPersistenceError } from "../errors.js";

/** Tenant + matter + anchor identity for one delete-guard check. */
export interface AnchorDeleteGuardScope {
  readonly tenant_id: string;
  readonly matter_id: string;
  readonly anchor_id: string;
}

/**
 * Assert that the scoped anchor could be deleted — i.e. it exists in `(tenant_id, matter_id)`
 * and is NOT referenced by any `case_box_links` row in that scope. Throws a typed
 * `CaseBoxPersistenceError` otherwise; returns void when a delete would be allowable.
 *
 * - referenced anchor (>=1 scoped link)  -> throws `code: "anchor_referenced"`.
 * - missing/unknown scoped anchor         -> throws `code: "invalid_argument"`.
 * - existing, unreferenced anchor         -> returns void (allowed). **Deletes nothing.**
 *
 * This guard performs NO physical delete, no link-status change, and emits no audit event;
 * repeated calls are idempotent. The checks run in one BEGIN IMMEDIATE transaction so a
 * future check+delete is race-safe (A3-CASCADE-00 §9).
 */
export function assertCanDeleteAnchor(db: Database, scope: AnchorDeleteGuardScope): void {
  if (typeof scope?.tenant_id !== "string" || scope.tenant_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "assertCanDeleteAnchor: tenant_id is required");
  }
  if (typeof scope?.matter_id !== "string" || scope.matter_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "assertCanDeleteAnchor: matter_id is required");
  }
  if (typeof scope?.anchor_id !== "string" || scope.anchor_id.length === 0) {
    throw new CaseBoxPersistenceError("invalid_argument", "assertCanDeleteAnchor: anchor_id is required");
  }

  const bind = { tenant_id: scope.tenant_id, matter_id: scope.matter_id, anchor_id: scope.anchor_id };

  // One BEGIN IMMEDIATE transaction over the existence + reference checks (read-only here; the
  // write lock is what makes the FUTURE check+delete atomic). better-sqlite3 rolls back on throw.
  const check = db.transaction((): void => {
    const anchor = db
      .prepare(
        `SELECT 1 FROM case_box_anchors
         WHERE id = @anchor_id AND tenant_id = @tenant_id AND matter_id = @matter_id`,
      )
      .get(bind);
    if (anchor === undefined) {
      throw new CaseBoxPersistenceError(
        "invalid_argument",
        `assertCanDeleteAnchor: anchor ${scope.anchor_id} not found in scope`,
      );
    }

    const ref = db
      .prepare(
        `SELECT COUNT(*) AS c FROM case_box_links
         WHERE anchor_id = @anchor_id AND tenant_id = @tenant_id AND matter_id = @matter_id`,
      )
      .get(bind) as { c: number };
    if (ref.c > 0) {
      throw new CaseBoxPersistenceError(
        "anchor_referenced",
        `assertCanDeleteAnchor: anchor ${scope.anchor_id} is referenced by ${ref.c} link(s); refusing delete (unlink first)`,
      );
    }
    // else: existing + unreferenced -> allowed. NO physical delete here.
  });

  check.immediate();
}
