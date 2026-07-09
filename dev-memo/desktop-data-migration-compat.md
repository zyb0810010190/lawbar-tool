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

It exercises the **real runtime entrypoint** with **synthetic data** in a temp file:
1. Create a file DB at the current version and write synthetic data **through the persistence API**
   (`createMatter` + `registerDocument` with a synthetic `storage_uri` + `appendDocketEntry`).
2. **Simulate an earlier on-disk version** — drop the newest tables (v9–v12) and rewind the `schema_version`
   marker to v8, reproducing what an older app left on disk while keeping the real early-table rows (the early
   tables are schema-identical v8→v12).
3. **Reopen via `openSqliteCaseBoxPersistence`** and assert: the DB opens; schema reaches `CURRENT_SCHEMA_VERSION`;
   the synthetic **matter** is readable through the API with fields intact; the **document + its `storage_uri`
   directory reference** are intact; the **audit / deadline / docket** tables are **not dropped** and the docket +
   audit rows survived; and the v9–v12 tables the old store lacked are re-created by the upgrade.
   A second case proves reopening an already-current DB is an idempotent no-op with data stable.

**Synthetic only.** Everything is a temp file under `os.tmpdir()`; nothing is written into the repo tree or
`~/Library`, and no real client data / `dev-memo/run/intake/` is touched.

## 4. Test-layer decision (why the persistence package, not `apps/lawbar-desktop`)

The migration mechanism **and** `openSqliteCaseBoxPersistence` live in `services/case-box-persistence`, and that
package's `better-sqlite3` is the **node-ABI** binding. The desktop app's own `better-sqlite3` is an **Electron-ABI**
binding that a plain `node --test` **cannot load** (`ERR_DLOPEN_FAILED`) — the desktop unit tests use a fake DB for
that reason. So a real-DB migration test must run at the persistence layer. The desktop calls the **same**
entrypoint, so a green test here **is** the desktop compatibility guarantee.

## 5. Honest gaps / follow-ups

- **Fidelity bound of the "old version" simulation (audit M1, accepted scope).** The old store is created by the
  *current* runtime and then rewound (drop v9–v12 tables + rewind the marker), so the test proves the migration
  **runner** + additive v8→current upgrade + API round-trip over the **current schema history**. It is **not** a
  substitute for a store written by an actual older app **binary**: if a future version altered a v1–v8 table, or
  the persisted `payload_json` shape diverged, only a **pinned old-app fixture** would catch it. That is
  deliberately not built here — the WI prefers generated fixtures over committed binary ones, and a real old-binary
  dump is heavier than this WI's scope. Mitigation: a `V8_TABLES` **self-check** fails the test loudly if the
  simulated store ever contains a post-v8 table the drop-set doesn't account for (so the simulation can't silently
  rot as the schema grows). A pinned-fixture upgrade test is a reasonable future WI.
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
