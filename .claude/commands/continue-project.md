---
description: Pick the next unblocked WI from active plan docs and continue autonomously unless a hard-stop applies
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# /continue-project

Driver command. Resumes project work under the autonomy policy ([[../rules/autonomy]]). Invokes [[../skills/project-autopilot]] for the full loop, or runs the single next step when the user only asked to advance one WI.

## Inputs

Read (do not modify) the following to determine the next WI:

- `docs/release/go-live-plan.md` — authoritative WI sequence and Autonomous Choice Policy.
- `docs/release/go-live-readiness-report.md` — current go-live state.
- `docs/release/wi-03-security-signoff.md` — security closure status.
- `dev-memo/plan-client-00.md` — client surface reconciliation status.
- `dev-memo/*-plan.md`, `dev-memo/*-brainstorm.md` — supporting plans.
- Any `docs/adr/*.md` referenced by the active WI.

## Selection algorithm

1. Run `/branch-clean`. If **DIRTY-BLOCKING**, stop and surface to user.
2. Build the ordered WI list from `go-live-plan.md`. For each WI, record:
   - id, scope, predecessors, status (done / in-progress / blocked / pending).
3. Discard WIs whose predecessors are not all in `done` state.
4. Among the remainder, prefer in this order (matches go-live-plan Autonomous Choice Policy):
   - Currently `in-progress` WI not yet verified.
   - Smallest bounded WI that unblocks the most downstream WIs.
   - Plan-review WI when next code WI affects security / contract / persistence / queue / multi-package.
5. If a hard-stop applies to the candidate (per [[../rules/autonomy]] hard-stop list), surface it and stop.
6. Otherwise: announce the chosen WI in one line and proceed by dispatching the appropriate skill or focused command:
   - Security-sensitive code WI → [[../skills/security-wi-loop]].
   - Client-architecture / ADR / docs reconciliation → [[../skills/client-architecture-reconcile]].
   - General bounded code WI → plan → review-plan → implement → tests → audit → verify → [[commit-gate]].

## Stop conditions

Stop and surface to user when:

- No unblocked WI exists.
- Next WI matches a hard-stop trigger.
- `branch-clean` reports `DIRTY-BLOCKING`.
- Audit yields unresolved Critical/High that cannot be fixed inside the current WI.
- The next decision requires a product-direction call not covered by [[../rules/client-local-first]] or `plan-client-00.md`.

Related: [[branch-clean]], [[commit-gate]], [[../skills/project-autopilot]].
