# Queue review — WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00 (execution: tenant-scoping fix)

Lane: EXECUTION of the governed Type:IMPL security-boundary HIGH-RISK WI `WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00` — implement the predicate-only tenant-scoping fix that closes the gate-10 audit's M-1/M-2/L-1, run the full test suite + the required broker security audit, and append the gate-10 sign-off.
Date: 2026-07-04. Branch: `sec-casebox-tenant-scoping-defense` (from synced `main` @ `80803da`). Batch: 1/3 since marker `faef514` — no batch closeout this lane.

## What shipped
Predicate-only, SQLite-only source change (the in-memory reads already row-level tenant-filter, so parity holds and no in-memory source was touched). 10 files changed: the 9 `sqlite/*RepoQueries.ts` fix targets + `tests/tenant-filter-lists.test.mjs` (+365 lines, 14 regressions). Plus this lane's two-lane deliverables: the gate-10 sign-off append to `docs/release/casebox-persistence-security-audit-00.md` §8 + this review artifact.
- **M-1** (8 reads): row-level `tenant_id = ?` predicate binding `query.tenant_id`, keeping `requireMatterTenant`. Caller-tenant enforcement.
- **M-2** (7 mutation UPDATEs): scoped `WHERE id = ? AND tenant_id = ? AND matter_id = ?` bound to the resolved row's own tenant/matter + `RunResult.changes === 1` guard (throws stable `invalid_argument`) BEFORE the audit-event write. Atomic-consistency, not caller-rejection. `updateMatterRow` excluded. `updateLinkMarkerRow` (private) gained `tenantId`/`matterId` params; caller `applyLink` updated.
- **L-1**: 14 regressions (8 M-1 exclusion + 6 M-2 scope-drift-raises), red-before/green-after; `updateLinkMarkerRow` guard documented as untamper-testable (resolver + WHERE read the same lifted columns).
No schema/DDL (`CURRENT_SCHEMA_VERSION` 12), no contract/dependency/native/renderer change, no error-code rename; stable `tenant_mismatch`/`unknown_matter` surface + `requireMatterTenant` preflight + write-time invariant preserved.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Security = HIGH-RISK broker category → the broker `/cc-suite:audit` is REQUIRED (not self-review). Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`.

### /cc-suite:audit (security persona, on the fix diff)
- Attempt 1: `audit-mr70anim-61n6u0` · **FAILED — TIMEOUT** (`spawnSync codex ETIMEDOUT`; gpt-5.5/**high**/read-only over the diff hit the runner's 30-min internal timeout; runner wrote a clean failed envelope — NOT a HARNESS_REAP, the runner PID stayed alive to completion and returned the failed JSON). Failure class **TIMEOUT** per `.claude/rules/cc-suite.md` §"Timeout / failure classification". Retry policy for audit: reduce effort + lean the prompt (batch-207 precedent).
- Attempt 2 (retry): `audit-mr71e737-lqz7sg` · gpt-5.5/**medium**/read-only, lean 5-point prompt · **CLEAN — FINDINGS: C0 H0 M0 L0** · rawOutput sha256 `6899e13d5bc2612bbe9f055af1a050228718c09e1d8fc900ab7b180d6bfa56c7` · retrievable YES. All five checks PASS: (1) placeholder order matches params/`.all()` order in all 8 reads; (2) the M-2 guard binds the resolved row's own tenant/matter, asserts `changes === 1` throwing stable `invalid_argument`, and the audit-event write occurs AFTER the guarded update; (3) new predicates parameterized `?` (no injection); (4) no same-tenant regression across archive/successor/replacement/superseded flows; (5) no schema/DDL, preflight preserved.

### /cc-suite:verify
Not applicable — a CLEAN audit (C0 H0 M0 L0) has no findings to close, so verify is **vacuously ALL CLOSED** (no fixes were applied off the audit; the audit confirmed the implementation as-shipped). No second broker call made (avoids a redundant timeout).

## Gates (this execution lane)
- `npm --prefix services/case-box-persistence test` → **PASS** (587 / 273 / 288, 0 fail; conformance + hardening + impl-parity + tenant-filter all green; `tenant-filter-lists.test.mjs` 17/17 — 3 pre-existing FACTS-AUD-1 + 14 new). Tests-first honored: the 14 new tests FAIL against unpatched source (RED), PASS after the fix (GREEN).
- `scripts/workflow/check-queue.sh` → PASS. `scripts/workflow/check-contract-integrity.sh` → PASS (14 docs).
- `CURRENT_SCHEMA_VERSION` unchanged (12). Diff confined to the 10 allowed source/test files + the §8 sign-off append + this artifact (verified via `git diff --name-only`); no forbidden file touched.

## Verdict: READY (tenant-scoping fix; audit CLEAN; gate 10 CLEARED pending user go-live approval)

QUEUE_REVIEW_VERDICT=PASS

## Deferred findings
None. The broker audit returned C0 H0 M0 L0. The `updateLinkMarkerRow` guard's lack of a tamper test is a documented property (the resolver + WHERE read the same lifted columns), not a deferred finding. Gate 10 is recorded CLEARED **pending user go-live approval** (audit report §8); this does NOT assert go-live — the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops remain the user's.
