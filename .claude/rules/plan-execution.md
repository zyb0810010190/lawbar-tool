---
description: Plan-execution discipline — verify a plan item against real code BEFORE implementing and AFTER, and stamp each item's finishing status back into its plan file inside the WI's own commit.
---

# Plan Execution

**Verify every plan claim against real code — before you build it and after — and stamp the outcome
back into the plan.** A plan is a record of intent, not evidence of reality: `dev-memo/run/queue.md`
is the authority, plan files are records (the convention 11 plan files already declare). Adapted from
an external `/execute-plan` spec; composes UNDER [[execution-discipline]] and never relaxes it.

## 1. Pre-implementation re-verification (REQUIRED)

Before implementing any plan item, confirm the gap it describes still exists in the code. Do not
implement on the plan's word.

This generalizes the commitment in `dev-memo/design/2026-08-05-ui-batch-redesign-spec.md` §0 ("no batch
is implemented on the draft's word alone"), which earned its keep: across all four UI batches the
draft's item list **never** survived contact with the code — UI-1's core premise was false, UI-2's
action-order item was one line not a sweep, UI-3 had one already-satisfied item and one outright wrong
premise, and UI-4 was empty (closed as a no-op, commit `d19b8c8`).

For each item, classify before writing code:
- **REAL** — the gap exists; implement it.
- **ALREADY SATISFIED** — the code already does this. Record it, change nothing, do not "improve" it.
- **OVERSTATED** — narrower than written. Implement the verified subset and record the narrowing.
- **UNSAFE AS WRITTEN** — the item would break something (e.g. a label change to a key shared by more
  call sites than the plan assumed). STOP and report; do not implement a plan item you know is wrong.

Record the classification and its evidence (file:line) in the WI's commit message. Closing a plan item
as a no-op with evidence is a SUCCESS, not a shortfall — inventing churn to look productive is the
failure mode this section prevents.

## 2. Post-implementation gap audit (REQUIRED)

After implementing, re-read the plan and check the built code against it. A **gap** is any of:
- an item marked DONE with no implementing code found;
- implemented behaviour that contradicts what the plan specifies;
- a plan requirement with no test covering it;
- a file the plan names that was never created or modified.

Print the gap list BEFORE fixing anything. Close every gap, then re-run the same gate used for the
item. Bounded to **3 passes**; gaps still open after the third are recorded as OUTSTANDING in the
commit message and `dev-memo/deferred-audit-findings.md` — never silently marked closed, never looped
on forever.

This is a self-check, NOT a substitute for the cc-suite audit ([[cc-suite]]) — it runs before it.

## 3. Status stamping (REQUIRED) — and exactly when

When an item finishes, stamp its status into its own plan file, directly under the item:

```markdown
**Status:** DONE — YYYY-MM-DD
**Changed:** path/to/file.ts, path/to/other.ts
**Verified:** <exact command> (<result line>)
```

Use `BLOCKED` in place of `DONE` when it cannot finish, replacing `Verified:` with
`**Blocker:** <what stopped it>`. Stamp only AFTER the verification actually ran and passed.

- **Additive only.** Never delete or rewrite existing plan prose. Append or insert; do not restate.
- **Stale status is a real defect, not bookkeeping.** Batch audit `audit-mrm4xfit-r17lir` (2026-07-16)
  returned BATCH-FAIL solely because a docket still read "NOT authorized for implementation" after
  reaching reviewed-READY; the repair (`131fc31`) required a single-use human override. This section
  codifies an obligation the batch auditor already enforces.

### Timing is load-bearing — stamp INSIDE the WI's own commit

The stamp MUST land in the same commit as the work it describes, before gates and before any batch
closeout. **Never emit it as a separate follow-up commit.**

`scripts/workflow/batch-closeout.mjs` fails when `att.target_sha !== head`, so ANY commit — including a
docs-only stamp — between a batch audit and its closeout invalidates that batch's attestation. This
project has already paid for that four times: findings `BATCH284-REASON-WS-1` and
`BATCH286-LOCFALLBACK-VERDICT-1` were both deferred *"only because fixing pre-closeout would have moved
HEAD and invalidated the batch attestation"*, plus two governance deadlocks that each needed a
single-use override.

### Never stamp `dev-memo/run/queue.md`

`queue.md` is content-bound: `govern-queue.sh` records `queue_sha256` into `queue.governed`, and
`batch-commit-guard.sh` (BCG-6 / GOVERNANCE-CHAIN-001) denies the next commit on any mismatch. Editing
it to mark a WI complete blocks all commits until `govern-queue.sh` is re-run — and that re-run must
never share a Bash call with the dependent commit (`AGENTS.md` §"Test-environment & governance-sequencing
notes"). **The queue is transport; plans are the record. Stamp plans, never the queue.**

> **Known dead clause — do not follow it.** `dev-memo/run/README.md` still permits editing `queue.md`
> "to mark WIs complete or append audit metadata". That carve-out predates content-binding (`d440c9f`,
> WI-GQ1) and is now unenforceable: doing what it permits denies the next commit. Treat this section as
> authoritative until that README is repaired (same defect class as `c743e26`).

## 4. cc-suite invocation

Invoke cc-suite through the runner or a user-typed slash command per [[cc-suite]] §"Invocation paths".
**Never `Skill(cc-suite:*)`** — it returns `Unknown skill` and fails silently while appearing to run.
Any external workflow doc instructing otherwise is wrong for this repo.

## 5. Bounds

This rule adds verification and record-keeping. It does NOT authorize:
- widening scope past the WI's declared files ([[execution-discipline]] §3 still binds);
- implementing several plans or WIs in one autonomous run — one WI at a time, and only from a governed
  queue ([[autonomy]], `AGENTS.md` §"Queue governance"). The agent never invents the next task;
- rewriting or "cleaning" code the WI did not authorize;
- marking any item DONE without a verification step that actually ran.

## References
- [[execution-discipline]] (the behavioural floor this composes under), [[cc-suite]], [[autonomy]],
  [[staging-hygiene]], [[loc-guardian]].
- `dev-memo/design/2026-08-05-ui-batch-redesign-spec.md` §0 — the pre-verification precedent.
- `BATCH-AUDIT.md` + `scripts/workflow/batch-closeout.mjs` — the HEAD-binding constraint in §3.
