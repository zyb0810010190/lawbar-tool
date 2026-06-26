# Queue review 093 — WI-A3-LINK-IPC-DESIGN-00 (IPC/API surface design ADR; NOT A0.7-gated)

**Date**: 2026-06-26.
**WI**: WI-A3-LINK-IPC-DESIGN-00 — produce a DESIGN-ONLY ADR
(`docs/adr/ADR-evidence-a3-link-ipc-surface.md`) for the IPC/API surface exposing the audited link lifecycle
(createLink/unlinkLink/relinkLink/resolve/export — live on main) to the Electron app. Authorizes no code.
**Classification under review**: PLAN (design-only ADR), **NOT A0.7-gated** (authorizes no code; no marker), but
it GOVERNS eventual A0.7-gated IPC work, so broker review-plan + audit + verify are REQUIRED on the design.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `cf744831964d8598d2a261c1fd8ee38415f1a4de164a78761f3189e47c8698e8`.

## Review sequence (three review-plan rounds)
1. **Round 1 — NEEDS-FIX** (`review-plan-mquz64r6-lt1icn`, rawOutput sha `7c833f1b…`): READY on A (classification),
   C (A0.7 model), E (sequencing); three Mediums — M1 (link methods are concrete `SqliteCaseBoxPersistence`, not on
   the shared `CaseBoxPersistence` interface that the desktop `PersistenceProvider` is typed against), M2
   (`buildExportCitations` returns `{ citations, byFlag }`, not a bare array), M3 (D3/D9 "each
   `CaseBoxPersistenceErrorCode`" too broad — `anchor_referenced` not surfaced by link ops / not in `SAFE_MESSAGES`).
2. **Round 2 — NEEDS-FIX** (`review-plan-mquzapu9-4izk4s`, rawOutput sha `4604cc65…`): M1 + M3 CLOSED; M2 still
   inaccurate (`byFlag` is `Record<"CLEAN" | ExportCitationFlag, number>` — includes a `CLEAN` key; `ExportCitation`
   also has `sourceType`/`sourceId`).
3. **Round 3 — ALL CLOSED** (`review-plan-mquzd8y6-2u27pv`, rawOutput sha `fcfd0091…`): M2 corrected to the exact
   `ExportCitationResult` shape; **all three Mediums closed.**

## cc-suite invocation (required recording — authoritative round = Round 3)
- **Kind**: review-plan (broker; governs a design that precedes A0.7-gated IPC work).
- **Target scope**: `docs/adr/ADR-evidence-a3-link-ipc-surface.md` (D1-D11) + the `dev-memo/run/queue.md` WI block +
  the app IPC-convention files + the persistence link files + the 5 review questions (A-E).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID (authoritative)**: `review-plan-mquzd8y6-2u27pv`. (Earlier: `review-plan-mquz64r6-lt1icn` NEEDS-FIX-3M;
  `review-plan-mquzapu9-4izk4s` NEEDS-FIX-M2.)
- **threadId**: none emitted.
- **rawOutput sha256 (Round 3)**: `fcfd009129b5f2cb585a64b7826d77556abc4c6b84d05c75cacf297340dd67ca`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none on the scoring rounds.
- **Retry attempts**: 3 (Round 1 NEEDS-FIX; Round 2 NEEDS-FIX after M1+M3 fix; Round 3 ALL CLOSED after M2 fix).

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none (all three closed). Scores (Round 1):
classification 5/5, convention-fidelity 3/5 (raised by the fixes), A0.7-model 5/5, confidentiality 4/5,
sequencing 4/5.

- **A. CLASSIFICATION: CONFIRMED-DESIGN-NOT-GATED** — design-only, authorizes no code; review/audit/verify still
  required because it governs A0.7-gated IPC work.
- **B. CONVENTION FIDELITY: CONFIRMED (after fixes)** — channels `casebox:link:*`; main-injected actor/tenant +
  renderer-forbidden; `LINK_RESPONSE_FIELDS` allowlist; `IpcEnvelope` + existing `CaseBoxPersistenceErrorCode`
  reuse. M1 (concrete `SqliteCaseBoxPersistence` provider typing / `runtime.links` — no shared-interface/InMemory
  widening), M2 (the exact `{ citations: ExportCitation[], byFlag: Record<"CLEAN"|ExportCitationFlag,number> }`
  result with `sourceType`/`sourceId`), M3 (link-surfaced codes only; `anchor_referenced` excluded) all fixed.
- **C. A0.7 MODEL: CONFIRMED + SAFE** — A0.7 is a dev/commit-time governance gate, NOT a runtime feature flag; the
  IPC impl lane is A0.7-gated at commit time; runtime safety = OS sandbox offline + local-first + main-injected
  actor/tenant + persistence validation; inventing a runtime A0.7 marker would be a separate-ADR mechanism (out of
  scope).
- **D. CONFIDENTIALITY + BOUNDARIES: SOUND** — identifiers/status/flags only; `tenant_id` stripped; actor/tenant
  main-injected; matter_id persistence-validated; evidence/anchor existence enforced by persistence; rejection
  semantics relayed via the envelope; resolver/export status vocabulary unchanged. (`unlink_reason` is lawyer-
  authored lifecycle metadata, treated matter-confidential — acceptable.)
- **E. SEQUENCING + RECONCILIATION: CONFIRMED** — design → A0.7-gated IPC/API-only → renderer/UI → export
  rendering; the createLink evidence-existence note is preserved (optional later docs cleanup); the impl-lane
  desktop `package.json` test-registration note is correct (explicit curated test list).

## Disposition
READY → eligible to govern. C0 H0 M0 (all three Mediums fixed). DESIGN-ONLY; NOT A0.7-gated. The ADR implements
no IPC/renderer code, changes no schema/contract/persistence/package. Proceeding to mark-reviewed + govern
(standalone, content-bound to sha `cf744831…`). The NEXT LANE is the IPC/API impl (WI-A3-LINK-IPC-T1, A0.7-gated,
IPC-only; UI deferred).

QUEUE_REVIEW_VERDICT=PASS
