---
name: security-wi-loop
description: Use when implementing a security-sensitive WI (SSRF, TLS, DNS, fetcher, auth, sandbox, crypto). Enforces plan-review → tests → implement → audit → verify → sign-off with no surface drift.
---

# security-wi-loop

Workflow for a single bounded security WI. Triggered by [[../../commands/continue-project]] when the next WI matches the path scope of [[../../rules/security-boundary]], or invoked directly.

## Preconditions

- `git status` is clean of unrelated work (`/branch-clean` returned SAFE or DIRTY-RECOVERABLE that was repaired).
- The WI has an id (e.g. `WI-04`, `WI-05a`) and an associated plan or ADR draft.
- The change scope sits inside [[../../rules/security-boundary]] applies-to globs.

## Steps

### 1. Plan

- Draft or read the plan doc (`docs/adr/...md` or `dev-memo/...md`).
- Plan must state: the gap closed, the invariant added, the prior failure mode, the surface promised to callers (error codes, types, exceptions), and the test list.
- If absent, **draft** the plan doc and stop for `/review-plan`.

### 2. Plan review

- Run `/review-plan` (cc-suite Codex review) on the plan doc.
- Apply review fixes. Re-run review until clean.
- **Branch:** if review demands product-direction changes outside the WI scope, open a sub-WI rather than expanding.

### 3. Test scaffold (red)

- Add regression tests for:
  - The invariant the WI installs (positive case).
  - The prior failure mode that should now be blocked (negative case proving the gap closes).
  - Error-surface stability — assert exact `OcrQueueError` codes / exported error classes when the boundary is in `services/ocr-worker` or contract-touching code.
- Run tests; they must fail in the expected places.

### 4. Implement (green)

- Minimal change satisfying the WI. No drive-by edits.
- **Do not** rename or remove existing error codes, class identities, or exported types unless the plan explicitly authorizes and an ADR records the surface diff.

### 5. Tests (green)

- Run all relevant package tests:
  - `npm --prefix docs/contracts test`
  - `npm --prefix services/ocr-worker test`
  - `npm --prefix services/ocr-persistence test`
  - `npm --prefix services/ocr-ingestion test`
  - `npm --prefix services/ocr-review test`
- Only the WI-relevant packages need rerun if scope is local; full sweep before commit.

### 6. Audit

- `/audit-fix` on the changed scope.
- If `/audit-fix` is not authorized for this scope, use `/audit` and fix findings manually inside the WI.
- Re-run until no Critical/High remain.

### 7. Verify

- `/verify` against the audit report.
- All findings must show closed status.

### 8. Sign-off doc

- If the WI closes a previously-flagged audit gap, append to `docs/release/wi-XX-security-signoff.md` (or create one following the `wi-03-security-signoff.md` shape):
  - Commit chain, audit ids, residual items.
- **Sign-off is per-WI only.** It is not a go-live claim.

### 9. Commit gate

- Run [[../../commands/commit-gate]]. Explicit staging. Cached-diff confirm.
- Commit message references the WI id.

### 10. Continue or stop

- If next WI is unblocked and not on the hard-stop list, hand back to [[../../commands/continue-project]].
- If go-live readiness is the next gate, **stop** — go-live is hard-stop ([[../../rules/autonomy]]).

## Failure modes

- **Audit cannot reach clean inside WI scope** — open a sub-WI; do not expand the current one.
- **Surface drift required** — stop, draft ADR, return to step 1 for re-review.
- **Test gap revealed mid-implementation** — add the missing test to step 3, re-run red→green.

Related skills: [[../client-architecture-reconcile/SKILL]], [[../project-autopilot/SKILL]].
