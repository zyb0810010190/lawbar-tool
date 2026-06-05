QUEUE_REVIEW_VERDICT=PASS

# Queue review — WI-704 (TEST-only: split fact-write tests below the loc-guardian threshold)

- Change under review: addition of WI-704 (Type TEST) to BATCH-CASEBOX-UI-00, to resolve the deferred Low LOC-RVM-1200 — `apps/lawbar-desktop/tests/renderer-view-matter.test.mjs` is at exactly 1200 raw LOC (loc-guardian hand-written-test fail = raw LOC >= 1200), reached during WI-701/WI-703.
- WI-704 MOVES the cohesive "Add fact (WI-701 write affordance)" block (local stubWithFact + mountFactsWithAdd helpers + the 11 "add fact" tests, the trailing ~226 lines of the host file) into a NEW sibling `apps/lawbar-desktop/tests/renderer-fact-write.test.mjs` (mirroring the renderer-deadline-write.test.mjs split), preserving every assertion verbatim; defines a local factRow helper in the new file (factRow stays in the host for the read-fact tests); wires the new file into the package.json "test" script; closes LOC-RVM-1200. TEST-ONLY: no product/renderer/electron/src change.
- cc-suite review-plan job: review-plan-mq12cs1g-m7dz9b (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY-WITH-LOW — no Critical / High / Medium. Two Lows, both applied to the WI-704 block BEFORE governance:
  - L1: corrected the test count from "13" to "11" `add fact:` tests (the actual block size).
  - L2: strengthened acceptance to require the moved test-NAME set + assertions match before vs after (not merely the total count), so a silently-dropped test cannot be masked by an accidental duplicate.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (4 WIs: WI-701, WI-703, WI-702, WI-704) after the Low fixes.
- WI-704 is Type TEST (not UI): no Design-artifact gate applies, and the moved file is under `tests/` (not `renderer/**`), so the PR-time UI design-artifact gate does not fire.
- Allowed-files are narrow: renderer-view-matter.test.mjs, renderer-fact-write.test.mjs (new), package.json, dev-memo/deferred-audit-findings.md. The shared harness _view-matter-dom.mjs is in Forbidden-files (the new file defines a local factRow instead of expanding shared-harness scope).
- Math: moving ~226 lines from the 1200-line host leaves ~974 (margin ~226 below the cap); the new fact-write file is ~240 lines (well below 1200).
- This is a bounded maintenance WI to close a deferred Low; it changes NO product behavior and still runs the full per-WI broker review-plan + audit + verify at implementation time. No migrations / infra-prod / secrets / new dependency / contract-schema change / persistence src change.
