# Plan — WI-DESKTOP-LOCAL-DATA-BACKUP-RESTORE-11

**Type**: DATA-SAFETY (script + docs + tests). **No product/UI/schema change.** Follows the release-readiness
lane (PRs #241–#246). **`main` @** `86dd59c`.

## Goal

The smallest safe backup/restore readiness step for the desktop app's local-first data store — a guarded
developer/manual **backup script** + documented **restore** procedure, NOT an in-app UI feature or cloud sync.

## Investigation

- **Data files** (`~/Library/Application Support/lawbar/`): `case-box.sqlite` (+ `-wal`/`-shm` when present) +
  `case-box-documents/`. DB is **WAL mode** (`journal_mode = WAL`, `synchronous = NORMAL`).
- **Backup while CLOSED**: safe if the DB is copied together with its `-wal`/`-shm` sidecars + the documents dir.
- **Backup while OPEN**: NOT safe for a file copy (live WAL) → the script **refuses** while lawbar runs. A
  consistent live backup needs SQLite's online-backup API → future in-app feature (out of scope).
- **Restore risks**: overwriting active data, version/schema mismatch, missing/after-backup documents, partial
  restore → restore is a documented **manual/offline** step with a mandatory rollback copy.

## Decision

Documentation + a developer/manual **backup script** + tests; restore documented manually (overwrite risk →
not auto-scripted). No in-app UI, no cloud/remote, no schema change.

## What was added

- `apps/lawbar-desktop/scripts/backup-local-data.mjs` — resolves the data dir (default macOS userData; `--data-dir`
  override), **refuses while the store is IN USE** (WAL-mode; open-handle `lsof` check on DB/`-wal`/`-shm` →
  `pgrep` fallback → **fail-closed** if neither runs; `--allow-running` expert override emits a loud WARNING),
  refuses on missing DB / unsafe `--out` (textual **and** `realpath`-resolved, so a symlinked `--out` can't escape
  into the data dir) / missing dir / dangling option value / existing archive / unsafe `--label`
  (`[A-Za-z0-9._-]` only, no traversal), packages `case-box.sqlite` + `-wal`/`-shm` (if present) +
  `case-box-documents/` into a timestamped `tar.gz` (tar stderr suppressed → generic failure message, partial
  archive cleaned up), and reports counts/sizes/SHA256 **without leaking document filenames or DB contents**.
- `apps/lawbar-desktop/package.json` — `backup:local` alias + the new test in the `test` list.
- `apps/lawbar-desktop/tests/backup-local-data.test.mjs` — 12 cases (happy-path file set incl. WAL/SHM + docs,
  stdout confidentiality, refuse-while-in-use, `--allow-running` warning, missing-DB, unsafe-`--out` textual +
  symlink-resolved, label traversal, dangling-option, archive collision, tar-failure stderr confidentiality,
  missing-dir). Temp dirs only — never touches the real `~/Library`.
- `dev-memo/desktop-local-data-backup-restore.md` + this plan.

## Audit + verify (cc-suite, Path 1 runner `cc-suite/0.2.18`, gpt-5.5/high/read-only)

- **Audit** `audit-mrdj76ev-rugeoq` on the initial script found **C0 H4 M3 L1** — all real, all in-WI scope:
  weak WAL-in-use detection (pgrep-only), silent `--allow-running`, `--label` traversal, tar-stderr leak, arg-value
  validation, symlink `--out` bypass, thin tests, uncontrolled tar-missing. **All fixed in this WI.**
- **Verify** `verify-mrdjehmy-itokbi` → **ALL CLOSED** (8/8). No deferred findings.

**Superseded by FIX1.** A later Layer-B batch audit (`audit-mrdk82ad-vvfvvr`) flagged the running-app override
and detector/reporting as H1 M2. `WI-BACKUP-HARDEN-11-FIX1`
(`dev-memo/plan-desktop-backup-harden-11-fix1.md`) replaced `--allow-running` with a fail-closed model
(positive open handle → non-overridable refuse; `lsof`-unavailable → refuse unless an explicit verbose flag;
exception-safe reporting) and grew the suite to 16 cases. Refer to the FIX1 plan for current behavior.

## Requirements honored

No cloud/remote; local-first not weakened; no schema touched; **never silently copies an open WAL DB** (refuses);
no confidential data in logs (counts/sizes only); generated backup archives not committed; `.mcp.json` untouched;
not broadened into signing/UI/auth/backend.

## Acceptance (met locally; CI on PR)

`npm test` incl. the new backup test · `test:smoke-matrix` M1–M9 · `dist` success · no product behavior changed.

## Out of scope

In-app backup/export UI, automated restore, SQLite online-backup live backup, encryption of the archive,
cloud/remote storage, schema/migration work.
