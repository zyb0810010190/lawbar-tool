# Plan — WI-SERVICES-CI-GATES-17

**Type**: WORKFLOW/CI (workflow + docs). **No product/schema change.** Closes the CI gap surfaced by WI-16: the
persistence migration/conformance suites ran only locally. Follows `dev-memo/plan-migration-compat-fix1.md`.
`main` @ `9f5700f`.

## First step (done)

Due Layer-B closeout for window `a7977ce..9f5700f` returned **BATCH-FAIL C0 H0 M2** → remediated by
`WI-MIGRATION-COMPAT-FIX1` (commit `2063b0d`, override-consumed) → post-fix Layer-B `audit-mre6rpmh-mb8fkn`
**BATCH-PASS C0 H0 M0** → closeout `e7fb9e0`, marker → `2063b0d`. Run-log override line persisted (`3fb10fb`).

## Goal

Add CI coverage for service packages, starting with `services/case-box-persistence`, so its migration / conformance
/ hardening suites gate PRs (not only local runs).

## Investigation

- Both `services/case-box-persistence` and `docs/contracts/case-box-contract` have **lockfiles** → `npm ci` works.
- persistence depends on `better-sqlite3` (native, **node-ABI**; an `abi-smoke` pretest guards the binding) and
  `case-box-contract` via `file:../../docs/contracts/case-box-contract`. The persistence `test` builds the contract
  (`tsc`), so CI must install the contract's own devDeps too.
- Runner: **ubuntu-latest** — headless Node; no Electron/GUI (that is the desktop gate). The desktop's
  `better-sqlite3` is Electron-ABI; this Linux gate exercises the node-ABI binding, matching where the migration
  test lives.
- Sibling ocr-* services have locks/tests but heavier/unclear CI setup (security surface, native bindings, cross-
  service wiring) → deferred to a documented follow-up per the WI.

## What was added

- `.github/workflows/services-ci.yml` — job `case-box-persistence` on ubuntu-latest, Node 22, `contents: read`,
  concurrency-cancel; triggers on `services/case-box-persistence/**`, `docs/contracts/case-box-contract/**`, and
  the workflow file. Steps: checkout → setup-node (cache both locks) → `npm ci` contract → `npm ci` persistence →
  `npm test`.
- `dev-memo/services-ci-gates.md` + this plan.

## Sibling services

**Deferred** (`ocr-worker`, `ocr-persistence`, `ocr-ingestion`, `ocr-review`): documented in
`dev-memo/services-ci-gates.md` §"Sibling services". Adding each is a new job proven with a clean `npm ci` + `test`
first — not bundled here to keep this WI one clear, low-risk workflow.

## Acceptance (met locally; CI on PR)

Clean-install CI sequence green locally: contract `ci` → persistence `ci` (better-sqlite3 rebuilt, `abi-smoke OK`)
→ `test` **589/273/288**. Desktop regressions unaffected (`apps/lawbar-desktop test` 836/836 · `dist` · smoke M1–M9).

## Requirements honored

No product source; no schema/contract change (contract only in a path filter); desktop + UI-design gates untouched;
no signing/notarization; no secrets; no generated DBs/temp/backups/release artifacts/local data/credentials
committed.

## Out of scope

Sibling ocr-* service CI (documented follow-up); any product/schema change; caching/matrix cleverness beyond the
single clear job.
