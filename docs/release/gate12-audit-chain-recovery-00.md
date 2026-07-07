# Gate 12 — Audit-Chain Operational Recovery + Tamper-Evidence (drill)

**Status:** audit-chain recovery + tamper-evidence drill **PASS**. **Gate 12 stays `PARTIAL`** (enriched with the drill evidence marker — an operational drill is not a go-live sign-off, and dependent gates remain unresolved). This is **NOT** a clearance of gates 14/18/15, does **NOT** imply gate 7 cleared, and is **NOT** a go-live decision. **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G12-AUDIT-CHAIN-RECOVERY-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `886bad38…`, PR #202/#203/#204/#205), review `dev-memo/run/reviews/queue-review-152.md`.

The drill ran the **existing** hash-chained audit verifier against a disposable `/tmp` fixture; it changed **no** audit-chain implementation, contract, schema, or error code. Environment of record: macOS 15.6.1 · Node v24.14.0 · better-sqlite3 12.x · `CURRENT_SCHEMA_VERSION = 12`. Fixture/disposable only — no real user data. The scripted driver is a disposable `/tmp` drill artifact (NOT committed, no new dependency).

---

## 1. Fixture / disposable data directory
A disposable `/tmp` `case-box.sqlite` (never `~/Library/Application Support/lawbar/`), seeded via the REAL persistence API (`openSqliteCaseBoxPersistence` from the built `dist`): **3 matters** (`01jcasemattermockid0000001/2/3`, tenant `tenant-local-v1`), each with **`createMatter` + `appendFact` + `appendFact` = 3 audit events** — so each matter's hash chain has a **mid-chain** event (sequence 2) with a successor, tamperable to prove detection.

## 2. Backup / restore source
The gate-14 **backup-as-directory** model (`docs/release/gate14-backup-recovery-00.md`, CITED as supporting context — NOT clearing gate 14): the whole disposable data directory is copied out (`cp -R`) after seeding, and restored (drop-directory-back) after the tamper to demonstrate recovery of a verifying chain.

## 3. Audit-chain invariant checks
Per matter, `event_count == COUNT(*) == MAX(sequence)` — read from `case_box_audit_events` (COUNT / MAX(sequence)) cross-checked against `case_box_audit_chain_heads.event_count`. **Held = `{count:3, max:3, headCount:3}` for all 3 matters** at clean, after-tamper, and after-restore.

> **Key nuance (honest finding, not papered over):** the count/sequence invariant **held even under tamper** — mutating an event's `event_json` changes neither the row count nor `MAX(sequence)`. So `event_count==COUNT==MAX(sequence)` proves **structural completeness**, NOT content integrity. **Tamper-evidence comes from the hash chain** (`verifyAuditChain` recomputing `eventHashFn` + the head-anchor cross-check), which is a distinct check. Both are needed; a reader must not treat the count invariant alone as tamper-evidence.

## 4. Tamper-evidence checks
The existing verifier `verifyAuditChainForMatter(matterId)` (`SqliteCaseBoxPersistence.ts:448` → `verifyAuditChainForMatterSqlite` in `auditRepoQueries.ts:126`, which reuses the contract `verifyAuditChain` + `eventHashFn` verbatim) returns `ChainVerifyOk` or `ChainVerifyErr { errorReason }` (a member of the contract `ChainVerifyErrorReason` enum). Tamper: on the disposable DB, directly `UPDATE case_box_audit_events SET event_json=? WHERE matter_id='01jcasemattermockid0000001' AND sequence=2` — mutating a hashed field (`actor_user_id: "local-user" → "tampered-actor"`) of the **mid-chain** event.

Result — **tamper DETECTED**:
- matter `…001` (tampered) → **`ChainVerifyErr` `errorReason=prev_event_hash_mismatch` `errorIndex=2`** — the successor event's stored `prev_event_hash` no longer matches the recomputed hash of the tampered event.
- matters `…002`, `…003` (untouched) → `ChainVerifyOk` (tamper is localized, not a global false-negative).

## 5. Recovery procedure
Restore the disposable data directory from the §2 backup (`rm -rf` the dir + `cp -R` the backup back), reopen. Re-verify:
- matter `…001` → **`ChainVerifyOk`** again + invariant `{3,3,3}` holds.
- matters `…002`, `…003` → `ChainVerifyOk` + invariant holds.
Recovery of a verifying, tamper-evident chain is proven.

