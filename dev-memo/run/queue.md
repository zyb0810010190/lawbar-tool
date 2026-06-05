## WI-301: fail-closed validation of batch config values
Type: WORKFLOW
Scope: validate AUTO_ADVANCE_MAX (allowed set {1,3,10}) and BATCH_AUDIT_EVERY (integer in [1,100]) in batch-commit-guard.sh so malformed, non-numeric, or huge-digit values fail closed (deny) instead of crashing the bash integer compare and silently disabling the breaker
Source of truth: dev-memo/deferred-audit-findings.md (BCG-7 row); .claude/hooks/batch-commit-guard.sh
Allowed files: .claude/hooks/batch-commit-guard.sh, .claude/hooks/tests/batch-commit-guard-base.test.sh, dev-memo/deferred-audit-findings.md
Forbidden files: none
Gates: bash .claude/hooks/tests/batch-commit-guard-base.test.sh && bash .claude/hooks/tests/batch-commit-guard-detect.test.sh
Acceptance criteria: a config with AUTO_ADVANCE_MAX non-numeric or outside {1,3,10}, or BATCH_AUDIT_EVERY non-numeric or outside [1,100], causes the hook to block the commit (fail-closed); valid AUTO_ADVANCE_MAX in {1,3,10} with BATCH_AUDIT_EVERY in [1,100] still pass; new regression tests for malformed config pass
Risk flags: security-boundary (commit-boundary enforcement hook); broker review-plan + audit + verify required; do not weaken any existing deny
Depends on: none
Commit boundary: one local commit for the config-validation hardening + tests + ledger row

## WI-302: atomic consumption of human.ack and human.override gated tokens
Type: WORKFLOW
Scope: in batch-commit-guard.sh, treat a single-use human.ack (gated mode) or human.override (batch escape) as consumed ONLY when its file removal succeeds; if rm fails (or the override log append fails) the hook must block the commit rather than allow it on a token that still exists on disk
Source of truth: dev-memo/deferred-audit-findings.md (BCG-4 + BCG-5 rows); .claude/hooks/batch-commit-guard.sh
Allowed files: .claude/hooks/batch-commit-guard.sh, .claude/hooks/tests/batch-commit-guard-base.test.sh, dev-memo/deferred-audit-findings.md
Forbidden files: none
Gates: bash .claude/hooks/tests/batch-commit-guard-base.test.sh && bash .claude/hooks/tests/batch-commit-guard-detect.test.sh
Acceptance criteria: when token removal fails the hook blocks the commit and the token is not treated as reusable; a successful single use removes the token and passes exactly once; regression tests covering rm-failure and append-failure paths pass
Risk flags: security-boundary High (reusable gated/override token = breaker bypass); broker review-plan + audit + verify required; do not weaken any existing deny
Depends on: none
Commit boundary: one local commit for the token-atomicity hardening + tests + ledger rows

## WI-303: correct stale command-failure row in encryption-at-rest plan
Type: EVIDENCE
Scope: fix the stale §6.1 table row in dev-memo/plan-encryption-at-rest-00.md that says command failure should "proceed with audit log" so it matches §4.1 and the shipped Tier 1 impl (command failure -> unknown -> block-prod / warn-dev)
Source of truth: dev-memo/plan-encryption-at-rest-00.md §4.1 (authoritative behavior); dev-memo/deferred-audit-findings.md (AT1-L3 row)
Allowed files: dev-memo/plan-encryption-at-rest-00.md, dev-memo/deferred-audit-findings.md
Forbidden files: none
Gates: bash -c 'grep -q "block-prod" dev-memo/plan-encryption-at-rest-00.md && ! grep -n "proceed with audit log" dev-memo/plan-encryption-at-rest-00.md'
Acceptance criteria: plan §6.1 no longer contains the phrase "proceed with audit log" for command failure and instead matches §4.1 (unknown -> block-prod / warn-dev); the AT1-L3 ledger row flips to closed
Risk flags: none (doc-only; no impl/behavior change)
Depends on: none
Commit boundary: one local commit for the doc-correctness fix + ledger row
