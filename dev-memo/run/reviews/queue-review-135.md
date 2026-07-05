# Queue review — WI-GATE5-OCR-WORKER-SIGINT-FLAKE-00 (execution: deterministic flake fix)

Lane: EXECUTION of the governed Type:IMPL test-flake-resolution WI `WI-GATE5-OCR-WORKER-SIGINT-FLAKE-00` — deterministically resolve the ocr-worker SIGINT idle-loop spawn flake, run the suite + repeated-run determinism proof + the required broker audit, and update the gate-5 evidence row.
Date: 2026-07-05. Branch: `gate5-ocr-worker-sigint-flake` (from synced `main` @ `4fe2d22`). Batch: 1/3 since marker `e05bff4` — no batch closeout this lane.

## What shipped
Deterministic-first fix (the DETERMINISTIC path — no quarantine needed). 2 source/test files + the gate-5 evidence-row update + this artifact.
- **`services/ocr-worker/src/cli.ts`** — after `installShutdownHandlers` arms the SIGINT/SIGTERM listeners (step 2), emit a child-side readiness marker `ocr-worker ready: signal-handlers-armed\n` on **STDERR** (never stdout — the stdout summary-JSON parse must stay clean), gated on `installed !== undefined`. Once emitted, the SIGINT handler is provably armed, so a SIGINT flips the AbortController → graceful exit (0 / `stop_reason="stopped"`) rather than Node's default terminate action. Purely additive observability — no shutdown/exit-code/error-code/loop behavior change.
- **`services/ocr-worker/tests/cli.spawn.test.mjs`** — the SIGINT idle-loop test now waits for that stderr marker via a new `waitForStderrMarker` helper (resolves on the marker, rejects on early child exit + on timeout) BEFORE `child.kill("SIGINT")`, replacing the non-deterministic `waitForLiveChild` liveness poll (removed — it had no other caller and only proved "alive + stable", not "handlers armed"). The stale header comment (which anticipated a stdout marker) was corrected to the implemented stderr protocol.
`services/ocr-worker/dist/**` is gitignored + rebuilt by the test's `npm run build` pretest — never staged. No fetcher/TLS/DNS/engine/pipeline/coordinator change, no dependency, no schema/contract change, `CURRENT_SCHEMA_VERSION` stays 12, no OcrQueueError-code rename.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
The fix touches product src → the broker `/cc-suite:audit` is REQUIRED. Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`.

### /cc-suite:audit (on the fix diff)
- Attempt 1: `audit-mr7e0r6g-x0ht2d` · **FAILED — TIMEOUT** (`spawnSync codex ETIMEDOUT`; gpt-5.5/medium/read-only; even a lean 2-file prompt timed out because the read-only sandbox walk of the `services/ocr-worker` tree — node_modules + dist + ~25 test files — is expensive). Failure class **TIMEOUT** per `.claude/rules/cc-suite.md`.
- Attempt 2 (retry): `audit-mr7f42oq-jaqa51` · gpt-5.5/medium/read-only, **the exact 180-line unified diff inlined in the prompt** (so codex audits the diff text directly, no filesystem walk) · **CLEAN — FINDINGS: C0 H0 M0 L0** · rawOutput sha256 `df1f8f19ccaf94092bea10f918b4a555b6004bb018f1c3b435efb1647c0b84e0` · retrievable YES. All five checks PASS: (1) marker emitted after handler-arm + gated on `installed !== undefined`; (2) stderr-only, no stdout write added; (3) no behavior change beyond the additive marker; (4) no fetcher/TLS/DNS/engine/pipeline/dependency/schema/contract scope creep; (5) `waitForStderrMarker` resolves-on-marker / rejects-on-early-exit / rejects-on-timeout, `waitForLiveChild` removal safe, marker does not break the other spawn tests.

### /cc-suite:verify
Not applicable — a CLEAN audit (C0 H0 M0 L0) has no findings to close → verify is **vacuously ALL CLOSED**.

## Gates (this execution lane)
- `npm --prefix services/ocr-worker test` → **PASS** (475 tests, **472 pass / 0 fail**, 3 pre-existing engine skips). Tests-first honored: the deterministic readiness gate replaces the fragile liveness poll.
- **Repeated-run determinism proof**: the SIGINT idle-loop test ran **15/15 pass** (targeted, `--test-name-pattern`) + the full `cli.spawn.test.mjs` file **5/5 pass** — the flaky test now exits 0 / signal null / `stop_reason="stopped"` every run, no signal-terminated exit.
- `scripts/workflow/check-queue.sh` → PASS. `scripts/workflow/check-contract-integrity.sh` → PASS (14 docs). `CURRENT_SCHEMA_VERSION` unchanged (12). Diff confined to `src/cli.ts` + `tests/cli.spawn.test.mjs` + the gate-5 evidence-row of `go-live-readiness-report.md` + this artifact; `dist/` gitignored + not staged; no forbidden surface.

## Verdict: READY (deterministic flake fix; audit CLEAN; gate 5 CLEARED)

QUEUE_REVIEW_VERDICT=PASS

## Deferred findings
None. The broker audit returned C0 H0 M0 L0. Quarantine was NOT used — the deterministic readiness fix resolves the flake, so gate 5 is CLEARED (not a documented residual). Gate 5 CLEARED is a test-pass-gate status, NOT a go-live decision: the final GO/NO-GO verdict (blueprint gate 21) + the three STOP-AND-ASK hard-stops (framework/public-distribution/signing; 律师法 compliance; final sign-off) remain the user's.
