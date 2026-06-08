QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-IPC-BOUNDARY-SWEEP-00 (WI-BS1, WI-BS2)

Completes the CaseBox IPC response-projection sweep. 5 channels still return raw persistence objects, leaking authority fields (same class as the closed FACTS-AUD-3/GET-AUD-1/AUDIT-AUD-1): matter:create/get/list/archive (raw CaseBoxMatter) + document:register (raw CaseBoxDocument). audit:chainHead is NOT a leak (AuditChainHead has no authority fields). v1-moot (Low) but the last open instances; wire-safe. NO persistence/contract/renderer/electron change.

- **WI-BS1 (IMPL, security-adjacent)** — project the 5 channels: one shared `MATTER_RESPONSE_FIELDS` (14 renderer-consumed display fields incl. `id`; excludes tenant_id/actor_user_id/open-index + non-consumed opt-in/successor flags) + `RendererMatter`/`RendererMattersPage`; `REGISTER_DOCUMENT_RESPONSE_FIELDS` mirroring GET_DOCUMENT (excludes tenant_id/actor_user_id/custody_chain); projectRow/projectPage in matter create/get(null-safe)/list/archive + register; tests + dto-sync entries; close MATTER-AUD-1 + REGDOC-AUD-1. Depends on: none.
- **WI-BS2 (TEST)** — extend dto-sync RESPONSE_ALLOWLISTS to the 4 missing (CREATE_FACT/TRANSITION_FACT/DOCKET_ENTRY/CONFIRM_DOCKET_DEADLINE); projection regression tests for createFact/transitionFact/createDocket/dismissDocket; table-drive forbidden-field tests for confirmDocket/dismissDocket/createDocket/createFact/transitionFact; close CBW-602-FORBIDDEN-TESTS if satisfied. Depends on: WI-BS1.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq4m0z81-dqtpth`: **PASS, no C/H/M.** Confirmed: WI boundaries + allowed/forbidden coherent; BS2 backward-depends on BS1; `id` must stay in MATTER_RESPONSE_FIELDS while tenant/actor/open-index + non-consumed opt-in/successor stay out; REGISTER mirroring GET_DOCUMENT (keeps matter_id, excludes tenant_id/actor_user_id/custody_chain) is correct given the renderer only null-checks the register result; **getMatter null must be projected only AFTER the null branch** (preserve value:null); projectRow/projectPage reuse without touching handlerShared/renderer/electron/contracts/services; BS2 loc watch real but has headroom; BS1 review-plan/audit/verify required; no design gate.

## Confirmations
- Queue-lint PASSED (2 WIs; BS2 → BS1 backward dep).
- Allowed/forbidden coherent; renderer/electron/services/contracts forbidden in both; BS1 forbids other handlers + handlerShared/handlers barrel.
- loc pre-scan: 0 over limit (matter dto 94, document dto 125, matterHandlers 222, documentHandlers 244 pure; ipc-casebox test 985/1200 — BS2 watch).
- Security boundary → cc-suite audit + verify REQUIRED at BS1 impl; BS2 test-only (self-review permissible). Long cc-suite calls via runner native --background + state-file polling.

## AMENDMENT-1 re-review (2026-06-07)
Added `apps/lawbar-desktop/tests/ipc-handlers.unit.test.mjs` to WI-BS1 Allowed-files (user-approved) because BS1's getMatter projection broke the pre-existing assertion `ipc-handlers.unit.test.mjs:209` (`result.value.tenant_id === "default-tenant"`) which was asserting the PRE-FIX leak; the 1-line update (tenant_id present -> absent; id present) must live in BS1 to keep its gate green. Re-review `review-plan-mq4ms19w-3qmlxh` returned PASS (no C/H/M): minimal correct amendment; the assertion update strengthens (not weakens) the test; scope language tight (one getMatter assertion only); internally consistent (file now Allowed, not Forbidden). Re-lint PASSED; re-governed content-bound.
