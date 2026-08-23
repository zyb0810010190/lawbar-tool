# Gate 14 — Backup + Recovery Procedure (v1 local-first, macOS)

> **Provenance note (2026-08-22).** The governance queue, review tree and autonomy rules
> cited below were removed together with the agent-governance layer in commits `49dd7ad`
> and `e67b047`. Those citations — queue and review paths, sha256 digests, PR numbers —
> are retained deliberately as the audit trail of what authorized this work. They record
> provenance; they are not paths you can follow today. Current authority for hard stops
> is `docs/product/product-definition.md` §20.


**Status:** procedure documented + drill-verified. **Gate 14 is NOT CLEARED** (a documented procedure is evidence, not a go-live sign-off; a brief §14 manifest reconciliation remains, and export-format certification is gate 18). **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G14-BACKUP-RECOVERY-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `3e8a9f7b…`, PR #196 merge `abab91f`), review `dev-memo/run/reviews/queue-review-146.md`.

This is the operator-facing data-survival runbook for the single-Mac v1 client. Robustness bar = **local-first data survival + recovery on one Mac** (`.claude/rules/client-local-first.md`), NOT distributed/replicated backup. All command examples use **fixture/placeholder paths** — no real lawyer data appears in any transcript.

---

## 1. Real data-directory manifest (grounded in source)

