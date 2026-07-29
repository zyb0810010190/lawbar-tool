# WI-PTA-06b — Scope docket: publish committed CrossExaminationOpinion contract into the checked-in internal tarball

**Status:** REVIEWED — **READY** (cc-suite `review-plan` `review-plan-ms4bhex7-rhpth4`, after NEEDS-FIX
`review-plan-ms4bc3ii-evgswy`; see §"Review record"). **Authorized for implementation of exactly this docket's
scope** — no scope beyond the authorized 3-file write set + sanctioned sequence below. **Type:**
ASSET/packaging-integration, high-risk (mutates the desktop-consumed internal-package tarball + `package-lock.json`
integrity → broker review required). **Branch:** `feature/pretrial-trial-addon-06` @ `a25dc79`
(CrossExaminationOpinion contract impl committed).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (APPROVED umbrella). **Predecessor:**
`dev-memo/plan-pretrial-trial-addon-01-pta06.md` (WI-PTA-06 contract impl, committed `a25dc79`).
**Precedent:** `dev-memo/plan-pretrial-trial-addon-01-pta05b.md` (the identical publish pattern for
EvidencePreparation, merged in PR #263). **Frozen source of truth:**
`dev-memo/plan/pretrial-trial-addon-01-frozen.md` (unchanged; no schema change here).

## Problem statement
WI-PTA-06 committed the CrossExaminationOpinion contract (schema, validator, **invariant helper**, generated type,
exports, fixtures, tests) to `docs/contracts/case-box-contract` at `a25dc79`. The desktop app does **not** consume
live contract source — it consumes the checked-in tarball
`apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` (+ `manifest.json` + `package-lock.json`
integrity). That tarball is now **stale**: `check-internal-tarballs` (DESKTOP-DEPS-00) reports DRIFT with the
committed contract tarball MISSING every CrossExaminationOpinion payload file
(`schemas/case-box-cross-examination-opinion.schema.json`, `dist/validateCrossExaminationOpinion.{js,d.ts}`,
`dist/cross-exam-invariants.{js,d.ts}`, `dist/generated/case-box-cross-examination-opinion.{js,d.ts}`, all 12
fixtures) and CONTENT drift in `dist/index.{js,d.ts}` + `dist/loadSchemas.{js,d.ts}`. This WI republishes the
committed contract through the sanctioned packing workflow to restore the gate to green. **No source, schema,
feature, or runtime behavior changes** — this is artifact publication only.

## Observable behavior (this WI only)
`check-internal-tarballs` returns exit=0; the committed `case-box-contract` tarball contains the
CrossExaminationOpinion schema, `validateCrossExaminationOpinion`, the `cross-exam-invariants` helper
(`assertCrossExaminationOpinionInvariants` + `CrossExaminationInvariantError`), the generated type, and the
loader/package-root exports; `package-lock.json` records the new contract tarball integrity; the persistence
tarball is byte-identical to its pre-WI baseline.

## In scope (packaging/artifact-only)
- Refresh `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` from committed contract source at
  `a25dc79` via the sanctioned `pack:internal` (`apps/lawbar-desktop/scripts/pack-internal-packages.mjs`).
- Update ONLY the **contract entry** in `apps/lawbar-desktop/dist-tarballs/manifest.json`
  (`integrity`/`sizeBytes`/`packedAt`) **as produced by** the sanctioned pack. Any persistence-entry `packedAt`
  churn produced by the aggregate pack MUST be **normalized back** to its pre-WI (HEAD) value before commit
  (JSON-aware single-field restore, per the WI-PTA-05b precedent).
- Refresh ONLY `node_modules/case-box-contract.integrity` in `apps/lawbar-desktop/package-lock.json` via the
  repository-owned guarded tool `scripts/workflow/refresh-internal-lock-integrity.mjs --refresh` (surfaced as
  `refresh:internal-tarballs`).
- Prove — via **direct tarball inspection** (`tar tzf` / `tar xzO`), not only the gate result — the refreshed
  contract tarball payload contains ALL of:
  - `package/schemas/case-box-cross-examination-opinion.schema.json`;
  - `package/dist/validateCrossExaminationOpinion.js` **and** `package/dist/validateCrossExaminationOpinion.d.ts`;
  - `package/dist/cross-exam-invariants.js` **and** `package/dist/cross-exam-invariants.d.ts` (the invariant helper
    — a NEW payload file for this WI, absent from the PTA-05b publish);
  - `package/dist/generated/case-box-cross-examination-opinion.js` **and**
    `package/dist/generated/case-box-cross-examination-opinion.d.ts`;
  - all **12** CrossExaminationOpinion fixtures (`package/fixtures/valid/cross-examination-opinion-*.json` ×5,
    `package/fixtures/invalid/cross-examination-opinion-*.json` ×7);
  - `validateCrossExaminationOpinion` + `assertCrossExaminationOpinionInvariants` +
    `CrossExaminationInvariantError` + `crossExaminationOpinionSchema` export evidence in **both**
    `package/dist/index.js` and `package/dist/index.d.ts`, and the CrossExaminationOpinion schema import/export in
    **both** `package/dist/loadSchemas.js` and `package/dist/loadSchemas.d.ts`.
  - Additionally confirm the schema + all 12 fixtures in the tarball **SHA-256 byte-match** the committed source at
    `a25dc79`.
- Restore `check-internal-tarballs` to green (exit=0); prove `check-internal-lock` current.
- Verify packaging idempotence + semantic-lockfile scope (below).

### Authorized committed write set (exact) — 3 files
- `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` (bytes change).
- `apps/lawbar-desktop/dist-tarballs/manifest.json` (contract entry only; persistence `packedAt` churn normalized
  away → persistence entry byte-identical to HEAD).
- `apps/lawbar-desktop/package-lock.json` (contract internal-package integrity field only).

**Any additional tracked file is a STOP condition** unless this docket is amended and re-reviewed.
`apps/lawbar-desktop/dist-tarballs/case-box-persistence-0.1.0.tgz` is **not** in the committed write set. The
sanctioned `pack:internal` may **transiently overwrite** it, but it MUST show **zero byte diff** vs its pre-WI
baseline and MUST **NOT be staged**. A byte difference is a STOP condition.

## Aggregate-workflow handling (pack:internal repacks BOTH internal packages)
`apps/lawbar-desktop/scripts/pack-internal-packages.mjs` (surfaced by the desktop `pack:internal` script) iterates
`INTERNAL_PACKAGES = [case-box-contract, case-box-persistence]` and repacks both. Because this WI changes only
contract source, the docket REQUIRES:
- Record before/after SHA-256 for **both** tarballs (`case-box-contract-0.1.0.tgz`,
  `case-box-persistence-0.1.0.tgz`).
- Prove the **persistence tarball is byte-identical** before and after (SHA-256 match). A changed persistence
  tarball is a STOP.
- Prove the **persistence manifest entry** is semantically AND byte-identical to its pre-WI baseline after the
  `packedAt` normalization (the only permitted persistence-entry delta from the aggregate pack is a `packedAt`
  timestamp, normalized back to the HEAD value before commit).
- **No** persistence lock-integrity change; **no** persistence source change.
- **STOP before `refresh:internal-tarballs`** if the persistence tarball hash changed (do not let a bad persistence
  repack reach the lockfile).
- Classify **every** `manifest.json` and `package-lock.json` hunk. Expected manifest: contract
  `integrity`/`sizeBytes`/`packedAt` change; persistence entry — after normalization — **no change**. Expected
  lock: exactly one field `node_modules/case-box-contract.integrity`. Any other hunk is a STOP.

## Explicit exclusions / deferred work
- No CrossExaminationOpinion renderer or i18n work.
- No desktop feature code; no new screens/handlers.
- No contract-source changes (this WI packs the existing committed source; it does not touch `docs/contracts/**`).
- No persistence source or package-behavior changes; no audit-emission logic.
- No IPC or preload changes.
- No Matter, ClaimTrack, EvidencePreparation, or evidence-item changes.
- No dependency upgrades; no `package.json` dependency edits; no new runtime deps.
- No PTA-07+ work.
- No manual editing of tarball bytes, integrity values, `packedAt`, `sizeBytes`, package `version`, or `resolved`
  paths — with exactly TWO sanctioned exceptions: (a) the JSON-aware persistence-entry `packedAt` NORMALIZATION back
  to the HEAD value (step 7); and (b) the whole-file restore of the committed candidate to the cycle-1 canonical
  snapshot after the idempotence proof (step 12), which reverts the contract `packedAt` to its cycle-1 value. No
  other hand-edit of these fields is permitted.

## Sanctioned sequence (only) — persistence STOP BEFORE lock refresh
The high-level scripts are `pack:internal → refresh:internal-tarballs → check:internal-tarballs`, but
`pack:internal` repacks BOTH packages and `refresh:internal-tarballs` refreshes the integrity of **every** stale
internal package it sees — not just contract. A bad persistence repack would therefore be propagated into the
lockfile **before** any later check catches it. The persistence byte-identity STOP-check MUST run **before** the
lock refresh. Exact ordered sequence:

1. **Clean-source preflight**: confirm the working tree under `docs/contracts/case-box-contract` and
   `services/case-box-persistence` is clean of tracked/untracked source changes vs committed `a25dc79`, EXCEPT the
   ignored `dist/` produced by step 2. STOP if any non-`dist/` source is dirty.
2. **Build** both internal packages' `dist/` from committed `a25dc79` source (`build contract && build
   persistence`). NOTE: the contract `build` runs a `prebuild` → `gen:types` step that writes **tracked**
   `src/generated/*.ts`; it is idempotent at `a25dc79`. `dist/` is gitignored — an input to the pack, never a
   tracked write.
2a. **Post-build clean-source re-check** (closes the review-plan Low): after step 2, re-run the clean-source check
    — confirm `git status` shows NO change to any **tracked** contract/persistence source, INCLUDING
    `docs/contracts/case-box-contract/src/generated/*.ts`, vs `a25dc79` (only ignored `dist/` may differ). This
    proves the pack publishes exactly the committed source and not an uncommitted generated-source mutation. STOP
    if any tracked source (incl. generated) differs.
3. **Record baseline SHA-256** for both `dist-tarballs/*.tgz`, `manifest.json`, `package-lock.json`; capture the
   pre-WI persistence-entry `packedAt` value from HEAD `manifest.json`.
4. **`pack:internal`** (repacks both tarballs + rewrites `manifest.json`).
5. **Persistence byte-identity STOP-check** — compare `case-box-persistence-0.1.0.tgz` SHA-256 to its step-3
   baseline. If it changed, **STOP before `refresh:internal-tarballs`** and report.
6. **Manifest hunk classification** — every hunk explained (contract integrity/sizeBytes/packedAt; persistence
   packedAt-only).
7. **Persistence `packedAt` normalization** — restore the persistence entry's `packedAt` to its HEAD value
   (JSON-aware single-field edit), so the persistence manifest entry is byte-identical to HEAD.
8. **`refresh:internal-tarballs`** (guarded tool refreshes ONLY genuinely-stale integrity → contract only, since
   persistence bytes are unchanged).
9. **Semantic lock diff** = exactly the contract internal-package integrity update; nothing else.
10. **`npm ci`** succeeds, no further lockfile change.
11. **`check:internal-tarballs`** exit=0; **`check:internal-lock`** current.
12. **Second `pack → (normalize) → refresh → check` idempotence cycle (byte-STABILITY PROOF only)** — before it,
    save a snapshot of the cycle-1 canonical artifacts (all four files: contract tarball, persistence tarball,
    `manifest.json`, `package-lock.json`). Run the second cycle and assert: contract tarball bytes identical to
    cycle-1; persistence tarball bytes identical to baseline; `refresh` is a no-op; the ONLY manifest delta vs
    cycle-1 is `packedAt` (both entries, which the aggregate pack always rewrites). Then **restore the working tree
    to the cycle-1 canonical snapshot** by whole-file copy of the saved cycle-1 artifacts — this reverts the
    contract `packedAt` (and any churn) to its cycle-1 value, so the committed candidate is deterministic. This
    whole-file cycle-1-snapshot restore is **explicitly authorized** (it is the mechanism that keeps the committed
    3-file candidate byte-deterministic) and is distinct from a hand-edit of tarball/integrity bytes. Final
    committed artifact == the cycle-1 canonical output.
13. **Full gates** (`check-gates.sh`) + contract (539/539) / persistence / packaging-tool (19/19) tests + desktop
    build (837/837).

Do NOT hand-edit tarball bytes, integrity values, `sizeBytes`, or package `resolved`/`version` fields. The guarded
refresh tool is the only writer of lock integrity.

## Verification (leave uncommitted for final review)
1. Contract tarball changes and contains the committed CrossExaminationOpinion artifacts per the In-scope
   direct-tarball proof list (schema + validator `.js`/`.d.ts` + **invariants `.js`/`.d.ts`** + generated
   `.js`/`.d.ts` + all 12 fixtures + `.js`/`.d.ts` export evidence), and the schema + 12 fixtures SHA-256 byte-match
   `a25dc79`.
2. Contract tarball matches a fresh pack of committed contract source (what `check-internal-tarballs` asserts).
3. Persistence tarball byte-identical before/after (SHA-256 match); persistence manifest entry byte-identical to
   HEAD after normalization.
4. Lockfile semantic diff = exactly the contract internal-package integrity update; nothing else.
5. No persistence integrity / resolution / version / dependency-edge / unrelated lock-record change.
6. Every manifest change explained (contract integrity/sizeBytes/packedAt; persistence packedAt normalized away).
7. `npm --prefix apps/lawbar-desktop ci` succeeds and produces no further lockfile change.
8. A second `pack → normalize → refresh → check` cycle is byte-stable except documented `packedAt` churn.
9. Contract tests remain 539 / 0.
10. Persistence tests, packaging-tool self-test (`refresh-internal-lock-integrity.test.mjs`, 19/19), desktop
    build/tests (837/837), and the complete `check-gates.sh` release gates remain green.
- Final implementation audit of the exact artifact diff via cc-suite Path 1; resolve every substantive finding.

## Stop conditions
STOP before committing any artifact if: the persistence tarball bytes change unexpectedly; the persistence
manifest entry differs from HEAD after normalization; the lockfile changes beyond the contract integrity field;
any package `version` or `resolved` path changes; a renderer, persistence-source, dependency, or unrelated file
changes; or the actual write set exceeds this docket's authorized 3-file write set.

## Impact analysis
- **Artifact:** contract tarball + manifest + lockfile integrity refreshed. **Source:** none. **Persistence:**
  none (tarball + manifest entry byte-identical). **Renderer/IPC/migration:** none.
- **Compatibility:** the desktop app gains the CrossExaminationOpinion contract in its consumed package; existing
  consumers unaffected (additive). **Rollback:** a single artifact commit, revertable with `git revert`.

## Dependencies
- **WI-PTA-06 (committed, `a25dc79`):** the CrossExaminationOpinion contract source being published. **Satisfied.**
- **WI-INTERNAL-PACKAGE-LOCK-REFRESH (merged):** the guarded lock-integrity refresh tool used here. **Satisfied.**

## Review record (cc-suite review-plan)
- Job `review-plan-ms4bc3ii-evgswy` (Path 1 runner `codex-runner.mjs` @ `0.2.18`, gpt-5.5/high/read-only) —
  **verdict: NEEDS-FIX**, both findings applied:
  - **Medium** — the idempotence-cycle (step 12) conflicted with the `packedAt` edit rules: the second
    `pack:internal` rewrites BOTH manifest entries' `packedAt`, but the exclusions only authorized normalizing the
    persistence `packedAt` and forbade other `packedAt` edits, so restoring the contract entry to cycle-1 was
    unauthorized. → **fixed**: step 12 now frames the second cycle as a byte-stability PROOF and **explicitly
    authorizes** restoring the working tree to the cycle-1 canonical snapshot (whole-file copy of the saved cycle-1
    artifacts, which reverts the contract `packedAt` to its cycle-1 value); the exclusions now list exactly two
    sanctioned `packedAt`-affecting operations (persistence normalization + cycle-1 snapshot restore).
  - **Low** — the build step understated tracked generated output (`build` → `prebuild` → `gen:types` writes
    tracked `src/generated/*.ts`). → **fixed**: added step 2a, a post-build clean-source re-check that STOPs if any
    tracked source (incl. `src/generated/*.ts`) differs from `a25dc79`, so the pack cannot publish an uncommitted
    generated-source mutation.
  - Confirmed by the reviewer: package-publication-only scope; correct 3-file write set; persistence byte-identity
    STOP before lock refresh; lock scope enforceable; payload proof correctly includes the new
    `dist/cross-exam-invariants.{js,d.ts}` + `assertCrossExaminationOpinionInvariants`/`CrossExaminationInvariantError`
    exports; stale-tarball premise supported by current tarball inspection.
- Re-review after fixes: job `review-plan-ms4bhex7-rhpth4` (Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  gpt-5.5/high/read-only) — **verdict: READY**; both prior findings confirmed resolved; scope, 3-file write set,
  persistence non-change, single-field lock scope, and payload proof (incl. the new `cross-exam-invariants.{js,d.ts}`
  + exports + SHA byte-match) all confirmed. One non-blocking note applied: the direct-tarball payload-proof bullet
  now also names `CrossExaminationInvariantError` alongside `assertCrossExaminationOpinionInvariants`. This docket is
  authorized for implementation of exactly its scope.
