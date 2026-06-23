# Queue review 072 — WI-A3-DB-00 (A3 persistence substrate decision; design-only, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-A3-DB-00 — decide the persistence substrate for the future A3 anchor/link schema implementation
(ADR + dev-memo sequencing note), before any schema/migration/dependency. **Design/ADR only**: no dependency,
no migration, no schema code, no key-management impl, no UI, no marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `68a393f6de3835d2482eff4b4364fab87df26987a23211cba613c34e87ec6d3d`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; the decision governs eventual HIGH-RISK persistence/migration + encryption).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-DB-00 block (compact packet inlined) + the grounded
  substrate facts + the recommended conclusions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqr9tsqd-6o7r7h`.
- **threadId**: none emitted.
- **rawOutput sha256**: `fe3a9bcce32da6816849f081d592b51274acdf0397b05a7170dba8be3b1093bc`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED.** **SUBSTRATE-DECISION: REUSE-CASE-BOX-BETTER-SQLITE-OK.**
Codex confirmed: (1) the decision ADR is rightly not gated while WI-A3-T1-IMPL is; (2) reusing
case-box-persistence's `better-sqlite3` is the correct substrate — case-box already owns documents/facts/
evidence/OCR-links/audit-chain and `DocumentPage`/`DocumentPageGeometry` are case-box domain; a new service
adds ownership ambiguity, `ocr-persistence` is the wrong domain, and pulling GRDB/SQLCipher into Node now would
violate the no-new-dependency scope and blur the macOS-app concern into the Node services; (4) the migration
convention (versioned-DDL/applySchema, forward-only, rollback via revert + a new forward version) is right for
an A0.7-gated, custody-sensitive migration.

## Findings to fold into the ADR/plan
- **Medium — hard-stop language for production evidence.** The ADR MUST frame encryption-at-rest as
  **REQUIRED before production evidence ingestion** — a blocking hard stop — NOT advisory "defer encryption"/
  "future improvement." Plaintext schema-only work on synthetic M0 data does not weaken confidentiality ONLY
  because that production boundary is recorded as blocking + enforceable in later WIs. RESOLVED in the ADR;
  verified by `/cc-suite:verify`.
- **Low — restate the future WI guardrails.** The future `WI-A3-T1-IMPL` acceptance criteria MUST explicitly
  restate: A0.7-gated, schema-only V9, no new dependency, no key management, no UI, and **cannot enable
  production evidence ingestion**. RESOLVED in the dev-memo plan.

## Disposition
READY → eligible to govern. The Medium + Low are design-content items authored into the ADR/plan in this lane
and confirmed by the post-authoring broker audit + verify; neither is a scope change into
implementation/dependency/key-management/UI/marker/gate (no stop-and-ask trigger fired). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `68a393f6…`). After authoring, broker
`/cc-suite:audit` + `/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
