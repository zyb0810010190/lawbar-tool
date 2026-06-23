# Queue review 061 — WI-ENA8 (BATCH-CASEBOX-EVIDENCE-A07-HARNESS-COMMAND)

**Date**: 2026-06-23.
**WI**: WI-ENA8 — implement the first A0.7 renderer-conformance HARNESS in the Swift native package:
`EvidenceCoreA07Harness.run(fixtureURL:oracleURL:)` loads the committed fixture, decodes the committed oracle
from disk, computes observed page count / mediaBox extents / normalized samples, compares vs the oracle within
tolerance, and emits a deterministic classified verdict (`status` + `classification` + `observedPageCount` +
`isMarker=false`). It writes NO marker. The apex Evidence gate's executable surface. **HIGH-RISK** (first A0.7
harness implementation).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA7 executed + merged via PR #109, `6d30911`).
**Reviewed queue.md sha256**: `ff993d2c66662b079b3c9a7fce1d2c570a3514cfa942006eb5efd2dbe8104bcb`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review — first A0.7 harness).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA8 block (compact packet inlined) + A07-GATE-00 §3/§4/§5/§6 +
  the committed oracle/fixture + the ENA3/ENA4/ENA5 probes (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqq8qi28-sc1d5c`.
- **threadId**: none emitted.
- **rawOutput sha256**: `9d14980d90b31caea72dc4ed3da81e39fb472cfb9e0fa91c6a2165986a37b4de`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY; compact no-repo-read packet avoided the timeout class).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: HARNESS-ONLY-NO-MARKER** (Codex confirmed it classifies observed conformance against an
independent committed oracle, writes no A0.7 marker, touches no `dev-memo/run/evidence/**`, creates no
provenance/HMAC/tamper guard, and does not enter hooks/UI/product).

Codex confirmed (adversarially): the Class-1/Class-2 split is correct (page-count/box disagreement = Class-2
STOP; correct box but wrong normalized = Class-1); reading the oracle from disk prevents the trivial
self-fulfilling-pass path; `not_implemented = fail`, `inconclusive != pass`, and Class-2-never-downgraded are
correctly enforced, and the classifier order keeps invalid/no-checkable cases from becoming success. Risk
classified correctly as HIGH-RISK first-harness.

## Low-risk clarifications (folded / already satisfied; non-blocking)

1. **"Pass is not a marker" must stay prominent.** Codex's main residual concern is reader interpretation.
   Implementation already satisfies it: the result carries `isMarker="false"` in the deterministic
   `orderedFields()` shape; `testResultSchemaShape` asserts `isMarker=="false"` on the real (pass) result; and
   the source/README repeatedly state a passing harness run is NOT an A0.7 marker (a durable marker needs
   provenance + the tamper guard, separate WIs).
2. **Residual oracle-independence.** Codex noted residual risk if the oracle were generated from the same
   implementation, if tests rewrote/regenerated the oracle, or if the fixture were too weak. Mitigation: the
   oracle was hand-authored in WI-ENA7 (values computed independently, cc-suite-reviewed) BEFORE this harness
   existed; the harness and its tests only READ the committed oracle (the inconclusive test uses an in-memory
   JSON string, never regenerating the committed `oracle.json`). Strengthening the fixture set (rotation,
   non-Letter sizes) is a future fixture/oracle WI under A07-GATE-00 §2, not in ENA8 scope.

These do not expand scope; the verdict stands as READY and governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`ff993d2c…`). HIGH-RISK first-harness: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run
on the impl scope before commit. User authorization for the A0.7-harness-command step was given explicitly; the
remaining A07-GATE-00 §8 WIs (marker provenance design, tamper/fabrication guard, marker write, EVW5 hard hooks)
remain separate hard-stops — none authorized by ENA8. The harness writes NO marker.

QUEUE_REVIEW_VERDICT=PASS
