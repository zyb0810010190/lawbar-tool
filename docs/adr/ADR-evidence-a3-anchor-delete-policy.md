# ADR A3-CASCADE-00 — Evidence-Genie M0 A3 anchor-delete / cascade policy

**Status**: Accepted (anchor-delete policy CONTRACT — design only; authorizes no delete code, schema, or
migration).
**Date**: 2026-06-25.
**WI**: WI-A3-CASCADE-00 (Type PLAN; design-only; NOT A0.7-gated).
**Resolves**: the anchor-delete / cascade policy left UNRESOLVED by `ADR-evidence-a3-schema-persistence-contract.md`
(A3-SCHEMA-00 decision 5) and `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 decision 9), and deferred
as non-inferable by `ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 §7).
**Composes under**: the merged V11 schema (`case_box_anchors` + `case_box_links`: no FK, no ON DELETE cascade),
the resolver (`resolveLinkStatuses`: missing anchor -> `broken`), and the export builder (`buildExportCitations`:
missing anchor -> deterministic `BROKEN`, A10 no-drop).

## 1. Context

A3 anchors are the load-bearing target of a court-facing citation: a `case_box_links` row references an
`anchor_id`, and the resolver + export builder turn `(link, anchor, page, geometry)` into a `LinkStatus` and a
卷X页Y citation. The case-box convention uses NO SQLite foreign keys — all referential integrity is an app-layer
invariant — so SQLite will NOT itself prevent deleting an anchor that a link still references, and there is no
`ON DELETE CASCADE`. This ADR fixes the **anchor-delete policy** BEFORE any delete behavior is implemented, so a
delete can never silently destroy or degrade evidence links. It writes no delete code, no schema, no migration,
and changes no resolver/export behavior.

## 2. Policy: reject deletion of a referenced anchor (decision 1)

**An anchor that is referenced by ANY `case_box_links` row MUST NOT be physically deleted.** A future delete
operation MUST reject/block such a deletion at the application layer (a typed refusal — e.g. a
`CaseBoxPersistenceError`), not delete-and-cascade and not delete-and-orphan.

**Why this is safer for legal-evidence integrity**: a referenced anchor is the load-bearing location of a
citation. Deleting it would force one of two unacceptable outcomes — (a) a silent cascade that also deletes the
`case_box_links` rows (destroying evidence links behind the user's back), or (b) orphaned links whose
`anchor_id` no longer resolves. Both destroy or degrade court-facing evidence trust without an explicit,
audited human action. Refusing the delete preserves the citation target until the user takes a deliberate,
separate unlink action (§4). There is **no `ON DELETE CASCADE`, no implicit physical cascade, no silent link
deletion, and no automatic clean export from a deleted/missing anchor.**

## 3. Unreferenced-anchor delete (decision 2) — DEFERRED to product

Whether an anchor with **no** referencing links may be physically deleted is a product/retention question, NOT
required to resolve the cascade hazard (the safety-critical case is referenced-anchor deletion, §2). It is
**deferred to an explicit product decision** and not decided here. When it is decided, "unreferenced" MUST be
defined narrowly as **no scoped `case_box_links` rows reference the anchor at the time of a transactional delete**
(evaluated inside the same write transaction as the delete, §9), and the decision MUST separately consider
history/audit retention. This ADR does NOT authorize any physical anchor delete.

## 4. Link delete / unlink (decision 3) — a SEPARATE future workflow

Removing a link from an anchor (unlink / break-link) is a **separate, explicit, audited future WI**, NOT part of
anchor delete and NEVER an implicit cascade. The user breaks a link deliberately; the system never breaks links
as a side effect of deleting an anchor. Only after a referenced anchor's links are explicitly unlinked (by that
future workflow) could the anchor become unreferenced and thus a candidate for the §3 (still-deferred) delete.

## 5. The `broken` safety net (decision 4) — not a deletion path

