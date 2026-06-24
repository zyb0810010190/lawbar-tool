# Queue review 076 — WI-A3-T1-IMPL (Anchor/Link schema V11; case-box-persistence; A0.7-gated, custody 9b)

**Date**: 2026-06-24.
**WI**: WI-A3-T1-IMPL — add SCHEMA-ONLY V11 (`case_box_anchors` + `case_box_links`) to
`services/case-box-persistence` per A3-SCHEMA-00 §3 + A3-CONTRACT-00 §4 (reconciled, no-FK). The FINAL A3
foundation implementation lane (the original A3-T1, unblocked now that DocumentPage V9 + DocumentPageGeometry
V10 exist). A0.7-dependent (`Requires-A07: yes`), custody mode 9b (human runs the A0.7-gated check-gates with
the HMAC key; agent never receives the key; the implementation commit is BLOCKED until the human reports gated
PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `92d64986acc0ba34b671c2173d9b002b6fdda2794d7515af6afa258c3157dbcf`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; final foundation persistence lane; A0.7-gated migration).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-T1-IMPL block (compact packet inlined) + the V11 Anchor/Link
  schema.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqrr6n95-y4yieo`.
- **threadId**: none emitted.
- **rawOutput sha256**: `40259cc1763de2580f160aa545a1450e2b5a97afe3002a880bb8942f73315110`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none.
**RATIO-CONSTRAINT: 12DP-TEXT-OK** — storing the page_ratio rect as 12-dp TEXT (no numeric SQLite CHECK; format
+ `[0,1]` domain enforced app-layer) is unambiguous, tied to the V10 byte-stable bounds decision. Do NOT add
numeric CHECKs.
**CASCADE: NO-CASCADE-CORRECT** — adding NO `ON DELETE` cascade is correct; the delete/cascade policy is
unresolved (A3-SCHEMA-00 decision 5 / A3-CONTRACT-00 decision 9) and must not be invented here.
Codex confirmed the V11 schema matches A3-SCHEMA-00 §3 + A3-CONTRACT-00 §4 exactly (page_ratio rect 12-dp TEXT;
const coordinate_space/origin_ref; page_rotation enum; geometry_captured_at NOT NULL; physical_page_index >= 0;
LinkStatus CHECK NOT NULL no-default; source_type enum; no FK; no cascade; no UNIQUE beyond PK) — no required
column missing, no extra semantic column. No scope creep; no Evidence invariant or A3-DB-00 encryption hard
stop weakened; custody-9b correctly placed.

## Finding to fold into the implementation
- **Low.** Keep the test assertions EXPLICIT that `case_box_links.status` has NO default (a row without an
  explicit status fails) and that NEITHER new table has SQLite foreign keys or cascade behavior
  (`PRAGMA foreign_key_list` empty for both). RESOLVED in the test extension; verified by `/cc-suite:verify`.

## Disposition
READY → eligible to govern. The schema is a clean, exact realization of the merged contract; no ambiguity, no
cascade-policy decision, no FK (no stop-and-ask trigger). The Low is an implementation-detail test assertion
folded into the V11 tests and confirmed by the post-impl broker audit + verify. Proceeding to mark-reviewed +
govern (standalone, content-bound to sha `92d64986…`). After implementation + the human-run gated PASS
(custody 9b), broker `/cc-suite:audit` + `/cc-suite:verify` run before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
