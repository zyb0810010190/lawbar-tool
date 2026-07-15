# WI-PTA-04b — Scope docket: publish committed ClaimTrack contract into the checked-in internal tarball

**Status:** UNTRACKED pre-implementation scope docket. **NOT authorized for implementation** — requires its own
cc-suite `review-plan` approval. **Type:** ASSET/packaging-integration, high-risk (mutates the desktop-consumed
internal-package tarball + `package-lock.json` integrity → broker review required). **Branch:**
`feature/pretrial-trial-addon-04` @ `bbf2a36` (ClaimTrack contract impl committed).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (READY umbrella). **Predecessor:**
`dev-memo/plan-pretrial-trial-addon-01-pta04.md` (WI-PTA-04 contract impl, committed `bbf2a36`).
**Frozen source of truth:** `dev-memo/plan/pretrial-trial-addon-01-frozen.md` (unchanged; no schema change here).

## Problem statement
WI-PTA-04 committed the ClaimTrack contract (schema, validator, generated type, exports, fixtures, tests) to
`docs/contracts/case-box-contract` at `bbf2a36`. The desktop app does **not** consume live contract source — it
consumes the checked-in tarball `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` (+ `manifest.json` +
`package-lock.json` integrity). That tarball is now **stale**: `check-internal-tarballs` (DESKTOP-DEPS-00) reports
exit=1 with the committed contract tarball MISSING every ClaimTrack payload file
(`schemas/case-box-claim-track.schema.json`, `dist/validateClaimTrack.{js,d.ts}`,
`dist/generated/case-box-claim-track.{js,d.ts}`, all 14 fixtures) and CONTENT drift in `dist/index.{js,d.ts}` +
`dist/loadSchemas.{js,d.ts}`. This WI republishes the committed contract through the sanctioned packing workflow to
restore the gate to green. **No source, schema, feature, or runtime behavior changes** — this is artifact publication
only.

## Observable behavior (this WI only)
`check-internal-tarballs` returns exit=0; the committed `case-box-contract` tarball contains the ClaimTrack schema,
`validateClaimTrack`, the generated type, and the loader/package-root exports; `package-lock.json` records the new
contract tarball integrity; the persistence tarball is byte-identical to its `bbf2a36` baseline.

## In scope (packaging/artifact-only)
- Refresh `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` from committed contract source at `bbf2a36`
  via the sanctioned `pack:internal` (`scripts/pack-internal-packages.mjs`).
- Update `apps/lawbar-desktop/dist-tarballs/manifest.json` metadata **as produced by** the sanctioned pack (contract
  `integrity`/`sizeBytes`/`packedAt`; persistence entry `packedAt` churn only).
- Refresh the contract package's `package-lock.json` integrity record via the repository-owned guarded tool
  `scripts/workflow/refresh-internal-lock-integrity.mjs --refresh` (surfaced as `refresh:internal-tarballs`).
- Prove — via **direct tarball inspection** (`tar tzf` / `tar xzO`), not only the gate result (review-plan Medium) —
  the refreshed contract tarball payload contains ALL of:
  - `package/schemas/case-box-claim-track.schema.json`;
  - `package/dist/validateClaimTrack.js` **and** `package/dist/validateClaimTrack.d.ts`;
  - `package/dist/generated/case-box-claim-track.js` **and** `package/dist/generated/case-box-claim-track.d.ts`;
  - all **14** ClaimTrack fixtures (`package/fixtures/valid/claim-track-*.json` ×5, `package/fixtures/invalid/claim-track-*.json` ×9);
  - `validateClaimTrack` + `claimTrackSchema` export evidence in **both** `package/dist/index.js` and
    `package/dist/index.d.ts`, and the ClaimTrack schema import/export in **both** `package/dist/loadSchemas.js` and
    `package/dist/loadSchemas.d.ts`.
- Restore `check-internal-tarballs` to green (exit=0).
- Verify packaging idempotence + semantic-lockfile scope (below).

### Authorized committed write set (exact) — 3 files
- `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` (bytes change).
- `apps/lawbar-desktop/dist-tarballs/manifest.json` (contract entry + persistence `packedAt` churn).
- `apps/lawbar-desktop/package-lock.json` (contract internal-package integrity field only).

`apps/lawbar-desktop/dist-tarballs/case-box-persistence-0.1.0.tgz` is **not** in the committed write set. The sanctioned
`pack:internal` may **transiently overwrite** it, but it MUST show **zero byte diff** vs its `bbf2a36` baseline and MUST
**NOT be staged** (review-plan Medium). A byte difference is a STOP condition, not an authorized write.

