QUEUE_REVIEW_VERDICT=PASS

# Queue review — WI-805 (TEST-only: split the 1534-LOC ipc-handlers.unit.test.mjs)

- Fresh governed queue (the closed BATCH-CASEBOX-FACT-REVIEW-00 queue replaced). WI-805 is a bounded Type:TEST WI to resolve the pre-existing CRITICAL-tier LOC finding: `apps/lawbar-desktop/tests/ipc-handlers.unit.test.mjs` is 1534 raw LOC (over the 1200 hand-written-test fail threshold AND past the 1500 "critical structural" line).
- WI-805 MOVES the cohesive case-box ENTITY IPC test group (listDeadlines + listFacts read tests + WI-601 docket create/confirm + WI-602 fact create write tests, the trailing block ~lines 1037-EOF, with the makeDocketProvider / makeFactProvider / validCreateDto / ENTRY_ID / DEADLINE_ID helpers inside it) VERBATIM into a NEW sibling `apps/lawbar-desktop/tests/ipc-casebox-handlers.unit.test.mjs` (mirroring the WI-704 renderer-fact-write split). The new file prepends a LOCAL copy of the shared harness (FIXED_NOW / FIXED_ID / clock / idFactory / makeProvider) + the handler imports + CHANNEL (for CHANNEL.factCreate); it does NOT import CaseBoxPersistenceError. The host keeps matter + audit + document tests + CHANNEL + CaseBoxPersistenceError, and prunes ONLY the 5 now-unused handler imports. TEST-only; no product change.
- cc-suite review-plan job: review-plan-mq1onptw-806y2i (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY TO GOVERN — no Critical / High / Medium. Two Lows/Mediums from the prior pass applied BEFORE governance:
  - M1: the new file imports CHANNEL (not CaseBoxPersistenceError); the host keeps both and prunes only the 5 moved handler imports.
  - M2: the new file is wired into ALL THREE package.json scripts that name the monolith — `test`, `test:unit`, AND `test:ipc-unit` — so the targeted scripts do not silently drop the moved coverage.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (1 WI: WI-805) after the fixes.
- Cohesive boundary leaves the host ~1036 LOC (margin ~163 below the 1200 cap); the new file ~550 LOC (well below 1200).
- TEST-only: Allowed-files limited to the two test files + package.json + the deferred-findings ledger; Forbidden protects renderer/**, src/**, electron/**, services/**, docs/contracts/**, and the renderer harness/view-matter test. Type TEST + no renderer/** path → no Design-artifact gate.
- Coverage-loss guard: acceptance requires the SAME total test count AND the SAME moved test-title set before vs after; the pre-existing 1534-LOC critical finding is recorded + closed in dev-memo/deferred-audit-findings.md citing WI-805.
- No migrations / infra-prod / secrets / new runtime dependency / contract-schema change / persistence src change.
