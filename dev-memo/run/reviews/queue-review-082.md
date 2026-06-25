# Queue review 082 — WI-A3-DELETE-T1 (referenced-anchor-delete refusal guard; A0.7-gated, custody 9b)

**Date**: 2026-06-25.
**WI**: WI-A3-DELETE-T1 — implement the app-layer REFUSAL guard for referenced-anchor delete (A3-CASCADE-00 §2/§9),
negative-path only: `assertCanDeleteAnchor(db, { tenant_id, matter_id, anchor_id })` throws a typed
CaseBoxPersistenceError on a referenced/missing anchor, returns void when allowable, performs NO physical delete.
Existence + scoped reference checks in one write transaction (race-safe shape for the future check+delete). No
physical anchor/link delete, no unreferenced-delete, no unlink, no cascade, no schema/FK, no resolver/export
change, no audit events.
**Classification under review**: IMPL, HIGH-RISK (guards destructive delete over court-facing evidence anchors),
**A0.7-gated** — `Requires-A07: yes`, custody mode 9b (human runs marker mint + gated check-gates with the HMAC
key; agent never receives the key; impl commit blocked until human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `fca1ec7803214093d76b12f3f8083786862edbde902be003d4fd41ff0a43da6c`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs HIGH-RISK destructive-delete guard over evidence anchors/links).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-DELETE-T1 block (compact packet inlined) + the error-code /
  missing-anchor / tenant-matter-scope decisions + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqtmb0jp-7lkj1i`.
- **threadId**: none emitted.
- **rawOutput sha256**: `f62810d5cde083c33efc4e5ae650140f777e780a0b2fddfe476e588ad7c1af00`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — implementation over A3 anchor/link behavior; correctly
`Requires-A07: yes` (custody 9b) per A3-CASCADE-00.
**ERROR-CODE: ADD-DEDICATED-CODE** — Codex recommends a NARROW additive `anchor_referenced` member of
`CaseBoxPersistenceErrorCode` (this refusal is a reference-integrity policy block, NOT a lifecycle transition;
a dedicated code gives future API/UI callers a stable "unlink first" signal without parsing messages). This
review-plan APPROVES the single additive errors.ts member (the queue's conditional errors.ts allowance is now
satisfied).
**SCOPE-INTERPRETATION: TENANT-MATTER-SCOPED-OK** — the referenced-check scoped by (tenant_id, matter_id,
anchor_id) is correct (A3-CASCADE-00 defines "unreferenced" as no scoped links; the resolver also joins anchors
by id + tenant + matter; a cross-scope link is inconsistent state in its own scope, not a blocker for the target
scope). Also confirmed: negative-path/refusal-only is sound (fixes the earlier sequencing ambiguity); missing
anchor -> deterministic `invalid_argument` refusal with no mutation is acceptable (no existing unknown_anchor
code; do NOT add a second dedicated code this WI); emitting NO audit event is correct for a non-destructive
refusal (A3-CASCADE-00 §7 — rejection may or may not be audited; only actual unlink/delete must not ship
unaudited); no scope creep / no weakened Evidence invariant / no A3-DB-00 encryption hard-stop issue.

## Findings to apply (Lows — design content / impl guidance; no scope change beyond the approved additive code)
- **Low L1 — dedicated error code (APPLY).** Add `anchor_referenced` as ONE additive member of
  `CaseBoxPersistenceErrorCode` (errors.ts); the guard throws `CaseBoxPersistenceError("anchor_referenced", …)`
  on a referenced anchor. No other error-system change.
- **Low L2 — missing-anchor code (keep narrow).** Use the existing `invalid_argument` for a missing/unknown
  scoped anchor; do NOT add a second dedicated code in this WI.
- **Lows L3-L5 — confirmations (no action).** Tenant/matter scope correct; no-audit correct;
  negative-path-only design + A0.7 gating correct.

## Disposition
READY → eligible to govern. C0 H0 M0; the actionable Low (L1) is the review-plan-APPROVED narrow additive
`anchor_referenced` error code authored into errors.ts + the guard in this lane, confirmed by the
post-implementation broker audit + verify; the rest are confirmations. No stop-and-ask trigger (no physical
delete / unlink / cascade / schema-migration / dependency / UI / broad-new-error-system). A07-classification
CONFIRMED-A07-GATED. Proceeding to mark-reviewed + govern (standalone, content-bound to sha `fca1ec78…`). The
implementation commit remains blocked until the human-run A0.7 gated verification reports PASS AND the post-impl
broker `/cc-suite:audit` + `/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
