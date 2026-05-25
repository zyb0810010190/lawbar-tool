# PLAN — Packaged-probe verification redesign

**Status**: PLAN-ONLY rev-3.1-DRAFT-PENDING-REVIEW (supersedes rev-2 READY at b77001b; supersedes rev-3-DRAFT after review-plan-mpldafv6-i0bt1c findings). **Read §20-28 FIRST** — rev-2's PERMANENT 1000ms crash-watchdog row (§11) is empirically FALSIFIED by the 2026-05-25 11:04:05 SIGSEGV-at-shutdown crash report; **rev-2's Option 2a recommendation (§6/§10) is CONDITIONAL on TWO independent blockers: (1) crash-detection clearance per §24 + §25 reproduction, AND (2) a separately reviewed ESM-compatible evidence-2 mechanism (rev-2 §11 evidence-2 better-sqlite3 round-trip via `app.evaluate` was falsified by the aborted impl — ESM main process has no `require`; dynamic `import()` fails in `app.evaluate`'s vm context).**
**Date**: 2026-05-25 (rev-3 amendment).
**rev-2 historical Status**: PLAN-ONLY READY after third review attempt — compact-packet retry; 2 Low fixes applied inline (kept for history).
**Author**: Claude Code on explicit user direction (packaged-probe verification redesign lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Authorization basis**:
- Tarball PoC commit `4783521` reverted by `ace57a0`; rollback recording at `6afee88` (`dev-memo/rollback-ace57a0-pkg-arch-poc.md`).
- **rev-2**: applies all findings from `review-plan-mpky6bpg-4b9nrs` (0 C / 0 H / 1 M / 2 L). Edits: (M) Option 2 C3 score lowered 5→4 to match rev-1 prose that Playwright is test-harness equivalent (not exact user-launch); Option 2 total recomputed 34→33 (now TIED with Option 1 @ 33); explicit tie-break note added — Option 2 wins because C2 signal strength is materially higher (Option 2 = 5; Option 1 = 2; gap of 3 on the load-bearing criterion). §10 score summary + §16 review packet updated; (L1) §6 Option 2a Cons "perhaps a tiny export" phrase REMOVED; replaced with explicit "evidence WI uses existing exports/direct test imports only; NO package API/export changes" hard rule (matches §15 no-public-API-change claim); (L2) §11 evidence PERMANENT step expanded — crash-report watchdog includes a bounded **500-1000ms post-launch polling window** before comparing snapshots, because macOS may write the `.ips` file slightly after process exit. The post-snapshot polling waits up to 1000ms, sampling every 250ms; if a new `lawbar*.ips` appears at ANY point in the window, the test fails. No scope, dependency, or hard-stop change.
- ~~**rev-1**~~ (historical): applies all findings from `review-plan-mpkxqpud-62v08z` (0 C / 0 H / 3 M / 1 L).
- **rev-2 (post-compact-retry Low fixes applied; `review-plan-mplb8cj5-qbzrtd` returned READY-with-Lows after Path 1 attempt 1 `review-plan-mpkzto9f-krf0pd` ETIMEDOUT at 30min and was retried per cc-suite §"Retry policy" attempt 2 with COMPACT packet)**: 2 mechanical text Lows applied inline before commit. L1 — §13 step 2 (WI-retire-probe-case-box) gained explicit equivalence-of-coverage acceptance check: before retirement, demonstrate the `app.evaluate` probe imports + executes the same packaged better-sqlite3 native-module path formerly covered by `--probe-case-box` (full round-trip); record intentional delta in commit message if narrower. L2 — §11 PERMANENT crash-watchdog row expanded with operational constraint: evidence runs MUST occur with NO parallel lawbar launches; CI runs in clean user/session if available; parent-pid correlation not worth blocking on; constraint documented in WI #1 README/test header. Edits: (M1) §10 C1 score + §14 H1 risk row rewritten — scope claim to "Playwright packaged-launch safety across repeated runs", not "crash class eliminated"; `app.evaluate` only runs AFTER launch succeeds so it cannot observe AppKit-init crashes that occur before launch completion. C1 lowered to 3 pending evidence. Recommendation still wins after re-score; (M2) §11 evidence step elevated: crash-report watchdog becomes a PERMANENT assertion in every packaged verification test (not just one-time gate). 50/200-run loops kept as confidence evidence only, never proof. §13 follow-up WI scope explicitly includes permanent watchdog; (M3) §12 + §13 sequencing reconciled: §13 split sequence is canonical (first prove Playwright `app.evaluate` PoC; later retire `--probe-case-box` in separate WI after equivalent replacement exists). §12 rewritten to defer retire decision. Interim rule added: `test:probe` / `--probe-case-box` NOT invoked during evidence WI runs; (L) Playwright clarified as test-harness equivalent (not user-launch equivalent); `open -a` acknowledged as closer to Finder/user launch but weaker as structured harness; evidence-2 strengthened to full WI-B-style better-sqlite3 round-trip (open temp → CREATE/INSERT/SELECT → close → delete), not thin `Database.prototype.name` metadata check. No scope, dependency, or hard-stop change.
- Revert root cause: packaged Electron .app spawned from non-GUI parent (Node test runner OR codex agent) triggers `SIGABRT` in HIToolbox `_RegisterApplication` during `+[NSApplication sharedApplication]`. 3 macOS crash reports at `~/Library/Logs/DiagnosticReports/lawbar-2026-05-25-{035059,035123,035328}.ips` — all identical stack trace.
- Existing `--probe-case-box` (WI-B Option A; commit `c708ece`) uses the same fragile spawn pattern and is affected by the same crash class.
- Desktop package-architecture plan (`dev-memo/plan-desktop-package-architecture-00.md` rev-3 READY at `e5cb773`) remains the design authority for the packaging topology. Only the verification MECHANISM is invalidated; the topology recommendation (Option 2 — npm pack tarball install) is unchanged.

This plan does NOT implement anything. It compares 5 verification mechanisms, picks one, defines the evidence required before the tarball PoC may be re-attempted, and decides what to do with the existing fragile `--probe-case-box` packaged smoke.

## §1 — Scope + non-goals

**In scope** (plan-only):
- Articulate the crash class precisely (mechanism, parents, affected probes, why tests can pass while a dialog pops).
- Inventory existing probe / smoke surfaces in `apps/lawbar-desktop/tests/` and classify each as SAFE vs FRAGILE based on launch mechanism.
- Evaluate 5 alternative verification mechanisms against 8 criteria.
- Recommend ONE mechanism with explicit trade-off statement.
- Define the evidence required (acceptance gates) before reviving the tarball PoC.
- Decide the disposition of the existing `--probe-case-box` smoke (retire / quarantine / leave-with-doc).
- List follow-up WIs in sequence.

**Explicitly out of scope** (deferred or forbidden):
- Implementation of any verification mechanism.
- Implementation of the tarball PoC.
- Adding dependencies (Playwright Electron is already a devDep; no new tools added).
- Modifying `Info.plist`, `LSUIElement`, `LSBackgroundOnly`, or any crash-dialog suppression mechanism.
- IPC implementation restart.
- Product UI / case-box-aware screens.
- Real case data persistence.
- Tier 2 SQLCipher / Keychain.
- Auth provider, cloud sync, signing, notarization, distribution, telemetry.
- Workspace tool introduction.
- Replacing electron-builder.

## §2 — Existing context used

- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` (commit `6afee88`) — 7-field rollback recording for the PoC revert; cites the 3 crash reports + identical-stack-trace finding.
- `dev-memo/plan-desktop-package-architecture-00.md` (commit `e5cb773`; rev-3 READY) — design authority for the packaging topology; UNCHANGED by this plan.
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` (commit `018a9a9`; rev-2 READY) — the now-invalidated PoC plan. Its §6 packaged-spawn-probe pattern is the failure being redesigned.
- `apps/lawbar-desktop/electron/main.ts` (post-revert; HEAD `6afee88`):
  - Line 31: `if (process.argv.includes("--probe-case-box"))` — top-level probe-flag handler runs an async IIFE that ends in `process.exit(0/1)` BEFORE Electron's `app.whenReady` resolves.
  - Line 115: `if (process.argv.includes("--probe-case-box")) return;` — defence-in-depth short-circuit inside `whenReady` to avoid popping the FileVault dialog while the IIFE races to exit.
- `apps/lawbar-desktop/src/probes/caseBoxProbe.ts` — WI-B Option A probe implementation (better-sqlite3 direct).
- `apps/lawbar-desktop/tests/`:
  - `smoke.electron.test.mjs` — Playwright Electron; **dev** mode (not packaged); 3 tests. Launches `electron .` via `electron.launch({args: ["."]})`. SAFE (no crash in any observed run).
  - `smoke.packaged.electron.test.mjs` (WI-A) — Playwright Electron; **packaged** binary; 3 tests. Launches via `electron.launch({executablePath: binary, args: []})`. SAFE (no crash in any observed run since `65fd0cc`).
  - `smoke.native-module.electron.test.mjs` (WI-B) — **raw `child_process.spawn`** of the packaged binary with `--probe-case-box`; 2 tests. **FRAGILE** — same crash class as the reverted PoC's smoke; crashes happen under Node test runner spawn context.
  - `main.test.mjs` — pure-Node unit tests; no Electron spawn. SAFE.
- Existing crash-report locations: `~/Library/Logs/DiagnosticReports/lawbar*.ips` — Apple's CrashReporter ASL store; not shipped; local-machine only.
- Electron 34.x + electron-builder 25.x. macOS 15.6.1. arm64 host.
- Playwright Electron is already a `devDependency` (`@playwright/test ^1.50.0` + `playwright ^1.50.0`). No new dep required to use Playwright as the launch mechanism.

## §3 — The crash class (precise)

### Symptom
- macOS dialog: "lawbar quit unexpectedly. Click Reopen to open the application again. ..."
- Apple CrashReporter log at `~/Library/Logs/DiagnosticReports/lawbar-<timestamp>.ips`.
- `Exception Type: EXC_CRASH (SIGABRT)`. `Termination Reason: SIGNAL 6 Abort trap: 6`. `Application Specific Information: libsystem_c.dylib "abort() called"`.

### Crashed-thread stack (verbatim from all 3 crash reports)

```
__pthread_kill
pthread_kill
abort                                                 ← libsystem_c
_RegisterApplication                                  ← HIToolbox (WindowServer registration)
GetCurrentProcess                                     ← HIToolbox
-[NSMenuBarPresentationInstance _getAggregateUIMode:withOptions:]
_NSGetAggregateUIMode                                 ← AppKit
-[NSMenuBarPresentationInstance _isVisible]
+[NSMenuBarPresentationInstance _isMenuBarVisible]
_NSInitializeAppContext                               ← AppKit init
-[NSApplication init]
+[NSApplication sharedApplication]                    ← Electron calls this in early startup
... (Electron + V8 + ElectronMain) ...
start
```

### Mechanism

Electron, on macOS, calls `+[NSApplication sharedApplication]` during early startup as part of its main-process bootstrap. This synchronously runs `_NSInitializeAppContext`, which calls into HIToolbox to register the process with the system WindowServer. The registration calls `_RegisterApplication`. When this registration FAILS (for reasons that depend on parent-process state), HIToolbox calls `abort()`, which fires `SIGABRT`, which terminates the process AND triggers the macOS user-visible crash dialog.

### Conditions observed in 3 crashes (all `4783521` era)

| Crash | Date | Parent | cpuType | Probe path |
|---|---|---|---|---|
| 1 | 2026-05-25 03:50:59 | `node` (Node test runner) | arm64 | `--probe-case-box` (existing WI-B) |
| 2 | 2026-05-25 03:51:23 | `codex` (cc-suite reviewer) | arm64 | `--probe-casebox-pkg-arch` (PoC; now reverted) |
| 3 | 2026-05-25 03:53:28 | `codex` (cc-suite reviewer) | x64 (under Rosetta) | `--probe-case-box` |

### Conditions NOT observed

| Pattern | Observation |
|---|---|
| Direct shell invocation (`./lawbar --probe-case-box`) | Always PROBE_OK + clean exit; no crash. |
| Playwright Electron launch (WI-A smoke) | Never crashed since `65fd0cc`. |
| Dev mode `npm run dev` | Never crashed. |
| Normal launch from Finder / `open -a Lawbar` | Never observed to crash. |

### Why this passes tests sometimes

When the probe IIFE in `main.ts` runs:

```
process.argv.includes("--probe-case-box")
  → spawns async IIFE
    → await runCaseBoxProbe()
    → process.exit(0)
```

This races against Electron's main-process bootstrap, which runs synchronously below the IIFE:

```
app.setName(...)
ipcMain.handle(...)
nativeTheme.on(...)
app.whenReady().then(...)   ← AppKit init happens here, internally
```

`+[NSApplication sharedApplication]` is called by Electron's bootstrap somewhere during `app.whenReady`'s resolution. The IIFE's `process.exit(0)` USUALLY wins (probe completes in ~10-50 ms). When it loses, AppKit init's `_RegisterApplication` fails, abort fires, the process exits via SIGABRT, and stdout buffers are flushed BEFORE termination (sometimes). The test then sees:
- Most common: `code=0, stdout=PROBE_OK ...` — IIFE won.
- Race lost: `code=null, signal=SIGKILL` (because the 10s timeout fired during the post-abort cleanup) OR `code=134 (128+6), signal=null` (because abort exit code is 134).
- Either way the crash dialog is queued by macOS regardless of who wins the race, because the SIGABRT path ran AT LEAST partially.

The dialog is a USER-LEVEL signal, not a test-runner-level signal. Tests can pass while the user sees a crash dialog.

### Affected probes

| Probe | Mechanism | Affected? |
|---|---|---|
| `--probe-case-box` (existing WI-B Option A; main.ts:31) | raw spawn + IIFE-exit | YES — crashes 1 + 3 used it |
| `--probe-casebox-pkg-arch` (reverted PoC) | raw spawn + IIFE-exit | YES — crash 2 used it |
| WI-A Playwright packaged smoke | `electron.launch()` (GUI-context spawn) | NO observed crashes |
| Dev-mode Playwright smoke | `electron.launch()` (GUI-context spawn) | NO observed crashes |

**The crash class is the spawn-then-process.exit pattern from a non-GUI parent. Any new probe that uses the same pattern will inherit the same flakiness.**

## §4 — Evaluation criteria (each option scored 1-5; higher = better)

| # | Criterion | Description |
|---|---|---|
| C1 | **Crash resistance** | Does the mechanism reliably avoid the SIGABRT crash dialog when invoked by an automated test runner (Node `node --test` OR codex agent)? |
| C2 | **Signal strength** | Does the mechanism exercise the runtime behavior we need to verify (case-box-* imports load + execute inside packaged Electron Node ABI)? |
| C3 | **Production fidelity** | Does the test path resemble how an end-user will launch the .app, so we catch user-facing regressions? |
| C4 | **Test-runner integration** | Does the mechanism integrate with `node --test` (current test runner) cleanly? Can result + exit code propagate? |
| C5 | **CI compatibility** | Does the mechanism work on a headless CI runner (no logged-in user, no Aqua session)? macOS GitHub Actions runners often have specific GUI constraints. |
| C6 | **Implementation complexity** | How much new code? How many files? How many concepts? |
| C7 | **Maintenance burden** | How fragile is the mechanism to Electron version bumps / Node version bumps / macOS version bumps? |
| C8 | **Hard-stop compliance** | Does the mechanism avoid `Info.plist` mutation, `LSUIElement`, `LSBackgroundOnly`, crash-dialog suppression, or any of the lane's forbidden actions? |

Each option scored 1-5 (higher = better). Total out of 40.

## §5 — Option 1: Non-Electron Node-side package topology verification

### Description

Verify the package architecture WITHOUT spawning the packaged Electron .app at all. The test suite asserts:
- `apps/lawbar-desktop/node_modules/case-box-persistence/package.json` carries the staged manifest (rewrites applied; no `file:`).
- `apps/lawbar-desktop/node_modules/case-box-contract/dist/index.js` exists.
- `apps/lawbar-desktop/package-lock.json` records integrity hashes for both internal packages.
- ASAR contents (via `node_modules/.bin/asar list`) include the expected JS paths.
- Recursive symlink scan over packaged `.app/Contents/Resources/` finds no escapes or dangling.
- `import { validateMatter } from "case-box-contract"` resolves AT THE NODE LEVEL (test runs `node -e "..."` from inside `apps/lawbar-desktop/` and confirms the import succeeds).

### Pros

- Cannot crash because Electron is never spawned.
- Pure-Node test runner integration is trivial.
- Hermetic; works in any CI environment.

### Cons (decisive)

- **DOES NOT VERIFY** that the imports load inside Electron's Node ABI. The Electron Node ABI is different from system Node (`node_modules` is rebuilt by `@electron/rebuild` for Electron's V8/Node version); a native dep that works under Node may fail under Electron. The package architecture's stated goal is "case-box-* JS loads inside packaged Electron"; this option leaves that unverified.
- **DOES NOT VERIFY** ASAR pack/unpack semantics at runtime — only structural inspection.
- **DOES NOT VERIFY** Electron's module resolution path for the bundled `node_modules`.

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Crash resistance | **5** | No Electron spawn at all. |
| C2 Signal strength | **2** | Misses Electron Node ABI + runtime resolution. |
| C3 Production fidelity | 1 | Tests do not resemble user launch. |
| C4 Test runner integration | 5 | Pure Node. |
| C5 CI compatibility | 5 | Trivial. |
| C6 Complexity | 5 | Minimal. |
| C7 Maintenance | 5 | No Electron-version dependency. |
| C8 Hard-stop compliance | 5 | No Info.plist; no GUI behavior change. |
| **TOTAL** | **33/40** | Strong on safety, weak on signal — fails the load-bearing C2 + C3. |

## §6 — Option 2: Playwright Electron launch with renderer-/main-IPC-observable health signal

### Description

Launch the packaged .app via Playwright's `electron.launch({ executablePath, args: [...] })` — the SAME mechanism the existing WI-A packaged smoke uses successfully. Two sub-patterns within this option:

**2a — Main-process probe via `app.evaluate`**:
The test launches the .app via Playwright, then uses `app.evaluate(({ app }) => { ... })` to run probe code INSIDE the main process. Probe imports `case-box-persistence` + `case-box-contract`, calls `validateMatter` + `createMatter`, returns the result envelope to the test runner. No `--probe-*` flag needed; no `process.exit` from the .app side; Playwright handles teardown.

**2b — Renderer-process probe via IPC**:
The test launches the .app, opens the first renderer (the existing 12-panel theme view), then injects probe code into the renderer via `page.evaluate`. The renderer calls `window.lawbar.caseBox.<op>` (which does NOT exist yet — requires the IPC layer that was the original goal of `WI-casebox-ipc-contract-impl`). Chicken-and-egg: this verification requires the very layer it is verifying.

**Plan picks 2a.** It exercises the production code path that DOES exist today and is the path most relevant to the package-architecture question (does case-box-* load inside Electron's main process?).

### Pros

- Reuses WI-A's working pattern (`electron.launch` is the GUI-context spawn that WindowServer registration succeeds for in observed runs). NOTE per rev-1 L: Playwright is a **test-harness equivalent**, NOT the exact user-launch path. A real user launches the .app via Finder / `open -a` / Dock click — that's a LaunchServices invocation, which is what Option 4 uses. Playwright's `electron.launch` spawns the binary directly via the Chromium driver, which approximates LaunchServices behavior but is not literally the same call. Acceptable for a verification harness because the QUESTION ("does the .app's main process load case-box-* runtime?") is identical regardless of which spawn mechanism. Not acceptable for "does the user's launch experience match production?" — that would require Option 4 or a real GUI test.
- No `--probe-*` flag handler needed in main.ts (probe code lives in the test; main.ts stays unchanged).
- `app.evaluate` returns a serializable value to the test runner — no file-based handoff, no polling.
- Test integration with `node --test` is identical to existing WI-A smoke (uses the same Playwright Electron API).
- The .app launches and quits via Playwright's teardown; no manual `process.exit`; no race against AppKit init.
- Tier 1 FileVault enforcement is naturally tested as part of the launch path (`LAWBAR_MODE=dev` keeps it permissive).

### Cons

- Playwright Electron's `app.evaluate` runs code in the main process AFTER `app.whenReady` resolves. This means the FileVault decision + `createWindow` will have run before the probe code executes. That's actually FINE for verification (we want to know the .app fully booted, not just the first 10 ms), but it means probe wall-clock time goes from ~50 ms (current pattern) to several hundred ms (full Electron init).
- Playwright requires the .app to actually display a window (briefly). Headless CI environments may need `LAWBAR_MODE=dev` + access to a virtual display. macOS GitHub Actions runners CAN do this (current WI-A smoke passes there per the assumed CI matrix; verify before promoting plan).
- The probe code lives in the test, not in the .app — the production binary does not carry an `app.evaluate`-shaped surface. This means we cannot exercise probes from a non-test context. (Acceptable — the probe is a test-time verification, not a user-facing feature.)

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Crash resistance | **3** (rev-1 per M1; was 5) | Playwright packaged-launch (`electron.launch({executablePath, args:[]})`) has been crash-free across WI-A test runs observed since `65fd0cc`. `app.evaluate` runs ONLY AFTER launch completes successfully — it cannot observe AppKit-init crashes that occur BEFORE launch completion. Whether the launch mechanism itself avoids the crash class categorically is UNVERIFIED until §11 evidence runs. Score reflects "probably safe based on WI-A precedent" not "proven safe". |
| C2 Signal strength | **5** | Exercises Electron Node ABI + runtime resolution + ASAR + native deps. |
| C3 Production fidelity | **4** (rev-2 per M; was 5) | Playwright's `electron.launch` spawns the packaged binary via the Chromium driver — closer to user launch than raw `child_process.spawn`, but NOT the exact LaunchServices path. Real user launch goes through `open` / Finder (LaunchServices). FileVault enforcement path DOES run. NOT the literal user-launch mechanism; production-fidelity is strictly lower than Option 4's `open -a`. Lowered to match rev-1 prose at §6 ("test-harness equivalent, NOT exact user-launch equivalent"). |
| C4 Test runner integration | 4 | `app.evaluate` returns a serializable value; the test reads it like a normal assertion. |
| C5 CI compatibility | 4 | macOS CI runners can run Playwright Electron (WI-A precedent). Headless Linux CI would need Xvfb + non-darwin platform exclusion. |
| C6 Complexity | 4 | New test file (~120 LOC) using existing exports / direct test imports only. **NO package API/export changes** (rev-2 per L1 — matches §15 no-public-API-change claim). No new packaging mechanism. |
| C7 Maintenance | 4 | Playwright pins to Electron version 34.x; future Electron 35+ may need a Playwright bump. Established pattern. |
| C8 Hard-stop compliance | 5 | No Info.plist; no LSUIElement; no crash-dialog suppression. |
| **TOTAL** | **33/40** (rev-2; C3 lowered 5→4 per M) | TIED with Option 1 at 33. Tie-break per rev-2 M: Option 2 wins on C2 signal strength (Option 2 = 5; Option 1 = 2; gap of 3 on the load-bearing criterion — Option 2 actually EXERCISES the packaged runtime while Option 1 only inspects filesystem). See §10 recommendation rationale + tie-break note. |

## §7 — Option 3: Separate CLI helper outside Electron

### Description

A small Node CLI (`apps/lawbar-desktop/scripts/verify-pkg-arch.mjs`, ~80 LOC) imports `case-box-persistence` + `case-box-contract` directly from `apps/lawbar-desktop/node_modules/` (post `npm install`) and runs `validateMatter` + `createMatter`. The CLI is invoked via `node` (system Node, not Electron's Node). The test asserts the CLI exits 0 with the expected output.

### Pros

- No Electron involved → no crash class.
- Simple Node script; easy to maintain.
- Hermetic.

### Cons (decisive)

- **Does NOT verify the packaged Electron Node ABI compatibility** — the CLI uses system Node, not Electron's bundled Node. native deps work under both, but ABI surface differs.
- **Does NOT verify ASAR packaging.** The CLI reads source files directly, not from the .app's `app.asar`.
- **Does NOT verify electron-builder's `install-app-deps` rebuild** of native modules for Electron ABI.
- Same load-bearing weaknesses as Option 1, just packaged as a Node script instead of an inline test.

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Crash resistance | 5 | No Electron. |
| C2 Signal strength | 2 | Same gap as Option 1. |
| C3 Production fidelity | 1 | Not a user path. |
| C4 Test runner integration | 5 | Node CLI; easy. |
| C5 CI compatibility | 5 | Trivial. |
| C6 Complexity | 4 | One small file. |
| C7 Maintenance | 5 | Low. |
| C8 Hard-stop compliance | 5 | None triggered. |
| **TOTAL** | **32/40** | Fails C2 + C3 like Option 1; offers nothing over Option 1 except a separately-runnable script. |

## §8 — Option 4: Launch via `open -a` or AppleScript

### Description

Use macOS LaunchServices to spawn the .app like a user would: `open -a /path/to/lawbar.app --args --probe-...`. LaunchServices handles the WindowServer registration handshake correctly (this is the SAME path Finder uses, and Finder-launched .apps never hit the SIGABRT). The probe IIFE in main.ts runs as before, but `_RegisterApplication` succeeds because LaunchServices set up the right state.

Result handoff via a known file path:
- Test deletes the result file at a temp path.
- Test runs `open -a <bundle> --args --probe-... --result-file=/tmp/lawbar-probe-result.json`.
- `open` returns immediately (the .app runs detached).
- Test polls the result file for up to N seconds.
- Test reads the JSON; asserts.

### Pros

- Uses macOS LaunchServices — the user-equivalent launch path. WindowServer registration succeeds.
- No Playwright dep (already there, but option avoids it).
- No `electron.launch` API dependency; survives Playwright version bumps.

### Cons

- **Result handoff is file-based polling, not synchronous.** Polling has timing budget concerns; flaky if a slow probe runs against a CI's I/O.
- **macOS-only.** `open` is darwin-specific; `xdg-open` on Linux behaves differently. Cross-platform CI matrix would need a per-platform launch helper.
- **LaunchServices may show the .app's Dock icon briefly.** Acceptable but cosmetically visible.
- **`open --args` quirks**: arguments pass-through is unreliable across macOS versions; some args get stripped. Documentation says to use `--args` but field experience varies.
- **Race against `open`'s detachment**: if the .app dies before the result file is created, the test sees a missing file with no diagnostic; need to also catch the .app's stderr (via separate spawn) for debugging.

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Crash resistance | **4** | LaunchServices should fix the registration race. UNVERIFIED in this environment; would need a PoC. |
| C2 Signal strength | 4 | Exercises Electron Node ABI + ASAR. Same probe semantics as the reverted PoC. |
| C3 Production fidelity | 5 (rev-1 L acknowledged) | **Exact user-launch path** — `open -a` IS the LaunchServices call that Finder + Dock + user-typed `open` use. Strictly more production-fidelity than Option 2's Playwright `electron.launch` (which is a test-harness approximation). The plan still recommends Option 2 because Option 4's polling + per-platform divergence costs more than the marginal C3 gain. |
| C4 Test runner integration | 2 | File polling + per-platform helper; more complex than synchronous APIs. |
| C5 CI compatibility | 3 | macOS CI: ok. Linux CI: needs different path entirely. |
| C6 Complexity | 3 | New polling helper + result-file convention. |
| C7 Maintenance | 3 | `open --args` semantics vary; fragile to macOS version drift. |
| C8 Hard-stop compliance | 5 | No Info.plist; no LSUIElement. |
| **TOTAL** | **29/40** | Right intuition; expensive integration cost; per-platform divergence. |

## §9 — Option 5: Test-only `Info.plist` variant with `LSUIElement` or `LSBackgroundOnly`

### Description

Add `LSUIElement: true` (background-only / no-Dock-icon) OR `LSBackgroundOnly: true` to a SEPARATE electron-builder build configuration used ONLY for the test path. Production .app keeps the default (foreground app with Dock icon + menu bar). The test-only .app does NOT register with WindowServer the same way; `_RegisterApplication` succeeds (or is skipped); SIGABRT does not fire.

### Pros (in theory)

- Crashes go away.
- Tests can spawn the test-only .app via raw `spawn` without GUI-context concerns.

### Cons (decisive — disqualifying)

- **EXPLICITLY FORBIDDEN BY THIS LANE'S HARD-STOP LIST.** User said: "Do not alter Info.plist. Do not add LSUIElement or LSBackgroundOnly. Do not suppress crash dialogs as a quick fix."
- electron-builder doesn't easily support per-target Info.plist diffs (requires either two complete configurations or post-build script).
- Adds an OS-behavior divergence between test and production binaries (the very thing the test is supposed to catch).
- LSUIElement / LSBackgroundOnly change Dock + menu bar behavior; the production .app needs the full Aqua launch path; the test .app's behavior would diverge from user-facing reality.
- A successful test against a background-only .app does NOT prove the foreground .app works (the very behavior of `_RegisterApplication` differs between the two LSUIElement states).

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Crash resistance | 5 | (in principle) |
| C2 Signal strength | 2 | Test .app diverges from production. |
| C3 Production fidelity | 1 | Two-target divergence. |
| C4 Test runner integration | 4 | Raw spawn works. |
| C5 CI compatibility | 5 | Background apps spawn anywhere. |
| C6 Complexity | 2 | Two electron-builder configs OR post-build script. |
| C7 Maintenance | 2 | Drift risk between the two .app variants. |
| C8 Hard-stop compliance | **0** | **EXPLICITLY FORBIDDEN.** |
| **TOTAL** | **21/40** | Hard-stop violation; rejected on rule alone. Listed for completeness. |

## §10 — Recommendation: Option 2a (Playwright Electron + `app.evaluate` main-process probe)

> **rev-3.1 SUPERSESSION** — Option 2a is CONDITIONAL on TWO independent blockers, not one. Reading rev-2 §10 as the active recommendation requires accepting BOTH gates:
> 1. **Crash-detection clearance** — §24 wrapper lands AND §25 Class B reproduction either passes Outcome A (zero attributable .ips in ≥50 sequential WI-A runs through the wrapper) or escalates to Outcome B's launch-mechanism re-review.
> 2. **ESM-compatible evidence-2 mechanism** — the rev-2 §11 evidence-2 better-sqlite3 round-trip via `app.evaluate` was falsified by the aborted impl (ESM Electron main process has no `globalThis.require`; `process.mainModule` is undefined; dynamic `import()` inside `app.evaluate` fails with "A dynamic import callback was not specified"). Option 2a CANNOT supply the rev-2 §11 evidence-2 signal until a separately reviewed mechanism replaces the round-trip. This is a §26 WI-3 plan gate (see §26 note).
>
> If either gate fails, Option 2a is REJECTED and the lane returns here for re-evaluation against Option 1 / Option 4. Recommendation text below is preserved for history.

### Score summary

| Option | Total | Decisive blocker |
|---|---:|---|
| 1 — Filesystem-only | 33 | C2 + C3 weak (no Electron runtime exercise) |
| **2 — Playwright `app.evaluate`** | **33** (rev-2; C3 5→4 per M; rev-1 C1 5→3 per M1) | TIED with Option 1; tie-break = C2 signal strength (Option 2=5 vs Option 1=2 — gap of 3 on the load-bearing criterion). C1 conditional on §11 evidence. |
| 3 — CLI outside Electron | 32 | Same as Option 1 + nothing extra |
| 4 — `open -a` + result file | 29 | Per-platform divergence; polling complexity |
| 5 — Info.plist variant | 21 | Hard-stop violation |

### Why Option 2a

1. **Playwright packaged-launch safety (precedent, not proof — rev-1 per M1).** Playwright's `electron.launch({executablePath, args:[]})` mechanism has been crash-free across WI-A packaged-smoke runs observed since `65fd0cc`. The launch mechanism is plausibly correct on the WindowServer registration handshake (same path WI-A uses without ever crashing in observed runs). **`app.evaluate` runs ONLY AFTER launch completes — it cannot observe AppKit-init crashes that occur BEFORE launch completion.** The actual safety against the crash class is UNVERIFIED until §11 evidence runs; this point is "probably safe based on WI-A precedent" not "categorically safe."
2. **Signal strength preserved.** `app.evaluate` runs probe code inside the production main process. It exercises Electron Node ABI, ASAR module resolution, native-dep rebuild, the entire packaging stack — exactly what the package architecture needs to verify.
3. **Reuses existing infrastructure.** Playwright is already a `devDependency`. The pattern is established in `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs`. No new tool, no new convention.
4. **No production-binary changes.** No `--probe-*` flag handler, no `Info.plist` change, no LSUIElement, no main.ts mutation. The probe lives entirely in the test file.
5. **Hard-stop compliant.** Avoids all forbidden actions.
6. **Tie-break vs Option 1 (rev-2 per M)**: after rev-2 lowered Option 2's C3 from 5 to 4, both Option 2 and Option 1 score 33/40. Option 2 wins the tie on **C2 signal strength** — the load-bearing criterion. Option 1 = 2 (filesystem inspection only; does NOT exercise Electron Node ABI or runtime module resolution); Option 2 = 5 (actually runs case-box-* runtime inside the packaged main process via `app.evaluate`). The 3-point C2 gap is the reason the PoC needs to exist at all — verifying the packaging topology requires runtime execution, not just static inspection. A reviewer who weights C3 (production fidelity / user-launch equivalence) higher than C2 (signal strength) would push for Option 4 (`open -a`, scores 29 with C3=5); Option 4 is rejected because its file-polling complexity + per-platform divergence (C4 + C5 + C6 costs) outweigh the marginal C3 gain on a single-platform v1 with a single CI target.

### Trade-off acknowledged

The probe wall-clock time increases from ~50 ms (current process.exit-before-window pattern) to ~1-3 seconds (full Electron init + window open + `app.evaluate` round trip + teardown). This is paid in CI runtime cost. Acceptable: the WI-A smoke already pays this cost for the 3 existing packaged tests; one more test in the same file adds <5 seconds.

A reviewer who weights wall-clock probe time higher might prefer Option 1 (filesystem-only) for its sub-second runtime. The plan rejects that because the C2 signal gap is the LOAD-BEARING reason the PoC exists at all.

### What this rules in / out for the production binary

- **NO `--probe-*` flag handlers added.** The probe is test-only via `app.evaluate`.
- **The existing `--probe-case-box` flag handler at main.ts:31 STAYS in place** for the moment (it has Tier 1 + WI-B precedent; removing it is a separate decision per §13 below).
- **No `Info.plist` mutation, no LSUIElement, no LSBackgroundOnly.**

## §11 — Evidence required before reviving the tarball PoC

The tarball PoC (now reverted at `ace57a0`) may be re-attempted ONLY AFTER all of the following are demonstrated by a NEW separately-authorized verification WI:

| # | Evidence | Acceptance check |
|---|---|---|
| **PERMANENT — rev-3 SUPERSEDED — see §24** (rev-1 per M2; rev-2 polling window per L2; rev-2 retry isolation note per L) | **rev-3 FALSIFIED**: the 1000ms polling design below failed to catch the 2026-05-25 11:04:05 Class B SIGSEGV (.ips written ~3s post-exit, outside the polling window). The fail-closed mechanism is REDEFINED in §24 (post-suite settle-scan wrapper + pid-correlation). The text below is kept as historical record. Original rev-2 row: **Crash-report watchdog as a permanent assertion** | EVERY packaged verification test (existing WI-A + the new verification PoC + any future packaged test) MUST snapshot `ls ~/Library/Logs/DiagnosticReports/lawbar*.ips` BEFORE the test runs. After the .app process exits, the watchdog enters a **bounded post-launch polling window of up to 1000ms (sampling every 250ms)** before taking the post-snapshot, because macOS may write the `.ips` crash report slightly after process termination (the kernel's CrashReporter writes asynchronously). The test FAILS if at ANY point in the polling window the post-snapshot has MORE entries than the pre-snapshot. The 500-1000ms window is empirically chosen to cover observed `.ips` write latency; tune up if false negatives appear. Implemented as a shared helper in `tests/_crash-watchdog.mjs` (~50 LOC; ~30 + ~20 for the polling); every packaged-binary test wraps its body with `withCrashWatchdog(async () => {...})`. The watchdog is the PROOF; the per-test pass is the SIGNAL. **Operational constraint (rev-2 retry L)**: the watchdog uses an mtime + bundle-id filter that CAN misattribute concurrent unrelated `lawbar` runs (e.g. a developer's parallel `npm run dev` session, or a stale dev launch leaving a delayed `.ips` write). Evidence runs MUST occur with NO parallel lawbar packaged/dev launches; CI should run in a clean user/session if available. Parent-pid correlation would tighten the attribution but is not worth blocking on — `.ips` files do not carry the test runner's pid; macOS does not expose a guaranteed parent-pid handshake for crash reports. Document the constraint in the WI #1 README/test header. |
| 1 | Playwright `app.evaluate` pattern works against the existing dist/ .app — **confidence evidence, not proof** (rev-1 per M2) | A 1-test smoke (new test file or addition to `smoke.packaged.electron.test.mjs`) that launches the existing packaged .app via `electron.launch` + uses `app.evaluate` to read `process.versions.electron` (or another trivial main-process value) + asserts. Wrapped in the permanent crash-watchdog. Optional confidence-level loop: 50 iterations (or 200) with zero crash-report-count growth. The loop is confidence evidence; the permanent watchdog (above) is the categorical defence. |
| 2 | `app.evaluate` can resolve a runtime import of an `apps/lawbar-desktop` dependency — **full WI-B round-trip** (rev-1 per L) | The probe inside `app.evaluate` performs the FULL WI-B-style better-sqlite3 round-trip: (a) `import Database from "better-sqlite3"`; (b) `fs.mkdtempSync` an isolated temp dir; (c) `new Database(path.join(tempDir, "probe.db"))` opens an on-disk SQLite; (d) `db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)")`; (e) `db.prepare("INSERT INTO probe (id, value) VALUES (?, ?)").run(1, "probe-value")`; (f) `db.prepare("SELECT id, value FROM probe WHERE id = ?").get(1)` returns the inserted row with `id === 1 && value === "probe-value"`; (g) `db.close()`; (h) `fs.rmSync(tempDir, {recursive: true, force: true})`. **NO thin metadata checks like `Database.prototype.name`** (the rev-0 evidence-2 wording was too weak). Wrapped in the permanent crash-watchdog. |
| 3 | The WI-A existing packaged smoke remains 3/3 GREEN with no new crash reports during the verification WI. | Regression-safe. The WI-A tests gain the permanent crash-watchdog wrapper too. |
| 4 | The existing `--probe-case-box` flag handler + `test:probe` script + WI-B smoke are NOT invoked at any point during the evidence WI's test runs. | Interim rule per M3: the evidence WI's `package.json` test-script invocations explicitly exclude `test:probe`. A grep test asserts no `--probe-case-box` argument appears in any of the evidence WI's spawn invocations. This prevents the fragile probe from generating crash dialogs WHILE the new mechanism is being proved out. |
| 5 | A dev-memo records the verification-WI's outcome with the standard cc-suite recording (11 fields). | Per `.claude/rules/cc-suite.md` §"Required recording". |

Once evidence steps PERMANENT + 1-5 are demonstrated AND the verification WI lands, the tarball PoC can be re-planned with `app.evaluate` + the permanent crash-watchdog as the probe + assertion mechanism (replacing the reverted `--probe-casebox-pkg-arch` flag pattern). The re-planned PoC plan would be a fresh `dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md`, NOT an amendment of the now-stale `00.md`.

## §12 — Disposition of existing `--probe-case-box` (WI-B Option A) smoke

The existing flag + smoke + source (commit `c708ece`) IS affected by the same crash class. Three options:

### A — Retire it (recommended)

Delete:
- The `--probe-case-box` handler in `electron/main.ts` (lines 31-42).
- The whenReady short-circuit `if (process.argv.includes("--probe-case-box")) return;` (line 115).
- `apps/lawbar-desktop/src/probes/caseBoxProbe.ts`.
- `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs`.
- The `test:probe` script in `package.json`.

Re-implement the equivalent verification (better-sqlite3 native binding loads under Electron Node ABI) using the new Playwright `app.evaluate` pattern in a NEW test added to `smoke.packaged.electron.test.mjs`. Net code change: similar LOC; net flakiness: zero.

Cost: ~150 LOC removed + ~80 LOC added in WI-A's test file.

### B — Quarantine it

Leave the source code in place but rename the test file to `smoke.native-module.electron.test.mjs.skip` (or move to `tests/quarantine/`). Add a banner to main.ts above the probe handler: "DO NOT use this flag in CI; spawn-then-process.exit is a known macOS crash pattern. See dev-memo/rollback-ace57a0-pkg-arch-poc.md."

Cost: 1 file rename + 5-line comment. Defers the cleanup but does not solve the dead-code accumulation.

### C — Leave it in place + document

No code change. Add a banner comment to the existing probe handler + smoke test referencing the crash pattern. CI keeps running it; the dialog stays a known intermittent.

Cost: 2 comment additions. Bad option: CI keeps generating crash dialogs.

### Recommendation: **Option A (retire it) — DEFERRED to its own separate WI** (rev-1 per M3)

Retire is the right endpoint, but the retirement DOES NOT happen in the same WI that builds the Playwright `app.evaluate` pattern. rev-1 reconciles the prior conflict between §12 (single-WI in rev-0) and §13 (split into two WIs):

- **Evidence WI first** (`WI-pkg-verify-playwright-evaluate-poc`): builds the `app.evaluate` pattern + permanent crash-watchdog + full better-sqlite3 round-trip probe + verifies the WI-A regression remains green. The `--probe-case-box` handler stays in place; the WI-B smoke is INTERIM-EXCLUDED from this WI's test runs (per §11 evidence step 4: `test:probe` NOT invoked during evidence-WI runs).
- **Retire WI second** (`WI-retire-probe-case-box`): only AFTER the evidence WI proves the replacement mechanism works on this hardware/CI, the retire WI lands: deletes the `--probe-case-box` flag handler, source, smoke test, and `test:probe` script.

The sequence-of-two-WIs guarantees that the fragile probe stays unused (no crash dialogs) during the proof-of-concept while still being available as a fallback if the evidence WI fails. The interim rule (`test:probe` NOT invoked during evidence WI) is non-negotiable per M3.

If the user prefers Option B or C, the recommendation is reversible per a separate authorization; the rest of THIS plan does not depend on the choice.

## §13 — Follow-up WIs (proposed sequence)

1. **WI-pkg-verify-playwright-evaluate-poc** (rev-1 — first; canonical-split per M3) — implement the Playwright `app.evaluate` pattern per §6 + §11. Adds the PERMANENT crash-report watchdog helper (`tests/_crash-watchdog.mjs`) wired into every packaged-binary test. Adds 1 test file (or 1 test in existing `smoke.packaged.electron.test.mjs`) that proves `app.evaluate` works for a trivial main-process value + performs the FULL WI-B better-sqlite3 round-trip (per §11 evidence-2 strengthened). **INTERIM RULE per M3**: this WI's test-script invocations explicitly EXCLUDE `test:probe`; the `--probe-case-box` flag handler in main.ts STAYS in place (untouched) for the duration of this WI; the WI-A regression suite gains the permanent crash-watchdog wrapper too. Includes optional 50-run-or-200-run confidence loop (confidence evidence, NOT proof).
2. **WI-retire-probe-case-box** (rev-1 — second; only after WI #1 lands and is verified) — per §12 Option A: delete the `--probe-case-box` flag handler in `electron/main.ts` (lines 31-42 + the whenReady guard at line 115), `apps/lawbar-desktop/src/probes/caseBoxProbe.ts`, `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs`, the `test:probe` script in `package.json`. The replacement coverage was already added by WI #1 (better-sqlite3 round-trip via `app.evaluate`). Cannot run before WI #1 is verified READY. **Equivalence-of-coverage acceptance check (rev-2 retry L1; non-blocking but recommended)**: before retirement, demonstrate that WI #1's `app.evaluate` probe imports AND executes the same packaged `better-sqlite3` native-module path formerly covered by `--probe-case-box` (`apps/lawbar-desktop/src/probes/caseBoxProbe.ts` round-trip: open temp → CREATE TABLE → INSERT → SELECT → close → rmSync). If the replacement intentionally has narrower coverage (e.g. no longer testing temp-DB cleanup), record the delta in this WI's commit message before deleting the old probe — do NOT silently lose invariants. |
3. **WI-revive-tarball-poc** — re-plan the tarball PoC per `dev-memo/plan-desktop-package-architecture-00.md` Option 2 architecture but with `app.evaluate` verification mechanism. NEW plan file at `dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` (NOT amending `-00.md`). Requires its own cc-suite review-plan + audit + verify chain.
4. **REVIVE WI-casebox-ipc-contract-impl planning** — once the tarball PoC verification works, amend the STOPPED `dev-memo/plan-casebox-ipc-impl-00.md` to reference the working verification pattern.

## §14 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High → CRITICAL rev-3** (rev-1 per M1 — scope corrected; rev-3 escalates after 11:04 SIGSEGV-at-shutdown observation) | Playwright packaged-launch (`electron.launch({executablePath, args:[]})`) safety across REPEATED RUNS is unverified for the crash class. **rev-3 update**: a NEW Class B SIGSEGV-at-shutdown crash (§22) has now been observed once during `electronApp.close()` of a Playwright-launched packaged .app. Class B is structurally different from Class A; mitigation requires the §24 redesign + §25 reproduction analysis. Until §25 completes, Option 2a's C1 score is empirically reduced and may invalidate the recommendation if Class B reproduces ≥1× per 50 runs. The WI-A precedent is observational, not categorical. **`app.evaluate` is downstream of the AppKit-init crash point** — it runs only AFTER launch completes successfully, so it cannot observe AppKit-init crashes. The risk is in the LAUNCH itself across many iterations, not in `app.evaluate`. The crash class (HIToolbox `_RegisterApplication` abort during early NSApplication init) may or may not be triggered by Playwright's launch path; observational absence in WI-A's small sample is not proof. | §11 evidence step (rev-1: permanent crash-report watchdog) is the load-bearing defence — every packaged verification test snapshots `~/Library/Logs/DiagnosticReports/lawbar*.ips` pre/post and FAILS if it grew. The repeated-run loop is **confidence evidence only, not proof** (rev-1 per M2). If new crash reports appear during ANY verification test run, the recommendation is INVALIDATED and the lane returns here for re-evaluation; Options 1 + 4 become candidates. |
| **Medium** | The 50-run loop might miss a 1-in-1000 crash. Even one user-visible dialog defeats the purpose. | Acceptance threshold for evidence-1 is `0 crashes in 50 runs`. If a single crash occurs, the loop count escalates to 200, and if STILL non-zero, recommendation is invalidated. |
| **Medium** | Playwright Electron pins to a specific Electron major version range. Future Electron 35+ may not be supported by current Playwright; upgrade order matters. | Document the Playwright/Electron pin compatibility check as a precondition of any future Electron version bump. Out of v1 scope. |
| **Medium** | Crash-report watchdog (snapshot `ls -t` before + after) may have false positives if another lawbar process (e.g. user's dev session) creates a report during the test window. | Filter by exact timestamp + bundle id; require strict-greater-than. Document as a known false-positive mode. |
| **Low** | The WI-A pattern uses `electron.launch({executablePath, args:[]})` — no `--probe-*` flag. The new test will use `electron.launch` similarly. Branch coverage for the `--probe-*`-flag code path inside main.ts goes to ZERO once `WI-retire-probe-case-box` lands. | That IS the intent. The flag was always a workaround; removing it is correct. |
| **Low** | The crash-report file format (`.ips` JSON-line) may change in a future macOS version. The watchdog only counts files, not parses them, so format changes don't break the count-based check. | Acceptable resilience. |

No Critical risks. If reviewer disagrees, the H1 unverified-Playwright-evaluate-safety is the most likely escalation candidate.

## §15 — Hard stops

This plan does NOT trigger any hard-stop in `.claude/rules/autonomy.md` §"Hard-stop list":
- No push, deploy, release, production, migration, auth provider, cloud vendor, public exposure.
- No new runtime dependency (Playwright Electron is already a devDep; not adding anything).
- No public API change.
- No schema change.
- No secrets / credentials / billing.
- **NO `Info.plist` mutation, NO `LSUIElement`, NO `LSBackgroundOnly`, NO crash-dialog suppression** — Option 5 was explicitly considered and rejected on hard-stop grounds.
- NO IPC implementation. NO product UI. NO real case data. NO Tier 2.

The plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it defines a packaging-verification topology decision and supersedes a known-failure pattern. Therefore `/cc-suite:review-plan` is required.

## §16 — Review packet (compact)

**Active plan summary (rev-2)**: 5-option comparison for redesigning packaged-Electron verification after the tarball PoC's spawn-then-process.exit pattern hit macOS SIGABRT crashes. Recommends Option 2a (Playwright Electron + `app.evaluate` main-process probe; **33/40 rev-2** — was 34/40 in rev-1; was 36/40 originally. C1 lowered 5→3 per rev-1 M1 (Playwright packaged-launch safety UNVERIFIED, not categorical); C3 lowered 5→4 per rev-2 M (Playwright is test-harness equivalent, NOT exact user-launch). TIED with Option 1 at 33. **Tie-break per rev-2 M**: Option 2 wins on C2 signal strength (5 vs 2; gap of 3 on the load-bearing criterion — Option 2 EXERCISES packaged runtime, Option 1 only inspects filesystem)) because (a) Playwright's `electron.launch` packaged-launch has been crash-free across the existing WI-A packaged smoke in OBSERVED RUNS (NOT proven categorically — UNVERIFIED until §11 evidence runs per M1); (b) `app.evaluate` exercises the production code path (runs AFTER launch completes; cannot observe AppKit-init crashes that occur BEFORE launch completion); (c) reuses existing devDep; (d) no Info.plist mutation. The load-bearing defence is the PERMANENT crash-report watchdog wired into every packaged-binary test (snapshots `~/Library/Logs/DiagnosticReports/lawbar*.ips` pre/post and FAILS if it grew) — NOT the 50-run-loop, which is confidence evidence only (rev-1 per M2). Rejects Option 1 + 3 (filesystem-only / Node CLI) on C2 signal gap; Option 4 (`open -a`) on integration complexity + per-platform cost (acknowledged as strictly higher C3 production-fidelity than Playwright per rev-1 L); Option 5 (Info.plist variant) on hard-stop violation. Defines PERMANENT + 5-step evidence-before-revive (rev-1 per M2): permanent crash-watchdog + Playwright `app.evaluate` smoke + full WI-B-style better-sqlite3 round-trip (NOT thin metadata check per rev-1 L) + WI-A regression intact + interim rule that `test:probe` NOT invoked during evidence WI + dev-memo recording. Sequencing canonical-split (rev-1 per M3): WI-pkg-verify-playwright-evaluate-poc FIRST; WI-retire-probe-case-box SECOND only after evidence WI READY.

**Exact target files (this plan)**:
- `dev-memo/plan-packaged-probe-verification-00.md` (new, this file).

**Exact target files (eventual follow-up WIs; NOT this plan)**:
- See §13 — 4 follow-up WIs with distinct authorization paths.

**Exact acceptance criteria (eventual `WI-pkg-verify-playwright-evaluate-poc`)**: see §11 — 6 evidence checks.

**Exact out-of-scope list**:
- Any code implementation.
- Adding dependencies.
- Mutating `Info.plist`, `LSUIElement`, `LSBackgroundOnly`, crash-dialog suppression.
- IPC implementation restart.
- Product UI / case-box-aware screens.
- Real case data persistence.
- Tier 2 SQLCipher / Keychain.
- Auth provider / cloud sync / signing / notarization / distribution / telemetry.
- Workspace tool introduction.

**Essential references**:
- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` (commit `6afee88`; rollback record naming the 3 crash reports).
- `dev-memo/plan-desktop-package-architecture-00.md` (commit `e5cb773`; rev-3 READY; design authority for the topology; UNCHANGED).
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` (commit `018a9a9`; rev-2 READY; now-invalidated PoC plan).
- `apps/lawbar-desktop/electron/main.ts` HEAD `6afee88` (existing `--probe-case-box` handler at line 31).
- `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (WI-A precedent for Playwright Electron packaged spawning).
- `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs` (WI-B fragile probe to be retired).
- Apple TN2459 + Electron #15265 / #19541 (background reading on `_RegisterApplication` crash patterns on macOS).

**Review questions** (target the load-bearing assumptions):
1. Is the §6 §11 §14 H1 mitigation sound — does a 50-run Playwright `app.evaluate` loop genuinely cover the crash class? The 3 observed crashes all happened during a 30-minute window of test/audit activity (`03:50-03:53`); maybe 50 sequential launches in 1 minute would not stress the same scheduling races.
2. Is Option 2a's `app.evaluate` running INSIDE the main process after `app.whenReady` truly the right probe location, or should the probe ALSO test that main-process imports resolve BEFORE `app.whenReady` (i.e. at top-of-main.ts time)? The reverted PoC's probe ran at top-of-main; `app.evaluate` runs much later. Are there import paths that fail at top-of-main but pass after whenReady? Likely no, but worth confirming.
3. Is the §12 Option A recommendation (retire `--probe-case-box`) too aggressive? It removes a working dev-time invariant check (Tier 1 + WI-B regression coverage). The replacement via `app.evaluate` in WI-A's test file should preserve coverage, but reviewer may want explicit equivalence-of-coverage evidence in the WI plan.
4. Does the §11 evidence-3 crash-report watchdog correctly distinguish test-induced crashes from unrelated lawbar runs (e.g. user's separate dev session)? The mtime+bundle-id filter is a heuristic; ideally we'd correlate by parent pid, but `.ips` files don't carry the test runner's pid.
5. Is the §10 trade-off (1-3 seconds per probe vs 50ms today) acceptable given that the test:packaged suite already pays this for 3 tests? An aggressive CI runtime budget might push back here.

## §17 — LOC budget hints (for eventual WIs)

| WI | Est new LOC | Threshold |
|---|---|---|
| WI-pkg-verify-playwright-evaluate-poc | ~150 (test file with 50-run loop + watchdog) | 1200 test |
| WI-retire-probe-case-box | -250 (deletions) + 80 (replacement test) | n/a (deletions) |
| WI-revive-tarball-poc | ~600 across PoC plan + impl WI plan | n/a |
| WI-revive-ipc-impl-plan | doc only; amending existing plan | n/a |

All well within loc-guardian thresholds.

## §18 — Stop condition

This plan becomes stale when:
- `WI-pkg-verify-playwright-evaluate-poc` lands AND `WI-retire-probe-case-box` lands. After both: this plan is the as-built reference.
- Playwright Electron is replaced as the desktop test infrastructure. Triggers a new plan revision.
- The crash class re-surfaces despite the chosen mechanism. Lane returns here for re-evaluation.
- A NEWER electron-builder + Electron combination makes raw `child_process.spawn` of the .app safe. Then Option 4 becomes viable; revisit.

## §19 — Required cc-suite review

This plan is not authorized for promotion until:
1. `/cc-suite:review-plan dev-memo/plan-packaged-probe-verification-00.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The chosen Option 2a recommendation is not overridden without re-review.
4. Each follow-up WI in §13 requires its own `/cc-suite:review-plan`.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency across §3-§14 (crash class → option scoring → recommendation → evidence-before-revive).
- Consistency with the rollback record (`6afee88`) — does §3's crash class description match the rollback's reason field?
- Hard-stop compliance (§15 — Option 5 stays rejected; no Info.plist mutation under any circumstance).
- Realism of the §11 evidence-before-revive bar (50-run loop; crash-report watchdog).

---

## §20 — rev-3 amendment summary

**Trigger**: during `WI-pkg-verify-playwright-evaluate-poc` implementation attempt (no commit; aborted before audit), a new crash report appeared at `/Users/zhongyibao/Library/Logs/DiagnosticReports/lawbar-2026-05-25-110405.ips`. Stack: EXC_BAD_ACCESS / SIGSEGV in `v8::HandleScope::HandleScope` ← `v8::internal::ThreadIsolation::WriteProtectMemory` ← `-[NSWindow __close]` ← `-[NSApplication(NSResponder) sendAction:to:from:]` on CrBrowserMain / com.apple.main-thread. Crash captured 11:04:02.63; .ips file written 11:04:05 — ~3 seconds after the .app's process exited. The rev-2 PERMANENT 1000ms post-`app.close()` polling window DID NOT catch it (the file appeared after the watchdog's polling deadline expired; the test reported clean).

**Falsifications**:
- The rev-1 M2 / rev-2 L2 PERMANENT row (1000ms post-`app.close()` polling) is INSUFFICIENT for the late-shutdown crash class.
- The rev-2 §6 / §10 / §14-H1 claim "Playwright `electron.launch` has been crash-free across WI-A test runs" is FALSIFIED for the shutdown phase. Launch safety remains observationally plausible; shutdown safety is now actively in question.
- The WI-A `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` runs are now SUSPECT for Class B (see §25).

**Lane outcome (this turn)**: implementation aborted on user direction; all uncommitted WI files (`apps/lawbar-desktop/package.json` mod; `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` mod; two new test files) WITHDRAWN via explicit `git restore` + `rm`. NO new commits. This file is the only modified artifact this turn; it is now rev-3-DRAFT-PENDING-REVIEW.

**rev-3 scope (this amendment, doc-only)**:
- §21 — empirical falsification + crash report analysis.
- §22 — updated crash-class taxonomy (now TWO classes).
- §23 — evaluation of 6 alternative detection mechanisms (user-listed in this lane's authorization).
- §24 — recommended fail-closed mechanism (post-suite settle-scan wrapper + pid-correlation; replaces rev-2 PERMANENT).
- §25 — suspect-status analysis for prior `test:packaged` + WI-A smoke runs.
- §26 — updated follow-up WI sequence (rev-3).
- §27 — updated review packet (rev-3).
- §28 — required cc-suite review (rev-3).

## §21 — Empirical falsification: the 2026-05-25 11:04 crash report

### Report metadata (parsed from the .ips JSON header + body)
- Path: `/Users/zhongyibao/Library/Logs/DiagnosticReports/lawbar-2026-05-25-110405.ips`.
- File size: 79627 bytes (≈4× larger than the 3 prior Class A SIGABRT reports at 16-20 KB).
- `bundleID`: `io.lawbar.desktop`. `app_name`: `lawbar`. `app_version`: `0.1.0`. `build_version`: `0.1.0`.
- `bug_type`: 309. `os_version`: `macOS 15.6.1 (24G90)`. `modelCode`: `Mac14,2`. `cpuType`: ARM-64.
- `procLaunch`: `2026-05-25 11:04:01.6917 -0400`.
- `procStartAbsTime → procExitAbsTime` delta: ~0.7 seconds alive before SEGV.
- `captureTime`: `2026-05-25 11:04:02.6311 -0400` (kernel CrashReporter timestamp).
- File mtime: `2026-05-25 11:04:05` (file written ~2.4s after capture; ~3s after process exit).
- `pid`: 55008. `parentPid`: 54999. `parentProc`: `Exited process` (the Playwright driver shell, since gone).
- `coalitionName`: `com.apple.Terminal`. `responsibleProc`: `Terminal`.
- `procPath`: `/Users/USER/*/lawbar.app/Contents/MacOS/lawbar`.

### Exception signature
- `exception.type`: `EXC_BAD_ACCESS`.
- `exception.signal`: `SIGSEGV`.
- `exception.subtype`: `KERN_INVALID_ADDRESS at 0x000000000000f6fc`.
- `termination`: `{code: 11, namespace: SIGNAL, indicator: "Segmentation fault: 11", byProc: "exc handler"}`.
- `esr.description`: `(Data Abort) byte read Translation fault`.
- `faultingThread.name`: `CrBrowserMain`. `faultingThread.queue`: `com.apple.main-thread`. `faultingThread.triggered`: true.

### Crashed-thread stack (top frames, abridged)
- `v8::HandleScope::HandleScope(v8::Isolate*)` +12 — Electron Framework / V8.
- `v8::internal::ThreadIsolation::WriteProtectMemory(...)` ×2 — V8 page-permission manipulation.
- `v8::CodeEvent::GetComment()` +7124 — V8 internal (symbol resolution off; offset overshoots).
- `ares_threadsafety` +107236 — Electron internal (symbol mis-attribution due to large offset; actual function is inside Electron Framework).
- `__19-[NSWindow __close]_block_invoke` +148 — AppKit (block fires inside `__close`).
- `-[NSWindow __close]` +376 — AppKit window-close path.
- `-[NSApplication(NSResponder) sendAction:to:from:]` +560 — AppKit action dispatch.
- (further AppKit + Cocoa frames omitted).

### Mechanism (interpreted)
AppKit's `-[NSWindow __close]` posts a block on the main thread; the block dispatches a UI action that triggers Electron's shutdown handlers. Inside one of those handlers, Electron constructs a V8 `HandleScope` against an Isolate that is in the middle of teardown (V8's `ThreadIsolation::WriteProtectMemory` has already begun re-marking the page permissions). The HandleScope constructor performs a tagged-pointer read that lands in unmapped memory at address `0xf6fc` (small offset from null, consistent with reading from a freed/null Isolate handle). The thread aborts with SIGSEGV.

This is a teardown-race between AppKit's window-close path and V8's isolate teardown. The trigger appears to be Playwright's `electronApp.close()`, which sends a hard-quit to the .app's main process while the main process is still in orderly shutdown.

### Why the rev-2 PERMANENT watchdog did not catch it
The rev-2 design (rev-1 M2 + rev-2 L2) polls `~/Library/Logs/DiagnosticReports/` for ≤1000ms after `app.close()` returns, sampling every 250ms. The 11:04 .ips file was written **~3000ms after the process exited** (kernel ReportCrash daemon writes asynchronously; latency depends on system load). The watchdog finished its polling window and reported clean BEFORE the file landed; the test passed; the developer noticed the crash dialog OUT-OF-BAND.

The rev-2 design was empirically valid for the early-SIGABRT class (Class A — file written within ~100s of ms). It is structurally insufficient for the late-SIGSEGV class (Class B — file written ≥ ~3000ms after exit). The temporal assumption embedded in the 500-1000ms polling window does not generalize.

## §22 — Updated crash-class taxonomy

### Class A — early-launch SIGABRT in HIToolbox (described in rev-2 §3)
- Symptom: SIGABRT during `+[NSApplication sharedApplication]` / `_RegisterApplication`.
- Triggered by: raw `child_process.spawn` of packaged .app from non-GUI parent (Node test runner, codex agent).
- Affected probes: `--probe-case-box` (WI-B Option A), reverted `--probe-casebox-pkg-arch`.
- .ips arrival latency: near-instant (kernel writes within ~100s of ms).
- Caught by: rev-2 1000ms polling watchdog (sufficient for this class).
- Status: real; NOT solved.

### Class B — late-shutdown SIGSEGV in V8 / AppKit teardown (NEW; rev-3; mechanism INFERRED FROM N=1)
- Symptom (PROVEN by the 11:04 .ips): SIGSEGV / EXC_BAD_ACCESS / KERN_INVALID_ADDRESS in `v8::HandleScope::HandleScope` ← `v8::internal::ThreadIsolation::WriteProtectMemory` ← `-[NSWindow __close]` ← `-[NSApplication(NSResponder) sendAction:to:from:]`. Timing PROVEN: .ips written ~3 seconds after process exit.
- Trigger (INFERRED, not proven): Playwright `electronApp.close()` against a packaged .app that has a window open is the candidate trigger because the 11:04 run used that path. **NOT proven exclusive**: the same `-[NSWindow __close]` stack frame can be reached from a renderer-side `window.close()`, from `app.quit()`, or from any AppKit-driven shutdown that runs the same Cocoa action chain. Forced-quit during V8 isolate teardown is the broader hypothesis; `electronApp.close()` is one of several invocations that may produce it. May be Electron-version-specific (Electron 34.5.8 observed; not tested against other versions).
- Affected: Playwright `electron.launch` + `electronApp.close()` (the WI-A pattern AND the rev-2 recommended Option 2a pattern). Whether other launch+close pairings (Option 4 `open -a` + Cmd-Q; main-process `app.quit()`; renderer `window.close()` propagating to all windows) trigger the same teardown chain is UNVERIFIED.
- .ips arrival latency: ~3 seconds after process exit (single observation; population unknown — see §24 settle-window tuning).
- Caught by: nothing in the current test infrastructure. rev-2 1000ms watchdog is empirically insufficient.
- Status: observed once on 2026-05-25; reproducibility unknown; mechanism is INFERRED FROM N=1 and may be refined as §25 reproduction produces more data.

### Detection-relevant subclasses (rev-3.1)

These are NOT separate crash classes yet — there is too little evidence to declare them distinct. They ARE relevant to the detection mechanism's attribution model (§24):

- **Helper-process crashes** — Electron .apps on macOS spawn helper processes (renderer / GPU / network / utility). A crash in any helper writes its own `.ips` file with a DIFFERENT `pid` (and different `procName` — typically `lawbar Helper (Renderer)` / `lawbar Helper (GPU)` / `lawbar Helper (Network)`). pid-correlation against the recorded MAIN process pid alone would miss helper crashes; §24 must scan by `bundleInfo.CFBundleIdentifier` AND/OR `procPath` matching the .app bundle root so helper crashes are attributed.
- **Late ReportCrash emission** — Apple's ReportCrash daemon writes .ips files asynchronously; the 11:04 observation gives one data point at ~3s, but the population latency distribution is unknown. Long-tail latencies (e.g., ReportCrash CPU-starved under load) could exceed any chosen settle window. §24's `LAWBAR_TEST_SETTLE_SECONDS` configurability + the impl WI's measurement step are the mitigation; the threshold may rise as data accumulates.
- **Renderer process crashes during page navigation** — Distinct from teardown crashes. If a renderer crashes mid-test (not at shutdown), the .ips would be attributed to the helper-renderer process; same attribution requirement as above.
- **GPU process crashes during accelerated rendering** — Same shape; attribute via `procName` / bundle id.
- **Network / utility helper crashes** — Same shape.

### Implications
- The rev-2 §3 framing ("THE crash class is the spawn-then-process.exit pattern from a non-GUI parent") is incomplete. There are TWO distinct crash classes with different triggers, signatures, and .ips arrival latencies. A correct verification mechanism must catch BOTH plus the helper-process subclasses above.
- Class B has not been observed for `open -a` (rev-2 §8 Option 4) or for production-binary user-initiated quit. Class B trigger may or may not be specific to `electronApp.close()`; the §25 reproduction protocol must measure across multiple shutdown paths, not just `electronApp.close()`, to refine the inferred-from-N=1 mechanism.
- Class B's reproducibility is unknown. The 11:04 crash occurred during a SINGLE test run that also exercised `app.evaluate` heavily (test 1 + the now-skipped test 2 + the now-aborted test 3 confidence loop). Whether the SIGSEGV is deterministic, racy, environment-dependent, or `app.evaluate`-induced CANNOT be inferred from N=1.

## §23 — Crash-detection redesign: evaluation of 6 alternatives

User's authorization for this rev-3 lane listed 6 alternatives to evaluate. Each is scored against three new criteria appropriate to the late-shutdown class (rev-2 §4's C1-C8 still apply to the launch mechanism choice; D1-D3 are the NEW detection-side criteria):

- **D1 Late-crash coverage**: catches .ips files written ≥3 seconds after process exit.
- **D2 Fail-closed-ness**: the test outcome CANNOT report success while a matching crash report appears.
- **D3 Automation viability**: works inside CI + `node --test` exit semantics without manual steps.

### Alt #1 — Longer bounded polling window + filesystem settle check

Extend the in-test watchdog window from 1000ms to e.g. 30 seconds, with an inner "settle" check that requires the `DiagnosticReports` directory mtime to be stable for ≥3s before declaring clean.

- Pros: minimal code change; mechanically the same as rev-2 but with bigger numbers.
- Cons: 30s × test count is expensive (15+ tests × 30s = 7.5 minutes per suite); "settle" is a heuristic — a crash appearing at second 30 still beats it; ReportCrash latency depends on system load and can exceed 30s on contended CI runners; no actual guarantee.
- D1: 4 (covers most cases up to budget). D2: 2 (heuristic; not guaranteed). D3: 4 (fits in tests; just slow).
- Verdict: partial — heuristic settle is the weakness.

### Alt #2 — Crash-report directory event watching (`fs.watch` / FSEvents)

Open `fs.watch('~/Library/Logs/DiagnosticReports/')` at suite start; keep it alive across the entire suite; any `lawbar*.ips` event fails the run.

- Pros: event-driven; no polling overhead during the test body.
- Cons: macOS `fs.watch` uses FSEvents — buffered, can drop events under load, latency in 100s of ms. Still has a "how long after suite end" cutoff. Killing the watcher at suite end risks missing files that appear after. If suite end + sleep N + watcher close, becomes structurally the same as Alt #5 with extra steps.
- D1: 3 (event-driven catches in-range; still tail-cutoff). D2: 2 (same tail problem). D3: 4 (clean integration).
- Verdict: tail-cutoff problem; same shape as Alt #1 with a different mechanism.

### Alt #3 — Avoid `electronApp.close()`; use a normal quit path

Replace Playwright's `electronApp.close()` (hard-quit during V8 teardown) with a softer path: send a renderer-side `window.close()` and wait for the .app process to exit naturally; OR use a "do-not-close" pattern where the test never closes the .app and the process is reaped at suite end via a managed registry.

- Pros: addresses the Class B trigger directly. If Class B is specific to `electronApp.close()`'s shutdown sequence, replacing the trigger removes the crash.
- Cons: speculative pending §25 reproduction (we don't yet know Class B is `electronApp.close()`-specific — the 11:04 crash's NSWindow `__close` stack frame is reached from `__close`-via-action regardless of how the close is initiated; renderer-side `window.close()` may trigger the SAME teardown path). Letting processes linger across tests pollutes the test environment, leaks file descriptors, and may exhaust resources in long suites. Multi-window scenarios complicate this further.
- D1: 0 (this is NOT a detection mechanism; it's a TRIGGER-avoidance mechanism). D2: 0. D3: n/a — must be paired with a detection mechanism.
- Verdict: trigger-avoidance, not detection — pairs with one of the others. CONDITIONALLY co-required IF §25 reproduction confirms `electronApp.close()` is the trigger.

### Alt #4 — Separate launch-health and shutdown-health tests

Split verification into two phases: a launch-health phase (launch the .app, do work, leave it running and reap externally) and a shutdown-health phase (launch + immediately close + watch). Different watchdog budgets per phase; clearer attribution if a crash appears in one phase but not the other.

- Pros: clearer attribution; allows tighter time bounds per phase.
- Cons: doesn't change detection latency; still has the same .ips arrival problem in the shutdown phase. Adds test surface (more files, more harness). Process-reaping for the launch-health phase introduces its own complexity.
- D1: same as paired detection mechanism. D2: same. D3: 3 (reorganization, not detection).
- Verdict: reorganization, not detection — pairs with one of the others. Useful as structural input to §26 WI design but does NOT itself solve fail-closed-ness.

### Alt #5 — External post-suite settle scan via wrapper script

Wrap `node --test` in a wrapper script (mjs or bash). Wrapper:
1. Records suite-start timestamp + pre-existing `lawbar*.ips` filename set.
2. Sets env vars (`LAWBAR_TEST_PID_LOG`, `LAWBAR_TEST_SUITE_START`) for the test child process.
3. Runs `node --test ...`.
4. After `node --test` exits, sleeps a configurable settle interval (default 30s; tunable via `LAWBAR_TEST_SETTLE_SECONDS`).
5. Scans `~/Library/Logs/DiagnosticReports/lawbar*.ips` for files with mtime ≥ suite-start.
6. For each new .ips, parses the JSON header + body. Reads the `pid` field. Cross-references against `LAWBAR_TEST_PID_LOG` (populated by each test-driven `electron.launch`).
7. If `pid` matches a recorded test-launch pid: exit non-zero. Print the .ips path + the matching launch context (which test, which iteration).
8. If new .ips files exist but none match recorded pids: WARN. Default behavior: exit non-zero anyway (configurable via `LAWBAR_TEST_STRICT_UNATTRIBUTED`).
9. If `node --test` exited non-zero AND no matching .ips: pass-through the failure.
10. Only path to exit 0: `node --test` exit 0 AND no new attributable .ips after the settle window.

- Pros: configurable settle window (tunable upward without redesign). pid-correlation eliminates the rev-2 §14 medium-risk "concurrent unrelated lawbar runs" false-positive class via mechanism, not operational rule. Wrapper exit code propagates to the npm script entry point; CI sees a failed suite. Decouples detection from `node --test`'s in-process lifecycle. Pairs naturally with Alt #3 if §25 confirms `electronApp.close()` is the trigger.
- Cons: requires a wrapper script (~80 LOC mjs). Cross-platform CI needs a no-op equivalent for non-darwin (acceptable — the .app is darwin-only). The wrapper becomes the canonical entry; bypassing it via `node --test ...` directly would skip the detection — guarded by package.json npm scripts only invoking through the wrapper, plus a CI check.
- D1: 5 (configurable). D2: 5 (wrapper exit code is the gate). D3: 4 (npm script wrapper is standard).
- Verdict: strongest fail-closed mechanism in the list.

### Alt #6 — Manual-only evidence

Accept that automation cannot deterministically catch late shutdown crashes. Require a manual verification protocol: developer runs `npm run test:packaged`, waits 60s, runs `ls ~/Library/Logs/DiagnosticReports/lawbar*.ips`, asserts none new. Document in a checklist.

- Pros: honest about the limitation; zero false negatives if the human waits long enough.
- Cons: defeats CI; requires human in the loop for every verification. Project policy (`.claude/rules/security-boundary.md` §"Required loop") requires automated tests + audit gates for high-risk WIs; manual-only fails that requirement. Reviewability via cc-suite audit is limited because the audit cannot replay the manual step.
- D1: 5 (if human waits). D2: 5 (human is the gate). D3: 0 (no automation).
- Verdict: violates the high-risk-WI automation policy; rejected on policy grounds.

### Summary

| Alt | D1 late-crash | D2 fail-closed | D3 automation | Verdict |
|---|---:|---:|---:|---|
| #1 longer poll + settle | 4 | 2 | 4 | partial — heuristic settle is the weakness |
| #2 fs.watch | 3 | 2 | 4 | tail-cutoff problem; same shape as #1 |
| #3 avoid `.close()` | n/a | n/a | n/a | trigger-avoidance, not detection — pairs with another |
| #4 split launch/shutdown | n/a | n/a | 3 | reorganization, not detection |
| #5 post-suite settle scan + pid-correlation | **5** | **5** | **4** | **strongest fail-closed mechanism** |
| #6 manual-only | 5 | 5 | 0 | violates CI automation policy |

**Selection: Alt #5, optionally co-required with Alt #3 trigger-avoidance pending §25 reproduction. Alt #4 split-phase is a tactical reorganization adopted inside the §26 evidence WI but does not itself satisfy fail-closed.**

## §24 — Recommended fail-closed mechanism (replaces rev-2 §11 PERMANENT row)

> **rev-3.1 SCOPE NOTE** — the wrapper is **fail-closed within the configured settle window AND attribution model** (see §"Limits of fail-closed-ness" below). It is NOT unconditionally fail-closed; a crash whose .ips arrives AFTER the settle window OR whose attribution does not match the configured criteria can escape. The settle window is configurable; the attribution model is multi-criteria (NOT pid-only); CI MUST enforce strict-unattributed-fail so escape via `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` is impossible in automated runs.

### Design

A wrapper script becomes the canonical entry point for every packaged-binary verification suite. The script:

1. Records suite-start time + the set of pre-existing `lawbar*.ips` filenames in `~/Library/Logs/DiagnosticReports/`.
2. Creates a tempfile path; exports `LAWBAR_TEST_PID_LOG=<tempfile>` and `LAWBAR_TEST_SUITE_START=<iso-timestamp>` in the env passed to `node --test`.
3. Runs `node --test <test-files...>`.
4. Inside the tests, every call to `electron.launch(...)` is wrapped in a `launchPackaged(options)` helper that:
   a. Calls `electron.launch(options)`.
   b. Reads `electronApp.process().pid` and APPENDS `{pid, launchedAtIsoTimestamp, testName, iteration?}` as one JSON line to `LAWBAR_TEST_PID_LOG`.
   c. Returns the `electronApp` instance.
5. After `node --test` exits (capturing its exit code), the wrapper:
   a. Sleeps `LAWBAR_TEST_SETTLE_SECONDS` (default 30; configurable upward; CI MAY enforce a minimum floor).
   b. Reads `LAWBAR_TEST_PID_LOG`, parses the JSON lines into a `recordedPids` set.
   c. **Candidate discovery** — finds .ips files written during the test suite. Performs BOTH a filename-filtered scan (`lawbar*.ips` matching) AND a directory-wide bundle-id-filtered scan (every .ips whose body's `bundleInfo.CFBundleIdentifier` equals `io.lawbar.desktop`). Restricts both to mtime ≥ suite-start. The union is the candidate set. Filename pattern alone is NOT attribution — it is one route to candidate discovery; an unrelated file named `lawbar*.ips` whose body does not satisfy any of the attribution criteria in step 5d is NOT attributed to this test run.
   d. **Attribution** — for each candidate from step 5c, parses the JSON header + body (Apple .ips is two concatenated JSON documents per file). Reads `pid`, `exception.type`, `exception.signal`, `procName`, `procPath`, `bundleInfo.CFBundleIdentifier`, top stack frames. A candidate is ATTRIBUTABLE to this test run if AT LEAST ONE of the following holds:
      - **pid correlation** — the .ips `pid` matches a `recordedPids` entry (HIGH-CONFIDENCE; main process from a test-launch).
      - **bundle id** — `bundleInfo.CFBundleIdentifier` equals `io.lawbar.desktop` (authoritative; survives renames; not spoofed by other apps named "lawbar").
      - **procPath** — `procPath` has the tested .app bundle root as a prefix (e.g., matches the dist/ or release/ packaged .app path; catches helper-process crashes where filename may still be `lawbar*.ips` but the process is a helper at a known sub-path).
      - **procName allowlist** — `procName` is one of: `lawbar` (main), `lawbar Helper (Renderer)`, `lawbar Helper (GPU)`, `lawbar Helper (Network)`, `lawbar Helper (Plugin)`, OR any string starting with `lawbar Helper` for forward compat with future Electron helper names (catches multi-process Electron crashes per §22 detection subclasses).
      If the candidate's `pid` matches `recordedPids` AND the bundle/path/procName criteria also match, attribution is HIGH-CONFIDENCE. If `pid ∉ recordedPids` but bundle/path/procName matches: attribution is HELPER-PROCESS or UNATTRIBUTED-PARENT (still a FAIL in default strict mode — see step 5f). If a candidate matches NONE of the attribution criteria (e.g., an unrelated user-app whose name happens to match `lawbar*.ips`), it is NOT attributed and does NOT fail this test run, but the wrapper SHOULD log it for operator awareness.
   e. If `pid ∈ recordedPids` AND main-process attribution: FAIL — exit non-zero. Print the .ips path + recorded launch context + crash signature.
   f. If criteria match but `pid ∉ recordedPids` (helper / unattributed but bundle/path matches): FAIL by default (`LAWBAR_TEST_STRICT_UNATTRIBUTED=true`). Tunable via `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` ONLY in interactive dev sessions (e.g. parallel `npm run dev`); see §"CI enforcement" below for the CI-side prohibition.
   g. If `node --test` exited non-zero AND no matching .ips: exit with the test's exit code (pass-through).
   h. Only path to exit 0: `node --test` exit 0 AND no new attributable .ips after the settle window AND (in CI) no unattributed matches.

### Why this is fail-closed (within scope)

- The settle interval (default 30s) is configurable upward without code change. A macOS that increases ReportCrash latency to 60s is a config bump, not a redesign.
- Multi-criteria attribution (filename + bundle id + procPath + procName + optional pid) eliminates the false-positive class from concurrent unrelated lawbar runs (rev-2 §14 medium-risk row now mitigated by mechanism, not by operational rule) AND catches helper-process crashes that pid-correlation alone would miss (§22 detection subclasses).
- The wrapper exits non-zero on any attributable new .ips. The npm script entry (`test:packaged`) inherits that exit code. CI sees a failed suite.
- CI enforcement (see below) makes `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` impossible in automation, eliminating the operator-bypass vector.

### Limits of fail-closed-ness (rev-3.1)

The mechanism is fail-closed **within these explicitly-named scope conditions**. Outside them, escape vectors remain:

- **Settle window timeout**: a crash whose .ips lands after `LAWBAR_TEST_SETTLE_SECONDS` is not detected by this suite. Bounded by the impl WI's measurement step; default 30s is the starting point, not a guarantee. Risk: ReportCrash daemon CPU-starved under CI load may exceed observed-max latency.
- **Attribution model coverage**: if a future Electron version introduces helper-process names not matching `lawbar Helper *`, attribution misses. The procName allowlist is a forward-compat best-effort; bundle-id + procPath provide structural fallback. If neither matches (e.g., a deeply embedded helper writes its own bundle id), attribution misses — would be caught only by unattributed-strict mode.
- **Strict-unattributed bypass**: setting `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` interactively would let an unattributed .ips pass. CI enforcement (next subsection) closes this.
- **Direct unwrapped execution**: running `node --test tests/smoke.packaged.electron.test.mjs` without the wrapper bypasses ALL detection. Operational guards (next subsection + §25 + §26) close this.
- **Non-`lawbar*.ips`-named crash reports**: if macOS / Electron writes a crash file under a different naming convention (extremely unlikely for the .app's own bundle, but theoretically possible for sandbox helpers), the filename-pattern step misses; the bundle-id + procPath scan over the full DiagnosticReports directory (not filename-filtered) would catch the residual — the impl WI should implement BOTH a filename-filtered scan AND a directory-wide bundle-id-filtered scan, and FAIL on the union.

These limits are explicit acceptance criteria for the §26 WI-1 plan (the detection-redesign plan WI) — the plan must enumerate them, propose mitigations, and surface any residual risks to the cc-suite reviewer.

### CI enforcement (rev-3.1)

The §26 WI-2 (`WI-pkg-verify-detection-impl`) MUST include the following CI-side guards:

1. **`LAWBAR_TEST_STRICT_UNATTRIBUTED` is impossible to weaken in CI.** Achieved via one of:
   - The wrapper script, when run with the `LAWBAR_CI=true` env var, IGNORES `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` and treats unattributed as FAIL regardless. The CI config sets `LAWBAR_CI=true` at the job level.
   - OR: the wrapper EXITS non-zero immediately if `LAWBAR_CI=true` AND `LAWBAR_TEST_STRICT_UNATTRIBUTED=false`, printing a clear "CI must use strict mode" error.
   - Pick one in WI-1; the plan must justify the choice.
2. **Direct unwrapped execution is blocked in CI.** Achieved via one of:
   - The `apps/lawbar-desktop/package.json` `test:packaged` script (after WI-2's first mutation) ONLY invokes through the wrapper. CI invokes `npm run test:packaged`, never `node --test tests/smoke.packaged.electron.test.mjs` directly.
   - The smoke test files themselves check for `LAWBAR_TEST_PID_LOG` env var presence at the top of the file; if missing AND `LAWBAR_CI=true`, the test file exits non-zero with a clear "must run through wrapper" error.
   - The WI-1 plan MUST define the exact guard chosen. Both can co-exist.
3. **Wrapper bypass detection.** The wrapper writes a sentinel file or env hint that the test files read. If a test file detects it is running outside the wrapper AND in a CI context (`LAWBAR_CI=true`), the test fails fast with a clear error pointing to this section.

These guards are part of WI-1's plan-review packet, not deferred to WI-2's implementation choices alone.

### Pairings

- **Alt #3 (avoid `electronApp.close()`) is CONDITIONALLY co-required.** If §25 reproduction confirms `electronApp.close()` is the SIGSEGV trigger, the impl WI MUST also redesign the test-side shutdown sequence (e.g. send `app.quit()` from the main process via `app.evaluate`, then wait for natural exit). If §25 cannot reproduce Class B after N=50 sequential runs against the rev-3 wrapper, Alt #3 becomes optional and the recommendation stays Option 2a.
- **Alt #4 (split-phase tests) is a tactical reorganization** the impl WI MAY use to separate Class A and Class B detection windows. Not load-bearing.

### Hard-stop compliance

- No `Info.plist` mutation. No `LSUIElement`. No `LSBackgroundOnly`. No crash-dialog suppression.
- No new runtime dependency. The wrapper is a ~80-LOC mjs script (`apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`); .ips parsing uses `node:fs` + native JSON.parse (`.ips` files are JSON-on-two-lines per Apple convention; the second document is the body).
- No production-binary change. The `LAWBAR_TEST_PID_LOG` env var is read by test code only; `electron/main.ts` is UNTOUCHED.
- No package.json mutation in THIS plan (the eventual WI will mutate scripts; that change is reviewed independently per §26).

### What this rules out

- Rev-2's `tests/_crash-watchdog.mjs` 1000ms post-close polling as PROOF is RETIRED. (The withdrawn implementation attempt's `_crash-watchdog.mjs` file is gone from the working tree.)
- Rev-2's §11 PERMANENT row is REWRITTEN per this section.
- Rev-2's §13 step 1 (WI-pkg-verify-playwright-evaluate-poc as the FIRST WI) is no longer accurate; the detection mechanism plan + impl is now sequenced BEFORE the PoC WI (see §26).

## §25 — Suspect-status analysis: prior `test:packaged` and WI-A smoke

### Concern

The Class B SIGSEGV-at-shutdown was caught on 2026-05-25 at 11:04 during a single test run. Prior WI-A packaged-smoke runs (since commit `65fd0cc`, the WI-A baseline) did NOT have any crash-report watching. If Class B is reproducible, prior runs MAY have also produced .ips files that nobody noticed — passing the test suite while crashes accumulated silently.

### Forensic check (this session)

`ls -lt ~/Library/Logs/DiagnosticReports/lawbar*.ips` shows 4 total files:
- `2026-05-25 03:50:59` — Class A SIGABRT (cause: `--probe-case-box` from raw spawn during PoC era).
- `2026-05-25 03:51:23` — Class A SIGABRT (cause: PoC `--probe-casebox-pkg-arch`).
- `2026-05-25 03:53:28` — Class A SIGABRT (cause: `--probe-case-box`).
- `2026-05-25 11:04:05` — Class B SIGSEGV-at-shutdown (cause: Playwright `electron.launch` + `electronApp.close()` during the now-aborted PoC).

No older .ips files exist. Apple's ReportCrash directory rotates older crashes (default ~25 most-recent kept system-wide; lawbar-specific files removed when total grows past the cap). Older WI-A runs cannot be retroactively audited from this directory alone.

### Suspect determination

- WI-A's `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` tests 2 + 3 use `electronApp.close()` in `t.after(...)` hooks. They follow the EXACT pattern that produced the 11:04 crash.
- Therefore: WI-A's prior packaged-smoke runs MAY have produced Class B crashes that were not detected.
- However: NO unattributed `lawbar*.ips` files exist in the current DiagnosticReports directory. Either (a) Class B is rare/non-reproducible, (b) prior crashes DID happen and have rotated out, OR (c) Class B is specific to the 11:04 conditions (Electron 34.5.8 + macOS 15.6.1 + this specific test combination including the `app.evaluate` calls that the now-aborted test 2 made before crashing — possible because `app.evaluate` against an ESM main process drives V8 into vm-style code paths that may have weakened the isolate).
- N=1 observation is not enough to choose among (a)/(b)/(c).

### Required action (folded into §26 WI-2 acceptance)

The §26 WI-2 (`WI-pkg-verify-detection-impl`) MUST include a Class B reproduction step:
1. Re-run WI-A's existing `smoke.packaged.electron.test.mjs` (post-wrapper) ≥50 times sequentially (configurable upward).
2. Observe whether ANY `lawbar*.ips` file appears that pid-correlates to a launched test.
3. Outcome A — ZERO crashes in 50 runs: Class B reproducibility is empirically low; the rev-2 Option 2a recommendation remains viable; Alt #3 co-requirement is dropped. Document the empirical bound (e.g., "Class B probability ≤ 1/50 in observed environment").
4. Outcome B — ≥1 crash in 50 runs: Option 2a's C1 score is empirically falsified for repeated use. Escalate to either (a) Alt #3 trigger-avoidance (test-side soft-quit) layered on top of Option 2a, OR (b) switch to Option 4 (`open -a` LaunchServices launch); the choice is reviewed independently before WI-3 starts.

### Until that step completes

- The `test:packaged` script in `apps/lawbar-desktop/package.json` is SUSPECT for Class B. NPM scripts that depend on it (currently: `test:packaged` itself only; `npm test` in `apps/lawbar-desktop/` invokes `tests/main.test.mjs tests/smoke.electron.test.mjs` per package.json line 17 and does NOT invoke `test:packaged`) are NOT immediately blocked.
- WI-A's test file gains a `// SUSPECT-CLASS-B — see dev-memo/plan-packaged-probe-verification-00.md §25` banner as part of §26 WI-2. The banner is informational; it does not skip the tests.
- The `test:probe` script (raw-spawn `--probe-case-box`) remains separately suspect for Class A and is already excluded from §26 WI-2's evidence runs per the rev-2 §11 step-4 interim rule.

### Interim rule (rev-3.1): unwrapped `test:packaged` is NOT evidence

Until §26 WI-2 lands and routes `test:packaged` through the §24 wrapper, the following operational rule applies:

1. **Unwrapped `npm run test:packaged` MUST NOT be used as evidence for any cc-suite review, audit, verify, or readiness claim.** Any audit / verify finding that cites an unwrapped `test:packaged` pass as evidence is INVALID under rev-3.1 because the underlying detection mechanism is empirically broken (per §21).
2. **WI-2's FIRST mutation MUST route `test:packaged` through the wrapper before any ≥50-run reproduction is executed.** The reproduction step (§25 Required action) is performed via `npm run test:packaged` ONLY AFTER the script has been rewired to invoke `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`. Running the reproduction against the OLD (unwrapped) `test:packaged` does NOT count as §25 evidence.
3. **Recommended (not required) temp guard during the WI-1 → WI-2 window**: the WI-1 plan MAY include adding a top-of-file banner failure to `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` that exits the test file with a clear error message if `process.env.LAWBAR_TEST_PID_LOG` is absent AND `process.env.LAWBAR_ALLOW_UNWRAPPED_TEST` is not set. The banner gates accidental unwrapped runs without rewriting the test bodies. WI-2 removes the gate once the wrapper is the canonical entry. The choice (banner-failure vs. plain comment banner) is part of WI-1's plan-review.
4. **CI is forbidden to invoke unwrapped `test:packaged` at any time.** This rule applies retroactively — if any prior or in-flight CI job invokes the unwrapped script, that job's outcome is NOT evidence and must be re-run after WI-2 lands.

### NOT yet required (this rev-3 amendment)

- No deletion of WI-A tests. They remain observational evidence of dev-mode + packaged behavior on this hardware/macOS, AND they are the load-bearing input to the §25 reproduction step.
- No reversion of WI-A commits. The pattern is observationally usable; the §26 WI-2 reproduction step determines whether it remains the chosen launch mechanism.
- No production-binary change. main.ts stays untouched.

## §26 — Updated follow-up WI sequence (rev-3)

Supersedes rev-2 §13. New sequence:

1. **WI-pkg-verify-detection-redesign** (NEW; FIRST). Plan-only sub-WI: produce the full implementation plan for the §24 wrapper + light helper. Must pass cc-suite review-plan before implementation. Out of scope: any test code; any retire WI; any package.json mutation.
2. **WI-pkg-verify-detection-impl** (NEW; SECOND; only after WI-1 is READY). Implements the §24 wrapper + light helper. Includes:
   - Wrapper script `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` (~80 LOC).
   - Test helper `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` (~30 LOC) exposing `launchPackaged(options, ctx)` that records pid + context to `LAWBAR_TEST_PID_LOG`.
   - Mutate `npm run test:packaged` to invoke the wrapper.
   - Add a synthetic-detector smoke: deliberately write a `lawbar*.ips`-shaped file containing a recorded pid; verify wrapper exits non-zero. (Proves the detector works on a known input.)
   - WI-A regression run under wrapper: re-run `npm run test:packaged` ≥50 times sequentially (or via a single test that loops); record observed maximum settle latency for any Class B .ips that appears. Output goes into the WI's commit message (per §25 Required action).
   - WI-A tests gain the `// SUSPECT-CLASS-B` banner per §25.
3. **WI-pkg-verify-playwright-evaluate-poc** (rev-3.1; THIRD; ONLY after WI-2 verifies the detection mechanism AND §25 reproduction either passes Outcome A or escalates to Outcome B's launch-mechanism review). Same scope as rev-2 §13 step 1 EXCEPT:
   - `tests/_crash-watchdog.mjs` is NOT created; the §24 wrapper is the detection.
   - The PoC tests use `launchPackaged(...)` instead of raw `electron.launch(...)`.
   - **ESM evidence-2 plan gate (rev-3.1; promoted from note to explicit gate)**: WI-3's plan-review packet MUST address the ESM `app.evaluate` blocker BEFORE implementation can land. The aborted impl attempt EMPIRICALLY proved that `app.evaluate` in an ESM Electron main process (Electron 34.5.8 with package.json `"type": "module"`) has NO `globalThis.require` (undefined), NO `process.mainModule` (undefined), AND dynamic `import()` inside `app.evaluate` fails with `TypeError: A dynamic import callback was not specified`. Therefore rev-2 §11 evidence-2 (full WI-B-style better-sqlite3 round-trip via `app.evaluate`) IS NOT ACHIEVABLE AS WRITTEN. WI-3's plan MUST propose a replacement evidence-2 mechanism — candidates include: (a) expose a test-only globalThis hook gated by an env-var (requires production-binary change; reviewed against the no-prod-binary-change rule); (b) move the better-sqlite3 round-trip into a renderer-side preload-IPC pattern (chicken-and-egg with rev-2 §6 Option 2b; only viable after IPC layer exists); (c) accept that test-1 + test-3 + the §24 wrapper constitute sufficient evidence and drop evidence-2 from the plan (requires explicit cc-suite re-review of the relaxed acceptance bar); (d) replace `app.evaluate` with a different probe mechanism (e.g., Playwright's `page.evaluate` against a hidden test-only renderer that pre-loads better-sqlite3). The choice is WI-3's plan-review responsibility, not deferred further. Without a passing WI-3 plan-review on evidence-2, Option 2a is NOT CLEARED for full recommendation — only the detection mechanism (WI-1 / WI-2) is independently usable.
4. **WI-retire-probe-case-box** (rev-3; FOURTH; unchanged scope from rev-2 §13 step 2 except sequenced after WI-3 instead of after WI-rev-2-#1).
5. **WI-revive-tarball-poc** (rev-3; FIFTH; unchanged from rev-2 §13 step 3).
6. **REVIVE WI-casebox-ipc-contract-impl planning** (rev-3; SIXTH; unchanged from rev-2 §13 step 4).

### Critical reordering rationale

rev-2 sequenced the Playwright PoC first; the watchdog was an internal step of that WI. rev-3 PROMOTES the detection mechanism to its own pair of WIs (plan + impl) that MUST land before any PoC work. The reason is structural: the watchdog is the LOAD-BEARING defence; building the PoC on top of a broken watchdog is what produced the 11:04 crash that nobody caught until the developer noticed the dialog. The detection mechanism's correctness is a precondition for trusting any subsequent packaged-binary test outcome.

## §27 — Review packet (rev-3 compact)

**Active plan summary (rev-3)**: empirical falsification of rev-2's PERMANENT 1000ms polling watchdog by the 2026-05-25 11:04:05 SIGSEGV-at-shutdown crash report. The .ips file appeared ~3 seconds after process exit; the rev-2 polling window expired at 1 second; the test reported clean while the user-visible crash dialog appeared. Crash class taxonomy updated to TWO classes (Class A early-launch SIGABRT in HIToolbox `_RegisterApplication`; Class B late-shutdown SIGSEGV in V8/AppKit `__close` path). Of 6 evaluated detection alternatives, recommends Alt #5 (post-suite settle-scan wrapper) paired with pid-correlation via Playwright's `electronApp.process().pid` cross-referenced with the .ips `pid` field. Default settle window 30s (tunable via `LAWBAR_TEST_SETTLE_SECONDS`). Wrapper script + light helper become a NEW pair of WIs (`WI-pkg-verify-detection-redesign` + `WI-pkg-verify-detection-impl`) that MUST land before any PoC implementation. The PoC WI (rev-2's first WI) is sequenced THIRD now; it cannot proceed without the detection mechanism in place AND without §25 reproduction passing Outcome A (zero Class B in 50 runs) OR the launch mechanism being re-reviewed under Outcome B. WI-A's existing packaged smoke is SUSPECT for Class B; WI-2's evidence step is the path to either clear or re-mechanism that suspicion.

**Exact target files (this rev-3 amendment)**:
- `dev-memo/plan-packaged-probe-verification-00.md` (this file; rev-3 appends §20-28 + inline supersession notes at the rev-2 Status line, §11 PERMANENT row, §14 H1 row).

**Exact target files (eventual follow-up WIs; NOT this plan)**:
- See §26 — 6 follow-up WIs each requiring their own cc-suite review-plan.

**Exact acceptance criteria (eventual WI-pkg-verify-detection-impl)**:
- §24 — wrapper exits non-zero on any pid-matching new .ips in the settle window.
- §25 — ≥50-run WI-A reproduction with documented Outcome A or B.

**Exact out-of-scope (rev-3, this amendment)**:
- Any implementation; the amendment is doc-only.
- Any new runtime dependency.
- `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash-dialog suppression.
- IPC implementation restart.
- Product UI / case-box UI.
- Real case data persistence.
- Tier 2 SQLCipher / Keychain.
- Signing / notarization / distribution / telemetry / cloud / go-live.
- Mutating `apps/lawbar-desktop/package.json` (deferred to WI-pkg-verify-detection-impl).

**Essential references**:
- `/Users/zhongyibao/Library/Logs/DiagnosticReports/lawbar-2026-05-25-110405.ips` — the falsifying crash report (Class B observation #1).
- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` (commit `6afee88`) — rollback record + the 3 original Class A crashes.
- `dev-memo/plan-desktop-package-architecture-00.md` (commit `e5cb773`; rev-3 READY) — packaging topology UNCHANGED by this amendment.
- `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (commit `65fd0cc` baseline + later additions) — the SUSPECT-CLASS-B test file per §25.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — this amendment is high-risk; review-plan required.
- `.claude/rules/security-boundary.md` §"Required loop" — automated tests + audit gates required for high-risk WIs (rules out Alt #6 manual-only).

**Review questions** (rev-3-specific, for the cc-suite reviewer):
1. Is Alt #5's 30s default settle window sufficient? Class B's single observation settled in ~3s. Would the reviewer prefer a longer default (60s) + WI-2 measurement to tune downward, or accept 30s as adequate?
2. Is pid-correlation via `electronApp.process().pid` reliable? Playwright's `electronApp.process()` returns the .app's main process. On macOS, an Electron .app also spawns helper processes (renderer, GPU, network). Helper crashes would have different pids in their .ips files. Does the .ips contain ENOUGH info to attribute to the test-launched main process? The 11:04 .ips has `pid: 55008` and `parentPid: 54999`; should the wrapper match against either, or only against the recorded `electronApp.process().pid` for the main? If a helper crashes, is that ALSO a fail signal (probably yes — surface as `[unattributed-helper]`)?
3. Is §25's "no deletion of WI-A tests, no commit reversion" the right disposition, or should WI-A be quarantined (test files renamed to `.skip` OR moved to `tests/quarantine/`) until WI-2 + WI-3 finish? The reviewer may prefer stricter quarantine given the suspect-status.
4. Is Alt #3 (trigger-avoidance — avoid `electronApp.close()`) under-evaluated? It could be a real fix for Class B if `electronApp.close()` is the actual cause. Should it be promoted from "conditional co-required pending §25 reproduction" to "co-required unconditionally"? Trade-off: complexity of process-tracking + reaping vs guaranteed avoidance.
5. The amendment preserves the rev-2 Option 2a recommendation as CONDITIONAL pending §25 reproduction (Outcome A keeps Option 2a; Outcome B escalates). Should the recommendation instead be DOWNGRADED to "REVISITED — pending mechanism redesign" with NO active recommendation until §25 lands? Reviewer's call on how strongly to hedge.
6. Does the §24 wrapper introduce a CI-portability concern (darwin-only)? The .app is darwin-only, so the wrapper being darwin-only is consistent. But future cross-platform packaging WIs would need parallel detection mechanisms. Is that an acceptable forward gap to record now?
7. Is the secondary blocker (rev-2 §11 evidence-2 better-sqlite3 round-trip via `app.evaluate` not achievable in ESM main process per the aborted impl's discovery) correctly deferred to WI-3's own plan-review pass, or should this rev-3 amendment ALSO redesign evidence-2 here? The amendment chose deferral because the primary blocker is detection; reviewer may prefer one consolidated redesign.

## §28 — Required cc-suite review (rev-3)

This rev-3 amendment is not authorized for promotion (status flip to READY) until:
1. `/cc-suite:review-plan dev-memo/plan-packaged-probe-verification-00.md` returns READY (or only Low-risk clarifications remain) on the rev-3 amendment scope (§20-28 + the three inline supersession notes at §11 PERMANENT row, §14 H1 row, and top-of-file Status line).
2. Any Critical/High findings on the rev-3 amendment are fixed and the plan is re-reviewed.
3. The §24 detection mechanism is not modified without re-review.
4. Each follow-up WI in §26 requires its own `/cc-suite:review-plan` before its implementation can land.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency between rev-2 §3 (Class A described) and rev-3 §22 (Class A + Class B taxonomy).
- Consistency between rev-2 §6/§10 Option 2a recommendation and rev-3's "Option 2a CONDITIONAL pending §25 Outcome A vs B" — is the conditionality clear, or should §6/§10 carry their OWN inline supersession notes?
- Realism of the 30s default settle window vs Apple ReportCrash latency in CI environments.
- Realism of pid-correlation reliability across Electron's multi-process model.
- Whether Alt #3 (trigger-avoidance) needs co-required status alongside Alt #5.
- Hard-stop compliance — no `Info.plist` mutation, no `LSUIElement`, no `LSBackgroundOnly`, no crash-dialog suppression under any circumstance.
- Whether the §26 sequencing (detection-redesign + detection-impl BEFORE the PoC WI) is the correct ordering.

This rev-3 amendment is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it materially changes a packaging-verification topology decision and replaces a previously-reviewed PERMANENT defence. `/cc-suite:review-plan` is REQUIRED before implementation.

## §29 — rev-3.1 changelog (post review-plan-mpldafv6-i0bt1c)

Review job `review-plan-mpldafv6-i0bt1c` (gpt-5.5 / high / read-only / 2026-05-25 ~15:34-15:36 UTC) returned NEEDS-FIX with 0 C / 1 H / 2 M / 1 L. All four findings applied inline in this revision (rev-3.1) per user authorization. Specific edits:

- **H1 — §24 fail-closed overclaim** (review pointer line 720). Fixed:
  - Added §24 rev-3.1 SCOPE NOTE clarifying "fail-closed WITHIN the configured settle window AND attribution model" (NOT unconditionally).
  - Replaced step 5c pid-only attribution with **multi-criteria attribution**: filename pattern + `bundleInfo.CFBundleIdentifier` + `procPath` (catches helper-process crashes via .app bundle root prefix) + `procName` allowlist (`lawbar`, `lawbar Helper (Renderer)`, `lawbar Helper (GPU)`, `lawbar Helper (Network)`, `lawbar Helper (Plugin)`, `lawbar Helper *` forward-compat) + pid correlation where available.
  - Step 5e/5f rewritten: HIGH-CONFIDENCE main attribution OR HELPER-PROCESS / UNATTRIBUTED-PARENT attribution; both FAIL in default strict mode.
  - New §"Limits of fail-closed-ness" subsection enumerates settle-window timeout, attribution-model coverage, strict-unattributed bypass, direct unwrapped execution, non-lawbar-named crash reports as explicit residual risks — each surfaces as WI-1 plan-review acceptance criteria.
  - New §"CI enforcement (rev-3.1)" subsection requires WI-2 to implement THREE specific guards: (1) `LAWBAR_CI=true` makes `STRICT_UNATTRIBUTED=false` impossible; (2) direct unwrapped execution is blocked via package.json script routing AND/OR test-file env-var check; (3) wrapper-bypass detection via sentinel file/env. The WI-1 plan must define the exact guards chosen.

- **M1 — Option 2a dual-blocker** (review pointer line 819). Fixed in THREE places:
  - Top-of-file Status line now reads "Option 2a (§6/§10) is CONDITIONAL on TWO independent blockers" and enumerates both (crash-detection clearance + ESM-compatible evidence-2 mechanism).
  - §10 gained a "rev-3.1 SUPERSESSION" callout listing both blockers verbatim, with text that Option 2a is REJECTED if either gate fails.
  - §26 WI-3 row rewritten: the ESM `app.evaluate` blocker is PROMOTED from a note to an explicit "ESM evidence-2 plan gate". WI-3's plan-review packet MUST address the blocker BEFORE implementation can land. Four candidate replacements enumerated ((a) test-only globalThis hook — requires production-binary review; (b) renderer-side preload-IPC; (c) drop evidence-2 with explicit re-review of the relaxed bar; (d) `page.evaluate` against a hidden test renderer). Option 2a is NOT CLEARED for full recommendation without a passing WI-3 plan-review on evidence-2.

- **M2 — unwrapped `test:packaged` operational guard missing** (review pointer line 795). Fixed:
  - §25 gained a new "Interim rule (rev-3.1)" subsection codifying FOUR rules: (1) unwrapped `npm run test:packaged` MUST NOT be used as evidence for any cc-suite review/audit/verify/readiness claim; (2) WI-2's FIRST mutation MUST route `test:packaged` through the wrapper before any ≥50-run reproduction is executed; (3) recommended temp banner-failure or env-var guard during the WI-1 → WI-2 window (choice deferred to WI-1's plan-review); (4) CI is forbidden to invoke unwrapped `test:packaged` retroactively — any prior CI job using it is NOT evidence.

- **L1 — §22 Class B causality wording** (review pointer line 618). Fixed:
  - Class B header now reads "(mechanism INFERRED FROM N=1)" — explicit epistemic marking.
  - Symptom row split into "PROVEN by the 11:04 .ips" facts vs "Trigger (INFERRED, not proven)" hypothesis. `electronApp.close()` is NO LONGER claimed as exclusive trigger; the broader hypothesis is "forced-quit during V8 isolate teardown via any AppKit-driven shutdown chain that reaches `-[NSWindow __close]`".
  - New §"Detection-relevant subclasses (rev-3.1)" subsection enumerates helper-process crashes (renderer/GPU/network/utility) + late ReportCrash emission + renderer mid-test crashes + GPU process crashes + network/utility helper crashes. These are flagged as NOT separate crash classes yet (too little evidence) but ARE relevant to §24's attribution model — and the multi-criteria attribution in §24 step 5c IS the mitigation.

### Diff scope (rev-3.1 vs rev-3)

- Top-of-file Status line (1 line edit).
- §10 prepended supersession callout (new content; rev-2 text preserved below).
- §22 Class B section rewritten + new "Detection-relevant subclasses" subsection.
- §24 SCOPE NOTE + step 5c-h rewritten + new "Limits of fail-closed-ness" + new "CI enforcement" subsections.
- §25 new "Interim rule (rev-3.1)" subsection between "Until that step completes" and "NOT yet required".
- §26 WI-3 row rewritten (ESM evidence-2 promoted from note to gate).
- §29 (this changelog).

### Out of scope for rev-3.1

- No implementation. No dependency installation. No package.json mutation. No Info.plist change. No LSUIElement / LSBackgroundOnly. No crash suppression. No IPC implementation. No product UI / case-box UI / real-data / Tier 2 / signing / distribution / telemetry / cloud / go-live work. No push.
- Existing rev-3 §27 review-question 7 (about evidence-2 deferral) is now ANSWERED inline — the reviewer asked whether deferral was correct or whether rev-3 should redesign evidence-2 here; rev-3.1's M1 fix splits the difference by promoting the blocker to an explicit WI-3 gate (deferred to WI-3, but with explicit plan-review requirements). The reviewer may choose to re-rate that decision in this re-review pass.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-packaged-probe-verification-00.md` against rev-3.1 (this revision) to confirm H1 + M1 + M2 + L1 are resolved and no new C/H/M findings surface.

### rev-3.1.1 — re-review Low-only fixes applied inline (post review-plan-mplej805-eyq0f8)

Re-review job `review-plan-mplej805-eyq0f8` (gpt-5.5 / high / read-only / 2026-05-25 ~16:09-16:10 UTC) returned **READY-with-Low** with 0 C / 0 H / 0 M / 2 L. All four prior findings (H1 + M1 + M2 + L1) confirmed resolved. Both new Lows applied inline before commit:

- **L1 (new) — §24 attribution wording** (re-review pointer line 750). Fixed: split step 5c "Candidate discovery" from step 5d "Attribution". Filename pattern is now explicitly a candidate selector (one of two discovery routes — filename-filtered + directory-wide bundle-id-filtered union), NOT attribution. Attribution requires at least one of: pid correlation OR `bundleInfo.CFBundleIdentifier` equals `io.lawbar.desktop` OR `procPath` has the tested .app bundle root as prefix OR `procName` matches the lawbar / lawbar Helper allowlist. A candidate matching NONE of these (e.g., unrelated `lawbar*.ips` from a different app) is logged but does NOT fail the test run.
- **L2 (new) — §24 duplicate subsections** (re-review pointer lines 797-819). Fixed: deleted the duplicate second copy of "Pairings" + "Hard-stop compliance" subsections. Section now appears exactly once.

The post-fix doc is the committable artifact. No further review needed before commit per user authorization (Low-only fixes pre-authorized).
