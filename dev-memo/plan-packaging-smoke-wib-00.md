# Plan: Packaging Smoke WI-B — Native-Module Rebuild (PLAN-ONLY)

> **PLAN ONLY.** This document specifies the **WI-B impl plan**: native-module rebuild smoke for `apps/lawbar-desktop/`. It does NOT implement anything; no dependency is installed; no `case-box-persistence` link is added; no probe is written; no test is run; no signing / notarization / distribution channel / telemetry / cloud sync / product UI decision is made. The impl WI requires SEPARATE explicit user authorization, and each new dep within it requires its own STOP-AND-ASK per brief §20 + `.claude/rules/autonomy.md` §"Hard-stop list".

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned NEEDS-FIX with 2 Mediums + 5 Lows; rev-2 applied all 7: M D1#2 build.files path + asarUnpack made install-tree-aware + explicit acceptance step (verify lawbar.app/Contents/Resources/app.asar.unpacked/.../better_sqlite3.node exists); M D5#1 §5 follow-up ordering FIXED — encryption-at-rest plan moved BEFORE first case-box-aware screen + screen constrained to in-memory/non-persistent fixture until encryption-at-rest WI lands; L D1#1 explicit @electron/rebuild delta vs packaging-smoke plan §3.3; L D2#1 NEW §1.6 scope-boundary "unsigned dev only"; NEW §6 risk row #8 (Medium) — packaging-path verification mandatory.).
**Date**: 2026-05-24.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only Packaging Smoke WI-B.
**Predecessors**: WI-A packaging smoke at `65fd0cc`; packaging-smoke plan at `3f9d412`; first UI shell impl at `4a99b25`; first-UI-shell plan at `f74b2b2`; UI substrate ratification at `35cd9b6`; night-mode foundation at `7ad57ed`; blueprint at `1b92c58`; Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

WI-A (`65fd0cc`) proved that the **zero-native** Electron shell builds and launches as a packaged `.app`. The next prerequisite for case-box-aware screens is **WI-B**: prove that **native N-API modules** (specifically `better-sqlite3`, the case-box-persistence SQLite binding) load successfully inside the Electron-packaged binary.

The risk WI-B must close (per substrate decision §7 row #7): Electron ships its own Node/V8 build. Native modules built against the host Node ABI fail at load time inside Electron with `ERR_DLOPEN_FAILED` or similar. Without WI-B, the first case-box-aware screen would hit this failure mode at the worst possible moment (product UI mid-development).

### Two probe options considered

| Option | What it links | Pro | Con |
|---|---|---|---|
| **A — direct `better-sqlite3`** | `dependencies: { "better-sqlite3": "^x.y.z" }` | Smallest dep surface; lowest STOP-AND-ASK count (1 dep). | Does NOT exercise the real case-box-persistence integration; does NOT prove case-box-contract's Ajv validators load correctly under Electron. |
| **B — link `case-box-persistence`** | `dependencies: { "case-box-persistence": "file:../../services/case-box-persistence" }` (transitively pulls `better-sqlite3` + `case-box-contract`) | Exercises the REAL path case-box-aware screens will use; proves the entire case-box stack works under Electron's Node ABI; closes the WI-B risk most decisively. | Bigger dep tree; 3 deps (direct + 2 transitive) count for brief §20 "new runtime dependencies (each individually)" purposes; bigger blast radius. |

**Plan picks: Option B (case-box-persistence link).** Reasoning: WI-B's purpose is "BEFORE case-box-aware screens" — the smoke is most useful when it exercises the exact path those screens will use. Option A would prove ABI compat at the lowest level but leave case-box-contract's Ajv validators + case-box-persistence's audit-chain logic untested under Electron. A future failure in either layer (e.g., Ajv's dynamic require behavior under Electron sandbox) would surface at the WORST time (mid-product-feature development). Better to surface it now in an isolated probe.

The reviewer may push to use Option A (smaller bite). Plan accepts that pushback as legitimate — the user decides at WI-B authorization which option to take.

### Exact target files (THIS plan-WI's commit)

