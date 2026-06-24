# Queue review 075 — WI-A3-PAGE-T2 (DocumentPageGeometry schema V10; case-box-persistence; A0.7-gated, custody 9b)

**Date**: 2026-06-24.
**WI**: WI-A3-PAGE-T2 — add SCHEMA-ONLY V10 (`case_box_document_page_geometries` geometry-version owner) to
`services/case-box-persistence` per A3-PAGE-00 decision 6 + A3-SCHEMA-00 §6 (no-FK). The second foundation
implementation lane. A0.7-dependent (`Requires-A07: yes`), custody mode 9b (human runs the A0.7-gated
check-gates with the HMAC key; agent never receives the key; the implementation commit is BLOCKED until the
human reports gated PASS).
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `315eba7f6beed6311a4ecb0428968f0827794e8a5cef054585551bb0870a962b`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; second persistence-writing lane; A0.7-gated migration; RESOLVES two open
  schema decisions).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-PAGE-T2 block (compact packet inlined) + the V10 schema +
  the two open decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqroy5ig-0wao47`.
- **threadId**: none emitted.
- **rawOutput sha256**: `efae46aa009bebeb10779788eb7a5215c4f93188b76c6e0368ef13f65459a9c3`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**Both open decisions RESOLVED (no stop-and-ask):**
- **BOUNDS-TYPE: FIXED-DECIMAL-TEXT-12DP** — store `bounds_x/y/width/height` as fixed-decimal TEXT with 12
  fractional decimal places (canonical strings like `612.000000000000`), `COLLATE BINARY`. Matches the A3
  byte-stable-decimal precedent (A3-SCHEMA-00 page_ratio 12-dp TEXT), preserves fractional PDF user-space
  points, avoids SQLite REAL drift, avoids an arbitrary integer scale.
- **UNIQUE-MODEL: UNIQUE-DOC-PAGE-SINGLE-CURRENT** — `UNIQUE(document_id, physical_page_index)` per the merged
  A3-PAGE-00 ADR. Single-current is sufficient for INV-A3-6 (the current row's `captured_at` is the version;
  an anchor whose `geometryCapturedAt` ≠ the current row's `captured_at` → `needs_review`); version-history is
  NOT required and would deviate from the ADR. No deviation; no stop-and-ask.

Codex also confirmed: the geometry columns are correct + minimal for decision 6 (resolved_box cropBox|mediaBox,
bounds, rotation, captured_at version) — not a broader model; no viewport/FK/dependency/non-forward-migration;
no Evidence invariant or A3-DB-00 encryption hard stop weakened; the V9 page identity stays the owner via the
app-layer invariant; custody-9b correctly placed.

## Finding to fold into the implementation
- **Low.** (a) Pin the bounds-text canonicalization: fixed 12 dp, `COLLATE BINARY`, no alternate spellings —
  store canonical strings, assert the 12-dp format in tests. (b) `bounds_width`/`bounds_height` positivity is
  enforced as an app-layer invariant (the columns are TEXT decimals; a numeric SQLite CHECK on TEXT is not the
  case-box style) — documented in a comment, NOT a broadened geometry model. RESOLVED in the schema/tests;
  verified by `/cc-suite:verify`.

## Disposition
READY → eligible to govern. Both open decisions are resolved cleanly + consistent with the merged ADR (no
deviation, no ambiguity → no stop-and-ask). The Low is an implementation detail folded into the schema/tests
and confirmed by the post-impl broker audit + verify. Proceeding to mark-reviewed + govern (standalone,
content-bound to sha `315eba7f…`). After implementation + the human-run gated PASS (custody 9b), broker
`/cc-suite:audit` + `/cc-suite:verify` run before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
