# BATCH-CASEBOX-EVIDENCE-A3-CASCADE-POLICY-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the delete/unlink
implementation WI sequence + the deferred items from A3-CASCADE-00; does NOT authorize execution.
**Date**: 2026-06-25. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00). Read it first.

## 0. Purpose & scope cut

Sequence the A3 anchor-delete / unlink implementation after the merged V11 schema + resolver + export builder.
**This plan writes no delete/unlink code, schema, migration, FK/cascade, soft-delete columns, resolver/export
change, UI, or dependency.**

## 1. A0.7-dependence

Every delete/link implementation WI below is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` and run under
A07-KEY-00 custody mode 9b (human-run gated `check-gates`; the agent never receives the key; the impl commit is
blocked until the human reports gated PASS). A3-CASCADE-00 (this ADR + plan) is design-only and NOT gated.

## 2. Proposed implementation WI sequence

```
WI-A3-DELETE-T1   IMPL   The referenced-anchor-delete REFUSAL GUARD — negative-path / refusal contract ONLY.
                         T1 ships the guard that REJECTS any anchor-delete attempt when ≥1 case_box_links row
                         references the anchor (A3-CASCADE-00 §2): the referenced-anchor check runs atomically with
                         any delete attempt in ONE write transaction, scoped by tenant/matter, using
                         idx_case_box_links_by_anchor (A3-CASCADE-00 §9 — no non-atomic check-then-delete race),
                         throwing a typed refusal (CaseBoxPersistenceError) on a referenced anchor. T1 does NOT ship
                         a physical unreferenced-anchor delete (review L1 / audit Low): physically deleting an
                         UNREFERENCED anchor stays gated on the product decision in WI-A3-UNREF-DELETE and MUST NOT
                         land in T1. NO ON DELETE CASCADE, NO implicit cascade, NO silent link deletion. AUDIT:
                         decide emit-or-defer; audit semantics are a PREDECESSOR/acceptance item (review L2) — a
                         destructive op must not ship unaudited. NO schema change unless a separate schema WI lands
                         soft-delete first. A0.7-GATED (custody 9b). Verify: referenced-anchor delete -> rejected
                         (typed error, no row deleted, no link touched); concurrent-insert race -> still safe (atomic
                         txn); export still BROKEN/no-drop for any genuinely-missing anchor. Depends: A3-CASCADE-00,
                         the V11 schema (merged).

WI-A3-UNLINK-T1   IMPL   (Later) The explicit unlink/break-link workflow (A3-CASCADE-00 §4): a deliberate, audited
                         operation that removes a link from an anchor — NEVER an implicit cascade. After a referenced
                         anchor's links are unlinked, the anchor may become a candidate for the (still-deferred)
                         unreferenced delete. A0.7-GATED. Depends: WI-A3-DELETE-T1.

WI-A3-UNREF-DELETE (Later, STOP-AND-ASK / product) The unreferenced-anchor physical-delete decision (A3-CASCADE-00
                         §3): allowed only with an explicit product decision; "unreferenced" = no scoped case_box_links
                         rows at the time of a transactional delete; must consider history/audit retention. A0.7-GATED.
                         Depends: WI-A3-DELETE-T1 (+ product sign-off).
```

## 3. Open / deferred (recorded; each its own decision/WI)

1. **Unreferenced-anchor delete** — DEFERRED to product (A3-CASCADE-00 §3); "unreferenced" defined narrowly (no
   scoped links at transactional-delete time) + history/audit retention considered.
2. **Unlink / break-link workflow** — a SEPARATE future WI (A3-CASCADE-00 §4); explicit + audited; never implicit.
3. **Audit-event shape** — decided in WI-A3-DELETE-T1 (emit or defer); the destructive op MUST NOT ship unaudited
   (review L2); MUST NOT be inferred/invented (A3-CASCADE-00 §7).
4. **Soft-delete / tombstone schema** — a future schema WI (its own migration + ADR) if retention is desired
   (A3-CASCADE-00 §8); not decided here.
5. **Encryption-at-rest + production key management** — the A3-DB-00 §5 hard stop still stands before any
   production evidence ingestion.

## 4. Test strategy (A3-CASCADE-00 §2/§5/§9)

The delete-guard WI's tests MUST prove:
- **reject referenced delete**: deleting an anchor with ≥1 referencing link -> typed refusal; the anchor row and
  ALL referencing links remain unchanged.
- **atomicity (no race)**: the referenced-anchor check + delete run in one transaction; a link inserted
  mid-operation does not produce an orphan.
- **no cascade / no silent link deletion**: no link is ever deleted as a side effect of an anchor delete.
- **safety net intact**: a genuinely missing anchor still resolves -> `broken` and exports -> deterministic
  `BROKEN` (A10 no-drop); deletion is never the path that creates that state.
- Synthetic fixtures only; NO production evidence; NO new dependency.

## 5. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` · `scripts/workflow/check-gates.sh` (A0.7 not required)
- `npm --prefix services/case-box-persistence test` (foundations stay green)
- `npm --prefix apps/lawbar-desktop test` (610/610) · `npm --prefix native/evidence-core test` (38/38)

## 6. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-CASCADE-00). "Outdated" when WI-A3-DELETE-T1 is promoted +
governed, or when A3-CASCADE-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 decision 5),
  `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 decision 9),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 §7),
  `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 A10 no-drop).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 + `idx_case_box_links_by_anchor`),
  `src/sqlite/linkStatusResolverQueries.ts`, `src/sqlite/exportCitationQueries.ts` — READ-ONLY.
