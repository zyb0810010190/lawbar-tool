**Findings**

Low: [check-a07-gate.test.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-a07-gate.test.sh:16) does not stop after `new_project` fails. `T=$(new_project)` can become empty, after which later test cases write paths like `"$T/dev-memo/run/evidence"` as `/dev-memo/run/evidence`. I observed this in the read-only sandbox when `mktemp` was denied. This is not a gate bypass, but it violates the test’s “temp dirs only” intent and is an accidental-write hazard. The fix is to make project creation fatal per case or add a helper that skips/records failure before any path use.

No Critical/High/Medium findings.

**Audit Result**

The gate logic in [check-a07-gate.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-a07-gate.sh:32) is fail-closed for required A0.7 actions: it always delegates to `check-marker-guard.sh --scan`, detects required status from `A07_REQUIRED` or `Requires-A07: yes|true`, and requires at least one `a07_marker.py validate`-valid local marker. A committed/staged/tracked marker cannot satisfy the gate because the guard rejects namespace material from `git ls-files` before the gate’s own marker loop runs.

The implementation is read-only: no marker writing, no namespace creation, no guard relaxation, and `isMarker=false` cannot validate because the Python validator rejects it explicitly and binds it into the HMAC payload. CI-safe clean/not-required/no-key behavior passes; I ran that path successfully. I could not run the full self-test here because the sandbox forbids creating temp dirs, which exposed the low-severity test robustness issue above.

[check-gates.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-gates.sh:13) is additive: it preserves the existing marker guard, marker guard self-test, marker write/validate self-test, desktop suite, and fail-on-error behavior, then adds the A0.7 gate and self-test before desktop tests.

Verdict: PASS for WI-EVW5 security intent, with one Low test-harness hardening issue.
