QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-FORBIDDEN-FIELD-TESTS-00 (WI-FF1)

TEST-ONLY completion of the corrected/narrowed BS2 work. The IPC boundary is already enforced + leak-free (BS1 shipped); this widens TEST coverage only. NO production code.

- **WI-FF1 (TEST)** — (1) add the 4 missing canonical `*_RESPONSE_FIELDS` to `renderer-dto-sync.test.mjs` authority-exclusion (CREATE_FACT/TRANSITION_FACT exclude tenant_id/actor_user_id/reviewer_actor_user_id; DOCKET_ENTRY excludes tenant_id + docket actor-identity fields; CONFIRM_DOCKET_DEADLINE excludes tenant_id/actor_user_id); (2) table-drive createDocket(1→22)/createFact(1→20)/confirmDocket(0→6) in `ipc-casebox-handlers.unit.test.mjs` over the canonical *_FORBIDDEN_FIELDS arrays (mirror the dismissDocket loop :494); (3) table-drive transitionFact(2→13) in `ipc-fact-handlers.unit.test.mjs`; (4) close CBW-602-FORBIDDEN-TESTS iff satisfied. dismissDocket already table-driven (no work). Depends on: none.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq4pnzix-592m1j`: **PASS, no blocking findings.** Confirmed: WI boundary coherent for test-only; the 4 missing dto-sync allowlists are exactly the named constants; forbidden array counts canonical (createDocket 22, createFact 20, confirmDocket 6, transitionFact 13); dismissDocket already table-driven and correctly excluded; existing scaffolding (makeDocketProvider/validCreateDto/seeded getDocketEntry/makeFactProvider/validFactDto) is sufficient; **confirmDocket forbidden rejects before the scoped preflight/write, so `{matterId, entryId, [f]:x}` suffices — no extra fixture/forbidden-file touch**; LOC risk acceptable with compact loops + the ~1185 stop-and-split guard; CBW-602 closable only after the createFact loop covers every CREATE_FACT_FORBIDDEN_FIELDS member.

## Confirmations
- Queue-lint PASSED (1 WI, no deps).
- Allowed/forbidden coherent; src/**, renderer/**, electron/**, services/**, docs/contracts/**, package.json, and the other test files (ipc-list-projection/_view-matter-dom/ipc-handlers/casebox-ipc.electron) all forbidden.
- loc pre-scan: ipc-casebox-handlers 1140 raw / cap 1200 (watch); ipc-fact-handlers 228; renderer-dto-sync 162 — all others ample.
- TEST-only → self-review fallback permissible at impl per cc-suite §"Low-risk WIs"; no security-boundary CODE change.