## Aggregate-workflow handling (pack:internal repacks BOTH internal packages)
`scripts/pack-internal-packages.mjs` iterates `INTERNAL_PACKAGES = [case-box-contract, case-box-persistence]` and
repacks both. Because this WI changes only contract source, the docket REQUIRES:
- Record before/after SHA-256 for **both** tarballs (`case-box-contract-0.1.0.tgz`, `case-box-persistence-0.1.0.tgz`).
- Prove the **persistence tarball is byte-identical** before and after (its source/dist unchanged; the pack normalizes
  timestamps). A changed persistence tarball is a STOP.
- **No** persistence lock-integrity change unless the persistence tarball bytes genuinely change (they must not).
- Classify **every** `manifest.json` hunk. Expected: contract `integrity`/`sizeBytes`/`packedAt` change; persistence
  entry **only** `packedAt` churn. `packedAt`-only persistence churn is acceptable **if and only if** the persistence
  tarball bytes, `integrity`, `sizeBytes`, lock entry, `version`, `resolved` path, and dependency metadata are all
  unchanged (review-plan Low, accepted-with-clarification). Any other persistence-entry hunk
  (`integrity`/`sizeBytes`/`rewrites`) is a STOP.
- STOP if the persistence package's contents, `version`, `resolved` path, dependency edges, or lock integrity change
  unexpectedly.

## Explicit exclusions / deferred work
- No ClaimTrack renderer or i18n work (PTA-13+/17).
- No desktop feature code, no new screens/handlers.
- No persistence source changes; no audit-emission logic.
- No IPC or preload changes.
- No Matter embedding of ClaimTrack.
- **No schema changes beyond the already-committed ClaimTrack implementation** (`bbf2a36`). This WI packs existing
  committed source; it does not touch `docs/contracts/**`.
- No dependency upgrades; no `package.json` dependency edits; no new runtime deps.
- No PTA-05+ work.

## Sanctioned sequence (only) — persistence STOP BEFORE lock refresh (review-plan High)
The high-level scripts are `pack:internal → refresh:internal-tarballs → check:internal-tarballs`, but `pack:internal`
(`apps/lawbar-desktop/scripts/pack-internal-packages.mjs`, surfaced by the desktop `pack:internal` script; note the
`manifest.json` `generator` value `scripts/pack-internal-packages.mjs` is relative to the desktop app — review-plan
Low path-naming clarification) repacks BOTH packages, and `refresh:internal-tarballs`
(`scripts/workflow/refresh-internal-lock-integrity.mjs --refresh`) will refresh the integrity of **every** stale
internal package it sees — not just contract. A bad persistence repack would therefore be propagated into the lockfile
**before** any later check catches it. The persistence byte-identity STOP-check MUST run **before** the lock refresh.
The exact ordered sequence (review-plan High + Q5):

1. **Clean-source preflight** (review-plan Medium): confirm the working tree under `docs/contracts/case-box-contract`
   and `services/case-box-persistence` is clean of tracked/untracked source changes vs committed `bbf2a36`, EXCEPT the
   ignored `dist/` produced by step 2. Rationale: `pack:internal` copies the working-tree source (post-build), so a
   dirty tree could publish uncommitted source while still passing the fresh-pack comparison against that same dirty
   tree. STOP if any non-`dist/` source is dirty.
2. **Build** both internal packages' `dist/` from committed `bbf2a36` source (`build contract && build persistence`).
   `dist/` is gitignored — an input to the pack, never a tracked write.
3. **Record baseline SHA-256** for both `dist-tarballs/*.tgz`, `manifest.json`, `package-lock.json`.
4. **`pack:internal`** (repacks both tarballs + rewrites `manifest.json`).
5. **Persistence byte-identity STOP-check** — compare `case-box-persistence-0.1.0.tgz` SHA-256 to its step-3 baseline.
   If it changed, **STOP before `refresh:internal-tarballs`** and report; do not let a bad persistence repack reach the
   lockfile.
6. **Manifest hunk classification** — every hunk explained (contract integrity/sizeBytes/packedAt; persistence
   packedAt-only).
7. **`refresh:internal-tarballs`** (guarded tool refreshes ONLY genuinely-stale integrity → contract only, since
   persistence bytes are unchanged).
8. **Semantic lock diff** = exactly the contract internal-package integrity update; nothing else.
9. **`npm ci`** succeeds, no further lockfile change.
10. **`check:internal-tarballs`** exit=0.
11. **Second `pack → refresh → check` idempotence cycle** — byte-stable except documented `packedAt` churn.
12. **Full gates** (`check-gates.sh`) + contract/persistence/packaging-tool tests + desktop build/tests.

