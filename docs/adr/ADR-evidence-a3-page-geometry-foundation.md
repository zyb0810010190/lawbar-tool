# ADR A3-PAGE-00 — DocumentPage / DocumentPageGeometry foundation + A3-SCHEMA-00 reconciliation

**Status**: Accepted (foundation/reconciliation CONTRACT — design only; authorizes no schema, migration, or
code).
**Date**: 2026-06-23.
**WI**: WI-A3-PAGE-00 (Type PLAN; design-only; NOT A0.7-gated).
**Reconciles**: `ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 §6 note) against the substrate
chosen by `ADR-evidence-a3-persistence-substrate.md` (A3-DB-00). Entity shapes: handover §10. Page identity
owner per `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 INV-A3-1).

## 1. Context — the conflict

A3-SCHEMA-00 binds the A3 `Anchor` via `FK → DocumentPage` (page identity) and `FK → DocumentPageGeometry`
(geometry version). A pre-flight investigation for the schema implementation (verified read-only) found:

1. **No SQLite foreign keys.** `services/case-box-persistence` uses **no FK constraints by explicit design**
   (`src/sqlite/schema.ts:14` and `:134`): *"NO FOREIGN KEY constraints between tables … application-layer
   invariants enforce correctness"* (for SQLite `ALTER` flexibility).
2. **No `DocumentPage` / `DocumentPageGeometry` tables.** Neither exists — nor any page-identity or geometry
   concept — in `case-box-persistence` or the `case-box-contract` package. `case_box_documents` is
   document-level only (`id, tenant_id, matter_id, status, doc_type, supersedes_document_id, payload_json`).

So "A3-T1-IMPL = schema-only V9 with FKs to DocumentPage/DocumentPageGeometry" is **not implementable as
written**: the FK targets don't exist and the package forbids FKs. The user chose **Option C**: sequence a
prerequisite page/geometry foundation BEFORE the anchor/link schema, and reconcile the FK language.

This ADR is design-only. It writes no schema, migration, or code, adds no dependency, changes no FK convention,
and changes no encryption/key-management decision.

## 2. Decisions

1. **No SQLite FKs — app-layer invariants.** `case-box-persistence` does not use SQLite FK constraints. Every
   A3 "FK →" (A3-SCHEMA-00 §3 + A3-PAGE-00) is realized as a **NOT NULL column + an app-layer invariant**
   unless a future substrate WI changes the convention (decision 10).
2. **DocumentPage must exist before anchors can be persisted.** It is the page-identity + citation-identity
   owner an anchor references.
3. **DocumentPageGeometry must exist before anchors can bind geometry provenance.** It is the geometry-version
   owner an anchor's `geometryCapturedAt` references.
4. **A3-T1-IMPL (anchor/link schema) is DEFERRED** until both foundations exist (sequence in the plan).
5. **DocumentPage — page-identity owner** (engine-neutral, from handover §10):
   `{ id, documentId, physicalPageIndex, citationVolume?, citationPageLabel, citationPageSortKey?, isCitable,
   note? }` with **`UNIQUE(documentId, physicalPageIndex)`** (the canonical page identity). `documentId`
   references `case_box_documents.id` by app-layer invariant. Page `status` is added only if a later WI needs
   it (not invented here). Citation labels are non-unique; citation identity is byte-stable
   (`documentId + physicalPageIndex → citationVolume + citationPageLabel`).
