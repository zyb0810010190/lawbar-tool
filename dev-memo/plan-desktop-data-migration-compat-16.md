# Plan — WI-DESKTOP-DATA-MIGRATION-COMPAT-16

**Type**: DATA-SAFETY verification (test + docs). **No product/UI/schema change.** Data-integrity/readiness WI.
Follows the backup/restore arc (WI-11 → FIX1 → WI-15). `main` @ `a7977ce`.

## First step (done)

Due Layer-B closeout for window `d9ade65..a7977ce`: `audit-mrdnr79z-uislqh` → **BATCH-PASS C0 H0 M0**;
closeout `3ff1211`, marker → `a7977ce`.

## Goal

Confidence that an existing local case-box SQLite store created by an **earlier app schema version** opens under
the current runtime **without data loss**.

## Investigation (see `dev-memo/desktop-data-migration-compat.md` for detail)

- **Schema/version mechanism EXISTS**: a `schema_version` table (not `PRAGMA user_version`),
  `CURRENT_SCHEMA_VERSION`, and a transactional incremental `applySchema(db)` runner that refuses future
  versions, is idempotent at current, and applies missing versions additively.
- **Applied at runtime**: `openSqliteCaseBoxPersistence` runs `applySchema` unconditionally on open; the desktop
  calls this exact entrypoint (`caseBoxRuntime.ts`).
- **Backward-compat already partially covered** at the version level (`hardening-schema.test.mjs`); the new value
  is a **runtime-entrypoint + API round-trip** across a simulated old→current upgrade.
- **ABI constraint**: the desktop's `better-sqlite3` is Electron-ABI (`ERR_DLOPEN_FAILED` under plain node); the
  persistence package's is node-ABI. → the real-DB migration test must live in `services/case-box-persistence`.

## What was added

- `services/case-box-persistence/tests/data-migration-compat.test.mjs` — 2 cases: (1) write synthetic
  matter/document/docket via the API at current version, simulate a v8 on-disk store (drop v9–v12 tables + rewind
  the marker), reopen via `openSqliteCaseBoxPersistence`, assert upgrade-to-current + matter/document(+storage
  ref)/docket/audit survive + audit/deadline/docket tables not dropped + v9–v12 tables restored; (2) idempotent
  reopen. Temp files under `os.tmpdir()` only.
- `services/case-box-persistence/package.json` — the test added to the suite.
- `dev-memo/desktop-data-migration-compat.md` + this plan.

## Synthetic data used

A temp file `case-box.sqlite` (WAL) with one synthetic matter ("Synthetic Migration Matter"), one document
(`storage_uri: file:///tmp/synthetic-doc.pdf`), one docket entry — all via the persistence API. No real data.

## Requirements honored

Synthetic data only; `dev-memo/run/intake/` never touched; backup fail-closed behavior untouched; no cloud/sync/
auth; no UI change; no schema change (SCHEMA verified compatible, not modified); no committed SQLite/backup/temp/
release artifacts (all runtime temp under `os.tmpdir()`, cleaned up).

## Acceptance (met)

`npm --prefix services/case-box-persistence test` (incl. the 2 new cases) → 589/273/288 pass · desktop regression
`npm --prefix apps/lawbar-desktop test` 836/836 · `dist` ok · `test:smoke-matrix` M1–M9 ok · no product behavior change.

## Honest gap / follow-up

No CI runs the persistence package (only desktop / evidence-core-swift / UI-design). This test runs locally, not in
PR CI. Recommend a follow-up SCAFFOLD/CI WI to add persistence (+ sibling services) CI. Out of scope here.

## Out of scope

Adding CI workflows; an Electron end-to-end migration harness; any schema change; real-data migration.
