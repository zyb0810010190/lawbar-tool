# Queue review 089 — WI-A3-UNLINK-T1 (audited durable unlink/relink operation; A0.7-gated, custody 9b, HIGH-RISK)

**Date**: 2026-06-26.
**WI**: WI-A3-UNLINK-T1 — implement the durable unlink/relink OPERATION over existing `case_box_links` rows
(set/clear the V12 `unlinked_at`/`unlink_reason` markers), each appending EXACTLY ONE tamper-evident v2 audit
chain event (`LINK_UNLINKED` on unlink, `LINK_RELINKED` on relink) in the SAME `BEGIN IMMEDIATE` transaction as
the row UPDATE. SQLite-only; concrete-class methods on `SqliteCaseBoxPersistence` (not the shared interface, not
InMemory). The emitter of the LINK kinds that shipped contract-only in PR #136.
**Classification under review**: IMPL (persistence MUTATION over court-facing evidence link state + the
tamper-evident audit chain), **A0.7-gated** (custody mode 9b; `Requires-A07: yes`) and **HIGH-RISK** — broker
review-plan + audit + verify REQUIRED.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256 (final, governed)**: `1d33652ee53044ab903a001c626f3498bd6be608a65a0af893e6e4e30face0a2`.

## Review sequence (three review-plan rounds — full provenance)
1. **Round 1 — pre-amendment READY** (`review-plan-mquixkb5-h3hhyh`, queue sha `12b9d837…`, rawOutput sha
   `5ef841f8…`): READY with 3 Lows. MISSED a test-wiring contradiction (see Round 2).
2. **Amendment (Option B, user-authorized 2026-06-26)**: at implementation pre-flight the agent found the queue's
   new test file `tests/hardening-link-unlink-operation.test.mjs` would be ORPHANED — the persistence `npm test`
   uses an explicit curated `node --test` file list (NO glob) and `package.json` is a FORBIDDEN file, so a new
   file is never executed and the acceptance criteria were unsatisfiable as governed. STOPPED and reported.
   The user chose Option B: drop the new file; EXTEND the already-wired `tests/hardening-link-status-resolver.test.mjs`
   (which already carries the WI-A3-UNLINK-RESOLVE V12 marker fixtures), matching the predecessor pattern; do NOT
   touch `package.json`. Queue Allowed files + Commit boundary amended accordingly; re-linted.
3. **Round 2 — amended NEEDS-FIX** (`review-plan-mquju7dc-50f0i2`, rawOutput sha `d9bff8e0…`): confirmed the
   amendment is sound (G), scope-limited (H), and re-confirmed A0.7/surface/state-hash/behavioral/atomicity all
   GREEN — but raised ONE Medium: the plan still implied two separate `deps.nowIso()` calls (one for `unlinked_at`,
   one for the audit `timestamp`); the per-call-advancing test clock would diverge them. Asked for a single
   explicit shared `stamp` + an equality test. FIXED: plan + queue decision (4) + acceptance now mandate a single
   `const stamp = deps.nowIso()` reused for BOTH `unlinked_at` and the event `timestamp`, with a test asserting
   the `LINK_UNLINKED` event `timestamp` equals the row `unlinked_at`. Re-linted (queue sha → `1d33652e…`).
4. **Round 3 — Medium-fix READY** (`review-plan-mqujz9pi-brq8ob`, rawOutput sha `3c967a4f…`): "No Critical / High
   / Medium findings. The prior Medium is closed." Plan + queue aligned; no new inconsistency. **VERDICT: READY.**

## cc-suite invocation (required recording — authoritative round = Round 3)
- **Kind**: review-plan (broker; governs a HIGH-RISK A0.7-gated persistence + audit-chain change).
- **Target scope**: `dev-memo/plan-batch-casebox-evidence-a3-unlink-operation-00.md` + the amended
  `dev-memo/run/queue.md` WI-A3-UNLINK-T1 block + the predecessor pattern files + `package.json` (test-list
  confirmation) + the existing wired hardening-link-status-resolver test file.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID (authoritative)**: `review-plan-mqujz9pi-brq8ob`. (Earlier rounds: `review-plan-mquixkb5-h3hhyh`
  READY-pre-amendment; `review-plan-mquju7dc-50f0i2` NEEDS-FIX-amended.)
