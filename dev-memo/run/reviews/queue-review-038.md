# Queue review 038 — WI-PKG1-TEST1 (BATCH-DESKTOP-PACKAGED-SMOKE-CURRENT-UI-00)

**Date**: 2026-06-12.
**WI**: WI-PKG1-TEST1 — refresh `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` to assert the
current case-box shell instead of the retired token-fixture UI (unblocks the WI-PKG1 mandatory `test:packaged`
gate). LOW-RISK, test-only.
**Queue**: `dev-memo/run/queue.md`.
**Reviewed queue.md sha256**: `67e18678c01f09fec6e8003e88bc6c1288806ef43baaa9ca70e2a19dab351dfd` (no fold needed — both
clarifications already satisfied by scope; governed at this sha).

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: queue.md WI-PKG1-TEST1 block + the two smoke test files, file-scoped prompt.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqall4xs-ptzcml`.
- **threadId**: none emitted.
- **Result location**: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mqall4xs-ptzcml.json`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, completed with rawOutput).
- **Failure classification**: none (succeeded first attempt; no timeout).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none. No blocking findings.

All five questions answered YES: dev smoke is the right source of truth; `nativeTheme.themeSource` via
`app.evaluate` is the correct theme path (the `button[data-mode]` UI is retired); scope correctly bounded to
the packaged smoke file only (package.json/product/dev-smoke/harness untouched; WI-PKG1 packaging fix kept
separate); keeping the packaged-binary harness + CI sentinel + Class-B caveat intact is correct; low-risk —
coverage is not loosened (launch, window, title, mounted shell, visible controls, theme propagation still
asserted through the packaged binary).

## Low-risk clarifications (acknowledged — no queue change required)

- **Clarification 1**: mirror only the relevant case-box-shell + theme assertions from
  `smoke.electron.test.mjs`, NOT every test (the dev smoke also has an S1 font-wiring test). Already the
  scope — the WI replaces the token-fixture assertions with the case-box shell + nativeTheme theme flip and
  does NOT port the font test. No change.
- **Clarification 2**: `findPackagedBinary()` probes `dist/` and `release/` (host-arch priority globally). The
  gate is "against the binary the existing harness selects." On this arm64 host, `dist/mac*` was pre-cleaned
  and the WI-PKG1 fix sends output to `release/`, so `release/mac-arm64` is selected — no stale `dist/`
  binary can mask it. Environmental; the WI forbids harness edits. No change.

Both are already satisfied; governance proceeds at sha `67e18678…` without a re-lint.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`67e18678c01f09fec6e8003e88bc6c1288806ef43baaa9ca70e2a19dab351dfd`). Implementation is NOT authorized by this
review — it begins only on an explicit user instruction (already given for this TEST WI).

QUEUE_REVIEW_VERDICT=PASS