Read from source **2026-07-07** (per `AGENTS.md` §"Source hierarchy": generated local output beats static documentation — the manifest below is the shipped reality, not the brief's model). Environment of record: macOS 15.6.1 · Node v24.14.0 · better-sqlite3 12.10.0 · `CURRENT_SCHEMA_VERSION = 12` (`services/case-box-persistence/src/sqlite/schema.ts:51`).

The app resolves its data root from Electron's `userData`:

- `apps/lawbar-desktop/electron/main.ts:27` — `app.setName("lawbar")`, so `app.getPath("userData")` → **`~/Library/Application Support/lawbar/`** on macOS.
- `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts:14,42` — `CASE_BOX_DB_FILENAME = "case-box.sqlite"`, joined onto `userDataDir`.
- `apps/lawbar-desktop/electron/main.ts:116` — `documentStorageRoot = path.join(userDataDir, "case-box-documents")`.
- `apps/lawbar-desktop/src/persistence/themePreference.ts` — `theme-preference.json`, joined onto `userDataDir`.

**Backup manifest** (everything under `~/Library/Application Support/lawbar/`):

| Item | What it is | Criticality |
|---|---|---|
| `case-box.sqlite` | The single case-box database — holds BOTH the domain tables AND the audit tables (`case_box_audit_events`, `case_box_audit_chain_heads`). **This is the primary irreplaceable artifact.** | **CRITICAL** |
| `case-box.sqlite-wal`, `case-box.sqlite-shm` | WAL write-ahead-log + shared-memory sidecars (WAL mode is set on open — `openSqliteCaseBoxPersistence.ts:41` `journal_mode = WAL`). Transient at clean shutdown (checkpointed), but hold the last-committed transactions if present at copy time. | **CRITICAL when present** (see §2 hot-copy caveat) |
| `case-box-documents/` | The document/blob store — the original uploaded files the DB rows reference. | **CRITICAL** |
| `theme-preference.json` | UI light/dark preference. | Non-critical (regenerable — defaults on next launch) |

**Divergence from brief §14 → `RECONCILIATION-NEEDED`.** Brief §14 describes a **two-file** manifest — `case-box.sqlite` **+ a separate `audit-log.sqlite`** + a `blobs/` store. The shipped v1 reality is **one** `case-box.sqlite` (the audit tables live inside it, confirmed by the gate-7 crash-recovery drill finding R-DRILL-1) plus a `case-box-documents/` directory (not `blobs/`). This procedure documents reality; the brief is **not** edited here. See §7 for the reconciliation log + the proposed follow-up WI.

---

## 2. Backup procedure (backup-as-directory)

The backup unit is the **whole data directory**, copied as a directory (brief §14 "backup-as-directory" model). Two supported paths:

**Preferred — app-closed (quiesced) copy.** Quit the lawbar app first, then copy. At clean shutdown the WAL is checkpointed into `case-box.sqlite`, so the DB file is self-contained.

```
# fixture/placeholder paths — substitute the real userData root on the operator's Mac
SRC="$HOME/Library/Application Support/lawbar"
DEST="/Volumes/backup-fixture/lawbar-backup-2026-07-07"     # external disk / Time-Machine target
cp -R "$SRC" "$DEST"
```

A macOS **Time Machine** backup of `~/Library/Application Support/lawbar/` is equivalent and is the recommended zero-effort path for non-technical operators (Finder → the folder is included in the default Time Machine set).

**Hot copy (app running) — sidecars mandatory.** If the directory is copied while the app is open, the copy **MUST** include the `-wal` and `-shm` sidecars (they hold the last-committed transactions not yet checkpointed into the main file), OR a `wal_checkpoint(TRUNCATE)` must run first. A hot copy of `case-box.sqlite` alone risks losing the most recent committed work. Prefer the app-closed path; document the hot-copy caveat so an operator does not silently take an incomplete backup.

---

## 3. Restore procedure (drop-the-directory-back)

1. Quit the lawbar app.
2. Replace the data directory with the backup copy. **Rename the current directory aside first** (never delete before the restore is confirmed good) — this keeps a rollback path if the backup turns out to be bad:

   ```
   SRC="/Volumes/backup-fixture/lawbar-backup-2026-07-07"
   DEST="$HOME/Library/Application Support/lawbar"
   # 1. move the existing dir aside (do NOT delete it yet); operator confirms DEST is the lawbar data dir first
   mv "$DEST" "$DEST.pre-restore-2026-07-07"
   # 2. drop the backup into place
   cp -R "$SRC" "$DEST"
   # 3. only after §4 verification passes, remove the aside copy: rm -rf "$DEST.pre-restore-2026-07-07"
   ```

3. Relaunch. On open, `openSqliteCaseBoxPersistence` (`openSqliteCaseBoxPersistence.ts:41,50`) re-asserts `journal_mode = WAL` and runs `applySchema(db)`. `applySchema` is the **de-facto startup schema-integrity gate**: it is version-gated on the `schema_version` table and **refuses to open a DB whose on-disk version is newer than the supported `CURRENT_SCHEMA_VERSION` (12)** (`schema.ts:704` — "schema version … on disk is newer than supported … refusing to apply migration"), and applies any pending additive migrations `current+1..CURRENT` in a single `BEGIN/COMMIT`. A clean restore opens without error and presents the restored matters/documents.

> Note on brief §14 wording: brief §14 says restoration triggers a "startup schema-integrity check + audit-chain verification". In the shipped code, the **schema-integrity/version gate runs automatically on open** (`applySchema`), whereas **audit-chain verification is an on-demand API** (`verifyAuditChainForMatter(matterId)` — `services/case-box-persistence/src/types.ts:147`), not an automatic startup pass. §4 runs it explicitly as a post-restore verification step rather than relying on an automatic startup check that the code does not (yet) wire.

---

## 4. Verification / recovery checks (post-restore)

Run after any restore (fixture example):

1. **SQLite integrity** — `PRAGMA integrity_check` on `case-box.sqlite`; expected output: `ok`.

   ```
   sqlite3 "$HOME/Library/Application Support/lawbar/case-box.sqlite" "PRAGMA integrity_check;"
   # expected: ok
   ```

2. **Audit-chain integrity (per matter)** — the hash-chained audit log verifies and the invariant `event_count == COUNT(*) == MAX(sequence)` holds for each matter (`AGENTS.md` §"Critical invariants"; overlaps **gate 12** — cited, not deep-dived here). Programmatically via the persistence API `verifyAuditChainForMatter(matterId)`; or as a direct SQL cross-check against `case_box_audit_events` / `case_box_audit_chain_heads`.

3. **Blob-store presence** — every document row's stored file exists under `case-box-documents/` (the DB references content by the stored filename; a restore is complete only if the directory came back with the DB).

A restore is **good** iff: `integrity_check = ok` AND the audit invariant holds for every matter AND the referenced blobs are present.

---

## 5. Verification evidence — the executed crash-recovery drill

This procedure is **already exercised and verified** by the gate-7 crash-recovery drill (`docs/release/gate7-crash-recovery-drill-00.md`, **PASS**, WI-RELEASE-G7-CRASH-RECOVERY-DRILL-00, `main` @ `5024a06`). That drill, on a disposable `/tmp` fixture against the real `case-box-persistence` layer, performed exactly the backup-as-directory → crash → reopen → restore round-trip this runbook describes and recorded:

- `PRAGMA integrity_check = ok` after a `kill -9` mid-write;
- an in-flight uncommitted transaction rolled back **atomically** (0 rows) — never torn;
- the audit `event_count == COUNT(*) == MAX(sequence)` invariant holding **across both the crash and the restore** round-trip;
- seeded counts `{3,3,3}` preserved.

Rather than re-run a live backup here, this runbook **cites that PASS as its verification**. Two disclosed drill residuals bear on backup completeness:

- **R-DRILL-1** — v1 is the single-file `case-box.sqlite` layout (audit tables inside), not the brief §14 two-file model. This runbook's §1 manifest reflects reality; §7 logs the reconciliation.
- **R-DRILL-2** — the drill's crash boundary was a **process kill** with `case-box.sqlite-wal` observed at `0` bytes at kill time; it proves abrupt-process-death recovery, not storage-level power-loss / torn-WAL recovery. The §2 hot-copy sidecar caveat is the operational counterpart of this residual.

---

## 6. Scope boundaries + honest status

**This runbook does NOT cover** (each is a separate gate/lane):

- **Data-export / backup-format certification** — **gate 18** (certify an export format + fidelity). This runbook is the input (what to back up); format certification is separate.
- **Rollback dry-run** — **gate 15** (the crash-recovery drill in §5 is a related exercised recovery path that gate 15 may cite; a dedicated non-critical-artifact rollback dry-run is gate 15's own lane).
- **Audit-chain operational-recovery deep-dive** — **gate 12** (§4.2 cites the invariant verification; the full tamper-evidence/operational-recovery treatment is gate 12).

**Related gates mapped, not cleared:** gate 6 (a procedure gap would be a finding for that full-project sweep); gate 7 (the drill that verifies this procedure — informs, does not clear).

**Gate-14 status:** the backup + recovery procedure is now **documented and drill-verified**, but gate 14 **stays OPEN** in the readiness matrix (PARTIAL-eligible at the next holistic readiness refresh, which also weighs the gate-18 export-format overlap and the §7 reconciliation). A documented procedure does **not** imply go-live; the final GO/NO-GO and the three STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 21 final sign-off) remain the user's.

---

## 7. Reconciliation log

| # | Section | Conflicting source | Prior wording | Reality (this doc) | Proposed resolution |
|---|---|---|---|---|---|
| R14-1 | §1 manifest | `docs/product/product-definition.md (Part I)` §14 | Backup manifest = `case-box.sqlite` **+ `audit-log.sqlite`** + `blobs/` (two SQLite files + a `blobs/` store) | **One** `case-box.sqlite` (audit tables inside it) + `case-box-documents/` (not `blobs/`) + `theme-preference.json` | **`RECONCILIATION-NEEDED`.** Do NOT edit the brief in this lane. Open a bounded reconciliation WI to update brief §14's manifest wording to the shipped single-file + `case-box-documents/` layout (or to record the divergence as accepted), routed through `/cc-suite:review-plan` per `.claude/rules/project-brief.md` §"Conflict handling". Until then, **this runbook's §1 manifest is authoritative for backup** (generated output beats static doc). |

---

## 8. Residual follow-ups (separate future WIs — not run here)

- **R14-FUP-1** — the brief §14 two-file → single-file manifest reconciliation WI (see §7 / R14-1). Overlaps the drill's R-DRILL-1.
- **R14-FUP-2** — gate 18 export/backup **format certification** (a certified, fidelity-checked export format) — a separate lane; this runbook is its input.
- **R14-FUP-3** — optionally wire an **automatic** post-open audit-chain verification (today `verifyAuditChainForMatter` is on-demand; brief §14 implies a startup pass). Product-source change → a separate governed WI, not docs.
- **R14-FUP-4** — a stronger backup completeness check that reasons about the WAL sidecars at hot-copy time (counterpart of drill R-DRILL-2).
