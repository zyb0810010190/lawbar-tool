# Queue review 078 — WI-A3-T5-RESOLVE (A3 link-status resolver IMPL; A0.7-gated, custody 9b)

**Date**: 2026-06-24.
**WI**: WI-A3-T5-RESOLVE — implement the deterministic, idempotent, headless A3 link-status resolver in
case-box-persistence, realizing the A3-RESOLVE-00 ladder (broken > needs_review > valid; valid never default)
over the merged V9-V11 schema + case_box_documents. Reads the 4 A3 tables + case_box_documents; writes ONLY
case_box_links.status (write only when computed != stored). STATUS-ONLY (no audit events). Document-replacement
scoped to the supersedes_document_id reverse-lookup signal (Option 1).
**Classification under review**: IMPL, HIGH-RISK (court-facing link status), **A0.7-gated** — carries
`Requires-A07: yes`, custody mode 9b (human runs marker mint + gated check-gates with the HMAC key; agent never
receives the key; impl commit blocked until human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `6c3385a9e614a60c35a7524940c5f204098b04421c9d7d539807fc47ad4692ec`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs HIGH-RISK resolver behavior over court-facing LinkStatus).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-T5-RESOLVE block (compact packet inlined) + the Option 1
  document-replacement reconciliation + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqsrp52g-rvwkmq`.
- **threadId**: none emitted.
- **rawOutput sha256**: `94918b6d2b6ed4d4f31ce328be39e97211ce439c44a06a35cef6a4619efd163f`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — Codex confirmed this resolver IMPL executes anchor/link behavior
over the V9-V11 geometry-derived tables and is correctly `Requires-A07: yes` (custody 9b).
**OPTION1-RECONCILIATION: ACCEPTED-POINTER-ONLY** — Codex confirmed scoping document-replacement detection to
the `supersedes_document_id` reverse-lookup signal (and deferring the full Evidence
canonical/replaced_pending_review/superseded lifecycle to a future schema WI) is acceptable and does NOT require
implementing the full lifecycle first; it weakens no invariant because the persisted model has no other
replacement signal to observe. Also confirmed: the ladder is deterministic + complete for the declared combined
cases; status-only (no invented audit shape) is acceptable; source-identity deferral is acceptable; no scope
creep; no A3-DB-00 encryption hard-stop weakening.

## Low findings — implementation guidance (fold into code/tests + plan; none is a scope change)
- **L1 — source meaning scoping.** Treat the resolver's `valid` as "anchor/document-status validity," not final
  full `Link` validity across every future source table. Inventing source resolution now is false precision.
  Apply: a code/plan note that source-identity resolution (source_type/source_id) is a future WI.
- **L2 — Option 1 ≠ full lifecycle.** It detects only represented replacement (reverse `supersedes_document_id`);
  a same-geometry replacement with NO pointer stays `valid`. Acceptable ONLY because the persisted model has no
  signal to observe it and the full-lifecycle WI is explicitly deferred. Apply: already recorded in the queue +
  plan; keep the deferral explicit.
- **L3 — missing-geometry rung grounded to A3-RESOLVE-00.** Missing geometry → `broken` is the ADR's explicit
  rung-1 choice (older INV-A3-7 framed absent geometry as needs_review/refusal); keep the impl + tests grounded
  to A3-RESOLVE-00 §3 so the choice is traceable. Apply: cite A3-RESOLVE-00 §3 in the resolver/tests.
- **L4 — no dedicated supersession index.** Reverse `supersedes_document_id` lookup has no index; feasible for
  M0 but scope by tenant/matter and avoid per-link N+1 scans — preload the superseded-document set per
  tenant/matter in one grouped query. Apply: implement a single per-scope preload, not a per-link query.

## Disposition
READY → eligible to govern. C0 H0 M0; the four Lows are implementation-guidance clarifications authored into the
resolver code/tests + the plan in this lane and confirmed by the post-implementation broker audit + verify;
none is a scope change into schema/migration/dependency/export/cascade/UI/audit-shape/source-identity (no
stop-and-ask trigger fired). A07-classification CONFIRMED-A07-GATED and Option 1 ACCEPTED-POINTER-ONLY — the WI
proceeds A0.7-gated under custody 9b. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`6c3385a9…`). The implementation commit remains blocked until the human-run A0.7 gated verification reports PASS
AND the post-impl broker `/cc-suite:audit` + `/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
