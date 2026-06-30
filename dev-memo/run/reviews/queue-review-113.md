# Queue review — WI-EVIDENCE-A10-T6-GOLDEN-CANONICAL-EXPORT-00

Lane: implement the A10-T6 golden CanonicalExportModel slice over the A10-T1 + A10-T2 contracts (Type: IMPL; apps-layer module + serializer + golden fixture + tests; HIGH-RISK Evidence-invariant lane — the CanonicalExportModel is the A8.6 reproducibility target).
Date: 2026-06-30. Branch: `evidence-a10-t6-golden-canonical-export` (from synced `main` @ `2d7bf04`). Batch: 1/3 since marker `725c017` — no batch closeout this lane.

## What A10-T6 is
A NEW standalone apps-layer module `apps/lawbar-desktop/src/caseBox/export/a10CanonicalExportModel.ts` that builds the deterministic LOGICAL CanonicalExportModel (ADR §4 shape) over `A10RenderedCitation[]` (A10-T1) using the A10-T2 hyperlink-degraded text-or-flag authority, serializes it deterministically (stable key/row order, NFC, no timestamps/machine-paths/renderer-metadata), and SHA-256-hashes the serialization (the reproducibility unit). A golden fixture locks one representative model's serialization + sha256. The court-fileable authority is the per-row 卷X页Y `citationText` OR the `flag`; the A10-T2 `internalHref` is DELIBERATELY EXCLUDED from the canonical model. Hashes the LOGICAL model only — NEVER raw `.docx`/PDF bytes (ADR §3, evidence invariant 9). Standalone: does NOT wire the live export pipeline, build the native `golden-export` harness / JS shim, touch A8, forms, schema, custody, confidential fixtures, or edit a10CitationContract.ts / a10HyperlinkDegradation.ts.

**Native gate deferral (explicitly recorded, per review-plan-mr0fhoa8 answer 3):** this WI does NOT claim the native `golden-export` CI gate is green. The native harness (`native/**`) remains `not_implemented` (= a FAILURE per evidence-genie invariant 10) and is a separate downstream WI. This apps-layer golden is the deterministic-model proof; it does not satisfy the native CI gate.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan (Path 1 runner 0.2.18, gpt-5.5/high/read-only)
- Attempt 1: Job ID `review-plan-mr0fhoa8-fk2vvf` · **NEEDS-FIX** — two shape-drift findings: (#1) `canonicalModelVersion` was an invented field vs the ADR §4 transcribed shape; (#2) `generatedFromSnapshotId` should be omitted when absent, not serialized as `null`. Confirmed correct (no change needed): internalHref exclusion, logical-serialization hashing, determinism approach, golden-fixture proof, standalone scope. **Both findings FIXED in-WI.**
- Attempt 2: Job ID `review-plan-mr0fmmwg-hepxex` · completed (retrievable YES) · **READY** · rawOutput sha256 `fc79c9edb44b7f6968d95d9ad1ccba6cc68764e1f97a4807abddbebeb56b5558`. Confirmed both shape-drift points resolved; model faithful to ADR §4; no A1/A3/A8/A10 invariant blocker.

## Verdict: READY (both review-plan shape-drift findings resolved)

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit (Path 1 runner 0.2.18, gpt-5.5/high/read-only; pre-commit working-tree, exact-path scope)
- Attempt 1 — Job ID `audit-mr0fooh5-dgb21p` · **Medium** (FIXED in-WI): rows serialized BOTH `citationText` and `flag` with one set to `null`, violating "EXACTLY one of {citationText} XOR {flag}" / all-strings. FIX: `CanonicalExportRow` is now a key-presence union `{ linkId, citationText } | { linkId, flag }`; the builder emits only the present key; the golden fixture was re-locked (new sha256); tests assert key-presence XOR. No Critical/High.
- Attempt 2 — Job ID `audit-mr0ftp7a-ou0edm` · **CLEAN — no findings** · rawOutput sha256 `a4ee7d643e4bd81067d34da4f96510d090e89cd34de6d307dedbdbe36769c5b8`. Confirmed: Medium CLOSED (key-presence union; golden re-locked without null sentinels); deterministic stable serialization/hash basis; internalHref exclusion; no href/scheme payload; ADR §4 shape without `canonicalModelVersion`; optional `generatedFromSnapshotId` omitted; package.json one-line test append only (build.mac.target unchanged); scope confined. Golden `expectedSha256` matches SHA-256 of `expectedSerialization`; targeted test 10/10.
### verify
- Kind: verify · Path 1 runner 0.2.18, gpt-5.5/medium · consumed the audit-2 report · Job ID `verify-mr0fw9hm-ms9ldh` · rawOutput sha256 `5e9543a1fa6694e8f7e153b005a988e1f2217151fd518d9a26b5a7e316f28ce4`.
- Verdict: **ALL CLOSED** — no undocumented Critical/High/Medium open.

## Local verification
`npm --prefix apps/lawbar-desktop test` → **696/696 pass** (was 686; +10 A10-T6 tests; incl. Electron smoke). Targeted `node --test tests/a10-canonical-export.unit.test.mjs` → 10/10. A10-T1+A10-T2 regression → 20/20. `check-contract-integrity` PASS (14 docs); `CURRENT_SCHEMA_VERSION` unchanged. package.json diff = exactly the one-line test registration (no reformat; build.mac.target intact). No services/native/renderer/electron/schema/contract change; no edit to a10CitationContract.ts/a10HyperlinkDegradation.ts; no custody/marker/key; `dev-memo/run/evidence/**` untouched.

## Deferred findings
None. Both review-plan shape-drift findings + the one audit Medium were FIXED in-WI and verified closed. (The native `golden-export` harness remaining `not_implemented` is an explicitly-recorded out-of-scope downstream WI, not a deferred finding of this WI.)
