# PLAN — Tarball PoC refresh (PLAN-ONLY)

**Status**: PLAN-ONLY rev-0.3-DRAFT-PENDING-REVIEW (supersedes rev-0.2 after review-plan-mpmgk6ew-kx2uu8 returned NEEDS-FIX with 1 M residual — bootstrap script lost fail-fast `&&` chaining in rev-0.2's H1-new rewrite; restored in rev-0.3 — see §18 changelog).
**Date**: 2026-05-26.
**Author**: Claude Code on explicit user direction (WI-revive-tarball-poc-refresh lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Parent references**:
- `dev-memo/plan-desktop-package-architecture-00.md` rev-3 READY (commit `e5cb773`) — the **design authority** for the Option 2 tarball-install architecture. UNCHANGED by this refresh.
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` rev-2 READY (commit `018a9a9`) — the **prior** PoC plan. Structurally invalidated by Class A crash class (per `dev-memo/rollback-ace57a0-pkg-arch-poc.md`). Used as the structural starting point; verification mechanism redesigned.
- `dev-memo/plan-packaged-probe-verification-00.md` rev-3.1 (commit `20af81e`) — packaged-probe verification redesign. §26 step 5 is the slot this WI refreshes; §26 step 3 ESM-evidence-2 plan gate is the load-bearing dependency.
- `dev-memo/plan-pkg-verify-detection-redesign-00.md` rev-0.2.1 (commit `7f16c5d`) — detection-impl plan (now implemented in WI-2).
- WI-pkg-verify-detection-impl commit `017c560` — the wrapper this refresh targets for verification.
- WI-retire-probe-case-box commit `45167b1` — the raw-spawn probe path is excised; no flag-handler residue in `electron/main.ts`.

This plan does NOT implement anything. It produces the refreshed blueprint for the eventual `WI-tarball-poc-impl` (or however the impl lane is named) implementation WI.

## §1 — Scope + non-goals

### In scope (plan-only)
- Decide the verification mechanism for the refreshed tarball PoC, given:
  - The empirical falsification of `app.evaluate` for ESM-context module imports (parent §26 step 3 ESM evidence-2 blocker).
  - The retirement of `--probe-case-box` (commit `45167b1`).
  - The availability of the WI-2 fail-closed crash-detection wrapper (`apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`).
- Confirm how `case-box-contract` and `case-box-persistence` will be staged + packed + installed into `apps/lawbar-desktop/` per package-arch §10 Option 2.
- Confirm how packaged verification runs **under the wrapper** (no raw `child_process.spawn`).
- Confirm how the **better-sqlite3 native-module round trip** is tested when `app.evaluate` cannot dynamic-import.
- Confirm the **exact file-level scope** of the future impl WI (no surprises at impl time).
- Enumerate all **STOP-AND-ASK** items (production-binary surface decisions; new runtime deps; etc.) so user authorization at impl time is explicit, not implicit.
- Include the cc-suite high-risk review packet.

### Out of scope (deferred or forbidden by user authorization)
- Any code implementation. `services/case-box-persistence/` and `docs/contracts/case-box-contract/` source UNCHANGED.
- Any package.json mutation beyond what the future impl WI will require (and even those are described HERE, not applied).
- Any change to `apps/lawbar-desktop/electron/main.ts` IN THIS PLAN. (The impl WI MAY introduce a narrow, env-gated test-helper code path per §6 below.)
- Any new runtime dependency.
- `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash-dialog suppression.
- IPC implementation (parent §26 step 6 — separately authorized).
- Product UI / case-box UI / real-data persistence.
- Tier 2 SQLCipher / Keychain / signing / notarization / distribution / telemetry / cloud sync / go-live / deployment.
- Workspace tool introduction (Option 1 in package-arch §5 was REJECTED; that decision stands).
- Replacing electron-builder.
- Re-introducing a `--probe-case-box` flag (retired; per WI-retire commit `45167b1`).

## §2 — Existing context used

- `dev-memo/plan-desktop-package-architecture-00.md` rev-3 READY at `e5cb773` — Option 2 (npm pack tarball install) is the architecture; this refresh implements it without reopening the decision.
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` rev-2 at `018a9a9` — used as the **structural template** for the refresh. Its §3 file enumeration + §4 pack-script design + §8 package.json modifications are largely reusable. Its §5 probe source + §6 smoke-test design + §7 main.ts probe handler are **REPLACED** by §6 + §7 of this plan.
- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` — the 7-field rollback record that ended the prior PoC. Its §4 reason paragraph + the "What comes next" footer are the seed for this refresh.
- `dev-memo/plan-packaged-probe-verification-00.md` rev-3.1 §22 Class A + Class B + detection-relevant subclasses; §24 fail-closed mechanism; §26 step 3 ESM evidence-2 plan gate; §26 step 5 tarball PoC revival slot.
- `dev-memo/plan-pkg-verify-detection-redesign-00.md` rev-0.2.1 §3-§11 (wrapper architecture + acceptance gates).
- WI-pkg-verify-detection-impl `017c560`: wrapper script at `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` (~450 LOC); helper at `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs`; comprehensive G2.4/G2.8/audit-M1/M2/M-new test coverage in `apps/lawbar-desktop/tests/wrapper.test.mjs` (31 tests).
- WI-retire-probe-case-box `45167b1`: removed `runCaseBoxProbe` import + IIFE flag handler + whenReady guard from `electron/main.ts`; deleted `src/probes/caseBoxProbe.ts` + `tests/smoke.native-module.electron.test.mjs`; deleted `test:probe` npm script.
- Current `apps/lawbar-desktop/package.json` dependencies: `better-sqlite3 ^12.9.0`. Devs: Electron 34, electron-builder 25, Playwright. Per WI-retire, no probe-related artifacts remain.
- `services/case-box-persistence/package.json`: name `case-box-persistence`, version `0.1.0`, main `./dist/index.js`, deps `better-sqlite3` + `case-box-contract`.
- `docs/contracts/case-box-contract/package.json`: name `case-box-contract`, version `0.1.0`, main `./dist/index.js`, deps `ajv` + `ajv-formats`, `files: ["dist", "schemas", "fixtures", "README.md"]`.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — tarball PoC is high-risk; review-plan + audit + verify chain REQUIRED.
- `.claude/rules/loc-guardian.md` — LOC thresholds (~800 source, ~1200 test).
- `.claude/rules/autonomy.md` §"Hard-stop list".

## §3 — What changed since rev-2 PoC plan (`018a9a9`)

| Aspect | Rev-2 PoC (`018a9a9`) | Refreshed PoC (this plan) |
|---|---|---|
| Verification harness | Raw `child_process.spawn` of the packaged .app with a `--probe-casebox-pkg-arch` flag; main-process IIFE-process.exit pattern | Playwright `electron.launch` via the WI-2 wrapper (`scripts/test-packaged-wrapper.mjs`); main process exits via `app.quit()` |
| Better-sqlite3 round-trip | Inside the IIFE handler in main.ts (top-of-file, before app.whenReady) | TBD — see §6 alternatives. Recommended: env-gated `globalThis` test hook installed at the end of `app.whenReady`, invoked from `app.evaluate` (the wrapper preserves crash safety) |
| Crash detection | None (the IIFE raced AppKit init; crash dialogs could appear) | The WI-2 wrapper observes `lawbar*.ips` files in `~/Library/Logs/DiagnosticReports/` and exits 3 on any attributable crash within the settle window |
| Probe flag in main.ts | New flag `--probe-casebox-pkg-arch` added | None. Production-binary surface change is reduced to a single env-gated function definition (§6 Option A1) OR avoided entirely (§6 Option D) |
| Test entry point | `npm run test:packaged` with the new probe smoke; raw spawn from `node --test` | `npm run test:packaged` (already routed through the WI-2 wrapper); the new tarball-PoC test wraps `launchPackaged(...)` per the WI-2 helper |
| Crash count baseline | 0 (pre-incident); the PoC introduced 3 .ips files | 4 (preserved across WI-2 + WI-retire); refreshed PoC must hold this baseline at "no new attributable .ips" |
| Coverage of better-sqlite3 native module under packaged Electron | Verified via the IIFE handler's round-trip | DEFERRED until this PoC's chosen mechanism executes (see §6 + §10 acceptance gates) |
| Coverage of case-box-contract import resolution under packaged Electron | Verified via the IIFE handler's `validateMatter` call | Verified by the chosen §6 mechanism |
| Coverage of ASAR packing semantics + electron-builder install-app-deps native rebuild | Verified structurally + via probe | Verified structurally (filesystem inspection of `lawbar.app/Contents/Resources/app.asar`) + runtime via §6 mechanism |
| Production binary impact | New flag handler + whenReady guard | TBD per §6; goal is minimal env-gated change OR zero change (§6 Option D) |

## §4 — Verification mechanism — 5 options

Verifying the tarball PoC at runtime requires running case-box-persistence + case-box-contract code **inside the packaged Electron main process**. Five options:

### Option A1 — Env-gated `globalThis` test hook in `electron/main.ts` (RECOMMENDED)

Production-binary change: in `electron/main.ts`, at the end of `app.whenReady().then(...)`, add:

```ts
if (process.env.LAWBAR_TARBALL_POC_TEST_HOOK === "true") {
  // @ts-ignore — test-only global. Removed at PoC retirement.
  (globalThis as any).__lawbarTarballPocProbe = async function (): Promise<unknown> {
    const { validateMatter } = await import("case-box-contract");
    const { createMatter } = await import("case-box-persistence");
    // Run a tiny round-trip: validate a fixture, persist it, read it back.
    // Implementation details deferred to impl WI; the signature is fixed here.
    return { ok: true, /* details */ };
  };
}
```

The test then runs (via the WI-2 wrapper):

```js
const app = await launchPackaged({
  executablePath: binary,
  args: [],
  env: { ...process.env, LAWBAR_TARBALL_POC_TEST_HOOK: "true", LAWBAR_MODE: "dev" },
}, { testName: "tarball PoC round-trip" });
const result = await app.evaluate(async () => {
  const fn = (globalThis as any).__lawbarTarballPocProbe;
  if (typeof fn !== "function") throw new Error("test hook not installed");
  return await fn();
});
assert.ok(result.ok);
```

Why this works:
- The dynamic `import("case-box-persistence")` runs inside the **packaged main process's own ESM loader** (not inside `app.evaluate`'s vm context), so the ESM blocker per parent §26 step 3 does NOT apply.
- `app.evaluate` only **invokes** the pre-installed `globalThis.__lawbarTarballPocProbe` function; it does NOT itself dynamic-import.
- The hook is gated by `LAWBAR_TARBALL_POC_TEST_HOOK=true` env var; in production launches (default), the env var is unset and the hook is not installed. No production-runtime impact.

**Pros**:
- Crash-safe: launch via WI-2 wrapper; no raw spawn; no IIFE-process.exit.
- ESM-compatible: dynamic import runs in the main process's native loader.
- Production binary impact minimal (one env-gated function).
- Reuses canonical wrapper + `launchPackaged` pattern.

**Cons**:
- Production binary contains test-only code (env-gated). Audit-sensitive: a misconfigured production .app launched with the env var set would install a test hook. Mitigation: env var name is namespaced (`LAWBAR_TARBALL_POC_TEST_HOOK`); production launchers don't set it; documented as test-only.
- Adds ~15-30 LOC to `electron/main.ts`. Increases main.ts complexity slightly.

### Option A2 — Renderer preload + IPC

Add a new IPC channel `tarball-poc:probe` that, when invoked from a hidden renderer, runs the round-trip in the main process and returns the result. Requires extending the preload + contextBridge surface.

**Pros**: same crash safety as Option A1.
**Cons**: requires the IPC layer to exist (parent §26 step 6 — currently blocked). Chicken-and-egg: the PoC is verifying the package architecture that the IPC impl depends on. **REJECTED** for sequencing reasons.

### Option A3 — `open -a` LaunchServices launch + result file

`open -a /path/to/lawbar.app --args --probe-tarball` writes round-trip result to `LAWBAR_TARBALL_POC_RESULT=/tmp/...`. Test polls the result file. Per parent §8 Option 4: rejected upstream for polling complexity + per-platform divergence. **REJECTED**.

### Option C — Structural-inspection-only (no runtime execution)

Verify package architecture via filesystem inspection alone:
- Confirm `apps/lawbar-desktop/node_modules/case-box-contract/package.json` carries the staged manifest (no `file:` deps; integrity hashes present in `package-lock.json`).
- Confirm `apps/lawbar-desktop/node_modules/case-box-persistence/dist/index.js` exists.
- Run `asar list lawbar.app/Contents/Resources/app.asar` and confirm the expected JS paths are present.
- Confirm `lawbar.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists (the native binding, unpacked per electron-builder `asarUnpack` config).
- Recursive symlink scan of `lawbar.app/Contents/Resources/` finds no escapes or dangling.

**Pros**: zero runtime execution; fast; deterministic; no production-binary change; no crash class concerns.
**Cons**: does NOT verify (a) ESM module resolution actually works inside Electron's runtime, (b) the native module loads under Electron's V8/Node ABI, (c) electron-builder's install-app-deps rebuild produced a binding compatible with the runtime. Significant evidence gap on the load-bearing question.

### Option D — Hybrid: structural inspection + minimal runtime smoke

Combine Option C structural checks with the existing WI-A test (which already launches the packaged .app + opens a window — proving Electron can boot the .app at all). Add no new runtime tests for case-box-* specifically.

**Pros**: zero production-binary change; reuses existing WI-A wrapper coverage.
**Cons**: same gap as Option C — better-sqlite3 native binding's Electron-ABI loadability is NOT exercised. The `case-box-contract` import is NOT exercised. The PoC's stated goal is "prove the package architecture works **end-to-end** inside a packaged Electron binary" — this option does NOT satisfy that.

### Comparison matrix

| Option | Crash-safe? | ESM-compatible? | Verifies runtime ABI? | Prod-binary change? | Recommended? |
|---|:---:|:---:|:---:|:---:|:---:|
| A1 env-gated globalThis hook | YES (wrapper) | YES (main-process loader) | YES | minimal (env-gated) | **YES** |
| A2 preload + IPC | YES (wrapper) | YES | YES | major (IPC layer) | NO — sequencing |
| A3 `open -a` + result file | UNVERIFIED | YES | YES | minimal | NO — upstream-rejected |
| C structural-only | n/a (no spawn) | n/a | NO | none | NO — evidence gap |
| D hybrid | YES (existing) | n/a (no test) | NO | none | NO — evidence gap |

## §5 — Tarball staging + electron-builder integration (refreshed from rev-2 §3-§4 + §8)

Reused from rev-2 PoC plan with minor updates. Key file enumeration:

### §5.1 NEW files (impl WI)

- `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` (~180 LOC; rev-0.1 expanded for C1 staging rewrite) — pre-build helper that:
  1. For each internal package (`docs/contracts/case-box-contract/`, `services/case-box-persistence/`), creates a fresh **temp staging directory** under `os.tmpdir()` via `fs.mkdtempSync`.
  2. **Copies the package contents** into the staging dir (only the files the source manifest's `files` field allows; for case-box-contract: `dist/`, `schemas/`, `fixtures/`, `README.md`, `package.json`; for case-box-persistence: `dist/`, `README.md`, `package.json` — assumes §5.2's case-box-persistence `files` field fix lands).
  3. **Rewrites the staged `package.json`** in-place (the temp copy, NOT the source) per the **staging-rewrite rule** restored from package-arch §11.0:
     - For `case-box-persistence`'s staged `package.json`: rewrite `dependencies["case-box-contract"]` from `file:../../docs/contracts/case-box-contract` to **exact non-`file:` identity** `"0.1.0"` (the version that matches the case-box-contract tarball this same script produced in the same run).
     - For `case-box-contract`'s staged `package.json`: NO rewrite required (no internal-package deps).
  4. **Fail-closed scan** over the rewritten staged manifest's `dependencies`, `optionalDependencies`, and `peerDependencies` (and `bundleDependencies` if present) — REJECT any spec containing `file:`, `link:`, `git+`, or `portal:`. Exit non-zero with a clear error if any are present. This is the rev-0.1 C1 mitigation against re-introducing the package-arch §11.0 failure class.
  5. Runs `npm pack` ON THE TEMP STAGED COPY (not the source). Output tarball is moved to `apps/lawbar-desktop/dist-tarballs/`.
  6. Captures the tarball filename + integrity hash (sha512) + the rewritten manifest's dep summary; writes metadata to `apps/lawbar-desktop/dist-tarballs/manifest.json` (one line per packed package).
  7. Cleans up the temp staging dir via `fs.rmSync(stagingDir, {recursive: true, force: true})`.
  8. The **source `package.json` files are NEVER mutated**. Source `services/case-box-persistence/package.json` retains its `file:../../docs/contracts/case-box-contract` dep spec exactly as today — this is the rule restored per the C1 remediation. If a source-mutation fallback is ever desired (e.g. to make `services/case-box-persistence` independently npm-installable), that is a SEPARATE WI requiring its own user authorization.
- `apps/lawbar-desktop/src/tarball-poc/probe.ts` (~60 LOC) — the round-trip code that the `globalThis.__lawbarTarballPocProbe` hook invokes. Implements: validate a fixture matter via `case-box-contract.validateMatter`; create the same matter via `case-box-persistence.createMatter` (against a temp SQLite DB); read it back; close + rmSync; return `{ok: true, durationMs, recordedTenantId, recordedMatterId}`. Test-only file (not part of any production code path).
- `apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs` (~150 LOC; rev-0.1 expanded for M1 readiness wait + M2 structural assertions) — the test that:
  1. Launches the .app via `launchPackaged` (WI-2 helper) with `LAWBAR_TARBALL_POC_TEST_HOOK=true`.
  2. After `app.firstWindow()`, **polls** `app.evaluate(() => typeof globalThis.__lawbarTarballPocProbe === "function")` until true OR timeout (default 5s, configurable via `LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS`). Treats timeout as a clear HARNESS FAILURE (assertion message names it explicitly so the operator does NOT confuse harness timing with a package-arch failure).
  3. Invokes the hook via `app.evaluate(async () => globalThis.__lawbarTarballPocProbe())`.
  4. Asserts the result shape + the structural checks per §5.2 G-7 (asar list + symlink-no-escape + installed manifest assertions).

### §5.2 MODIFIED files (impl WI)

- `apps/lawbar-desktop/package.json`:
  - Add `case-box-contract` + `case-box-persistence` to `dependencies`. The dep specs MUST be **tarball paths** (`file:dist-tarballs/case-box-contract-0.1.0.tgz`, `file:dist-tarballs/case-box-persistence-0.1.0.tgz`) per package-arch §11.0 — NOT raw `file:` specs that would resolve to the source directories at install time. The pack script (§5.1) regenerates the tarballs per the bootstrap sequence below; `package-lock.json` captures integrity hashes.
  - Add new npm scripts:
    - `pack:internal` — runs `scripts/pack-internal-packages.mjs` (writes tarballs to `dist-tarballs/`).
    - `bootstrap` (rev-0.1 H1 fix; REPLACES the rev-0 `prebuild` design; rev-0.2 H1-new fix: prefix paths corrected to be package-script-safe; **rev-0.3 M-new fix: fail-fast `&&` chaining restored**) — runs the explicit developer/CI install sequence FROM `apps/lawbar-desktop/`'s working directory (where the script lives). Because `npm --prefix` resolves the prefix path relative to the invoking script's CWD, the prefix MUST be `../../docs/contracts/case-box-contract` (NOT `docs/contracts/case-box-contract`, which would resolve to `apps/lawbar-desktop/docs/contracts/case-box-contract` and fail). The full script body is a single `&&`-chained command so any subcommand failure **fails the entire bootstrap immediately**:

    ```json
    "bootstrap": "npm --prefix ../../docs/contracts/case-box-contract run build && npm --prefix ../../services/case-box-persistence run build && npm run pack:internal && npm install"
    ```

    Equivalent shell form (single line; `&&` operator):

    ```sh
    npm --prefix ../../docs/contracts/case-box-contract run build && npm --prefix ../../services/case-box-persistence run build && npm run pack:internal && npm install
    ```

    **Fail-fast contract**: each `&&` requires the prior command's exit code to be 0; a non-zero exit at any step aborts the chain and propagates the non-zero exit out of `npm run bootstrap`. This prevents a stale-state failure mode where (e.g.) `pack:internal` fails silently but `npm install` still succeeds against pre-existing tarballs.

    All paths are `../..`-rooted relative to `apps/lawbar-desktop/`. Developers + CI MUST run `npm run bootstrap` from `apps/lawbar-desktop/` after a fresh clone; the existing `npm install` alone is INSUFFICIENT (it would fail to resolve the `file:dist-tarballs/*.tgz` deps because the tarballs don't exist yet on a fresh clone).
    - `test:tarball-poc` — runs the new test via the wrapper (`LAWBAR_TEST_FILES=apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs node scripts/test-packaged-wrapper.mjs`).
  - Document `bootstrap` in `apps/lawbar-desktop/README.md` as the canonical bootstrap step + cross-reference in repo-root `AGENTS.md` test-commands section.
  - **`prebuild` is NOT added** (rev-0.1 H1 fix). `prebuild` would run only when `npm run build` is invoked; on a fresh clone the deps must already resolve before `npm run build` is meaningful. The bootstrap sequence above is the correct ordering.
  - electron-builder `build.files` may need to include `src/tarball-poc/**/*` IF the probe.ts compiles to dist/ AND needs to be in the .app's app.asar. Decision deferred to impl WI's review (the probe is loaded via the `globalThis` hook in main.ts; main.ts compiles to dist/electron/main.js; probe.ts compiles to dist/src/tarball-poc/probe.js; main.ts dynamic-imports it at hook setup time; both must be in the .app).
- `apps/lawbar-desktop/electron/main.ts`:
  - Add the env-gated `globalThis` test hook at the END of `app.whenReady().then(...)` (per Option A1). The hook lazily dynamic-imports `case-box-contract` + `case-box-persistence` (or imports `../src/tarball-poc/probe.js` which contains the round-trip).
  - The hook MUST NOT introduce any top-level import of case-box-* modules (those would land in production binary's startup path). Only the hook body imports them.
  - The hook MUST run AFTER FileVault enforcement passes (so it inherits Tier 1 semantics).
  - LOC delta: ~15-25 lines.
- `apps/lawbar-desktop/.gitignore`:
  - Add `dist-tarballs/` exclusion.
  - Possibly add `apps/lawbar-desktop/src/tarball-poc/` if any artifacts get generated there (probably not — the file is hand-authored).
- `apps/lawbar-desktop/tsconfig.json`:
  - Confirm `src/tarball-poc/probe.ts` is included in the TS build. If `include` is currently restrictive, may need to broaden. (No change if `include` is `["src/**/*", "electron/**/*"]` or similar.)
- `services/case-box-persistence/package.json`:
  - The `files` field is currently NOT set. By default, `npm pack` includes everything except `.gitignored` files + a default exclude list. To produce a clean tarball with ONLY `dist/`, add `"files": ["dist", "README.md"]`. **STOP-AND-ASK item §7.4** (rev-0.2 L2-new: was incorrectly cited as §9.4) — modifying case-box-persistence's package.json IS a public-package-manifest change (even if not yet published).
- `docs/contracts/case-box-contract/package.json`:
  - Already has `"files": ["dist", "schemas", "fixtures", "README.md"]`. No change required.
- `services/case-box-persistence/.gitignore` (or repo-root `.gitignore`):
  - Add `*.tgz` exclusion at the persistence package level (so pre-existing local `npm pack` artifacts are not tracked).

### §5.3 NOT touched (re-affirmed)

- `services/case-box-persistence/src/` — all source UNCHANGED.
- `docs/contracts/case-box-contract/src/` + `schemas/` — all UNCHANGED.
- `services/case-box-persistence/tests/` — UNCHANGED. The PoC does NOT add a test in this package.
- `docs/contracts/case-box-contract/tests/` — UNCHANGED.
- No new runtime dependency in any package's `package.json` (only adding inter-package tarball refs in apps/lawbar-desktop).

## §6 — Recommended verification mechanism (Option A1; expanded)

### §6.1 Production-binary change scope (one env-gated function)

The `electron/main.ts` change is bounded:

```ts
// At end of app.whenReady().then(...):
if (process.env.LAWBAR_TARBALL_POC_TEST_HOOK === "true") {
  // Lazy-import the probe; ensures production-launch import graph is
  // unaffected (the import only resolves when this code path runs).
  // The probe itself runs case-box-contract + case-box-persistence
  // round-trip code; see apps/lawbar-desktop/src/tarball-poc/probe.ts.
  const { runTarballPocProbe } = await import("../src/tarball-poc/probe.js");
  (globalThis as any).__lawbarTarballPocProbe = runTarballPocProbe;
}
```

### §6.2 Test-side invocation pattern

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchPackaged } from "./_launch-with-pid-log.mjs";

// Top-of-file Guard #3 sentinel (per WI-2 contract; same as smoke.packaged).
const __isCi = process.env.LAWBAR_CI === "true" || process.env.CI === "true";
if (__isCi) {
  const __missing = [];
  if (!process.env.LAWBAR_TEST_PID_LOG)  __missing.push("LAWBAR_TEST_PID_LOG");
  if (!process.env.LAWBAR_WRAPPER_VERSION) __missing.push("LAWBAR_WRAPPER_VERSION");
  if (__missing.length > 0) {
    console.error(`[tarball-poc] FATAL: must run through wrapper; missing: ${__missing.join(",")}`);
    process.exit(2);
  }
}

test("tarball PoC: case-box-* round-trip inside packaged Electron main process", async (t) => {
  const binary = /* find packaged .app */;
  const app = await launchPackaged({
    executablePath: binary,
    args: [],
    env: {
      ...process.env,
      LAWBAR_MODE: "dev",
      LAWBAR_TARBALL_POC_TEST_HOOK: "true",
    },
  }, { testName: "tarball PoC round-trip" });
  t.after(async () => { await app.close(); });

  // rev-0.1 M1 fix — bounded readiness wait for the test hook BEFORE invoking it.
  // The plan's Option A1 installs the hook at the end of app.whenReady().then(...);
  // Playwright's app.evaluate may become available before that async branch
  // completes, so we cannot assume the hook is present on the FIRST evaluate
  // call. Poll until the hook is a function OR timeout. Treat timeout as a
  // HARNESS FAILURE (not a package-architecture failure) — the assertion
  // message names it explicitly so the operator can diagnose.
  await app.firstWindow();
  const hookTimeoutMs = Number(process.env.LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS ?? "5000");
  const pollStartMs = Date.now();
  let hookReady = false;
  while (Date.now() - pollStartMs < hookTimeoutMs) {
    hookReady = await app.evaluate(() => typeof globalThis.__lawbarTarballPocProbe === "function");
    if (hookReady) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    hookReady,
    `HARNESS FAILURE: __lawbarTarballPocProbe hook not installed within ${hookTimeoutMs}ms after firstWindow(). `
    + `This is a test-harness timing issue, NOT a package-architecture failure. `
    + `Verify (a) LAWBAR_TARBALL_POC_TEST_HOOK=true is in the launched env; `
    + `(b) electron/main.ts contains the env-gated hook installer; `
    + `(c) bump LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS if app.whenReady is slow on this hardware.`,
  );

  const result = await app.evaluate(async () => {
    return await globalThis.__lawbarTarballPocProbe();
  });

  assert.equal(result.ok, true, `probe failed: ${result.error ?? ""}`);
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
  assert.ok(typeof result.recordedTenantId === "string");
  assert.ok(typeof result.recordedMatterId === "string");
});
```

### §6.3 What this exercises end-to-end

- **`case-box-contract`** module resolution under Electron's packaged main process ESM loader.
- **`case-box-persistence`** module resolution + transitive `better-sqlite3` dep resolution.
- **`better-sqlite3` native binding** load under Electron's V8/Node ABI (the load happens when `case-box-persistence` is imported; if the binding is missing or wrong-arch, the import throws).
- **ASAR unpacking** of `better-sqlite3` native files (per existing `asarUnpack` config in package.json).
- **electron-builder install-app-deps** native-module rebuild (the binding compiled for Electron's ABI; if the rebuild was skipped or failed, the import throws).
- **case-box-persistence's actual schema migrations + SQL helpers** (the round-trip calls `createMatter` which touches the persistence layer end-to-end).
- **case-box-contract's validateMatter** (Ajv validators against the schema).
- **The WI-2 wrapper's crash-detection** (any `lawbar*.ips` written during the test or settle window fails the run).

### §6.4 What this does NOT exercise

- Renderer-side IPC handlers (deferred — IPC impl is parent §26 step 6).
- Multi-launch concurrency (single-launch test only).
- Long-running persistence stress (single round-trip only; no soak test).
- Tier 2 SQLCipher (out of scope; Tier 1 FileVault is still in effect).

## §7 — STOP-AND-ASK items (impl WI authorization MUST address each)

These items REQUIRE explicit user authorization before the impl WI commits any code:

### §7.1 Production-binary change in `electron/main.ts` (env-gated test hook)

The impl WI adds ~15-25 LOC to `electron/main.ts` for the `globalThis.__lawbarTarballPocProbe` env-gated installer. While env-gated and zero-impact in production launches (env unset), it IS a production-binary surface change.

**STOP-AND-ASK**: user must authorize:
- The exact env var name (`LAWBAR_TARBALL_POC_TEST_HOOK`).
- The exact `globalThis` property name (`__lawbarTarballPocProbe`).
- Whether the hook should be present in **release builds** OR limited to dev builds only via a build-time conditional (e.g. `process.env.NODE_ENV !== "production"`). Release-build presence allows post-release smoke verification but increases the surface; dev-build-only requires a separate dev-build pipeline.

### §7.2 Adding `case-box-contract` + `case-box-persistence` as runtime deps of `apps/lawbar-desktop`

Per package-arch §10 Option 2 + rev-2 §8, these MUST be tarball-path deps (`file:dist-tarballs/...`), NOT raw `file:` source-dir deps.

**STOP-AND-ASK**: user must authorize:
- Adding two internal packages as runtime deps of the desktop app. This is the **first** time these packages become part of the app's published-package surface — even though the app is not published, this is the precedent for any future SaaS / signed-build deployment.
- The tarball-path mechanism (vs. workspaces, vs. monorepo tooling). Note: package-arch §10 already decided this; STOP-AND-ASK confirms the user remembers and re-authorizes.

### §7.3 `apps/lawbar-desktop/package-lock.json` churn

Adding the two tarball deps will mutate `package-lock.json` substantially (~hundreds of lines for transitive resolution). The lockfile is committed.

**STOP-AND-ASK**: user must authorize the lockfile churn. Per `.claude/rules/cc-suite.md` §"High-risk WIs", lockfile changes are typically NOT high-risk on their own, but combined with the new runtime deps, the impl WI's commit will include both the lockfile mutation AND the new deps — the user authorizes them together.

### §7.4 `services/case-box-persistence/package.json` `files` field

Adding `"files": ["dist", "README.md"]` to `services/case-box-persistence/package.json` is a **public-package-manifest** change (even though the package is not yet published). This narrows what `npm pack` includes.

**STOP-AND-ASK**: user must authorize the manifest change. Alternative: leave the manifest as-is and accept that `npm pack` bundles extra files (node_modules excluded by default, but src/, tests/, README still included). The "extra files in tarball" form is wasteful but not unsafe; the explicit-files form is cleaner.

### §7.5 ~~Production-binary change in `tsconfig.json` (if needed)~~ — DE-CLASSIFIED (rev-0.1)

Reviewer feedback (`review-plan-mpmf8vap-rp1wrc`): `tsconfig.json` `include` adjustments are ordinary build-tooling mechanics, NOT a STOP-AND-ASK. The impl WI's plan-review will note if `tsconfig.json` needs touching; no separate authorization required. Similarly `apps/lawbar-desktop/.gitignore` additions for `dist-tarballs/` are ordinary `.gitignore` mechanics (NOT staged in any commit; just `?? dist-tarballs/` from `git status`).

### §7.6 Crash count baseline assumption

The PoC is expected to land with **baseline crash count unchanged** (currently 4; no new attributable .ips during impl runs). If the impl WI's verification exposes a NEW crash class (Class C or beyond), this is a structural finding that invalidates the verification mechanism. STOP per WI-2 wrapper's exit-code-3 behavior.

**STOP-AND-ASK**: NOT actionable until impl runtime. Recorded here for awareness.

### §7.7 Re-introducing case-box-persistence's tenant_id / matter_id schema as a touchpoint

The probe (§6.1) creates a fixture matter with a tenant_id + matter_id. Per `dev-memo/plan-client-00.md` D2: `tenant_id` is retained in schemas for forward compatibility but v1 is single-lawyer. The probe's fixture tenant_id should be a synthetic value (e.g. `"poc-tenant-01J..."`), NOT inherited from any real-data source.

**NOT a STOP-AND-ASK**, but RECORDED here so the impl WI does NOT introduce real-data fixtures.

### §7.8 Auto-revert deferral (not authorizable here)

If the impl WI's commit lands and a later run discovers a new crash class, rollback discipline (per `.claude/rules/cc-suite.md` §"Rollback recording") applies — auto-revert is forbidden during `/loop` / overnight; this impl WI is interactive so revert (if needed) lands with the 7-field recording.

## §8 — Acceptance gates for the future impl WI (corresponds to rev-2 §11; refreshed)

The impl WI lands READY only when ALL of:

- **G-1** — `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` exists per §5.1; for each internal package: creates temp staging dir, copies source into staging, rewrites staged `package.json` per the staging-rewrite rule (rev-0.1 C1), runs the fail-closed scan for residual `file:` / `link:` / `git+` / `portal:` specs, runs `npm pack` on the staged copy, moves the resulting tarball to `apps/lawbar-desktop/dist-tarballs/`, writes integrity-hash metadata to `dist-tarballs/manifest.json`, cleans up staging. Source `package.json` files are NEVER mutated.
- **G-2** — `apps/lawbar-desktop/src/tarball-poc/probe.ts` exists per §5.1; performs the case-box-contract validateMatter + case-box-persistence createMatter round-trip; returns the documented result shape; closes + cleans up the temp SQLite DB.
- **G-3** — `apps/lawbar-desktop/electron/main.ts` adds the env-gated `globalThis.__lawbarTarballPocProbe` installer per §6.1. Production launch (env unset) is BYTE-IDENTICAL behavior to the pre-impl baseline (verified by manual `npm run dist` + `open -a` smoke test on FileVault-on dev machine).
- **G-4** — `apps/lawbar-desktop/package.json` adds `case-box-contract` + `case-box-persistence` as tarball-path deps + new npm scripts (`pack:internal`, `bootstrap`, `test:tarball-poc`). The `bootstrap` script is the canonical install entry point for fresh clones (rev-0.1 H1 fix; replaces rev-0's `prebuild`).
- **G-5** — `apps/lawbar-desktop/.gitignore` excludes `dist-tarballs/`. (Impl-level mechanic; not STOP-AND-ASK per rev-0.1 reviewer guidance.)
- **G-6** — `apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs` exists per §5.1 + §6.2; uses `launchPackaged`; performs the rev-0.1 M1 bounded readiness wait for the hook installation; invokes `app.evaluate(() => globalThis.__lawbarTarballPocProbe())`; asserts the result + the structural checks below.
- **G-7 (rev-0.1 M2 expanded)** — Structural inspection asserts ALL of:
  - **G-7.a** — `lawbar.app/Contents/Resources/app.asar` lists `node_modules/case-box-contract/dist/index.js` + `node_modules/case-box-persistence/dist/index.js` (via `asar list` or equivalent).
  - **G-7.b** — `lawbar.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists on disk. (Filesystem presence ONLY; runtime LOADABILITY is G-8's responsibility per the rev-0.1 M2 separation-of-concerns fix.)
  - **G-7.c (rev-0.1 M2)** — recursive scan of `apps/lawbar-desktop/node_modules/**` finds NO symlinks that escape the node_modules tree (i.e., no symlink whose `realpath` points outside `apps/lawbar-desktop/node_modules/` AND outside `dist-tarballs/`). Symlinks WITHIN the npm-managed tree are acceptable; symlinks pointing back into source dirs are NOT.
  - **G-7.d (rev-0.1 M2)** — recursive scan of `lawbar.app/Contents/Resources/**` finds NO symlinks at all. (electron-builder copies; if symlinks appear here, the build is broken.)
  - **G-7.e (rev-0.1 M2)** — installed `apps/lawbar-desktop/node_modules/case-box-persistence/package.json` shows `dependencies["case-box-contract"]` is the rewritten exact-version identity (`"0.1.0"`), NOT `file:`. This proves the staging-rewrite (G-1) actually took effect.
  - **G-7.f (rev-0.1 M2)** — `apps/lawbar-desktop/package-lock.json` contains integrity hashes (`integrity: "sha512-..."`) for BOTH tarball deps. Lockfile MUST resolve to the same hashes that G-1 wrote to `dist-tarballs/manifest.json`.
- **G-8** — `npm run test:tarball-poc` passes under the WI-2 wrapper at the default 30s settle; crash count unchanged. The probe's runtime success IS the proof that `better-sqlite3.node` LOADS under Electron's V8/Node ABI (G-7.b only proves the file exists; G-8 proves it loads).
- **G-9** — `npm run test:packaged` (existing WI-A regression) passes; no regression.
- **G-10** — `wrapper.test.mjs` (31/31 from WI-2) still passes; no regression.
- **G-11** — `npm test` (main + dev smoke) passes; no regression.
- **G-bootstrap (rev-0.1 H1; rev-0.2 H1-new path corrections)** — FRESH-CLONE REPRODUCTION GATE. Acceptance run on a CI runner (or developer's clean workspace) MUST succeed in this exact sequence with NO hidden local state:
  1. `git clone <repo>` (or fresh workspace; delete `apps/lawbar-desktop/node_modules/` + `apps/lawbar-desktop/dist-tarballs/` first if running locally).
  2. `cd lawbar-tool` (the repo root).
  3. (Top-level workspace bootstrap if any; outside this WI's scope.)
  4. `npm --prefix docs/contracts/case-box-contract install && npm --prefix docs/contracts/case-box-contract run build` — builds case-box-contract. (Run from repo root; `--prefix` is repo-root-relative HERE because we are at the repo root.)
  5. `npm --prefix services/case-box-persistence install && npm --prefix services/case-box-persistence run build` — builds case-box-persistence. (Same: repo root invocation; source manifest still has `file:` dep on case-box-contract — that resolves via the relative path in the workspace; staging-rewrite only applies to packed tarballs per §5.1 C1 fix.)
  6. `cd apps/lawbar-desktop && npm run bootstrap` — runs the new `bootstrap` script. Internally the script's commands use `../..`-rooted prefixes (see §5.2 bootstrap definition) because the script runs from `apps/lawbar-desktop/`'s CWD. The script (a) rebuilds the internal packages with `npm --prefix ../../...`, (b) runs `pack:internal`, (c) runs `npm install`. **Fail-fast**: the script body is a single `&&`-chained command so any subcommand failure aborts the chain and propagates the non-zero exit out of `npm run bootstrap` — no silent partial-success. The fresh-clone acceptance run MUST verify that introducing a deliberate failure in step (a) (e.g. by transiently breaking `case-box-contract`'s tsconfig) causes `npm run bootstrap` to exit non-zero AND does NOT proceed to step (b)/(c) — proves the fail-fast contract.
  7. `npm test && npm run test:tarball-poc` — runs full test matrix from `apps/lawbar-desktop/`.
   Each step MUST succeed exit 0. Document the exact commands in `apps/lawbar-desktop/README.md` so a new developer can reproduce. **Critical**: steps 4 + 5 are run from the REPO ROOT (paths are `docs/...` / `services/...`); step 6 onward runs from `apps/lawbar-desktop/` (paths inside `bootstrap` are `../../docs/...` / `../../services/...`). These different working directories use different prefix syntax — both correct in their respective contexts.
- **G-12** — cc-suite review-plan on the impl WI's own concrete implementation plan returns READY (or Low-only). NOT circular per reviewer guidance: this `-01.md` plan is the DESIGN; the impl WI's plan is the per-file implementation steps + per-test code (which this plan does not specify code-level).
- **G-13** — cc-suite audit on the impl diff returns 0 C/H/M.
- **G-14** — cc-suite verify confirms G-13.
- **G-15** — Commit message records 11-field cc-suite recording for all review/audit/verify jobs + the STOP-AND-ASK confirmations from §7 + the parent reference chain + the G-bootstrap fresh-clone reproduction transcript summary.

## §9 — Risks (refreshed from rev-2 §12)

| Severity | Risk | Mitigation |
|---|---|---|
| **High** | The env-gated `globalThis` hook in `electron/main.ts` adds a test-only code path to the production binary. A misconfigured release environment that sets `LAWBAR_TARBALL_POC_TEST_HOOK=true` would expose the hook. | Env var name is namespaced + documented as test-only. The hook function itself does no destructive operations (read-only round-trip against a temp DB; rmSync the temp dir). The risk is LOW from a security standpoint (no privilege escalation); the HIGH rating reflects the cleanliness concern. Mitigation candidate: gate by NODE_ENV !== "production" in addition to the env var (STOP-AND-ASK §7.1). |
| **Medium** | The dynamic `import("case-box-persistence")` inside the hook resolves the package at HOOK INVOCATION TIME, not at app boot. If the package is missing or corrupted, the import throws AT THE FIRST PROBE RUN, not at app boot. Errors surface as `app.evaluate` rejections. | Acceptable — the probe IS the verification mechanism; throwing on missing/corrupted package is the correct behavior. Add a test assertion that the rejection message includes the expected error shape. |
| **Medium** | `npm pack` on `services/case-box-persistence/` includes `node_modules/` by default if the `files` field is unset (per §7.4). A tarball with embedded node_modules would be huge + may contain platform-specific native bindings unsuitable for cross-platform builds. | Per §7.4 STOP-AND-ASK: add `files: ["dist", "README.md"]` to case-box-persistence's package.json. Mitigation if user rejects: impl WI's pack-internal-packages.mjs invokes `npm pack` with `--ignore-scripts` + cleans node_modules pre-pack; tarball-size assertion in CI catches regressions. |
| **Medium** | electron-builder's `install-app-deps` step recompiles native modules for Electron's ABI. If the tarball is installed BEFORE install-app-deps runs OR install-app-deps fails silently, the native binding may be wrong-ABI at runtime. | **(rev-0.2 M1-new: stale `prebuild` mitigation removed.)** Ordering is enforced by the §5.2 `bootstrap` script (G-4), which runs `pack:internal` (writes tarballs) BEFORE `npm install` (resolves the tarball-path deps + triggers postinstall's `install-app-deps` native-module rebuild). The G-bootstrap fresh-clone reproduction gate (§8) is the acceptance check that this sequencing works end-to-end on a clean machine. The `dist` script (`npm run build && electron-builder`) runs install-app-deps as part of electron-builder. Acceptance G-7.b (filesystem presence) + G-8 (runtime loadability via probe) verify the binding both exists AND loads under Electron's ABI. `prebuild` is NOT used in this design (per §5.2 H1 fix). |
| **Medium** | The new impl WI commit will include `package-lock.json` churn for the two tarball deps. Reviewer must accept the lockfile mutation as part of the commit. | Per §7.3 STOP-AND-ASK. cc-suite audit will inspect the lockfile diff. |
| **Medium** | The probe writes a temp SQLite DB to `os.tmpdir()`. If the temp dir is full / permissions denied, the round-trip fails. | Acceptable failure mode; test asserts a specific error envelope. |
| **Low** | `case-box-contract` ships JSON Schema 2020-12 schemas; Ajv ^8 must be the active runtime. The internal package's dep on `ajv ^8` is resolved by npm; double-check no version conflicts with `apps/lawbar-desktop`'s direct deps. | Resolve via `npm ls ajv` post-install; impl WI's plan-review includes this check. |
| **Low** | If a future case-box-contract update changes the validateMatter signature, the probe breaks. | Acceptable maintenance burden; probe.ts is small + the failure surfaces as a clear test error. |

No Critical risks identified. If reviewer disagrees, the HIGH on §7.1 production-binary-hook is the most likely escalation.

## §10 — Hard stops

Per `.claude/rules/autonomy.md` §"Hard-stop list" — this plan triggers some but NOT all:

- **Production binary surface change** — YES (§7.1 test hook in main.ts). STOP-AND-ASK per §7.1.
- **New runtime dependency** — YES (case-box-contract + case-box-persistence added to apps/lawbar-desktop/package.json). STOP-AND-ASK per §7.2.
- **package.json mutation** — YES (apps/lawbar-desktop/package.json adds deps + scripts; services/case-box-persistence/package.json adds files field per §7.4). STOP-AND-ASK per §7.4.
- **package-lock.json churn** — YES. STOP-AND-ASK per §7.3.
- `Info.plist` mutation — NO.
- `LSUIElement` / `LSBackgroundOnly` — NO.
- Crash-dialog suppression — NO.
- IPC implementation — NO (parent §26 step 6 still deferred).
- Product UI / case-box UI — NO.
- Real-data persistence — NO (probe uses synthetic fixture tenant + matter ids).
- Tier 2 SQLCipher / Keychain — NO.
- Signing / notarization / distribution / telemetry / cloud / go-live — NO.

This plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it defines packaging topology + new runtime deps + production-binary surface change. `/cc-suite:review-plan` is REQUIRED.

## §11 — LOC budget hints

| Artifact | Est new LOC | Threshold |
|---|---|---|
| `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` | ~120 | 800 (source) |
| `apps/lawbar-desktop/src/tarball-poc/probe.ts` | ~60 | 800 (source) |
| `apps/lawbar-desktop/electron/main.ts` additions | ~25 (env-gated hook) | 800 (existing main.ts ~140 LOC; final ~165 LOC) |
| `apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs` | ~120 | 1200 (test) |
| `apps/lawbar-desktop/package.json` modifications | +3-5 lines deps + +3 lines scripts | n/a |
| `services/case-box-persistence/package.json` (per §7.4) | +1 line `files` field | n/a |
| `apps/lawbar-desktop/.gitignore` | +1 line | n/a |
| This plan file | ~700 (doc) | 1200 (doc) |

All well within loc-guardian thresholds.

## §12 — Sequencing relative to parent plan §26

Parent rev-3.1 §26 sequence:
- WI-1: detection-redesign plan ✅ (7f16c5d).
- WI-2: detection-impl ✅ (017c560).
- WI-3: pkg-verify-playwright-evaluate-poc — NOT done. The ESM evidence-2 blocker meant the original PoC mechanism could not deliver evidence-2. **This refreshed tarball PoC plan effectively OBVIATES WI-3** — the verification mechanism the refresh recommends (Option A1) IS itself a working answer to the ESM evidence-2 blocker. If the impl WI built per this plan succeeds, WI-3 may be DROPPED entirely (its only purpose was to prove the verification mechanism, and the tarball PoC's success would prove it transitively).
- WI-4: retire-probe-case-box ✅ (45167b1).
- **WI-5 refresh: this plan**.
- WI-6: REVIVE WI-casebox-ipc-contract-impl planning — still deferred.

**Decision (rev-0.1 — adopts reviewer-recommended option (b))**: WI-3 (parent §26 step 3 pkg-verify-playwright-evaluate-poc) is **SUBSUMED** into the tarball PoC impl WI. G-8 of this plan IS the runtime proof of the verification mechanism (the env-gated globalThis hook + app.evaluate invocation pattern); the tarball PoC's runtime success proves both (i) the verification mechanism works and (ii) the tarball architecture works end-to-end. WI-3 as a standalone lane is REMOVED from the sequence.

Updated parent §26-equivalent sequence (rev-0.1):
- WI-1: detection-redesign plan ✅ (7f16c5d).
- WI-2: detection-impl ✅ (017c560).
- ~~WI-3: pkg-verify-playwright-evaluate-poc~~ — **SUBSUMED into the eventual impl of this plan** per reviewer's option (b). Verification mechanism is proven by the tarball PoC impl's G-8 runtime gate, not by a separate WI.
- WI-4: retire-probe-case-box ✅ (45167b1).
- **WI-5 refresh: this plan**.
- WI-6: REVIVE WI-casebox-ipc-contract-impl planning — still deferred (parent §26 step 6).

## §13 — Review packet (compact) — for cc-suite review-plan

**Active plan summary (rev-0.2)**: WI-revive-tarball-poc-refresh produces the implementation blueprint for revival of the tarball PoC architecture (parent `dev-memo/plan-desktop-package-architecture-00.md` rev-3 Option 2; tarball-install of case-box-contract + case-box-persistence into apps/lawbar-desktop). Refreshes the rev-2 PoC plan (commit `018a9a9`; reverted at `ace57a0` due to Class A SIGABRT crash class per `rollback-ace57a0-pkg-arch-poc.md`; `-00.md` carries a SUPERSEDED banner committed alongside this plan). The verification mechanism is redesigned: **Option A1 — env-gated `globalThis` test hook in `electron/main.ts`** invoked via the WI-2 wrapper's `launchPackaged` + `app.evaluate`, where the hook itself lazily dynamic-imports case-box-* in the packaged main process's native ESM loader (bypassing the empirically-falsified `app.evaluate` ESM blocker per parent §26 step 3). The change scope is bounded: 3 new files (pack script + probe.ts + test file), ~25 LOC added to electron/main.ts, package.json + .gitignore mutations, optional services/case-box-persistence/package.json `files` field. The pack script enforces a staging-rewrite (rev-0.1 C1): pack from temp staging copy + rewrite `case-box-persistence`'s STAGED manifest dep on `case-box-contract` from `file:` to exact `"0.1.0"` + fail-closed scan over deps/optionalDeps/peerDeps/bundleDeps for residual `file:`/`link:`/`git+`/`portal:`. Bootstrap ordering enforced via new `bootstrap` script in `apps/lawbar-desktop/package.json` (rev-0.1 H1; rev-0.2 H1-new path correction): uses `../..`-rooted `npm --prefix` paths because the script runs from `apps/lawbar-desktop/`'s CWD. Fresh-clone reproduction acceptance gate G-bootstrap verifies the sequence end-to-end. **STOP-AND-ASK items (§7; rev-0.2 de-classified)**: §7.1 production-binary hook authorization; §7.2 adding two internal packages as runtime deps; §7.3 package-lock.json churn; §7.4 case-box-persistence manifest `files` change. **NOT STOP-AND-ASK** (rev-0.1 reviewer bonus): §7.5 tsconfig.json include adjustments + `.gitignore` additions are ordinary impl mechanics. Acceptance gates G-1 through G-15 + G-bootstrap cover impl deliverables + structural inspection (G-7 expanded to 6 sub-gates per rev-0.1 M2: asar list + .node filesystem-presence + recursive symlink-no-escape under node_modules AND Contents/Resources + installed-manifest non-`file:` + lockfile integrity) + runtime smoke under the WI-2 wrapper (G-8 owns runtime loadability) + cc-suite review + audit + verify chain. Hook readiness wait (rev-0.1 M1): bounded poll after `app.firstWindow()` with HARNESS-FAILURE timeout messaging. Risks: 1 H (test-only hook in production binary; mitigation via env-gating + namespacing), 6 M, 2 L; 0 Critical. **§12 sequencing (rev-0.1; adopted reviewer option (b))**: WI-3 (parent §26 step 3 pkg-verify-playwright-evaluate-poc) is SUBSUMED into the eventual impl WI of this plan; G-8 IS runtime proof of the verification mechanism. No remaining sequencing STOP-AND-ASK. High-risk per cc-suite §"High-risk WIs"; review-plan REQUIRED.

**Exact target files (this plan)**:
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` (new; this file).

**Exact target files (eventual impl WI; NOT this plan)**:
- NEW: `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` (~120 LOC).
- NEW: `apps/lawbar-desktop/src/tarball-poc/probe.ts` (~60 LOC).
- NEW: `apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs` (~120 LOC).
- MOD: `apps/lawbar-desktop/electron/main.ts` (+~25 LOC env-gated hook).
- MOD: `apps/lawbar-desktop/package.json` (deps + scripts).
- MOD: `apps/lawbar-desktop/.gitignore` (+1 line).
- MOD (conditional): `services/case-box-persistence/package.json` (+1 line `files`).
- MOD (conditional): `apps/lawbar-desktop/tsconfig.json` (if include doesn't already cover src/tarball-poc).
- MOD: `apps/lawbar-desktop/package-lock.json` (auto-generated by npm install).

**Exact acceptance criteria (eventual impl WI)**: §8 G-1 through G-15.

**Exact out-of-scope (this plan)**:
- Any implementation.
- Any package.json mutation in THIS plan-only commit.
- Any production-binary change in THIS commit.
- IPC implementation (parent §26 step 6).
- Product UI / case-box UI / real-data / Tier 2 / signing / distribution / telemetry / cloud / go-live.
- Re-introducing `--probe-case-box` (retired at `45167b1`).

**Essential references**:
- `dev-memo/plan-desktop-package-architecture-00.md` rev-3 at `e5cb773` — Option 2 architecture (UNCHANGED).
- `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` rev-2 at `018a9a9` — prior PoC plan (structurally invalidated).
- `dev-memo/rollback-ace57a0-pkg-arch-poc.md` at `6afee88` — rollback record.
- `dev-memo/plan-packaged-probe-verification-00.md` rev-3.1 at `20af81e` — verification redesign (§26 step 3 ESM blocker; §26 step 5 this WI's slot).
- `dev-memo/plan-pkg-verify-detection-redesign-00.md` rev-0.2.1 at `7f16c5d` — wrapper impl plan.
- WI-2 commit `017c560` + WI-retire commit `45167b1`.

**Review questions** (for the cc-suite reviewer):

1. Is Option A1 (env-gated `globalThis` test hook in `electron/main.ts`) the right balance between crash-safety + ESM compatibility + production-binary cleanliness? Could a narrower mechanism (e.g. invoking the probe via a preload + IPC channel — Option A2) be sequenced earlier without depending on the full IPC layer?
2. Is the STOP-AND-ASK list (§7) complete? Specifically, does §7.4 (case-box-persistence manifest change) belong as a STOP-AND-ASK, or is it minor-enough that the impl WI's review-plan packet alone suffices?
3. Is §9 H1's mitigation (env-gated + namespaced env var) sufficient, or should the impl WI gate the hook by `NODE_ENV !== "production"` as well? Trade-off: dev-build-only restricts post-release smoke verification.
4. Is §12's sequencing recommendation (drop WI-3 OR subsume into tarball PoC) the right disposition? The original WI-3 was a standalone verification-mechanism PoC; the refreshed plan's Option A1 makes WI-3's evidence-2 problem moot by changing the mechanism entirely.
5. Does the probe.ts content (§5.1 + §6.1) constitute a real-data risk per `.claude/rules/client-local-first.md`? The probe writes synthetic fixture data to `os.tmpdir()` + cleans up; no real legal data flows.
6. Does the wrapper integration (§6.2 sentinel block; `launchPackaged` usage) correctly inherit all WI-2 contract requirements (Guard #3 sentinel pair; CI-form recognition; crash settle 30s)?
7. Is the structural-inspection layer (§5.2 G-7) adequately specified, or should the impl WI's plan-review include the exact `asar list` invocation + the exact path-set assertions?
8. The plan REJECTS Option A3 (`open -a` LaunchServices) per parent §8 Option 4 upstream rejection. Is that rejection still valid given the new wrapper context, or should Option A3 be reconsidered as a SECONDARY verification (e.g. as a sanity test that production-realistic launch ALSO works, in addition to A1)?

## §14 — Stop condition

This plan becomes stale when:
- The impl WI lands per the §8 acceptance gates. After: this plan is the as-built reference.
- The user explicitly authorizes a different verification mechanism (e.g. A2 IPC-based after parent §26 step 6 lands, or A3 `open -a` as a sanity-test pairing). Triggers a plan amendment.
- A future Electron version makes `app.evaluate`'s dynamic-`import()` work (i.e. registers an `importModuleDynamicallyCallback`); the env-gated hook becomes obviation-eligible. Triggers a plan-amendment to consider mechanism simplification.
- The package-arch §10 Option 2 decision is itself revisited (e.g. workspaces become preferred). Triggers reopening package-arch-00.md.

## §15 — Required cc-suite review

This plan is not authorized for promotion (status flip to READY) until:
1. `/cc-suite:review-plan dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The §6 Option A1 recommendation is not overridden without re-review.
4. The eventual impl WI does NOT begin until this plan is READY AND user has acknowledged each STOP-AND-ASK item in §7 + §12.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency: rev-2 PoC plan invalidation is correctly attributed; the refreshed mechanism does not re-introduce the failure modes.
- Completeness: STOP-AND-ASK list is exhaustive; acceptance gates cover impl deliverables AND verification AND structural inspection AND review-chain.
- Feasibility: Option A1 mechanism is implementable in ~250 new LOC + ~25 modified LOC; no new dependencies; no Info.plist / LSUIElement / crash-dialog suppression.
- Ambiguity: STOP-AND-ASK items have clear authorization shape; the env-gated hook's behavior is fully specified.
- Risk & sequencing: H1's mitigation is convincing; §12 sequencing relative to parent §26 step 3 / WI-3 is correctly surfaced for user decision.

This plan is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it defines packaging topology + new runtime deps + production-binary surface change. `/cc-suite:review-plan` is REQUIRED before any impl WI authorization.

## §16 — rev-0.1 changelog (post review-plan-mpmf8vap-rp1wrc)

Review job `review-plan-mpmf8vap-rp1wrc` (gpt-5.5 / high / read-only / 2026-05-26 09:17-09:20 UTC) returned NEEDS-FIX with **1 C / 1 H / 2 M / 0 L**. All 4 findings applied inline + reviewer's bonus guidance adopted:

### Critical fix

- **C1 — Missing manifest rewrite for `case-box-persistence`** → §5.1 `pack-internal-packages.mjs` design expanded from ~120 LOC to ~180 LOC with the **staging-rewrite rule restored** per package-arch §11.0. The script now (a) creates a temp staging dir per package, (b) copies source into staging, (c) rewrites `case-box-persistence`'s STAGED `package.json` dep on `case-box-contract` from `file:../../docs/contracts/case-box-contract` to exact `"0.1.0"`, (d) runs the fail-closed scan over `dependencies` / `optionalDependencies` / `peerDependencies` for residual `file:` / `link:` / `git+` / `portal:` specs, (e) packs from staging (NOT source), (f) writes integrity-hash metadata to `dist-tarballs/manifest.json`. **Source `package.json` files are NEVER mutated.** G-1 + G-7.e + G-7.f gate this behavior.

### High fix

- **H1 — `prebuild` cannot create gitignored tarballs before dependency resolution** → §5.2 + G-4 + G-bootstrap REPLACE the rev-0 `prebuild` design with an explicit `bootstrap` script that runs (1) build internal packages, (2) `pack:internal`, (3) `npm install` in `apps/lawbar-desktop`. The new `G-bootstrap` acceptance gate (§8) requires a FRESH-CLONE reproduction transcript demonstrating the bootstrap sequence works without hidden local state. Bootstrap command documented in `apps/lawbar-desktop/README.md` + cross-referenced in `AGENTS.md`.

### Medium fixes

- **M1 — Hook lookup race** → §6.2 test invocation pattern updated with a bounded readiness poll: after `app.firstWindow()`, poll `app.evaluate(() => typeof globalThis.__lawbarTarballPocProbe === "function")` until true OR `LAWBAR_TARBALL_POC_HOOK_TIMEOUT_MS` (default 5000ms). Timeout produces a clear HARNESS FAILURE assertion message that names it explicitly (so the operator does NOT confuse timing with a package-arch failure).
- **M2 — Acceptance gates lost symlink + packed-manifest integrity checks** → G-7 expanded from 2 bullets to 6 sub-gates (G-7.a-f): asar list assertions + better-sqlite3 `.node` filesystem presence (G-7.b ONLY; loadability moved to G-8 per the separation-of-concerns fix) + recursive symlink-no-escape scans under both `apps/lawbar-desktop/node_modules/**` AND packaged `Contents/Resources/**` + installed `case-box-persistence/package.json` non-`file:` assertion + `package-lock.json` integrity hash assertion.

### Reviewer bonus guidance applied

- **§12 sequencing**: ADOPTED option (b) per reviewer recommendation. WI-3 (parent §26 step 3) is SUBSUMED into the eventual impl of this plan; G-8 IS the runtime proof. Removed STOP-AND-ASK §7.0 sequencing (was a holdover requiring user decision; now the recommendation is decided).
- **STOP-AND-ASK de-classification**: §7.5 de-classified (tsconfig include adjustments + `.gitignore` additions are ordinary impl mechanics, not STOP-AND-ASK). §7.4 case-box-persistence `files` manifest stays as STOP-AND-ASK (true public-manifest surface change). §7.1 / §7.2 / §7.3 / §7.6 / §7.7 / §7.8 unchanged.
- **Low-only marker in `-00.md`**: added a SUPERSEDED banner at the top of `dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` pointing at this `-01.md` + the rollback. Doc-only, ~3 lines, committed as a companion change.

### Diff scope (rev-0.1 vs rev-0)

- Top Status line (rev-0.1 banner).
- §5.1 NEW files: `pack-internal-packages.mjs` design expanded (~120 → ~180 LOC; staging-rewrite + fail-closed scan + manifest.json metadata).
- §5.2 MODIFIED files: `package.json` scripts section reworked (`bootstrap` REPLACES `prebuild`; documented in README.md + AGENTS.md).
- §6.2 test invocation pattern: added bounded readiness poll (~25 LOC of test code).
- §7.5 DE-CLASSIFIED (tsconfig + .gitignore are impl mechanics).
- §8 G-1 through G-15: expanded G-1 (staging-rewrite + scan + metadata) + G-4 (`bootstrap` replaces `prebuild`) + G-5 (de-classified note) + G-7 (6 sub-gates) + G-8 (separation of filesystem vs runtime loadability) + new G-bootstrap (fresh-clone reproduction).
- §12 sequencing: ADOPTED option (b); WI-3 subsumed.
- §16 (this changelog).
- Companion `-00.md` SUPERSEDED banner.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` against rev-0.1 (this revision) to confirm C1 + H1 + M1 + M2 are resolved + no new C/H/M findings + the §16 changelog accurately reflects the diff.

## §17 — rev-0.2 changelog (post review-plan-mpmg0alu-k6klhd)

Re-review job `review-plan-mpmg0alu-k6klhd` (gpt-5.5 / high / read-only / 2026-05-26 09:38-09:40 UTC) returned NEEDS-FIX with **1 H + 1 M + 2 L** follow-on findings (C1 + rev-0.1 M1/M2 + bonus guidance all RESOLVED; H1 partially resolved + 3 stale-text issues). All 4 follow-ons applied inline as rev-0.2:

### High fix

- **H1-new — `bootstrap` script `--prefix` path resolution from package.json scope** → §5.2 `bootstrap` script + §8 G-bootstrap fresh-clone gate corrected: the `bootstrap` script's commands now use `../..`-rooted paths (`npm --prefix ../../docs/contracts/case-box-contract run build`) because the script runs from `apps/lawbar-desktop/`'s CWD. G-bootstrap fresh-clone gate distinguishes between repo-root invocations (steps 4-5 use `docs/...` / `services/...`) and `apps/lawbar-desktop/`-CWD invocations (step 6 onward uses `../../docs/...` / `../../services/...`). Documented the working-directory distinction explicitly.

### Medium fix

- **M1-new — stale `prebuild` mitigation in §9 risk table** → §9 risk row for "electron-builder's install-app-deps" mitigation rewritten. Removed reference to `prebuild`; replaced with explicit `bootstrap`-ordering + G-4 + G-bootstrap citations. States explicitly that `prebuild` is NOT used in this design.

### Low fixes

- **L1-new — §13 compact review packet stale references** → §13 packet rewritten to reflect rev-0.1 §7.5 de-classification + §12 option (b) adoption. Now states tsconfig/.gitignore are NOT STOP-AND-ASK + no remaining sequencing STOP-AND-ASK (WI-3 SUBSUMED).
- **L2-new — stale section reference `§9.4` → `§7.4`** → §5.2 case-box-persistence files-field note now correctly cites STOP-AND-ASK item §7.4.

### Diff scope (rev-0.2 vs rev-0.1)

- Top Status line (rev-0.2 banner).
- §5.2 `bootstrap` script body: `../..`-rooted prefix paths + script-body code block.
- §5.2 §7.4 reference correction (was §9.4).
- §8 G-bootstrap: working-directory distinction documented; commands corrected.
- §9 risk row "install-app-deps ordering": removed prebuild mitigation; replaced with bootstrap ordering.
- §13 compact review packet: rewritten to reflect §7.5 de-classification + §12 option (b).
- §17 (this changelog).
- `-00.md` SUPERSEDED banner unchanged (already added in rev-0.1).

### Confirmed RESOLVED from prior reviews

- **C1** (manifest rewrite) — RESOLVED in rev-0.1; re-review confirmed.
- **H1** (prebuild ordering) — RESOLVED in rev-0.1; rev-0.2 fixes the residual H1-new path-resolution bug.
- **M1** (hook readiness wait) — RESOLVED in rev-0.1; re-review confirmed.
- **M2** (expanded G-7) — RESOLVED in rev-0.1; re-review confirmed.
- **§12 option (b) adoption** — confirmed acceptable.
- **`-00.md` SUPERSEDED banner** — confirmed clear + acceptable.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` against rev-0.2 (this revision) to confirm all 4 follow-on findings are resolved + no new C/H/M findings.

## §18 — rev-0.3 changelog (post review-plan-mpmgk6ew-kx2uu8)

Re-review job `review-plan-mpmgk6ew-kx2uu8` (gpt-5.5 / high / read-only / 2026-05-26 09:53-09:55 UTC) returned NEEDS-FIX with **1 M residual** (rev-0.2 H1-new + M1-new + L1-new + L2-new all RESOLVED; the only remaining issue is a regression introduced by rev-0.2's H1-new code-block rewrite that lost the fail-fast `&&` chaining). Single fix applied inline as rev-0.3:

### Medium fix

- **M-new (rev-0.2-introduced regression) — Bootstrap script lost fail-fast `&&` chaining** → §5.2 bootstrap script body rewritten from a multi-line code block (which interpreted newlines as command separators with NO fail-fast) back to a single `&&`-chained command. Now presented in BOTH (a) the canonical JSON `"bootstrap": "... && ... && ... && ..."` form for `package.json` AND (b) an equivalent shell single-line form for clarity. Added an explicit fail-fast contract paragraph: any non-zero subcommand exit aborts the chain and propagates out of `npm run bootstrap`. §8 G-bootstrap step 6 updated to state fail-fast explicitly + adds an acceptance check that introducing a deliberate failure in step (a) of the chain causes `npm run bootstrap` to exit non-zero AND not proceed to steps (b)/(c).

### Confirmed RESOLVED from prior reviews (re-affirmed)

- **C1** manifest rewrite (rev-0.1) — load-bearing.
- **H1** prebuild ordering (rev-0.1) — load-bearing.
- **M1** hook readiness wait (rev-0.1) — load-bearing.
- **M2** expanded G-7 (rev-0.1) — load-bearing.
- **H1-new** `--prefix` path resolution (rev-0.2) — load-bearing.
- **M1-new** stale prebuild mitigation removal (rev-0.2) — load-bearing.
- **L1-new** compact packet rewrite (rev-0.2) — load-bearing.
- **L2-new** §9.4 → §7.4 (rev-0.2) — load-bearing.
- **§12 option (b) adoption** — load-bearing.
- **`-00.md` SUPERSEDED banner** — present + unchanged.

### Diff scope (rev-0.3 vs rev-0.2)

- Top Status line (rev-0.3 banner).
- §5.2 bootstrap script body: code block restored to single `&&`-chained command + JSON form + shell form + explicit fail-fast paragraph.
- §8 G-bootstrap step 6: fail-fast contract documented + acceptance check for deliberate-failure-aborts-chain.
- §18 (this changelog).

No other sections touched.

### Re-review request

`/cc-suite:review-plan dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` against rev-0.3 (this revision) to confirm the bootstrap fail-fast chain is restored + no new C/H/M findings.
