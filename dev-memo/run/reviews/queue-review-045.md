# Queue review 045 — WI-EVW7 (BATCH-CASEBOX-EVIDENCE-WORKFLOW-PORT-00)

**Date**: 2026-06-22.
**WI**: WI-EVW7 — scaffold a dependency-free Node deterministic-JSON contract shim under
`native/evidence-core/` (ten commands; version/healthcheck pass; eight gates `not_implemented`=fail) +
the minimal port-plan §5 stale-wording fix. HIGH-RISK (new package tree). JS-only; Swift/SwiftPM deferred.
**Queue**: `dev-memo/run/queue.md` (single WI; completed WI-EVW5R removed — committed `20339dd`).
**Reviewed queue.md sha256**: recorded at govern time below.

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: the WI-EVW7 plan (JS-only shim contract, command surface, scope) + EVW-00 + port plan
  §4.4/§5 + evidence-genie.md + evidence-geometry-gate.md + Node engine policy (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqp9a4cd-d2mhnz`.
- **threadId**: none emitted.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none on this review (first attempt READY). NB: the preceding Part-1 Layer-B
  audit hit one TIMEOUT and was retried via native `--background` (study packet 120).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.

Broker confirmed: the JS-only shim is feasible and dependency-free under the Node 22+ posture;
`not_implemented` correctly fails (non-zero, never pass); the no-marker / no-`dev-memo/run/evidence` write
constraint is feasible (pure stdout + exit code, pre/post snapshot in tests); the deterministic JSON
contract (stable `schemaVersion`, fixed fields, no timestamps/random, unknown→error JSON non-zero) is
adequate; capture-stdout/stderr-and-exit-code-separately is the right pipe-mask guard; scope confined to
`native/evidence-core/**`. Broker's explicit view: **introducing this JS-only shim does NOT require
separate user authorization as a hard-stop**; Swift/SwiftPM/PDFKit, a new dependency, or writes outside
`native/evidence-core/**` would.

## Low-risk clarifications (folded into the executable WI)

1. The committed plan §5 still says EVW7 "8 commands" / "package wiring as needed" — the executable WI uses
   exactly ten commands and is scoped to `native/evidence-core/**`; the WI ALSO applies the minimal §5
   wording fix (8 commands → 10-command surface) as an authorized in-scope edit (this artifact's Allowed
   files include that single plan line).
2. The README must name the eight gate commands as `not_implemented` failures and `version`/`healthcheck`
   as utility commands that pass.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to the queue.md
sha). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl scope
before commit. This review authorizes the JS-only shim only; Swift/SwiftPM/PDFKit remains a separate
hard-stop WI. User authorization for EVW7 execution was given explicitly.

QUEUE_REVIEW_VERDICT=PASS
