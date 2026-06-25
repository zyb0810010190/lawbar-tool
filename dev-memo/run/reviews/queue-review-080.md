# Queue review 080 — WI-A3-EXPORT-T1 (headless export-citation builder; A0.7-gated, custody 9b)

**Date**: 2026-06-25.
**WI**: WI-A3-EXPORT-T1 — implement the deterministic, idempotent, headless export-citation builder in
case-box-persistence: call `resolveLinkStatuses` first (the only write), then derive — read-only — one
export-citation object per link (linkStatus + exportFlag + a DocumentPage-derived 卷X页Y citation when safe),
realizing the A3-EXPORT-00 degradation contract. Resolver status is the source of truth (no forked validity).
STATUS/CITATION-only: no audit events, no REPLACED refinement (both deferred). No schema/export-render/cascade/
lifecycle/UI/dependency change.
**Classification under review**: IMPL, HIGH-RISK (court-facing export citations; A1/A3/A10), **A0.7-gated** —
carries `Requires-A07: yes`, custody mode 9b (human runs marker mint + gated check-gates with the HMAC key;
agent never receives the key; impl commit blocked until human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `41850493c77f44db3e6392067608d6da36946a96f45d4996f92c7e8480cf1812`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs HIGH-RISK court-facing export over citation trust).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-EXPORT-T1 block (compact packet inlined) + the citation-identity
  reconciliation + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqtjvkay-uiom96`.
- **threadId**: none emitted.
- **rawOutput sha256**: `3fe67aaac4323eba42adaa7ba9fb6d15c807a7104386e1dddd31250d9c40425f`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — Codex confirmed this export IMPL reads geometry-derived link
status and is correctly `Requires-A07: yes` (custody 9b), per A3-EXPORT-00 §9.
**CITATION-IDENTITY: ACCEPTED-PAYLOAD-JSON** — Codex confirmed reading the citation-identity fields
(citationVolume / citationPageLabel / isCitable) from the V9 `case_box_document_pages.payload_json` is acceptable
and does NOT weaken A1: the current schema explicitly records those label fields there as the DocumentPage-owned
human-facing identity; introducing a typed citation contract first would be a schema/contract WI and is correctly
forbidden here. NON_CITABLE (absent/disabled identity) + AMBIGUOUS (non-unique label) preserve A1 trust by
refusing a clean citation. Also confirmed: resolver-first / resolver-status-as-source-of-truth is the right
coupling (resolver refresh is the only write, scoped/deterministic/idempotent; derivation read-only after);
exportFlag precedence is deterministic + complete + A10 no-drop preserved (one object per link); deferring
REPLACED + audit events is correct (do not invent); no scope creep, no invariant weakening, no A3-DB-00
encryption hard stop weakened.

## Low findings — implementation guidance (fold into code/tests; none is a scope change)
- **L1 — "usable citation identity" precision.** `citationVolume` + `citationPageLabel` must be present,
  string-like, and non-empty (after the package's existing normalization). Malformed `payload_json` must degrade
  deterministically — prefer `NON_CITABLE` for an otherwise-valid link — and MUST NOT crash the whole export
  (unless existing repo conventions require a hard failure). Apply: a defensive payload parse + a malformed-payload
  test.
- **L2 — ambiguity scope.** `AMBIGUOUS` is computed within the same tenant/matter/document scope over the
  DocumentPage payload labels — never from geometry/viewport. Apply: pin it in a test (a duplicate
  (citationVolume, citationPageLabel) within the document scope -> AMBIGUOUS).
- **L3 — package.json wording.** The Allowed-files `package.json` edit is **test-script wiring only**; the
  Forbidden "dependency manifest change" means no dependency add/remove/bump and no lockfile change — it does NOT
  forbid the explicitly-allowed test-script line. Apply: edit only the `scripts.test` value.

## Disposition
READY → eligible to govern. C0 H0 M0; the three Lows are implementation-guidance clarifications authored into the
builder code/tests in this lane and confirmed by the post-implementation broker audit + verify; none is a scope
change into schema/contract/dependency/export-render/cascade/lifecycle/REPLACED/audit (no stop-and-ask trigger).
A07-classification CONFIRMED-A07-GATED; citation-identity ACCEPTED-PAYLOAD-JSON — the WI proceeds A0.7-gated under
custody 9b. Proceeding to mark-reviewed + govern (standalone, content-bound to sha `41850493…`). The implementation
commit remains blocked until the human-run A0.7 gated verification reports PASS AND the post-impl broker
`/cc-suite:audit` + `/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