The resolver's missing-anchor -> `broken` behavior (A3-RESOLVE-00 §3 rung 1) remains valid as a **safety net for
corrupted / manual / inconsistent state** (e.g. a hand-edited DB, a partial import, a bug). It MUST NOT be
treated as the normal deletion workflow, and MUST NOT be read as permission to cascade-delete anchors: "the
resolver will just mark it broken" is NOT a license to delete a referenced anchor. The normal path is §2
(refuse) + §4 (explicit unlink); `broken` only catches inconsistency that should not have happened.

## 6. Export behavior (decision 5) — A10 no-drop preserved

A missing anchor MUST continue to export a **deterministic `BROKEN`** object (`buildExportCitations`,
A3-EXPORT-00 §4/§8): best-effort link/source identity, no 卷X页Y / rect claim, **never a silent omission and
never a clean citation**. This ADR changes no export behavior; it records that the A10 no-drop guarantee holds
regardless of the delete policy.

## 7. Auditability (decision 6) — DEFERRED here; a PREDECESSOR for the destructive WI

Whether anchor-delete rejection / unlink / delete emit audit events is **decided in the future delete/unlink
implementation WI**, not here; if the audit-event shape is unclear, it is deferred to its own WI. This ADR
invents no audit shape. **But (review L2): the future delete/unlink IMPL WI MUST make audit semantics a
predecessor or an explicit acceptance item — an actual unlink/delete MUST NOT ship as an unaudited destructive
evidence operation.** A rejection (refusing to delete a referenced anchor) is non-destructive and may or may not
be audited; an actual destructive unlink/delete must be audited.

## 8. Schema (decision 7) — no FK/cascade, no soft-delete columns this lane

This lane adds **no SQLite foreign key, no `ON DELETE CASCADE`, and no soft-delete / tombstone columns.** The
no-FK convention stands (referential integrity is an app-layer invariant). If soft-delete / tombstoning is later
desired (e.g. to retain deleted-anchor history), it is a **future schema WI** (its own migration + ADR), not
decided here.

## 9. Atomicity requirement for the future delete (decision 1 + review L1)

Because there is no FK, a non-atomic "check whether referenced, then delete" would reopen the orphan-link risk
through a race (a link could be inserted between the check and the delete). The future delete implementation
MUST therefore run the **referenced-anchor check AND the delete attempt in ONE write transaction**, scoped by
tenant/matter and using the `idx_case_box_links_by_anchor` index for the reference lookup. No observable
partial-delete / orphan state.

## 10. A0.7 dependence (decision 8)

This design WI is NOT A0.7-gated. **Any future implementation that changes delete/link semantics** (the
referenced-anchor-delete refusal, the unlink workflow, an unreferenced-anchor delete) MUST declare
`Requires-A07: yes` and run under A07-KEY-00 custody mode 9b. Sequence + deferred items:
`dev-memo/plan-batch-casebox-evidence-a3-cascade-policy-00.md`.

## 11. Consequences + open items

- **Positive**: the cascade hazard is resolved — a referenced anchor cannot be silently destroyed; no
  `ON DELETE CASCADE`, no implicit cascade, no silent link deletion; the `broken` safety net and A10 export
  no-drop are preserved and correctly scoped; the future destructive workflow is bounded (atomic, audited,
  A0.7-gated).
- **Open (preserved, not decided here)**: the unreferenced-anchor-delete final call (deferred to product, §3);
  the unlink/break-link workflow (a separate future WI, §4); the audit-event shape (decided/deferred in the impl
  WI, §7); soft-delete / tombstone schema (a future schema WI, §8).

## References
- `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 decision 5),
  `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 decision 9),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 §7),
  `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 — A10 no-drop).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 `case_box_anchors` + `case_box_links`: no FK, no
  cascade; `idx_case_box_links_by_anchor`), `src/sqlite/linkStatusResolverQueries.ts` (missing anchor ->
  `broken`), `src/sqlite/exportCitationQueries.ts` (missing anchor -> deterministic `BROKEN`) — all READ-ONLY.
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — the future delete impl is 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-cascade-policy-00.md` (the delete/unlink impl WI sequence).
