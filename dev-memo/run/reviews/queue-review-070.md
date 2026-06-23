# Queue review 070 — WI-EVW5-FIX1 (A0.7 hard-gate self-test env isolation; workflow fix, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-EVW5-FIX1 — fix the env-isolation defect in `scripts/workflow/check-a07-gate.test.sh`: the self-test
inherits ambient `A07_REQUIRED` (and would inherit an ambient HMAC key), so when the outer `check-gates.sh`
runs with `A07_REQUIRED=1` (the human mode-9b gated verification), the not-required cases fail closed. Fix:
make every self-test gate invocation hermetic (`env -u A07_REQUIRED -u LAWBAR_A07_MARKER_HMAC_KEY <assignments>
bash $GATE`), setting only the case-intended state. Production gate behavior UNCHANGED. Type WORKFLOW.
**Reproduced**: `A07_REQUIRED=1 bash scripts/workflow/check-a07-gate.test.sh` -> 1 FAIL / 11 PASS (case 1);
clean env -> ALL 12 PASS.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `9288e8a112dd30926cc8171ee2fdcd8d4ca7780c52c1e9e8d99e540498880f7c`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; the gate battery is the apex A0.7 enforcement).
- **Target scope**: `dev-memo/run/queue.md` WI-EVW5-FIX1 block (compact packet inlined) + the env-leak defect +
  the test-only hermetic fix.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqt1lkq-lvatun`.
- **threadId**: none emitted.
- **rawOutput sha256**: `df7dbd8c6a64c04ff0a11f0c55716edd14240438cc6b1214af84e914597104cf`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**FIX-SCOPE: TEST-ONLY-OK** — Codex confirmed: (1) the defect is in the self-test harness, not in
`check-a07-gate.sh`; making each invocation hermetic (clear ambient `A07_REQUIRED` + `LAWBAR_A07_MARKER_HMAC_KEY`,
then set only the case-intended state) is the correct fix and preserves production behavior (the production gate
still reads ambient `A07_REQUIRED`). (2) Test-only is the right scope; sanitizing `check-gates.sh` is NOT
recommended (would risk changing intended integration semantics + broaden the WI). (3) `env -u A07_REQUIRED -u
LAWBAR_A07_MARKER_HMAC_KEY <assignments> bash $GATE` is the right clear-then-set shape for required, not-required
(1/6/7/11), and queue-driven (8/9) cases. (4) No risk of masking a production bug or weakening fail-closed.
(5) `A07_REQUIRED` + `LAWBAR_A07_MARKER_HMAC_KEY` are the relevant ambient controls; do NOT use `env -i` (would
strip PATH/temp/tool lookup — portability risk).

## Findings to fold into the fix
- **Low — cases 8/9 must explicitly clear ambient `A07_REQUIRED`.** The queue-driven cases construct the
  invocation directly; ensure they clear ambient `A07_REQUIRED` (and the key) and rely ONLY on the temp queue
  fixture for required-ness. RESOLVED in the fix (all invocations routed through the hermetic `env -u` form);
  verified by `/cc-suite:verify`.

## Disposition
READY → eligible to govern. The Low is an implementation detail folded into the fix in this same lane and
confirmed by the post-impl broker audit + verify; no production gate-logic / marker writer/validator/schema
change (no stop-and-ask trigger). Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`9288e8a1…`). After implementation, broker `/cc-suite:audit` + `/cc-suite:verify` before the implementation
commit.

QUEUE_REVIEW_VERDICT=PASS
