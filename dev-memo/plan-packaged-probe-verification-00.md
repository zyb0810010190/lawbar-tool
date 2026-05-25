# PLAN — Packaged-probe verification redesign

**Status**: PLAN-ONLY (READY after third review attempt — compact-packet retry; 2 Low fixes applied inline).
**Date**: 2026-05-25.
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
| **PERMANENT (rev-1 per M2; rev-2 polling window per L2; rev-2 retry isolation note per L)** | **Crash-report watchdog as a permanent assertion** | EVERY packaged verification test (existing WI-A + the new verification PoC + any future packaged test) MUST snapshot `ls ~/Library/Logs/DiagnosticReports/lawbar*.ips` BEFORE the test runs. After the .app process exits, the watchdog enters a **bounded post-launch polling window of up to 1000ms (sampling every 250ms)** before taking the post-snapshot, because macOS may write the `.ips` crash report slightly after process termination (the kernel's CrashReporter writes asynchronously). The test FAILS if at ANY point in the polling window the post-snapshot has MORE entries than the pre-snapshot. The 500-1000ms window is empirically chosen to cover observed `.ips` write latency; tune up if false negatives appear. Implemented as a shared helper in `tests/_crash-watchdog.mjs` (~50 LOC; ~30 + ~20 for the polling); every packaged-binary test wraps its body with `withCrashWatchdog(async () => {...})`. The watchdog is the PROOF; the per-test pass is the SIGNAL. **Operational constraint (rev-2 retry L)**: the watchdog uses an mtime + bundle-id filter that CAN misattribute concurrent unrelated `lawbar` runs (e.g. a developer's parallel `npm run dev` session, or a stale dev launch leaving a delayed `.ips` write). Evidence runs MUST occur with NO parallel lawbar packaged/dev launches; CI should run in a clean user/session if available. Parent-pid correlation would tighten the attribution but is not worth blocking on — `.ips` files do not carry the test runner's pid; macOS does not expose a guaranteed parent-pid handshake for crash reports. Document the constraint in the WI #1 README/test header. |
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
| **High** (rev-1 per M1 — scope corrected) | Playwright packaged-launch (`electron.launch({executablePath, args:[]})`) safety across REPEATED RUNS is unverified for the crash class. The WI-A precedent is observational, not categorical. **`app.evaluate` is downstream of the AppKit-init crash point** — it runs only AFTER launch completes successfully, so it cannot observe AppKit-init crashes. The risk is in the LAUNCH itself across many iterations, not in `app.evaluate`. The crash class (HIToolbox `_RegisterApplication` abort during early NSApplication init) may or may not be triggered by Playwright's launch path; observational absence in WI-A's small sample is not proof. | §11 evidence step (rev-1: permanent crash-report watchdog) is the load-bearing defence — every packaged verification test snapshots `~/Library/Logs/DiagnosticReports/lawbar*.ips` pre/post and FAILS if it grew. The repeated-run loop is **confidence evidence only, not proof** (rev-1 per M2). If new crash reports appear during ANY verification test run, the recommendation is INVALIDATED and the lane returns here for re-evaluation; Options 1 + 4 become candidates. |
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
