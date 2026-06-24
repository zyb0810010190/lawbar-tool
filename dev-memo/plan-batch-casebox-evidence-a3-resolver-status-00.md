# BATCH-CASEBOX-EVIDENCE-A3-RESOLVER-STATUS-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the resolver
implementation WI sequence + the deferred items from A3-RESOLVE-00; does NOT authorize execution.
**Date**: 2026-06-24. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00). Read it first.

## 0. Purpose & scope cut

Sequence the A3 resolver/status-transition implementation after the merged V9-V11 schema foundation. **This
plan writes no resolver code, schema, migration, export, UI, dependency, or cascade resolution.**

## 1. A0.7-dependence

Every resolver/status implementation WI below is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` and run
under A07-KEY-00 custody mode 9b (human-run gated `check-gates`; the agent never receives the key; the impl
commit is blocked until the human reports gated PASS). A3-RESOLVE-00 (this ADR + plan) is design-only and NOT
gated.

## 2. Proposed implementation WI sequence

```
WI-A3-T5-RESOLVE  IMPL   The follow-link resolver: compute case_box_links.status per the A3-RESOLVE-00 §3
                         precedence ladder (broken > needs_review > valid; valid never default) from anchors +
                         V9 pages + V10 geometries + case_box_documents.status/supersedes_document_id.
                         Deterministic + idempotent; atomic per document/matter scope. Reads only; writes only
                         case_box_links.status. NO schema change (uses the merged V9-V11). DECIDE the
                         audit-event question (emit via an explicitly-authorized shape, OR defer to a separate
                         WI — do NOT infer a shape). NO cascade. A0.7-GATED (custody 9b). Verify: resolve-links
                         tests proving the ladder (mismatch -> needs_review; replacement -> needs_review;
                         missing page/geometry/anchor -> broken; all-good -> valid; never-default-valid;
                         idempotent re-run). Depends: A3-RESOLVE-00, the V9-V11 schema (merged).

WI-A3-export      IMPL   (Later) Export degradation: in-app link -> textual 卷X页Y or an ExportCitationFlag
                         (A10-T2 bijection; never dropped/silently wrong). A0.7-GATED. Depends: WI-A3-T5-RESOLVE.

WI-A3-cascade     IMPL   (Later, STOP-AND-ASK) Anchor-delete cascade — resolve the UNRESOLVED policy
                         (broken-with-audit vs hard-delete) with the user FIRST, then implement. A0.7-GATED.
                         Depends: WI-A3-T5-RESOLVE.
```

## 3. Test strategy (A3-RESOLVE-00 §3-§5)

The resolver WI's tests MUST prove the precedence ladder deterministically:
- **broken**: a link whose page identity / geometry record / anchor target is missing resolves to `broken`.
- **needs_review (mismatch)**: `anchor.geometry_captured_at` != the current V10 `captured_at` -> `needs_review`.
- **needs_review (replacement)**: the owning document leaving `canonical` / supersession -> `needs_review`.
- **valid**: all present, geometry matches, document `canonical`, source resolves -> `valid`.
- **never-default-valid**: a link is never `valid` unless the §3 ladder yields rung 3.
- **combined-state determinism**: e.g. "mismatch + missing target" -> `broken` (rung 1 wins).
- **idempotence**: re-running the resolver on unchanged inputs produces no status change / no spurious writes.
- Synthetic fixtures only; NO production evidence; NO new dependency.

## 4. Open / deferred (recorded; each its own decision/WI)

1. **Audit-event shape** — decided in WI-A3-T5-RESOLVE (emit via an authorized shape OR defer); MUST NOT be
   inferred/invented (A3-RESOLVE-00 §7).
2. **Anchor-delete cascade** — UNRESOLVED; a future **stop-and-ask** WI; the resolver MUST NOT infer cascade
   semantics (A3-RESOLVE-00 §7).
3. **Export degradation** — a later A0.7-gated WI (A10-T2 bijection).
4. **case_box_documents.status lifecycle value set** — confirmed against the case-box document contract in the
   impl WI (this design keys on "left `canonical`", not on inventing values).
5. **Encryption-at-rest + production key management** — the A3-DB-00 §5 hard stop still stands before any
   production evidence ingestion.

## 5. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` · `scripts/workflow/check-gates.sh` (A0.7 not required)
- `npm --prefix services/case-box-persistence test` (foundations stay green)
- `npm --prefix apps/lawbar-desktop test` (610/610) · `npm --prefix native/evidence-core test` (38/38)

## 6. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-RESOLVE-00). "Outdated" when WI-A3-T5-RESOLVE is promoted +
governed, or when A3-RESOLVE-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00),
  `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00),
  `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00).
- `services/case-box-persistence/src/sqlite/schema.ts` (V9-V11 + case_box_documents).