6. **DocumentPageGeometry — geometry-version owner** (from handover §10):
   `{ documentId, physicalPageIndex, resolvedBox: "cropBox"|"mediaBox", boundsX, boundsY, boundsWidth,
   boundsHeight, rotation, pdfKitVersion?, capturedAt }` with **`UNIQUE(documentId, physicalPageIndex)`**;
   `capturedAt` is the geometry **version** (= the anchor's `geometryCapturedAt`). It carries enough provenance
   to let the resolver detect **absent** (no geometry row for that page/version), **ambiguous** (more than one
   candidate version in scope), and **mismatched** (anchor version ≠ current) geometry — fail-closed, never a
   stale/guessed location.
7. **No viewport/screen coordinates.** All geometry is PDF page space (lower-left origin, 72 dpi); the resolved
   box + bounds + rotation are the only coordinate basis. No viewport/screen/DOM/CSS pixel ever persists.
8. **No production evidence ingestion enabled.** This ADR + its prerequisite WIs work on synthetic fixtures
   only; the A3-DB-00 §5 HARD STOP (encryption-at-rest + key management required before production evidence
   ingestion) stands unchanged.
9. **No encryption/key-management decision changed.** A3-DB-00's deferral + hard stop are untouched.
10. **No FK constraints** are introduced unless a separate, user-authorized substrate WI changes the
    case-box-persistence no-FK convention.

### App-layer identity invariant (folds review Low)

Because SQLite FKs are out of scope, the binding between geometry and page identity is an **explicit app-layer
invariant**, stated here so implementers do not invent a second page-identity path:

> Every `DocumentPageGeometry` row's `(documentId, physicalPageIndex)` MUST reference the **same canonical page
> identity** owned by a `DocumentPage` row (`UNIQUE(documentId, physicalPageIndex)`) — there is exactly ONE
> page-identity owner (`DocumentPage`), and geometry rows + anchors bind to it by `(documentId,
> physicalPageIndex)`, never via a parallel identity. `DocumentPageGeometry.capturedAt` is the geometry
> **version within that page**; an `Anchor`'s `geometryCapturedAt` must equal a `DocumentPageGeometry.capturedAt`
> for the same `(documentId, physicalPageIndex)`. All three relationships (Page↔Geometry, Anchor↔Page,
> Anchor↔Geometry-version) are NOT-NULL-column + app-layer-invariant, not SQLite FKs.

## 3. Prerequisite implementation sequence (each its own A0.7-gated WI)

```
WI-A3-PAGE-T1   IMPL   DocumentPage schema (case-box-persistence V9): page-identity + citation-identity table
                       per decision 5 (NOT NULL columns; UNIQUE(documentId, physicalPageIndex); no FK; no
                       implicit defaults that fabricate identity). A0.7-GATED (custody 9b). Verify: schema
                       asserts + the case-box hardening-schema pattern.
WI-A3-PAGE-T2   IMPL   DocumentPageGeometry schema (V10): geometry-version table per decision 6 (resolved box/
                       bounds/rotation + capturedAt version; UNIQUE(documentId, physicalPageIndex); app-layer
                       identity invariant per §2). A0.7-GATED. Depends: WI-A3-PAGE-T1.
WI-A3-T1-IMPL   IMPL   Anchor + Link schema (V11) per A3-SCHEMA-00 §3 (as reconciled: NOT NULL columns + app-
                       layer invariants, LinkStatus CHECK no DEFAULT 'valid', page_ratio 12-dp TEXT). A0.7-GATED.
                       Depends: WI-A3-PAGE-T1, WI-A3-PAGE-T2. (The earlier "V9" naming is superseded; the
                       foundations take V9/V10, anchors take V11.)
```
Every WI above is A0.7-DEPENDENT (`Requires-A07: yes`, custody mode 9b), a migration (schema-version bump), and
NOT a new dependency (reuses `better-sqlite3`). None enables production evidence ingestion.

## 4. Consequences + open items

- **Positive**: the merged A3-SCHEMA-00 no longer contradicts the substrate (FK → app-layer invariant
  recorded); the missing page/geometry foundations are explicit prerequisites with a clear sequence; the single
  page-identity owner is named so no parallel identity path is invented; viewport-exclusion, the encryption
  hard stop, and Evidence invariants are preserved.
- **Open (preserved, not decided here)**: page `status` (added only if a later WI needs it); a stronger
  immutable geometry-version key than `capturedAt` (A3-SCHEMA-00 decision 2); the anchor-delete cascade
  (A3-CONTRACT-00 decision 9 — still unresolved); encryption-at-rest + key management before production
  evidence ingestion (A3-DB-00 §5); any change to the no-FK convention.

## References
- `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 §6 reconciliation note),
  `docs/adr/ADR-evidence-a3-persistence-substrate.md` (A3-DB-00),
  `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 INV-A3-1).
- `services/case-box-persistence/src/sqlite/schema.ts` (no-FK convention :14/:134; V8; document-level only —
  read-only reference). `Evidence-Genie-M0-Developer-Handover.md` §10 (DocumentPage/DocumentPageGeometry shapes).
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — impl WIs A0.7-gated, custody 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-page-geometry-foundation-00.md` (the prerequisite WI plan).
