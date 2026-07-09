# Desktop local data — backup & restore

**WI**: `WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11`. A safe, **local-first** backup/restore path for the case-box
data store. **No cloud, no network, no remote storage.** This WI ships a **developer/manual backup script** +
this procedure — **not** an in-app UI feature (that's a documented follow-up).

⚠️ **A backup archive contains the lawyer's actual case data (database + documents) — treat it as CONFIDENTIAL.**
Store it on an encrypted volume (FileVault on, or an encrypted disk image); never email/upload it.

## 1. What the data store is

`app.getPath("userData")` for productName `lawbar` → **`~/Library/Application Support/lawbar/`**:

| Path | What | Backup-critical |
|---|---|---|
| `case-box.sqlite` | the case-box **SQLite database** (WAL mode) | **yes** |
| `case-box.sqlite-wal` | write-ahead log (present when open / after an unclean close) | **yes, if present** |
| `case-box.sqlite-shm` | WAL shared-memory index | yes, if present |
| `case-box-documents/` | app-managed **document storage** (referenced by the DB) | **yes** |

The DB is opened `journal_mode = WAL`, `synchronous = NORMAL` (`services/case-box-persistence/.../openSqliteCaseBoxPersistence.ts`).

## 2. When is a file-copy backup safe?

- **App CLOSED → safe.** Copy the DB **together with its `-wal`/`-shm` sidecars** (if present) and the
  documents dir; SQLite recovers a consistent snapshot from that set.
- **App OPEN → NOT safe for a file copy.** The WAL is being written; a raw copy can capture a half-written log
  → an inconsistent/corrupt backup. The script's WAL-safety gate is **fail-closed**:
  - `lsof` finds an **open handle** on the DB / `-wal` / `-shm` → **REFUSE** (exit 2). **Not overridable** —
    copying an open WAL DB risks an inconsistent, unusable backup of confidential data.
  - `lsof` proves the files are **closed** → proceed.
  - `lsof` **cannot run** (unavailable/inconclusive) → the state is unproven → **REFUSE by default**. Only the
    explicit, deliberately-verbose flag `--i-understand-this-may-create-an-inconsistent-confidential-backup`
    proceeds — and even then it is vetoed if `pgrep` sees the app running. `pgrep` is **advisory only**: it can
    strengthen a refusal, never grant clearance (a quiet process list is not proof the DB files are closed).
  (A consistent live backup would need SQLite's online-backup API — a future in-app feature, out of scope.)

## 3. Backup — procedure

1. **Quit lawbar completely** (⌘Q; confirm it's not in the Dock).
2. Run the backup script, choosing an output location **outside** the data dir (and outside the repo):
   ```
   npm --prefix apps/lawbar-desktop run backup:local -- --out ~/Desktop
   # or, directly:
   node apps/lawbar-desktop/scripts/backup-local-data.mjs --out ~/Desktop
   ```
   Defaults: `--data-dir ~/Library/Application Support/lawbar`, `--out` = current directory.
3. It writes `lawbar-backup-<timestamp>.tar.gz` and prints the path, size, file **counts**, and a SHA256
   (never document filenames or DB contents). Move the archive to encrypted storage.

**Refusals (fail-closed):** open handle → exit 2 (**not** overridable); `lsof` unavailable → exit 2 unless the
verbose `--i-understand-this-may-create-an-inconsistent-confidential-backup` flag (which prints a loud WARNING
and is still vetoed if `pgrep` sees the app running); no `case-box.sqlite` → exit 1; `--out` inside the data dir,
textually **or** after resolving symlinks (`realpath`) → exit 2; data dir missing / dangling option value /
existing archive / unsafe `--label` (must be `[A-Za-z0-9._-]`, no path separators) → exit 1. On a `tar` failure
the script prints a **generic** message (tar's stderr, which can name archived files, is suppressed); post-archive
reporting is exception-safe (a broken symlink / permission error is counted as "unreadable, skipped" — never
named), so a Node stack trace cannot leak a document path.

## 4. Restore — procedure (manual / offline)

Restore is a **deliberate, offline** operation (it overwrites live data), so it is a documented manual step —
**not** automated in this WI.

1. **Quit lawbar completely.**
2. **Keep a rollback copy** — rename the current data dir instead of deleting it:
   ```
   mv ~/Library/Application\ Support/lawbar ~/Library/Application\ Support/lawbar.pre-restore-$(date +%Y%m%d-%H%M%S)
   ```
3. Recreate the data dir and extract the backup **fully** (do not cherry-pick files):
   ```
   mkdir -p ~/Library/Application\ Support/lawbar
   tar -xzf ~/Desktop/lawbar-backup-<timestamp>.tar.gz -C ~/Library/Application\ Support/lawbar
   ```
4. **Relaunch lawbar** and verify matters + documents are present.
5. If anything is wrong: quit, delete the restored dir, and rename the `*.pre-restore-*` dir back.

## 5. Restore risks / caveats

- **Overwriting active data** — always quit first + keep the `*.pre-restore-*` rollback (step 2). Never
  extract over a running app.
- **Version / schema mismatch** — restore into the **same or newer** app version. A backup from a newer
  schema restored into an older app may fail to open. (M0 schema is manual-truth; migrations are additive.)
- **Missing documents** — the archive is a point-in-time snapshot; documents added after the backup are not
  in it. The DB references documents by path under `case-box-documents/` — restore the **whole** set together.
- **Partial restore** — extract the entire archive; restoring `case-box.sqlite` alone (without its `-wal`, or
  without the documents) can lose data or orphan document references.
- **Confidentiality** — the archive holds real case data; keep it encrypted; delete stale copies securely.

## 6. Scope decision (why this shape)

Chosen: **docs + a guarded developer/manual backup script + a documented manual restore** — the smallest safe
step. NOT chosen (deliberately, per the WI): an in-app backup/export UI, an automated restore, or any
cloud/remote path. A future in-app "Back up / Restore case data" action (using SQLite's online-backup API so it
can run while the app is open, with an integrity check + optional encryption) is a separate follow-up WI.

## References
- `apps/lawbar-desktop/scripts/backup-local-data.mjs` (+ `tests/backup-local-data.test.mjs`).
- `dev-memo/desktop-production-launch-readiness.md` (data location), `dev-memo/desktop-rc1-artifact-handoff.md`.
- `services/case-box-persistence/src/sqlite/openSqliteCaseBoxPersistence.ts` (WAL pragmas).
