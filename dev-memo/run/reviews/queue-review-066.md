# Queue review 066 — WI-EVW5 (A0.7 hard hooks — reality-gate enforcement)

**Date**: 2026-06-23.
**WI**: WI-EVW5 — implement the deferred A0.7 hard hooks: `scripts/workflow/check-a07-gate.sh` (delegate to the
marker guard `--scan`; require a provenance-valid local A0.7 marker only when the action is A0.7-dependent via
`A07_REQUIRED` or queue `Requires-A07:`; else pass), a temp-dir/ephemeral-key self-test, and a narrow
`check-gates.sh` integration. Reuses the merged marker machinery; no UI/product/native/key-custody/schema
change. The final A07-GATE-00/A07-MARK-00 §8 sequenced WI. **HIGH-RISK** (hard enforcement of the apex gate).
**Queue**: `dev-memo/run/queue.md` (single WI; ENA11-FIX1 merged via PR #114, `9f55366`).
**Reviewed queue.md sha256**: `d6edff4c84a9353ce7ca2f5637727136b2ccc8641410cae0bd8fac5c1ff2af61`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-EVW5 block (compact packet inlined) + A07-GATE-00/A07-MARK-00 +
  the marker guard/validator/writer + check-gates.sh (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqocxq8-ay7oq3`.
- **threadId**: none emitted.
- **rawOutput sha256**: `55a9f7c982569d7d89b726113d3ec46f427396e09447ac2a8fb4db3d0a6f421e`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: WORKFLOW-GATE-OK** — Codex confirmed the `check-gates.sh` wiring of `check-a07-gate.sh` is
a **sufficient** hard-enforcement surface for EVW5; a `.claude` PreToolUse hook is NOT required for this WI's
scope (so no `.claude/settings.json` change and no stop-and-ask). Scope stays inside `scripts/workflow/**`; no
UI/product/native/key-custody/schema/marker-write change; no Critical/High blocker.

Codex confirmed: the gate logic is sound (delegate-to-guard universal rejection, then required-detection
controls whether a missing valid marker is fatal); fail-closed points match the invariants (fabricated/copied/
touched/committed fail; required-without-key fails; required-without-valid-marker fails); the gate is read-only
(writes no marker, creates no namespace, doesn't relax the guard or treat isMarker=false as valid); `A07_REQUIRED`
+ queue `Requires-A07:` are appropriate triggers; "not required" correctly keeps a clean repo / CI safe.

## Low-risk clarification (recorded; non-blocking)
1. **A0.7-dependence must be declared by each dependent WI.** The gate intentionally treats the absence of BOTH
   `A07_REQUIRED` (env) AND a queue `Requires-A07: yes|true` line as "not required" (so non-Evidence work and CI
   stay green). Therefore every future A0.7-DEPENDENT WI (Evidence anchors/A5/UI/architecture) is responsible
   for setting `A07_REQUIRED` for its protected action OR carrying `Requires-A07: true` in its governed queue
   block — otherwise the hard gate will not demand a marker for it. The gate header documents both triggers;
   this responsibility is a process convention for downstream WIs, not a code change in EVW5.

## Disposition
READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`d6edff4c…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run before commit.
User authorization for the A0.7-hard-hooks step was given explicitly; no `.claude`/settings change (workflow gate
suffices). This completes the A07-GATE-00 §8 sequence (gate design → fixture/oracle → harness → marker provenance
→ guard → marker write → isMarker fix → hard hooks).

QUEUE_REVIEW_VERDICT=PASS
