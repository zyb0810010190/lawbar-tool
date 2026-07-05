# Queue review — WI-GATE5-OCR-WORKER-SIGINT-FLAKE-00 (authoring/governance)

Lane: Gate-5 ocr-worker SIGINT idle-loop spawn-flake resolution WI **authoring/governance** (Type: IMPL, test-flake resolution). Governance-authoring only — this lane produces the governed queue WI so a FUTURE lane resolves (or justifiably quarantines) the flake; it implements NOTHING, edits no test/src/report source, and makes NO go-live decision.
Date: 2026-07-04. Branch: `gate5-ocr-worker-sigint-flake-governance` (from synced `main` @ `17b9905`). Batch: 1/3 since marker `54b5083` — no batch closeout this lane.

## What this is
Authorizes (per explicit user authorization 2026-07-04) a FUTURE execution lane to close M0 go-live **gate 5** (`docs/release/go-live-readiness-report.md` §1 gate 5 = PARTIAL — "1 pre-existing ocr-worker SIGINT flake (hot-system load)"; required action: "Deterministically resolve OR explicitly quarantine ... documented-acceptance is NOT sufficient for GO"). The flake is precisely located + self-documented: `services/ocr-worker/tests/cli.spawn.test.mjs` header (lines 9-15) + the test `"bin SIGINT during idle loop: exits 0 with stop_reason=stopped"` (line 239). Failure mode: the test spawns `bin/ocr-worker.mjs`, waits with a LIVENESS poll (`waitForLiveChild` — "not a formal readiness protocol; the worker has no child-side ready signal"), then `child.kill("SIGINT")`; under host load the SIGINT can precede handler-arm so Node's default action terminates the child (signal != null, code != 0) instead of a graceful `exitCode=0`/`stop_reason=stopped`. The WI PREFERS a deterministic fix — a child-side readiness marker emitted (on STDERR, to protect the stdout summary-JSON parse) after the SIGINT/SIGTERM handlers are armed + idle-loop entry, with the test waiting for it before SIGINT — and allows an explicit env-gated quarantine WITH justification only as a review-proven fallback that leaves a DOCUMENTED RESIDUAL (not a GO-clear). Predicate: `services/ocr-worker/dist/**` is gitignored + rebuilt by the test's `npm run build` pretest, so the src change is never staged. No fetcher/TLS/DNS/engine/pipeline change, no OcrQueueError-code rename, no dependency, no go-live decision.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (envelope `status:"completed"`), no failure class, no fallback. Governance-authoring lane → review-plan only (the exec lane's /cc-suite:audit — if the fix touches src — + /verify belong to the future execution lane).

### review-plan (gpt-5.5/medium/read-only; on the fix WI)
- `review-plan-mr74xvbo-vlbof2` · **READY** (no Critical/High/Medium; all five dimensions PASS — internal consistency incl. dist-excluded, deterministic-first completeness incl. the repeated-run determinism check, feasibility of the minimal stderr marker + the "npm test builds before running so no dist committed" claim confirmed, ambiguity control blocks fetcher/TLS/DNS + engines + dependency + silent-skip broadening, and go-live independence) · sha256 `2542613432ffa7ad0e4f4312f57a400d8cdf27dfa65ad6136fbbc8ecc291e669`.
  - One non-blocking **Low** folded after READY: the `cli.spawn.test.mjs` header comment anticipates a future readiness marker on STDOUT while the fix uses STDERR — added an exec-lane note requiring the stale header comment be updated when the test is edited.

## Verdict: READY (governed test-flake-resolution WI; deterministic-first; go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no test/src/report/native/schema/contract/dependency code touched — this lane commits ONLY the queue governance + this review artifact. No fix implementation, no go-live decision.

## Deferred findings
None. The one non-blocking Low was folded before governance; re-review not required (Low, non-substantive doc note). The FUTURE execution lane owes: reproduce/characterize the flake, the deterministic readiness fix (or review-justified quarantine), the repeated-run determinism proof, the full `npm --prefix services/ocr-worker test` pass, a /cc-suite:audit if the fix touches src, and the gate-5 evidence-row update + before/after recording. Clearing gate 5 does NOT imply go-live; the final verdict + the three STOP-AND-ASK hard-stops remain the user's.