CREATED (single file):
- `dev-memo/plan-packaging-smoke-wib-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- ANY file under `apps/lawbar-desktop/`.
- ANY `package.json` anywhere.
- ANY `node_modules/`.
- `dev-memo/plan-packaging-smoke-00.md`, `plan-first-ui-shell-00.md`, `plan-ui-substrate-decision-00.md`, `plan-night-mode-foundation-00.md`.
- `dev-memo/plan-go-live-readiness-00.md`, `plan-go-live-plan-reconcile-00.md`.
- `docs/release/**`, `docs/product/**`, `docs/adr/**`, `docs/ui/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

### Exact target files for the IMPL WI (NOT created by THIS plan-WI's commit)

When the user later authorizes **WI-B impl**, it would change/create (Option B):

1. `apps/lawbar-desktop/package.json` — three changes (all behind explicit per-dep STOP-AND-ASK at impl-WI authorization):
   - Add `"dependencies": { "case-box-persistence": "file:../../services/case-box-persistence" }` (creates the `dependencies` block — currently zero runtime deps).
   - Add `"postinstall": "electron-builder install-app-deps"` to `scripts` (uses electron-builder's bundled `@electron/rebuild` — NO new explicit `@electron/rebuild` install needed; visible in WI-A's `npm run dist` log).
   - Update `build.files` AND `build.asarUnpack` to include rebuilt native binaries. **Exact path is install-tree-dependent** (per rev-1 reviewer M D1#2): with the proposed app-level `file:` dep, `better-sqlite3`'s native `.node` typically lands under `apps/lawbar-desktop/node_modules/better-sqlite3/build/Release/` (npm-hoisted), NOT under `case-box-persistence/node_modules/better-sqlite3/...` (only if npm chose not to hoist). The impl WI MUST verify the actual install path after the first `npm install` and configure `build.files` (ASAR inclusion) + `build.asarUnpack: ["**/node_modules/better-sqlite3/**"]` (because native `.node` modules MUST be unpacked from ASAR to be `dlopen`-able by Node). Acceptance step: confirm `lawbar.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists after `npm run dist`.

2. `apps/lawbar-desktop/electron/main.ts` — small additive change (~15-20 LOC at the TOP of file, BEFORE `app.whenReady()`): detect `--probe-case-box` CLI flag; if present, run the probe via the new `src/probes/caseBoxProbe.ts`, print structured output (e.g., `PROBE_OK\n` or `PROBE_FAIL: <reason>\n`), and `app.quit()` with exit code 0 (success) or 1 (failure) WITHOUT opening a window. Production launch path (no flag) is UNCHANGED.

3. `apps/lawbar-desktop/src/probes/caseBoxProbe.ts` (NEW; ~50-70 LOC) — in-process probe:
   - `import { openInMemoryCaseBoxPersistence } from "case-box-persistence"` (or the equivalent direct constructor; verify exact API at impl-WI time).
   - Open in-memory; call `createMatter({...})` with minimal valid input; assert returned matter has `tenant_id` + `id` + `name`.
   - Call `getMatter({tenant_id, matter_id})`; assert round-trip equality.
   - Close.
   - Returns `{ok: true}` OR `{ok: false, error: "..."}`. The caller (main.ts probe handler) translates to stdout + exit code.

4. `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs` (NEW; ~80 LOC) — Playwright Electron smoke or direct `child_process.spawn` (TBD at impl-WI; spawn is simpler since the probe doesn't open a window). Asserts:
   - Spawn packaged binary with `--probe-case-box` flag.
   - Stdout contains `PROBE_OK`.
   - Exit code is 0.
   - Probe completes within 5s timeout (case-box init + 1 round-trip is fast).

5. `apps/lawbar-desktop/tests/main.test.mjs` — small additive test (~10 LOC): verifies the flag-handler short-circuit logic via the pure function (parseProbeFlag or equivalent). Confirms production path is NOT affected when flag is absent.

6. `apps/lawbar-desktop/package.json` `scripts` — add `"test:probe": "node --test tests/smoke.native-module.electron.test.mjs"`.

7. `apps/lawbar-desktop/package-lock.json` — automatic update from `npm install case-box-persistence` (large diff; expected).

Net: 4 new/modified source files + 1 new test + 2 modified config files + 1 auto-updated lockfile = 8 files.

### Exact acceptance criteria

#### For THIS plan-WI:

1. Plan committed alone (one file).
2. §1 enumerates the WI-B impl scope: dep additions, file list, probe behavior, test approach.
3. §2 documents the case-box-persistence-link vs direct-better-sqlite3 trade-off; recommends Option B.
4. §3 enumerates the STOP-AND-ASK items WI-B triggers (dep count: 1 direct + 2 transitive at minimum; potentially more if case-box-contract or case-box-persistence have other native runtime deps).
5. §4 specifies the probe behavior (flag-gated; production launch UNCHANGED; clean exit codes).
6. §5 lists follow-up WIs (each separately authorized).
7. §6 risks reasonable.
8. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

#### For the IMPL WI-B (when later authorized; this plan does NOT execute):

1. `npm --prefix apps/lawbar-desktop install` succeeds with the new `dependencies` block; `postinstall` runs `electron-builder install-app-deps` and rebuilds `better-sqlite3` against Electron's Node ABI WITHOUT error.
2. `npm --prefix apps/lawbar-desktop run dev` (existing dev launch) STILL succeeds without regression — production launch path is unchanged.
3. `npm --prefix apps/lawbar-desktop run dist` (existing packaging) STILL succeeds; the packaged `.app` includes the rebuilt `better-sqlite3` binary at `lawbar.app/Contents/Resources/app.asar` (or unpacked dir).
4. `npm --prefix apps/lawbar-desktop run test:probe` exits 0. Spawn-launched packaged binary with `--probe-case-box` prints `PROBE_OK` to stdout and exits 0 within 5s.
5. Existing dev-mode tests (`npm test`) still pass 12/12.
6. Existing WI-A packaged tests (`npm run test:packaged`) still pass 3/3.
7. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.

### Exact out-of-scope list (FOR THE IMPL WI; NOT just this plan)

- **Product UI.** No screen, no case-box-aware visual component. The probe runs HEADLESS (no BrowserWindow) and exits.
- **Case-box-aware IPC contract.** Probe accesses case-box-persistence directly from main process; no IPC bridge to renderer. The IPC contract is a SEPARATE later WI (substrate decision §6 row 4 + WI-A plan §6 row 4).
- **OCR engine integration.** `@gutenye/ocr-node` is NOT in scope. Separate even-later WI when first OCR screen lands.
- **Signing, notarization, Apple Developer ID, Mac App Store / direct / in-firm IT distribution.** STOP-AND-ASK per brief §20.
- **Auto-update mechanism.** Brief §4 manual download v1.
- **Telemetry / crash reporting / cloud sync / external network surface.** Probe is local-only.
- **Editing `services/case-box-persistence/**` or `docs/contracts/case-box-contract/**`.** WI-B consumes them via file-link; does NOT change them.
- **Adding any dep beyond Option B's 3 (case-box-persistence + transitive better-sqlite3 + transitive case-box-contract).** Each is its own STOP-AND-ASK at WI-B authorization.
- **`@electron/rebuild` as a direct dep.** Already bundled inside electron-builder (visible in WI-A `npm run dist` log: `executing @electron/rebuild electronVersion=34.5.8`). The `postinstall: "electron-builder install-app-deps"` invokes the bundled version. NO new explicit install of `@electron/rebuild` is needed.
- **`git push`.** Separate explicit authorization.

### Essential references

- `dev-memo/plan-packaging-smoke-00.md` (READY at `3f9d412`) §3 (WI-B accounting; informational only).
- WI-A impl commit `65fd0cc` — confirms `electron-builder` already bundles `@electron/rebuild` (npm run dist log: `executing @electron/rebuild`).
- `dev-memo/plan-ui-substrate-decision-00.md` (RATIFIED Electron rev-3 at `35cd9b6`) §7 row #7 (Medium risk — Electron native-module ABI/rebuild).
- `dev-memo/plan-first-ui-shell-00.md` (READY rev-2 at `f74b2b2`) §6 (native-module risk carried forward to this WI).
- `services/case-box-persistence/package.json` — declares `better-sqlite3` as dep + `case-box-contract` as file: dep.
- `services/case-box-persistence/scripts/abi-smoke.mjs` — existing host-Node ABI smoke check (pretest hook); WI-B's Electron-Node ABI smoke is the analog.
- `AGENTS.md` §"Repo Brief" — Node 22.x or 24.x pin; ABI smoke check rationale.
- `docs/product/project-requirements-brief.md` §4 + §20 (Mac app expectations + hard-stop list).
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #3 (Mac-client surface; partially closed by WI-A; further closed by WI-B; fully closed by case-box-aware screens).
- `.claude/rules/autonomy.md` §"Hard-stop list".

### Review questions for the reviewer

1. **Option A vs Option B**: §2 trade-off table picks Option B (link `case-box-persistence`). Reviewer may push to defer Option B to a later WI and start with Option A (direct `better-sqlite3` only) as a smaller bite. Plan picks B; reviewer's pushback would defer to WI-B-A / WI-B-B split (analogous to WI-A / WI-B split for packaging).

2. **Probe shape**: §1 picks a HEADLESS probe (no BrowserWindow; flag-gated `--probe-case-box`; spawn-tested via stdout). Reviewer may push for a renderer-IPC probe (window.lawbar.probe.caseBox()). Plan rejected the renderer-IPC option because it would prematurely design product IPC (substrate decision §6 row 4 is the IPC plan WI; out of scope here).

3. **Flag-handler in main.ts**: §1 adds a ~15-20 LOC early-exit handler at the top of `electron/main.ts`. Reviewer may push for a SEPARATE entry point (`electron/probe-main.mts` + a runtime `process.argv` switch in a tiny dispatcher). Plan picks the inline handler because the dispatcher pattern adds an additional file + complexity for marginal cleanliness gain.

4. **Dep count for STOP-AND-ASK**: Option B is 3 deps (1 direct + 2 transitive). Brief §20 says "new runtime dependencies (each individually)". Are transitives "each individually"? Plan picks: ENUMERATE all 3 transparently; user decides at WI-B authorization whether to group-authorize or insist on per-dep STOP-AND-ASK.

5. **postinstall rebuild**: §1 picks `electron-builder install-app-deps` as the `postinstall` script. This runs after EVERY `npm install` — slight startup cost on every fresh install (~10-30s for the rebuild). Reviewer may push to gate it behind a CI-only flag. Plan picks always-on because forgetting the rebuild is exactly the failure mode WI-B exists to prevent.

6. **Probe success criterion**: §1 picks `PROBE_OK\n` stdout + exit 0. Reviewer may push to use a JSON envelope `{ok: true, durationMs: ..., schemaVersion: ...}` for richer diagnostics. Plan picks the simple string because the probe is binary (works / doesn't) and JSON parsing adds complexity not needed for the gate.

7. **OCR engine (`@gutenye/ocr-node`)**: explicitly OUT of scope (§"Out of scope"). The probe does NOT exercise the OCR native module. Acceptable for WI-B because the case-box layer is the v1 blocker; OCR integration in the UI app is post-v1-first-screen. Reviewer may push to include OCR in WI-B; plan defers.

---

## §1 WI-B impl scope (per Option B selection)

### §1.1 Dep additions (each individual STOP-AND-ASK at WI-B impl authorization)

| # | Dep | Type | Source | Brings in |
|---|---|---|---|---|
| 1 | `case-box-persistence` | runtime | `file:../../services/case-box-persistence` | Direct: open + persistence interface |
| 2 | `better-sqlite3` (transitive) | runtime | npm registry | Native N-API SQLite binding |
| 3 | `case-box-contract` (transitive) | runtime | `file:../../docs/contracts/case-box-contract` | Ajv validators + schemas |

Add `postinstall: "electron-builder install-app-deps"` to `scripts`. Uses electron-builder's bundled `@electron/rebuild`; **no new explicit `@electron/rebuild` install needed** (per rev-1 reviewer L D1#1 — this is a deliberate delta from packaging-smoke plan §3.3's earlier informational statement that "WI-B will add `@electron/rebuild`"; that statement assumed a direct install, but WI-A's `npm run dist` log at `65fd0cc` confirmed electron-builder bundles it). The earlier `@electron/rebuild` accounting in packaging-smoke plan §3.3 is superseded by this approach.

### §1.2 Probe shape (per question 2 + 3)

- HEADLESS (no BrowserWindow).
- Flag-gated by `--probe-case-box`.
- Detected at top of `electron/main.ts` BEFORE `app.whenReady()`:
  ```ts
  if (process.argv.includes("--probe-case-box")) {
    void (async () => {
      const result = await runCaseBoxProbe();
      console.log(result.ok ? "PROBE_OK" : `PROBE_FAIL: ${result.error}`);
      process.exit(result.ok ? 0 : 1);
    })();
  } else {
    // existing main.ts body unchanged
  }
  ```
- Production launch path UNCHANGED.

### §1.3 Probe implementation (`src/probes/caseBoxProbe.ts`)

Pure async function `runCaseBoxProbe(): Promise<{ok: true} | {ok: false, error: string}>`:

1. Open `case-box-persistence` in-memory (`openInMemoryCaseBoxPersistence` or equivalent; verify exact factory at impl-WI time).
2. Call `createMatter({tenant_id: "lawbar-probe", name: "probe-matter", actor_user_id: "lawbar-probe-user", matter_type: "litigation", parties: [{display_name: "probe-party"}], confidentiality_class: "internal", status: "active"})` (or whatever minimal valid input the contract requires; verify at impl-WI).
3. Assert returned matter has `tenant_id === "lawbar-probe"` + `name === "probe-matter"`.
4. Call `getMatter({tenant_id: "lawbar-probe", matter_id: <created.id>})`; assert round-trip deep-equal.
5. Close.
6. Return `{ok: true}` on success; catch any throw and return `{ok: false, error: e.message}`.

### §1.4 Test shape (`tests/smoke.native-module.electron.test.mjs`)

Spawn packaged binary directly (no Playwright Electron needed for headless):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
// findPackagedBinary reuse pattern from tests/smoke.packaged.electron.test.mjs

test("packaged .app probe-case-box: loads better-sqlite3 via case-box-persistence and round-trips a matter", { timeout: 10_000 }, async () => {
  const binary = findPackagedBinary();
  assert.ok(binary !== null, "packaged .app missing — run `npm run dist` first");

  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, ["--probe-case-box"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({code, stdout, stderr}));
  });

  assert.equal(result.code, 0, `probe exit code ${result.code}; stderr=${result.stderr}`);
  assert.match(result.stdout, /^PROBE_OK/m, `probe stdout missing PROBE_OK: ${result.stdout}`);
});
```

### §1.5 Acceptance criteria summary

Per §"Exact acceptance criteria" above. The critical gate: `npm run test:probe` exits 0 against the packaged binary, proving case-box-persistence loads inside Electron without ABI failure.

### §1.6 Scope boundary: unsigned binary only (per rev-1 reviewer L D2#1)

WI-B proves ABI load in **unsigned dev packaging only**. The signed/notarized binary's native-binary validation behavior remains a SEPARATE later gate per substrate decision §7 row #7. When code-signing onboarding lands (substrate decision §6 WI #6), a follow-up smoke MUST re-verify `better-sqlite3` loads inside the SIGNED `.app` — signing can occasionally surface entitlements-related dlopen failures that unsigned builds don't show.

---

## §2 Trade-off: Option A (direct `better-sqlite3`) vs Option B (link `case-box-persistence`)

Plan picks **Option B**. Rationale:

- **Reality alignment**: case-box-aware screens will use `case-box-persistence`, not raw `better-sqlite3`. A passing Option-A probe leaves contract-validator + persistence-layer integration unproven under Electron.
- **Risk concentration**: if Ajv (or any case-box-contract internal) has Electron-incompat behavior, Option A misses it; Option B catches it.
- **Cost**: 2 extra transitive deps. Both already in the repo; not external.

Option A is the fallback if reviewer / user pushes back at WI-B authorization. The impl scope can swap to Option A with minimal plan delta:
- Replace dep #1 (`case-box-persistence`) with direct `better-sqlite3`.
- Replace probe content: `new Database(":memory:")`, `db.prepare("SELECT 1 AS x").get()`, assert `.x === 1`, close.
- Drop transitive case-box-contract.

---

## §3 STOP-AND-ASK items inherited

All applicable / unresolved brief §20 STOP-AND-ASK items (per `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record") are inherited by reference without modification. Items SPECIFICALLY triggered by WI-B impl:

1. **Brief §20 "New runtime dependencies (each individually)"**:
   - `case-box-persistence` (file: link).
   - `better-sqlite3` (transitive; native binding).
   - `case-box-contract` (file: link transitive).

   Each is its own STOP-AND-ASK at WI-B authorization. User may group-authorize them in a single WI-B authorization message (recommended) or insist on per-dep.

2. **Brief §20 "Per-document encryption-at-rest scheme"** — NOT triggered by WI-B (probe uses in-memory SQLite; no on-disk file). When the first case-box-aware screen lands and the app opens a real on-disk SQLite at `~/Library/Application Support/lawbar/`, the encryption-at-rest question becomes live.

3. **Brief §20 "Hard-delete retention policy"** — NOT triggered by WI-B.

4. Items NOT triggered by WI-B (most of the remaining unresolved §20 items): auth provider, cloud vendor, external document exposure, mini-program publication, sync bridge enablement, LLM enablement, document text-extraction engine, secret material handling, tenant boundary widening, any external network surface beyond WI-03, real-data migration, monetization, redaction ADR, renderer UI framework choice, signing identity, notarization profile, Apple Developer ID, Mac App Store distribution, auto-update mechanism. None relaxed.

---

## §4 Probe behavior — production path unaffected

The flag-handler in `electron/main.ts` short-circuits BEFORE `app.whenReady()` is registered. Concretely:

- `npm run dev` → no flag → existing main.ts body runs → BrowserWindow opens → 12 token panels.
- `lawbar.app/Contents/MacOS/lawbar` (no args) → no flag → same as `npm run dev`.
- `lawbar.app/Contents/MacOS/lawbar --probe-case-box` → flag detected → probe runs headless → exits with code 0/1.
- `npm test` (existing) → does NOT trigger the probe (no flag) → 12/12 PASS unchanged.
- `npm run test:packaged` (WI-A) → does NOT trigger the probe (no flag) → 3/3 PASS unchanged.
- `npm run test:probe` (WI-B NEW) → spawns packaged binary with `--probe-case-box` flag → probe runs → asserts PROBE_OK + exit 0.

The unit test at §1 acceptance criterion #1 of the impl WI verifies this short-circuit logic via a pure function (`parseProbeFlag(argv)` or equivalent). The smoke test verifies it end-to-end via the packaged binary.

---

## §5 Suggested follow-up WIs (each requires SEPARATE explicit authorization)

This plan executes none.

| # | Suggested WI | Phase | Risk | Predecessors |
|---|---|---|---|---|
| 1 | **Impl: WI-B native-module rebuild smoke per THIS plan + Option B** | Impl | Medium; **STOP-AND-ASK** on each of 3 new deps | THIS plan READY + user authorizes per-dep |
| 1-alt | Impl: WI-B-A direct `better-sqlite3` only (fallback per §2 if user prefers smaller bite) | Impl | Low; **STOP-AND-ASK** on 1 new dep | THIS plan READY + user authorizes |
| 2 | Plan: case-box IPC contract (renderer ↔ main; substrate decision §6 row 4) | Plan | Medium | WI 1 (or 1-alt) |
| 3 | Plan: per-document encryption-at-rest scheme (brief §20) — **MUST land BEFORE any WI that opens persistent on-disk SQLite** (per rev-1 reviewer M D5#1) | Plan | **STOP-AND-ASK** | brief §20 |
| 4 | Impl: first case-box-aware screen (e.g., list matters) — **MUST use in-memory or non-persistent fixture data until WI 3 ratifies the encryption-at-rest scheme** (per rev-1 reviewer M D5#1) | Impl | Medium | WIs 2 + 3 |
| 5 | Plan: OCR engine packaging smoke (`@gutenye/ocr-node`) — analog of WI-B for the OCR native module | Plan | Medium; **STOP-AND-ASK** on new dep | WI 1 OR independent |
| 6 | Plan: code-signing + notarization onboarding (substrate decision §6 WI #6) | Plan | **STOP-AND-ASK** | brief §20 |
| 7 | Plan: distribution channel decision (substrate decision §6 WI #7) | Plan | **STOP-AND-ASK** | brief §20 + WI 6 |

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to install `case-box-persistence` + `better-sqlite3`. | Top-of-file PLAN-ONLY banner; §"Exact acceptance criteria" split for THIS plan-WI vs IMPL WI-B; each dep in §1.1 flagged STOP-AND-ASK individually. |
| 2 | Medium | The `postinstall: "electron-builder install-app-deps"` may fail if `better-sqlite3`'s prebuilds don't match Electron's Node ABI for the host platform. | This IS the failure mode WI-B exists to surface. If `postinstall` fails on a developer machine, WI-B's whole point is satisfied (the rebuild path needs investigation). Document as expected outcome class. |
| 3 | Low | case-box-persistence's `pretest` ABI smoke (`services/ocr-persistence/scripts/abi-smoke.mjs`) checks host-Node ABI; WI-B's probe checks Electron-Node ABI. The two run independently; no interaction. | Document the distinction in WI-B's impl commit message. |
| 4 | Low | The flag-handler in main.ts pollutes production code with probe-specific logic (a small `if (argv.includes(...))` block). | The check is 1-line conditional + 6-line probe-handler branch; trivial overhead. The alternative (separate entry point) adds an additional `electron/probe-main.mts` and complicates `package.json` `main` resolution. |
| 5 | Low | Probe uses in-memory SQLite; the on-disk path (per brief §4 `~/Library/Application Support/lawbar/`) is NOT exercised. | Acceptable for WI-B because the ABI question is identical for in-memory vs on-disk; WI-3 (first case-box-aware screen) is where on-disk use lands. |
| 6 | Low | OCR engine (`@gutenye/ocr-node`) is NOT covered by WI-B. A separate analog WI is needed before any OCR-touching screen. | §5 row 5 documents this; §"Out of scope" explicit. |
| 7 | Low | Option B's 3-dep install adds ~30s to first `npm install` on a fresh clone. | One-time cost; subsequent installs cached. |
| 8 | **Medium** (added per rev-1 reviewer L D5#2) | The native-binary packaging path is install-tree-dependent and may not match the planned `build.files` / `build.asarUnpack` patterns without verification. If wrong, the packaged `.app` will `dlopen`-fail at probe time even though the rebuild succeeded. | §1.1 §1.3 includes the explicit acceptance step ("confirm `lawbar.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists after `npm run dist`"); the smoke test failing with `ERR_DLOPEN_FAILED` is the surfacing mechanism if the path is wrong. Impl WI must NOT proceed past the acceptance step if the unpacked path is missing. |

No Critical / High risks.

---

## §7 References

- `dev-memo/plan-packaging-smoke-00.md` (READY at `3f9d412`) §3 (WI-B accounting; informational).
- `apps/lawbar-desktop/` at HEAD `65fd0cc` — WI-A complete; `electron-builder` already bundled `@electron/rebuild`.
- `dev-memo/plan-ui-substrate-decision-00.md` (rev-3 RATIFIED at `35cd9b6`) §7 row #7.
- `dev-memo/plan-first-ui-shell-00.md` (READY rev-2 at `f74b2b2`) §6.
- `services/case-box-persistence/` — the package WI-B links via `file:`.
- `services/case-box-persistence/scripts/abi-smoke.mjs` — host-Node ABI smoke; WI-B is Electron-Node analog.
- `docs/contracts/case-box-contract/` — transitive dep via case-box-persistence.
- `docs/product/project-requirements-brief.md` §4 + §20.
- `.claude/rules/autonomy.md` §"Hard-stop list".

---

## §8 Stop condition

This plan is stale or superseded when:
- The user authorizes WI-B impl per §5 row 1 OR §5 row 1-alt — the plan becomes "promoted to WI-B impl; awaiting commit".
- WI-B impl ships and `npm run test:probe` exits 0 against the packaged binary — the plan becomes "superseded by WI-B impl commit; the case-box IPC contract plan can proceed".
- Substrate decision is amended in a way that invalidates Electron as the substrate.
- case-box-persistence is materially refactored in a way that changes its external API (the probe would need re-aligning).
- A future Electron version + better-sqlite3 prebuild combination makes the rebuild step a no-op (extremely unlikely; would only narrow §6 risk #2's likelihood).
