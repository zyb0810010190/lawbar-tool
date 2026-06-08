QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-WORKFLOW-TEST-ENV-HYGIENE-00 (WI-WH1)

WORKFLOW-only hygiene; NO product/source/security-hook change. (a) Add `"postdist": "electron-builder install-app-deps"` to `apps/lawbar-desktop/package.json` (auto-restore host-arch better-sqlite3 after `npm run dist`); (b) concise AGENTS.md note (postdist native-arch restoration + the govern/commit-sequencing rule); (c) record the SEPARATE block-run-control-bash-write.sh unanchored-substring issue as an OPEN deferred Low (BRCBW-SUBSTR), not fixed here. Depends on: none.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq4r33hf-wbutzm`: **PASS, no C/H/M.** Confirmed: WORKFLOW boundary coherent (security hooks + workflow scripts Forbidden + documented-not-edited; BRCBW substring correctly deferred); `postdist` is the right npm lifecycle hook (runs after `npm run dist`, NOT on `npm test`, AFTER packaging copies bundled natives, so the built bundles are unaffected and normal runs aren't slowed); `electron-builder install-app-deps` matches the existing postinstall native-rebuild path and correctly restores the host dev binding; the govern/commit sequencing root cause is accurate (batch-commit-guard.sh is a PreToolUse Bash hook, so a bundled `govern && git commit` is denied before govern refreshes queue.governed); the AGENTS.md note is safe if operational near Test commands and touches no gate/hard-stop/commit-policy wording; heavy `npm run dist` acceptance is useful but optional (expensive, mutates gitignored node_modules) — the standard suite suffices for this low-risk WI if the heavy run is documented.

## Confirmations
- Queue-lint PASSED (1 WORKFLOW WI, no deps).
- Allowed = package.json + AGENTS.md + deferred-audit-findings.md; Forbidden = .claude/hooks/**, scripts/workflow/**, src/renderer/electron/services/contracts, tests/**, .claude/rules/**, settings.json, lockfiles, package.json keys other than scripts.postdist.
- loc pre-scan: trivial (config + doc).
- Low-risk WORKFLOW → cc-suite self-review fallback permissible at impl per §"Low-risk WIs"; review-plan ran on the queue.
- This batch's governance itself follows the documented rule: mark-reviewed + govern run STANDALONE, content-bind verified, THEN commit in a separate Bash call.
