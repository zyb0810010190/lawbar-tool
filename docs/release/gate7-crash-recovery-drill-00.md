# Gate-7 Crash-Recovery Drill — EVIDENCE RECORD (drill PASS; gate 7 NOT cleared)

> **Status: DRILL EXECUTED — PASS. Gate 7 remains NOT CLEARED.** This document records the
> crash-recovery drill required as the closure evidence for gate-7 robustness-policy criteria
> 1/2/4 (crash/data-loss tolerance; local-first persistence/recovery; audit/event integrity under
> failure), per `docs/release/gate7-robustness-policy-00.md` §2/§3 and user-decision D-G7-2. The
> drill **PASSED**. It supplies evidence; it does **NOT** clear gate 7 and does **NOT** decide
> either user risk-acceptance (D-G7-1 accept-without-mutation-testing; D-G7-2 require-the-drill).
> Produced by `WI-RELEASE-G7-CRASH-RECOVERY-DRILL-00` (Type: EVIDENCE, release-governance MEDIUM).

## 0. Scope + method

- **What was exercised:** the real `case-box-persistence` persistence layer (built `dist/`,
  `openSqliteCaseBoxPersistence`) against a **disposable fixture data directory** under `/tmp`.
  **No real user data**, no `~/Library/Application Support/lawbar/` path, no network.
- **Mode (requirement 9):** **scripted/hybrid** — a disposable `/tmp` driver seeded the fixture via
  the real API, performed a real `kill -9` (SIGKILL) of a child process holding an in-flight
  transaction, and re-opened + integrity-checked the database. The driver lived only in `/tmp`
  and is **not committed** (it is a drill artifact, not a product harness; no new dependency, no
  product source/test/config change).
- **Honest architecture finding:** the v1 implementation uses a **single** `case-box.sqlite`
  database file that holds **both** the domain tables and the audit tables
  (`case_box_audit_events`, `case_box_audit_chain_heads`). The brief §14 "case-box.sqlite +
  audit-log.sqlite" **two-file** manifest is aspirational/documented, not the shipped v1 layout.
  The drill therefore integrity-checks the actual single DB (which contains the audit chain). This
  divergence is recorded as a residual follow-up (§10).

## 1. Fixture / data directory used (requirement 1)

- Root: `/tmp/g7-drill-<pid>/data` (disposable). Manifest: `case-box.sqlite` + `blobs/` directory.
- Pragmas (from `openSqliteCaseBoxPersistence`): `journal_mode = WAL`, `synchronous = NORMAL`
  (confirmed at runtime: `journal_mode: "wal"`, `synchronous: 1`), `busy_timeout = 5000`,
  `foreign_keys = ON`.
- Seed: **3 matters** created via the real `persistence.createMatter(...)` (each writes 1 matter
  row + 1 audit event + 1 audit-chain head). Matter ids are lowercase 26-char ULID-shape.
- Pre-crash counts: `matters=3, audit_events=3, audit_chain_heads=3`. Audit invariant per matter:
  `event_count == COUNT(*) == MAX(sequence) == 1` — **holds for all 3 matters**.

## 2. Backup / restore procedure (requirement 2)

- After seeding, `wal_checkpoint(TRUNCATE)` + close, then **backup-as-directory**: `cp -R data
  data-backup` (the whole directory — the checkpointed `case-box.sqlite` + `blobs/`). This is the
  brief §14 backup-as-directory model (Time-Machine-equivalent snapshot of the data dir).
