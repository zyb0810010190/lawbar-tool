# Queue review 054 — WI-ENA1 (BATCH-CASEBOX-EVIDENCE-NATIVE-SWIFTPM-SMOKE)

**Date**: 2026-06-22.
**WI**: WI-ENA1 — add a minimal SwiftPM package under `native/evidence-core-swift/` (builds + tests; exposes
only a version/smoke value) and a GitHub Actions **macOS** CI job that runs ONLY the SwiftPM smoke,
preserving the existing ubuntu `ui-design-artifact.yml`. The first user-authorized implementation hard-stop
(SwiftPM skeleton + macOS CI smoke ONLY). **HIGH-RISK** (new toolchain + new CI).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA0 executed + merged via PR #102, `5d825e0`).
**Reviewed queue.md sha256**: `9506c53f7552b84c70115fdd65a669ec5085865bfc11b51c36d1ef034a20c968`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA1 block + the ENA0 feasibility plan §1-§3 + ADR ENA-00 +
  the JS shim README + the existing ubuntu workflow + autonomy.md (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqpttags-64jsxc`.
- **threadId**: none emitted.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.

Codex confirmed (adversarially): the WI is **strictly** a SwiftPM skeleton + macOS CI smoke — **no PDFKit,
no A0.7 harness logic, no marker, no marker provenance/HMAC, no fixtures, no EVW5 hooks, no Evidence UI /
product behavior, and no change to the native/evidence-core JS shim behavior**. The macOS job runs only the
SwiftPM smoke and preserves the existing ubuntu workflow. Gates/acceptance are concrete (swift build/test,
no-PDFKit grep, no-marker, JS-shim-unchanged, ubuntu-byte-unchanged, README boundary statements, broker
audit/verify after). **Scope is NOT broader than authorized.** Introducing Swift/SwiftPM + macOS CI is the
explicitly-authorized hard-stop work; broker review-plan (this) + broker audit+verify-after is the right gate.

## Low-risk clarification (enforced by acceptance)

The `.github/workflows/**` allowance is held to **one new macOS smoke workflow** + the existing
`ui-design-artifact.yml` left **byte-unchanged** (the WI's acceptance criteria already require both).

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`9506c53f…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl
scope before commit. User authorization for the SwiftPM-skeleton + macOS-CI-smoke step was given explicitly;
PDFKit/A0.7/marker/provenance/hooks/UI remain separate hard-stops.

QUEUE_REVIEW_VERDICT=PASS
