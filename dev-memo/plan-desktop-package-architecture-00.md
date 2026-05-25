# PLAN — Desktop package architecture (how `apps/lawbar-desktop` should consume internal packages)

**Status**: PLAN-ONLY (READY after fourth review; 2 Low fixes applied inline).
**Date**: 2026-05-25.
**Author**: Claude Code on explicit user direction (desktop package-architecture lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Authorization basis**:
- IPC contract plan READY on `origin/main` at `9f9f79b`.
- IPC implementation planning was STOPPED (`review-plan-mpkq3ujg-nrsvw5` NOT READY; root blocker = no valid runtime import/package path for `case-box-persistence`).
- Prior WI-B Option B (commit `c708ece` body) deterministically failed with electron-builder.
- WI-B Option A (commit `c708ece`) proved only direct `better-sqlite3` ABI compat, NOT case-box-persistence packaging.

This lane resolves the structural blocker by **planning** how the desktop app should consume internal packages such as `case-box-persistence` and `case-box-contract`. No code, no dep install, no workspace restructure, no package.json mutation (except as PLAN-DOCUMENT examples in quoted snippets).

**rev-1**: applies all findings from `review-plan-mpkqnk5p-w8o4d6` (0 C / 1 H / 2 M / 1 L embedded). Edits touched: §6 (Option 2 C9 score lowered from 5 to 4; total recomputed 41→40 — recommendation unchanged); §10 (score table updated; trade-off acknowledgement updated); §11 (PoC step order rewritten: case-box-contract pre-packed FIRST; explicit authorization requirement for any case-box-persistence/package.json edits; step 4 expanded to recursive symlink-realpath verification of full nested tree; step 6 expanded to inspect BOTH `app.asar` AND `app.asar.unpacked` plus packaged-tree symlink scan; step 7 tightened to explicitly call `validateMatter` in addition to `createMatter`); §13 H2 risk reframed from "conditional" to "expected; PoC starts with nested pre-pack". NO scope, dependency, or hard-stop change.
- **rev-2**: applies all findings from `review-plan-mpkrdvfc-qhk47p` (0 C / 1 H / 3 M / 0 L). The rev-1 H fix was internally inconsistent — proposed swapping `case-box-persistence`'s nested `file:..` dep to `file:..tgz`, which has the SAME path-resolution failure mode in the desktop install context (npm resolves `file:` specs relative to the consuming package's install location regardless of whether the target is a directory or a tarball). rev-2 corrects this:
  - **§11.0 + §11.1**: explain `file:` resolution semantics; the dep-spec fix is to use a **non-`file:` spec** (exact version `0.1.0` or semver range `^0.1.0`); the desktop app installs BOTH `case-box-contract` AND `case-box-persistence` as direct tarball deps; npm's standard parent-walk module resolution finds case-box-contract via hoisting.
  - **§11.1 step 2 (renamed "Build tarball for case-box-persistence WITH staged manifest")**: prefer a staging/pack helper script that rewrites the manifest IN A TEMP DIR (no source mutation); fallback (if staging proves infeasible at PoC start) is to STOP-AND-ASK for source-manifest edit authorization. Both paths documented; staging preferred.
  - **§11.1 step 4**: desktop adds BOTH internal packages as direct tarball deps.
  - **§11.1 step 9**: dev-link/dev-unlink/dev-status REMOVED from the PoC. Local-dev iteration cost is accepted as "rebuild + repack + reinstall" + documented manual recovery procedure. Eliminates the partial-state recovery risk surface entirely.
  - **§12**: hard-stop accounting names BOTH packages (direct `case-box-persistence` + direct `case-box-contract`); names BOTH transitive runtime requirements; no undercount.
  - **§14**: explicit count of 2 manifest changes (apps/lawbar-desktop/package.json + optionally services/case-box-persistence/package.json depending on whether staging-pack works), 2 packages added to desktop install tree.
  - **§15 review packet**: scope updated to ~70/~100 LOC; manifest rewrite REQUIRED (not deferred); dev-link mentions removed.
  - **§13**: risk table updated for rev-2 architecture (`file:` semantics misunderstanding documented as resolved).
  - No scope, dependency, or hard-stop change beyond what rev-1 already documented; the rev-2 architectural fix actually REMOVES the dev-link complication, simplifying the PoC.
- **rev-3**: applies all findings from `review-plan-mpkrx28j-hu0e6p` (0 C / 0 H / 3 M / 1 L). All mechanical cleanup; H stays resolved per rev-2 architecture. Edits: (a) scrubbed stale dev-link text from §6 (Option 2 Cons + Mitigation), §10 (recommendation trade-off acknowledgement), §13 (risk rows); local-dev story is consistently "rebuild + stage-pack + reinstall"; (b) §14 hard-stop accounting corrected to "2 direct runtime dependencies in the PoC WI" (case-box-contract + case-box-persistence); (c) §11.0 source-mutation fallback rewritten to drop the "likely fine" sibling-lookup claim; fallback now explicitly requires its own install strategy for `services/case-box-persistence` (e.g. sibling tarball install setup); (d) §13 risk row step-reference corrected from step 6 to step 7 (electron-builder packaging is step 7; step 6 is `npm run build:ts`); (e) PoC tightenings added: `npm pack --dry-run` verification + check that case-box-persistence tarball includes `dist/` (no implicit `files` allowlist); exact pin `"0.1.0"` over semver range. No scope, dependency, or hard-stop change.
- **rev-3 (post-review Low fixes applied; `review-plan-mpksdtmr-rlcwrv` returned READY-with-Lows)**: 2 mechanical text Lows applied inline before commit. L1 — §11 failure-mode bullet "Dev-link mode breaking production build" struck-through with rev-3 cleanup note (the dev-link toolchain was removed in rev-2; bullet was stale historical text). L2 — §11.1 step 1 + step 2 command-cwd clarified: stage-pack helper invocation explicitly says "FROM REPO ROOT" (helper is repo-root-scoped, not package-dir-scoped); avoids misread of running the helper from inside the package dir. No scope, dependency, or hard-stop change.

## §1 — Scope + non-goals

**In scope** (plan-only):
- Articulate the actual failure mode that blocks IPC impl (per WI-B Option B abandonment).
- Define evaluation criteria covering Electron packaging, lockfile semantics, CI, local dev ergonomics, source-of-truth drift, security/reproducibility, native-module rebuild compatibility.
- Evaluate 5 candidate strategies against the criteria:
  1. npm/pnpm workspaces.
  2. npm pack tarball install (build-time tarball install).
  3. Build artifact / package export (direct relative imports of pre-built `dist/`).
  4. Vendoring / copying built sources into the app tree.
  5. Private published package (npm private registry / GitHub Packages / Verdaccio).
- Recommend one strategy with explicit trade-off statement.
- Define a minimal PoC + test plan that MUST pass before IPC impl can resume.
- List follow-up WIs to land in sequence.

