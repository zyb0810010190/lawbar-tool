# BATCH-CASEBOX-EVIDENCE-A3-UNLINK-SCHEMA-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the durable-unlink
schema IMPLEMENTATION WI sequence + the deferred items from A3-UNLINK-SCHEMA-00; does NOT authorize execution.
**Date**: 2026-06-25. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-durable-unlink-schema.md` (A3-UNLINK-SCHEMA-00). Read it first.

## 0. Purpose & scope cut

Sequence the durable-unlink schema (V12) + the explicit unlink operation after the merged V11 + resolver +
export + refusal guard + the A3-UNLINK-SCHEMA-00 mechanism decision. **This plan writes no schema/DDL/migration,
resolver/export change, or unlink code.**

## 1. A0.7-dependence

Every implementation WI below is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` and run under A07-KEY-00
custody mode 9b. A3-UNLINK-SCHEMA-00 (this ADR + plan) is design-only and NOT gated. The V12 migration is
additionally HIGH-RISK (persistence/migration; security-boundary).

## 2. Proposed implementation WI sequence

```
WI-A3-UNLINK-SCHEMA-T1  (SCHEMA IMPL; A0.7-gated, custody 9b) The V12 migration: add the durable unlink-marker
                        columns to case_box_links per A3-UNLINK-SCHEMA-00 §2 — `unlinked_at TEXT` (nullable,
                        COLLATE BINARY) + `unlink_reason TEXT` (nullable; required-iff-unlinked at the app layer).
                        Forward-only ADDITIVE (DDL_STATEMENTS_V12 + DDL_BY_VERSION [12,...]; CURRENT_SCHEMA_VERSION
                        11 -> 12; applySchema upgrades V11 -> V12 additively; existing rows default unlinked_at
                        NULL; no data rewrite). anchor_id stays NOT NULL; LinkStatus unchanged. NO FK/cascade. NO
                        resolver/export behavior change in THIS WI beyond what the migration requires (the
                        marker-awareness may be a tightly-scoped follow-on, WI-A3-UNLINK-RESOLVE, if review-plan
                        prefers to split). A0.7-GATED. Verify: applySchema(:memory:) reaches 12; a V11 DB upgrades
                        additively; the two columns exist + nullable; existing tests stay green; CURRENT_SCHEMA_VERSION
                        == 12. Depends: A3-UNLINK-SCHEMA-00, the V11 schema (merged).

WI-A3-UNLINK-RESOLVE     (IMPL; A0.7-gated) Make the resolver + export RESPECT the marker (A3-UNLINK-SCHEMA-00 §5/§6):
                        the resolver does not recompute a marked link to valid (non-clean result); export reads the
                        marker (not only status) and emits a deterministic non-clean exportFlag distinguishable from
                        structural broken (the exact flag finalized here). A0.7-GATED. Depends: WI-A3-UNLINK-SCHEMA-T1.

WI-A3-UNLINK-T1          (IMPL; A0.7-gated, custody 9b) The explicit unlink/relink OPERATION (A3-UNLINK-00 §2): set
                        the durable marker (unlinked_at + required unlink_reason) — never overload structural broken;
                        anchor + link preserved; terminal-until-relink; relink clears the marker atomically + recomputes;
                        AUDIT a predecessor/acceptance item (must not ship unaudited). A0.7-GATED.
                        Depends: WI-A3-UNLINK-SCHEMA-T1 + WI-A3-UNLINK-RESOLVE.
```

## 3. Test strategy (A3-UNLINK-SCHEMA-00 §5/§6/§9/§10)

- **migration additive (V12)**: applySchema on an empty DB reaches 12; a planted V11 DB upgrades additively to 12;
  the two nullable columns exist; existing V11 rows read `unlinked_at IS NULL`; no data rewrite.
- **marker override (resolver)**: a marked link with structurally-valid anchor/page/geometry does NOT recompute to
  `valid` — the marker keeps it non-clean.
- **marker override (export)**: export reads the marker and emits a non-clean flag distinguishable from structural
  broken; never clean; A10 no-drop best-effort identity.
- **app-layer invariants**: unlink_reason required iff unlinked_at set; terminal-until-relink; relink clears the
  marker atomically + recomputes.
- **invariants preserved**: anchor_id stays NOT NULL; LinkStatus unchanged; no FK/cascade; existing
  resolver/export/guard tests stay green.
- Synthetic fixtures only; NO production evidence; NO new dependency.

## 4. Open / deferred (recorded; each its own decision/WI)

1. **Exact V12 DDL** — authored in WI-A3-UNLINK-SCHEMA-T1 (A3-UNLINK-SCHEMA-00 §2/§8/§10).
2. **Exact non-clean exportFlag for an unlinked link** — finalized in WI-A3-UNLINK-RESOLVE (§6).
3. **Unlink audit-event shape** — decided in WI-A3-UNLINK-T1 (or a predecessor); must not ship unaudited (§7).
4. **The unlink/relink OPERATION** — WI-A3-UNLINK-T1 (A3-UNLINK-00 §2; gated on the V12 + resolve WIs).
5. **Physical-link-delete alternative** — only if a future reviewed policy chooses it (A3-UNLINK-00 §2/§4).
6. **Encryption-at-rest + production key management** — the A3-DB-00 §5 hard stop still stands before any
   production evidence ingestion.

## 5. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` · `scripts/workflow/check-gates.sh` (A0.7 not required)
- `npm --prefix services/case-box-persistence test` (foundations stay green; CURRENT_SCHEMA_VERSION still 11)
- `npm --prefix apps/lawbar-desktop test` (610/610) · `npm --prefix native/evidence-core test` (38/38)

## 6. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-UNLINK-SCHEMA-00). "Outdated" when WI-A3-UNLINK-SCHEMA-T1 is
promoted + governed, or when A3-UNLINK-SCHEMA-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-durable-unlink-schema.md` (A3-UNLINK-SCHEMA-00),
  `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 — additive-migration conventions).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 + DDL_STATEMENTS_VN / DDL_BY_VERSION / applySchema),
  `src/sqlite/linkStatusResolverQueries.ts`, `src/sqlite/exportCitationQueries.ts` — READ-ONLY.