- **threadId**: none emitted.
- **rawOutput sha256 (Round 3)**: `3c967a4f491f7a6cc29e868daa5a41b7d4136adcd4e52bc559cfab3f422ef108`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none on the scoring rounds. NOTE: one DISCARDED attempt
  (`review-plan-mquiw0tv-fxjoxj`) before Round 1 — its prompt file was prepared with an UNQUOTED heredoc, so
  backtick tokens were command-substituted (PROMPT_CONTEXT_ERROR, author-side); never read; superseded by a
  Write-tool prompt.
- **Retry attempts**: 4 total (1 discarded malformed; Round 1 READY; Round 2 NEEDS-FIX after amendment; Round 3
  READY after Medium fix). Only Round 3 authorizes.

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none (the one Medium from Round 2 is CLOSED). Lows
from Round 1 (local exported link return type; single `nowIso()` stamp — now elevated, fixed, and the Medium
trigger; explicit `opts`/`actor_user_id` boundary validation) are folded into the implementation.

**A07-CLASSIFICATION: CONFIRMED-GATED-9B** — mutates durable evidence-link state + drives resolver/export
presentation; `Requires-A07: yes` + custody mode 9b correct (NOT a STOP). This lane HAS a custody-9b human gate
before the implementation commit.
**AMENDMENT (G): SOUND** — extending the already-wired `hardening-link-status-resolver.test.mjs` makes executable
coverage satisfiable without touching the forbidden `package.json`; no inherent blocker to proving the write op
there (it can `openSqliteCaseBoxPersistence`, seed rows, call the concrete methods, and assert markers + audit
rows + chain head + resolver/export integration + rollback).
**SCOPE (H): CONFIRMED** — tests confined to the WI-A3-UNLINK-T1 operation cases only; no resolver refactor, no
weakened resolver assertions, no UI/schema/manifest/export-rendering/contract/dependency/InMemory creep.
**SURFACE / STATE-HASH / BEHAVIORAL / ATOMICITY: CONFIRMED** — concrete-class methods reusing
`#runImmediateWrite`/`#writeAudit`; before/after hash excludes resolver-derived `status`; reject re-unlink/
re-relink with `illegal_transition`; SINGLE shared `stamp = deps.nowIso()` for marker + event timestamp; relink
takes no reason + clears `unlink_reason`; non-blank unlink reason validated at the boundary + builder guard;
marker UPDATE + one audit append in one `BEGIN IMMEDIATE`, exactly one event per op.
**SCOPE: CONFIRMED** — no schema/version, docs/contracts, resolver/export/UI/canonicalization/verifier,
InMemory/shared-interface, link create/delete, row deletion, or dependency change required.

## Findings to apply (Lows — impl guidance; no scope change, no STOP)
- **Low L1 — public return type.** Define/export a local SQLite link row type (e.g. `CaseBoxLinkRow`) from
  `linkRepoQueries.ts`, re-exported via `index.ts`; don't name a non-exported public return type.
- **Low L2 — single operation timestamp.** (Elevated to the Round-2 Medium and FIXED.) Capture one
  `stamp = deps.nowIso()`; use it for BOTH `unlinked_at` and the audit `timestamp`; assert equality in a test.
- **Low L3 — boundary validation.** Validate `opts` is an object and `actor_user_id` is a non-empty string at the
  operation boundary → `invalid_argument`, mirroring the existing mutation helpers.

## Disposition
READY → eligible to govern. C0 H0 M0. The Lows are implementation refinements applied in THIS lane and confirmed
by the post-implementation broker audit + verify. None is an out-of-scope change (no stop-and-ask trigger).
A07-classification CONFIRMED-GATED-9B (custody-9b human gate before the impl commit). The kinds shipped in PR #136
(no contract edit here). Proceeding to mark-reviewed + govern (standalone, content-bound to the final sha
`1d33652e…`). After authoring, the human runs the A0.7-gated `check-gates.sh` (custody 9b), then broker
`/cc-suite:audit` + `/cc-suite:verify` run on the implementation diff before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
