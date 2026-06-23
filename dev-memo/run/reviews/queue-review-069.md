# Queue review 069 — WI-A3-T2 (page-ratio normalization math; pure headless; A0.7-gated, custody 9b)

**Date**: 2026-06-23.
**WI**: WI-A3-T2 — implement PURE headless page-ratio normalization/denormalization math
(`native/evidence-core/lib/page-ratio.mjs` + tests) per ADR A3-CONTRACT-00 §4 + INV-A3-4/5/7. The FIRST A3
implementation lane. A0.7-dependent (`Requires-A07: yes`), custody mode 9b (human runs the A0.7-gated
check-gates with the HMAC key; agent never receives the key; the implementation commit is BLOCKED until the
human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `7294f0b1f0cb65f27f8a56d9cf61205d3cddbf535b249817d77db938b387fda2`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; first A3 impl lane; load-bearing coordinate contract; A0.7-gated).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-T2 block (compact packet inlined) + the math contract +
  the home decision.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqryk9q-pnygfl`.
- **threadId**: none emitted.
- **rawOutput sha256**: `60777855a050ae28a4ca73ac24bd6fcc51c61f1d3d5598c18d579f48ec106718`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.
**HOME-DECISION: NATIVE-EVIDENCE-CORE-JS-OK** — Codex confirmed `native/evidence-core` (pure JS,
dependency-free) is the correct home: the function is pure deterministic geometry math with no PDFKit/I/O/
platform dependency, and the dependency-free JS core can become the cross-language oracle for Swift/PDFKit
later. It does NOT need to live in `native/evidence-core-swift` now (no stop-and-ask). Custody 9b is correctly
placed: implementation may be prepared + locally tested, but the commit stays blocked until the human reports
the A0.7-gated PASS.

## Findings to fold into the implementation
- **Medium — explicit rotation semantics.** Define the rotation transform explicitly for 0/90/180/270 in BOTH
  directions: state that `boundsWidth/boundsHeight` are the UNROTATED resolved-box dimensions, and give the
  exact corner mapping per rotation, so JS and a future Swift/PDFKit implementation cannot diverge. RESOLVED in
  the module (documented convention + per-rotation corner map) + tests for all four rotations; verified by
  `/cc-suite:verify`.
- **Low — validation completeness.** Add explicit fail-closed validation for: non-object / missing required
  geometry fields; non-numeric rect fields; negative rect width/height (not only bounds); ratio rects outside
  the canonical domain on denormalize; mixed provenance fields (not just missing/ambiguous); and an explicit
  policy on whether page-space rects partially outside the resolved box are invalid or allowed-if-representable.
  Any `viewport` / `screen` / DOM / CSS-pixel / devicePixelRatio / render-scale provenance is an immediate
  throw. RESOLVED in the module + tests.

## Disposition
READY → eligible to govern. The Medium + Low are implementation-content items authored into the module/tests in
this same lane and confirmed by the post-impl broker audit + verify; neither is a scope change into
Swift/UI/persistence/DB-dependency/marker-key/gate (no stop-and-ask trigger fired; home confirmed JS). Proceeding
to mark-reviewed + govern (standalone, content-bound to sha `7294f0b1…`). After implementation + the human-run
gated PASS (custody 9b), broker `/cc-suite:audit` + `/cc-suite:verify` run before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
