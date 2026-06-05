QUEUE_REVIEW_VERDICT=PASS

# Queue review — WI-702 Allowed-files amendment (Option B)

- Change under review: a governance amendment to the already-governed WI-702 (Add/Confirm Deadline UI + bridge) in BATCH-CASEBOX-UI-00. No product scope change — it relocates where WI-702's deadline tests live to respect the loc-guardian hand-written-test fail threshold.
- Trigger: `renderer-view-matter.test.mjs` is at EXACTLY 1200 raw LOC on main (loc-guardian fail = raw LOC >= 1200), reached during WI-701/WI-703. WI-702's deadline UI + DST-helper tests (~115 lines) cannot be added there without breaching the cap. Surfaced per the "stop and report instead of widening scope silently" rule; the user chose Option B.
- The amendment (only changes):
  1. Remove `apps/lawbar-desktop/tests/renderer-view-matter.test.mjs` from WI-702 Allowed-files and add it to Forbidden-files (WI-702 must not touch it; it stays UNCHANGED at 1200).
  2. Add a NEW dedicated `apps/lawbar-desktop/tests/renderer-deadline-write.test.mjs` to Allowed-files; the deadline UI-flow + DST-helper tests live there (mirroring the existing `renderer-deadline-urgency.test.mjs` split).
  3. Add `apps/lawbar-desktop/package.json` to Allowed-files; acceptance REQUIRES wiring the new test file into the explicit `node --test ...` "test" script so the WI gate exercises it.
  4. Record the user-approved deferral of the pre-existing 1200-LOC violation in the queue LOC note + the durable ledger row `LOC-RVM-1200` (a future bounded TEST WI splits the file below 1200).
  5. Acceptance: the DST gap/overlap detection is proven DETERMINISTICALLY against SYNTHETIC zone models via the EXPORTED pure `findUniqueInstant(input, toInstant, toComponents)` helper (not the runner's TZ).

- cc-suite review-plan chain (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only):
  - `review-plan-mq11is6s-atrgyr`: NEEDS-FIX (Medium — record the explicit user-approved deferral of the pre-existing 1200-LOC violation).
  - `review-plan-mq11ma6c-x6ivqm`: NEEDS-FIX (Medium — the new test file would not be exercised by the `npm test` gate, which lists files explicitly).
  - `review-plan-mq11osul-ueoszl`: **READY TO GOVERN** (no C/H/M; both Mediums resolved — deferral recorded in queue LOC note + LOC-RVM-1200 ledger; package.json added to Allowed-files + acceptance requires wiring the new file into the test script).

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (3 WIs: WI-701, WI-703, WI-702).
- This amendment adds NO new product scope; it only relocates WI-702's tests + records a user-approved pre-existing-LOC deferral. WI-702 still runs the full per-WI broker review-plan + audit + verify at implementation time.
- No migrations / infra-prod / secrets / new runtime dependency (adding a test-file path to the explicit `node --test` list is test wiring, not a dependency) / contract-schema change / persistence src change.
