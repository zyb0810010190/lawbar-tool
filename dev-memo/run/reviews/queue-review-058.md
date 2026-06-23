# Queue review 058 — WI-ENA5 (BATCH-CASEBOX-EVIDENCE-NATIVE-COORDINATE-PROBE)

**Date**: 2026-06-22.
**WI**: WI-ENA5 — extend the merged `native/evidence-core-swift/` package with an isolated **coordinate
transform ROUNDTRIP probe**: internal `EvidenceCoreCoordinateRoundtripProbe` with `normalize`/`denormalize`
(PDF-space point ↔ normalized `[0,1]` against page 1's `mediaBox` extent) + `roundtripOnFixture(url:samples:)`;
a Swift test loads the EXISTING synthetic fixture, reads page 1 `mediaBox` (612 x 792), roundtrips deterministic
samples, and asserts `maxAbsError < 1e-9`. The first geometry-adjacent transform step. Probe-only/internal —
NOT production anchor geometry; no rendering, no anchors, no citation/page-identity, no persistence, no
renderer-conformance, no A0.7, no marker, no provenance/HMAC, no UI, no JS-shim change, no new fixture. The
fifth user-authorized implementation hard-stop. **HIGH-RISK** (first coordinate-transform foothold).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA4 executed + merged via PR #106, `41801fc`).
**Reviewed queue.md sha256**: `9610e811e07bed2936bc9f6cc3210e870f8a9e5a33503b1bb49f1143062c5bfe`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA5 block (compact packet inlined) + ENA0 feasibility plan
  §1-§3 + ADR ENA-00 + evidence-genie.md invariants (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID (attempt 2, SUCCESS)**: `review-plan-mqq3zdkx-ujv2g1`.
- **threadId**: none emitted.
- **rawOutput sha256**: `9755b34e4ff9009a33de64dfc30dbf9b2afc54cdca828e201c2e000ae67549be`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: attempt 1 `review-plan-mqq2vxfy-yhlfmz` = **TIMEOUT** (`spawnSync codex ETIMEDOUT`).
- **Retry attempts**: 2 (attempt 1 FULL packet → TIMEOUT; attempt 2 COMPACT packet with an explicit "answer
  only from this packet; do not read repo files" instruction → completed READY) per `.claude/rules/cc-suite.md`
  §"Retry policy". Logged to `dev-memo/cc-suite-reliability-log.md`.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: NOT-BROADER** (Codex confirmed an isolated reversible PDF↔[0,1] arithmetic probe;
nothing crosses into rendering, PDFView conversion, anchors, citation/page-identity, persistence,
renderer-conformance, geometry classification, A0.7, marker, provenance, UI, or JS-shim behavior).

Codex confirmed (adversarially): ENA5 is **strictly** an isolated coordinate-transform roundtrip probe —
feasible on macOS CI, no new dependency, no new fixture; genuinely distinct from PRODUCTION anchor geometry
(internal-only, no rotation, no captured-geometry versioning, no persistence, no viewport mapping, no
citation/page-identity), so it will not silently become the anchor implementation if kept behind the internal
enum + test-only usage. Risk classified correctly as HIGH-RISK. Per the user's stop-if-broader gate: scope is
NOT broader → eligible to govern + implement.

## Low-risk clarification (folded into implementation; non-blocking)

1. **Keep the probe internal / not exported through product/API/JS surfaces.** Codex's only ask. Implementation:
   `EvidenceCoreCoordinateRoundtripProbe` (and its nested `PdfPoint`/`NormalizedPoint`/`RoundtripResult`) are
   declared **`internal`** (no `public`), exercised only by the test target via `@testable import`. A
   verification grep confirms the probe carries no `public` modifier, and the README/status note states it is
   a probe-only/internal helper, not a product/API/JS surface.

This sharpens the design within the authorized boundary; it does not expand scope, so the verdict stands as
READY and governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`9610e811…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl
scope before commit. User authorization for the coordinate-transform-roundtrip-probe step was given explicitly;
rendering, PDFView/UI conversion, renderer-conformance, geometry classification, anchors, citation/page-identity,
persistence, A0.7, marker, provenance/HMAC, hooks, and UI remain separate hard-stops.

QUEUE_REVIEW_VERDICT=PASS
