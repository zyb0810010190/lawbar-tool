# PLAN — `WI-desktop-pkg-arch-tarball-poc` (PoC implementation plan)

**SUPERSEDED** by `dev-memo/plan-desktop-pkg-arch-tarball-poc-01.md` after revert `ace57a0` of impl commit `4783521` (Class A SIGABRT crash class per `dev-memo/rollback-ace57a0-pkg-arch-poc.md`). The successor plan retains this file's structural framing but replaces the verification mechanism (rev-0's §6 spawn-then-process-exit pattern → rev-01 Option A1 env-gated `globalThis` test hook invoked via WI-2 wrapper + `app.evaluate`). This file is kept as historical record; do NOT implement against this plan.

**Status**: PLAN-ONLY (READY after third review; 3 Low fixes applied inline). [Historical; superseded as above.]
**Date**: 2026-05-25.
**Author**: Claude Code on explicit user direction (PoC impl plan lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Authorization basis**:
- Desktop package-architecture plan READY at `e5cb773` (`dev-memo/plan-desktop-package-architecture-00.md`; rev-3).
- IPC contract plan READY at `9f9f79b` (`dev-memo/plan-case-box-ipc-contract-00.md`).
- Tier 1 FileVault enforcement at `678bf16`.
- WI-B Option A native-module smoke at `c708ece`.

**rev-1**: applies all findings from `review-plan-mpkt7s5t-6vyf3b` (0 C / 0 H / 3 M / 2 L + 1 typo). Edits: (a) §4 helper algorithm adds a fail-closed post-rewrite scan for unexpected `file:` deps across `dependencies`/`optionalDependencies`/`peerDependencies` — defence-in-depth; (b) §3 file table + §4 test-coverage table + §12 + §15 reconciled: helper tests SPLIT into NEW `apps/lawbar-desktop/tests/pack-helper.test.mjs` (~110 LOC) separate from the packaged smoke (~130 LOC); test counts now consistent; new shape-probe test consolidated; (c) §11 acceptance gates expanded to 15 gates — adds source pre-flight tests green; `.gitignore` effective post-stage-pack; `cc-suite:verify` post-audit; (d) §10 step ordering reworked: `.gitignore` update moved from step 11 to step 3.5 (BEFORE tarball creation); (e) §6 test 1 uses `npm exec -- asar list` (local-bin invocation; no `npx` network reach; no incorrect `tar tzf` fallback); (f) §12 ULID risk row drops the incorrect "no `o`" Crockford-alphabet claim — schema regex `^[0-9a-z]{26}$` accepts all lowercase a-z so the literal IS valid. No scope, dependency, or hard-stop change.
- **rev-2**: applies all findings from `review-plan-mpktnvm8-0hrfm0` (0 C / 0 H / 3 M / 1 L). All execution-path completeness fixes; no architectural change. Edits: (M-a) §4 step 7 + §12 H1 risk + §3 test 5 description: shape-probe now uses **stop-and-amend** path (no fallback parser); if `npm pack --dry-run --json` shape does not match expectation, helper exits 1 with category `pack-dry-run-shape-unknown` and prints a clear "plan must be amended" line; (M-b) §10 + §8 + §11: wired `pack-helper.test.mjs` into execution path — new §10 sub-step 3.6 creates the file; §8 adds `test:pack-helper` script; §10 sub-step 4.0 runs `test:pack-helper` against source tree BEFORE stage-pack; sub-step 5.6 re-runs after stage-pack against produced tarball manifests; §10 step 10.5 includes all 5 helper tests in regression sweep; (M-c) §6 test 1 + §11 gate 9 + §15 packet: ASAR listing uses direct `node_modules/.bin/asar` local bin with `fs.existsSync` precheck; no `npm exec`, no `npx`, no `tar tzf`; (L-a) normalize stale counts: rev-1 packet "3 NEW" → "4 NEW"; "12 gates" → "16 gates"; scope line "10-gate" updated; stale `npx`/`tar tzf` review-question text removed. No scope, dependency, or hard-stop change.
- **rev-2 (post-review Low fixes applied; `review-plan-mpku309i-44314q` returned READY-with-Lows)**: 3 mechanical text Lows applied inline before commit. L1 — §3 file table line 79 "via `npm exec -- asar list`" → "via direct `node_modules/.bin/asar list` with `fs.existsSync` precheck". L2 — §15 packet line 675 "Active plan summary (rev-1)" → "(rev-2)"; "including `npm exec -- asar list` inspection" → "including hermetic `node_modules/.bin/asar list` inspection"; expanded to mention rev-2 stop-and-amend + 2 test scripts. L3 — §10 step 6.1 "add 2 deps + 1 test script" → "add 2 deps + remaining `test:pkg-arch-poc` script (the `test:pack-helper` script was already added in step 3.6.2)". No scope, dependency, or hard-stop change.

This plan maps the package-architecture plan's §11.1 PoC steps into **exact files, function signatures, tests, and acceptance gates**. It does NOT implement them. The package-architecture plan is the design authority; this plan is the implementer's checklist for the PoC WI.

## §1 — Scope + non-goals

**In scope** (plan-only):
- File-by-file enumeration of every file the PoC WI creates or modifies.
- Exact function signatures + LOC budgets per file.
- Staging-pack helper design (input args, manifest-rewrite logic, dry-run assertion, output paths).
- PoC probe design (constructor + validateMatter + createMatter + stdout protocol + exit codes).
- Packaged smoke design (asar list inspection + recursive symlink scan + spawn-probe with timeout).
- Electron main.ts modifications (probe-flag short-circuit; preserves Tier 1 FileVault enforcement behavior).
- `apps/lawbar-desktop/package.json` modifications (2 new direct runtime tarball deps + 2 new test scripts: `test:pkg-arch-poc` AND `test:pack-helper` per rev-2 M-b).
- `.gitignore` modifications (`*.tgz` exclusions at three path roots).
- Lockfile expectations (`apps/lawbar-desktop/package-lock.json` regenerated; integrity hashes for both internal packages).
- Step-by-step execution order for the PoC WI.
- 16-gate acceptance criteria (rev-1 expanded from 12 + rev-2 confirmed at 16).
- Risks + hard-stop check.

**Explicitly out of scope** (deferred):
- Implementation of the PoC itself.
- Mutating any package.json (this plan documents the changes; PoC WI applies them under its own authorization).
- The orchestrator (`scripts/build-internal-packages.mjs`) — separate follow-up WI per package-architecture plan §12.
- IPC implementation restart (separate WI after PoC lands).
- Product UI / case-box-aware screens.
- Real case data persistence.
- Tier 2 SQLCipher / Keychain.
- Bundler introduction.
- Workspace tool introduction.
- npm/pnpm workspaces (Option 1 was rejected).
- Source mutation of `services/case-box-persistence/package.json` (only as STOP-AND-ASK fallback per package-architecture plan §11.0).
- Auth provider, cloud sync, signing, distribution.

## §2 — Existing context used

- `dev-memo/plan-desktop-package-architecture-00.md` (`e5cb773`; READY rev-3) — design authority. Specifically §11.0 (non-`file:` spec architecture + staging-pack helper rationale), §11.1 (10-step PoC table with steps 3 + 9 marked removed), §13 (risks).
- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`; READY rev-3) — IPC contract (consumer of the PoC outcome).
- `apps/lawbar-desktop/` HEAD `e5cb773`:
  - `package.json`: `dependencies: { "better-sqlite3": "^12.9.0" }`; `devDependencies` include `electron ^34.0.0`, `electron-builder ^25.0.0`, `typescript ^5.6.0`; `build.files: ["dist/**/*", "package.json"]`; `build.asarUnpack: ["**/node_modules/better-sqlite3/**"]`.
  - `electron/main.ts` (138 LOC): existing `--probe-case-box` flag handler at top of file (lines ~26-37); existing `app.whenReady` chain with FileVault enforcement + theme-IPC + `createWindow`; existing `if (process.argv.includes("--probe-case-box")) return;` short-circuit inside whenReady.
  - `src/probes/caseBoxProbe.ts` (existing precedent for probe shape; inline type shim for better-sqlite3).
  - `tests/smoke.native-module.electron.test.mjs` (existing precedent for packaged smoke shape; `findPackagedAppDir`, spawn-with-timeout, PROBE_OK/PROBE_FAIL stdout protocol).
  - `tests/main.test.mjs` (existing precedent for unit tests).
- `services/case-box-persistence/package.json`:
  - `version: "0.1.0"`, `main: "./dist/index.js"`, NO `files` allowlist, `dependencies: { "better-sqlite3": "^12.9.0", "case-box-contract": "file:../../docs/contracts/case-box-contract" }`.
  - `dist/` already built (per `npm --prefix services/case-box-persistence test` workflow).
- `docs/contracts/case-box-contract/package.json`:
  - `version: "0.1.0"`, `main: "./dist/index.js"`, `files: ["dist", "schemas", "fixtures", "README.md"]`, NO `dependencies`.
  - `dist/` already built.
- Electron-builder behavior:
  - `build.files` allowlist controls SOURCE files (i.e., the app's own code). Production node_modules are AUTO-INCLUDED separately.
  - `build.asarUnpack` glob unpacks named files from the ASAR archive (required for native `.node` modules; Node's `dlopen` cannot read from inside ASAR).
  - `electron-builder install-app-deps` rebuilds native modules against Electron's Node ABI (WI-B impl proved this works for better-sqlite3 via `postinstall` hook).
- `.gitignore` at repo root (verify pattern coverage for new `*.tgz` files).
- `.claude/rules/cc-suite.md` §"High-risk WIs" — packaging-topology + new runtime deps trigger cc-suite review-plan + audit + verify.
- `.claude/rules/loc-guardian.md` — hand-written source fail at 800 LOC per file; test fail at 1200 LOC per file.
- `.claude/rules/staging-hygiene.md` — explicit-staging commit discipline; never `git add .` or `-A`.

## §3 — Implementation file enumeration

| Path | Status | Purpose | Est LOC | Notes |
|---|---|---|---|---|
| `scripts/pack-internal-package.mjs` | NEW (repo root) | Staging-pack helper. Args: `<pkg-name>`. Resolves source dir from name; copies to temp dir (excluding `node_modules/`); rewrites `file:` deps in temp dir's `package.json` to non-`file:` specs (exact version pin); runs `npm pack --dry-run` to assert `dist/` is in file list; runs `npm pack`; moves tarball to known output path. | ~120 | Pure Node ESM; uses `node:fs/promises`, `node:os`, `node:path`, `node:child_process`. No new deps. |
| `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` | NEW | Probe module. Constructs `InMemoryCaseBoxPersistence`; builds minimal valid `Matter` payload per `case-box-matter.schema.json`; calls `validateMatter(payload)` (asserts Ajv runtime loads + executes); calls `persistence.createMatter(payload)` (asserts persistence runtime + audit emission). Returns probe result envelope. | ~90 | Imports from `case-box-persistence` + `case-box-contract` bare names; tsc resolves via type-only or runtime per use. |
| `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` | NEW | 4 packaged-smoke test cases: (1) packaged .app exists; (2) `app.asar` contains case-box-persistence/dist/index.js AND case-box-contract/dist/index.js (via direct `node_modules/.bin/asar list` with `fs.existsSync` precheck; rev-2 per M-c hermetic); (3) recursive symlink scan over `Contents/Resources/` finds NO escape; (4) spawn packaged binary with `--probe-casebox-pkg-arch`, assert PROBE_OK + validatorOk=true. | ~130 | Reuses `findPackagedAppDir` pattern from existing tests/smoke.native-module.electron.test.mjs. |
| `apps/lawbar-desktop/tests/pack-helper.test.mjs` | NEW (rev-1 per M2 — split from prior conflated smoke file) | 5 helper-level tests: (1) missing arg → exits 1 + stderr "usage"; (2) unknown pkg name → exits 1 + stderr `unknown-package`; (3) case-box-contract happy path → exits 0, stdout `PACK_OK ...`, tarball exists at expected path, extracted tarball contains `package/dist/index.js`; (4) case-box-persistence happy path → exits 0, stdout `PACK_OK ...`, extracted tarball's `package/package.json` `dependencies."case-box-contract"` is `"0.1.0"` (NOT `"file:..."`), extracted contains `package/dist/index.js`; (5) `npm pack --dry-run --json` shape-probe (rev-2 per M-a — stop-and-amend semantics): asserts the locally-installed npm's JSON output matches the helper's expected shape (per §4 step 7a). If the locally-installed npm emits an unexpected shape, this test FAILS, surfacing the shape variance BEFORE stage-pack runs — the PoC stops and the plan is amended; no fallback parser is attempted. | ~110 | Pure Node + npm CLI; NO Electron runtime required; wired into `test:pack-helper` script per §8. |
| `apps/lawbar-desktop/electron/main.ts` | MOD | Add `--probe-casebox-pkg-arch` flag handler at top of file (AFTER existing `--probe-case-box` handler). Inside `app.whenReady`, extend existing `if (process.argv.includes("--probe-case-box")) return;` guard to also short-circuit on `--probe-casebox-pkg-arch`. | +25 | Preserves Tier 1 FileVault enforcement behavior; both probe flags skip FileVault decision. |
| `apps/lawbar-desktop/package.json` | MOD | Add 2 direct tarball deps: `"case-box-contract": "file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz"` AND `"case-box-persistence": "file:../../services/case-box-persistence/case-box-persistence-0.1.0.tgz"`. Add `"test:pkg-arch-poc": "node --test tests/smoke.casebox-pkg-arch-poc.electron.test.mjs"` AND `"test:pack-helper": "node --test tests/pack-helper.test.mjs"` (rev-2 per M-b) to `scripts`. NO `build.asarUnpack` changes (case-box-* are pure JS; better-sqlite3 transitive coverage already in existing asarUnpack glob `**/node_modules/better-sqlite3/**`). | +6 | 2 NEW direct runtime deps (case-box-contract + case-box-persistence); both STOP-AND-ASK at PoC WI authorization. |
| `apps/lawbar-desktop/package-lock.json` | MOD (auto) | Regenerated by `npm install`; records integrity hashes for both internal tarballs. | (auto) | Asserted in §5 acceptance gates. |
| `.gitignore` | MOD (repo root) | Add `*.tgz` exclusions at three roots: `services/**/*.tgz`, `docs/contracts/**/*.tgz`, `apps/**/*.tgz`. | +5 | Prevents tarball files from being staged accidentally. |

**Total (rev-1)**: 4 NEW files (helper + probe + smoke test + pack-helper test). 3 MOD files (main.ts, package.json, .gitignore). 1 auto-regenerated lockfile. Net new+modified source: ~340 LOC. Net new+modified test: ~240 LOC across 2 test files (~130 packaged smoke + ~110 helper).

## §4 — `scripts/pack-internal-package.mjs` design

### Function signature + invocation

```bash
# Repo-root invocation:
node scripts/pack-internal-package.mjs <pkg-name>

# Examples:
node scripts/pack-internal-package.mjs case-box-contract
node scripts/pack-internal-package.mjs case-box-persistence
```

### Internal package registry (hard-coded in PoC; orchestrator WI can extend)

```js
const PACKAGE_REGISTRY = {
  "case-box-contract": {
    sourceDir: "docs/contracts/case-box-contract",
    expectedVersion: "0.1.0",
    // No file: deps to rewrite.
    rewrites: [],
    // Must include dist/ in the packed tarball.
    requiredEntries: ["dist/index.js"],
  },
  "case-box-persistence": {
    sourceDir: "services/case-box-persistence",
    expectedVersion: "0.1.0",
    // case-box-contract is currently file:..; rewrite to exact pin.
    rewrites: [
      {
        depKey: "case-box-contract",
        from: /^file:/,
        to: "0.1.0",
      },
    ],
    requiredEntries: ["dist/index.js"],
  },
};
```

### Algorithm

```
1. Parse args; assert `<pkg-name>` is in PACKAGE_REGISTRY; else exit 1 with usage.
2. Resolve `sourceDir` to an absolute path (relative to script's CWD which MUST be repo root).
   Assert source dir exists; assert `dist/` subdir exists (caller must have run `npm run build`
   in source first); else exit 1 with diagnostic.
3. Read source `package.json`. Assert `version === expectedVersion`; else exit 1 (version drift
   means the PoC's pinned spec would mismatch).
4. Create temp dir at `<os.tmpdir()>/lawbar-pack-<pkg-name>-<timestamp>/`.
5. Recursive copy `sourceDir → tempDir`, EXCLUDING:
   - `node_modules/`
   - `node_modules/.package-lock.json`
   - `.git/`
   Use `fs.cp(src, dst, { recursive: true, filter: (path) => !path.includes("node_modules") })`.
6. Read temp dir's `package.json`. Apply EACH rewrite in `rewrites` array:
   - Locate `dependencies[depKey]`; if absent and rewrite was specified, exit 1 (drift between
     registry and source).
   - Assert current value matches `from` regex; else exit 1 (registry expectation mismatch).
   - Replace with `to` value.
   Write modified `package.json` back to temp dir.
6b. **Fail-closed scan (rev-1 per M1)**: re-read temp dir's `package.json` (now post-rewrite).
   Scan EACH of `dependencies`, `optionalDependencies`, and `peerDependencies` for any value
   matching `/^(?:file:|link:)/`. If ANY remaining `file:` or `link:` spec is found that was
   NOT in the rewrites array, exit 1 with category `manifest-rewrite-failed`. This defence-
   in-depth catches:
   - A future case-box-* package adding a new `file:` runtime dep without updating the
     registry.
   - A typo in the rewrites array (e.g. wrong `depKey`) that left the original `file:` spec
     in place.
   - A transitive dep moving from `dependencies` to `optionalDependencies` (registry only
     scans `dependencies` for rewrites).
   The scan covers exactly the 3 dep maps that npm honors at install time; `devDependencies`
   are not in the install tree of the consuming desktop app and need not be scanned.
7. Run `npm pack --dry-run --json` in temp dir via `child_process.execFileSync("npm",
   ["pack", "--dry-run", "--json"], { cwd: tempDir, encoding: "utf-8" })`.

   7a. **Shape detection (rev-2 per M-a)**: parse the stdout as JSON. The helper EXPECTS
       the npm 11+ shape: an array containing one object with a `files` field that itself
       is an array of `{path: string, size: number}` entries. The helper validates this
       structure:
       - JSON parses successfully.
       - Top-level is an array OR an object with a known top-level key (npm versions vary
         between bare-array and `{packages: [...]}`-wrapped shapes; helper accepts both
         documented forms).
       - The selected entry has a `files` field that is an array.
       - Each `files` entry has a string `path` field.

       If ANY of these checks fail, the helper does NOT attempt a human-readable-text
       fallback parse. Instead it exits 1 with category `pack-dry-run-shape-unknown` and
       prints to stderr a clear instruction: `[pack:<pkg-name>] pack-dry-run-shape-unknown:
       npm pack --dry-run --json returned an unexpected shape. Plan must be amended before
       proceeding. Raw JSON (truncated to 1000 chars):\n<truncated>`. The PoC WI stops at
       this point; the plan's §11 gate 2 fails; user is informed; the plan is amended with
       the actual observed shape before the PoC continues.

       Rationale: the rev-1 plan claimed a fallback parser exists; rev-2 rejects that claim
       per the reviewer's correct critique (fallback was unspecified and untested). A
       stop-and-amend path is strictly safer: an unknown shape means an unverified install
       behavior, which would defeat the PoC's purpose of proving correct packaging.

   7b. **Required-entries assertion**: after the shape is validated, the helper asserts
       each entry in `requiredEntries` (e.g. `dist/index.js`) appears as a `path` value in
       the parsed `files` array. If any required entry is missing, exit 1 with category
       `dry-run-missing-entry` + the specific missing path.
8. Run `npm pack --json` in temp dir (real pack). Parse JSON; extract filename of produced
   tarball.
9. Move produced tarball from temp dir to `<sourceDir>/<filename>`. Use `fs.rename` or
   `fs.copyFile + fs.unlink` (cross-fs safe).
10. Print success line to stdout: `PACK_OK <pkg-name> -> <output-path>`.
11. Clean up temp dir: `fs.rm(tempDir, { recursive: true, force: true })`.
12. Exit 0.
```

### Error handling

- Every step that can fail logs a categorized error to stderr (`[pack:<pkg-name>] <category>: <detail>`) and exits with code 1.
- Categories: `missing-source-dir`, `missing-dist`, `version-mismatch`, `temp-dir-create-failed`, `copy-failed`, `manifest-rewrite-failed` (includes the rev-1 fail-closed scan catching unexpected `file:`/`link:` specs in any of `dependencies`/`optionalDependencies`/`peerDependencies`), `dry-run-failed`, `pack-dry-run-shape-unknown` (rev-2 per M-a: emitted when `npm pack --dry-run --json` returns an unexpected shape; helper STOPS — plan must be amended before PoC continues; no human-readable-text fallback parser), `dry-run-missing-entry`, `npm-pack-failed`, `move-failed`, `cleanup-failed`.
- The PoC smoke test asserts EXACTLY one of these categories on intentionally-broken inputs (separate failure-path unit tests; out of v1 scope).

### Test coverage for the helper

| Test | Assertion |
|---|---|
| Help: missing arg | Exits 1; stderr contains "usage". |
| Unknown pkg name | Exits 1; stderr `unknown-package`. |
| case-box-contract happy path | Exits 0; stdout `PACK_OK case-box-contract -> ...`; file `docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz` exists; extracted tarball contains `package/dist/index.js`. |
| case-box-persistence happy path | Exits 0; stdout `PACK_OK case-box-persistence -> ...`; file `services/case-box-persistence/case-box-persistence-0.1.0.tgz` exists; extracted tarball's `package/package.json` `dependencies["case-box-contract"]` is `"0.1.0"` (NOT `"file:..."`); extracted contains `package/dist/index.js`. |
| Missing dist (pre-build) | (Not added as test — caller must run `npm run build` first; documented in step 2 error category.) |

The 4 helper-specific tests (rev-1 per M2 — SPLIT) live in the dedicated `apps/lawbar-desktop/tests/pack-helper.test.mjs` (NEW; ~110 LOC; Tier-A pure-Node/npm-CLI; NO Electron runtime). A 5th shape-probe test for `npm pack --dry-run --json` is added in the same file (consolidating §12 H1's mitigation; previously implied a separate `tests/pack-helper-dry-run-shape.test.mjs` file that is now folded in). The packaged smoke file `tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` carries ONLY the 4 packaged-binary tests (test 1 asar list + test 2 native binary + test 3 symlink scan + test 4 spawn-probe). Test counts: pack-helper.test.mjs = 5, smoke file = 4. No conflation.

## §5 — `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` design

### Module shape

```ts
// apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts
// PoC probe: proves the desktop app can import + execute BOTH
// case-box-persistence AND case-box-contract at runtime inside the
// packaged Electron binary. Exercises the SPECIFIC failure path
// (case-box-contract/dist/ajv-instance.js) that defeated WI-B Option B.
//
// Invoked from electron/main.ts when --probe-casebox-pkg-arch is in argv.

import { InMemoryCaseBoxPersistence } from "case-box-persistence";
import { validateMatter } from "case-box-contract";

export interface PkgArchProbeResult {
  readonly ok: boolean;
  readonly matterId?: string;
  readonly validatorOk?: boolean;
  readonly error?: string;
  readonly durationMs?: number;
}

const FIXED_PAYLOAD = Object.freeze({
  id: "01h0000000000000000000poc1",  // 26-char ULID-shape; deterministic
  tenant_id: "default-tenant",
  actor_user_id: "local-user",
  name: "PoC matter",
  jurisdiction: { value: "us-ca-superior", locked: false },
  matter_type: "advisory",
  parties: [
    { role: "client", display_name: "PoC client", party_kind: "individual" },
  ],
  confidentiality_class: "normal",
  status: "active",
  external_ocr_authorized: false,
  sync_grant_present: false,
  llm_extraction_opt_in: false,
  created_at: "2026-05-25T00:00:00.000Z",
});

export async function runPkgArchProbe(): Promise<PkgArchProbeResult> {
  const t0 = Date.now();
  try {
    // [1] Exercise case-box-contract Ajv runtime — the SPECIFIC path that
    //     failed in WI-B Option B (case-box-contract/dist/ajv-instance.js
    //     couldn't be loaded under electron-builder's ASAR).
    const validation = validateMatter(FIXED_PAYLOAD);
    if (!validation.ok) {
      return {
        ok: false,
        error: `validateMatter failed: ${JSON.stringify(validation.errors).slice(0, 200)}`,
        durationMs: Date.now() - t0,
      };
    }

    // [2] Exercise case-box-persistence runtime + audit emission.
    const persistence = new InMemoryCaseBoxPersistence({ /* default options */ });
    const created = await persistence.createMatter(FIXED_PAYLOAD);
    if (created.id !== FIXED_PAYLOAD.id) {
      return {
        ok: false,
        error: `createMatter returned id=${created.id}; expected ${FIXED_PAYLOAD.id}`,
        durationMs: Date.now() - t0,
      };
    }

    return {
      ok: true,
      matterId: created.id,
      validatorOk: true,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      durationMs: Date.now() - t0,
    };
  }
}
```

### Stdout protocol (used by electron/main.ts flag handler)

- Success: `PROBE_OK matterId=<id> validatorOk=true durationMs=<n>\n` → `process.exit(0)`.
- Failure (any path): `PROBE_FAIL <category>: <message>\n` → `process.exit(1)`.
- Categories distinguish the failure point: `validator`, `persistence`, `import-failure`, `unknown`.

### Type-imports vs runtime-imports

- `InMemoryCaseBoxPersistence` and `validateMatter` are RUNTIME values (consumed via direct call). Imports use bare specifiers — NOT `import type`.
- TypeScript resolves the imports against the `case-box-persistence` + `case-box-contract` packages installed in `apps/lawbar-desktop/node_modules/` via the tarball deps.
- The renderer-import lint script (introduced in the IPC impl WI per `dev-memo/plan-case-box-ipc-contract-00.md` §9; NOT in scope here) would flag these imports IF they appeared in `renderer/**/*.ts`. The probe module is in `src/`, NOT `renderer/`, so the lint correctly does NOT apply.

## §6 — `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` design

### Test suite layout (4 test cases; ~130 LOC total)

```js
// Test 1: packaged .app + asar list inspection
test("packaged .app contains case-box-persistence AND case-box-contract in app.asar", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle, "packaged .app missing");
  const asarPath = path.join(appBundle, "Contents", "Resources", "app.asar");
  assert.ok(fs.existsSync(asarPath), "app.asar missing");

  // rev-2 per M-c: invoke the local `@electron/asar` bin DIRECTLY via the
  // resolved path. Hermetic by construction — no `npm exec` (which can fetch
  // remote packages under CI auto-install semantics); no `npx`; no `tar tzf`
  // (ASAR is not tar). Precheck the local bin exists; fail loud if missing.
  const asarBin = path.join(projectRoot, "node_modules", ".bin", "asar");
  assert.ok(
    fs.existsSync(asarBin),
    `expected local asar bin at ${asarBin}; install electron-builder first ` +
    `(its @electron/asar transitive dep provides this bin)`,
  );
  const listing = execFileSync(asarBin, ["list", asarPath], {
    encoding: "utf-8",
  });
  assert.match(listing, /\/node_modules\/case-box-persistence\/dist\/index\.js/);
  assert.match(listing, /\/node_modules\/case-box-contract\/dist\/index\.js/);
  // Verify the ajv-instance file that defeated WI-B Option B is now packed.
  assert.match(listing, /\/node_modules\/case-box-contract\/dist\/ajv-instance\.js/);
});

// Test 2: native binary unpacked (regression — Tier 1 / WI-B coverage)
test("packaged .app contains better_sqlite3.node in app.asar.unpacked", () => {
  const appBundle = findPackagedAppDir();
  assert.ok(appBundle);
  const native = path.join(appBundle, "Contents", "Resources", "app.asar.unpacked",
    "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  assert.ok(fs.existsSync(native), `better_sqlite3.node missing at ${native}`);
});

// Test 3: recursive symlink scan over Resources/ — no escape
test("packaged .app: no symlink escapes the .app bundle", () => {
  const appBundle = findPackagedAppDir();
  const resourcesDir = path.join(appBundle, "Contents", "Resources");
  const escapes = scanForSymlinkEscapes(resourcesDir, appBundle);
  assert.deepEqual(escapes, [],
    `found symlinks escaping app bundle: ${JSON.stringify(escapes, null, 2)}`);
});

// Helper: recursive walk; for every symlink, readlink + resolve; assert realpath stays
// inside the app bundle root.
function scanForSymlinkEscapes(dir, bundleRoot) { /* ~25 LOC */ }

// Test 4: spawn packaged binary with --probe-casebox-pkg-arch
test("packaged .app --probe-casebox-pkg-arch: validateMatter + createMatter round-trip succeeds",
  { timeout: 15_000 }, async () => {
    const appBundle = findPackagedAppDir();
    const binary = path.join(appBundle, "Contents", "MacOS", "lawbar");

    const result = await new Promise((resolve, reject) => {
      const child = spawn(binary, ["--probe-casebox-pkg-arch"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 10_000);
    });

    assert.equal(result.code, 0,
      `probe exited code=${result.code} signal=${result.signal}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stdout, /^PROBE_OK matterId=01h0000000000000000000poc1 validatorOk=true/m);
    assert.doesNotMatch(result.stdout, /PROBE_FAIL/);
});

// Reuses findPackagedAppDir from existing tests/smoke.native-module.electron.test.mjs pattern
function findPackagedAppDir() { /* ~20 LOC; copy of existing pattern */ }
```

### `LAWBAR_MODE` env

The packaged binary is spawned WITHOUT explicit `LAWBAR_MODE`, so it defaults to "production" per Tier 1 FileVault enforcement. The `--probe-casebox-pkg-arch` flag handler MUST short-circuit BEFORE FileVault decision (analogous to `--probe-case-box`), so FileVault state does NOT matter for this smoke. The test would pass on FileVault-OFF dev Macs as well as FileVault-ON CI / lawyer machines.

### Coverage scope (explicit acknowledgement)

- PROVES: case-box-contract Ajv validators load + execute inside packaged Electron; case-box-persistence runtime works including audit emission; tarball install + electron-builder packaging round-trips correctly; NO out-of-bundle symlinks.
- DOES NOT PROVE: IPC contract behavior (that's the IPC impl WI's smoke); SQLite on-disk backing (deferred to a separate WI); validators OTHER than `validateMatter` (deferred; full coverage in IPC impl WI tests); UI / renderer behavior (deferred).

## §7 — `apps/lawbar-desktop/electron/main.ts` modifications

### Probe flag handler addition (top of file)

```ts
// Existing (HEAD e5cb773):
if (process.argv.includes("--probe-case-box")) {
  void (async () => {
    const result = await runCaseBoxProbe();
    // ... existing exit 0/1 logic
  })();
}

// NEW (PoC WI):
if (process.argv.includes("--probe-casebox-pkg-arch")) {
  void (async () => {
    const result = await runPkgArchProbe();
    if (result.ok) {
      process.stdout.write(
        `PROBE_OK matterId=${result.matterId} validatorOk=${result.validatorOk} durationMs=${result.durationMs ?? 0}\n`
      );
      process.exit(0);
    } else {
      // Determine category from error message prefix
      const category = result.error?.startsWith("validateMatter")
        ? "validator"
        : result.error?.startsWith("createMatter") || result.error?.startsWith("InMemory")
          ? "persistence"
          : result.error?.includes("MODULE_NOT_FOUND") || result.error?.includes("ERR_MODULE_NOT_FOUND")
            ? "import-failure"
            : "unknown";
      process.stdout.write(`PROBE_FAIL ${category}: ${result.error ?? "(unknown)"}\n`);
      process.exit(1);
    }
  })();
}
```

### Whenready short-circuit extension

```ts
// Existing (HEAD e5cb773):
void app.whenReady().then(async () => {
  if (process.argv.includes("--probe-case-box")) return;
  // ... FileVault decision + createWindow

// NEW (extend the guard to OR with new flag):
void app.whenReady().then(async () => {
  if (
    process.argv.includes("--probe-case-box") ||
    process.argv.includes("--probe-casebox-pkg-arch")
  ) return;
  // ... FileVault decision + createWindow (UNCHANGED)
```

### Import addition

```ts
import { runPkgArchProbe } from "../src/casebox-pkg-arch-poc.js";
```

### Tier 1 FileVault enforcement preservation

The Tier 1 FileVault decision (commit `678bf16`) lives INSIDE `app.whenReady().then`. The probe flag handler is at TOP-LEVEL synchronous code; the `process.exit(0/1)` fires before `app.whenReady` resolves (probe completes in ~5-20 ms; Electron init takes longer). The OR'd short-circuit inside whenReady is defence-in-depth — if Electron's "ready" event happens to fire AHEAD of the probe IIFE's exit, the FileVault path is skipped without popping a dialog or quitting.

### Regression risk

The PoC must NOT alter:
- The exact ordering of `--probe-case-box` handler → `app.setName` → `ipcMain.handle` registrations → `app.whenReady` chain.
- The FileVault decision body (block / warn / proceed branches; canonical message strings).
- The existing `--probe-case-box` handler (Tier 1 WI-B coverage; tests reference its stdout protocol verbatim).
- The `app.on("before-quit")` / `app.on("window-all-closed")` handlers if any (verify against current main.ts source).

A regression-check test in the existing `tests/main.test.mjs` (NOT a NEW test file) asserts the FileVault probe-flag-detect still recognizes BOTH flags and that the existing `--probe-case-box` flow still works in unit tests.

## §8 — `apps/lawbar-desktop/package.json` modifications

```jsonc
// PLAN-DOCUMENT example (PoC WI applies):
{
  "scripts": {
    "build:ts": "tsc -p tsconfig.json",
    "build:assets": "mkdir -p dist/renderer && cp renderer/index.html renderer/index.css dist/renderer/",
    "build": "npm run build:ts && npm run build:assets",
    "pretest": "npm run build",
    "test": "node --test tests/main.test.mjs tests/smoke.electron.test.mjs",
    "test:unit": "npm run build && node --test tests/main.test.mjs",
    "test:smoke": "npm run build && node --test tests/smoke.electron.test.mjs",
    "test:packaged": "node --test tests/smoke.packaged.electron.test.mjs",
    "test:probe": "node --test tests/smoke.native-module.electron.test.mjs",
    "test:pkg-arch-poc": "node --test tests/smoke.casebox-pkg-arch-poc.electron.test.mjs",  // NEW
    "test:pack-helper": "node --test tests/pack-helper.test.mjs",                            // NEW (rev-2 per M-b)
    "dev": "npm run build && electron .",
    "dist": "npm run build && electron-builder",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "better-sqlite3": "^12.9.0",
    "case-box-contract": "file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz",      // NEW
    "case-box-persistence": "file:../../services/case-box-persistence/case-box-persistence-0.1.0.tgz"  // NEW
  }
}
```

NOTES:
- `build.files: ["dist/**/*", "package.json"]` is UNCHANGED. Electron-builder auto-includes production node_modules; the new `case-box-*` packages get bundled without explicit `files` extension.
- `build.asarUnpack: ["**/node_modules/better-sqlite3/**"]` is UNCHANGED. case-box-* are pure JS; only `better-sqlite3` needs asarUnpack (the transitive `case-box-persistence → better-sqlite3` dep is satisfied by the EXISTING direct dep; no path glob change needed).
- The `test:pkg-arch-poc` script is run separately from the default `test` (which only runs unit + dev smoke). Wiring it into `test` would require packaging on every `npm test` run; out of v1 PoC scope.

## §9 — `.gitignore` modifications

```gitignore
# NEW (appended to existing .gitignore):
# Stage-pack tarballs from scripts/pack-internal-package.mjs
services/**/*.tgz
docs/contracts/**/*.tgz
apps/**/*.tgz
```

PoC WI tarballs are workflow artifacts; never committed. The orchestrator follow-up WI may revisit this if CI needs cached tarball artifacts.

## §10 — Step-by-step PoC WI execution order

The PoC WI implements in this strict order so each step is independently verifiable. Failure at any step STOPS the WI and reports.

```
1. Pre-flight (no edits):
   1.1. Build case-box-contract: `cd docs/contracts/case-box-contract && npm run build && npm test`.
   1.2. Build case-box-persistence: `cd services/case-box-persistence && npm run build && npm test`.
   1.3. Verify both `dist/` directories are populated with expected entry points.

2. Authorization (per-line user approval at PoC WI start):
   2.1. Adding case-box-contract direct tarball dep to apps/lawbar-desktop/package.json.
   2.2. Adding case-box-persistence direct tarball dep to apps/lawbar-desktop/package.json.
   2.3. Adding scripts/pack-internal-package.mjs (NEW file at repo root).
   2.4. Adding .gitignore entries for *.tgz.
   2.5. (FALLBACK ONLY) source mutation of services/case-box-persistence/package.json (if staging-pack proves infeasible at step 4).

3. Create staging-pack helper:
   3.1. Create `scripts/` dir at repo root (if not exists).
   3.2. Create `scripts/pack-internal-package.mjs` per §4 design.
   3.3. Verify helper executes without args (prints usage + exits 1).
   3.4. Verify helper rejects unknown pkg name (exits 1).

3.5. **`.gitignore` update** (rev-1 per L1 — moved BEFORE stage-pack steps so tarball artifacts are ignored from the first creation):
   3.5.1. Append §9 entries (`services/**/*.tgz`, `docs/contracts/**/*.tgz`, `apps/**/*.tgz`) to repo-root `.gitignore`.
   3.5.2. Verify `git check-ignore -v <example-path>/foo.tgz` reports the new pattern matches.
   3.5.3. After step 4 + 5 produce real tarballs, verify `git status` does NOT list them as untracked.

3.6. **Create pack-helper test file** (rev-2 per M-b — wires the test file into the execution path):
   3.6.1. Create `apps/lawbar-desktop/tests/pack-helper.test.mjs` per §3 (~110 LOC; 5 tests).
   3.6.2. Add `"test:pack-helper": "node --test tests/pack-helper.test.mjs"` to `apps/lawbar-desktop/package.json` `scripts` (per §8 rev-2 update).

4.0. **Pre-stage-pack: run pack-helper tests on source tree** (rev-2 per M-b):
   4.0.1. From `apps/lawbar-desktop/`: `npm run test:pack-helper`.
   4.0.2. Verify all 5 helper tests PASS — including test 5 (shape-probe), which surfaces any `npm pack --dry-run --json` shape variance BEFORE stage-pack runs. If test 5 fails with `pack-dry-run-shape-unknown`, STOP and amend plan per §4 step 7a.
   4.0.3. Verify tests 3 + 4 produce intermediate tarballs in expected paths (these become the stage-packed outputs used by step 4 + step 5 below).

4. Stage-pack case-box-contract:
   4.1. From repo root: `node scripts/pack-internal-package.mjs case-box-contract`.
   4.2. Verify exit code 0 + stdout `PACK_OK case-box-contract -> docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz`.
   4.3. Verify the .tgz file exists at the expected output path.
   4.4. Extract the .tgz to a verification temp dir; verify `package/dist/index.js` exists and `package/package.json` has NO `case-box-contract`-named `file:` dep on itself.

5. Stage-pack case-box-persistence:
   5.1. From repo root: `node scripts/pack-internal-package.mjs case-box-persistence`.
   5.2. Verify exit code 0 + stdout `PACK_OK case-box-persistence -> services/case-box-persistence/case-box-persistence-0.1.0.tgz`.
   5.3. Verify the .tgz file exists at the expected output path.
   5.4. Extract to verification temp dir; verify `package/dist/index.js` exists; verify `package/package.json` `dependencies."case-box-contract"` is `"0.1.0"` (exact pin, NOT `"file:..."`).
   5.5. Verify SOURCE `services/case-box-persistence/package.json` is UNCHANGED (staging-pack path; source preserves original `file:..` ref).
   5.6. **Post-stage-pack: re-run pack-helper tests** (rev-2 per M-b): `npm run test:pack-helper`. Verify tests 3 + 4 PASS against the produced tarball manifests (now confirmed to carry the rewritten `dependencies."case-box-contract": "0.1.0"` spec, NOT `file:..`).

6. Add direct tarball deps to desktop app:
   6.1. Edit `apps/lawbar-desktop/package.json` per §8 — at this step add the 2 deps + the remaining `test:pkg-arch-poc` script (the `test:pack-helper` script was already added in step 3.6.2 per rev-2 per M-b, ahead of any stage-pack work; verify §8 final state matches the union of both additions).
   6.2. `cd apps/lawbar-desktop && npm install`.
   6.3. Verify install succeeds without `MODULE_NOT_FOUND` or `path-not-found` errors.

7. Recursive verification of installed tree:
   7.1. `lstat apps/lawbar-desktop/node_modules/case-box-persistence/` returns non-symlink directory.
   7.2. `lstat apps/lawbar-desktop/node_modules/case-box-contract/` returns non-symlink directory (hoisted alongside case-box-persistence).
   7.3. `cat apps/lawbar-desktop/node_modules/case-box-persistence/package.json | jq '.dependencies."case-box-contract"'` returns `"0.1.0"` (exact pin).
   7.4. `apps/lawbar-desktop/package-lock.json` records integrity hashes for both `case-box-persistence` AND `case-box-contract`.
   7.5. Recursive `lstat` walk of `apps/lawbar-desktop/node_modules/case-box-*/`: NO symlinks; `realpath` of any encountered symlink under `apps/lawbar-desktop/node_modules/` stays within that subtree.

8. Add probe + main.ts handler + smoke test:
   8.1. Create `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` per §5.
   8.2. Modify `apps/lawbar-desktop/electron/main.ts` per §7 (add flag handler + extend whenReady guard).
   8.3. Create `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` per §6.
   8.4. Build: `npm run build`.
   8.5. Run unit + dev smoke (regression): `npm test`. Verify all existing tests pass unchanged (Tier 1 + theme + WI-A + WI-B coverage retained).
   8.6. Package: `npm run dist`.
   8.7. Verify packaged binary exists at `apps/lawbar-desktop/dist/mac-arm64/lawbar.app/Contents/MacOS/lawbar`.

9. Run new packaged smoke:
   9.1. `npm run test:pkg-arch-poc`.
   9.2. Verify all 4 tests pass.
   9.3. Verify smoke shows `PROBE_OK matterId=01h0000000000000000000poc1 validatorOk=true durationMs=<n>` from the spawned packaged binary.

10. Regression sweep (full project test matrix):
    10.1. `npm test` (apps/lawbar-desktop): 26+ unit + dev smoke (Tier 1 FileVault + theme).
    10.2. `npm run test:packaged`: 3 WI-A packaged smoke tests.
    10.3. `npm run test:probe`: 2 WI-B native-module probe tests.
    10.4. `npm run test:pkg-arch-poc`: 4 NEW PoC packaged-smoke tests.
    10.5. `npm run test:pack-helper` (rev-2 per M-b): 5 NEW PoC helper-level tests (incl. shape-probe; same tests run at step 4.0 + 5.6).
    10.6. TOTAL: 40+ tests; all PASS.

11. ~~`.gitignore` update~~ (rev-1 per L1 — MOVED to step 3.5; sequenced BEFORE stage-pack so tarball artifacts are ignored from first creation).

12. cc-suite audit: `/cc-suite:audit` on the changed scope (NEW files + MOD files + MOD package.json + MOD package-lock.json).
    - Apply fixes if Lows can be inline; stop and escalate if C/H/M.
13. cc-suite verify: `/cc-suite:verify` against the audit report; assert 0 unresolved C/H/M.
14. Explicit-staging commit per `.claude/rules/staging-hygiene.md`. One commit unless plan-review divides into sub-WIs.

If ANY step from 4, 5, 6, 7, 8.6, 9, or 10 fails: STOP, report exact output, do NOT promote. Failure indicates Option 2 is not viable — return to package-arch lane for re-evaluation per the package-architecture plan §13 fallback options.
```

## §11 — Acceptance gates (PoC WI READY when)

1. **Source pre-flight tests green** (rev-1 per M3 — NEW): `npm --prefix docs/contracts/case-box-contract test` AND `npm --prefix services/case-box-persistence test` BOTH exit 0 before any stage-pack step runs. A broken source breaks the PoC silently otherwise.
2. **Helper script behavior**: `scripts/pack-internal-package.mjs` exits 0 on both internal packages; produces tarballs at expected output paths; per-error categorized stderr on failure.
3. **Helper fail-closed manifest scan** (rev-1 per M1 — NEW): after the registry rewrites apply, the helper's fail-closed scan finds NO unexpected `file:` or `link:` specs across `dependencies`/`optionalDependencies`/`peerDependencies` in either packed manifest. Verified by `tests/pack-helper.test.mjs` test 4 (case-box-persistence happy path) AND by an explicit assertion in PoC step 5.4.
4. **Staging-pack preserves source manifests**: `services/case-box-persistence/package.json` is UNCHANGED post-stage-pack (verify with `git diff --exit-code services/case-box-persistence/package.json`).
5. **`.gitignore` effective post-stage-pack** (rev-1 per M3 — NEW): after `*.tgz` entries are appended (per step 3.5) AND tarballs are produced (steps 4 + 5), `git status --short` does NOT list ANY of the produced tarball files as untracked. Verified by `git status --porcelain | grep -E '\.tgz$'` returning empty.
6. **Both internal packages install as real directories**: per §10 step 7 verifications.
7. **Lockfile integrity**: `apps/lawbar-desktop/package-lock.json` records integrity hashes (sha512) for `case-box-persistence` AND `case-box-contract`.
8. **No out-of-tree symlinks**: recursive `lstat` walk over `apps/lawbar-desktop/node_modules/case-box-*/` finds zero symlinks; for any symlink encountered ANYWHERE under `node_modules/`, `realpath` stays within `apps/lawbar-desktop/node_modules/**`.
9. **Packaged .app contains expected JS** (rev-2 per M-c — hermetic): direct invocation of `node_modules/.bin/asar list <app.asar>` (with `fs.existsSync` precheck) shows BOTH `/node_modules/case-box-persistence/dist/index.js` AND `/node_modules/case-box-contract/dist/index.js` AND `/node_modules/case-box-contract/dist/ajv-instance.js` (the specific file that failed in WI-B Option B).
10. **Packaged .app contains expected native binary**: `better_sqlite3.node` at `app.asar.unpacked/.../better-sqlite3/build/Release/`. (WI-B regression.)
11. **No symlink escapes the .app bundle**: recursive scan over `Contents/Resources/` finds zero symlinks whose `realpath` leaves the bundle root.
12. **Packaged smoke PROBE_OK**: spawning packaged binary with `--probe-casebox-pkg-arch` prints `PROBE_OK matterId=01h0000000000000000000poc1 validatorOk=true` and exits 0 within 15 s.
13. **Full regression**: all existing project tests continue to pass (Tier 1 FileVault, theme IPC, WI-A packaged, WI-B probe).
14. **`loc-guardian:scan`**: 0 over for all new + modified files.
15. **`cc-suite:audit`**: 0 Critical / 0 High / 0 Medium findings (Lows acceptable per `.claude/rules/cc-suite.md` §"Audit remediation policy").
16. **`cc-suite:verify`** (rev-1 per M3 — NEW): post-audit verify pass returns 0 unresolved Critical/High/Medium findings against the audit report.

## §12 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High** (rev-0 H1; rev-2 architecture corrected) | `npm pack --dry-run --json` may not emit a `files`-list field in the JSON shape this plan assumes. The actual JSON shape varies across npm versions. | rev-2 per M-a: helper uses a **stop-and-amend** path — NO fallback parser. If shape detection fails (per §4 step 7a), helper exits 1 with category `pack-dry-run-shape-unknown` and prints the raw JSON (truncated 1000 chars) + a clear "plan must be amended" instruction. PoC stops; §11 gate 2 fails; plan is amended with observed shape before PoC continues. The shape-probe test (`pack-helper.test.mjs` test 5) verifies the helper's shape detection works against the locally-installed npm version BEFORE stage-pack runs. Rejected approach: rev-1's "fallback to human-readable stderr parsing" — unspecified, untested, and an unknown install shape means unverified install behavior (defeats the PoC's purpose). |
| **High** | The temp dir's `npm pack` may not include `dist/` for case-box-persistence because the source's `.gitignore` (which excludes `dist/` at the repo level) is INHERITED by `npm pack` from the package's own `.gitignore` IF the package has one. case-box-persistence might have a local `.gitignore` excluding `dist/` even inside a temp dir. | Helper EXPLICITLY verifies `dist/index.js` is in the dry-run output (per §4 step 7). If missing, helper exits 1 with `dry-run-missing-entry` category. Mitigation: either (a) the temp dir copy SKIPS the source's `.gitignore`/`.npmignore` files (the helper's copy filter excludes them by name), OR (b) the helper writes a `.npmignore` to the temp dir that ALLOWS `dist/` explicitly. PoC must determine which approach works against the actual installed npm. |
| **Medium** | The tarball install at the desktop level may produce a NESTED `node_modules/case-box-persistence/node_modules/case-box-contract/` instead of hoisting to flat `apps/lawbar-desktop/node_modules/case-box-contract/`. Either layout satisfies module resolution per Node's algorithm, but cc-suite audit may flag the nested layout as duplicating the package. | Verification step 7.2 must allow BOTH layouts: check `apps/lawbar-desktop/node_modules/case-box-contract/` AND `apps/lawbar-desktop/node_modules/case-box-persistence/node_modules/case-box-contract/`. Whichever exists, the package-lock.json should record both correctly. cc-suite audit may need a "deduplication is npm's concern, not ours" deferral note. |
| **Medium** | The FIXED_PAYLOAD in the probe uses a hand-crafted ULID-shape string `"01h0000000000000000000poc1"`. case-box-persistence's `createMatter` validates the id against the schema regex `^[0-9a-z]{26}$` (rev-1 per typo fix: the regex accepts ALL lowercase a-z; NOT restricted to Crockford alphabet). The hand-crafted value MUST satisfy that regex. | Verify the literal value matches the regex at PoC plan time: `01h0000000000000000000poc1` is 26 chars, lowercase, all in `[0-9a-z]` — including `o` and `c` which the schema accepts (and which Crockford excludes — but the schema is broader). ✓ Safe. If the PoC author picks a different literal, MUST re-check against `^[0-9a-z]{26}$`. |
| **Medium** | The `runPkgArchProbe` import of `case-box-persistence` may pull better-sqlite3 transitively even though InMemoryCaseBoxPersistence does NOT need it. Loading the entire `case-box-persistence/dist/index.js` triggers `import "better-sqlite3"` indirectly (via the SQLite implementations re-exported from index). This is fine in dev but may break in packaged binaries if better-sqlite3 isn't on the resolved path. | Better-sqlite3 IS already a direct desktop dep (WI-B Option A); the existing asarUnpack glob handles native. PoC reuses existing native infrastructure. Risk is theoretical; verify in step 9. |
| **Medium** | Adding 2 new direct runtime deps changes the desktop's `npm install` time + `npm run dist` time noticeably. CI / first-clone overhead increases. | One-time cost; subsequent `npm install` cached. Recorded for transparency; no v1 mitigation needed. |
| **Low** | The `--probe-casebox-pkg-arch` flag may conflict with future Electron-builtin flags or other probe-flag patterns. | Flag name is namespaced to lawbar; collision risk is low. Documented in main.ts header comment. |
| **Low** | The PoC's packaged smoke (§6 test 4) sets a 10s SIGKILL fallback in case the probe hangs. If the probe legitimately takes >10s on slow CI runners, the test would falsely fail. | In-memory ops are <100 ms; 10s leaves 100x headroom. If CI runners prove slower, bump to 30s in a follow-up. |
| **Low** | `.gitignore` change pattern `apps/**/*.tgz` may unintentionally exclude legitimate `.tgz` files committed elsewhere (none exist today; recorded for future). | Scope is intentional; future commits that need a tarball can override via `apps/<specific-path>/!/*.tgz`. |

No Critical risks identified. If reviewer disagrees, the H1 dry-run-JSON-shape concern is the most likely escalation.

## §13 — Hard stops

This plan does NOT trigger any hard-stop in `.claude/rules/autonomy.md` §"Hard-stop list":
- No push, deploy, release, production, migration, auth provider, cloud vendor, public exposure.
- No new runtime dependency in THIS plan (the PoC WI adds 2 under its own authorization).
- No public API change (the PoC does not modify case-box-persistence or case-box-contract; the staging-pack helper rewrites a manifest in a temp dir only).
- No schema change.
- No secrets / credentials / billing.
- No real case data (probe uses a fixed deterministic payload; in-memory persistence; no userData writes).
- No Tier 2 SQLCipher / Keychain.

The plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it adds new runtime dependencies + changes packaging topology. `/cc-suite:review-plan` is required (this lane runs it).

## §14 — Review packet (compact)

**Active plan summary (rev-2)**: PoC impl plan for `WI-desktop-pkg-arch-tarball-poc`. Implements the staging-pack helper (`scripts/pack-internal-package.mjs`; ~120 LOC; includes rev-1 fail-closed scan for unexpected `file:`/`link:` deps across `dependencies`/`optionalDependencies`/`peerDependencies` + rev-2 stop-and-amend on `npm pack --dry-run --json` shape mismatch via `pack-dry-run-shape-unknown` category), the probe module (`apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts`; ~90 LOC; exercises `validateMatter` + `createMatter` to prove case-box-contract Ajv + case-box-persistence runtime BOTH load inside the packaged Electron binary), the packaged smoke test (`tests/smoke.casebox-pkg-arch-poc.electron.test.mjs`; ~130 LOC; 4 cases including hermetic `node_modules/.bin/asar list` inspection + recursive symlink-escape scan + spawn-probe), the helper-level test file (`tests/pack-helper.test.mjs`; ~110 LOC; rev-1 split per M2; rev-2 wired into execution path; 5 tests including the `npm pack --dry-run --json` shape-probe), modifies `electron/main.ts` to add the `--probe-casebox-pkg-arch` flag handler (OR'd with existing `--probe-case-box` short-circuit; preserves Tier 1 FileVault enforcement), modifies `apps/lawbar-desktop/package.json` to add 2 NEW direct runtime tarball deps (`case-box-contract` + `case-box-persistence`) + 2 NEW test scripts (`test:pkg-arch-poc` + `test:pack-helper` per rev-2 per M-b), and adds `*.tgz` exclusions to `.gitignore` (sequenced BEFORE stage-pack per rev-1 L1). No source mutation of `services/case-box-persistence/package.json` (staging-pack handles the manifest rewrite in a temp dir). Net: 4 NEW files, 3 MOD files, 1 auto-regenerated lockfile, ~340 LOC source + ~240 LOC test.

**Exact target files**: see §3 table — 4 NEW + 3 MOD + 1 auto (rev-2 normalized).

**Exact acceptance criteria**: see §11 — 16 gates (rev-2 normalized).

**Exact out-of-scope list**:
- IPC implementation (separate WI after PoC lands).
- The orchestrator (`scripts/build-internal-packages.mjs`) — separate follow-up WI.
- Source mutation of `services/case-box-persistence/package.json` (staging-pack handles it; mutation is the STOP-AND-ASK fallback only).
- Product UI / case-box-aware screens.
- Real case data persistence (in-memory probe only).
- Tier 2 SQLCipher / Keychain.
- All operations outside the probe's 2-call scope (`validateMatter` + `createMatter`).
- npm/pnpm workspaces.
- Private package registry.
- Auth provider / cloud sync / signing / distribution / telemetry.

**Essential references**:
- `dev-memo/plan-desktop-package-architecture-00.md` (`e5cb773`; rev-3 READY) — design authority.
- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`; rev-3 READY) — IPC consumer.
- `services/case-box-persistence/src/index.ts` (entry surface).
- `docs/contracts/case-box-contract/src/index.ts` (validateMatter export).
- `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` (FIXED_PAYLOAD validation target).
- `apps/lawbar-desktop/electron/main.ts` HEAD `e5cb773` (probe-flag short-circuit + FileVault enforcement).
- `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs` (WI-B precedent for `findPackagedAppDir`, spawn-probe protocol).
- commit `c708ece` body (WI-B Option B abandonment — the failure mode this PoC must NOT recur).

**Review questions** (target the load-bearing assumptions):
1. Is the §4 helper algorithm sound, particularly the `npm pack --dry-run --json` parsing? Verify the JSON shape against the npm version pinned by `apps/lawbar-desktop`'s engines field (`>=22.0.0 <26.0.0`). rev-2 per M-a: if the shape varies, the helper STOPS with `pack-dry-run-shape-unknown` — NO fallback parser is attempted (rev-1 wrongly claimed text-parse fallback). Plan must be amended with observed shape before PoC continues.
2. Is the §5 FIXED_PAYLOAD complete against `case-box-matter.schema.json` 13 required fields? Specifically: `name`, `jurisdiction (object)`, `matter_type`, `parties[]`, `confidentiality_class`, `status`, 3 booleans, `created_at`, `id`, `tenant_id`, `actor_user_id` — all 13 covered?
3. Is the §6 test 1 ASAR listing approach hermetic (rev-2 per M-c)? Direct invocation of `node_modules/.bin/asar` with `fs.existsSync` precheck guarantees no network reach (unlike `npm exec` which has CI auto-install semantics, or `npx` which fetches remote packages). Reviewer should confirm electron-builder's `@electron/asar` transitive dep DOES populate `apps/lawbar-desktop/node_modules/.bin/asar` (rev-1 review confirmed it does).
4. Is the §7 main.ts modification ordering correct? The existing `--probe-case-box` handler is at lines ~26-37 (per HEAD `e5cb773`); the new handler should land AFTER it, BEFORE `app.setName`. Verify position against the actual current main.ts source.
5. Is the §10 step 7.2 verification (hoisting check) realistic? npm 11+ hoisting is the default but may produce nested layouts under certain conditions (peer-dep conflicts, version mismatches). Should the verification accept BOTH layouts OR insist on flat hoisting?
6. Is the §12 H1 risk mitigation adequate? Should the PoC author build a stub helper FIRST that prints the dry-run JSON shape so the PoC plan can be amended with the verified parse logic BEFORE the helper's real implementation lands?

## §15 — LOC budget reconciliation

| File | Est LOC | Threshold | Margin |
|---|---|---|---|
| `scripts/pack-internal-package.mjs` | 120 | 800 src | 680 |
| `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` | 90 | 800 src | 710 |
| `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` | 130 | 1200 test | 1070 |
| `apps/lawbar-desktop/tests/pack-helper.test.mjs` (rev-1 per M2 — NEW) | 110 | 1200 test | 1090 |
| `apps/lawbar-desktop/electron/main.ts` (post-mod) | 138+25=163 | 800 src | 637 |
| `apps/lawbar-desktop/package.json` | (config; no LOC threshold) | n/a | n/a |
| `.gitignore` (post-mod) | (config; no LOC threshold) | n/a | n/a |

Total new + modified source: ~373 LOC (3 files). Total new test: ~240 LOC (2 files; ~130 packaged smoke + ~110 helper). All well under thresholds.

## §16 — Stop condition

This plan becomes stale when:
- The PoC WI lands and is verified. After that, this plan is the as-built reference until a revised PoC plan supersedes.
- The package-architecture plan is amended in a way that changes a load-bearing decision (Option 2 retired; staging-pack approach abandoned; etc.).
- `services/case-box-persistence` or `docs/contracts/case-box-contract` ships a version bump that breaks the helper's hard-coded `expectedVersion` registry.
- npm publishes a breaking change to `npm pack --json` output shape.

## §17 — Required cc-suite review

This plan is not authorized for promotion to the PoC WI until:
1. `/cc-suite:review-plan dev-memo/plan-desktop-pkg-arch-tarball-poc-00.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The chosen staging-pack approach (per package-architecture plan §11.0) is not overridden without re-review.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency across §3-§14.
- Consistency with package-architecture plan (`e5cb773`) — particularly §11.0 + §11.1.
- Consistency with IPC contract plan (`9f9f79b`) — the PoC must NOT break any contract assumption.
- File-budget realism (do the LOC estimates hold given npm-version-dependent complexity?).
- Hard-stop clarity (§13 must be explicit; 2 new runtime deps are PoC WI authorization, not THIS plan's).
- Tier 1 FileVault enforcement preservation (`678bf16` regression risk in §7).
