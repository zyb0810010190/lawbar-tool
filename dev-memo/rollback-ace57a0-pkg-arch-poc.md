# Rollback record — revert `ace57a0` of `WI-desktop-pkg-arch-tarball-poc`

**Date**: 2026-05-25.
**Recording type**: 7-field rollback recording per `dev-memo/rollback-00.md` §6 + `.claude/rules/cc-suite.md` §"Rollback recording". This dev-memo records the rollback because `ace57a0` was committed with the default `git revert --no-edit` message (no inline 7-field block); user authorized a doc-only follow-up file rather than amending the revert.

## 7-field rollback recording

### 1. Original commit hash (the commit being reverted)
`4783521f9fd6f4df216dff63a3e8311a1d56a888` — `feat(apps/lawbar-desktop): tarball PoC — case-box-persistence + case-box-contract inside packaged Electron binary`

### 2. Revert commit hash (the commit that lands the `git revert`)
`ace57a0a564ce5b881a4ef1703b388e46532fbfc` — `Revert "feat(apps/lawbar-desktop): tarball PoC ..."`

### 3. Original cc-suite job IDs (every job from `4783521`'s recording block)
- **Audit rev-0**: `audit-mpkv1hf9-blgax0` — NOT READY (0 C / 0 H / 3 M / 2 L).
- **Audit rev-1**: `audit-mpkvqqhv-9te0xd` — NOT READY (0 C / 0 H / 2 M / 1 L; new follow-ons from fixing rev-0).
- **Audit rev-2**: `audit-mpkwnsr3-6cmo1r` — VERDICT: NO Critical/High/Medium (0/0/0/2L). The 2 Lows were applied inline before the commit landed.

All 3 audits ran via Path 1 native `--background` per `.claude/rules/cc-suite.md`. All 3 invocations recorded in the codex-toolkit shared state directory under `cc-suite-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/jobs/`.

### 4. Reason for revert (one paragraph)

Packaged Electron app binaries spawned from a non-GUI parent process (the `node --test` test runner OR the `codex` cc-suite reviewer agent) can deterministically trigger a macOS `SIGABRT` ("Abort trap: 6") crash, with `abort()` called from inside HIToolbox's `_RegisterApplication` during the standard `+[NSApplication sharedApplication]` initialization that Electron performs at startup. The crash is logged to `~/Library/Logs/DiagnosticReports/lawbar-2026-05-25-*.ips` and surfaces as a macOS "lawbar quit unexpectedly" dialog to the user.

Triage at revert time (2026-05-25 03:50-03:53 local) found 3 crash reports with identical stack traces — affecting BOTH the new `--probe-casebox-pkg-arch` flag introduced by this PoC AND the pre-existing `--probe-case-box` flag from `c708ece` (WI-B Option A). The probe IIFE's `process.exit(0)` usually wins the race against the AppKit init, so PROBE_OK is printed before the crash fires and the test's stdout assertion passes; sometimes the AppKit init wins and the child exits via SIGABRT with empty stdout, manifesting as the smoke test's `code=null signal=SIGKILL` after the 10s timeout. Direct shell invocation of the .app binary (no Node/codex parent) does NOT crash — the probe completes cleanly in <50 ms.

The crash is a known Electron-on-macOS limitation for the packaged-probe verification pattern, not a defect introduced by the WI's code. The PoC's stated goal — "prove the package architecture works end-to-end inside a packaged Electron binary" — is invalidated as long as the verification mechanism can pop crash dialogs and produce flaky test results that mask the true success/failure signal. The PoC therefore needs a different verification mechanism (NOT the packaged-spawn-probe pattern) before a re-attempt is meaningful.

Concretely the revert is justified because (a) `git log` should reflect the reality that the PoC was incomplete pending a re-plan of the verification mechanism; (b) leaving `4783521` on `main` would entrench the packaged-probe smoke pattern in CI expectations even though it is known to be flaky; (c) the user's hard-stop rule was "treat the crash as a deterministic runtime failure until proven otherwise", and the PoC cannot be re-tested without the same crash recurring.

### 5. Tests run after revert

The revert was performed at commit time without re-running the test matrix (the reverted state IS the pre-revert state for those files, so re-running the pre-PoC test matrix would not exercise the reverted paths). The deletion of the 5 NEW PoC files plus restoration of the 5 modified files was verified by:
- `git diff --cached --name-only` returned empty (no staged changes).
- `ls scripts/` returned "no such file or directory" (the entire scripts/ directory created by the PoC is gone).
- `python3 -c "import json; d=json.load(open('apps/lawbar-desktop/package.json')); print(d['dependencies'])"` returned `{better-sqlite3: ^12.9.0}` (no case-box-contract, no case-box-persistence).
- `tail -6 .gitignore` showed NO `*.tgz` exclusions.
- `grep build-internal-packages apps/lawbar-desktop/README.md` returned empty.
- `apps/lawbar-desktop/electron/main.ts` restored to the pre-PoC version (no `--probe-casebox-pkg-arch` flag handler).