- Restore step (§E below): wipe the working `data/`, then `cp -R data-backup data` ("drop
  directory back"), re-open, integrity-check.

## 3. Simulated crash / interruption boundary (requirement 3)

- A child `node` process opened the **same** `case-box.sqlite` (WAL), executed `BEGIN IMMEDIATE`,
  inserted **5000 uncommitted rows** into a scratch table `drill_inflight`, wrote a `READY`
  marker, and idled with the transaction **open (uncommitted)**.
- The orchestrator then sent **`SIGKILL` (signal 9)** to that child — a real, unclean
  **process-kill crash boundary** mid-write, with an in-flight uncommitted transaction
  outstanding.
- Measurement note + scope caveat (honest): the parent's `stat` of `case-box.sqlite-wal` at kill
  time read `0` bytes — under `synchronous=NORMAL` the 5000 uncommitted rows were still buffered
  (page cache / not yet fsync'd to the `-wal`). This drill therefore proves recovery from an
  **abrupt process death** while a real SQLite writer holds an uncommitted `BEGIN IMMEDIATE`
  (reopen → integrity-check → rollback verification → audit invariants → restore); it does **not**
  prove recovery from persisted uncommitted WAL frames, torn WAL writes, or storage-level power
  loss (see R-DRILL-2). The meaningful assertion is **post-crash consistency** (below), not the
  pre-kill WAL size: whether the rows were in the WAL or the page cache, after SIGKILL they must be
  **gone** and the DB **consistent** — which is exactly atomic rollback / no torn write.

## 4. SQLite integrity-check results (requirement 4)

- After the SIGKILL, the database was re-opened (`fileMustExist`) and `PRAGMA integrity_check`
  returned **`ok`**.
- The in-flight uncommitted transaction **rolled back atomically**: `drill_inflight` row count
  after crash = **0** (none of the 5000 uncommitted rows survived; no partial/torn write).

## 5. Audit / event integrity results (requirement 5)

- After the crash, the audit invariant **holds for all 3 matters**:
  `event_count == COUNT(*) == MAX(sequence) == 1` (per `case_box_audit_chain_heads` vs
  `case_box_audit_events`). Chain-head/event consistency preserved across the unclean restart
  (overlaps gate 12).

## 6. Recovery result (requirement 6)

- **After crash:** `integrity_check = ok`; domain + audit counts preserved
  (`matters=3, audit_events=3, audit_chain_heads=3`, identical to pre-crash); the only change is
  the atomic rollback of the single in-flight (uncommitted) transaction. **No data loss** beyond
  that rollback.
- **After restore-from-backup:** wiped + restored the directory; `integrity_check = ok`; counts
  preserved (`matters=3, audit_events=3, audit_chain_heads=3`); audit invariant holds for all 3
  matters; `drill_inflight` table absent (it was never committed, so the checkpointed backup never
  contained it — correct).

## 7. Evidence artifacts (requirement 7)

Runtime transcript (fixture-only; no real case data):

| Phase | Result |
|---|---|
| A — seed | `counts={matters:3, audit_events:3, audit_chain_heads:3}`, invariant all_hold=true, `journal_mode=wal`, `synchronous=1` |
| B — backup-as-directory | manifest = `case-box.sqlite` + `blobs/` (post-checkpoint) |
| C — mid-write crash | child holding `BEGIN IMMEDIATE` + 5000 uncommitted rows, `SIGKILL(9)` sent |
| D — verify after crash | `integrity_check=ok`, `inflight_rows_after_crash=0`, counts `{3,3,3}`, invariant all_hold=true |
| E — verify after restore | `integrity_check=ok`, `drill_inflight` table absent, counts `{3,3,3}`, invariant all_hold=true |

Environment: macOS 15.6.1 · Node v24.14.0 · better-sqlite3 12.10.0 · date 2026-07-06 ·
`CURRENT_SCHEMA_VERSION=12`.

## 8. Drill pass/fail conclusion (requirement 8)

**PASS.** All criteria met:
`integrity_check=ok after crash` **AND** `in-flight txn rolled back atomically (0 rows)` **AND**
`audit invariant holds after crash` **AND** `domain+audit counts preserved after crash` **AND**
`integrity_check=ok after restore` **AND** `audit invariant holds after restore` **AND** `counts
preserved after restore`. No corruption, no torn write, no invariant break, no unrecoverable
state — so no class-2 robustness STOP.

## 9. Does the result satisfy D-G7-2 evidence? (requirement 8/D-G7-2)

The drill **produces the crash-recovery evidence** that D-G7-2 asks for — a documented
process-kill (`kill -9`) crash boundary + restart + integrity-check + audit-invariant + restore
round-trip, all PASS. **But
whether this evidence is *required* and whether it *satisfies* the gate-7 bar is the USER's
D-G7-2 decision** (`docs/release/gate7-robustness-policy-00.md` §4). This lane attaches the
evidence; it does **not** answer D-G7-2 for the user.

## 10. Why gate 7 remains blocked + residual follow-ups (requirement 9/10)

Gate 7 stays **NOT CLEARED**. A drill PASS is evidence for criteria 1/2/4; the clear still
requires the two user decisions:
- **D-G7-1** — accept v1 without mutation testing? (unchanged, USER-owned, not decided here).
- **D-G7-2** — require this crash-recovery drill? (unchanged, USER-owned; this drill's PASS
  satisfies the requirement *if* the user answers YES).

Residual follow-ups (separate future WIs; not run here):
- **R-DRILL-1 (finding):** reconcile brief §14's two-file (`case-box.sqlite` + `audit-log.sqlite`)
  backup manifest with the shipped single-file v1 layout — a docs/brief reconciliation, or a
  future storage-split WI. Overlaps gate 14 (backup/recovery procedure) + gate 18 (backup-format
  certification).
- **R-DRILL-2:** if the user wants a stronger crash boundary, a future drill could force an
  `fsync`/checkpoint before the kill so the `-wal` provably holds the uncommitted frames at kill
  time (the current drill already proves post-crash consistency; this would only tighten the
  pre-kill measurement).
- **R-DRILL-3:** the recovery drill overlaps gate 15 (rollback procedure tested) — a future
  gate-15 lane can cite this drill as one exercised recovery path.

## 11. Dependencies (mapped, NOT cleared)

Gate 7 (this drill is its criteria-1/2/4 evidence — informs, does not clear) · gate 12 (audit-chain
`event_count==COUNT==MAX(sequence)` — exercised, PASS) · gate 14 (backup/recovery procedure —
exercised as backup-as-directory + restore) · gate 15 (rollback/recovery — overlaps) · gate 6
(a FAIL would be a robustness finding — none here). None of these gates is cleared by this drill.

## 12. Verdict

Crash-recovery drill **PASS**; gate 7 **NOT CLEARED** — BLOCKED on user decisions D-G7-1/D-G7-2.
No final GO/NO-GO. The final go-live verdict (gate 21) and the three user hard-stops (gates
4/11/21) remain the user's.
