# Queue review 041 — WI-EVW8 (BATCH-CASEBOX-EVIDENCE-WORKFLOW-PORT-00)

**Date**: 2026-06-22.
**WI**: WI-EVW8 — create `.claude/rules/evidence-genie.md` (Evidence-Genie M0 domain-invariant rule) and
apply the minimal wording patch closing deferred finding EVW-PORT-L1 (plan §1 echo-sleuth pre-flight
SHOULD→REQUIRED + flip the EVW-PORT-L1 row to closed). Doc/governance only. NOT high-risk.
**Queue**: `dev-memo/run/queue.md` (single WI; completed WI-EVW3 removed — committed `0309e48`).
**Reviewed queue.md sha256**: `d9ba518c519b7db0d08027966d4ace1336e8e3a94cb16b49fcdc9ee465ab9c2a`
(govern at this sha).

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: `dev-memo/run/queue.md` WI-EVW8 block + EVW-00 ADR + port plan (1/4.3/4.4/5) +
  `.claude/rules/echo-sleuth.md` (§A/§C) + client-local-first + deferred-findings (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`, per §"Background-invocation discipline").
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Retry attempts**: 2.
  - **Attempt 1** — job `review-plan-mqowhl7c-hr1vnp`: **NEEDS-FIX** — one genuine content Medium: the block
    said the §A lane-start recap was required "only" for new umbrella plans/ADRs/RCAs and "advisory for
    individual WIs", which understated §A (it also requires recap before a new Phase-B sub-WI plan/impl, a
    `/project-autopilot` or `/loop` start, and whole-project intake). Fixed by rewording the block to drop
    "only", enumerate §A's major-lane triggers, and state the §C lessons/recall pre-flight is the binding
    pre-flight for this rule-file edit.
  - **Attempt 2** — job `review-plan-mqowk620-itbhu8` (after the fix): **READY.** No Critical/High/Medium;
    echo-sleuth wording now matches `.claude/rules/echo-sleuth.md` exactly; EVW-PORT-L1 closure accurate;
    three-file scope bounded; twelve rule records enumerated; EVW2 dependency coherent; no Evidence behavior.
- **Job ID (authoritative)**: `review-plan-mqowk620-itbhu8`.
- **threadId**: none emitted.
- **Result location**: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mqowk620-itbhu8.json`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none on the review calls (attempt-1 verdict was a genuine content Medium,
  fixed and re-reviewed — NOT a TIMEOUT/RUNNER error). (NB: the preceding Layer-B audit of this lane's prior
  range hit one TIMEOUT and was retried via native `--background` — recorded in study packet 116.)

## Verdict

**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none (the attempt-1 Medium was fixed).

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`d9ba518c519b7db0d08027966d4ace1336e8e3a94cb16b49fcdc9ee465ab9c2a`). This review authorizes neither
Evidence behavior nor command/hook wiring. Pre-flight: the `echo-sleuth.md` §C lessons/recall discovery
pass was performed (agent `ac6b75289ce7e4f90`) before any `.claude/rules/**` edit. EVW8 execution (the
three Allowed files) begins on the explicit user instruction already given for this lane.

QUEUE_REVIEW_VERDICT=PASS
