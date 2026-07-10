# Desktop local data — schema migration / upgrade compatibility

**WI**: `WI-DESKTOP-DATA-MIGRATION-COMPAT-16`. Confidence that an existing local case-box SQLite store created by
an **earlier app version** opens under the current app/runtime **without data loss**. Data-integrity/readiness
work — no new feature, no product/UI/schema change.

## 1. Schema / version mechanism (there IS a formal one)

Source: `services/case-box-persistence/src/sqlite/schema.ts`.

- **Version store:** a `schema_version(version, applied_at)` table is the single source of truth — **not**
  `PRAGMA user_version`. `CURRENT_SCHEMA_VERSION` is the target the current build knows how to reach (12 at time
  of writing; V1 base tables … V12 additive `case_box_links` columns).
- **Runner:** `applySchema(db)` reads `MAX(version)` and:
  - **refuses** a DB whose version is **newer** than this build (`invalid_payload`, before any mutation) —
    forward-incompat is a hard stop, never a silent downgrade;
  - **early-returns** if already current (idempotent no-op);
  - otherwise applies **each missing version's DDL in ONE transaction** and records it (`INSERT OR IGNORE`),
    rolling back on any error. Upgrades are **additive** (`CREATE TABLE IF NOT EXISTS`, additive `ALTER TABLE`),
    so existing rows are preserved.

## 2. How migrations are applied at runtime

`openSqliteCaseBoxPersistence({ path })` (`.../sqlite/openSqliteCaseBoxPersistence.ts`) opens the DB, sets the
desktop pragmas (`journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`), and **runs `applySchema`
unconditionally** on every open. The desktop app calls exactly this entrypoint via
`apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts`. So "the app opens an old DB" == "`openSqliteCaseBoxPersistence`
runs `applySchema`, which upgrades old→current in one transaction."

- **First open (empty):** version 0 → applies v1..current.
- **Re-open (existing, older):** version N → applies vN+1..current, preserving data.
- **Re-open (existing, current):** no-op.
- **Newer-than-build:** refused before mutation.

## 3. What the compatibility test verifies

Test: `services/case-box-persistence/tests/data-migration-compat.test.mjs` (2 cases, in the persistence suite).

It exercises the **real runtime entrypoint** with **synthetic data** in temp files:
1. Write synthetic data **through the persistence API** on a current DB (`createMatter` + `registerDocument` with a
   synthetic `storage_uri` + `appendDocketEntry`) — the authentic-row source.
2. **Build a frozen-DDL v8 store** (FIX1): a fresh DB whose schema is created from a **frozen v1–v8 DDL snapshot**
   embedded in the test (a versioned fixture generated at test time, not a committed binary), populated with the
   authentic API rows copied in via `ATTACH` (early-table columns are identical v8↔current, never altered). Self-
   checks assert it is a v8 store (marker = 8, no v9+ table) holding the synthetic rows.
3. **Reopen via `openSqliteCaseBoxPersistence`** and assert: the DB opens; schema reaches `CURRENT_SCHEMA_VERSION`;
   the synthetic **matter** is readable through the API with deep fields intact; the **document + its `storage_uri`
   directory reference + fields** are intact; the **audit / deadline / docket** tables are **not dropped**, the
   docket row survives **by id**, and the **audit chain head + events** survive and stay consistent
   (`event_count == COUNT`); and the v9–v12 tables the old store lacked are created by the upgrade.
   A second case proves reopening an already-current DB is an idempotent no-op (stable `schema_version` rows + data).

**Synthetic only, and guarded.** An `assertSafeTempRoot()` **preflight** refuses to run if `os.tmpdir()` resolves
inside the repo tree or `~/Library`. Everything is a temp file under `os.tmpdir()`; nothing is written into the repo
tree or `~/Library`, and no real client data / `dev-memo/run/intake/` is touched.

## 4. Test-layer decision (why the persistence package, not `apps/lawbar-desktop`)

The migration mechanism **and** `openSqliteCaseBoxPersistence` live in `services/case-box-persistence`, and that
package's `better-sqlite3` is the **node-ABI** binding. The desktop app's own `better-sqlite3` is an **Electron-ABI**
binding that a plain `node --test` **cannot load** (`ERR_DLOPEN_FAILED`) — the desktop unit tests use a fake DB for
that reason. So a real-DB migration test must run at the persistence layer. The desktop calls the **same**
entrypoint, so a green test here **is** the desktop compatibility guarantee.

## 5. Honest gaps / follow-ups

- **Fidelity bound of the old-store fixture (FIX1; residual of audit M2 — tracked in
  `dev-memo/deferred-audit-findings.md`).** FIX1 replaced the earlier "create-at-current-then-rewind" approach with a
  **frozen v1–v8 DDL** fixture, so the store's schema is built from the historical v8 DDL, not derived from a current
  DB. The remaining, deliberately-accepted limitation: the rows copied into it use the **current serialized
  `payload_json` shape** (they come from the current API), so the test still does **not** prove compatibility with an
  actual older app binary's persisted-JSON quirks. Fully closing that needs a **pinned old-app snapshot fixture**,
  which the repo has chosen not to commit as a binary (WI guidance: prefer generated fixtures). Recorded as a
  deferred finding with a "pinned old-app fixture" follow-up. A `V8_TABLES` self-check also fails the test loudly if
  the fixture/schema drift (e.g. a post-v8 table appears), so it cannot silently rot.
- **No CI runs the persistence package** today (only `apps/lawbar-desktop`, `evidence-core-swift`, and the UI-design
  gate have workflows). This test therefore runs locally / in `npm --prefix services/case-box-persistence test`,
  **not** in PR CI. Recommend a follow-up SCAFFOLD/CI WI to add a `case-box-persistence` (and sibling services) CI
  workflow so migration + conformance suites gate PRs. Out of scope for this data-integrity WI.
- A true end-to-end desktop-under-Electron migration open (rather than the identical persistence entrypoint) would
  need an Electron test harness; deferred as heavier than the value, since the entrypoint is identical.

## References
- `services/case-box-persistence/src/sqlite/schema.ts` (`CURRENT_SCHEMA_VERSION`, `applySchema`).
- `services/case-box-persistence/src/sqlite/openSqliteCaseBoxPersistence.ts` (runtime entrypoint + WAL pragmas).
- `services/case-box-persistence/tests/hardening-schema.test.mjs` (version-level upgrade/refusal tests this builds on).
- `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` (desktop calls the same entrypoint).
