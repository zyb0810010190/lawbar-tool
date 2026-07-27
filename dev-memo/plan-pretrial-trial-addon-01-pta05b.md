# WI-PTA-05b — Scope docket: publish committed EvidencePreparation contract into the checked-in internal tarball

**Status:** REVIEWED — **READY** (cc-suite `review-plan` `review-plan-mrp21dfw-s6aks9`; see §"Review record").
**Authorized for implementation of exactly this docket's scope** — no scope beyond the authorized 3-file write set
+ sanctioned sequence below. **Type:** ASSET/packaging-integration,
high-risk (mutates the desktop-consumed internal-package tarball + `package-lock.json` integrity → broker review
required). **Branch:** `feature/pretrial-trial-addon-05` @ `68e2d6b` (EvidencePreparation contract impl committed).
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (APPROVED umbrella). **Predecessor:**
`dev-memo/plan-pretrial-trial-addon-01-pta05.md` (WI-PTA-05 contract impl, committed `68e2d6b`).
**Precedent:** `dev-memo/plan-pretrial-trial-addon-01-pta04b.md` (the identical publish pattern for ClaimTrack,
merged in PR #262). **Frozen source of truth:** `dev-memo/plan/pretrial-trial-addon-01-frozen.md` (unchanged; no
schema change here).

## Problem statement
WI-PTA-05 committed the EvidencePreparation contract (schema, validator, generated type, exports, fixtures, tests)
to `docs/contracts/case-box-contract` at `68e2d6b`. The desktop app does **not** consume live contract source — it
consumes the checked-in tarball `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` (+ `manifest.json`
+ `package-lock.json` integrity). That tarball is now **stale**: `check-internal-tarballs` (DESKTOP-DEPS-00)
reports DRIFT with the committed contract tarball MISSING every EvidencePreparation payload file
(`schemas/case-box-evidence-preparation.schema.json`, `dist/validateEvidencePreparation.{js,d.ts}`,
`dist/generated/case-box-evidence-preparation.{js,d.ts}`, all 12 fixtures) and CONTENT drift in
`dist/index.{js,d.ts}` + `dist/loadSchemas.{js,d.ts}`. This WI republishes the committed contract through the
sanctioned packing workflow to restore the gate to green. **No source, schema, feature, or runtime behavior
changes** — this is artifact publication only.

## Observable behavior (this WI only)
`check-internal-tarballs` returns exit=0; the committed `case-box-contract` tarball contains the
EvidencePreparation schema, `validateEvidencePreparation`, the generated type, and the loader/package-root
exports; `package-lock.json` records the new contract tarball integrity; the persistence tarball is byte-identical
to its pre-WI baseline.

## In scope (packaging/artifact-only)
- Refresh `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz` from committed contract source at
  `68e2d6b` via the sanctioned `pack:internal` (`apps/lawbar-desktop/scripts/pack-internal-packages.mjs`).
- Update ONLY the **contract entry** in `apps/lawbar-desktop/dist-tarballs/manifest.json`
  (`integrity`/`sizeBytes`/`packedAt`) **as produced by** the sanctioned pack. Any persistence-entry `packedAt`
  churn produced by the aggregate pack MUST be **normalized back** to its pre-WI (HEAD) value before commit
  (JSON-aware single-field restore, per the WI-PTA-04b precedent).
- Refresh ONLY `node_modules/case-box-contract.integrity` in `apps/lawbar-desktop/package-lock.json` via the
  repository-owned guarded tool `scripts/workflow/refresh-internal-lock-integrity.mjs --refresh` (surfaced as
  `refresh:internal-tarballs`).
- Prove — via **direct tarball inspection** (`tar tzf` / `tar xzO`), not only the gate result — the refreshed
  contract tarball payload contains ALL of:
  - `package/schemas/case-box-evidence-preparation.schema.json`;
  - `package/dist/validateEvidencePreparation.js` **and** `package/dist/validateEvidencePreparation.d.ts`;
  - `package/dist/generated/case-box-evidence-preparation.js` **and** `package/dist/generated/case-box-evidence-preparation.d.ts`;
  - all **12** EvidencePreparation fixtures (`package/fixtures/valid/evidence-preparation-*.json` ×5,
    `package/fixtures/invalid/evidence-preparation-*.json` ×7);
  - `validateEvidencePreparation` + `evidencePreparationSchema` export evidence in **both** `package/dist/index.js`
    and `package/dist/index.d.ts`, and the EvidencePreparation schema import/export in **both**
    `package/dist/loadSchemas.js` and `package/dist/loadSchemas.d.ts`.
  - Additionally confirm the schema + all 12 fixtures in the tarball **SHA-256 byte-match** the committed source at
    `68e2d6b`.
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
`INTERNAL_PACKAGES = [case-box-contract, case-box-persistence]` and repacks both. Because this WI changes only contract source, the docket REQUIRES:
- Record before/after SHA-256 for **both** tarballs (`case-box-contract-0.1.0.tgz`,
  `case-box-persistence-0.1.0.tgz`).
- Prove the **persistence tarball is byte-identical** before and after (SHA-256 match). A changed persistence
  tarball is a STOP.
- Prove the **persistence manifest entry** is semantically AND byte-identical to its pre-WI baseline after the
  `packedAt` normalization (the only permitted persistence-entry delta from the aggregate pack is a `packedAt`
  timestamp, which is normalized back to the HEAD value before commit).
