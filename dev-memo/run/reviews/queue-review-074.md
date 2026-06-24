# Queue review 074 — WI-A3-PAGE-T1 (DocumentPage schema V9; case-box-persistence; A0.7-gated, custody 9b)

**Date**: 2026-06-24.
**WI**: WI-A3-PAGE-T1 — add SCHEMA-ONLY V9 (`case_box_document_pages` page-identity table) to
`services/case-box-persistence` per A3-PAGE-00 + A3-SCHEMA-00 §6 (no-FK reconciliation). The first foundation
implementation lane. A0.7-dependent (`Requires-A07: yes`), custody mode 9b (human runs the A0.7-gated
check-gates with the HMAC key; agent never receives the key; the implementation commit is BLOCKED until the
human reports gated PASS). **0-based `physical_page_index`** (user decision 2026-06-24).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `e74278d3899fcf159fbf114e9c7cb41d067ec04e4b02c3b734991e2896739be9`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; first persistence-writing lane; A0.7-gated migration).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-PAGE-T1 block (compact packet inlined) + the V9 schema + the
  index-base decision.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqrhmlct-bie228`.
- **threadId**: none emitted.
- **rawOutput sha256**: `f15bb3949e0fbaa25619374b017216713eb2318d7928b408e9f98ac32e6c725b`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**INDEX-BASE: 0-BASED-OK** — Codex confirmed: (1) the V9 DocumentPage schema is correct, minimal, and matches
the case-box conventions (CURRENT_SCHEMA_VERSION bump, DDL_BY_VERSION, schema_version, CHECK, forward-only,
column style, no FK); (2) 0-based `physical_page_index` (CHECK >= 0) is right and keeping the human citation
LABEL separate in payload_json is correct (no STOP); (3) lifting only identity/query-critical fields (and
keeping citation fields in payload_json) is the right minimal move per the canonical-source rule; (4) no drift
into geometry/viewport/anchor/link/FK/dependency/down-migration; no Evidence invariant or A3-DB-00 encryption
hard stop weakened; (5) custody-9b is correctly placed (agent must not self-clear the A0.7 gate).

## Finding to fold into the implementation
- **Low.** (a) `document_id` is globally unique (`case_box_documents.id` is the PRIMARY KEY), so
  `UNIQUE(document_id, physical_page_index)` is sound without tenant/matter scoping — record this in a comment.
  (b) The tests MUST explicitly assert **no FK** via `PRAGMA foreign_key_list(case_box_document_pages)` (empty)
  AND the absence of geometry/viewport columns and anchor/link tables. RESOLVED in the test extension; verified
  by `/cc-suite:verify`.

## Disposition
READY → eligible to govern. The Low is an implementation detail folded into the schema/tests in this lane and
confirmed by the post-impl broker audit + verify; it is not a scope change into
geometry/anchor/FK/dependency/UI (no stop-and-ask trigger fired; index base confirmed 0-based). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `e74278d3…`). After implementation + the human-run
gated PASS (custody 9b), broker `/cc-suite:audit` + `/cc-suite:verify` run before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
