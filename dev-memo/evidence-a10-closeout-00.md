# Evidence A10 (court-fileable export) — closeout (A10-CLOSEOUT-00)

**Date**: 2026-06-30. **Type**: CLOSURE (documentation / governance / backlog-classification only; no
production code, no schema, no fixtures, no IPC, no native, no tests). **Lane**:
WI-EVIDENCE-A10-CLOSEOUT-AND-BACKLOG-CLASSIFICATION-00.

Authoritative artifacts: `docs/adr/ADR-evidence-a10-court-fileable-export.md` (A10-DESIGN-00) and
`.claude/rules/evidence-genie.md` (invariants 5/6/7/9/10). This note records what is complete and what is
deliberately NOT authorized; it builds nothing and changes no behavior.

## 1. A10 non-gated technical implementation is COMPLETE through live-pipeline wiring

The A10 court-fileable-export technical pipeline is implemented and on `main`. Each WI was per-WI
cc-suite reviewed/audited/verified, merged via a scoped PR, and Layer-B batch-closed:

| A10 piece | WI | Impl commit | Merge commit |
|---|---|---|---|
| Citation-render contract | WI-EVIDENCE-A10-T1-CITATION-RENDER-CONTRACT-00 | `7668227` | `13f10eb` (PR #158) |
| Hyperlink degradation | WI-EVIDENCE-A10-T2-HYPERLINK-DEGRADATION-00 | `60a4745` | `725c017` (PR #159) |
| Apps-layer CanonicalExportModel + golden fixture | WI-EVIDENCE-A10-T6-GOLDEN-CANONICAL-EXPORT-00 | `302c18f` | `0742464` (PR #160) |
| Native golden-export gate | WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00 | `f2a529c` | `033e1cb` (PR #161) |
| Live-pipeline wiring | WI-EVIDENCE-A10-LIVE-PIPELINE-WIRING-00 | `e8cb194` | `7bda6b3` (PR #162) |

"Non-gated" here means: the engineering pipeline is done; the only remaining A10 tickets (T3/T4/T5 forms)
are product-legal-gated (see §3), not engineering-blocked.

## 2. The authoritative A10 export path

The current, authoritative A10 export path is:

> **A10-T1/T2/T6 apps contract → native A10 golden-export gate → live `casebox:link:export` additive `canonicalExport`.**

- **A10-T1** (`apps/lawbar-desktop/src/caseBox/export/a10CitationContract.ts`) is the single source of citation
  rendering: `卷X页Y` derived from `DocumentPage` (A1), versions pinned, the `ExportCitationFlag` vocabulary
  owned.
- **A10-T2** (`a10HyperlinkDegradation.ts`) maps each citation to text-or-flag; `internalHref` is
  non-authoritative in-app nav metadata only.
- **A10-T6** (`a10CanonicalExportModel.ts` + the golden fixture `tests/fixtures/a10-golden-canonical-export.json`)
  is the deterministic logical `CanonicalExportModel` (stable key/row order, NFC, no timestamps/paths) hashed
  by `canonicalModelSha256` — the reproducibility unit. It hashes the logical model, never raw `.docx`/PDF bytes.
- **Native A10 golden-export gate** (`native/evidence-core-swift` `a10-golden-export-cli` /
  `EvidenceCoreA10GoldenExport`) is the truthful CI gate over the A10-T6 golden (integrity + shape + no-href +
  rows + citation identity `卷X页Y` + whole-model consistency); `not_implemented` is never its result.
- **Live wiring** (`a10LivePipeline.ts` consumed by `exportLinkCitationsHandler`) attaches the deterministic
  `canonicalExport` (model + sha256) to the existing `casebox:link:export` result **additively** (the
  pre-existing `citations`/`byFlag` fields are preserved), by reusing A10-T1/T2/T6 — so the live model is
  byte-identical to (compatible with) the native gate by construction. No new IPC channel.

## 3. A10-T3/T4/T5 forms are PRODUCT-LEGAL-GATED — NOT authorized for implementation

The remaining A10 tickets — **T3 (证据目录 / evidence index), T4 (举证质证表), T5 (质证记录)** court-filing
forms — are **product-legal-gated** and **MUST NOT be implemented** without a separate product/legal design
decision that specifies each form's field layout for the target court. Per the A10 ADR (§10) the form-field
layout is explicitly out of scope of the technical pipeline. These are not engineering-blocked; they are
**blocked on a product/legal form-spec**. No T3/T4/T5 work is authorized by this closeout.

## 4. Invariants preserved (records, not new enforcement)

- **`internalHref` remains EXCLUDED** from the authoritative `CanonicalExportModel` (and thus from the
  reproducibility hash and any court-facing artifact). It is in-app navigation convenience only.
- **Visible citation text/flag remains the authority** — every row carries exactly one of `{citationText}`
  (卷X页Y) XOR `{flag}`; citations are never dropped; degradation is explicit and reviewable.
- These are records of already-merged behavior (evidence-genie invariants 5/6/7/9); this note adds no
  enforcement and changes no code.

## 5. Explicitly NOT done in the A10 program

- **No schema migration** and **no `CURRENT_SCHEMA_VERSION` change** were performed as part of A10.
- **No custody/marker work** (no HMAC key handling, no `dev-memo/run/evidence/**` marker/ledger changes).
- **No A8** snapshot/seal/manifest/ExportPreview implementation (A8.6 consumes A10's `CanonicalExportModel`
  but A10 did not build A8).
- **No JS-shim change** — `native/evidence-core/**` keeps `golden-export` `not_implemented` by design; the
  real gate is the Swift harness.
- **No confidential/client/court fixtures** were added.

## 6. A1T6-AUD-L1 remains a SEPARATE deferred Low — NOT part of A10 closeout

`A1T6-AUD-L1` (A1-T6 oracle-strictness hardening) is recorded in `dev-memo/deferred-audit-findings.md` and
remains **open (deferred)**, untouched by the A10 program. Although its backlog row once noted it "may instead
fold into A10-T1," the A10 program completed **without** folding it in; it stays a standalone optional A1-T6
hardening WI. This closeout does **not** fix it and does **not** modify its backlog row.

## 7. Status

A10 court-fileable-export non-gated technical pipeline: **CLOSED** (T1/T2/T6 + native gate + live wiring on
`main`). Remaining A10 = T3/T4/T5 forms, **product-legal-gated**, unauthorized. Evidence native gates on
`main`: A0.7 ✓ / A1-T6 ✓ / A3-T10 ✓ / A10 golden-export ✓. Open deferred Low: `A1T6-AUD-L1` (separate).

## References
- `docs/adr/ADR-evidence-a10-court-fileable-export.md` (A10-DESIGN-00 §3/§4/§5/§8/§10/§13).
- `.claude/rules/evidence-genie.md` (invariants 5/6/7/9/10).
- `dev-memo/deferred-audit-findings.md` (A1T6-AUD-L1 row — read-only here).
- Study closeouts `dev-memo/study/2026-06-30-batch-audit-{190..195}.md` (the A10 batch trail).
