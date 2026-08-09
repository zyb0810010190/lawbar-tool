# Auto-advance run control

This directory governs unattended multi-WI runs. The current project default is **canary
mode: `AUTO_ADVANCE_MAX=3`** — the runner may commit and advance through up to three
*governed-queue* WIs before a batch audit or a stop condition (see AGENTS.md "Autonomy
policy"). Set `AUTO_ADVANCE_MAX=1` for gated mode; raise to `10` only after canary batches
have stayed clean.

A queue becomes **executable** in either of two ways:
1. **Human-authored:** the human writes or explicitly approves `queue.md`, then marks it
   governed (creates `queue.governed`).
2. **Agent-proposed:** the agent writes `queue.md` in a PLAN WI; `check-queue.sh` writes
   `queue.linted`; Codex passes `/review-plan` and `mark-queue-reviewed.sh` writes
   `queue.reviewed`; then `govern-queue.sh` writes `queue.governed` (requires both). Lint
   alone never governs.

The agent may execute only a governed queue. It may **not** edit `queue.md` during an active
batch — including to mark WIs complete or append audit metadata. Governance is **content-bound**:
`govern-queue.sh` records `queue_sha256=sha256(queue.md)` into `queue.governed`, and
`batch-commit-guard.sh` (BCG-6 / GOVERNANCE-CHAIN-001) denies the next commit on any mismatch. So
editing `queue.md` mid-batch does not record progress — it blocks every commit until
`govern-queue.sh` is re-run, and that re-run must never share a Bash tool call with the dependent
commit (the guard is a PreToolUse hook and reads pre-refresh state; see `AGENTS.md`
§"Test-environment & governance-sequencing notes").

Record per-WI progress where it is actually read: the commit message, `dev-memo/run/log.md`, and —
per `.claude/rules/plan-execution.md` §3 — a status block stamped into the WI's own plan file inside
that WI's commit. **The queue is transport; plans and the log are the record.**

The `batch-commit-guard.sh` hook refuses commits when the queue is not governed, the content hash
does not match, the breaker is hit, an audit is due, or a risk flag is pending — so these limits are
enforced, not merely instructed.

## Files

- `queue.md`  — the task list. Governed via human approval or review+lint. Runner works
  top to bottom and NEVER invents a WI not on it.
- `queue.governed` — presence attests the queue passed governance (guard requires it).
- `config`    — run parameters: `AUTO_ADVANCE_MAX` and `BATCH_AUDIT_EVERY`.
- `batch-start` — commit hash where the current batch began (guard derives count from this).
- `last-batch-audit` — ignored local checkpoint: commit hash of the last completed batch audit. Create or update it after completing a batch audit.
- `risk.flag` — presence = a Layer-C trigger is pending; blocks commits until audited.
- `human.ack` — single-use human authorization for **gated mode only**; consumed on use.
- `human.override` — single-use **batch-mode** override token; consumed on use.
- `override-reason.md` — required non-empty reason for `human.override`; kept in the audit trail.

WI field contract: `check-queue.sh` requires Type, Scope, Source of truth, Allowed files,
Forbidden files, Gates, Acceptance criteria, Risk flags, Depends on, Commit boundary.
`Review path` and `Report` are **implicit defaults supplied by `/workflow`** (cc-suite
review/audit/verify plus the standard pre-commit and post-push reports); add them as explicit
queue fields only when a WI deviates from the default.
- `log.md`    — append-only audit trail; one block per completed WI. `git revert` along it.

## Starting a run

1. Write the WIs you authorize into `queue.md` (one per block).
2. Confirm `config` mode: `AUTO_ADVANCE_MAX=1` gated · `3` canary batch · `10` full batch.
   (Default is `3` — a canary batch, not 10. Prove a queue on a small run before scaling up.)
3. Tell the agent to start the auto-advance run. It picks up `queue.md` top to bottom.

## Stopping

The run stops by itself on empty queue / FAIL / breaker. To stop a live run early, the
human intervenes (cancel the session, or `/cancel` an in-flight Codex job).

## Authority map

Each control has ONE source of truth; other files point here rather than restating details.
(claudepot hygiene: two files saying the same thing means one will go stale.)

- Commit boundary (breaker/audit-due/risk): `.claude/hooks/batch-commit-guard.sh`
- Run-control file protection: `.claude/hooks/protect-run-control.sh` (blocks direct
  Write/Edit/MultiEdit to the authority files below)
- Queue lint (field quality, forbidden paths): `scripts/workflow/check-queue.sh`
- Queue governance (lint + Codex review): `scripts/workflow/govern-queue.sh`
- Batch audit content: `BATCH-AUDIT.md`
- UI gate limitations: `UI-GATES.md` (do not restate coverage percentages elsewhere)
- Project invariants & authority boundaries: `AGENTS.md`
- Autonomous next-WI protocol (human-invoked; pick one bounded WI, one branch, push, PR, stop
  before merge): `dev-memo/run/autonomous-next.md`

**Enforcement strength — stated honestly.** The commit guard enforces the boundary against a
*cooperative* agent, plus the write-guard blocks the obvious tamper path (direct edits to the
authority files). It is NOT cryptographically tamper-proof: an agent that runs arbitrary bash
could still `echo` into these files, and hooks/settings are themselves editable. Treat this as
"cooperative-agent enforcement + direct-write block," not an adversarial sandbox. For a firmer
boundary, run the agent with OS-level write protection on `dev-memo/run/` outside its control.

Governance provenance (three separate files, by design):
- `queue.linted`   ← check-queue.sh (enforces the full WI field contract)
- `queue.reviewed` ← mark-queue-reviewed.sh, which requires a saved Codex review artifact
  containing the exact line `QUEUE_REVIEW_VERDICT=PASS` (loose prose like "approved" is
  rejected — a negative verdict's substrings must never authorize)
- `queue.governed` ← govern-queue.sh (requires both, or --human-approved)
