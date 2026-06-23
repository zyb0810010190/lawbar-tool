# BATCH-CASEBOX-EVIDENCE-A3-PAGE-GEOMETRY-FOUNDATION-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the prerequisite
implementation sequence + open hard stops from the A3-PAGE-00 reconciliation; does NOT authorize execution.
**Date**: 2026-06-23. **Type**: PLAN (reconciliation / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00) + the A3-SCHEMA-00 §6 note.

## 0. Purpose & scope cut

A pre-flight investigation found A3-T1-IMPL un-buildable as specified: case-box-persistence uses no FKs and has
no `DocumentPage` / `DocumentPageGeometry` tables. Per **Option C** (user-chosen), this records the prerequisite
foundation sequence + the FK reconciliation. **This plan writes no schema, migration, code, or dependency.**

## 1. Why A3-T1-IMPL must wait

- `Anchor` references page identity (`documentId + physicalPageIndex`) — owned by `DocumentPage` — and geometry
  provenance (`geometryCapturedAt`) — owned by `DocumentPageGeometry`. Neither table exists yet.
- Building anchor/link schema first would create rows referencing non-existent identity/geometry owners (the
  rejected Option A). Option C builds the foundations first.

## 2. Prerequisite implementation WI sequence (each separate + A0.7-gated, custody mode 9b)

```
WI-A3-PAGE-T1   IMPL   DocumentPage schema in case-box-persistence (V9): page/citation identity table per
                       A3-PAGE-00 decision 5 — NOT NULL columns, UNIQUE(documentId, physicalPageIndex), no FK,
                       no fabricated-identity defaults. No UI/product, no resolver. Tests: schema applies from
                       empty + upgrades from V8 without data loss; schema_version -> 9; UNIQUE enforced;
                       documentId references case_box_documents.id by app-layer invariant.
                       A0.7-GATED. Depends: A3-PAGE-00 (this ADR).

WI-A3-PAGE-T2   IMPL   DocumentPageGeometry schema (V10): geometry-version table per A3-PAGE-00 decision 6 —
                       resolved box (cropBox|mediaBox) + bounds + rotation + capturedAt version,
                       UNIQUE(documentId, physicalPageIndex); the app-layer identity invariant (geometry's
                       (documentId, physicalPageIndex) references the same DocumentPage identity; no second
                       path). Tests: applies/upgrades; UNIQUE; capturedAt version present; no viewport columns.
                       A0.7-GATED. Depends: WI-A3-PAGE-T1.

WI-A3-T1-IMPL   IMPL   Anchor + Link schema (V11) per A3-SCHEMA-00 §3 as reconciled (NOT NULL columns + app-
                       layer invariants instead of FKs; LinkStatus CHECK, no DEFAULT 'valid'; page_ratio as
                       12-dp TEXT; geometryCapturedAt NOT NULL). A0.7-GATED. Depends: WI-A3-PAGE-T1,
                       WI-A3-PAGE-T2. Acceptance (restated): A0.7-gated, schema-only, no new dependency, no
                       key management, no UI, no resolver/status, no production-evidence-ingestion enablement.
```

Note: the earlier A3-DB-00 "V9 = anchors" framing is superseded — foundations take V9/V10, anchors take V11.
Every WI is A0.7-DEPENDENT, a migration (forward-only; rollback via git revert + a new forward version), and
NOT a new dependency (reuses `better-sqlite3`).

## 3. Open hard stops (recorded; each its own user-authorized WI)

1. **Encryption-at-rest + production key management** — REQUIRED before production evidence ingestion
   (A3-DB-00 §5). Unchanged by this lane.
2. **No-FK convention change** — only via a separate substrate WI (A3-PAGE-00 decision 10).
3. **Anchor-delete cascade** — unresolved (A3-CONTRACT-00 decision 9 / A3-SCHEMA-00 decision 5).
4. **Stronger immutable geometry-version key** than `capturedAt` — A3-SCHEMA-00 decision 2.

## 4. Verification (this reconciliation PR)

Docs-only (the new ADR + the A3-SCHEMA-00 §6 note + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh`
- `scripts/workflow/check-gates.sh` (A0.7 gate not required)
- `npm --prefix apps/lawbar-desktop test` (610/610)
- `npm --prefix native/evidence-core test` (38/38)

## 5. Stop condition

"Done" when the foundation ADR + the A3-SCHEMA-00 note + this plan are committed (WI-A3-PAGE-00). "Outdated"
when WI-A3-PAGE-T1 is promoted + governed, or when A3-PAGE-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 §6),
  `docs/adr/ADR-evidence-a3-persistence-substrate.md` (A3-DB-00),
  `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00).
- `services/case-box-persistence/src/sqlite/schema.ts` (V8; no-FK convention).