Do NOT hand-edit tarball bytes, integrity values, `packedAt`, `sizeBytes`, or package `resolved`/`version` fields. The
guarded refresh tool is the only writer of lock integrity (it validates exact `resolved: file:dist-tarballs/<name>-<ver>.tgz`,
exactly-one lock entry, sha512, version match, canonical 2-space formatting round-trip, atomic write).

## Verification (leave uncommitted for final review)
1. Contract tarball changes and contains the committed ClaimTrack artifacts per the In-scope direct-tarball proof list
   (schema + validator `.js`/`.d.ts` + generated type `.js`/`.d.ts` + all 14 fixtures + `.js`/`.d.ts` export evidence).
2. Contract tarball matches a fresh pack of committed contract source (this is exactly what `check-internal-tarballs`
   asserts: committed tarball == fresh pack of current source).
3. Persistence tarball byte-identical before/after (SHA-256 match).
4. Lockfile semantic diff = exactly the contract internal-package integrity update; nothing else.
5. No persistence integrity / resolution / version / dependency-edge / unrelated lock-record change.
6. Every manifest change explained by the sanctioned pack (contract integrity/sizeBytes/packedAt; persistence
   packedAt-only).
7. `npm --prefix apps/lawbar-desktop ci` succeeds and produces no further lockfile change.
8. A second `pack → refresh → check` cycle is byte-stable except documented `packedAt` timestamp churn.
9. Contract tests remain 485 / 0.
10. Persistence tests, the packaging-tool self-test (`refresh-internal-lock-integrity.test.mjs`), desktop build/tests,
    and the complete `check-gates.sh` release gates remain green.
- Final implementation audit of the exact artifact diff via cc-suite Path 1; resolve every substantive finding.

## Stop conditions
STOP before committing any artifact if: the persistence tarball bytes change unexpectedly; the lockfile changes beyond
the contract integrity field; any package `version` or `resolved` path changes; a renderer, persistence-source,
dependency, or unrelated file changes; or the actual write set exceeds this docket's authorized write set.

## Impact analysis
- **Artifact:** contract tarball + manifest + lockfile integrity refreshed. **Source:** none. **Persistence:** none
  (tarball must stay byte-identical). **Renderer/IPC/migration:** none.
- **Compatibility:** the desktop app gains the ClaimTrack contract in its consumed package; existing consumers
  unaffected (additive). **Rollback:** a single artifact commit, revertable with `git revert`.

## Dependencies
- **WI-PTA-04 (committed, `bbf2a36`):** the ClaimTrack contract source being published. **Satisfied.**
- **WI-INTERNAL-PACKAGE-LOCK-REFRESH (merged, `3d9b225`):** the guarded lock-integrity refresh tool used here.
  **Satisfied.**

## Review record (cc-suite review-plan)
- Job `review-plan-mrm4pdez-hc951z` (Path 1, gpt-5.5/high/read-only) — **verdict: NEEDS-FIX**, all findings applied:
  - **High** — persistence STOP-check must run BEFORE `refresh:internal-tarballs` (else a bad persistence repack
    propagates to the lockfile) → **fixed**: §"Sanctioned sequence" now specifies the 12-step order with the
    persistence byte-identity STOP at step 5, before the refresh at step 7.
  - **Medium** — persistence-tarball write-set wording ("conditionally authorized") was awkward → **fixed**: reworded to
    "transiently overwritten by the tool, zero committed diff, must not be staged"; committed write set is exactly 3
    files.
  - **Medium** — payload proof omitted `.d.ts` + fixtures + `.d.ts` exports → **fixed**: In-scope proof now requires
    direct-tarball evidence for `.js`+`.d.ts` validator/generated-type, all 14 fixtures, and `.js`+`.d.ts` export
    evidence.
  - **Medium** — clean-source preflight missing → **fixed**: added as sequence step 1 (working tree clean vs `bbf2a36`
    except the ignored built `dist/`).
  - **Low** — `packedAt` churn classification → **accepted-with-clarification**: acceptable iff persistence bytes/
    integrity/size/lock-entry/version/resolved/deps unchanged.
  - **Low** — path-naming (`pack:internal` surfaces `apps/lawbar-desktop/scripts/pack-internal-packages.mjs`) →
    **clarified** in §"Sanctioned sequence".
- Re-review after fixes: job `review-plan-mrm4vfwc-oqmisw` (Path 1, gpt-5.5/high/read-only) — **verdict: READY**; all
  six prior findings CLOSED; feasible, no added implementation scope. This docket is now authorized for implementation.
