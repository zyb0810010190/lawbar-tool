# Queue review 086 — WI-A3-UNLINK-SCHEMA-01 (RE-REVIEW after narrow allowed-file expansion)

**Date**: 2026-06-26.
**WI**: WI-A3-UNLINK-SCHEMA-01 — the durable-unlink V12 additive migration (A0.7-gated, custody 9b). This is a
RE-REVIEW after a user-authorized NARROW allowed-file expansion: the V11->V12 bump breaks two stale
absolute-version assertions in the merged `tests/hardening-anchor-delete-guard.test.mjs`
(`CURRENT_SCHEMA_VERSION === 11`; `applySchema(db) === 11`), which were outside the WI's original allowed files.
The agent STOPPED (forbidden-file hard stop); the user authorized adding ONLY that test file, limited to the
stale version-pin fix, preserving the guard's substantive invariant.
**Supersedes**: queue review 085 (`review-plan-mqud08x6-r1lqqy`, READY / CONFIRMED-A07-GATED / MIGRATION
ADDITIVE-V12-SOUND on the pre-amendment sha `6e77f6ba`). The core migration verdict carries; this re-review
covers the amendment.
**Classification**: IMPL, HIGH-RISK (schema MIGRATION over the A3 link table), A0.7-gated (custody 9b).
**Queue**: `dev-memo/run/queue.md` (single WI, amended).
**Reviewed queue.md sha256 (amended)**: `2f0244e35578c9bd2c6f70cd011cf23d08a25c922a7bc8f704f72eaaac8cd422`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (re-review of the amended scope).
- **Target scope**: the AMENDED `dev-memo/run/queue.md` WI-A3-UNLINK-SCHEMA-01 block (the narrow guard-test
  expansion) + the 4 re-review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqudbjfx-92shcs`.
- **threadId**: none emitted.
- **rawOutput sha256**: `38d59fc52ea712980519e19f081fcd52327f0bb88e73c8b326b3fbd98c1704b5`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1 (re-review).
- **Prior review (085)**: `review-plan-mqud08x6-r1lqqy`, rawOutput sha256
  `180553f8f34bdcdf696d8a43b18b5bf8f732325b025e38749800cf863564d215` (READY; superseded by this amendment).

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-A07-GATED** — unchanged; persistence migration over A3 evidence-link tables,
custody 9b.
**EXPANSION: NARROW-VERSION-PIN-FIX-OK** — Codex confirmed the expansion is legitimate and NOT scope creep: the
V12 migration necessarily changes `CURRENT_SCHEMA_VERSION`, so fixing the stale absolute V11 assertions in the
guard test is an in-scope consequence of the authorized bump. The amended queue constrains the change tightly
(remove `=== 11`; `applySchema(db) === CURRENT_SCHEMA_VERSION`; no other guard-test edit). The core migration
remains sound (additive V12, version-gated idempotence, nullable marker columns, existing rows read not-unlinked,
anchor_id NOT NULL + LinkStatus unchanged, schema-only, app-layer reason-iff-unlinked, A0.7 custody 9b). No new
A3-DB-00 encryption hard-stop issue.

## Findings to apply (Lows — all minor; no scope change)
- **Low — test title also references stale 11 (apply).** The guard test's name "...version bump
  (CURRENT_SCHEMA_VERSION stays 11)" is itself a stale absolute-11 reference. Within the same narrow stale-pin
  fix, update the title to drop "stays 11" (e.g. "...adds no version bump of its own"). Reviewer would not block,
  but the update keeps the file coherent and is the same category of stale-pin fix.
- **Low — do NOT add an FK assertion (heed).** The amended queue mentioned preserving `foreign_key_list`
  assertions, but the guard test does not actually contain one (only a comment + the applySchema check). Under
  this narrow expansion, add NO new assertion; only fix the version pins. The guard is not weakened because no
  assertion is removed beyond the stale absolute-version pin.
- **Low — confirmations.** Expansion legitimate + tightly constrained; the rest of the WI unchanged and sound.

## Disposition
READY → eligible to (re-)govern. C0 H0 M0; the narrow expansion is confirmed in-scope and tightly constrained.
Applying the two minor Lows in the implementation (update the stale title; add no FK assertion). No stop-and-ask
trigger. Proceeding to mark-reviewed + govern (standalone, content-bound to the amended sha `2f0244e3…`). The
implementation commit remains blocked until the human-run A0.7 gated verification reports PASS AND the post-impl
broker `/cc-suite:audit` + `/cc-suite:verify` are clean.

QUEUE_REVIEW_VERDICT=PASS
