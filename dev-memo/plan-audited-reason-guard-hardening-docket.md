# PLAN — Audited-reason-guard hardening (whitespace-only reason class)

**Type:** SOURCE/persistence WI (HIGH-RISK — court-facing audit-chain reason integrity). **Status:** DRAFT.
**Branch:** `feature/pta-claimtrack-vertical-slice` (local; no push). **Origin:** batch-284 Layer-B audit
`audit-msfxq8mz-1nf786` L1 (updateMatterDetails accepts whitespace-only `reason`). **Scope review:** Codex consult
`review-plan-msfy1isz-eh3j00` → recommended whole-class fix; evaluated + accepted.

## 1. Problem
The case-box audit chain is court-facing tamper-evidence; each audited mutation records a permanent human-entered
`reason`. Six persistence reason-guards accept a whitespace-only reason (guard `X.length === 0`, missing `.trim()`),
so a `"   "` reason appends an audited event whose court-facing justification is visually blank. Two sites already
use the correct `.trim().length === 0` (`inMemoryClassification.ts:215`, `sqlite/linkRepoQueries.ts:303`) — so
trim-guard is the ESTABLISHED pattern; the six are drift. Partial repair (L1 only) leaves inconsistent evidentiary
guarantees across one audit-chain domain.

## 2. Scope — the 6 persistence sites (condition-only change; keep each existing error code + message)
Change `X.length === 0` → `X.trim().length === 0` at:
1. `services/case-box-persistence/src/inMemoryMatter.ts:157` — `prepareMatterTransition` (archive/unarchive), `opts.reason`, `invalid_argument`.
2. `services/case-box-persistence/src/inMemoryMatter.ts:445` — `prepareMatterDetailsUpdate` (THE L1), `opts.reason`, `invalid_payload`.
3. `services/case-box-persistence/src/inMemoryPrivilege.ts:233` — `opts.reason`, (existing code).
4. `services/case-box-persistence/src/inMemoryDocket.ts:399` — `opts.dismissal_reason`, (existing code).
5. `services/case-box-persistence/src/inMemoryDeadline.ts:124` — `opts.transition_reason`, (existing code).
6. `services/case-box-persistence/src/inMemoryFact.ts:228` — `opts.rejection_reason`, (existing code).

SQLite impls reuse these in-memory pure cores, so one core fix covers both impls per op (parity by construction).

### Decisions (from the Codex consult, evaluated + accepted)
- **Reject-if-blank only; do NOT trim stored values.** The reason is part of the hashed audit event — trimming
  stored text would change event hashes / byte-stability. Reject-only preserves hash stability. Persist exactly
  what was submitted.
- **Keep each op's EXISTING error code.** Whitespace-only follows the SAME path/code that op already throws for the
  empty string. No taxonomy change (would break callers/tests). Messages left as-is (raw message is logs-only; the
  desktop maps the code, not the message).
- **Condition-only edits.** Nothing else in these functions changes.

## 3. Tests (whitespace parity per op)
For each of the 6 ops, assert a whitespace-only reason (`"   "`) is rejected with the op's existing empty-reason
error code, on BOTH the in-memory and SQLite impls. Prefer EXTENDING each op's existing "reason must be non-empty"
hardening/parity test (setup already present) with a whitespace case, rather than a new monolithic file. If an op
lacks an existing empty-reason test, add a focused one. No fixture mutation beyond adding the whitespace assertion.

## 4. Acceptance criteria
1. All 6 guards reject `"   "` with the op's existing error code (in-memory + SQLite); empty string still rejected
   identically; a valid non-blank reason still succeeds.
2. Stored reason text unchanged (no trim on persistence); existing audit-event hashes byte-stable (no golden churn).
3. `npm --prefix services/case-box-persistence test` green (incl. conformance harness); `npm --prefix
   docs/contracts/case-box-contract test` unchanged-green. No contract/desktop change. loc-guardian clean.
4. One revertable local commit; exact-path staging; no push.
5. `dev-memo/deferred-audit-findings.md`: the batch-284 L1 row added as opened+closed (resolved-in this commit),
   noting the whole-class scope.

## 5. Governance + discipline
HIGH-RISK persistence/audit-chain. Scope review = Codex `review-plan-msfy1isz-eh3j00` (whole-class accepted).
Implement → `/cc-suite:audit` on the diff → `/cc-suite:verify`. Fully-green-before-commit. >5 files → risk-trigger;
this WI IS its own bounded batch (its commit becomes the next window; a batch closeout follows per the standing
cadence). No renamed/removed error codes (security-boundary). No push.

## 6. Stop condition
Superseded when committed + verified. Hard-stop if any existing golden/hash test churns (would mean stored-reason
normalization crept in — forbidden by §2). Phase D (renderer edit screen) remains the last edit-case-vertical WI.