- **No** persistence lock-integrity change; **no** persistence source change.
- **STOP before `refresh:internal-tarballs`** if the persistence tarball hash changed (do not let a bad persistence
  repack reach the lockfile).
- Classify **every** `manifest.json` and `package-lock.json` hunk. Expected manifest: contract
  `integrity`/`sizeBytes`/`packedAt` change; persistence entry — after normalization — **no change**. Expected
  lock: exactly one field `node_modules/case-box-contract.integrity`. Any other hunk is a STOP.

## Explicit exclusions / deferred work
- No EvidencePreparation renderer or i18n work.
- No desktop feature code; no new screens/handlers.
- No contract-source changes (this WI packs the existing committed source; it does not touch `docs/contracts/**`).
- No persistence source or package-behavior changes; no audit-emission logic.
- No IPC or preload changes.
- No Matter, ClaimTrack, or evidence-item changes.
- No dependency upgrades; no `package.json` dependency edits; no new runtime deps.
- No PTA-06+ work.
- No manual editing of tarball bytes, integrity values, `packedAt` (except the sanctioned JSON-aware persistence
  `packedAt` NORMALIZATION back to the HEAD value), `sizeBytes`, package `version`, or `resolved` paths.

## Sanctioned sequence (only) — persistence STOP BEFORE lock refresh
The high-level scripts are `pack:internal → refresh:internal-tarballs → check:internal-tarballs`, but
`pack:internal` repacks BOTH packages and `refresh:internal-tarballs` refreshes the integrity of **every** stale
internal package it sees — not just contract. A bad persistence repack would therefore be propagated into the
lockfile **before** any later check catches it. The persistence byte-identity STOP-check MUST run **before** the
lock refresh. Exact ordered sequence:

1. **Clean-source preflight**: confirm the working tree under `docs/contracts/case-box-contract` and
   `services/case-box-persistence` is clean of tracked/untracked source changes vs committed `68e2d6b`, EXCEPT the
   ignored `dist/` produced by step 2. STOP if any non-`dist/` source is dirty.
2. **Build** both internal packages' `dist/` from committed `68e2d6b` source (`build contract && build
   persistence`). `dist/` is gitignored — an input to the pack, never a tracked write.
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
12. **Second `pack → (normalize) → refresh → check` idempotence cycle** — contract + persistence tarball bytes
    stable; refresh no-op; only documented `packedAt` churn (reverted); final artifact == first-cycle canonical.
13. **Full gates** (`check-gates.sh`) + contract (512/512) / persistence / packaging-tool (19/19) tests + desktop
    build (837/837).

Do NOT hand-edit tarball bytes, integrity values, `sizeBytes`, or package `resolved`/`version` fields. The guarded
refresh tool is the only writer of lock integrity.

## Verification (leave uncommitted for final review)
1. Contract tarball changes and contains the committed EvidencePreparation artifacts per the In-scope
   direct-tarball proof list (schema + validator `.js`/`.d.ts` + generated `.js`/`.d.ts` + all 12 fixtures +
   `.js`/`.d.ts` export evidence), and the schema + 12 fixtures SHA-256 byte-match `68e2d6b`.
2. Contract tarball matches a fresh pack of committed contract source (what `check-internal-tarballs` asserts).
3. Persistence tarball byte-identical before/after (SHA-256 match); persistence manifest entry byte-identical to
   HEAD after normalization.
4. Lockfile semantic diff = exactly the contract internal-package integrity update; nothing else.
5. No persistence integrity / resolution / version / dependency-edge / unrelated lock-record change.
6. Every manifest change explained (contract integrity/sizeBytes/packedAt; persistence packedAt normalized away).
7. `npm --prefix apps/lawbar-desktop ci` succeeds and produces no further lockfile change.
8. A second `pack → normalize → refresh → check` cycle is byte-stable except documented `packedAt` churn.
9. Contract tests remain 512 / 0.
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
- **Compatibility:** the desktop app gains the EvidencePreparation contract in its consumed package; existing
  consumers unaffected (additive). **Rollback:** a single artifact commit, revertable with `git revert`.

## Dependencies
- **WI-PTA-05 (committed, `68e2d6b`):** the EvidencePreparation contract source being published. **Satisfied.**
- **WI-INTERNAL-PACKAGE-LOCK-REFRESH (merged):** the guarded lock-integrity refresh tool used here. **Satisfied.**

## Review record (cc-suite review-plan)
- Job `review-plan-mrp21dfw-s6aks9` (Path 1 runner `codex-runner.mjs` @ `0.2.18`, gpt-5.5/high/read-only) —
  **verdict: READY** (no Critical/High/Medium). All 8 review questions confirmed: package-publication only;
  complete 3-file write set; enforceable persistence non-change (byte-identity STOP before refresh + manifest-entry
  normalization to HEAD + no persistence lock change); lock scope limited to the single contract integrity field;
  sound `packedAt` normalization; strong tarball-content proof (incl. SHA byte-match to `68e2d6b`); adequate stop
  conditions; no renderer/PTA-06 pull-forward. The reviewer noted the docket "materially improves the PTA-04b
  precedent by normalizing persistence `packedAt` away instead of allowing benign committed churn."
  - **Low** — path-naming: the aggregate-workflow section named `scripts/pack-internal-packages.mjs` → **fixed** to
    `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` (matches §"In scope" and the desktop `pack:internal`
    script). Non-blocking; applied.
- This docket is authorized for implementation of exactly its scope.
