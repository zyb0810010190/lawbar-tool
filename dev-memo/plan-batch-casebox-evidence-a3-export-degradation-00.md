# BATCH-CASEBOX-EVIDENCE-A3-EXPORT-DEGRADATION-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the export
implementation WI sequence + the deferred items from A3-EXPORT-00; does NOT authorize execution.
**Date**: 2026-06-25. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00). Read it first.

## 0. Purpose & scope cut

Sequence the A3 export-degradation implementation after the merged V9-V11 schema + the merged
`resolveLinkStatuses` resolver. **This plan writes no export code, schema, migration, UI, dependency, cascade,
or document-lifecycle.**

## 1. A0.7-dependence

Every export implementation WI below is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` and run under
A07-KEY-00 custody mode 9b (human-run gated `check-gates`; the agent never receives the key; the impl commit is
blocked until the human reports gated PASS). A3-EXPORT-00 (this ADR + plan) is design-only and NOT gated.

## 2. Proposed implementation WI sequence

```
WI-A3-EXPORT-T1  IMPL   The headless export-citation builder: per link, run resolveLinkStatuses first (same
                        matter/document scope; A3-EXPORT-00 §6), then derive the export-citation object
                        (A3-EXPORT-00 §8): linkStatus (valid|needs_review|broken) + exportFlag
                        (NEEDS_REVIEW|BROKEN|NON_CITABLE|AMBIGUOUS|REPLACED|null) + the DocumentPage-derived
                        卷X页Y citation (present-but-flagged for needs_review; BROKEN object with no page/rect,
                        NEVER omitted, for broken — A10; clean only for valid that also passes the A1/A10
                        isCitable/ambiguous/cross-volume checks). Reads only; writes nothing (or status only via the resolver). NO schema
                        change. DECIDE the audit-event question (emit via an explicitly-authorized shape, OR defer
                        — do NOT infer a shape). NO cascade, NO document-lifecycle. A0.7-GATED (custody 9b).
                        Verify: export tests proving valid->clean 卷X页Y (DocumentPage, never viewport/optimized);
                        valid-but-ambiguous/non-citable -> the right exportFlag (AMBIGUOUS/NON_CITABLE, not a clean
                        citation; valid is NEVER REPLACED); replacement/supersession -> needs_review + NEEDS_REVIEW
                        (or the §3 REPLACED refinement); needs_review -> NEEDS_REVIEW flag + identity preserved + never clean; broken -> BROKEN flag
                        + best-effort source identity + no page/rect; missing -> deterministic BROKEN fallback, no
                        silent omission; deterministic/reproducible (A10). Depends: A3-EXPORT-00, the resolver
                        (merged), the V9-V11 schema (merged).

WI-A3-EXPORT-T2  IMPL   (Later) Canonical export-model integration: fold the export-citation objects into the
                        CanonicalExportModel (A10-T6 byte-identical golden), with the ExportCitationFlag set
                        serialized deterministically. A0.7-GATED. Depends: WI-A3-EXPORT-T1.
```

## 3. Test strategy (A3-EXPORT-00 §3-§8)

The export WI's tests MUST prove citation trust is never violated:
- **valid -> clean**: a valid link that passes A1/A10 checks exports a clean 卷X页Y citation from DocumentPage
  identity (never viewport/rendered/optimized coordinates).
- **valid-but-flagged**: a valid link that is ambiguous / non-citable / cross-volume takes the matching
  exportFlag (AMBIGUOUS / NON_CITABLE), NOT a clean citation (review L1: valid is necessary-not-sufficient). A
  valid link is **never** REPLACED (a replaced/superseded document is already needs_review via resolver-first).
- **needs_review -> NEEDS_REVIEW**: visible flag, DocumentPage identity preserved when available, never clean.
- **replacement/supersession -> needs_review + flag**: a link whose anchored document is superseded resolves to
  linkStatus = needs_review and exports exportFlag = NEEDS_REVIEW by default (or REPLACED if the impl WI adopts
  the §3 refined reason via a resolver status-reason / re-reading the supersession signal); never valid, never a
  clean citation (A3-EXPORT-00 §3 precedence).
- **broken -> BROKEN**: visible flag, best-effort source identity, NO 卷X页Y / rect claim.
- **missing page/geometry/anchor -> deterministic BROKEN fallback**: no silent omission.
- **linkStatus != exportFlag**: the object keeps both fields distinct (review L2).
- **resolver-first ordering**: the export runs resolveLinkStatuses before deriving citations; a stale stored
  status is refreshed, never trusted as-is.
- **determinism (A10)**: identical inputs -> identical export-citation objects (stable serialization).
- Synthetic fixtures only; NO production evidence; NO new dependency.

## 4. Open / deferred (recorded; each its own decision/WI)

1. **Export audit-event shape** — decided in WI-A3-EXPORT-T1 (emit via an authorized shape OR defer); MUST NOT
   be inferred/invented (A3-EXPORT-00 §7).
2. **ExportCitationFlag serialization + the A1/A10 citation-contract checks** (isCitable / ambiguous /
   cross-volume) — finalized in the impl WI (A3-EXPORT-00 §3, §10).
3. **Anchor-delete cascade** — UNRESOLVED; a future stop-and-ask WI (A3-SCHEMA-00 decision 5 / A3-CONTRACT-00
   decision 9). The export design does not depend on it.
4. **Full Evidence document lifecycle** (canonical -> replaced_pending_review -> superseded) — a future schema
   WI; until then a superseded link is `needs_review` with `exportFlag = NEEDS_REVIEW` by default, and the
   distinct `REPLACED` flag (A3-EXPORT-00 §3 precedence rung 2) is the impl-WI refinement decision (resolver
   status-reason or re-reading the supersedes_document_id signal), not a silent guess.
5. **Encryption-at-rest + production key management** — the A3-DB-00 §5 hard stop still stands before any
   production evidence ingestion/export.

## 5. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` · `scripts/workflow/check-gates.sh` (A0.7 not required)
- `npm --prefix services/case-box-persistence test` (foundations stay green)
- `npm --prefix apps/lawbar-desktop test` (610/610) · `npm --prefix native/evidence-core test` (38/38)

## 6. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-EXPORT-00). "Outdated" when WI-A3-EXPORT-T1 is promoted +
governed, or when A3-EXPORT-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00),
  `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00),
  `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00).
- `services/case-box-persistence/src/sqlite/linkStatusResolverQueries.ts` (resolveLinkStatuses — READ-ONLY).
- `Evidence-Genie-M0-Developer-Handover.md` §A10 (ExportCitationFlag; CanonicalExportModel) + §A1.