## 6. Evidence artifact (drill transcript, disposable fixture)
```
[env] node v24.14.0 | dataDir /tmp/g12-drill-XXXXXX
[1] seeded 3 matters x 3 audit events
[verify:clean]        001/002/003  ChainVerifyOk   invariant{count=3,max=3,headCount=3,holds=true}
[3] backup-as-directory -> /tmp/g12-backup-XXXXXX
[4] tampered matter 001 event sequence=2 (actor_user_id -> tampered-actor)
[verify:after-tamper] 001 ChainVerifyErr(prev_event_hash_mismatch) errorIndex=2 ; 002/003 ChainVerifyOk
[6] restored data dir from backup
[verify:after-restore] 001/002/003 ChainVerifyOk   invariant{count=3,max=3,headCount=3,holds=true}
RESULT: PASS | clean=ChainVerifyOk+invariant, tamper detected=prev_event_hash_mismatch, restore=ChainVerifyOk+invariant
```
(No real case data / no lawyer documents — synthetic fixture matters + facts only. Disposable `/tmp` dirs removed after the run.)

## 7. Explicit PASS / FAIL conclusion
**PASS.** All criteria hold: (a) the clean chain verifies `ChainVerifyOk` and the invariant holds for every matter; (b) an injected mid-chain tamper is DETECTED as `ChainVerifyErr` with the expected `ChainVerifyErrorReason` (`prev_event_hash_mismatch`), not a silent false `ChainVerifyOk`; (c) after restore, the chain verifies `ChainVerifyOk` and the invariant holds. A tamper that had NOT been detected (false `ChainVerifyOk`) would have been a FAIL surfaced as an audit-integrity finding.

## 8. Mode
**Scripted**, run on a disposable `/tmp` fixture. The driver seeds + tampers (direct SQL on the disposable DB) + verifies + restores. It is a **drill artifact** (NOT committed; NOT a product test; adds no runtime dependency) — it only calls the shipped `openSqliteCaseBoxPersistence` + `verifyAuditChainForMatter` and reuses the test `conformance/fixtures.mjs` input builders.

## 9. How the result feeds gate 12 without clearing unrelated gates
A PASS supplies the operational audit-chain recovery + tamper-evidence closure evidence. Per the governed WI (requirement 9), **gate 12 MUST remain `PARTIAL`** — the row is enriched with a `[Δ] audit-chain recovery + tamper-evidence PASS` marker (roll-up bucket unchanged); a `PARTIAL → CLEARED` move is NOT made here (it belongs to a separate holistic readiness-refresh WI). This drill:
- does **NOT** clear **gate 14** (backup+recovery — CITED as supporting context) or **gate 18** (export/backup-format — CITED) or **gate 15** (rollback dry-run — adjacent operational evidence, CITED);
- does **NOT** imply **gate 7** cleared (robustness stays user-decision-dependent, D-G7-1/D-G7-2);
- defers **gate 6** (full-project audit) to later;
- keeps **go-live independence**: an audit-chain drill is not a go-live sign-off. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 17 license/business, gate 21 final sign-off) remain the user's.

## 10. Residual risks / follow-up (separate future WIs — not run here)
- **R-G12-1** — the count/sequence invariant is NOT a tamper detector (§3 nuance); if any operator runbook or check relies on `event_count==COUNT==MAX(sequence)` alone as "integrity", it should be paired with the hash-chain `verifyAuditChainForMatter`. Documentary note; no source change.
- **R-G12-2** — this drill **exercised only the mid-chain** tamper vector (observed: `prev_event_hash_mismatch`, `errorIndex=2`). The **last-event** tamper vector was **NOT exercised in this drill**; per source (`services/case-box-persistence/src/sqlite/auditRepoQueries.ts` step 4 — the head-anchor cross-check compares `case_box_audit_chain_heads.head_hash` against the verifier's computed `headHash` and, on mismatch, returns `errorReason: "prev_event_hash_mismatch"` with the "last-event payload likely tampered" detail), it is **expected** to be caught by the head-anchor cross-check; a follow-up could add an explicit last-event-tamper drill row to exercise it directly rather than relying on the source reading.
- **R-G12-3** — WAL-level / torn-page corruption of the audit tables is out of this drill's scope (that is the gate-7 crash-recovery drill's `PRAGMA integrity_check` surface, PASS); cross-referenced, not re-run.
- No product/source follow-up WI is required; these are documentary notes.
