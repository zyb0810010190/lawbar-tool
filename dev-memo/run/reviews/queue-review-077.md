# Queue review 077 — WI-A3-RESOLVE-00 (resolver/status-transition design; design-only, NOT A0.7-gated)

**Date**: 2026-06-24.
**WI**: WI-A3-RESOLVE-00 — author the A3 resolver/status-transition behavior ADR (+ a dev-memo plan): how
anchors/links resolve to `LinkStatus` valid|needs_review|broken (mismatch / replacement / missing-target),
deterministic + idempotent, before any resolver code. **Design/ADR only**: no code, schema/migration, export,
UI, cascade resolution, dependency, marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `a9962d60657b397de915327a66ab1f288b7d1432f3f70431e20595d27d7f45aa`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs eventual HIGH-RISK resolver behavior over court-facing status).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-RESOLVE-00 block (compact packet inlined) + the 10 decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqsq83f9-9n4qol`.
- **threadId**: none emitted.
- **rawOutput sha256**: `71e0e0b6899ef478c5e32a3d96c188f5370962b5e89e448bc6969187cb19fe20`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed a design-only resolver-semantics WI
need not be gated while the future resolver IMPL WI is (preserves "executable anchor behavior does not build on
unproven A0.7 geometry"). Also confirmed: the transition rules prevent stale geometry from staying `valid`
(valid requires geometry_captured_at == current V10 captured_at); missing page/geometry/anchor -> broken;
replacement/quarantine -> needs_review (INV-A3-6); explicit broken (INV-A3-8); deferring the audit-event shape +
leaving the cascade unresolved are correct (not scope creep); no Evidence invariant or A3-DB-00 encryption hard
stop weakened.

## Findings to fold into the ADR
- **Medium — explicit status precedence ladder.** Combined failure states must yield ONE deterministic status.
  Record the order: **`broken` wins** for a missing page identity / missing geometry record / missing anchor
  target / explicit broken (orphan/out-of-range); **else `needs_review` wins** for geometry mismatch
  (anchor.geometry_captured_at != current), document replacement/supersession/quarantine, or unresolved source
  identity; **else `valid`** (everything present + geometry matches + document canonical + source resolves).
  `valid` is the lowest rung — never a default. RESOLVED in the ADR; verified by `/cc-suite:verify`.
- **Low — deferred + non-inferable.** The ADR MUST state explicitly that (a) the audit-event shape and (b) the
  anchor-delete cascade behavior are DEFERRED and MUST NOT be inferred/invented by the resolver implementation.
  RESOLVED in the ADR.

## Disposition
READY → eligible to govern. The Medium (precedence ladder) + Low (deferred/non-inferable) are design-content
items authored into the ADR in this lane and confirmed by the post-authoring broker audit + verify; neither is
a scope change into code/schema/export/UI/cascade/dependency (no stop-and-ask trigger). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `a9962d60…`). After authoring, broker
`/cc-suite:audit` + `/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
