# Queue review 081 — WI-A3-CASCADE-00 (anchor-delete policy design; design-only, NOT A0.7-gated)

**Date**: 2026-06-25.
**WI**: WI-A3-CASCADE-00 — author the anchor-delete cascade-policy ADR (+ a dev-memo plan) that RESOLVES the
long-deferred policy (reject referenced-anchor delete; no ON DELETE CASCADE; no implicit cascade; no silent link
deletion) BEFORE any delete behavior, preserving citation trust + evidence integrity. **Design/ADR only**: no
code, no schema/migration, no FK/cascade, no soft-delete columns, no resolver/export change, no delete/unlink
implementation, no UI, no dependency, no marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `b3db4fbb074956b33695e68b3abf71f3fdc8665faadee37821a8c8c156ee0510`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs eventual HIGH-RISK destructive delete behavior over evidence links).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-CASCADE-00 block (compact packet inlined) + the 8 decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqtla99t-tjae9k`.
- **threadId**: none emitted.
- **rawOutput sha256**: `f7b3eabc9664f4ff99269fe605a8fc6f2cb5508a5d031d841208ead0bf0ee71a`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed a docs/ADR/plan-only cascade-policy WI
need not be gated while any future delete/link IMPL WI is (Requires-A07: yes, custody 9b), consistent with the A3
design-ADR pattern.
**CASCADE-POLICY: REJECT-REFERENCED-DELETE-SOUND** — Codex confirmed rejecting referenced-anchor delete (no ON
DELETE CASCADE, no implicit cascade, no silent link deletion) is the sound legal-evidence policy: it preserves
the load-bearing citation target instead of destroying/degrading links behind the user's back. Also confirmed:
the resolver missing-anchor->broken behavior is correctly a corruption/manual-data SAFETY NET (not the normal
deletion path), consistent with A3-RESOLVE-00 + the export A10 no-drop; unlink/break-link as a separate explicit
audited future workflow is correct; deferring the unreferenced-anchor-delete decision to product is acceptable;
decide-or-defer for the audit-event shape + keeping soft-delete out of this lane is correct; no scope creep, no
weakened Evidence invariant, no A3-DB-00 encryption hard-stop issue.

## Findings to fold into the ADR/plan (three Lows — design content, no scope change)
- **Low L1 — atomic check+delete (future impl).** Because there is no FK, a non-atomic "check-then-delete" would
  reopen the orphan-link risk via a race. The ADR/plan MUST record that the future delete implementation runs
  the referenced-anchor check AND the delete attempt in ONE write transaction, scoped by tenant/matter and using
  the `idx_case_box_links_by_anchor` lookup. RESOLVED in the ADR (policy) + plan (impl requirement).
- **Low L2 — audit as a predecessor for the destructive WI.** This design lane MAY defer the audit-event shape,
  but the future delete/unlink IMPL plan MUST make audit semantics a predecessor or explicit acceptance item —
  an actual unlink/delete must NOT ship as an unaudited destructive evidence operation. RESOLVED in the plan.
- **Low L3 — define "unreferenced" narrowly.** The future unreferenced-anchor-delete product decision MUST define
  "unreferenced" as no scoped `case_box_links` rows at the time of a transactional delete, and separately consider
  history/audit retention. RESOLVED in the ADR (deferral framing) + plan.

## Disposition
READY → eligible to govern. C0 H0 M0; the three Lows are design-content refinements authored into the ADR/plan in
this lane and confirmed by the post-authoring broker audit + verify; none is a scope change into
code/schema/delete-impl/UI/dependency (no stop-and-ask trigger). A07-classification CONFIRMED-DESIGN-ONLY-NOT-GATED;
CASCADE-POLICY REJECT-REFERENCED-DELETE-SOUND. Proceeding to mark-reviewed + govern (standalone, content-bound to
sha `b3db4fbb…`). After authoring, broker `/cc-suite:audit` + `/cc-suite:verify` run on the design packet before
the design commit.

QUEUE_REVIEW_VERDICT=PASS
