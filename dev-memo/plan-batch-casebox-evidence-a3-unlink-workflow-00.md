# BATCH-CASEBOX-EVIDENCE-A3-UNLINK-WORKFLOW-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the unlink
implementation WI sequence + the deferred items from A3-UNLINK-00; does NOT authorize execution.
**Date**: 2026-06-25. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00). Read it first.

## 0. Purpose & scope cut

Sequence the A3 unlink/break-link implementation after the merged V11 schema + resolver + export + refusal
guard. **This plan writes no unlink/delete code, schema, migration, FK, soft-delete columns, or
resolver/export/guard change.**

## 1. A0.7-dependence + the schema predecessor

Every unlink implementation WI below is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` and run under
A07-KEY-00 custody mode 9b. A3-UNLINK-00 (this ADR + plan) is design-only and NOT gated. **The first unlink
implementation is additionally GATED on a durable-unlink schema decision** (A3-UNLINK-00 §2/§6/§8): a status-only
unlink is non-durable (the resolver revalidates it), so a durable, link-preserving unlink needs a schema
mechanism first.

## 2. Proposed implementation WI sequence

```
WI-A3-UNLINK-SCHEMA  (Predecessor; SCHEMA WI; A0.7-gated) The durable-unlink schema mechanism A3-UNLINK-00 §2/§6/§8
                     requires — ONE of: a durable unlink reason/flag column the resolver respects (preferred); a
                     new `unlinked` LinkStatus value + resolver awareness; or a nullable anchor_id (+ reason). Its
                     own migration + ADR; decides the mechanism (NOT decided in A3-UNLINK-00). Depends: A3-UNLINK-00.

WI-A3-UNLINK-T1      (IMPL; A0.7-gated, custody 9b) The explicit unlink/break-link operation: detaches a link from
                     its anchor by writing the durable unlink marker from WI-A3-UNLINK-SCHEMA (NEVER a status-only
                     'broken'); the anchor row is preserved (A3-UNLINK-00 §3); the link row is preserved
                     (A3-UNLINK-00 §4) unless a reviewed policy chose the physical-link-delete alternative; the
                     resolver MUST respect the durable marker (short-circuit a flagged link, not recompute it —
                     A3-UNLINK-00 §6); export maps the unlinked link to a non-clean exportFlag (A3-UNLINK-00 §5);
                     never an implicit cascade; NO anchor delete. AUDIT: emit via an explicitly-authorized shape OR
                     a predecessor audit-shape WI — the unlink MUST NOT ship unaudited (A3-UNLINK-00 §7). A0.7-GATED.
                     Verify: unlink writes the durable marker; a subsequent resolver/export run does NOT revalidate
                     it to valid/clean; anchor + link preserved; export degraded non-clean; audited.
                     Depends: WI-A3-UNLINK-SCHEMA.
```

## 3. Test strategy (A3-UNLINK-00 §2/§5/§6)

The unlink IMPL WI's tests MUST prove:
- **durability (the load-bearing case)**: after an explicit unlink, a subsequent `resolveLinkStatuses` +
  `buildExportCitations` run does NOT revalidate the link to `valid` / a clean citation — the durable marker
  survives.
- **anchor preserved**: the anchor row remains after unlink.
- **link preserved**: the link row remains (recommended durable path) unless physical-link-delete was chosen.
- **export degraded**: an unlinked link exports a non-clean exportFlag with best-effort identity (A10 no-drop).
- **not implicit cascade**: unlink touches only the one link; no anchor delete, no other link affected.
- **audited**: the unlink emits the authorized audit event (or the predecessor audit WI is in place).
- Synthetic fixtures only; NO production evidence; NO new dependency in the IMPL beyond the schema WI's mechanism.

## 4. Open / deferred (recorded; each its own decision/WI)

1. **Durable-unlink schema mechanism** — WI-A3-UNLINK-SCHEMA (A3-UNLINK-00 §2/§8); the reason/flag vs `unlinked`
   status vs nullable anchor_id choice is NOT decided in A3-UNLINK-00.
2. **The exportFlag an unlinked link maps to** — finalized with the schema mechanism (A3-UNLINK-00 §5).
3. **Audit-event shape** — decided in WI-A3-UNLINK-T1 (emit or a predecessor WI); the unlink MUST NOT ship
   unaudited (A3-UNLINK-00 §7).
4. **Physical-link-delete alternative** — only if a future reviewed policy chooses it over link preservation
   (A3-UNLINK-00 §2/§4).
5. **Unreferenced-anchor delete + soft-delete/tombstone** — separate deferred WIs (A3-CASCADE-00 §3/§8).
6. **Encryption-at-rest + production key management** — the A3-DB-00 §5 hard stop still stands before any
   production evidence ingestion.

## 5. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` · `scripts/workflow/check-gates.sh` (A0.7 not required)
- `npm --prefix services/case-box-persistence test` (foundations stay green)
- `npm --prefix apps/lawbar-desktop test` (610/610) · `npm --prefix native/evidence-core test` (38/38)

## 6. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-UNLINK-00). "Outdated" when WI-A3-UNLINK-SCHEMA is promoted +
governed, or when A3-UNLINK-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00),
  `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00 §4),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00),
  `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 A10 no-drop).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 `case_box_links`),
  `src/sqlite/linkStatusResolverQueries.ts`, `src/sqlite/exportCitationQueries.ts`,
  `src/sqlite/anchorDeleteGuardQueries.ts` — READ-ONLY.
