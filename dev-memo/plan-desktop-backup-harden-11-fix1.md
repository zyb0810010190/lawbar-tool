# Plan — WI-BACKUP-HARDEN-11-FIX1

**Type**: DATA-SAFETY remediation (script + tests + docs). Narrow correction of the Layer-B BATCH-FAIL on the
already-merged WI-11 backup script. **No new feature, no `.mcp.json`, no product source.** Follows
`dev-memo/plan-desktop-local-data-backup-restore-11.md` (WI-11).

## Trigger

Layer-B batch audit of window `86dd59c..c234f30` (job `audit-mrdk82ad-vvfvvr`) returned **BATCH-FAIL C0 H1 M2**
on `apps/lawbar-desktop/scripts/backup-local-data.mjs`:

1. **H** — `--allow-running` could copy an in-use WAL DB (warning-only bypass of a positive open state).
2. **M** — detector **fails open**: `lsof` unavailable + `pgrep` clear was treated as clearance, though `pgrep`
   cannot prove the DB files are closed.
3. **M** — post-tar `dirSize()`/reporting could throw an uncaught Node error containing a **document path**.

## Remediation (fail-closed model)

- **F1** — WAL-safety gate is now fail-closed. A positive `lsof` open handle on DB/`-wal`/`-shm` → **REFUSE
  (exit 2), NOT overridable**. `--allow-running` is **removed**; the only override is the deliberately-verbose
  `--i-understand-this-may-create-an-inconsistent-confidential-backup`, which applies **only** to the
  "`lsof` unavailable" case and can **never** bypass a positive open finding.
- **F2** — no fail-open. Only an `lsof`-proved-closed result is clearance. `lsof` unavailable/inconclusive →
  refuse unless the explicit flag; `pgrep` is **advisory only** (a "running" result vetoes even the flag; a
  "clear" result never grants clearance).
- **F3** — reporting is exception-safe. `dirSize()` catches per-entry `stat`/`readdir` errors and counts them as
  `skipped` **without naming them**; the whole report block is wrapped; a reporting failure prints a generic
  line and never a document path. tar stderr stays suppressed.

## Files

- `apps/lawbar-desktop/scripts/backup-local-data.mjs` — detection + refusal rewrite; exception-safe reporting.
- `apps/lawbar-desktop/tests/backup-local-data.test.mjs` — 16 cases incl. real-lsof proven-closed happy path,
  non-overridable open-handle refusal, fail-closed-on-unavailable, `pgrep`-running veto, broken-symlink no-leak.
  Detection is driven via `LAWBAR_BACKUP_FORCE_LSOF` / `LAWBAR_BACKUP_FORCE_PGREP` test hooks.
- `dev-memo/desktop-local-data-backup-restore.md` — refusal semantics + flag updated.
- this plan.

## Acceptance

`npm test` (incl. the 16 backup cases) · `test:smoke-matrix` M1–M9 · `dist` success · no product behavior change.
Post-fix Layer-B audit must cover `86dd59c..<fix-head>` and return BATCH-PASS before the window closes.

## Governance

A BATCH-FAIL hard stop is active. This WI does NOT commit until a human-created `dev-memo/run/human.override`
exists (agent cannot create it). Marker stays `86dd59c`; the override authorizes the corrective commit; the
post-fix Layer-B re-audit covers `86dd59c..<fix-head>`. No push/merge/marker-mutation via the override.

## Out of scope

`.mcp.json` (WI-12), renderer/services/schema/IPC, signing/CI/release, an in-app UI, live/online-backup.
