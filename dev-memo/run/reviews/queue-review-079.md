# Queue review 079 — WI-A3-EXPORT-00 (export-degradation design; design-only, NOT A0.7-gated)

**Date**: 2026-06-25.
**WI**: WI-A3-EXPORT-00 — author the export-degradation ADR (+ a dev-memo plan): how court-fileable exports
degrade when an A3 link is needs_review/broken (the ExportCitationFlag semantics + a minimal headless
export-citation object shape), preserving citation trust so no unresolved/stale anchor exports as
silently-valid evidence, BEFORE any export implementation. **Design/ADR only**: no code, no schema/migration,
no UI, no export implementation, no cascade/document-lifecycle, no dependency, no marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `fc6711c42d709d7c5de20f2a8332bf10cf0a5ccc6a14dfd6b73383ba99018da3`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs eventual HIGH-RISK court-facing export over citation trust).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-EXPORT-00 block (compact packet inlined) + the 10 decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqtfzimy-j3y7qc`.
- **threadId**: none emitted.
- **rawOutput sha256**: `cc1668da58f8e17f1825d16f0cdd4e7f83fdf8d4fcd91724d4d0e5d334804d6e`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed a design-only export-degradation WI
need not be gated while the future export IMPL WI is (Requires-A07: yes, custody 9b). Also confirmed: the
degradation contract preserves the A1/A10 citation-trust invariant for the stated A3 failure modes (a link
cannot silently export as valid when case_box_links.status is needs_review/broken; valid citations come from
DocumentPage, never geometry/viewport/optimized rendition; missing -> deterministic flagged fallback, no
omission); the coupling to case_box_links.status as the source of truth + the run-resolver-first ordering is
sound (export must not fork its own validity logic); decide-or-defer is correct for the export audit-event
shape; keeping anchor-delete cascade + full Evidence document lifecycle out of scope is correct; no A3-DB-00
encryption hard stop weakened.

## Findings to fold into the ADR (two Lows — design content, no scope change)
- **Low L1 — `valid` is necessary but NOT sufficient for a normal export citation.** The ADR MUST state that an
  A3 `valid` link status is a precondition, not the whole export decision: export still applies the A1/A10
  citation-contract checks (e.g. `isCitable`, ambiguous citation labels, non-citable / cross-volume cases,
  replaced-document flags) where those are separately available. Do NOT collapse the broader ExportCitationFlag
  set into only NEEDS_REVIEW / BROKEN. RESOLVED in the ADR.
- **Low L2 — distinguish `linkStatus` from `exportFlag` in the object shape.** The minimal headless
  export-citation object MUST separate `linkStatus` (valid|needs_review|broken — the resolver output) from
  `exportFlag` (NEEDS_REVIEW|BROKEN|NON_CITABLE|AMBIGUOUS|REPLACED|…) so the implementation does not overload
  resolver status as the entire export classification. RESOLVED in the ADR.

## Disposition
READY → eligible to govern. C0 H0 M0; the two Lows are design-content refinements authored into the ADR in this
lane and confirmed by the post-authoring broker audit + verify; neither is a scope change into
code/schema/UI/export-impl/cascade/document-lifecycle/dependency (no stop-and-ask trigger). A07-classification
CONFIRMED-DESIGN-ONLY-NOT-GATED. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`fc6711c4…`). After authoring, broker `/cc-suite:audit` + `/cc-suite:verify` run on the design packet before
the design commit.

QUEUE_REVIEW_VERDICT=PASS
