# Queue review 094 — WI-A3-LINK-IPC-T1 (audited link IPC/API implementation; A0.7-gated, custody 9b, HIGH-RISK)

**Date**: 2026-06-26.
**WI**: WI-A3-LINK-IPC-T1 — implement the link IPC/API surface from `docs/adr/ADR-evidence-a3-link-ipc-surface.md`
(5 channels `casebox:link:*`) as trusted main-process handlers delegating to the live persistence lifecycle.
IPC/API ONLY — no renderer UI.
**Classification under review**: IMPL (mutating IPC over court-facing audited evidence-link state), **A0.7-gated**
(custody mode 9b; `Requires-A07: yes`) and **HIGH-RISK** — broker review-plan + audit + verify REQUIRED.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256 (final, after the 1a/2i amendment)**: `806b9f07ac8fe270abb83b893d527f775b303cf28d9af683ce90b522ae4aedd3`.

## Review sequence (two review-plan rounds)
1. **Round 1 — NEEDS-FIX** (`review-plan-mqv0frd8-g03cuh`, rawOutput sha `49e7e0d6…`): A (A0.7 classification 5/5),
   C (provider wiring 4/5), D (A0.7 runtime model 5/5) confirmed; two Highs —
   **High#1** unlink/relink scoping: `unlinkLink(linkId, opts)`/`relinkLink(linkId, opts)` are UNSCOPED (linkId
   only); the app pattern (deadline/docket/fact) requires `matterId` + a scoped preflight; the original DTOs
   `{ linkId, … }` could not support it.
   **High#2** renderer parity: editing `renderer/api.ts` would pull in `renderer/types.ts` + the renderer-dto-sync/
   renderer-api tests (renderer wrapper creep); the file set was incomplete.
2. **Round 2 — READY** (`review-plan-mqv0nq24-6wb85b`, rawOutput sha `36553fc7…`): both Highs closed.
3. **Round 3 — narrow amendment, READY** (`review-plan-mqv1fjf0-4es5by`, rawOutput sha `c9362041…`): during
   implementation a real desktop build failure surfaced (`errorMap.ts` SAFE_MESSAGES is a total
   `Record<CaseBoxPersistenceErrorCode, string>` missing the existing `anchor_referenced` code — a latent break vs
   current persistence) plus internal-tarball refresh churn (package-lock integrity + a cosmetic package.json
   reformat). User-authorized amendment 1a+2i (2026-06-26): (1a) add `errorMap.ts` to allowed files for the ONE
   additive `anchor_referenced` exhaustiveness-sync line (not a new code/taxonomy); (2i) treat the package-lock
   integrity churn as local-only (dist-tarballs gitignored, no desktop CI job, bootstrapped locally — restore to
   main, don't commit) + restore the cosmetic package.json reformat. Round 3 confirmed: A the errorMap line is a
   narrow sync (the ADR §3 anticipated it), B the lockfile-local-only handling is correct (no CI consumes the
   desktop lock), C no other scope expansion. One Low: restore package-lock + cosmetic package.json before the impl
   commit (done in the impl step). queue.md re-linted → sha `806b9f07`.

## Fixes applied (closing the Highs)
- **High#1 → FIXED.** `UnlinkLinkDto { matterId, linkId, unlinkReason }`, `RelinkLinkDto { matterId, linkId }`; the
  unlink/relink handlers do a matter+active-tenant `getMatter` preflight AND a SCOPED link-existence preflight
  (`SELECT 1 FROM case_box_links WHERE id=? AND tenant_id=getActiveTenantId() AND matter_id=matterId`) →
  `invalid_payload` WITHOUT calling the unscoped mutation when null (fail-closed; mirrors the fact-transition/
  docket-confirm preflight). This EXTENDS ADR §2 (which omitted matterId for unlink/relink — an optional later docs
  reconciliation may fold it back). Confirmed safe + pattern-matching by Round 2.
- **High#2 → FIXED.** `renderer/api.ts` + `renderer/types.ts` are NOT touched (moved to Forbidden). The
  `renderer-dto-sync.test.mjs` gate uses a HARD-CODED `PAIRS` list (RENDERER_* ↔ canonical) and does NOT iterate
  new canonical DTOs, so new link DTOs/preload methods force NO renderer parity; `renderer-api.test.mjs` is
  explicit per existing wrapper methods. The renderer typed wrapper is the future UI lane. This lane is IPC +
  preload(CaseBoxApi) only. Confirmed by Round 2.

## cc-suite invocation (required recording — authoritative round = Round 2)
- **Kind**: review-plan (broker; governs a HIGH-RISK A0.7-gated IPC change over court-facing state).
- **Target scope**: `dev-memo/plan-batch-casebox-evidence-a3-link-ipc-t1-00.md` + the `dev-memo/run/queue.md` WI
  block + the ADR + the app IPC-pattern files + the persistence link files + Q1-Q3.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID (authoritative)**: `review-plan-mqv0nq24-6wb85b`. (Round 1: `review-plan-mqv0frd8-g03cuh` NEEDS-FIX-2H.)
- **threadId**: none emitted.
- **rawOutput sha256 (Round 2)**: `36553fc7a86bf807c456b57a4f1a5f011c796cb538df2156b93d470a7812ac97`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none on the scoring rounds.
- **Retry attempts**: 2 (Round 1 NEEDS-FIX-2H; Round 2 READY).

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none (both closed). Medium: none.
- **A. A0.7-CLASSIFICATION: CONFIRMED-GATED-9B** — mutating IPC over court-facing audited link state; custody 9b
  correct (dev/commit-time governance).
- **B/E. FIDELITY + SCOPE: CONFIRMED** — handlers mirror factHandlers (shape-guard → forbidden-field invalid_payload
  → unknown-field → camelCase-DTO validation → matter+tenant preflight [+ scoped link preflight for unlink/relink]
  → concrete link call → LINK_RESPONSE_FIELDS projection → mapThrownError); camelCase request DTOs; main-injected
  actor/tenant; projected snake_case response excluding tenant_id+payload_json; export verbatim `{ citations,
  byFlag }`; link-surfaced error codes only (no errorMap change). IPC + preload only; no renderer UI/wrapper, no
  persistence-semantic/schema/contract/dependency/native change; package.json edit = test-list registration only.
- **C. PROVIDER WIRING: CONFIRMED** — concrete `LinkPersistenceProvider` + Runtime `sqlite`+`db` exposure; InMemory
  fallback → safe boundary error for link channels.
- **D. A0.7 RUNTIME: CONFIRMED + SAFE** — NO runtime A0.7 marker (ADR D4); "fail closed without a marker" is
  satisfied at the dev/commit gate, not runtime; a runtime mechanism would be a separate-ADR STOP.

## Disposition
READY → eligible to govern. C0 H0 M0 (both Highs fixed). A0.7-gated custody 9b (human gate before the impl commit).
Proceeding to mark-reviewed + govern (standalone, content-bound to sha `e2e42ab7…`). The next lane (after this
IPC impl) is the renderer/UI lane (separately governed); a docs reconciliation may later fold the unlink/relink
`matterId` into ADR §2.

QUEUE_REVIEW_VERDICT=PASS
