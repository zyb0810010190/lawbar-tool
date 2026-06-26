# Queue review 087 — WI-A3-UNLINK-RESOLVE (resolver/export durable-unlink marker-awareness; A0.7-gated, custody 9b)

**Date**: 2026-06-26.
**WI**: WI-A3-UNLINK-RESOLVE — make `resolveLinkStatuses` + `buildExportCitations` respect the V12 durable-unlink
marker (`case_box_links.unlinked_at`): the resolver resolves a marked link to a highest-precedence non-clean
status (never recomputed to valid); the export reads the marker (not only status) and flags an unlinked link
distinctly (non-clean, distinguishable from structural broken; A10 no-drop). READ/EXPORT only — no schema/version
change, no row deletion, no mutating unlink op, no LinkStatus enum change, no UI.
**Classification under review**: IMPL, HIGH-RISK (court-facing link status + citation export), **A0.7-gated** —
`Requires-A07: yes`, custody mode 9b (human runs marker mint + gated check-gates with the HMAC key; agent never
receives the key; impl commit blocked until human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `6a0ef5571dae8e0fe790ca9ccb8a93fa9290769c72ba65401e6d5c15182d3487`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs HIGH-RISK resolver/export behavior over court-facing status/citation).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-UNLINK-RESOLVE block (compact packet inlined) + the two design
  decisions (resolver status; export flag) + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mquf2144-jsn6vs`.
- **threadId**: none emitted.
- **rawOutput sha256**: `433733baa15aa45d72208f8d5afe9503ae14278f169ecd977f24609c585c287b`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — changes court-facing link status + export classification; correctly
custody 9b.
**RESOLVER-STATUS: BROKEN** — Codex recommends `broken` for an unlinked link's resolved status: with only
`valid | needs_review | broken`, `broken` is the safer non-clean trust-gate value (an explicit unlink means the
link is no longer usable as a citation target). Prepending `WHEN l.unlinked_at IS NOT NULL THEN 'broken'` as the
highest-precedence rung is the right durable override and does not weaken the existing ladder for NULL-marker
rows.
**EXPORT-FLAG: NEW-UNLINKED** — Codex recommends a dedicated additive `UNLINKED` ExportCitationFlag: reusing
`BROKEN` + another field is wider/weaker for the A10 degradation contract; a dedicated flag directly satisfies
"distinguishable from structural broken." Export MUST read `unlinked_at` (not only `status`), and an unlinked
link MUST produce exactly one non-clean object, never clean, never dropped.

Also confirmed: READ/EXPORT-only is correct + sufficient (no schema/version/LinkStatus/UI/mutating-unlink work
needed); legacy `unlinked_at IS NULL` rows are unchanged if the branch is strictly marker-gated; determinism +
idempotence preserved (marker maps to a stable non-clean status; resolver writes only on change; export read-only
after the resolver; rows persist, not deleted); no scope creep / no weakened Evidence invariant / no A3-DB-00
encryption hard stop.

## Findings to apply (two Lows — impl/test guidance; no scope change)
- **Low L1 — comments (apply).** Update the resolver/export file comments to record the V12 exception: `status`
  remains the trust gate, but `unlinked_at` is now a marker override (the explicit unlink is the marker, NOT
  status-only `broken`). Keep the "explicit unlink is the marker, not structural broken" distinction visible so
  the comments don't go stale relative to A3-UNLINK-SCHEMA-00 §5/§6.
- **Low L2 — hard idempotence test (apply).** Include an unlinked row whose stored status starts as `valid` and
  whose structure is otherwise clean; assert: resolver first run updates it to `broken`; second run updates `0`
  (idempotent, no spurious write); export emits `UNLINKED`; the row count is unchanged (no deletion). Keep this as
  a hard acceptance point.

## Disposition
READY → eligible to govern. C0 H0 M0; the two Lows are implementation/test-guidance items applied in this lane
(comment updates + the hard idempotence/durability test) and confirmed by the post-implementation broker audit +
verify; neither is a scope change into schema/version/LinkStatus/mutating-unlink/UI/dependency (no stop-and-ask
trigger). A07-classification CONFIRMED-A07-GATED; RESOLVER-STATUS BROKEN; EXPORT-FLAG NEW-UNLINKED. Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `6a0ef557…`). The implementation commit remains blocked
until the human-run A0.7 gated verification reports PASS AND the post-impl broker `/cc-suite:audit` +
`/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