**Explicitly out of scope** (deferred or forbidden):
- Implementation of the chosen strategy.
- Installing or removing any dependency.
- Restructuring the existing workspace.
- Modifying any `package.json` file (except as PLAN-DOCUMENT examples in code blocks).
- Choosing a registry vendor (Option 5 STOP-AND-ASK).
- Bundler introduction (esbuild, webpack, Rollup, Vite, etc. — separate lane if recommended).
- Workspace tool introduction (turbo, nx, lerna — separate lane if recommended).
- Restructuring `services/`, `docs/contracts/`, or `apps/` directories.
- IPC impl restart (separate lane after this plan reaches READY and the chosen strategy's PoC lands).
- Real case data, product UI, Tier 2 SQLCipher, signing, distribution, etc.

## §2 — Existing context used

- `apps/lawbar-desktop/package.json` HEAD `9f9f79b`:
  - `dependencies`: `{ "better-sqlite3": "^12.9.0" }` (single runtime dep).
  - `devDependencies`: `electron ^34.0.0`, `electron-builder ^25.0.0`, `typescript ^5.6.0`, `@playwright/test`, `playwright`, `@types/node`.
  - `type: "module"`, `engines.node: ">=22.0.0 <26.0.0"`.
  - `build.files: ["dist/**/*", "package.json"]`, `build.asarUnpack: ["**/node_modules/better-sqlite3/**"]`.
- `services/case-box-persistence/package.json`:
  - `dependencies`: `{ "better-sqlite3": "^12.9.0", "case-box-contract": "file:../../docs/contracts/case-box-contract" }`.
  - Uses `file:` link to consume the case-box-contract package — works at test layer (`npm --prefix services/case-box-persistence test`) but NOT under electron-builder.
- Repository structure (no root `package.json`; no npm workspaces):
  - 8 internal packages: 1 `ocr-worker-contract`, 1 `case-box-contract`, 5 `ocr-*` services, 1 `case-box-persistence`, 1 `lawbar-desktop` app.
  - All ESM (`"type": "module"`).
  - All compile via `tsc -p tsconfig.json` to `dist/`.
- **WI-B Option B failure** (commit `c708ece` body, "Option B abandoned" section):
  - **`asar: true` error**: `case-box-contract/dist/ajv-instance.js must be under apps/lawbar-desktop/` — electron-builder's ASAR packer rejects cross-package symlinks (`file:` deps that resolve OUTSIDE the app dir).
  - **`asar: false` fallback error**: `ENOENT: ensureSymlink Versions/Current/Resources` — macOS framework symlink-recreate bug in app-builder-lib when ASAR is disabled.
  - **Both configurations failed deterministically.** Documented as a known electron-builder limitation (cf. electron-builder GH issue #4496).
  - Documented workarounds: npm pack tarball, vendoring, npm/pnpm workspaces (NONE attempted in WI-B; out of WI-B scope at the time).
- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`) §3 (case-box-persistence public API), §10 (in-memory backing v1), §10.1 (CaseBoxRuntime singleton lifecycle).
- `dev-memo/plan-casebox-ipc-impl-00.md` (unstaged; lane STOPPED; rev-0 with 1 H + 5 M + 1 L blocking findings — H was THIS dependency problem). Will NOT be committed; preserved as workspace dirty until a follow-up lane decides to discard or revive.
- `AGENTS.md` §"Project Instructions" — contract = vocabulary owner; persistence = source of truth; queue = transport. No statement about packaging topology.
- `docs/product/project-requirements-brief.md` §3 (Mac primary; single binary). §17 deferred (no business model implications). §20 STOP-AND-ASK: "auth provider choice, cloud vendor choice" — NOT explicitly registry-vendor, but per `.claude/rules/autonomy.md` a private registry choice is structurally analogous to an external-account dependency and SHOULD be a STOP-AND-ASK.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — packaging-topology change touches "framework / runtime dependencies"; cc-suite review-plan required (this plan IS that review).
- `.claude/rules/loc-guardian.md` — applies to any new source files; not directly to this plan-only doc.

## §3 — Problem statement (precise framing)

`apps/lawbar-desktop/` needs to consume the JavaScript runtime of `case-box-persistence` (and its transitive `case-box-contract` dep for Ajv validators) **inside a packaged Electron app**. The package must:

1. **Compile + type-check** during dev (`tsc` in apps/lawbar-desktop/).
2. **Bundle into the .app** during `npm run dist` (electron-builder).
3. **Load at runtime** inside the packaged binary (Electron's Node ABI; same module resolution as Node).
4. **Pass an end-to-end smoke** — opening the packaged .app and calling a case-box-persistence method through the IPC layer returns a correct result, with no `MODULE_NOT_FOUND` / `Cannot find package` / ASAR `must be under` / symlink errors.

The previously-tried `file:../../services/case-box-persistence` topology (Option B) FAILED gates 2 + 3 because electron-builder treats `file:` deps as symlinks pointing OUTSIDE the app dir, and:
- ASAR packer rejects out-of-app paths (`asar: true` failure).
- macOS framework copier fails on the symlink-recreate path (`asar: false` failure).

Any alternative MUST avoid symlinks pointing outside `apps/lawbar-desktop/` at the moment electron-builder runs.

## §4 — Evaluation criteria (each option scored 1-5; higher = better)

| # | Criterion | Description |
|---|---|---|
| C1 | **Electron-builder compatibility** | Does `npm run dist` succeed without symlink-out-of-app errors? Does the packaged binary contain all required JS + native binaries in `app.asar` or `app.asar.unpacked`? |
| C2 | **Lockfile semantics** | Does `package-lock.json` deterministically pin the consumed package's content (hash)? Can `npm ci` reproduce the build on a fresh clone? |
| C3 | **CI / build-pipeline impact** | How many build orchestration steps are added before `npm install` in the desktop app? Are those steps cacheable? Can they fail informatively? |
| C4 | **Local dev ergonomics** | How fast is the inner loop "edit `services/case-box-persistence/src/foo.ts` → see change in desktop app"? Does the dev need to remember an extra step? |
| C5 | **Source-of-truth drift** | If two copies of the package exist (vendored, tarball cache, etc.), how easily can they diverge from the canonical `services/case-box-persistence/`? Is divergence detected pre-merge? |
| C6 | **Security / reproducibility** | Can a build on machine A be byte-identical to a build on machine B given the same lockfile? Does the strategy require trust in an external service? |
| C7 | **Native-module rebuild compat** | Does `electron-builder install-app-deps` (which calls `@electron/rebuild`) find and rebuild `better-sqlite3` regardless of which layer pulls it in? Are there path-walk issues? |
| C8 | **Brief §15 / §20 alignment** | Does the strategy avoid choosing an auth provider, cloud vendor, or telemetry path? Does it stay inside the brief's "local-first, single-binary Mac app" posture? |
| C9 | **Reversibility** | If the strategy turns out wrong 3 months later, how much work to swap it for another? |

Scores explicitly stated per option in §§5-9.

## §5 — Option 1: npm/pnpm workspaces

### Description

Add a root `package.json` declaring `"workspaces": ["apps/*", "services/*", "docs/contracts", "docs/contracts/case-box-contract"]`. Internal package references use bare names (e.g. `"case-box-persistence": "*"`); npm/pnpm hoists deps to root `node_modules/` and creates symlinks at `node_modules/case-box-persistence -> ../services/case-box-persistence`.

### Pros

- Standard monorepo idiom.
- One lockfile (root `package-lock.json`).
- Single install run.
- Bare-name imports (`from "case-box-persistence"`) work without `file:` syntax.

### Cons (decisive for v1)

- **Same symlink-out-of-app problem as `file:` deps.** When electron-builder runs in `apps/lawbar-desktop/`, it walks `node_modules/case-box-persistence` and discovers it's a symlink to `../../services/case-box-persistence` — STILL OUTSIDE `apps/lawbar-desktop/`. ASAR packer rejects it for the same reason as Option B failed. **NOT VERIFIED — needs a PoC to confirm whether electron-builder distinguishes workspace symlinks from `file:` symlinks. The reviewer should pressure-test this claim.**
- Requires top-level `package.json` (architectural commitment).
- Requires `npm install` at repo root (changes existing "per-package install" muscle memory).
- Workspaces hoisting may surface dep-version conflicts that currently don't exist (different `better-sqlite3` versions across services would need reconciliation).
- pnpm has a stricter isolation model (its own `pnpm-workspace.yaml`); switching install tool is its own decision.
- Even if electron-builder respects workspace symlinks, the `app.asar` bundling would still need either (a) packing the symlink target's content (a feature that may or may not exist) or (b) `asarUnpack` for every workspace dep tree (defeats the purpose of `asar: true`).

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Electron-builder compat | **2** | UNVERIFIED; PoC needed. Likely fails for the same root cause as `file:` deps. |
| C2 Lockfile | 4 | One lockfile; deterministic. |
| C3 CI | 4 | One install. |
| C4 Local dev | 5 | Edit in service, immediate use in app. |
| C5 SoT drift | 5 | No copy; symlink IS the source. |
| C6 Reproducibility | 4 | Pinned by lockfile + workspace package versions. |
| C7 Native rebuild | 4 | `electron-builder install-app-deps` walks `node_modules`; symlink semantics may confuse `@electron/rebuild`'s path discovery. |
| C8 Brief alignment | 5 | No external service. |
| C9 Reversibility | 2 | Adding a root `package.json` + `workspaces` is a one-way architectural step; removing it later means a full re-install dance. |
| **TOTAL** | **35/45** | Best ergonomics BUT critical C1 unverified. |

## §6 — Option 2: npm pack tarball install

### Description

Each internal package is built (`npm run build` produces `dist/`) and packed (`npm pack` produces `<name>-<version>.tgz`). The desktop app's `package.json` declares the dep as a local tarball:

```json
"dependencies": {
  "case-box-persistence": "file:../../services/case-box-persistence/case-box-persistence-0.1.0.tgz"
}
```

Or as a relative path to the tarball without `file:` prefix (npm 7+ accepts both). The desktop app's `npm install` extracts the tarball into `apps/lawbar-desktop/node_modules/case-box-persistence/` as a REAL directory (NOT a symlink). Electron-builder sees no symlink-out-of-app; ASAR packs the extracted directory normally.

A wrapper script in the repo orchestrates "build all internal packages → pack each → install in desktop app":

```bash
# scripts/build-internal-packages.mjs (PLAN-DOCUMENT example; ~50 LOC)
for pkg in services/case-box-persistence docs/contracts/case-box-contract; do
  (cd "$pkg" && npm run build && npm pack)
done
cd apps/lawbar-desktop
npm install   # picks up tarballs per package.json
```

### Pros

- **Solves the root cause.** Tarball extraction creates real directories inside `apps/lawbar-desktop/node_modules/`. Electron-builder's ASAR packer sees them as in-app content and packs them.
- Lockfile pins the tarball **content hash** (npm records the integrity hash) — reproducible.
- No symlinks anywhere in the production install tree.
- Standard `import` resolution.
- Works with `electron-builder install-app-deps` (native deps in tarball are rebuilt against Electron's ABI like any other dep).
- No new top-level architectural artifact (no root `package.json`, no workspace).
- Each internal package keeps its existing per-package `npm test` workflow.

### Cons

- **Two-step build**: build internal packages BEFORE running `npm install` in desktop app. The orchestration script (`scripts/build-internal-packages.mjs` or equivalent) becomes a documented prerequisite for `npm run dist`.
- **Local dev iteration friction**: editing `services/case-box-persistence/src/foo.ts` requires `npm run build && npm pack` in that package, then `npm install` in desktop app, before changes are visible. A `--watch` mode (TypeScript `tsc --watch` + a tarball-rebuild file-watcher) is possible but adds complexity.
- **Lockfile churn**: bumping the version in `services/case-box-persistence/package.json` (which the impl WI may do) regenerates the tarball with a different integrity hash, dirtying `apps/lawbar-desktop/package-lock.json`.
- **CI orchestration**: CI must run the internal-package build step before the desktop app's `npm install` (currently CI runs per-package `npm test` independently, with no cross-package install order).

### Mitigation for local dev friction

**Mitigation (rev-3)**: rev-3 keeps the local-dev iteration cost as documented; no dev-link or symlink workaround is recommended. The previous proposal of a `dev:link`/`dev:unlink` script pair was withdrawn in rev-2 because the partial-state recovery surface (a half-linked state crashing mid-restore) introduced more risk than the iteration cost saved. A future WI MAY add a single `dev:resync` orchestrator script that does the rebuild + stage-pack + reinstall in one command for ergonomic ease, BUT that orchestrator must NEVER bypass the tarball-install path (no symlinks, no in-place links). For now, the iteration loop is: edit `services/case-box-persistence/src/` → `node scripts/pack-internal-package.mjs case-box-persistence` (from repo root) → `cd apps/lawbar-desktop && npm install`. Plan-WI users accept this cadence.

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Electron-builder compat | **5** | Real directories, no symlinks — root cause resolved. |
| C2 Lockfile | **5** | Tarball integrity hash pinned. |
| C3 CI | 3 | Adds one orchestration step; cacheable via build artifact reuse. |
| C4 Local dev | 3 | Need rebuild + stage-pack + reinstall on every change to an internal package. No symlink / link-mode workaround (rev-3; previous dev:link proposal withdrawn). |
| C5 SoT drift | 5 | Tarball is built from source on every pack; no committed copy to drift. |
| C6 Reproducibility | 5 | Integrity hash + local build chain. |
| C7 Native rebuild | 5 | `electron-builder install-app-deps` already rebuilds tarball-installed natives (proven in WI-B impl). |
| C8 Brief alignment | 5 | No external service. |
| C9 Reversibility | **4** (rev-1) | Bare imports preserve swap to workspaces/registry (same `import "case-box-persistence"`); BUT swap to vendoring requires import-path rewrites. Nested tarball spec changes may also touch more than one manifest. Not a 5/5. |
| **TOTAL** | **40/45** (rev-1) | Lowest local-dev ergonomics; best on every other axis. |

## §7 — Option 3: Build artifact / package export (direct relative imports of pre-built `dist/`)

### Description

No `package.json` dependency at all. The desktop app's source imports directly from the sibling package's built output via relative paths:

```ts
// apps/lawbar-desktop/src/casebox/runtime.ts (PLAN-DOCUMENT example)
import { InMemoryCaseBoxPersistence } from "../../../../services/case-box-persistence/dist/index.js";
```

A build step ensures the sibling's `dist/` exists before the desktop app's `tsc` runs.

### Pros

- Zero dep-tree manipulation.
- No symlinks.
- TypeScript resolves relative imports for type-checking.

### Cons (decisive)

- **`electron-builder` will NOT pack files outside `apps/lawbar-desktop/`.** `build.files` glob is rooted at the app dir; `../../services/case-box-persistence/dist/**/*` is outside that root and won't be included. Production binary would `require()` a path that doesn't exist inside the .app — same failure as Option B in a different shape.
- Workaround: `build.extraResources` in `electron-builder` config can copy arbitrary paths into the .app, but then runtime `require()` paths break (the runtime is now executing from `app.asar.unpacked/extraResources/...`, not `../../../../services/...`).
- TypeScript path-mapping aliases (`paths` in tsconfig) could help dev type-checking but don't change runtime resolution.
- Native deps (`better-sqlite3`) inside the sibling's `dist/` tree wouldn't be rebuilt for Electron's ABI by `@electron/rebuild` (which only walks the app's own `node_modules`).

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Electron-builder compat | **1** | Files outside app root; not packed. |
| C2 Lockfile | 1 | Bypasses lockfile entirely (no dep). |
| C3 CI | 4 | Needs sibling build first; otherwise simple. |
| C4 Local dev | 4 | Edit sibling, rebuild sibling, immediate visible in app. |
| C5 SoT drift | 5 | One source. |
| C6 Reproducibility | 3 | Lockfile doesn't pin sibling content; tsc cache may stale. |
| C7 Native rebuild | 1 | `@electron/rebuild` won't traverse sibling's dist. |
| C8 Brief alignment | 5 | No external service. |
| C9 Reversibility | 3 | Sprinkled relative imports across desktop source; refactor cost. |
| **TOTAL** | **27/45** | Fails on the load-bearing criteria (C1, C7); rejected. |

## §8 — Option 4: Vendoring / copying

### Description

A build script copies the built `dist/` of each internal package into `apps/lawbar-desktop/vendor/<pkgname>/` at build time. The desktop app imports from `./vendor/case-box-persistence/index.js` (relative path INSIDE the app dir, so electron-builder packs it normally).

Two sub-variants:
- **4a — Committed vendor copies**: `apps/lawbar-desktop/vendor/` is checked into git. Updates require manual re-vendoring.
- **4b — Generated vendor copies**: `apps/lawbar-desktop/vendor/` is `.gitignore`d; a pre-build script regenerates it on every `npm run dist`.

### Pros

- Files live INSIDE `apps/lawbar-desktop/` — electron-builder is happy.
- No package.json dep manipulation.
- 4a: completely reproducible from git alone (no build step).
- 4b: source-of-truth stays at `services/case-box-persistence/`.

### Cons

- **4a — drift risk**: a change in `services/case-box-persistence/` does not propagate to `apps/lawbar-desktop/vendor/` until someone manually re-vendors. cc-suite audits and `loc-guardian` would either need to scan vendor/ or explicitly exclude it.
- **4b — same orchestration cost as Option 2** (rebuild + recopy on every build) PLUS:
  - No lockfile hash for the copied content.
  - The desktop app's `tsc` would need to type-check the vendored sources too (or exclude them and rely on the source's pre-built `.d.ts`).
  - Native deps (`better-sqlite3`) in vendored trees still aren't rebuilt by `electron-builder install-app-deps` (which walks `node_modules`, not arbitrary directories).
- Both variants require `loc-guardian` exemption for `vendor/**` (already has generated-file exemption pattern; would extend).
- Both variants confuse `cc-suite audit` scope (vendor is downstream of services; audits would see both copies).

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Electron-builder compat | **5** | Files inside app dir. |
| C2 Lockfile | 2 | No pinning of vendor content (4a: git commit; 4b: nothing). |
| C3 CI | 3 (4b) / 5 (4a) | 4a needs vendor-up-to-date check; 4b needs build orchestration. |
| C4 Local dev | 4 (4b) / 2 (4a) | 4b: rebuild+copy. 4a: manual re-vendor. |
| C5 SoT drift | **2** (4a) / 4 (4b) | 4a has the worst drift exposure. |
| C6 Reproducibility | 4 | Git or scripted. |
| C7 Native rebuild | **1** | Native deps in vendor are NOT rebuilt for Electron. |
| C8 Brief alignment | 5 | No external service. |
| C9 Reversibility | 4 | Delete vendor/, swap imports. |
| **TOTAL** | 4a: **30/45** • 4b: **33/45** | Worse than Option 2 on every relevant axis; native-rebuild fail is decisive. |

## §9 — Option 5: Private published package

### Description

Internal packages are published to a private npm registry (`@lawbar/case-box-persistence`) configured per `apps/lawbar-desktop/.npmrc`. Desktop app declares standard dep: `"@lawbar/case-box-persistence": "^0.1.0"`. Registry choice options:
- 5a — npm.org private packages (subscription).
- 5b — GitHub Packages.
- 5c — Verdaccio self-hosted (local LAN or VPS).
- 5d — Other (Cloudsmith, JFrog, etc.).

### Pros

- Standard npm install workflow.
- Lockfile pins package version + integrity hash perfectly.
- Electron-builder behaves identically to any third-party dep.
- Works in CI with auth token.

### Cons (decisive for v1)

- **Each registry choice IS an auth-provider / cloud-vendor decision** per `.claude/rules/autonomy.md` hard-stop list. Brief §20 STOP-AND-ASK applies.
- **5c Verdaccio** still requires a hosting decision (LAN-only? VPS? who maintains?).
- **Brief §13 says single-lawyer v1**; private registry overhead (auth tokens, registry maintenance, account management) is not justified by v1 needs.
- **Reversibility low** — once published, downstream consumers may pin to the registry path; removing the registry requires re-publishing or re-pathing every consumer.
- **Adds external trust surface** — registry compromise = ability to inject arbitrary code into the desktop app's dep tree.
- **Per-package publish cadence** becomes a new operational concern (version bumps, release notes, deprecation tracking).

### Scores

| Criterion | Score | Note |
|---|---:|---|
| C1 Electron-builder compat | **5** | Standard install. |
| C2 Lockfile | **5** | Full hash pin. |
| C3 CI | 3 | Auth token setup; otherwise standard. |
| C4 Local dev | 3 | Each iteration = bump version + publish + reinstall. Worse than tarball. |
| C5 SoT drift | 3 | Published package may lag source; needs CI publish discipline. |
| C6 Reproducibility | 4 | Hash-pinned but registry availability dependency. |
| C7 Native rebuild | 5 | Same as Option 2. |
| C8 Brief alignment | **1** | Auth/cloud/external-service STOP-AND-ASK. |
| C9 Reversibility | 2 | Hard to back out. |
| **TOTAL** | **31/45** | Strong technical fit; blocked by brief §20 + autonomy hard-stop. |

## §10 — Recommendation: **Option 2 (npm pack tarball install)**

### Score summary

| Option | Total | Decisive blocker |
|---|---:|---|
| 1 — Workspaces | 35 | C1 unverified (same root cause as Option B failure mode) |
| **2 — Tarball install** | **40** (rev-1; was 41) | None — recommended |
| 3 — Build artifact / relative imports | 27 | C1 + C7 fail |
| 4a — Committed vendor | 30 | C5 drift; C7 native rebuild fail |
| 4b — Generated vendor | 33 | C7 native rebuild fail |
| 5 — Private registry | 31 | C8 (brief §20 hard-stop) |

Option 2 still wins by a 5-point margin over the next-best (Option 1 @ 35); rev-1's C9 adjustment did not change the ordering.

### Why Option 2

1. **Solves the root cause**: tarball extraction produces real directories inside `apps/lawbar-desktop/node_modules/`, eliminating the symlink-out-of-app problem that defeated WI-B Option B.
2. **No new architectural commitment**: no root `package.json`, no workspace, no registry account, no vendored copies.
3. **Native-module rebuild works as-is**: `electron-builder install-app-deps` walks `node_modules/` and rebuilds any native dep regardless of whether it was installed via tarball, registry, or git URL. WI-B impl already proved this for `better-sqlite3`.
4. **Lockfile integrity hash pins content**: bit-for-bit reproducibility of the desktop install.
5. **Reversible**: if a later WI wants workspaces / registry / vendoring, the tarball can be swapped one dep specifier at a time.
6. **Brief §13/§15/§20 aligned**: no external service, no auth, no cloud, no telemetry; single-binary Mac app stays a single binary.

### Trade-off acknowledged

The cost is **local dev ergonomics**: every change to `services/case-box-persistence` needs rebuild + stage-pack + reinstall before the change is visible in the desktop app. No symlink / dev-link workaround is recommended (rev-3 — the dev:link proposal floated in earlier revs was withdrawn because the partial-state recovery surface added more risk than the iteration cost saved). A future WI MAY add a single `dev:resync` orchestrator script that bundles rebuild + stage-pack + reinstall into one command for ergonomic ease, but the production install path is always the tarball install — never an in-place link.

A reviewer who weights dev ergonomics higher might prefer Option 1 (workspaces); the plan rejects that because Option 1's C1 score is unverified and the WI-B failure mode shows the symlink path is genuinely fragile in electron-builder. If a future PoC proves workspace symlinks DO survive electron-builder (e.g. by configuring `nodeLinker: "isolated"` in pnpm or similar), the recommendation MAY be revisited in a follow-up plan.

## §11 — PoC plan (REQUIRED before any IPC impl can resume)

The chosen strategy MUST be proven by a minimal PoC in its OWN bounded WI before `WI-casebox-ipc-contract-impl` can be re-planned.

### §11.0 — Why dep-resolution semantics force a non-`file:` spec for `case-box-contract` (rev-2 per H — replaces rev-1 broken proposal)

`services/case-box-persistence/src/` imports runtime values from `case-box-contract` (the Ajv validator functions: `validateMatter`, `validateDocument`, `validateAuditEvent`, etc., per `docs/contracts/case-box-contract/src/index.ts`). These imports are **runtime**, NOT build-time — the compiled `dist/` carries `import { validateMatter } from "case-box-contract"` statements that resolve at module-load time.

Consequence: when `case-box-persistence` is installed into `apps/lawbar-desktop/node_modules/` (via tarball or any other mechanism), npm MUST also install `case-box-contract` somewhere in the dep tree.

**rev-2 correction — `file:` specs are invalid for this topology**:

case-box-persistence's `package.json` currently declares `"case-box-contract": "file:../../docs/contracts/case-box-contract"`. **npm resolves `file:` specs RELATIVE TO THE CONSUMING PACKAGE'S INSTALL LOCATION, not relative to the source tree.** Inside the desktop install context, the consuming package is `apps/lawbar-desktop/node_modules/case-box-persistence/`; the `file:..` ref would resolve to `apps/lawbar-desktop/docs/contracts/case-box-contract` — a non-existent path. The rev-1 proposal to swap this to `file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz` has the **SAME failure** because `file:..tgz` specs use the same resolution rules as `file:..dir` specs — the only difference is whether npm extracts a directory or a tarball file from the resolved path; both must EXIST relative to the consuming package's install location.

**The correct fix**: case-box-persistence's dep spec for case-box-contract must be a **non-`file:` spec** that does NOT depend on filesystem-relative resolution. Two options:

- **Exact-version pin**: `"case-box-contract": "0.1.0"` (matches the version declared in `docs/contracts/case-box-contract/package.json`).
- **Semver range**: `"case-box-contract": "^0.1.0"` (more flexible; appropriate if future case-box-contract versions are forward-compatible).

With a non-`file:` spec, npm satisfies the dep by looking up `case-box-contract@<version>` through normal package-identity resolution — walking parent `node_modules/` directories OR consulting any registry / cache. The desktop app then **declares BOTH `case-box-contract` AND `case-box-persistence` as direct tarball dependencies in `apps/lawbar-desktop/package.json`**:

```jsonc
// apps/lawbar-desktop/package.json (PLAN-DOCUMENT example)
"dependencies": {
  "better-sqlite3": "^12.9.0",
  "case-box-contract": "file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz",
  "case-box-persistence": "file:../../services/case-box-persistence/case-box-persistence-0.1.0.tgz"
}
```

The `file:` specs at the desktop level are valid because they resolve relative to `apps/lawbar-desktop/`, where `../../docs/contracts/...` DOES exist. npm installs both packages into `apps/lawbar-desktop/node_modules/`; when case-box-persistence (now in `node_modules/case-box-persistence/`) looks up case-box-contract, npm's standard parent-`node_modules`-walk finds the hoisted copy at `apps/lawbar-desktop/node_modules/case-box-contract/`. No symlinks outside the app; no cross-directory `file:` resolution failures.

**Preferred packing flow — staged manifest rewrite (avoids source mutation)**:

A pack helper script (`scripts/pack-internal-package.mjs`; ~80 LOC) does the following for each internal package:

1. Create a temp directory `/tmp/lawbar-pack-<pkg>-<timestamp>/`.
2. Copy the package source (including `dist/`, excluding `node_modules/`) into the temp dir.
3. **Read the temp dir's `package.json`; rewrite any `"<dep>": "file:..."` entry to the corresponding non-`file:` spec** (exact version or semver range). For case-box-persistence: swap `"case-box-contract": "file:../../docs/contracts/case-box-contract"` → `"case-box-contract": "0.1.0"`.
4. Run `npm pack` inside the temp dir; capture the resulting `.tgz`.
5. Move the `.tgz` to a known output location (e.g. `services/case-box-persistence/case-box-persistence-0.1.0.tgz`).
6. Clean up the temp dir.

This keeps `services/case-box-persistence/package.json` UNCHANGED at the source. The tarball captures a manifest with the correct non-`file:` spec. The source's `file:..` dep continues to work for the package's own test workflow (`npm --prefix services/case-box-persistence test`) because that workflow runs in-place where the `file:..` IS resolvable.

**Fallback — source manifest mutation (STOP-AND-ASK at PoC start)**:

If the staging-pack approach proves infeasible at PoC start (e.g. `npm pack` reads the manifest BEFORE the rewrite step can apply, or some subtle npm behavior breaks the temp-dir copy), the fallback is to mutate `services/case-box-persistence/package.json` directly to use the non-`file:` spec.

**Important (rev-3 per M3)**: a source mutation BREAKS case-box-persistence's own `npm test` workflow unless that workflow ALSO has a way to install `case-box-contract@0.1.0`. Without workspaces, registry publication, or another root-level direct/local spec for case-box-contract, npm WILL fail to resolve `case-box-contract@0.1.0` when running `npm install` inside `services/case-box-persistence/` (npm would treat the version pin as a registry lookup against an unpublished package, OR fall back to a workspace/registry lookup that does not exist). The rev-2 plan's earlier "likely fine — sibling-package lookup" claim was incorrect; sibling-package resolution requires workspaces or a parent-level install context that case-box-persistence's standalone test workflow does NOT have.

Therefore the source-mutation fallback is NOT a single-line change. It requires:

1. Authorizing the manifest edit (per-line approval).
2. AND independently providing case-box-persistence with an install path for `case-box-contract@0.1.0`. Two reasonable approaches:
   - **Sibling tarball install in services/case-box-persistence/**: add `"case-box-contract": "file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz"` AT THE SOURCE (replacing the previous `file:..dir` ref). The `file:..tgz` resolves correctly INSIDE the source tree because the source IS at `services/case-box-persistence/` where `../../docs/contracts/...` exists. NOTE: this is NOT the same as the rev-1 broken proposal (which used `file:..tgz` AT THE DESKTOP INSTALL CONTEXT). The desktop context still gets a hoisted case-box-contract via its own direct tarball dep; the source-context `file:..tgz` is independent.
   - **Pre-build orchestration**: a top-level script ensures `docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz` is built before any test in services/case-box-persistence/ runs.

Either approach is itself a packaging decision that needs its own evaluation. **Plan-WI preference remains the primary staging-pack path**, which avoids ALL of the fallback complexity by NOT mutating the source manifest at all.

Plan picks **staging-pack as the primary approach**; documents source-mutation fallback as the STOP-AND-ASK alternative.

### §11.1 — PoC WI scope (NEW; not part of THIS plan; lands as `WI-desktop-pkg-arch-tarball-poc`)

| # | Step | Detail |
|---|---|---|
| **0** | **Authorization checklist** (rev-2 — updated for staging-pack architecture) | PoC WI MUST be authorized by the user with EXPLICIT per-line approval of: (a) adding `case-box-contract` AND `case-box-persistence` as DIRECT tarball deps to `apps/lawbar-desktop/package.json` `dependencies`; (b) adding the new `scripts/pack-internal-package.mjs` staging-pack helper (~80 LOC) — this is a NEW file, NOT a package.json mutation; (c) adding `.gitignore` entries for `services/**/*.tgz`, `docs/contracts/**/*.tgz`, `apps/**/*.tgz`. If staging-pack proves infeasible at PoC start, a SECOND STOP-AND-ASK is raised for source mutation of `services/case-box-persistence/package.json` (swap `case-box-contract` from `file:..` to non-`file:` spec). Plan-preferred path uses staging-pack and AVOIDS source manifest mutation entirely. |
| 1 | **Build + stage-pack `case-box-contract` (FIRST)** | First build IN the package dir: `cd docs/contracts/case-box-contract && npm run build`. Then invoke the staging-pack helper **FROM REPO ROOT** (helper is repo-root-scoped, NOT package-dir-scoped): `cd <repo-root> && node scripts/pack-internal-package.mjs case-box-contract` (or use an absolute path: `node /Users/.../lawbar-tool/scripts/pack-internal-package.mjs case-box-contract`). The helper copies the source to a temp dir, validates the manifest has no `file:` deps that need rewriting (case-box-contract has none), runs `npm pack --dry-run` first to assert `dist/` is in the file list (case-box-contract DOES declare `"files"` allowlist including `dist`; safer than case-box-persistence's no-files-field case), runs `npm pack`, moves the resulting `case-box-contract-0.1.0.tgz` to `docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz`. |
| 2 | **Build + stage-pack `case-box-persistence` (manifest rewritten in temp dir)** | First build IN the package dir: `cd services/case-box-persistence && npm run build`. Then invoke the staging-pack helper **FROM REPO ROOT** (helper is repo-root-scoped, NOT package-dir-scoped): `cd <repo-root> && node scripts/pack-internal-package.mjs case-box-persistence`. The helper: (a) copies source to temp dir; (b) reads the temp `package.json`; (c) rewrites `dependencies."case-box-contract"` from `"file:../../docs/contracts/case-box-contract"` to **exact pin `"0.1.0"`** (NOT semver range; rev-3 per reviewer — proves one known tarball identity + lockfile integrity; semver drift would defeat the integrity hash purpose); (d) runs **`npm pack --dry-run`** first to inspect the file list — `case-box-persistence/package.json` has NO `"files"` allowlist field, so npm pack defaults to including everything not gitignored / npmignored; helper MUST assert that `dist/` is in the dry-run output (gitignored at the repo level but the temp dir is OUTSIDE the repo so the gitignore doesn't apply — verify); (e) runs `npm pack` in the temp dir; (f) moves `case-box-persistence-0.1.0.tgz` to `services/case-box-persistence/case-box-persistence-0.1.0.tgz`. **`services/case-box-persistence/package.json` is UNCHANGED at the source** (staging-pack path). Verify by extracting the produced tarball to a SECOND temp dir and `grep '"case-box-contract"' package/package.json` — confirm `"0.1.0"` (exact pin, non-`file:`), NOT `"file:..."`. Also verify `package/dist/index.js` exists in the extracted tarball. |
| 3 | **(Removed in rev-2 — old "Build tarball for case-box-persistence" merged into step 2)** | (Step 3 was the post-rewrite pack; rev-2 fuses pack + rewrite into step 2's staging-pack invocation. Numbering preserved for diff traceability with rev-1.) |
| 4 | **Add BOTH tarball deps to desktop app** (rev-2 per H) | In `apps/lawbar-desktop/package.json` `dependencies`, add: `"case-box-contract": "file:../../docs/contracts/case-box-contract/case-box-contract-0.1.0.tgz"` AND `"case-box-persistence": "file:../../services/case-box-persistence/case-box-persistence-0.1.0.tgz"`. These `file:` specs are valid at the DESKTOP level because they resolve relative to `apps/lawbar-desktop/` where `../../docs/contracts/...` and `../../services/...` DO exist. Both packages install into `apps/lawbar-desktop/node_modules/` (npm flat-tree hoisting); case-box-persistence's `"case-box-contract": "0.1.0"` is satisfied by the hoisted case-box-contract via Node's standard parent-`node_modules` lookup. NOTE: 2 new direct runtime deps in this PoC. |
| 5 | **Install + recursive verification** | `cd apps/lawbar-desktop && npm install`. Verify ALL of the following: (a) `node_modules/case-box-persistence/` is a REAL directory (`lstat` returns non-symlink); (b) `node_modules/case-box-persistence/package.json` exists and its `dependencies."case-box-contract"` is the non-`file:` spec `"0.1.0"`; (c) `node_modules/case-box-contract/` exists as a REAL directory (hoisted alongside case-box-persistence); (d) `package-lock.json` records BOTH `case-box-persistence` AND `case-box-contract` with integrity hashes (sha512); (e) recursive `lstat` walk of `node_modules/case-box-*/` finds NO symlinks; (f) for every symlink encountered ANYWHERE under `node_modules/`, `realpath` MUST remain within `apps/lawbar-desktop/node_modules/**` — any escape is a fail. |
| 6 | **Build dev** | `npm run build:ts` in desktop app; verify `import { InMemoryCaseBoxPersistence, openSqliteCaseBoxPersistence } from "case-box-persistence"` AND `import { validateMatter } from "case-box-contract"` BOTH resolve. Probe file at `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` (NEW; ~70 LOC) constructs an `InMemoryCaseBoxPersistence`, builds a minimal valid Matter payload, calls `validateMatter(payload)` (verifying contract Ajv runtime), then `persistence.createMatter(payload)` (verifying persistence runtime + audit emission). |
| 7 | **Package dist + asar/asar.unpacked + symlink scan** | `npm run dist`. Verify: (a) NO ASAR error about "must be under apps/lawbar-desktop/"; (b) PURE-JS packages live in `app.asar` — use `npx asar list dist/mac-arm64/lawbar.app/Contents/Resources/app.asar` and assert paths `/node_modules/case-box-persistence/dist/index.js` AND `/node_modules/case-box-contract/dist/index.js` BOTH exist; (c) NATIVE binaries live in `app.asar.unpacked` — verify `dist/mac-arm64/lawbar.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists; (d) recursive symlink scan over `dist/mac-arm64/lawbar.app/Contents/Resources/` (and `Resources/app.asar.unpacked/` since asar-extract restores file shape) using `lstat`/`readlink`: assert NO symlink escapes the `.app` bundle root. |
| 8 | **Packaged smoke (explicit validateMatter)** | New test `tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` (~100 LOC) spawns the packaged binary with `--probe-casebox-pkg-arch` (NEW flag analogous to `--probe-case-box`). The probe executes BOTH: (a) `validateMatter(fixedPayload)` — proves case-box-contract Ajv runtime loads + executes (this was the SPECIFIC failure path in WI-B Option B); (b) `persistence.createMatter(fixedPayload)` — proves case-box-persistence runtime + audit emission. Probe prints `PROBE_OK matterId=<id> validatorOk=true`, exits 0. Any failure mode prints `PROBE_FAIL: <category> <detail>` and exits 1. |
| 9 | **(Removed in rev-2)** — dev-link / dev-unlink / dev-status scripts | rev-2 REMOVES the dev-link toolchain entirely. The partial-state recovery surface (rev-1 M2 finding) is eliminated by not having an in-place link mode at all. **Local-dev iteration cost is accepted**: editing `services/case-box-persistence/src/` requires re-running the orchestrator (`scripts/build-internal-packages.mjs` — added in follow-up WI per §12) which rebuilds + re-packs + re-installs in the desktop app. Manual recovery from any half-broken state: `cd apps/lawbar-desktop && rm -rf node_modules package-lock.json && node scripts/pack-internal-package.mjs case-box-contract && node scripts/pack-internal-package.mjs case-box-persistence && npm install`. **CI uses the clean tarball install path; never any link mode.** |
| 10 | **Acceptance** | PoC WI is READY iff steps 0, 1, 2, 4, 5, 6, 7, 8 all pass AND `cc-suite:audit` returns 0 C/H/M. (Steps 3 + 9 are intentionally removed in rev-2.) |

PoC WI estimated scope (rev-2):
- 1 NEW `scripts/pack-internal-package.mjs` (~80 LOC) — staging-pack helper at REPO ROOT (NOT inside apps/lawbar-desktop); reusable across all internal-package tarballing.
- 1 NEW probe file `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` (~70 LOC) — exercises BOTH `validateMatter` AND `createMatter`.
- 1 NEW smoke test `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` (~100 LOC) — packaged-binary spawn + asar inspection + symlink scan asserts.
- 1 modified `apps/lawbar-desktop/electron/main.ts` (~25 LOC: `--probe-casebox-pkg-arch` flag handler OR'd with existing `--probe-case-box` guard at top of file + inside whenReady).
- 1 modified `apps/lawbar-desktop/package.json` (add `case-box-contract` + `case-box-persistence` tarball deps — 2 NEW direct runtime deps; NO new scripts added; dev-link scripts REMOVED per rev-2).
- 1 NEW `apps/lawbar-desktop/package-lock.json` entries from the install (auto-regenerated).
- 0 modified `services/case-box-persistence/package.json` (UNCHANGED in the staging-pack path; the manifest rewrite happens in a temp dir only). Source mutation is the STOP-AND-ASK fallback per §11.0 if staging-pack proves infeasible.
- 1 NEW `.gitignore` entry block for `services/**/*.tgz`, `docs/contracts/**/*.tgz`, `apps/**/*.tgz`.

Net (staging-pack path; primary): 1 NEW shared script + 1 NEW probe file + 1 NEW smoke test + 1 NEW gitignore block + 1 MOD apps/lawbar-desktop/main.ts + 1 MOD apps/lawbar-desktop/package.json. ZERO source manifest mutation. 2 new direct runtime deps in desktop app (case-box-contract + case-box-persistence).

**Failure modes the PoC must catch (rev-1 expanded)**:
- ASAR pack error (would mean tarball extraction created a symlink somehow — investigate npm version + extraction path).
- Native rebuild error (`electron-builder install-app-deps` failing to walk tarball-installed natives — would force fallback to Option A's direct-dep pattern OR vendoring fallback).
- `MODULE_NOT_FOUND` at packaged launch (means asarUnpack glob missed a native binding OR the asar didn't include case-box-* JS).
- Out-of-bundle symlink discovered by step 5 (e) or step 7 (d) (means the tarball mechanism preserved an internal symlink we missed — would require re-investigating npm pack semantics).
- `validateMatter` call in step 8 throws `MODULE_NOT_FOUND` for case-box-contract (would mean transitive resolution didn't work even after the §11.0 nested pre-pack — would invalidate Option 2 entirely).
- ~~Dev-link mode breaking production build~~ (rev-3 cleanup — dev-link toolchain was removed entirely in rev-2; this bullet no longer applies. Retained as struck-through marker so the historical failure-mode list is diff-traceable; can be deleted in a future cleanup pass.)

If ANY step from 6, 7, or 8 fails: STOP, report, do NOT promote to IPC impl planning. The failure indicates Option 2 is not actually viable and the lane returns here for re-evaluation with the failure mode named.

## §12 — Follow-up WIs (proposed sequence; rev-2)

1. **WI-desktop-pkg-arch-tarball-poc** — implement the §11 PoC. Requires its own `/cc-suite:review-plan` on the PoC WI plan + `/cc-suite:audit` + `/cc-suite:verify`. **Adds 2 NEW direct runtime deps** to `apps/lawbar-desktop`: `case-box-contract` (tarball) AND `case-box-persistence` (tarball). Both are STOP-AND-ASK at PoC WI authorization — neither is incidental nor build-time-only; case-box-contract's Ajv validators run at desktop-app load time inside the packaged binary. STAGING-PACK path (primary; rev-2 per H fix) does NOT mutate any source `package.json`; the SOURCE-MUTATION fallback path is a separate STOP-AND-ASK if staging-pack proves infeasible.
2. **WI-desktop-pkg-arch-tarball-orchestration** — `scripts/build-internal-packages.mjs` orchestrator that builds + stage-packs every internal package the desktop app needs (calls `scripts/pack-internal-package.mjs` from PoC). Wires into `apps/lawbar-desktop/package.json` `scripts.predist` (runs before `dist`). Tests: orchestrator exits 0; tarball files exist at known paths; `npm install` reproduces.
3. **REVIVE WI-casebox-ipc-contract-impl planning** — return to the impl plan that was STOPPED at `dev-memo/plan-casebox-ipc-impl-00.md`; revise H finding's root cause now that the package architecture is resolved; re-run `/cc-suite:review-plan`. Most of the rev-0 plan body can stay (DTOs, handlers, lint, runtime, tests); only §3 file table + §14 gates + §17 hard-stops need amendment to reference the dual tarball dep path (`case-box-contract` + `case-box-persistence`).
4. **WI-casebox-ipc-contract-impl** — implement IPC per the revived plan.

## §13 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High** (rev-0 H1; unchanged through rev-3 — duplicate row removed in rev-3) | Option 2 PoC fails at **step 7** (`npm run dist`; electron-builder rejects tarball-installed packages for an unforeseen reason — e.g. internal asar packer rule we haven't anticipated; nested `node_modules` of the tarballed package contains a transitive symlink). NOTE: step 6 is `npm run build:ts` (pure TypeScript compile) and does not exercise electron-builder; step 7 is where the packaging actually runs. | PoC is the gate; failure stops the chain. Fallback options ranked: Option 1 workspaces (try `nodeLinker: "isolated"` if pnpm; npm doesn't have an equivalent), then Option 5 (escalate to user for registry choice STOP-AND-ASK), then Option 4b (degraded: no native rebuild). Plan does NOT pre-commit a fallback; revisit if PoC fails. |
| ~~**High** (rev-0 H2)~~ → **Resolved in rev-2 via non-`file:` spec + dual direct tarball deps** | rev-1's "swap to tarball spec" fix was internally inconsistent — `file:..tgz` has the same path-resolution problem as `file:..` (both resolved relative to the consuming install context per npm's `file:` semantics). | rev-2 replaces the rev-1 fix with a correct architecture: case-box-persistence's `case-box-contract` dep is rewritten (in a staging-pack temp dir; no source mutation) to a non-`file:` spec like `"0.1.0"`. The desktop app declares BOTH `case-box-contract` AND `case-box-persistence` as DIRECT tarball deps. npm flat-tree hoisting places both in `apps/lawbar-desktop/node_modules/`; case-box-persistence's `"0.1.0"` ref is satisfied by the hoisted case-box-contract via Node's standard parent-`node_modules` lookup. No symlinks; no cross-directory `file:` resolution. PoC step 2 performs the temp-dir rewrite; PoC step 5 (b) verifies the installed manifest carries the non-`file:` spec. SOURCE mutation is the STOP-AND-ASK fallback only if staging-pack proves infeasible at PoC start. |
| ~~**Medium** (rev-1; withdrawn in rev-2; risk row deleted in rev-3)~~ | The previous rev-1 risk about `dev:link` / `dev:unlink` partial-state divergence. | The dev-link toolchain was removed entirely in rev-2 (see §11.1 step 9 row). Removing the dev-link surface eliminates the risk class; no in-place link mode exists for partial state to leak through. Local-dev iteration uses rebuild + stage-pack + reinstall only. |
| **Medium** | The PoC's `--probe-casebox-pkg-arch` flag handler in `electron/main.ts` may break Tier 1 FileVault enforcement if it doesn't short-circuit cleanly before the FileVault probe (same race as `--probe-case-box` per commit `678bf16`). | The PoC WI MUST mirror the `--probe-case-box` short-circuit pattern exactly: the new flag handler runs BEFORE `app.setName`, calls `process.exit(0/1)` directly, and the `app.whenReady` chain skips the FileVault path if either probe flag is present. Already in `electron/main.ts` per the current `if (process.argv.includes("--probe-case-box")) return;` guard at the top of the whenReady handler — the PoC adds an OR clause. |
| **Low** | The `.gitignore` for `*.tgz` may accidentally exclude a legitimate file someone wants to commit. | Scope the ignore to `services/**/*.tgz` + `docs/contracts/**/*.tgz` + `apps/**/*.tgz`. The PoC WI can refine. |
| **Low** | Lockfile churn on every tarball rebuild (integrity hash changes even if content is logically the same, because gzip is non-deterministic). | Use `npm pack --dry-run` to inspect, OR commit to the orchestration including a deterministic re-pack step. v1 acceptable; recorded for future reproducibility WI. |

No Critical risks identified. If reviewer disagrees, the H2 nested-symlink concern is the most likely escalation.

## §14 — Hard stops

This plan does NOT trigger any hard-stop in `.claude/rules/autonomy.md` §"Hard-stop list":
- No push, deploy, release, production, migration, auth provider, cloud vendor, public exposure.
- No new runtime dependency in THIS plan (the PoC WI adds **2 direct runtime dependencies** — `case-box-contract` AND `case-box-persistence`, both as tarball deps via the staging-pack path; that's the PoC's own authorization, not this plan's).
- No public API change.
- No schema change.
- No secrets / credentials / billing.

The plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" (touches "framework / runtime dependencies"). Therefore `/cc-suite:review-plan` is required (this lane runs it).

## §15 — Review packet (compact)

**Active plan summary** (rev-2): PLAN-ONLY evaluation of 5 strategies for `apps/lawbar-desktop/` consuming internal packages (`case-box-persistence`, `case-box-contract`). Recommends Option 2 (npm pack tarball install) because it (a) eliminates the symlink-out-of-app failure mode that defeated WI-B Option B + would defeat workspaces + would defeat relative imports, (b) preserves lockfile integrity-hash reproducibility, (c) keeps `electron-builder install-app-deps` native-rebuild working as-is, (d) requires no new architectural commitment (no root package.json, no registry, no vendoring). rev-2 architecture: case-box-persistence's `case-box-contract` dep is rewritten in a staging-pack temp dir (no source mutation; STOP-AND-ASK fallback for source mutation only) to a non-`file:` spec (`"0.1.0"`); desktop declares BOTH internal packages as DIRECT tarball deps; npm flat-tree hoisting handles transitive resolution. Trade-off: local dev iteration cost accepted as "rebuild + repack + reinstall"; dev-link mode REMOVED in rev-2 to eliminate partial-state recovery surface. PoC (separately-authorized WI) is mandatory before IPC impl resumes.

**Exact target files (this plan)**:
- `dev-memo/plan-desktop-package-architecture-00.md` (new, this file).

**Exact target files (PoC WI; SEPARATE; NOT this plan) — rev-2**:
- NEW: `scripts/pack-internal-package.mjs` (~80 LOC; at REPO ROOT; staging-pack helper — copies source to temp dir, rewrites `file:` deps to non-`file:` specs, runs `npm pack`, moves tarball to known path).
- NEW: `apps/lawbar-desktop/src/casebox-pkg-arch-poc.ts` (~70 LOC; exercises BOTH `validateMatter` AND `createMatter`).
- NEW: `apps/lawbar-desktop/tests/smoke.casebox-pkg-arch-poc.electron.test.mjs` (~100 LOC; packaged-binary spawn + asar inspection + symlink scan).
- MOD: `apps/lawbar-desktop/electron/main.ts` (+~25 LOC: --probe-casebox-pkg-arch flag handler ORed with existing --probe-case-box guard).
- MOD: `apps/lawbar-desktop/package.json` (add `case-box-contract` AND `case-box-persistence` tarball deps — 2 NEW direct runtime deps).
- MOD: `apps/lawbar-desktop/package-lock.json` (auto-regenerated; both internal packages get integrity hashes).
- **0 MOD `services/case-box-persistence/package.json`** in the primary staging-pack path. Source mutation is the STOP-AND-ASK fallback ONLY (not the primary).
- NEW: `.gitignore` entries for `services/**/*.tgz`, `docs/contracts/**/*.tgz`, `apps/**/*.tgz`.

**Exact acceptance criteria (PoC WI; rev-2)**: see §11 — 8 effective steps (0, 1, 2, 4, 5, 6, 7, 8; steps 3 + 9 explicitly removed). PoC READY iff all 8 pass + cc-suite audit 0 C/H/M. Manifest-rewrite REQUIRED (not deferred); happens in staging-pack temp dir for the primary path.

**Exact out-of-scope list**:
- Implementation of the chosen strategy.
- Installing any dependency.
- Restructuring workspaces.
- Modifying any package.json.
- Choosing a registry vendor (Option 5).
- Bundler introduction.
- Workspace tool introduction.
- IPC impl restart (deferred to follow-up WIs after PoC lands).
- Product UI, real data, Tier 2 SQLCipher, signing, distribution, etc.

**Essential references**:
- Commit `c708ece` body, "Option B abandoned" section (full WI-B failure record).
- `dev-memo/plan-packaging-smoke-wib-00.md` (Option B selection rationale + WI-B trade-off table).
- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`; IPC contract READY; consumer of whatever this plan recommends).
- `dev-memo/plan-casebox-ipc-impl-00.md` (unstaged; STOPPED rev-0; H finding root cause = THIS plan's problem statement).
- `apps/lawbar-desktop/package.json` HEAD `9f9f79b`.
- `services/case-box-persistence/package.json` (uses `file:` link to case-box-contract internally).
- electron-builder GH issue #4496 (known cross-package symlink rejection).
- `.claude/rules/autonomy.md` §"Hard-stop list" (auth provider / cloud vendor STOP-AND-ASK; informs Option 5 rejection).
- `.claude/rules/cc-suite.md` §"High-risk WIs".

**Review questions (rev-2 — target the load-bearing assumptions)**:
1. Is the rev-2 architecture sound: case-box-persistence's dep on case-box-contract rewritten to non-`file:` spec in a staging-pack temp dir + desktop declares both internal packages as direct tarball deps + npm flat-tree hoisting handles resolution? Specifically: does npm correctly hoist BOTH packages installed via `file:..tgz` specs at the desktop level into a single flat `node_modules/` (avoiding nested `node_modules/case-box-persistence/node_modules/case-box-contract/`)? Or does npm install nested by default? If nested, does the nested case-box-contract still satisfy Node's module resolution from case-box-persistence's perspective?
2. Is the staging-pack helper (`scripts/pack-internal-package.mjs`) realistic in ~80 LOC for the manifest-rewrite + temp-dir-copy + `npm pack` invocation + tarball-move steps? Are there any npm-pack idiosyncrasies (e.g. `npm pack` re-reading `package.json` after the rewrite from a different cached location) that would break the temp-dir approach?
3. Is the staging-pack path ACTUALLY the primary recommendation, or should the source-mutation fallback be made primary because it has clearer semantics? rev-2 keeps staging-pack primary because it preserves the source manifest's working `file:..` ref for case-box-persistence's own test workflow; reviewer pushback might prefer the simpler source-mutation path.
4. Is the rejection of Option 1 (workspaces) justified ONLY on the unverified C1 score, or is there additional evidence that workspace symlinks behave like `file:` deps under electron-builder? Should the PoC ALSO test Option 1 in parallel as a hedge?
5. Is Option 5 (private registry) correctly classified as a brief §20 STOP-AND-ASK, given that brief §20 enumerates auth provider / cloud vendor / etc. but does not explicitly mention package registries? If a future lawyer-firm deployment justifies a private registry, this rejection should be revisitable.
6. Does the PoC's `--probe-casebox-pkg-arch` flag correctly compose with the existing `--probe-case-box` flag without breaking Tier 1 FileVault enforcement (commit `678bf16`)? The §13 M5 risk addresses this; is the proposed mitigation tight enough?
7. Is the removal of dev-link/dev-unlink/dev-status (rev-2; reaffirmed in rev-3) the right trade-off? The cost is local-dev iteration overhead (rebuild + stage-pack + reinstall on every case-box-persistence change); the gain is no partial-state recovery surface. A future ergonomic improvement could be a single `dev:resync` orchestrator script that bundles the rebuild + stage-pack + reinstall into one command — production install path stays tarball-only.

## §16 — Stop condition

This plan becomes stale when:
- The PoC WI lands and is verified. After that, this plan is the as-built reference until either superseded or the chosen strategy fails operationally.
- electron-builder publishes a fix for the cross-package symlink rejection (GH #4496). At that point, Option 1 (workspaces) could be revisited and this plan amended.
- The brief is amended to allow a private package registry choice. At that point, Option 5 could be revisited.
- `services/case-box-persistence`'s own dep chain changes shape (e.g. adds a non-`file:` runtime dep), which may invalidate the H2 risk analysis.

## §17 — Required cc-suite review

This plan is not authorized for promotion to PoC WI until:
1. `/cc-suite:review-plan dev-memo/plan-desktop-package-architecture-00.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The chosen Option 2 recommendation is not overridden without re-review.
4. Each follow-up WI in §12 requires its own `/cc-suite:review-plan`.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency across §3-§14 (especially the rejection rationale for Options 1, 3, 4, 5 vs the Option 2 recommendation).
- Consistency with the WI-B failure record (commit `c708ece` body).
- Feasibility of the §11 PoC (does it actually exercise the failure mode that defeated Option B?).
- Hard-stop clarity (§14 — Option 5 must remain a STOP-AND-ASK).
- Reversibility (§9 C9) — does Option 2 genuinely allow swap to another strategy without code refactor?
