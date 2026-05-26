# PLAN — WI-pkg-verify-detection-redesign (PLAN-ONLY)

**Status**: PLAN-ONLY rev-0.2-DRAFT-PENDING-REVIEW (supersedes rev-0.1 after review-plan-mplxbmie-nv7db9 returned NEEDS-FIX with 4 Mediums + 2 Lows — see §19 + §20 changelogs). rev-0 baseline → rev-0.1 (7M fixed) → rev-0.2 (4M+2L fixed).
**Date**: 2026-05-25.
**Author**: Claude Code on explicit user direction (WI-pkg-verify-detection-redesign lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Parent plan**: `dev-memo/plan-packaged-probe-verification-00.md` (rev-3.1 at HEAD `20af81e`) §26 step 1. This plan IS the "full implementation plan for the §24 wrapper + light helper" that §26 step 1 calls for. WI-pkg-verify-detection-impl (§26 step 2) executes this plan as code.

This plan does NOT implement anything. It produces the implementation blueprint WI-2 must follow.

## §1 — Scope + non-goals

### In scope (plan-only)
- Exact architecture of the §24 fail-closed crash-detection wrapper script (file path, CLI signature, env-var contract, phase ordering, exit-code contract).
- Exact architecture of the light test helper (`launchPackaged` + pid log; JSON-line schema; helper file path).
- Concrete decisions for §24's three CI enforcement guards (parent §24 explicitly leaves them for WI-1; this plan resolves them).
- Concrete decisions for candidate-discovery scan strategy (parent §24 step 5c — union of filename-filtered + bundle-id-filtered scans; this plan defines the bundle-id scan's directory budget + permission failure handling).
- Concrete attribution rules (parent §24 step 5d — at least one of pid / bundle id / procPath / procName; this plan picks the procName allowlist regex + procPath prefix derivation + pid-log JSON-line schema).
- Settle-window contract: default value, env-var name, measurement protocol, upper bound, CI floor.
- Wrapper exit-code contract for every branch of parent §24 step 5e-h.
- Wrapper logging contract (what the developer sees when an .ips lands, when it doesn't, when CI guards trip).
- Wrapper darwin-only guard (wrapper is darwin-only by design; non-darwin invocation should produce a clear no-op or skip behavior).
- Acceptance criteria the eventual WI-2 must meet to be considered "lands READY" — including the §25 ≥50-run reproduction step's input contract.
- Risks + mitigations + open questions for cc-suite review.

### Out of scope (deferred or forbidden by user authorization)
- Any code implementation (script bodies, test bodies, `package.json` edits, npm script rewires).
- Any change to `apps/lawbar-desktop/electron/main.ts` (production binary stays untouched).
- Any new runtime dependency.
- IPC implementation restart (`dev-memo/plan-casebox-ipc-impl-00.md` stays as the untracked stopped draft).
- Product UI / case-box UI / real-data persistence.
- Tier 2 SQLCipher / Keychain / signing / notarization / distribution / telemetry / cloud / go-live.
- The PoC WI (parent §26 step 3) — sequenced AFTER WI-2.
- The retire WI (parent §26 step 4) — sequenced AFTER WI-3.
- ESM evidence-2 mechanism redesign — that's WI-3's plan gate per parent §26 step 3; the wrapper is detection-side and does NOT solve evidence-2.
- The §25 ≥50-run reproduction execution — that's WI-2's acceptance step, not this plan's deliverable.
- Cross-platform parity (the .app is darwin-only per `.claude/rules/client-local-first.md`; the wrapper inherits that scope).
- Crash-dialog suppression of any kind (no `Info.plist` change, no `LSUIElement`, no `LSBackgroundOnly`).

## §2 — Existing context used

- `dev-memo/plan-packaged-probe-verification-00.md` (rev-3.1; HEAD `20af81e`) — parent plan; this WI implements its §24 + §26 step 1.
- `/Users/zhongyibao/Library/Logs/DiagnosticReports/lawbar-2026-05-25-110405.ips` — the falsifying crash report driving the redesign (parsed in parent §21).
- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` — rollback record for the reverted PoC; the 3 prior Class A crashes are cataloged here.
- `apps/lawbar-desktop/package.json` — current scripts; this plan defines how WI-2 will rewire `test:packaged` without changing the script in THIS plan.
- `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` — WI-A test file; this plan defines how `launchPackaged` replaces direct `electron.launch` in WI-2.
- `apps/lawbar-desktop/electron/main.ts` — production binary; STAYS UNTOUCHED.
- `.claude/rules/cc-suite.md` — review-plan policy (high-risk doc requires §"Review packet (compact)").
- `.claude/rules/autonomy.md` — hard-stop list; informs §13.
- `.claude/rules/security-boundary.md` — "Required loop" gate; informs §11 acceptance.
- `.claude/rules/loc-guardian.md` — LOC thresholds (~800 source / ~1200 test); informs §14.
- `.claude/rules/staging-hygiene.md` — explicit-staging commit discipline.
- `.claude/rules/client-local-first.md` — darwin-only v1; informs §10.
- Electron 34.5.8 documentation for `electronApp.process()` (returns the Electron main process; `pid` accessible).
- Apple's CrashReporter `.ips` format reference: two concatenated JSON documents per file. First is the header (small; metadata). Second is the body (larger; includes `pid`, `bundleInfo`, `exception`, `procPath`, `procName`, threads).

## §3 — Wrapper script architecture

### §3.1 File path

`apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`

Single file. ESM (`.mjs` extension; package.json `type: module` is consistent). No new directory creation (the `scripts/` dir does not yet exist; `mkdir -p` runs once at WI-2 time).

### §3.2 CLI signature

```
test-packaged-wrapper.mjs [--test-files <glob...>] [--settle-seconds <N>] [--strict-unattributed <bool>]
```

All flags optional; all overridable by env vars (env wins is documented but flags MAY be added in WI-2 for ergonomic invocation). Default invocation:

```
node apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs
```

Equivalent to:

```
node --test apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs
```

with all detection wiring layered around it.

### §3.3 Env-var contract (wrapper INPUTS)

| Env var | Default | Purpose |
|---|---|---|
| `LAWBAR_TEST_SETTLE_SECONDS` | `30` | Post-`node --test` sleep duration before final .ips scan. Configurable upward; CI MUST enforce minimum floor of 30 (see §6). |
| `LAWBAR_TEST_STRICT_UNATTRIBUTED` | `true` | Default-strict: unattributed `.ips` matching bundle-id/procPath/procName fails the run. Settable to `false` ONLY in interactive dev (CI bypass impossible per §6). |
| `LAWBAR_CI` | `false` | When `true`: §6 CI enforcement guards activate. CI MUST set this. **(rev-0.1)** Either `LAWBAR_CI=true` OR the standard `CI=true` (set by every major CI runner — GitHub Actions, GitLab, CircleCI, etc.) activates CI mode; the wrapper treats `isCi = (env.LAWBAR_CI === "true") OR (env.CI === "true")`. |
| `LAWBAR_TEST_FILES` | `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` | The test file glob the wrapper passes to `node --test`. |
| `LAWBAR_DIAGNOSTIC_DIR` | `~/Library/Logs/DiagnosticReports` | Crash-report directory. Configurable for unit-testing the wrapper itself (the synthetic-detector smoke per §11 G2.4 uses this to point at a test directory). |
| `LAWBAR_ALLOW_UNWRAPPED_TEST` | `false` | Optional companion to the §11 temp banner-failure guard. Tests check this in dev to allow direct unwrapped runs; CI MUST refuse to honor `true`. |
| `LAWBAR_TEST_OBSERVE_SECONDS` | unset | **(rev-0.1; replaces removed `OBSERVE_FOREVER`)** Bounded measurement-mode duration. When set: wrapper extends Phase 4 settle to this many seconds (instead of `LAWBAR_TEST_SETTLE_SECONDS`); used during WI-2's §11 G2.7 reproduction to capture per-iteration max .ips latency without unbounded waiting. Hard upper bound: 600 (10 min); values above clamp + warn. **CI guard**: if `isCi == true` AND `LAWBAR_TEST_OBSERVE_SECONDS` is set, wrapper exits 2 in Phase 1 (rev-0.2 L-A: was "Phase 2" in rev-0.1 before the §3.5 phase rename) with `error: LAWBAR_TEST_OBSERVE_SECONDS is dev-only; not allowed in CI`. Accidental CI enablement CANNOT hang the job — the variable is rejected at config-validation time. |

### §3.4 Env-var contract (wrapper OUTPUTS to child)

The wrapper exports these into the env it passes to `node --test`. Test code reads them via `process.env`:

| Env var | Type | Purpose |
|---|---|---|
| `LAWBAR_TEST_PID_LOG` | absolute path | Tempfile path where `launchPackaged` appends one JSON line per launch. |
| `LAWBAR_TEST_SUITE_START` | ISO-8601 timestamp | Suite start time (used by both the wrapper itself AND optionally by tests for diagnostic timing). |
| `LAWBAR_TEST_BUNDLE_ROOTS` | colon-separated list of absolute paths | The .app bundle root directories the wrapper considers "tested" (used for procPath attribution; populated from the same logic the test files use to find the .app). |

### §3.5 Phase ordering

Canonical ordering as of rev-0.2 (phases numbered to reflect actual execution order; CI/config validation runs first so misconfiguration fails fast without touching FS state):

```
Phase 0: Platform guard
  - if process.platform !== "darwin" → exit 0 (skip; no-op; print "test-packaged-wrapper skipped: darwin-only").

Phase 1: CI guard + config validation
  - Compute isCi = (env.LAWBAR_CI === "true") OR (env.CI === "true").
    (Canonical isCi rule used across §6, §7, §9, §11, §4.2 — rev-0.2 L-A.)
  - If isCi AND LAWBAR_TEST_STRICT_UNATTRIBUTED=false → exit 2 with message
    "CI must use strict mode" (per §6 guard #1).
  - If isCi AND LAWBAR_TEST_SETTLE_SECONDS < 30 → exit 2 with message
    "CI must enforce settle ≥30s".
  - If isCi AND LAWBAR_TEST_OBSERVE_SECONDS is set → exit 2 with message
    "LAWBAR_TEST_OBSERVE_SECONDS is dev-only; not allowed in CI" (per §3.3 M7).
  - If LAWBAR_TEST_OBSERVE_SECONDS > 600 → clamp to 600 + warn (dev mode only;
    CI was already rejected above).
  - All checks are PURE config validation — no filesystem reads, no temp files.

Phase 2: Pre-scan
  - Record suite-start ISO timestamp.
  - Snapshot pre-existing files in LAWBAR_DIAGNOSTIC_DIR matching the
    candidate-discovery scan (§5.1).
    (This snapshot is the BASELINE for "files written during suite".)
  - Create tempfile (mkstemp under os.tmpdir()/lawbar-test-pid-XXXX.jsonl) → LAWBAR_TEST_PID_LOG.
  - Compute wrapper sentinel → LAWBAR_WRAPPER_VERSION = "<package-json-script-name>:<wrapper-mjs-mtime-iso>"
    (per §6 Guard #3 rev-0.1).
  - Resolve .app bundle roots → LAWBAR_TEST_BUNDLE_ROOTS.
    (See §5.4 for the resolution algorithm; matches the test files' existing findPackagedBinary logic.)

Phase 3: Run tests
  - spawnSync("node", ["--test", ...LAWBAR_TEST_FILES.split(",")], { env: childEnv, stdio: "inherit" }).
  - Capture child exit code.

Phase 4: Settle
  - settleSeconds = LAWBAR_TEST_OBSERVE_SECONDS (if set; dev-only per Phase 1 guard)
                    ELSE LAWBAR_TEST_SETTLE_SECONDS (default 30).
  - sleep(settleSeconds * 1000).
  - (No work during sleep; resource-cheap.)

Phase 5: Post-scan + attribution
  - Read LAWBAR_TEST_PID_LOG → recordedPids set (§5.3).
  - Candidate discovery (§5.1).
  - For each candidate not in Phase-2 snapshot AND mtime ≥ suite-start: parse .ips header+body, evaluate attribution (§5.2), classify as HIGH-CONFIDENCE / HELPER-PROCESS / UNATTRIBUTED-PARENT / ATTRIBUTION_UNKNOWN / NOT-ATTRIBUTED.
  - Aggregate: any HIGH-CONFIDENCE = FAIL; any HELPER-PROCESS / UNATTRIBUTED-PARENT / ATTRIBUTION_UNKNOWN in strict mode = FAIL; NOT-ATTRIBUTED is logged but does not fail.

Phase 6: Exit-code resolution (§8)
  - See §8 for exact branching.

Phase 7: Cleanup
  - unlink LAWBAR_TEST_PID_LOG.
  - (DO NOT delete the .ips files even if attributed — they are the audit trail.)
```

### §3.6 Failure-mode handling

**(rev-0.1 M5 — unified parser-failure rule across §3.6, §8, §12; choose one behavior, consistently applied.)**

- If Phase 2 cannot read `LAWBAR_DIAGNOSTIC_DIR` (e.g., permissions): wrapper exits **4** (wrapper internal error) with a clear "cannot read DiagnosticReports — verify Full Disk Access for the terminal app" message. The test cannot run because the detection cannot run. This is a wrapper-side failure to perform scanning at all.
- If Phase 3 child crashes (`node --test` killed by signal, not exited): treat as test failure; still run Phase 4-5 in case an .ips landed. Exit code propagates per §8.
- If Phase 5 parse fails on a CANDIDATE .ips (malformed JSON in header OR body) — a file already SELECTED as a candidate by §5.1 (filename match OR header partial-lawbar-metadata indicator): classify the candidate as **`ATTRIBUTION_UNKNOWN`** with a `[parse-failed]` marker recording the parse error. In strict mode (default + CI), `ATTRIBUTION_UNKNOWN` counts as FAIL (exit **3**). Do NOT silently skip; do NOT use exit 4 for per-candidate parse failures (exit 4 is reserved for the wrapper's own bug or unreadable diagnostics directory per the first bullet).
- If the wrapper itself crashes mid-Phase: that's a wrapper-implementation bug that WI-2 must fix before landing. Exit 4.

The three-state cleanup:
- **Wrapper cannot scan** (unreadable dir / wrapper bug) → exit **4**.
- **Wrapper scanned, found a candidate, could not parse it** → exit **3** in strict mode (per `ATTRIBUTION_UNKNOWN`).
- **Wrapper scanned, parsed cleanly, attribution unambiguous** → exit per §5.2 decision tree + §8 branches.

## §4 — Light test helper architecture

### §4.1 File path

`apps/lawbar-desktop/tests/_launch-with-pid-log.mjs`

Convention: leading underscore indicates "test infrastructure, not itself a test" — matches the withdrawn `_crash-watchdog.mjs` convention (now retired).

### §4.2 Exported helper

```js
export async function launchPackaged(options, ctx) { ... }
```

`options` = the same options object the test would have passed to `_electron.launch(options)`.

`ctx` = `{ testName: string, iteration?: number }`. Helper computes `isCi = process.env.LAWBAR_CI === "true" || process.env.CI === "true"` (canonical rule per §3.5 Phase 1; rev-0.2 L-B unifies the helper's CI check with the rest of the plan). Helper reads `process.env.LAWBAR_TEST_PID_LOG`; if missing AND `isCi == true`, throws a clear error pointing at §6 Guard #3 (NOT §6 Guard #2; the top-of-file sentinel block IS Guard #3 per rev-0.1, and IS the authoritative CI bypass detector; this helper-side check is dev-only diagnostic that surfaces missing-wrapper conditions earlier inside a launching test). If missing AND `isCi == false` AND `LAWBAR_ALLOW_UNWRAPPED_TEST=true`: warn to stderr but proceed without pid-logging (dev convenience only).

Returns the `electronApp` instance from Playwright's `_electron.launch`.

### §4.3 JSON-line schema for pid log

One line per launch, appended atomically (use `fs.appendFileSync` with a small lock pattern or accept the race window — only one test runs at a time per `node --test` default; multi-process concurrency NOT in scope).

```json
{"pid": 12345, "launchedAt": "2026-05-25T19:00:00.000Z", "testName": "packaged smoke #2", "iteration": null, "bundleRoot": "/path/to/dist/mac-arm64/lawbar.app"}
```

Fields:
- `pid`: from `electronApp.process().pid` after launch resolves. Always present.
- `launchedAt`: ISO-8601 timestamp captured AFTER pid is read.
- `testName`: passed by the test author via `ctx.testName`. Required.
- `iteration`: integer for loop-iteration tests; `null` for one-shot tests.
- `bundleRoot`: the .app bundle root the test resolved (so post-suite attribution can match procPath against the SAME bundle that was launched).

### §4.4 What the helper does NOT do

- Does NOT close the .app. Test owns close.
- Does NOT poll for crashes. Wrapper owns the post-suite scan.
- Does NOT modify `electronApp.process()`. Returns the raw instance.
- Does NOT serialize concurrent launches. Tests run sequentially under `node --test` by default.

## §5 — Candidate discovery + attribution (concrete)

### §5.1 Candidate-discovery scan (parent §24 step 5c)

Two parallel scans of `LAWBAR_DIAGNOSTIC_DIR`:

**Scan A — filename-filtered**:
- `glob("lawbar*.ips")` over the directory (case-sensitive; Apple convention is lowercase).
- Filter to entries with `mtime ≥ suiteStart`.

**Scan B — directory-wide lawbar-attribution-filtered** (rev-0.1 M3 — do NOT gate body parsing on header alone; rev-0.2 M-B — split header parse from body parse so a header-matched-but-body-malformed file is still a candidate):

For each `.ips` file in the directory with `mtime ≥ suiteStart` AND mtime < (suiteStart + Phase-3 elapsed + settleSeconds + 5s grace), execute the following two-pass parse:

1. **Header parse** (cheap; ~1ms per file): read the first JSON document. If JSON.parse throws, skip the file (header itself is malformed — no positive criterion to consider). If the header parses, check: `header.bundleID === "io.lawbar.desktop"`. If true, the file IS A CANDIDATE (header is a positive criterion); continue to Pass 2.
2. **Body parse** (~5-10ms per file): read the second JSON document. Two outcomes:
   - **Body parses** → check body criteria: file is a candidate if `body.bundleInfo.CFBundleIdentifier === "io.lawbar.desktop"` OR `body.procPath` matches §5.4 normalization OR `body.procName` matches §5.5 allowlist. Pass result to §5.2 attribution.
   - **Body parses fails** (malformed JSON) →
     - If the file is ALREADY a candidate from Pass 1 (header.bundleID matched) — OR — Scan A's filename glob (`lawbar*.ips`) also matched the file: the file IS A CANDIDATE; classify as `ATTRIBUTION_UNKNOWN` per §3.6 rev-0.1 M5 (strict-mode exit 3). Body details (procName / procPath / pid) are unavailable for the attribution tree but the file's existence as a lawbar-marked candidate is sufficient signal.
     - If the file has NO positive header criterion AND was NOT selected by Scan A filename glob: silently drop the file (it was being examined speculatively; no positive criterion → no harm to skip).

Rationale (rev-0.1 M3 + rev-0.2 M-B remediation): a helper crash MAY have a non-`lawbar*.ips` filename AND MAY have empty or different header `bundleID` (Apple's header schema has varied across macOS versions; the body field is often authoritative). Gating body parsing on header alone — as rev-0 did — discards exactly the helper-crash class Scan B was meant to catch. Splitting header parse from body parse ensures a file whose header IS `io.lawbar.desktop` but whose body is malformed CANNOT slip through as a silent drop; it correctly becomes `ATTRIBUTION_UNKNOWN` and fails in strict mode per the unified §3.6 rule.

**Union**: deduplicate by absolute path; the union is the candidate set. A file picked up by EITHER scan is a candidate.

**Directory budget**: in the worst case (busy CI runner with many crashes from other apps), Scan B parses every `.ips` in the directory. macOS ReportCrash directory typically holds dozens of files; <100 .ips parses is sub-second. If the directory has >500 .ips files, Scan B logs a warning but completes. No hard cap (caps would create false negatives).

**Permission failures**: see §3.6.

### §5.2 Attribution rules (parent §24 step 5d)

For each candidate, parse the .ips body's JSON. Read:
- `pid` (number).
- `bundleInfo.CFBundleIdentifier` (string; case-sensitive match).
- `procPath` (string; may contain `/Users/USER/*/...` placeholders in some macOS versions). **(rev-0.1 M4 — normalization anchor is `lawbar.app/`, NOT `lawbar.app/Contents/MacOS/`, so helper binaries under `lawbar.app/Contents/Frameworks/<HelperName>.app/Contents/MacOS/<HelperBinary>` normalize correctly.)** **(rev-0.2 M-C — narrowed: suffix-only match is no longer sufficient on its own. A path containing a bare final `lawbar.app/` like `/Applications/lawbar.app/...` from a completely unrelated user app must NOT attribute.)** Normalization algorithm:
  1. **Absolute-prefix match (primary; preferred when path is unredacted)**: for each entry in `LAWBAR_TEST_BUNDLE_ROOTS`, test `procPath.startsWith(rootEntry + "/")`. If any matches: procPath attribution HOLDS unconditionally (the absolute path is the tested .app exactly; no further check needed).
  2. **Redacted-path fallback (only when absolute prefix did not match)**: Find the LAST occurrence of `lawbar.app/` in `procPath`. If absent, procPath does NOT match — proceed to other attribution criteria.
     - Let `bundleSuffix` = the substring from `lawbar.app/` to end.
     - Suffix-shape gate (rev-0.2 M-C narrowing — must match one of the expected packaged-root redaction shapes):
       - `procPath` matches `/Users/USER/*/.../lawbar.app/...` (macOS placeholder redaction of `/Users/<name>/.../lawbar.app/...`), OR
       - `procPath` matches `*/dist/mac-(arm64|x64|<other>)/lawbar.app/...` (electron-builder output convention), OR
       - `procPath` matches `*/release/mac-(arm64|x64|<other>)/lawbar.app/...` (electron-builder alt output convention), OR
       - `procPath` starts with `lawbar.app/` (unusual but possible if mtree truncates the leading segments).
     - If the suffix-shape gate does NOT match: procPath does NOT match (suffix-only is insufficient).
     - If the suffix-shape gate DOES match: suffix-match is provisional and MUST be combined with at least ONE secondary attribution signal to hold:
       - `body.bundleInfo.CFBundleIdentifier === "io.lawbar.desktop"`, OR
       - `body.procName` matches the §5.5 allowlist regex, OR
       - `pid ∈ recordedPids`.
     - Suffix-match WITHOUT a secondary signal does NOT attribute (prevents `/Applications/lawbar.app/...` false-positive from a different user app coincidentally named `lawbar`).
  3. Either absolute-prefix-match OR (redacted-fallback + secondary-signal) → procPath attribution holds.

  Examples that MUST match:
  - `/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/dist/mac-arm64/lawbar.app/Contents/MacOS/lawbar` (main; absolute prefix matches `LAWBAR_TEST_BUNDLE_ROOTS` entry).
  - `/Users/USER/*/dist/mac-arm64/lawbar.app/Contents/MacOS/lawbar` + bundleInfo.CFBundleIdentifier=`io.lawbar.desktop` (main; placeholder; secondary bundleId signal).
  - `/Users/USER/*/dist/mac-arm64/lawbar.app/Contents/Frameworks/lawbar Helper.app/Contents/MacOS/lawbar Helper` + procName=`lawbar Helper` (helper; placeholder; secondary procName signal).

  Examples that MUST NOT match (false-positive guard):
  - `/Applications/SomeUnrelatedApp.app/Contents/MacOS/notlawbar` (no `lawbar.app/` substring at all).
  - `/tmp/staging/notlawbar.app/Contents/MacOS/notlawbar` (no `lawbar.app/` substring).
  - `/Applications/lawbar.app/Contents/MacOS/lawbar` with bundleInfo.CFBundleIdentifier=`org.someone-else.lawbar-other` AND procName=`lawbar-other` (rev-0.2 M-C false-positive case: bare `lawbar.app/` present but absolute-prefix does NOT match the tested .app, suffix-shape gate does NOT match a packaged-root redaction shape, no secondary signal — MUST NOT attribute). Add this as G2.4.h false-positive fixture (rev-0.2 M-C addition; see §11 G2.4).
- `procName` (string).

Attribution decision tree (rev-0.2 M-D — added explicit `procName`-only branch so a candidate selected solely by §5.5 procName allowlist correctly classifies as HELPER-PROCESS, not silently falls through to NOT-ATTRIBUTED):

```
if pid ∈ recordedPids AND bundleID == "io.lawbar.desktop"
  → HIGH-CONFIDENCE (main process from a test-launch).
  → FAIL in any mode.

else if bundleID == "io.lawbar.desktop"
  → HELPER-PROCESS or UNATTRIBUTED-PARENT.
  → procName allowlist check (§5.5): matches → HELPER-PROCESS.
  → otherwise → UNATTRIBUTED-PARENT (could be a stale crash from an earlier lawbar instance, or a parent process the wrapper didn't track).
  → FAIL in strict mode (default + CI). WARN in `LAWBAR_TEST_STRICT_UNATTRIBUTED=false` dev mode.

else if procPath attribution holds per §5.2 (absolute-prefix OR redacted-fallback+secondary-signal, per rev-0.2 M-C)
  → HELPER-PROCESS (helper crashed; bundle id may be empty in some helper crashes).
  → FAIL in strict mode.

else if procName matches §5.5 allowlist regex (rev-0.2 M-D — new branch)
  → HELPER-PROCESS (helper crashed; procName is the only positive signal).
  → FAIL in strict mode.
  → Rationale: a candidate that reached the attribution tree via §5.1 Scan B's procName-match path MUST have a corresponding attribution branch; otherwise G2.4.c (helper procName alone) silently classifies as NOT-ATTRIBUTED and the strict-mode expectation fails. This branch closes that loop.

else if pid ∈ recordedPids (but no other lawbar signal — bundle id, procPath, procName all non-matching)
  → SUSPICIOUS-PID-REUSE (rev-0.2: pid matched a recorded launch but no other metadata is lawbar; almost certainly pid reuse after the launched .app's process exited).
  → Log diagnostic with the recorded launch context AND the candidate's actual bundleId / procName / procPath.
  → Do NOT fail (the candidate is not actually a lawbar crash; pid alone without lawbar metadata is not high-confidence).
  → Per G2.4.g.

else
  → NOT-ATTRIBUTED.
  → Log filename + reason for transparency; do NOT fail.
```

### §5.3 Pid log read

```
parse LAWBAR_TEST_PID_LOG as JSON-lines (one JSON object per line; ignore blank lines).
recordedPids = set of .pid values.
recordedLaunches = list of full objects (used for diagnostic output on attribution).
```

If the log file is missing AND Phase 3 succeeded: warn to stderr (the test author forgot to use `launchPackaged`); treat all candidates as UNATTRIBUTED-PARENT.

### §5.4 Bundle-root resolution

Match the existing test-file logic (`smoke.packaged.electron.test.mjs:findPackagedBinary`):
- Host-arch first (`mac-arm64` on arm64, `mac-x64` / `mac` on x64).
- Cross-arch fallback.
- Search under both `apps/lawbar-desktop/dist/` and `apps/lawbar-desktop/release/`.
- Collect ALL existing bundle roots (not just the first; the wrapper attributes against any of them in case a test launches multiple variants).

### §5.5 procName allowlist regex

```
^lawbar( Helper( \([A-Za-z]+\))?)?$
```

Matches: `lawbar`, `lawbar Helper`, `lawbar Helper (Renderer)`, `lawbar Helper (GPU)`, `lawbar Helper (Network)`, `lawbar Helper (Plugin)`, `lawbar Helper (FutureName)`.

Does NOT match: `lawbar-other-thing`, `LawBar` (case differs).

The regex is documented + commented in the wrapper source so future Electron helper name additions are a one-line maintenance edit.

## §6 — CI enforcement guards (concrete decisions)

Parent §24 §"CI enforcement (rev-3.1)" requires THREE guards; parent says "WI-1 plan must define exact guards chosen." Decisions:

### Guard #1 — `STRICT_UNATTRIBUTED=false` impossible in CI

**Decision** (rev-0.2 Low fix — was misleadingly worded "hybrid — early exit AND silent override"; the actual contract is early-exit-only): early exit with clear message; NO silent override. Operator must fix the env, not rely on the wrapper to silently re-enable strict mode.

Implementation contract:
- If `isCi == true` (per §3.5 Phase 1 canonical rule: `isCi = LAWBAR_CI === "true" || CI === "true"`; rev-0.2 L-A) AND `LAWBAR_TEST_STRICT_UNATTRIBUTED=false`: wrapper exits 2 IMMEDIATELY in Phase 1 (rev-0.2 L-A: was "Phase 2" in rev-0.1) with `error: LAWBAR_TEST_STRICT_UNATTRIBUTED=false is forbidden in CI (isCi=true; CI=<val> LAWBAR_CI=<val>). Either unset LAWBAR_TEST_STRICT_UNATTRIBUTED or unset both CI and LAWBAR_CI for this run.`
- The wrapper does NOT silently treat `false` as `true` — silent overrides hide operator intent. The early exit forces a job-config fix.

### Guard #2 — direct unwrapped execution blocked in CI

**Decision**: both rails (package.json script routing AND test-file env-var check).

Implementation contract:
- Rail A: WI-2 mutates `apps/lawbar-desktop/package.json` `test:packaged` script to invoke the wrapper. The PRIOR script body (`node --test tests/smoke.packaged.electron.test.mjs`) becomes the wrapper's `LAWBAR_TEST_FILES` default. CI invokes `npm run test:packaged` only.
- Rail B: At the top of `tests/smoke.packaged.electron.test.mjs` (after the existing module imports), add the sentinel check from Guard #3 below (rev-0.1 — Guard #3 is now the load-bearing sentinel; Rail B inlines that check).

### Guard #3 — wrapper-sentinel-pair (LOAD-BEARING; rev-0.1 M1)

**Decision**: a sentinel pair — `LAWBAR_TEST_PID_LOG` AND `LAWBAR_WRAPPER_VERSION` — both set by the wrapper, both checked by the test files. Test files MUST fail in CI if either is absent. This replaces rev-0's diagnostic-only Guard #3.

Implementation contract:
- Wrapper exports BOTH `LAWBAR_TEST_PID_LOG=<absolute-tempfile-path>` AND `LAWBAR_WRAPPER_VERSION=<package-json-script-name>:<wrapper-mjs-mtime-iso>` into the child env. Both are set in Phase 2 (per §3.5 rev-0.1 ordering).
- The top-of-file sentinel block in `tests/smoke.packaged.electron.test.mjs` (rev-0.1 expanded to cover both absences):

```js
// Wrapper sentinel — see dev-memo/plan-pkg-verify-detection-redesign-00.md §6 Guard #3.
// Either LAWBAR_CI=true OR CI=true triggers CI mode (matches reviewer's bonus guidance).
const __isCi = process.env.LAWBAR_CI === "true" || process.env.CI === "true";
if (__isCi) {
  const __missing = [];
  if (!process.env.LAWBAR_TEST_PID_LOG)  __missing.push("LAWBAR_TEST_PID_LOG");
  if (!process.env.LAWBAR_WRAPPER_VERSION) __missing.push("LAWBAR_WRAPPER_VERSION");
  if (__missing.length > 0) {
    console.error(
      `[smoke.packaged] FATAL: must run through scripts/test-packaged-wrapper.mjs in CI; missing env: ${__missing.join(", ")}`,
    );
    process.exit(2);
  }
}
```

- The sentinel pair is LOAD-BEARING because:
  - `LAWBAR_TEST_PID_LOG` absence means pid-correlation attribution cannot work.
  - `LAWBAR_WRAPPER_VERSION` absence means the test ran without the wrapper at all (no Phase 4 settle, no Phase 5 post-scan), so no detection happens AT ALL.
  - Either absence in CI is an absolute failure-to-detect; tests must refuse to run.
- In dev (non-CI), the sentinel block does NOT exit. Dev runs may legitimately want to invoke `node --test tests/smoke.packaged.electron.test.mjs` directly for fast iteration; the test still launches the .app but without wrapper-side detection — the developer is responsible for visual inspection. This is acceptable in dev because dev is interactive; CI is not.
- §11 G2.8.d-i implements the rev-0.2 M-A 8-row parameterized matrix covering both CI forms (`LAWBAR_CI=true`, `CI=true`) × three absence forms (PID_LOG absent alone, WRAPPER_VERSION absent alone, both absent), plus a both-CI-form sanity row and a dev-mode negative row. See §11 G2.8 for the explicit row-by-row matrix.

### Rationale for these picks

- Early-exit beats silent-override on Guard #1 because silent overrides confuse the operator. The 11:04 RCA showed that hidden mechanism behavior is worse than loud failure.
- Two rails on Guard #2 because the package.json route is fragile (one careless edit removes it; a developer reverting CI config could miss it). Sentinel in the test file survives package.json drift.
- **(rev-0.1)** Guard #3 promoted to a LOAD-BEARING sentinel pair — `LAWBAR_TEST_PID_LOG` AND `LAWBAR_WRAPPER_VERSION` — both checked by test files, both required to be present in CI. This closes the wrapper-bypass vector that rev-0's diagnostic-only Guard #3 left open per review M1.
- Recognizing standard `CI=true` (in addition to custom `LAWBAR_CI=true`) per reviewer's bonus guidance closes the case where a CI runner sets only `CI=true` without explicit `LAWBAR_CI=true`.

## §7 — Settle-window + ReportCrash latency

### §7.1 Default

`LAWBAR_TEST_SETTLE_SECONDS=30`.

Rationale: the single observed Class B .ips landed ~3s post-exit. A 10× margin gives headroom for CI load. The single observation is N=1 — the impl WI's measurement step (§11 G2.7) tunes upward if observed-max exceeds 30s.

### §7.2 Configurability

- Settable upward per invocation. Useful for `LAWBAR_TEST_SETTLE_SECONDS=60` during the §25 reproduction run.
- Settable downward ONLY in non-CI dev (the wrapper's CI guard #1 floor in Phase 1 (rev-0.2 L-A: was "Phase 2" in rev-0.1) enforces 30s minimum when `isCi == true`).

### §7.3 Measurement protocol (WI-2 acceptance input)

WI-2 must measure observed-max .ips-write latency during the §25 ≥50-run reproduction. Recording:
- For each .ips that lands in any of the 50 runs: record `(.ips mtime) - (test process exit timestamp)`.
- Aggregate min / median / p95 / max.
- Write the table to the WI-2 commit message.
- If max > 30s: WI-2 commit must bump `LAWBAR_TEST_SETTLE_SECONDS` default (this plan's §3.3) AND update Guard #1's CI floor accordingly. The change requires its own re-review by cc-suite.

### §7.4 Hard upper bound

None enforced in code. Settle ≥120s would exceed reasonable CI runtime; if observed-max > 60s the lane should re-evaluate Option 2a vs Option 4 (`open -a`) per parent §25 Outcome B — escalating to a different launch mechanism may be cheaper than waiting longer.

## §8 — Wrapper exit-code contract

| Code | When |
|---|---|
| `0` | `node --test` exit 0 AND no attributable .ips after Phase 5. |
| `1` | `node --test` exit non-zero AND no attributable .ips (pass-through test failure). |
| `2` | CI guard tripped in Phase 1 (rev-0.1 reorder: was Phase 2): `STRICT_UNATTRIBUTED=false` in CI; settle floor violated; `LAWBAR_TEST_OBSERVE_SECONDS` set in CI per M7; OR Guard #3 sentinel-pair check failed inside a child test file. |
| `3` | Attributable .ips found in Phase 5 (regardless of test exit code; crash detection is the load-bearing finding). Includes ATTRIBUTION_UNKNOWN per rev-0.1 M5 unified rule: a candidate selected by §5.1 whose body cannot be parsed counts as a strict-mode FAIL (exit 3). Output includes the .ips path + recorded launch context (if any) + crash signature top frames (if parseable). |
| `4` | Wrapper internal error — the wrapper cannot perform scanning/parsing AT ALL due to its own bug or unreadable diagnostics directory (DiagnosticReports permission denied; pid-log write failed in Phase 2). **Per-candidate parse failures are NOT exit 4**; they are exit 3 per M5 unified rule. Output includes diagnostic. |

The exit codes are stable; `0` is success; everything else is failure. CI scripts MAY distinguish `2` vs `3` vs `1` for triage but the common path is "non-zero = fail".

## §9 — Wrapper logging contract

### §9.1 Success path
```
[test-packaged-wrapper] Starting (suite=<files>, settle=30s, strict-unattributed=true, isCi=false (LAWBAR_CI=false, CI=false))
[test-packaged-wrapper] Pre-scan: <N> existing lawbar*.ips in DiagnosticReports
[test-packaged-wrapper] Bundle roots: /Users/.../dist/mac-arm64/lawbar.app
... (node --test output) ...
[test-packaged-wrapper] Test exit: 0
[test-packaged-wrapper] Sleeping 30s for crash-report settle
[test-packaged-wrapper] Post-scan: <N+M> lawbar*.ips total (<M> new)
[test-packaged-wrapper] Bundle-id scan: <K> additional candidates checked
[test-packaged-wrapper] Attribution: 0 HIGH-CONFIDENCE / 0 HELPER-PROCESS / 0 UNATTRIBUTED-PARENT / 0 ATTRIBUTION_UNKNOWN / <M-not-attributed> NOT-ATTRIBUTED (logged)
[test-packaged-wrapper] SUCCESS (exit 0)
```

### §9.2 Crash-detected path
```
[test-packaged-wrapper] CRASH DETECTED
  - .ips path: /Users/.../lawbar-2026-05-25-110405.ips
  - attribution: HIGH-CONFIDENCE (pid 55008 matches launch "packaged smoke #2" at 2026-05-25T15:04:01.692Z)
  - exception.type: EXC_BAD_ACCESS
  - exception.signal: SIGSEGV
  - procName: lawbar
  - top frames:
      v8::HandleScope::HandleScope(v8::Isolate*) +12
      v8::internal::ThreadIsolation::WriteProtectMemory ...
      __19-[NSWindow __close]_block_invoke +148
      -[NSWindow __close] +376
      -[NSApplication(NSResponder) sendAction:to:from:] +560
  - file mtime: 2026-05-25T15:04:05.000Z (3.3s post-exit; within settle window)
[test-packaged-wrapper] FAILED (exit 3)
```

### §9.3 CI guard path
```
[test-packaged-wrapper] FATAL: LAWBAR_TEST_STRICT_UNATTRIBUTED=false is forbidden in CI (isCi=true; CI=true and/or LAWBAR_CI=true).
  - either unset LAWBAR_TEST_STRICT_UNATTRIBUTED, or
  - unset both CI and LAWBAR_CI for this run.
[test-packaged-wrapper] FAILED (exit 2)
```

CI form-recognition note (rev-0.2 L-A): `isCi` is true when EITHER `CI=true` (standard, set by GitHub Actions / GitLab CI / CircleCI / Travis / etc.) OR `LAWBAR_CI=true` (custom override) holds. Logs always show both raw env values so the operator can identify which one tripped the guard.

## §10 — Wrapper's own ESM compatibility

The wrapper is a normal `.mjs` script run by Node (NOT by Playwright's `app.evaluate` vm). It can `import` anything Node's ESM loader supports — including dynamic `import()` of `node:*` modules. No ESM blocker here.

The wrapper does NOT solve the parent's §26 step 3 ESM evidence-2 blocker (the `app.evaluate` better-sqlite3 round-trip mechanism). That's WI-3's responsibility. Mentioning it here ONLY to confirm this WI does not regress it.

## §11 — Acceptance criteria for WI-2 (the impl WI)

WI-2 lands READY only when ALL of:

- **G2.1** — `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` exists per §3 architecture; passes cc-suite audit.
- **G2.2** — `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` exists per §4 architecture; passes cc-suite audit.
- **G2.3** — `apps/lawbar-desktop/package.json` `test:packaged` script rewired to invoke the wrapper (Guard #2 Rail A). No other package.json changes.
- **G2.4** — synthetic-detector attribution fixture matrix (rev-0.1 M6 — expanded from single pid-match smoke to a full attribution surface). All cases use `LAWBAR_DIAGNOSTIC_DIR` pointed at an isolated `os.tmpdir() + "/lawbar-detector-smoke-XXXX/"`. The wrapper is invoked with `LAWBAR_CI=true` + a synthetic `LAWBAR_TEST_PID_LOG` containing recorded launches; behavior asserted against expected exit code:
  - **G2.4.a — main pid match**: write `lawbar-<ts>.ips` whose body `pid` matches a recorded launch; body bundle id = `io.lawbar.desktop`; procName = `lawbar`. Wrapper exits **3** (HIGH-CONFIDENCE).
  - **G2.4.b — non-`lawbar*.ips` body bundle-id match**: write `notlawbar-name-<ts>.ips` whose body `bundleInfo.CFBundleIdentifier === "io.lawbar.desktop"`; pid NOT in recordedPids. Wrapper exits **3** in strict mode (UNATTRIBUTED-PARENT or HELPER-PROCESS depending on procName).
  - **G2.4.c — helper procName match**: write `lawbar Helper (Renderer)-<ts>.ips`; procName = `lawbar Helper (Renderer)`; pid NOT in recordedPids; body bundle id may be empty or unrelated to test the procName allowlist independently. Wrapper exits **3** (HELPER-PROCESS).
  - **G2.4.d — helper procPath under Frameworks**: write `<any>.ips`; procPath = `/Users/USER/*/dist/mac-arm64/lawbar.app/Contents/Frameworks/lawbar Helper.app/Contents/MacOS/lawbar Helper`; procName = `lawbar Helper`; verifies §5.2 rev-0.1 M4 normalization anchors at `lawbar.app/` (not `Contents/MacOS/`). Wrapper exits **3**.
  - **G2.4.e — unrelated `lawbar*.ips` not attributed**: write `lawbar-other-app-<ts>.ips` whose body bundle id = `org.someone-else.lawbar-other`; pid NOT in recordedPids; procName = `lawbar-other`; procPath does NOT contain `lawbar.app/`. Wrapper exits **0** (NOT-ATTRIBUTED; logged but not failed) — proves false-positive guard.
  - **G2.4.f — malformed candidate strict failure**: write `lawbar-<ts>.ips` with truncated body JSON (header parses; body parse fails). Wrapper exits **3** (ATTRIBUTION_UNKNOWN per §3.6 rev-0.1 M5 — strict mode treats unparseable candidate as fail).
  - **G2.4.g — pid-reuse diagnostic**: write `<any>.ips` whose body `pid` MATCHES a recorded launch BUT body bundle id is non-lawbar AND procName is non-lawbar AND procPath does NOT match. Wrapper logs as `SUSPICIOUS-PID-REUSE` and exits **0** (NOT-ATTRIBUTED) — pid match alone without any other lawbar metadata is NOT high-confidence; reviewer's review-question 8 explicitly raised this. The logging is the diagnostic; the non-failure is the correct safe default.
  - **G2.4.h — procPath false-positive guard (rev-0.2 M-C)**: write `<any>.ips` whose body `procPath = /Applications/lawbar.app/Contents/MacOS/lawbar` (a different user app coincidentally named `lawbar`); body `bundleInfo.CFBundleIdentifier = "org.someone-else.lawbar-other"`; body `procName = "lawbar-other"`; pid NOT in recordedPids. Absolute-prefix MUST NOT match `LAWBAR_TEST_BUNDLE_ROOTS` (which point at the tested dist/ paths). Suffix-shape gate (§5.2 redacted-path fallback) MUST NOT match (path is `/Applications/...`, not `*/dist/mac-*/lawbar.app/...` or `/Users/USER/*/.../lawbar.app/...`). procName does NOT match §5.5 allowlist (`lawbar-other` is rejected). Bundle id does NOT match. Wrapper exits **0** (NOT-ATTRIBUTED) — proves the M-C narrowing rejects the unrelated-app false-positive.
  Required: at least one parameterized test in `apps/lawbar-desktop/tests/main.test.mjs` (or a dedicated test file) covers each of G2.4.a through G2.4.h. Failing ANY sub-case blocks WI-2 from landing.
- **G2.5** — Guard #3 sentinel pair landed in `tests/smoke.packaged.electron.test.mjs` per §6 Guard #3 rev-0.1. **AND** (rev-0.1 M2): ALL existing `electron.launch` invocations in `tests/smoke.packaged.electron.test.mjs` MUST be migrated to `launchPackaged(options, ctx)` in this WI. The migration is NOT optional and NOT deferrable. Rationale: G2.7's ≥50-run reproduction must exercise the pid-correlation topology end-to-end; running it against unmigrated `electron.launch` calls would test only bundle-id/procPath fallback (no pid match possible) and produce a false-confidence Outcome A. Follow-up migration to `launchPackaged` is acceptable ONLY for FUTURE/NEW packaged tests added after WI-2; the three existing WI-A tests are in scope for WI-2.
- **G2.6** — WI-A regression: `npm run test:packaged` under the wrapper passes for the 3 existing WI-A tests + the new synthetic-detector smoke. All passing. No attributable .ips.
- **G2.7** — §25 ≥50-run reproduction: re-run `npm run test:packaged` (under wrapper) ≥50 times sequentially. Record per-iteration outcome. Record observed-max .ips write latency per §7.3. Outcome A (zero attributable .ips in 50 runs) → Option 2a cleared. Outcome B (≥1 attributable .ips) → STOP, escalate to parent §25 Outcome B launch-mechanism review.
- **G2.8** — CI guard tests in `tests/main.test.mjs` (pure-Node; no Electron). Each test invokes the wrapper as a subprocess with a controlled env and asserts the exit code. Required cases (rev-0.1 M1 + M7 expanded):
  - **G2.8.a — Guard #1 `STRICT_UNATTRIBUTED=false` in CI**: env `LAWBAR_CI=true LAWBAR_TEST_STRICT_UNATTRIBUTED=false` → wrapper exits **2** in Phase 1.
  - **G2.8.b — same as G2.8.a but with `CI=true` instead of `LAWBAR_CI=true`** (covers reviewer's bonus guidance on recognizing standard `CI=true`).
  - **G2.8.c — Guard #1 settle floor in CI**: env `LAWBAR_CI=true LAWBAR_TEST_SETTLE_SECONDS=10` → wrapper exits **2** with "CI must enforce settle ≥30s".
  - **G2.8.d-i — Guard #3 sentinel-pair absence matrix (rev-0.2 M-A: parameterized over BOTH CI forms × all THREE absence forms)**. Invocation pattern: `node --test tests/smoke.packaged.electron.test.mjs` directly (no wrapper) with the specified env; the test file's top-of-file sentinel block (§6 Guard #3 rev-0.1) MUST exit **2** in every CI-form case AND MUST NOT exit on sentinel absence in the dev case.

    | sub-case | CI form | LAWBAR_TEST_PID_LOG | LAWBAR_WRAPPER_VERSION | expected exit |
    |---|---|---|---|---|
    | G2.8.d.1 | `LAWBAR_CI=true` | absent | absent | **2** |
    | G2.8.d.2 | `CI=true` | absent | absent | **2** |
    | G2.8.d.3 | `LAWBAR_CI=true` | absent | `foo:bar` | **2** |
    | G2.8.d.4 | `CI=true` | absent | `foo:bar` | **2** |
    | G2.8.d.5 | `LAWBAR_CI=true` | `/tmp/foo.jsonl` | absent | **2** |
    | G2.8.d.6 | `CI=true` | `/tmp/foo.jsonl` | absent | **2** |
    | G2.8.d.7 | both `LAWBAR_CI=true` AND `CI=true` | absent | absent | **2** (sanity — recognizes either-form `isCi`) |
    | G2.8.d.8 (dev) | (neither CI form set) | absent | absent | **NOT 2** (dev mode does NOT exit on sentinel absence per §6 Guard #3 rev-0.1) |

    Six positive (.1-.7 except dev) + one sanity (.7) + one negative (.8 dev). G2.8.d.5 and G2.8.d.6 specifically address rev-0.1 M1's "WRAPPER_VERSION absent alone in CI"; G2.8.d.3 and G2.8.d.4 address "PID_LOG absent alone in CI"; G2.8.d.1 and G2.8.d.2 address "both absent in CI". The implementation is one parameterized test loop in `tests/main.test.mjs` that iterates the 8 rows; per-row assertion is the child test process's exit code. Each row's env is the ONLY env modification — no implicit inheritance.
  - **G2.8.j — M7 `LAWBAR_TEST_OBSERVE_SECONDS` rejected in CI**: env `LAWBAR_CI=true LAWBAR_TEST_OBSERVE_SECONDS=120` → wrapper exits **2** in Phase 1 with "dev-only; not allowed in CI".
  - **G2.8.k — M7 `LAWBAR_TEST_OBSERVE_SECONDS` accepted in dev**: env `LAWBAR_TEST_OBSERVE_SECONDS=60` (no CI sentinels) + a no-op child test → wrapper Phase 4 uses 60s settle; exits **0**.
  - **G2.8.l — M7 clamp**: env `LAWBAR_TEST_OBSERVE_SECONDS=9999` (dev) → wrapper clamps to 600, prints warning, continues.
  Failing ANY sub-case blocks WI-2 from landing.
- **G2.9** — cc-suite review-plan on WI-2's own plan returns READY (or Low-only) before any WI-2 implementation lands.
- **G2.10** — cc-suite audit on WI-2's implementation diff returns 0 C / 0 H / 0 M.
- **G2.11** — cc-suite verify confirms G2.10.
- **G2.12** — commit message records the 11-field cc-suite recording + the G2.7 observed-max latency table.

If G2.7 produces Outcome B, WI-2 STILL LANDS (the wrapper itself is correct and useful — it caught the crash). Parent §25 Outcome B escalation is a SEPARATE follow-up WI (re-review of launch mechanism choice), not a WI-2 blocker.

## §12 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High** | The wrapper's settle window (default 30s) bounds detection latency. A crash whose .ips lands at second 31 escapes detection in the current run. Tunable but not eliminable. | §7.3 measurement during WI-2 tunes default; §7.4 escalation to Option 4 if observed-max > 60s. **(rev-0.1 M7)** For empirical latency measurement, add `LAWBAR_TEST_OBSERVE_SECONDS=<N>` env var (replaces removed `LAWBAR_TEST_OBSERVE_FOREVER`). Behavior: BOUNDED — when set, Phase 4 uses N seconds (instead of `LAWBAR_TEST_SETTLE_SECONDS`); hard upper bound 600 (10 min); clamp + warn above. CI-FAILING — Phase 1 rejects with exit 2 if either `LAWBAR_CI=true` OR `CI=true`. Specified in env contract (§3.3), phase ordering (§3.5 Phase 1 + Phase 4), exit-code contract (§8), G2.7 procedure (§7.3 — used to record per-iteration max latency without unbounded waiting), and G2.8 tests (.j/.k/.l). Accidental CI enablement cannot hang — the variable is rejected at config-validation time. |
| **Medium** | macOS ReportCrash may emit a `.ips` AFTER the wrapper's Phase 4 sleep completes — e.g., if the system is paging heavily. The wrapper would miss it on the current run; a SUBSEQUENT run's Phase-1 pre-scan would record it as pre-existing and ALSO miss it. | Phase 1's pre-existing snapshot is "files that existed at suite-start"; the wrapper's diff is against THAT, not against the previous run. So a late-arriving .ips from run N would be detected in run N+1's Phase 5 (its mtime ≥ run N+1's suite-start) IF the wrapper is invoked again. Out-of-band: WI-2's reproduction step (G2.7) MUST also do a final post-suite `ls -t ~/Library/Logs/DiagnosticReports/lawbar*.ips` and warn if any new files exist beyond the wrapper's own attribution — belt-and-suspenders. |
| **Medium** | Apple `.ips` JSON format has changed in minor macOS versions; the wrapper's parse may break under macOS 16+. | Parse is defensive — read header, try-catch, fall back to "treat as candidate; classify NOT-ATTRIBUTED" if parse fails. Logs the parse failure. Does NOT silently pass. WI-2 adds a smoke test against the actual 11:04 .ips file (checked into repo as a fixture under `apps/lawbar-desktop/tests/fixtures/sample-ips/`? — decision deferred to WI-2 plan-review since fixtures are out of THIS plan's scope). |
| **Medium** | The wrapper's `electronApp.process().pid` recording captures the MAIN process pid. On macOS, Electron also spawns helper processes (renderer, GPU, network, utility). Helper crashes would have DIFFERENT pids, none of which are in `recordedPids`. The wrapper attributes via bundle-id / procPath / procName instead — but if a future Electron release changes helper naming OR runs helpers as sub-processes of a different bundle id, attribution misses. | §5.5 procName allowlist regex is forward-compat for `lawbar Helper (Anything)`. §5.2 procPath prefix check catches helpers at `lawbar.app/Contents/Frameworks/.../*Helper*`. Both can drift if Electron restructures. WI-2 documents the assumption + adds a smoke test that verifies the regex matches Electron 34.5.8's actual helper names by parsing a `ps -ax` snapshot during a test launch (defensive; out of THIS plan's exact scope). |
| **Low** | The synthetic-detector smoke (G2.4) writes a fake .ips into a temp dir. If the temp dir is not isolated from `~/Library/Logs/DiagnosticReports/`, contamination is possible. | `LAWBAR_DIAGNOSTIC_DIR` env var. G2.4 sets it to `os.tmpdir() + "/lawbar-detector-smoke-XXXX/"`. Wrapper has no special-case for the real path — it just reads whatever directory it's pointed at. |
| **Low** | The pid-log JSON-line write race (multiple concurrent `launchPackaged` calls) could interleave bytes. | `node --test` runs tests sequentially by default. `launchPackaged` callers MUST be sequential. If a future test runs concurrent launches, the WI that introduces that pattern handles file-locking or per-launch tempfiles. Out of WI-2 scope. |

No Critical risks. If reviewer disagrees, the H1 "settle window is bounded" is the most likely escalation candidate.

## §13 — Hard stops

Per `.claude/rules/autonomy.md` §"Hard-stop list" — this plan triggers NONE:
- No push, deploy, release, production, migration, auth provider, cloud vendor.
- No new runtime dependency.
- No public API change.
- No schema change.
- No secrets / credentials / billing.
- **NO `Info.plist` mutation, NO `LSUIElement`, NO `LSBackgroundOnly`, NO crash-dialog suppression** — re-affirmed; the wrapper detects crashes, never suppresses them.
- NO IPC implementation. NO product UI. NO case-box UI. NO real case data. NO Tier 2.

Per `.claude/rules/cc-suite.md` §"High-risk WIs" — this plan IS high-risk (verification topology decision; replaces falsified PERMANENT defence in parent rev-3.1). `/cc-suite:review-plan` is REQUIRED before WI-2 implementation.

## §14 — LOC budget hints

| Artifact | Est new LOC | Threshold |
|---|---|---|
| `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` | ~250 (script body + parse + scan + logging) | 800 (source) |
| `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` | ~60 (helper + JSDoc) | 1200 (test) |
| `apps/lawbar-desktop/tests/main.test.mjs` additions (Guard tests G2.8) | ~150 | 1200 (test) |
| `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (sentinel + maybe launchPackaged migration) | +20 to +60 | 1200 (test) |
| `apps/lawbar-desktop/package.json` (script rewire) | +1 line | n/a |
| This plan file | ~600 (doc) | 1200 (doc) |

All well within loc-guardian thresholds. WI-2 may revise estimates during plan-review; ≥800 LOC source means WI-2's plan must propose a file split BEFORE coding.

## §15 — Out-of-scope (reaffirmation)

THIS plan does NOT:
- Implement anything.
- Mutate `package.json` (deferred to WI-2).
- Mutate `electron/main.ts` (production binary STAYS UNTOUCHED).
- Restart `dev-memo/plan-casebox-ipc-impl-00.md` (the IPC plan remains stopped).
- Touch `apps/lawbar-desktop/src/probes/caseBoxProbe.ts` (kept until WI-retire-probe-case-box, which is WI-4 per parent §26).
- Add new dependencies.
- Mutate `Info.plist`, `LSUIElement`, `LSBackgroundOnly`, crash-dialog suppression.
- Restart product / case-box UI work.
- Persist real legal data.
- Tier 2 SQLCipher / Keychain / signing / notarization / distribution / telemetry / cloud / go-live.

## §16 — Review packet (compact)

**Active plan summary** (rev-0.2 — updated to reflect rev-0.1 + rev-0.2 changes): WI-pkg-verify-detection-redesign is the plan-only sub-WI that produces the implementation blueprint for the §24 fail-closed crash-detection wrapper (parent `dev-memo/plan-packaged-probe-verification-00.md` rev-3.1 at HEAD `20af81e`, §26 step 1). This plan defines: (1) wrapper architecture (file path `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`; CLI signature; 8-phase ordering — Phase 0 platform guard / Phase 1 CI guard + config validation / Phase 2 pre-scan / Phase 3 run tests / Phase 4 settle / Phase 5 post-scan + attribution / Phase 6 exit-code resolution / Phase 7 cleanup; 7-env-var input contract including bounded `LAWBAR_TEST_OBSERVE_SECONDS`; 3-env-var output-to-child contract); (2) light helper architecture (file path `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs`; `launchPackaged(options, ctx)` export; JSON-line pid-log schema); (3) candidate-discovery + attribution model (two-scan union — filename + body-attribution-filtered; two-pass parse with `ATTRIBUTION_UNKNOWN` for header-matched-body-malformed; attribution branches — pid + bundleId + procPath (absolute-prefix primary, redacted-shape + secondary-signal fallback) + procName allowlist regex `^lawbar( Helper( \([A-Za-z]+\))?)?$` + explicit SUSPICIOUS-PID-REUSE for pid-only matches); (4) three concrete CI enforcement guards keyed on canonical `isCi = LAWBAR_CI === "true" || CI === "true"` (Guard #1 early-exit-only on `STRICT_UNATTRIBUTED=false`+`isCi`; Guard #2 dual rails — package.json script routing AND test-file sentinel block; Guard #3 LOAD-BEARING sentinel pair — `LAWBAR_TEST_PID_LOG` AND `LAWBAR_WRAPPER_VERSION` both required in CI); (5) settle-window contract (default 30s; configurable upward; CI floor 30s; bounded dev-only `LAWBAR_TEST_OBSERVE_SECONDS` ≤600 for WI-2 G2.7 measurement); (6) exit-code contract (0/1/2/3/4 stable; 3 includes ATTRIBUTION_UNKNOWN); (7) acceptance criteria for WI-2 — 12 gates G2.1-G2.12 including 8-case synthetic-detector attribution matrix (G2.4.a-h) + ≥50-run reproduction + 8-row sentinel-absence × CI-form matrix (G2.8.d-i) + bounded observe-mode tests (G2.8.j-l) + observed-max latency measurement; (8) risks (1 H, 4 M, 2 L; no Critical). The wrapper does NOT solve parent's §26 step 3 ESM evidence-2 blocker (deferred to WI-3); does NOT touch production binary (`electron/main.ts` untouched); does NOT mutate `package.json` (deferred to WI-2). High-risk per cc-suite §"High-risk WIs" — review-plan required.

**Exact target files (this plan)**:
- `dev-memo/plan-pkg-verify-detection-redesign-00.md` (new, this file).

**Exact target files (eventual WI-2; NOT this plan)**:
- `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` (new; ~250 LOC).
- `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` (new; ~60 LOC).
- `apps/lawbar-desktop/tests/main.test.mjs` (existing; +150 LOC for Guard tests).
- `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (existing; +20-60 LOC for sentinel + optional `launchPackaged` migration).
- `apps/lawbar-desktop/package.json` (existing; +1 line — `test:packaged` script body change).

**Exact acceptance criteria (eventual WI-2)**: §11 G2.1-G2.12 — 12 numbered gates.

**Exact out-of-scope (this plan)**:
- Any code implementation.
- Any `package.json` / `Info.plist` / `LSUIElement` / `LSBackgroundOnly` mutation.
- ESM evidence-2 mechanism redesign (deferred to WI-3 per parent §26 step 3).
- §25 ≥50-run reproduction execution (acceptance step for WI-2, not deliverable here).
- IPC implementation restart.
- Product UI / case-box UI / real-data / Tier 2 / signing / distribution / telemetry / cloud / go-live.

**Essential references**:
- `dev-memo/plan-packaged-probe-verification-00.md` (rev-3.1 at HEAD `20af81e`) — parent plan; this WI implements §24 + §26 step 1.
- `/Users/zhongyibao/Library/Logs/DiagnosticReports/lawbar-2026-05-25-110405.ips` — the falsifying crash report.
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Review packet (compact)" + §"Required recording".
- `.claude/rules/security-boundary.md` §"Required loop" — automated test + audit + verify gates.
- `.claude/rules/autonomy.md` §"Hard-stop list" — none triggered by this plan.

**Review questions** (target the load-bearing assumptions):
1. (rev-0.2 — RESOLVED in rev-0.1, retained as a confirmation question.) The §3.5 phase ordering puts CI/config validation in Phase 1 (pure config check; no FS reads) and pre-scan in Phase 2 (per the rev-0.1 reorder applied per reviewer's bonus guidance and re-confirmed in rev-0.2 §3.5 banner). Reviewer: please confirm this ordering is still considered correct (failing fast on misconfigured CI without touching DiagnosticReports), or flag if a different ordering would better serve diagnostic capture for future debugging.
2. Is §5.5's procName allowlist regex `^lawbar( Helper( \([A-Za-z]+\))?)?$` sufficient? Could future Electron version names use non-`[A-Za-z]` characters (digits, hyphens, spaces beyond the one allowed) in helper variants? The current regex's failure mode is HELPER-CRASH-NOT-ATTRIBUTED (false negative on detection); reviewer may prefer a more permissive regex with bundle-id + procPath as primary attribution rails.
3. Is Guard #1 (early-exit on `STRICT_UNATTRIBUTED=false`+`LAWBAR_CI=true`) too strict? Some CI workflows may want a soft-warn mode for early debugging. The plan chose hard-fail to preserve the "fail-closed in CI" invariant; reviewer may push back.
4. Is the `LAWBAR_DIAGNOSTIC_DIR` env var (§3.3) a security-relevant attack surface? An attacker who can set this env could point the wrapper at an empty dir and pass the detection. Mitigation: the wrapper runs ONLY in test contexts (CI or developer machine); an attacker controlling test env is already a worse problem. Reviewer may prefer hard-coding the path.
5. Are §11's 12 WI-2 gates correctly bounded? In particular, is G2.7 (≥50-run reproduction) PRE-conditional on G2.1-G2.6 landing first (i.e., the wrapper must work before reproduction starts)? Or can they happen in parallel? The plan implies sequential — reviewer may want parallel for time efficiency.
6. Is the §10 statement "wrapper does NOT solve the ESM evidence-2 blocker" the right scope cut, or should this plan ALSO outline a candidate evidence-2 mechanism to de-risk WI-3? Plan chose strict scope; reviewer may prefer broader.
7. Are the §12 risks correctly scored? The High (settle-window bound) is the most-likely escalation candidate to cc-suite Critical if the reviewer thinks the bound is unrecoverable rather than configurable.
8. Should the §5.2 attribution decision tree handle a candidate whose `pid ∈ recordedPids` BUT `bundleID != "io.lawbar.desktop"`? (Almost certainly a pid-reuse collision; the launched .app's process exited and another process reused the pid.) Plan currently classifies this as NOT-ATTRIBUTED via the "else" branch; reviewer may want a separate diagnostic class.

## §17 — Stop condition

This plan becomes stale when:
- `WI-pkg-verify-detection-impl` (WI-2) lands per §11 acceptance criteria. After: this plan is the as-built reference.
- Parent rev-3.1 §22 Class B reproduces ≥1× per 50 runs in WI-2's G2.7. Triggers parent §25 Outcome B re-review of launch mechanism; this plan's wrapper design may still be reusable but the Option 2a sequencing changes.
- macOS introduces a fundamentally different crash-report mechanism (`.ips` format change; ReportCrash daemon replacement). Triggers a new plan revision.
- Electron changes its multi-process model in a way that invalidates §5.5's procName allowlist or §5.4's bundle-root resolution. Maintenance pass.

## §18 — Required cc-suite review

This plan is not authorized for promotion (status flip to READY) until:
1. `/cc-suite:review-plan dev-memo/plan-pkg-verify-detection-redesign-00.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The §3-§11 design decisions are not overridden without re-review.
4. WI-pkg-verify-detection-impl (WI-2) does NOT begin implementation until this plan is READY.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency between this plan and parent rev-3.1's §24 + §26.
- Realism of the 30s default settle window vs Apple ReportCrash latency observed during the impl WI's measurement step (which depends on this plan being implementable first).
- Whether the 3 CI guards together close all known bypass vectors OR leave undiscovered ones.
- Whether the synthetic-detector smoke (G2.4) is sufficient evidence the wrapper mechanism works.
- Whether §11's 12 gates are the right acceptance bar — neither over- nor under-strict.
- Hard-stop compliance — no `Info.plist`, `LSUIElement`, `LSBackgroundOnly`, crash suppression, prod-binary change, runtime dep, IPC restart, real-data, Tier 2/go-live.

This plan is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it defines the verification topology that all subsequent packaged-binary work depends on. `/cc-suite:review-plan` is REQUIRED before WI-pkg-verify-detection-impl can start.

## §19 — rev-0.1 changelog (post review-plan-mplwjvmk-pezqdb)

Review job `review-plan-mplwjvmk-pezqdb` (gpt-5.5 / high / read-only / 2026-05-26 ~00:33-00:35 UTC) returned NEEDS-FIX with 0 C / 0 H / 7 M / 0 L. All seven Mediums applied inline in this rev-0.1 plus reviewer's bonus guidance.

### Fixes applied

- **M1 — Guard #3 not actually a guard** → §6 Guard #3 promoted from diagnostic-only to LOAD-BEARING sentinel pair (`LAWBAR_TEST_PID_LOG` + `LAWBAR_WRAPPER_VERSION` BOTH required in CI). Test-file sentinel block updated to check both env vars; FATAL exit if either absent in CI. Guard #2 Rail B now inlines the Guard #3 sentinel block (single sentinel pair satisfies the parent §24 three-guard requirement by reference). §11 G2.8 expanded to 12 sub-cases (G2.8.a-l) covering both PID_LOG-absent and WRAPPER_VERSION-absent cases under both `LAWBAR_CI=true` and standard `CI=true`.

- **M2 — WI-2 could pass without migrating existing launches** → §11 G2.5 rewritten: ALL existing `electron.launch` calls in `tests/smoke.packaged.electron.test.mjs` MUST be migrated to `launchPackaged(options, ctx)` in WI-2 (not optional, not deferrable). Rationale captured: §11 G2.7's ≥50-run reproduction must exercise pid-correlation topology end-to-end; unmigrated launches would test only bundle-id/procPath fallback and produce false-confidence Outcome A.

- **M3 — Scan B bundle-id gating** → §5.1 Scan B rewritten: parses BOTH header AND body for every `.ips` in time window. A file is a candidate if ANY of (header.bundleID / body.bundleInfo.CFBundleIdentifier / body.procPath match / body.procName match) holds. Helper-crash class no longer dropped because header lacks bundleID. Body parse cost ~1-10ms per file; acceptable.

- **M4 — procPath normalization too main-process-specific** → §5.2 procPath rule rewritten: normalization anchor is `lawbar.app/` (not `lawbar.app/Contents/MacOS/`). Algorithm: find LAST `lawbar.app/`, take suffix from there, match against `LAWBAR_TEST_BUNDLE_ROOTS` basenames. Examples added covering helper procPaths under `Contents/Frameworks/<HelperName>.app/Contents/MacOS/` with both absolute and `/Users/USER/*` placeholder forms. G2.4.d added to acceptance fixtures.

- **M5 — Parser failure handling inconsistent** → unified rule across §3.6, §8, §12: (1) Wrapper cannot scan (unreadable dir / wrapper bug) → exit 4; (2) Wrapper scanned, candidate parse failed → ATTRIBUTION_UNKNOWN, strict-mode exit 3; (3) Wrapper scanned cleanly → §5.2 attribution decision tree. §3.6 three-state cleanup added. §8 exit-code table rewritten with explicit clarification that per-candidate parse failures are exit 3, not 4.

- **M6 — Synthetic detector gate too narrow** → §11 G2.4 expanded from single pid-match smoke to 7-case attribution fixture matrix (G2.4.a-g): main pid match, non-`lawbar*.ips` body bundle-id match, helper procName match, helper procPath under Frameworks, unrelated `lawbar*.ips` not attributed, malformed candidate strict failure, pid-reuse diagnostic. Failing any sub-case blocks WI-2.

- **M7 — `OBSERVE_FOREVER` unsafe** → removed entirely. Replaced with bounded `LAWBAR_TEST_OBSERVE_SECONDS=<N>` (hard upper bound 600s, clamp + warn above). CI-failing: Phase 1 rejects with exit 2 if either `LAWBAR_CI=true` or `CI=true` is set. Specified in env contract (§3.3), phase ordering (§3.5 Phase 1 + Phase 4 settle-source selection), exit-code contract (§8), and G2.7 + G2.8 tests (.j/.k/.l). Accidental CI enablement cannot hang.

### Bonus guidance applied

- **Phase 2 → Phase 1 (CI guard before pre-scan)** — §3.5 rewritten: Phase 1 is now pure config validation (no FS reads); Phase 2 does the pre-scan. Fails fast on misconfigured CI without touching DiagnosticReports.
- **Recognize standard `CI=true`** — §3.3 `LAWBAR_CI` row + §3.5 Phase 1 + §6 Guard #3 sentinel block + §11 G2.8 all updated: `isCi = (LAWBAR_CI === "true") OR (CI === "true")`. Closes the case where GitHub Actions / GitLab / CircleCI set only `CI=true`.
- **Keep hard-fail on `STRICT_UNATTRIBUTED=false` in CI** — §6 Guard #1 unchanged (decision validated by reviewer).
- **No CODEOWNERS/pre-commit hook** — confirmed out of scope for this WI (reviewer concurred).

### Diff scope (rev-0.1 vs rev-0)

- Top Status line (1 line edit).
- §3.3 — added `LAWBAR_TEST_OBSERVE_SECONDS` row; updated `LAWBAR_CI` to recognize `CI=true`.
- §3.5 — phase reorder (Phase 1 = CI guard validation; Phase 2 = pre-scan); Phase 4 settle-source selection added.
- §3.6 — three-state cleanup added; unified parse-failure rule.
- §5.1 — Scan B rewritten to parse body, not gate on header.
- §5.2 — procPath normalization rewritten with `lawbar.app/` anchor + examples.
- §6 Guard #3 — rewritten as LOAD-BEARING sentinel pair; Guard #2 Rail B inlines.
- §8 — exit-code table updated with M5 unified rule notes.
- §11 G2.4 — expanded to 7-case attribution fixture matrix.
- §11 G2.5 — migration of existing launches required (not optional).
- §11 G2.8 — expanded to 12 sub-cases covering all guard absence × CI-form combinations.
- §12 — H risk row's OBSERVE_FOREVER replaced with bounded OBSERVE_SECONDS.
- §19 (this changelog).

### Out of scope for rev-0.1

- No implementation. No dependency installation. No package.json mutation. No Info.plist / LSUIElement / LSBackgroundOnly / crash suppression. No IPC implementation. No product UI / case-box UI / real-data / Tier 2 / signing / distribution / telemetry / cloud / go-live work. No push.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-pkg-verify-detection-redesign-00.md` against rev-0.1 (this revision) to confirm M1-M7 are resolved and no new C/H/M findings surface.

## §20 — rev-0.2 changelog (post review-plan-mplxbmie-nv7db9)

Review job `review-plan-mplxbmie-nv7db9` (gpt-5.5 / high / read-only / 2026-05-26 ~00:55-00:57 UTC) returned NEEDS-FIX with 0 C / 0 H / **4 M** / **2 L**. Reviewer's resolution-status table on the rev-0.1 M1-M7 fixes: M2 + M7 RESOLVED; M1 / M3 / M4 / M6 PARTIAL (each had a remaining edge case); M5 NOT FULLY RESOLVED (§3.6 vs §5.1 conflicted on header-matched-body-malformed). All 4 Mediums + 2 Lows applied inline in this rev-0.2.

### Fixes applied

- **M-A — §11 G2.8 absence × CI-form matrix incomplete** → G2.8.d-i replaced flat sub-cases with an explicit 8-row parameterized matrix: `{LAWBAR_CI=true, CI=true, both, neither}` × `{PID_LOG absent alone, WRAPPER_VERSION absent alone, both absent}`. Each CI form is exercised for each absence form; dev (neither CI form) sub-case verifies sentinel does NOT exit. Implementation note: one parameterized test loop in `tests/main.test.mjs` iterating the 8 rows.

- **M-B — §3.6 vs §5.1 disagreement on header-matched-but-body-malformed** → §5.1 Scan B rewritten with explicit two-pass parse:
  - Pass 1 (header parse): if `header.bundleID === "io.lawbar.desktop"`, file IS A CANDIDATE; continue to Pass 2.
  - Pass 2 (body parse): if body parses, evaluate body criteria for attribution; if body parse fails AND (Pass 1 selected the file OR Scan A matched), classify as `ATTRIBUTION_UNKNOWN` per §3.6 rev-0.1 M5 → strict-mode exit 3. Only silently drop files with NO positive header criterion AND no Scan A match.
  - Resolves the §5.1/§3.6 conflict by routing all positive-criterion candidates through the unified parse-failure rule.

- **M-C — §5.2 procPath suffix normalization overbroad** → algorithm split into:
  - Step 1 absolute-prefix match (primary, preferred when path is unredacted) — unconditional match.
  - Step 2 redacted-path fallback only when absolute prefix did NOT match — suffix match accepted ONLY when (a) the suffix-shape matches an expected packaged-root redaction shape (`/Users/USER/*/.../lawbar.app/...` OR `*/dist/mac-*/lawbar.app/...` OR `*/release/mac-*/lawbar.app/...` OR leading `lawbar.app/`) AND (b) at least one secondary signal holds (bundle id OR procName allowlist OR pid match).
  - Bare `/Applications/lawbar.app/...` from an unrelated user app fails both gates (suffix shape doesn't match a packaged-root pattern AND no secondary lawbar signal) → no attribution.
  - G2.4.h false-positive fixture added.

- **M-D — §5.2 attribution tree missing `procName`-only branch** → added an explicit branch: `else if procName matches §5.5 allowlist regex → HELPER-PROCESS → FAIL in strict mode`. Rationale spelled out: candidates selected via §5.1 Scan B's procName-match path now have a corresponding attribution branch; G2.4.c (helper procName alone) correctly exits 3 instead of silently falling through to NOT-ATTRIBUTED. Also added the `pid ∈ recordedPids without other lawbar signal → SUSPICIOUS-PID-REUSE → log + exit 0` branch (was implicit; now explicit) so G2.4.g has an unambiguous decision-tree path.

- **L-A — stale phase/CI wording** → normalized:
  - §3.5 banner reworded ("Canonical ordering as of rev-0.2" — removed "Phase 2 swapped before Phase 1" stale text).
  - §3.3 OBSERVE row Phase reference changed from "Phase 2" to "Phase 1" with annotation.
  - §6 Guard #1 implementation contract switched from `LAWBAR_CI=true` to canonical `isCi` rule; phase reference corrected to "Phase 1".
  - §7.2 "Phase 2" → "Phase 1" + `LAWBAR_CI=true` → `isCi == true`.
  - §9.1 success-path log header now shows `isCi=false (LAWBAR_CI=false, CI=false)` and includes ATTRIBUTION_UNKNOWN bucket.
  - §9.3 CI guard-path log + new clarifying note: `isCi` is true when EITHER `CI=true` OR `LAWBAR_CI=true`; logs always show both raw env values so the operator can identify which form tripped the guard.

- **L-B — §4.2 helper CI rule mismatch** → helper now computes `isCi = process.env.LAWBAR_CI === "true" || process.env.CI === "true"` matching the rest of the plan. Error pointer corrected to §6 Guard #3 (the load-bearing sentinel — the helper-side check is supplementary diagnostic).

### Reviewer resolution table after rev-0.2

| Prior finding | rev-0.1 status | rev-0.2 fix | rev-0.2 status |
|---|---|---|---|
| M1 (G2.8 matrix incomplete) | PARTIAL | M-A: 8-row matrix added | RESOLVED |
| M2 (migration optional) | RESOLVED | — | RESOLVED |
| M3 (Scan B header gating) | PARTIAL | M-B: two-pass parse | RESOLVED |
| M4 (procPath overbroad) | PARTIAL | M-C: absolute-prefix primary + suffix-shape gate + secondary-signal | RESOLVED |
| M5 (parser failure inconsistent) | NOT FULLY RESOLVED | M-B: §5.1 routes positive-criterion candidates through §3.6's `ATTRIBUTION_UNKNOWN` rule | RESOLVED |
| M6 (synthetic detector matrix) | PARTIAL | M-D: procName-only attribution branch; G2.4.c now passable | RESOLVED |
| M7 (OBSERVE_FOREVER) | RESOLVED | — | RESOLVED |
| L-A (stale wording) | — | normalized §3.3/§3.5/§6/§7.2/§9 | RESOLVED |
| L-B (helper CI rule) | — | unified `isCi` rule in §4.2 | RESOLVED |

### Diff scope (rev-0.2 vs rev-0.1)

- Top Status line.
- §3.3 — `LAWBAR_CI` row reaffirmed canonical `isCi`; OBSERVE row Phase reference corrected.
- §3.5 — banner reworded; `isCi` rule canonicalized in Phase 1.
- §4.2 — helper `isCi` rule unified with rest of plan; error pointer corrected.
- §5.1 — Scan B rewritten with explicit two-pass parse + ATTRIBUTION_UNKNOWN routing for header-matched-body-malformed.
- §5.2 — procPath normalization narrowed (absolute-prefix primary, suffix-shape + secondary-signal fallback); decision tree gained procName-only branch + explicit SUSPICIOUS-PID-REUSE branch; G2.4.h false-positive fixture cited.
- §6 Guard #1 — implementation contract uses canonical `isCi`; Phase reference corrected.
- §7.2 — same.
- §9.1 — success-path log header includes raw `isCi` values and ATTRIBUTION_UNKNOWN bucket.
- §9.3 — CI guard-path log + clarifying note on `isCi` form recognition.
- §11 G2.4 — G2.4.h false-positive fixture added; G2.4.h listed in mandatory coverage.
- §11 G2.8 — G2.8.d-i rewritten as 8-row parameterized matrix.
- §20 (this changelog).

### Out of scope for rev-0.2

- No implementation. No dependency installation. No package.json mutation. No Info.plist / LSUIElement / LSBackgroundOnly / crash suppression. No IPC implementation. No product UI / case-box UI / real-data / Tier 2 / signing / distribution / telemetry / cloud / go-live. No push.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-pkg-verify-detection-redesign-00.md` against rev-0.2 (this revision) to confirm M-A / M-B / M-C / M-D / L-A / L-B are resolved and no new C/H/M findings surface.

## §21 — rev-0.2.1 — post-re-review Low fixes (review-plan-mplymh33-86tzgq)

Re-review job `review-plan-mplymh33-86tzgq` (gpt-5.5 / high / read-only / 2026-05-26 ~01:31-01:33 UTC) returned **READY-with-Low** with 0 C / 0 H / 0 M / **4 L**. Resolution table: M-A / M-B / M-C / M-D / L-A / L-B all RESOLVED. Four new Lows surfaced, all stale-text cleanup. All four applied inline as rev-0.2.1 before commit per user authorization (Low-only fixes pre-authorized):

- **Low #1 — §6 Guard #1 decision-line misleading** (line ~350). Fixed: replaced "hybrid — early exit with clear message AND silent override" with "early exit with clear message; NO silent override. Operator must fix the env, not rely on the wrapper to silently re-enable strict mode." (matches the implementation contract immediately below.)
- **Low #2 — §6 Guard #3 stale "9 sub-tests" reference** (line ~394). Fixed: replaced the inline 9-sub-tests note with a pointer to §11 G2.8's authoritative 8-row matrix; aligns with rev-0.2 M-A's actual gate.
- **Low #3 — §16 review question #1 about Phase reorder** (line ~624). Fixed: rewrote question #1 as a confirmation question ("the reorder is already applied; reviewer please confirm the current ordering is still correct or flag any concern") rather than the now-resolved dilemma.
- **Low #4 — §16 compact summary stale Guard wording** (line ~594). Fixed: compact summary now reflects (a) 8-phase ordering (was 7), (b) 7-env-var input contract (was 6; added `LAWBAR_TEST_OBSERVE_SECONDS`), (c) canonical `isCi` keying for guards (was `LAWBAR_CI=true`-only), (d) Guard #3 as LOAD-BEARING sentinel pair (was "wrapper-version env sentinel"), (e) two-pass parse + ATTRIBUTION_UNKNOWN routing, (f) narrowed procPath + procName-only attribution branch + SUSPICIOUS-PID-REUSE branch, (g) 8-case G2.4.a-h matrix (was 7), (h) 8-row G2.8.d-i matrix.

No new C/H/M findings introduced. The post-Low-fix doc is the committable artifact. No further review needed before commit per user authorization (Low-only fixes pre-authorized).
