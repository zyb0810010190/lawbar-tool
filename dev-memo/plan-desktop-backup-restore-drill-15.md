# Plan — WI-DESKTOP-BACKUP-RESTORE-DRILL-15

**Type**: DATA-SAFETY verification (test + docs). **No product/UI/schema change; no backup-script behavior
change.** Follows WI-11 (`dev-memo/plan-desktop-local-data-backup-restore-11.md`) + FIX1
(`dev-memo/plan-desktop-backup-harden-11-fix1.md`). `main` @ `d9ade65`.

## Goal

Prove the local backup procedure is **restorable** using **synthetic data only** — a backup archive made from a
synthetic Lawbar data dir restores into a fresh temp dir and the DB opens with its records intact.

## Investigation

- The backup script already exposes `--data-dir` and `--out` (WI-11) → no script change needed; the drill drives
  the **existing** fail-closed script through its normal options (`LAWBAR_BACKUP_FORCE_LSOF=closed` for a
  deterministic closed-DB path).
- `sqlite3` CLI is present (`/usr/bin/sqlite3`, 3.43.2) on macOS and the CI runner → the drill creates + queries
  the synthetic DB with it, avoiding the packaged **electron-ABI** better-sqlite3 binding under plain `node --test`.
- Restore is `tar -xzf` into a fresh dir (matches the manual §4 doc procedure).

## What was added

- `apps/lawbar-desktop/tests/backup-restore-drill.test.mjs` — one end-to-end drill: synthetic `case-box.sqlite`
  (WAL, one `drill` row) + `case-box-documents/` placeholder → backup → extract into a fresh temp dir → assert
  files present, **SQLite opens + row round-trips**, no filename leak, and **no repo-tree / `~/Library` writes**
  (all paths under `os.tmpdir()`).
- `apps/lawbar-desktop/package.json` — the drill added to the `test` list.
- `dev-memo/desktop-local-data-backup-restore.md` — new §5a documenting the synthetic drill, explicitly separate
  from the manual production restore (§4).
- this plan.

## Synthetic data used

A temp `case-box.sqlite` (WAL) holding a single `drill(id, note)` row with the fake value
`SYNTHETIC-DRILL-ROW-0001`, plus `case-box-documents/synthetic-placeholder.txt`. No real client data.

## Requirements honored

Synthetic data only; `dev-memo/run/intake/` never inspected/listed/moved/hashed/printed; fail-closed backup
behavior unchanged; no cloud/remote; no UI change; no schema change; no backup archives / temp data / SQLite /
documents / release artifacts committed (all runtime temp under `os.tmpdir()`, cleaned up).

## cc-suite audit + verify (Path 1 runner `cc-suite/0.2.18`, gpt-5.5/high/read-only)

- **Layer-B closeout** of the prior WI-13 window `f14eaf6..d9ade65`: `audit-mrdn7z4l-9lf9g0` → **BATCH-PASS C0 H0 M0**
  (retry after one TIMEOUT `audit-mrdm4tnl-4ntjqd`); closeout `6d5688e`, marker → `d9ade65`.
- **Per-WI drill audit** `audit-mrdn9pqi-6r9467` → C0 H0 **M1 L2** (all real, all in-WI): (M) temp-root containment
  was checked after writes — added an `assertSafeTempRoot()` **preflight** rejecting a `$TMPDIR` inside the repo
  or `~/Library` before any write; (L) confidentiality asserted `stdout` only → now `stdout + stderr`; (L) the
  `sqlite3` CLI is an undeclared host dep — kept fail-loud (present on macOS + the CI runner) and documented here.
  **All fixed / accepted in-WI**; no deferred findings.

## Acceptance (met locally; CI on PR)

`npm test` incl. the new drill · `test:smoke-matrix` M1–M9 · `dist` success · no product behavior changed.

## Out of scope

Any real-data restore, an in-app restore UI, automated production restore, SQLite online-backup, cloud/remote.
