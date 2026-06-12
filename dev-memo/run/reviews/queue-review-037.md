# Queue review 037 — WI-PKG1 (BATCH-DESKTOP-PACKAGING-ASAR-FIX-00)

**Date**: 2026-06-12.
**WI**: WI-PKG1 — bounded electron-builder packaging-config fix (`directories.output: release` + narrowed
allowlist `files`) so `npm --prefix apps/lawbar-desktop run dist` produces a distributable instead of failing
`app.asar: file size cannot be larger than 4.2GB`.
**Queue**: `dev-memo/run/queue.md`.
**Reviewed queue.md sha256 (post-fold)**: `0b1b90178aabd376d4b8c1e14c4501a39e91d309bd0055ca40226de1770a27d7`.
**Pre-fold sha256 (sent to broker)**: `9c1c3f6fa797fe114355380113d26f254cd1dea0e86dc0a91e6fb4f7f9ee083f`.
**Plan**: `dev-memo/plan-batch-desktop-packaging-asar-fix-00.md` (§0 locks root cause / fix shape / scope / acceptance).

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: queue.md WI-PKG1 block + plan + `apps/lawbar-desktop/package.json` (build field), file-scoped prompt.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqakv1nq-m7rrht`.
- **threadId**: none emitted.
- **Result location**: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mqakv1nq-m7rrht.json`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, completed with rawOutput).
- **Failure classification**: none (succeeded first attempt; no timeout).
- **Retry attempts**: 1 (single attempt, focused packet).

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.

All six review questions answered YES (output-relocation + allowlist-first is the correct minimal robust fix;
narrowing risks dropping a runtime module → must prove via a packaged launch; asar-unpack for better-sqlite3
correct; scope correctly bounded to the package.json build field; post-dist binding risk identified;
`Type: IMPL` correct; review-plan-first + audit + verify the right gate for the Electron/native-module
high-risk change; not an autonomy hard stop).

## Findings (3 Medium clarifications — all folded into the queue before govern)

- **Medium #1 — allowed-files vs commit-boundary ambiguity**: the commit boundary mentioned a "governance
  metadata refresh" while `Allowed files` listed only `package.json`. → Folded: `Allowed files`, the
  acceptance criteria, and the commit boundary now state explicitly that `apps/lawbar-desktop/package.json`
  (`build` field) is the ONLY product file, and the governance-metadata files (queue.md/linted/reviewed/
  governed + queue-review-037.md) are committed per the governed-batch lifecycle as workflow infrastructure,
  intentionally outside the product file-boundary.
- **Medium #2 — packaged launch/test must be mandatory, not "if practical"**: a successful `dist` pack does
  not prove runtime coverage of the narrowed allowlist. → Folded: Gates + Acceptance now REQUIRE
  `npm --prefix apps/lawbar-desktop run test:packaged` (or the packaged wrapper) to pass — the packaged app
  must launch (window opens, case-box shell renders) proving no runtime-required module/native binding was
  dropped.
- **Medium #3 / Low — explicit post-dist host-binding verification**: a failed/interrupted `dist` skips
  `postdist`. → Folded: Acceptance now carries a REQUIRED step — after any dist attempt run `test:smoke` (or
  the full suite) to confirm the host `better-sqlite3` binding is usable; on a native-binding mismatch run
  `electron-builder install-app-deps` (node_modules-only) and re-run smoke before proceeding.

All three are queue-spec tightenings (no design change). The queue was re-linted after folding (PASS), so the
governed sha binds the post-fold content.

## Disposition

READY with three folded Medium clarifications → eligible to govern. Proceeding to mark-reviewed + govern
(standalone, content-bound to sha `0b1b90178aabd376d4b8c1e14c4501a39e91d309bd0055ca40226de1770a27d7`).
Implementation is NOT authorized by this review — it begins only on an explicit user instruction.

QUEUE_REVIEW_VERDICT=PASS
