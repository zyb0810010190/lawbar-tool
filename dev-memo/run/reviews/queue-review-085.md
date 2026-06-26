# Queue review 085 — WI-A3-UNLINK-SCHEMA-01 (durable-unlink V12 additive migration; A0.7-gated, custody 9b)

**Date**: 2026-06-26.
**WI**: WI-A3-UNLINK-SCHEMA-01 — implement the A3-UNLINK-SCHEMA-00 §2 mechanism as a forward-only ADDITIVE V12
migration: add two nullable marker columns to `case_box_links` (`unlinked_at TEXT COLLATE BINARY`,
`unlink_reason TEXT`); `CURRENT_SCHEMA_VERSION` 11 -> 12; `DDL_STATEMENTS_V12` + `DDL_BY_VERSION` entry;
`applySchema` upgrades V11 -> V12 additively. SCHEMA-ONLY (no resolver/export/operation; the marker columns are
written by future WIs). `anchor_id` stays NOT NULL; `LinkStatus` unchanged.
**Classification under review**: IMPL, HIGH-RISK (a persistence/schema MIGRATION over the A3 link table),
**A0.7-gated** — `Requires-A07: yes`, custody mode 9b (human runs marker mint + gated check-gates with the HMAC
key; agent never receives the key; impl commit blocked until human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `6e77f6ba59a7d534bcdd310935c782c9455eab5bcfab0d8167d35c06a4b94624`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs a HIGH-RISK schema migration over court-facing evidence-link persistence).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-UNLINK-SCHEMA-01 block (compact packet inlined) + the V12
  migration shape + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqud08x6-r1lqqy`.
- **threadId**: none emitted.
- **rawOutput sha256**: `180553f8f34bdcdf696d8a43b18b5bf8f732325b025e38749800cf863564d215`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — a persistence migration over the A3 evidence-link tables; both
A3-SCHEMA-00 and A3-UNLINK-SCHEMA-00 classify future persistence-touching A3 implementation WIs as custody 9b.
**MIGRATION: ADDITIVE-V12-SOUND** — Codex confirmed the V12 shape: two nullable additive
`ALTER TABLE case_box_links ADD COLUMN` statements, no defaults, no rewrite, existing rows read NULL, and the
version-gated `applySchema` (current+1..CURRENT) prevents a duplicate ALTER on normal re-run. Keeping
`anchor_id NOT NULL` + `LinkStatus` unchanged is correct (a SQLite cross-column iff CHECK would require a table
rebuild and conflicts with the repo's app-layer-invariant convention). Schema-only is feasible because the
marker-writing operation is also deferred; the sequencing constraint is that **no unlink operation may ship before
resolver/export marker-awareness**. No A3-DB-00 encryption hard stop weakened (synthetic/local fixtures only;
no production evidence ingestion).

## Findings to apply (two Lows — impl/test guidance; no scope change)
- **Low L1 — update the existing full-column-list assertion (operationally critical).** `hardening-schema.test.mjs`
  currently asserts the exact `case_box_links` column set after `applySchema`. Once `CURRENT_SCHEMA_VERSION` is 12,
  that assertion MUST include `unlinked_at` / `unlink_reason` (or be reframed as "base V11 columns present + V12
  columns present"), or the suite fails. Apply: update that assertion in the V12 test work.
- **Low L2 — collation test via schema source.** `PRAGMA table_info` proves existence/nullability but NOT
  collation. If the V12 test asserts `unlinked_at` is `COLLATE BINARY`, it MUST inspect `sqlite_master.sql` (the
  CREATE/ALTER text) or an equivalent schema-source check, not `table_info`. Apply: add a `sqlite_master.sql`
  COLLATE-BINARY check (or rely on the DDL + a documented note).

## Disposition
READY → eligible to govern. C0 H0 M0; the two Lows are implementation/test-guidance items applied in this lane
(the column-list assertion update + the collation source-check) and confirmed by the post-implementation broker
audit + verify; neither is a scope change into resolver/export/operation/dependency (no stop-and-ask trigger).
A07-classification CONFIRMED-A07-GATED; MIGRATION ADDITIVE-V12-SOUND. Proceeding to mark-reviewed + govern
(standalone, content-bound to sha `6e77f6ba…`). The implementation commit remains blocked until the human-run
A0.7 gated verification reports PASS AND the post-impl broker `/cc-suite:audit` + `/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
