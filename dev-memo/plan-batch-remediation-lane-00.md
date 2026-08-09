# PLAN — WI-BATCH-REMEDIATION-LANE-00

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). **NOT authorized for
implementation.** This WI changes when a commit is permitted, so it requires the user's explicit approval
per `AGENTS.md` §"Self-improvement bounds" ("Not allowed without explicit approval: weaken a hard stop or
gate"). Date: 2026-08-09.

## 1. Problem — a structural flaw, observed twice

`BATCH-AUDIT.md` §"Outcome" requires that a finding be "resolved as a new WI (fixed / deferred-with-WI /
rejected-with-reason)". But `batch-commit-guard.sh` blocks **all** commits while a batch audit is DUE or
FAILED — including the commit that would resolve the finding. And a Critical/High/Medium cannot be
deferred instead: `batch-closeout.mjs:136` requires `AUDIT-VERDICT: BATCH-PASS C0 H0 M0 L<n>`, so only
Lows may be carried. Fix-and-re-audit is therefore the only path for a Medium or worse, and that path
needs a commit.

**The action that resolves the finding is the one action the system forbids.**

Observed occurrences:
- **batch-281** — a `BATCH-FAIL L1` allowlist remediation; resolved by a single-use human override
  (recorded in the prior `dev-memo/run/override-reason.md`).
- **batch-289 (2026-08-09)** — `BATCH-FAIL C0 H0 M1 L1` on a privacy-gate bypass; the fix was verified
  in-tree and could not be committed. Resolved by a second single-use override; the follow-up re-audit
  then returned `BATCH-PASS C0 H0 M0 L0` (study 290, commit `34e9a56`).

Each occurrence spends a break-glass mechanism on routine remediation. That is how a safety control
decays into a formality: the override stops meaning "something exceptional happened" and starts meaning
"the process hit its normal snag again".

## 2. Non-goals (explicitly out of scope)

- Making the guard more permissive in any general way.
- Letting the agent self-authorize anything.
- Changing what counts as a PASS, or letting a Medium+ be deferred.
- Changing the marker/attestation mechanism, the content-bound queue governance, or any hard stop in
  `.claude/rules/autonomy.md`.

## 3. Design (from the Codex consult `review-plan-mslg8u2h-5x4ksy`, adopted with one correction)

When a batch audit is FAIL, the guard permits **exactly one narrow class of commit** — a *remediation
commit* — authorized by an artifact the agent cannot create, and which does **not** advance the marker.

Proposed artifact: `dev-memo/run/remediation.authorized` (hook-protected exactly like `human.override`,
i.e. added to `protect-run-control.sh`'s `PROTECTED_RE` and `block-run-control-bash-write.sh`). It MUST
declare, and the guard MUST verify:

1. the **failing audit job id** it remediates, and that job's recorded verdict was FAIL;
2. the **finding id(s)** being resolved;
3. the **allowed paths** — the staged set must be a subset;
4. the **audited range** it belongs to (`range_base`), which must equal the current marker;
5. single-use — consumed and logged like `human.override`.

And the guard MUST still enforce, unchanged: the marker does **not** advance; a follow-up Layer-B audit
covering `range_base..<new head>` must return PASS before normal commits resume; no push, no merge, no
marker mutation.

**Correction to the consult's ordering.** Codex ranked "change the rules first, then commit" above
"override now". That ordering is not executable: changing the rules requires a commit, which is exactly
what the deadlock blocks. The rule change can only land *after* an override has already broken a live
deadlock — which is what happened on 2026-08-09. Recorded so a future reader does not mistake the
adopted ordering for a departure from the consult's reasoning.

## 4. Why this does not weaken the gate

The agent may implement a fix but can never authorize its own remediation — the authorizing artifact is
hook-protected, identical in kind to `human.ack` and `human.override`. Compared to today, the change
**narrows** what an override buys: instead of a general-purpose single-use bypass that permits any
commit, the remediation artifact permits only a path-scoped commit tied to a specific failing job and
finding, and it cannot advance the marker. Every existing check (governed queue, content hash, risk flag,
closeout sentinel, breaker count) remains in force.

## 5. Exact target files

- `.claude/hooks/batch-commit-guard.sh` — the remediation branch.
- `.claude/hooks/protect-run-control.sh` + `.claude/hooks/block-run-control-bash-write.sh` — protect the
  new artifact.
- `BATCH-AUDIT.md` — document the lane in §"Outcome".
- `dev-memo/run/README.md` — describe the artifact alongside `human.ack` / `human.override`.
- `.claude/hooks/tests/` — hook tests (see §6).

Out of scope: any product source, test, schema, fixture, or the closeout script.

## 6. Acceptance criteria (deterministic)

1. With a FAILED audit and NO remediation artifact: a commit is DENIED (current behaviour preserved).
2. With a valid artifact: a commit whose staged set is within `allowed paths` SUCCEEDS.
3. With a valid artifact: a commit staging ANY path outside `allowed paths` is DENIED.
4. An artifact naming a job id whose verdict was not FAIL is REJECTED.
5. An artifact whose `range_base` differs from the current marker is REJECTED.
6. The artifact is consumed on use and logged; a second commit on the same artifact is DENIED.
7. The marker is NOT advanced by a remediation commit; commits remain blocked until a follow-up audit
   covering `range_base..<new head>` returns PASS and the closeout runs.
8. The agent cannot create the artifact: an attempted write via Bash redirection, `Write`, or `Edit` is
   DENIED by the run-control hooks (test asserts the denial).
9. All existing guard behaviours unchanged: gated-mode `human.ack`, `human.override`, governed-queue
   content hash, risk flag, closeout sentinel, breaker count, multi-commit-in-one-call denial.

## 7. Review path

High-risk-adjacent (it modifies an enforcement hook). Requires: user approval to proceed at all; then
`/cc-suite:review-plan` on this plan; then implementation; then `/cc-suite:audit` on the diff; then the
hook tests above green. It must NOT be bundled with any product change.

## 8. Open question for the user

Should the remediation lane also cover a batch audit that is merely **DUE** (not yet run), or only one
that has **FAILED**? Narrower (FAILED only) is recommended — a DUE audit is not a deadlock, it is simply
an audit that has not been run yet, and the correct response is to run it.
