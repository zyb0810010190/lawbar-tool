QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-LIFECYCLE-00 WI-D4 collateral-harness amendment (AMENDMENT-2)

- Amends ONLY the WI-D4 block (collateral-test-harness boundary correction; no product-scope change). WI-D1/D2/D3 merged; WI-D4 in progress.
- Trigger: WI-D4's renderer change loads pending docket proposals when the Deadlines disclosure opens, so `api.listDocketEntries` is now called by EVERY test that opens that disclosure. The shared harness `apps/lawbar-desktop/tests/_view-matter-dom.mjs` `makeStubApi` defines `listDeadlines`/`listFacts`/… but NOT `listDocketEntries`/`dismissDocketEntry`, breaking 11 collateral tests in `renderer-view-matter.test.mjs` (4) + `renderer-deadline-urgency.test.mjs` (7) — all Forbidden for WI-D4. WI-D4's own tests (renderer-deadline-write.test.mjs + renderer-dto-sync.test.mjs, Allowed) all pass.
- User approved (2026-06-07) AMENDMENT-2:
  - Add `apps/lawbar-desktop/tests/_view-matter-dom.mjs` to WI-D4 Allowed-files (removed from Forbidden).
  - The ONLY permitted change there: add two default shared-stub methods to `makeStubApi` — `listDocketEntries` (default empty success `{ rows: [], next_cursor: null }`) and `dismissDocketEntry` (default success, following the harness's existing success-default convention for mutating methods like `createMatter`/`archiveMatter`/`registerDocument`). WI-D4's own dismiss tests OVERRIDE `dismissDocketEntry` and assert the exact `{ matterId, entryId, dismissal_reason }` payload, so the success-default cannot mask a real authority/payload regression.
  - `renderer-view-matter.test.mjs` + `renderer-deadline-urgency.test.mjs` stay Forbidden + untouched (no assertion/fixture change); both now explicitly listed in Forbidden.
  - No renderer guard like `typeof api.listDocketEntries !== "function"` (rejected — would mask a missing production bridge for a required visibility feature).
- cc-suite review-plan: AMENDMENT-2 re-review `review-plan-mq3sgpjq-a5bsqk` (**PASS**, no C/H/M). Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only.

# Confirmations
- Queue-lint PASSED on the amended queue (4 WIs); WI-D4 Type-UI `Design artifact:` field intact.
- Collateral-harness correction only — no product-scope change (still list-proposed + dismiss-proposed; no edit/transition/reminders; no `src/**`/`electron/ipc/**`/`electron/main.ts`/`services/**`/`docs/contracts/**`/`src/caseBox/dto.ts`). `DTO-LOC-797` stays open (no DTO split).
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt`.
- The reviewer confirmed: justified collateral-harness correction (not scope creep); setup-only (2 default stub methods); success-default acceptable under the harness convention + WI-D4's own override-and-assert tests; no product-scope expansion.