The pre-PoC test matrix (state of `018a9a9`) was verified GREEN prior to the PoC implementation — it is unchanged by the revert. The two PoC-generated tarballs (`docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz`, `services/case-box-persistence/case-box-persistence-0.1.0.tgz`) were left as untracked artifacts post-revert; the user explicitly authorized deleting them in the rollback-recording follow-up (this commit deletes them).

### 6. Whether the revert itself was audited

**NO.** Per `dev-memo/rollback-00.md` §6, revert-only commits typically do not require their own cc-suite audit. The revert touched the same 10 files the original commit touched and made identical-but-reversed mutations; no new code paths were introduced. The doc-only rollback record (this file) is a separate follow-up commit that contains only this dev-memo and the deletion of the two PoC-generated tarballs; it does not modify any source code and therefore also does not require its own cc-suite audit per `.claude/rules/cc-suite.md` §"Low-risk WIs" criteria.

### 7. Deferred-audit backlog changes

The PoC's final audit verdict (`audit-mpkwnsr3-6cmo1r`) was `0 C / 0 H / 0 M / 2 L`, with the 2 Lows applied inline before commit. **No rows were ever added to `dev-memo/deferred-audit-findings.md` for `4783521`** because no Critical/High/Medium findings remained open at commit time. The revert therefore requires no `status: reverted` updates in the deferred-findings backlog — there is nothing to flip.

For completeness: the prior audit rounds DID produce M-severity findings (rev-0 + rev-1) that were applied inline rather than deferred, so they have no backlog entries to update either.

## Posture confirmation

- Revert commit `ace57a0` on local `main` (NOT pushed).
- All 5 NEW PoC source files deleted; all 5 MOD PoC files restored to pre-PoC state.
- The 2 PoC-generated tarballs are deleted by this follow-up commit.
- `.claude/scheduled_tasks.lock` remains untracked (ScheduleWakeup runtime; pre-existing).
- `dev-memo/plan-casebox-ipc-impl-00.md` remains untracked (STOPPED prior lane; pre-existing).
- NO PoC re-attempt.
- NO Info.plist mutation, NO LSUIElement/LSBackgroundOnly, NO crash-dialog suppression.
- NO IPC implementation / product UI / case-box UI / real-data persistence / Tier 2 SQLCipher/Keychain / signing / notarization / distribution / telemetry / cloud sync / go-live.

## What comes next (NOT authorized by this commit; for future user direction)

The desktop package-architecture plan (`dev-memo/plan-desktop-package-architecture-00.md`, READY at `e5cb773`) is unchanged and remains the design authority for the next attempt. The tarball PoC plan (`dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md`, READY at `018a9a9`) is structurally invalidated by the crash class: its §6 packaged-spawn-probe pattern is not viable. A re-attempt at verifying the package architecture would need to either:

1. Replace the packaged-spawn-probe with a verification mechanism that does NOT spawn the packaged Electron .app from a non-GUI parent (e.g. an Electron-bin-internal self-test that runs as the .app's first BrowserWindow's hidden renderer, OR Playwright Electron which has its own GUI process model).
2. OR amend the PoC plan to scope the success criterion to "dry-run + asar list inspection" only (no packaged-binary spawn), accepting a weaker but reliable signal.
3. OR change the package-architecture recommendation to Option 1 (npm workspaces) and re-run the entire architecture decision lane.

Each of these is a separate planning lane requiring its own user authorization.

## Cross-references

- `dev-memo/rollback-00.md` §3 + §6 — rollback policy + 7-field recording template.
- `.claude/rules/cc-suite.md` §"Rollback recording" — mirrors §6 for cc-suite-recorded high-risk WIs.
- `.claude/rules/autonomy.md` §"Hard-stop list" + §"Committed rollback restrictions".
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` (commit `018a9a9`; READY rev-2; the now-invalidated plan).
- `dev-memo/plan-desktop-package-architecture-00.md` (commit `e5cb773`; READY rev-3; the design authority — UNCHANGED by this revert).
- Crash reports: `~/Library/Logs/DiagnosticReports/lawbar-2026-05-25-035059.ips`, `lawbar-2026-05-25-035123.ips`, `lawbar-2026-05-25-035328.ips` (local-only; not shipped).
