# Plan: Electron Packaging Smoke (PLAN-ONLY)

> **PLAN ONLY.** This document specifies the **packaging-smoke WI** for `apps/lawbar-desktop/` shipped at commit `4a99b25`. It does NOT implement anything: no `.app` is built, no signing identity chosen, no notarization, no distribution channel, no product UI, no native module loaded. It does NOT trigger any new STOP-AND-ASK surface beyond what was already authorized for the first UI shell. Each impl WI (there are TWO; see §1.1) requires SEPARATE explicit user authorization.

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 3 Lows; rev-2 applied all 3: §2.3 `npm test:packaged` → `npm run test:packaged` syntax fix (L D1#2); §4 "20 unresolved §20 items" → "applicable / unresolved" count softened (L D2#2); §4 "16 of the 20" tail count removed in favor of "most of the remaining" + pointer to brief §20 + blueprint §4 for authoritative current list.).
**Date**: 2026-05-24.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only packaging smoke.
**Predecessors**: first UI shell impl at `4a99b25`; first-UI-shell plan at `f74b2b2`; UI substrate ratification at `35cd9b6`; night-mode foundation at `7ad57ed`; blueprint at `1b92c58`; legacy reconciliation amendments at `b5c7d9f`; Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

The lane authorization requires this plan to:

1. Verify app packaging/build behavior for the **current first UI shell** (zero native modules).
2. **Account for future native-module risk** (`better-sqlite3`, OCR engine) — but the actual native-module exercise lands in a **SEPARATE later WI**.

This splits the work into TWO bounded impl WIs:

- **WI-A: Current-shell packaging smoke.** Run `electron-builder` (`npm run dist`) against `apps/lawbar-desktop/` at HEAD `4a99b25` to produce an unsigned `.app` directory. Launch the packaged `.app` via Playwright Electron + `executablePath` and verify it behaves identically to dev mode (window opens; 12 token panels render; theme switching works; theme persists). NO new runtime dep; NO native module; NO signing; NO notarization; NO distribution.
- **WI-B (FUTURE; separately authorized; NOT executed by THIS plan or by WI-A): Native-module rebuild smoke.** Add `@electron/rebuild` as a devDependency (STOP-AND-ASK), build `better-sqlite3` against Electron's Node ABI, write a tiny in-process SQLite open/close + 1 SELECT test that runs inside the packaged `.app`, prove it loads without `ERR_DLOPEN_FAILED`. This WI is required BEFORE case-box screens (per substrate decision §6 row 4.5).

Plan-only file: `dev-memo/plan-packaging-smoke-00.md` (THIS FILE).

### Exact target files (THIS plan-WI's commit)

CREATED (single file):
- `dev-memo/plan-packaging-smoke-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- ANY file under `apps/lawbar-desktop/` (no source/test changes; no new dep; no rebuild artifacts).
- `dev-memo/plan-first-ui-shell-00.md`, `dev-memo/plan-ui-substrate-decision-00.md`, `dev-memo/plan-night-mode-foundation-00.md`.
- `dev-memo/plan-go-live-readiness-00.md`, `dev-memo/plan-go-live-plan-reconcile-00.md`.
- `docs/release/**`, `docs/product/**`, `docs/adr/**`, `docs/ui/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

### Exact target files for the IMPL WI-A (NOT created by THIS plan-WI's commit)

When the user later authorizes **WI-A**, it would change/create:

- `apps/lawbar-desktop/package.json` — minor edit to `scripts`: add `test:packaged` that runs the new packaged smoke test (does NOT replace existing `test` script).
- `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (NEW; estimated ~80 LOC) — Playwright Electron smoke that:
  1. Asserts the packaged `.app` exists at the expected output path (`release/mac-arm64/lawbar.app` or equivalent).
  2. Launches the packaged binary via `electron.launch({ executablePath: "release/mac-arm64/lawbar.app/Contents/MacOS/lawbar" })`.
  3. Asserts the same 4 properties as the dev-mode smoke: window opens; title is `"lawbar (token fixture)"`; 12 token panels render; theme switching toggles `<html data-theme>`.
  4. Cleans up the temporary user-data dir between runs.
- `apps/lawbar-desktop/.gitignore` — confirm `release/` is already ignored (it is per the first-UI-shell impl WI; this WI does NOT need to add it).

**No new runtime deps.** `electron-builder` is already in the authorized dev-deps set per the first UI shell impl.

### Exact target files for the IMPL WI-B (FUTURE; separately authorized; NOT executed by THIS plan; NOT detailed beyond accounting)

WI-B would add a NEW devDependency (`@electron/rebuild` — STOP-AND-ASK), a NEW test (`tests/smoke.native-module.electron.test.mjs`), and a NEW SQLite probe (`apps/lawbar-desktop/src/probes/sqliteProbe.ts`). This plan does NOT specify WI-B's file layout — that's WI-B's own plan-WI. This plan only accounts for the RISK.

### Exact acceptance criteria

#### For THIS plan-WI:

1. Plan committed alone (one file).
2. §1 enumerates WI-A scope + the WI-B carry-forward boundary.
3. §2 lists the WI-A test plan + acceptance criteria.
4. §3 accounts for the future native-module risk WITHOUT exercising it.
5. §4 hard-stop inheritance accurate.
6. §5 follow-up WIs listed (each separately authorized).
7. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

#### For the IMPL WI-A (when later authorized; this plan does NOT execute):

1. `npm --prefix apps/lawbar-desktop run dist` exits 0 and produces a `.app` artifact under `release/`.
2. The packaged `.app` launches via Playwright Electron + `executablePath`.
3. The packaged `.app` behaves identically to dev mode for the 4 properties above.
4. Existing 12/12 tests still pass (no regression).
5. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.
6. NO new runtime dep added.
7. NO native module loaded (the shell has zero `dependencies` per first-UI-shell §2).
8. NO signing or notarization.
9. NO distribution channel decision.
10. NO product UI added.

### Exact out-of-scope list

- **Implementing WI-A.** (Separately authorized; this plan executes nothing.)
- **Implementing WI-B** (native-module rebuild) — accounted for here as RISK, executed by a SEPARATE future plan + impl pair.
- **Adding any new dependency.** WI-A uses only the 6 already-authorized devDeps from the first-UI-shell impl. WI-B would add `@electron/rebuild` (STOP-AND-ASK at WI-B authorization).
- **Code signing identity / Apple Developer ID / notarization profile / `electron-builder` `identity` flip from `null`.** STOP-AND-ASK per brief §20.
- **Mac App Store vs direct vs in-firm IT distribution channel.** STOP-AND-ASK per brief §20.
- **Auto-update mechanism.** Brief §4 manual download v1.
- **Product UI** of any kind. The packaged `.app` runs the same 12-token compliance fixture as the dev mode.
- **Case-box-persistence integration, OCR-pipeline integration, or any other native module load.** Native-module exercise is WI-B's job.
- **Telemetry / crash reporting / cloud sync / external network surface beyond what the shell already has (none).**
- **Editing brief / ADRs / services / contracts / tests outside `apps/lawbar-desktop/tests/`.**
- **`git push`.** Separate explicit authorization.

### Essential references

- `dev-memo/plan-ui-substrate-decision-00.md` (rev-3 RATIFIED Electron at `35cd9b6`) §3.6 (Packaging), §3.7 (Signing), §3.8 (Distribution), §6 row 4.5 (native-module packaging smoke), §7 row #7 (Medium risk — Electron native-module ABI).
- `dev-memo/plan-first-ui-shell-00.md` (READY rev-2 at `f74b2b2`) §1 (file layout), §2 (6 devDeps; zero runtime deps), §6 (native-module risk carried forward).
- `apps/lawbar-desktop/package.json` (current at `4a99b25`) — `scripts.dist` is `npm run build && electron-builder`; `build.mac.target = [{ target: "dir", arch: ["arm64", "x64"] }]`; `build.mac.identity = null` (unsigned).
- `apps/lawbar-desktop/.gitignore` — `release/` already ignored.
- `apps/lawbar-desktop/scripts/manual-evidence.mjs` — pattern for Playwright Electron with `executablePath` (reusable for WI-A's packaged smoke).
- `docs/product/project-requirements-brief.md` §4 (Mac app expectations) + §20 (hard-stop list).
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #4 (distribution + signing + manual download v1).
- `.claude/rules/autonomy.md` §"Hard-stop list".

### Review questions for the reviewer

1. **WI-A vs WI-B split**: the lane authorization is broad ("Plan the Electron packaging-smoke WI"). This plan splits into TWO bounded impl WIs. WI-A is the "current shell" packaging verification (no native modules); WI-B is the "future native-module rebuild" smoke. Is the split correct, or should one combined WI cover both?

2. **WI-A scope minimality**: WI-A adds ONE new test file (~80 LOC) + ONE script entry in package.json. Is this minimal enough, or should it be a single-line `npm test` change with no new file? Plan picks: a dedicated test file because the packaged-binary smoke is conceptually distinct from the dev-mode smoke.

3. **No new dep in WI-A**: confirmed — `electron-builder` is already installed. WI-A's only dep need is Playwright's `executablePath`, already supported by `@playwright/test` + `playwright` (already authorized). Correct?

4. **Unsigned `.app` distribution**: WI-A produces an UNSIGNED `.app` under `release/`. The `.app` is dev-only per first-UI-shell README; cannot be distributed (Gatekeeper blocks). Is this acceptable, or should WI-A also verify Gatekeeper behavior (e.g., quarantine flag)?

5. **WI-B accounting depth**: §3 accounts for the future native-module risk with file-list + dep enumeration BUT does NOT specify WI-B's implementation details. Is this enough accounting, or should §3 also draft WI-B's test plan? Plan picks: defer to WI-B's own plan-WI; this plan's §3 only flags the RISK.

6. **electron-builder transitive CVEs**: per first-UI-shell impl commit, `npm audit` reported 10 high CVEs in electron-builder's dev tooling (`app-builder-lib`, `dmg-builder`, `tar`, `node-gyp`). WI-A runs electron-builder; the CVE risk is unchanged from the install state already on `main`. Plan picks: WI-A does NOT attempt to upgrade transitive deps (would change dep tree; STOP-AND-ASK). A separate dependency-hygiene WI may revisit.

7. **macOS-only build target**: WI-A's `build.mac.target = "dir"` produces a `.app` directory (not a `.dmg`). For dev-mode smoke, the `.app` is sufficient (no installer flow needed). `.dmg` is a future signing/distribution concern. Acceptable?

---

## §1 WI-A scope (current-shell packaging smoke)

### §1.1 Scope split

- **WI-A** (this plan's primary focus): verify electron-builder produces a valid `.app` from the current zero-native shell + Playwright smoke against the packaged binary.
- **WI-B** (separately authorized; NOT here): native-module rebuild smoke (`better-sqlite3` against Electron's Node ABI; runs BEFORE case-box screens per substrate decision §6 row 4.5).

This plan executes neither. The user authorizes WI-A and WI-B separately when ready.

### §1.2 WI-A's goal

Prove that `npm run dist` in `apps/lawbar-desktop/` produces a packaged Electron `.app` that:
- Launches successfully on the developer's machine.
- Runs the same 12-token compliance fixture as dev mode.
- Persists theme preference to the same path as dev mode (`~/Library/Application Support/lawbar/`).
- Responds to System / Light / Dark switching identically to dev mode.

If WI-A passes, the packaging path is end-to-end working for the zero-native shell. The next step in the readiness sequence is WI-B (native-module rebuild), THEN case-box-aware screens (per substrate decision §6 sequencing).

If WI-A fails, the failure mode tells us whether the issue is in:
- `electron-builder` configuration (likely a `package.json` `build.*` field tweak).
- The compiled `dist/` output layout (likely a `main` field or asset-copy issue).
- The renderer's resource loading (likely a CSP or `file://` path issue inside the packaged `.app`).
- The preload's `.mjs` extension (Electron's packaged binary may resolve preload differently than dev — needs verification).

### §1.3 WI-A's exact change set

| File | Change | Rationale |
|---|---|---|
| `apps/lawbar-desktop/package.json` | Add `"test:packaged": "node --test tests/smoke.packaged.electron.test.mjs"` to `scripts`. No other changes. | Dedicated test runner so existing `npm test` keeps fast feedback. |
| `apps/lawbar-desktop/tests/smoke.packaged.electron.test.mjs` (NEW; ~80 LOC) | Playwright Electron smoke against the packaged binary. | Verifies packaged-binary behavior matches dev mode. |
| `apps/lawbar-desktop/package-lock.json` | No change (no new dep). | |
| `apps/lawbar-desktop/.gitignore` | No change (`release/` already ignored). | |

Net change: 1 file added + 1 file modified by 1 line.

---

## §2 WI-A test plan

### §2.1 Pre-test: produce the packaged `.app`

```sh
cd apps/lawbar-desktop
npm run dist
```

`npm run dist` runs `npm run build && electron-builder`. Output: `release/mac-arm64/lawbar.app/` (or `release/mac-x64/lawbar.app/` on x64 machines; or both per the configured `arch` array).

### §2.2 Packaged smoke (`tests/smoke.packaged.electron.test.mjs`)

Four assertions, mirroring the dev-mode smoke:

1. **Packaged `.app` exists** at one of the expected output paths (probe both `mac-arm64/` and `mac-x64/`; succeed if either is present and matches the host's architecture).
2. **Launches via `electron.launch({ executablePath })`** — pointing at the `lawbar` binary inside `lawbar.app/Contents/MacOS/`.
3. **Window opens; title is `"lawbar (token fixture)"`; 12 panels render with correct `data-token` attributes.** Identical assertion set to the dev-mode smoke.
4. **Theme switching:** clicking `button[data-mode='dark']` and `button[data-mode='light']` toggles `<html data-theme>`. Identical to dev-mode smoke.

### §2.3 Test ordering relative to existing tests

WI-A's `npm run test:packaged` is INDEPENDENT of `npm test` (per rev-1 reviewer L D1#2 syntax fix — `npm run <script>` for non-lifecycle scripts). Both must pass:

- `npm test` (existing) — dev-mode tests; 12/12 pass at `4a99b25`. Fast (~3.2s).
- `npm run test:packaged` (NEW) — packaged-binary tests; ~2 cases (existence + 1 launch + theme); slower (~30-60s because electron-builder must run first).

CI may run them in sequence: `npm test && npm run dist && npm run test:packaged`. WI-A's plan does NOT propose a CI workflow file (that's a separate WI; brief §20 implications).

### §2.4 Cleanup

The packaged `.app` writes to `~/Library/Application Support/lawbar/` (same path as dev). The smoke test MUST clean up the preference file between dev and packaged runs to avoid cross-contamination (the dev-mode smoke and the packaged smoke share the same preference path). Pattern: `fs.unlinkSync` the preference file in `t.before` / `t.after`.

---

## §3 Future native-module risk (WI-B) — accounting only

### §3.1 What the risk is

Per substrate decision §7 row #7: Electron ships its own Node/V8 build. Native N-API modules (`better-sqlite3`, `@gutenye/ocr-node`) compiled against the system Node (Node 24.x in dev) are NOT ABI-compatible with Electron's Node. Loading them at runtime fails with `ERR_DLOPEN_FAILED` or similar.

The fix: use `@electron/rebuild` (or `electron-rebuild`) to recompile native modules against Electron's Node ABI. This must happen:
- After `npm install` (or as a `postinstall` hook).
- Before `electron-builder` packages the `.app`.

### §3.2 Why WI-B is SEPARATE from WI-A

- WI-A's shell has **zero `dependencies`** (per first-UI-shell §2). No native module is loaded. So `@electron/rebuild` would be a no-op for WI-A.
- WI-B needs a NEW devDep (`@electron/rebuild` — STOP-AND-ASK per brief §20) AND a NEW NPM `dependencies` entry (the first runtime dep — e.g., `better-sqlite3` — also STOP-AND-ASK).
- Each STOP-AND-ASK is its own authorization. Bundling them into WI-A would force the user to authorize 2-3 STOP-AND-ASKs at once.

### §3.3 What WI-B WOULD look like (informational only; NOT THIS PLAN'S CONTENT)

When the user later authorizes WI-B:

- Add `@electron/rebuild` to `devDependencies` (STOP-AND-ASK).
- Add `better-sqlite3` to `dependencies` (STOP-AND-ASK — first runtime dep for this app).
- Add a `postinstall` script: `electron-rebuild --version <electron-version>`.
- Add `apps/lawbar-desktop/src/probes/sqliteProbe.ts` (small in-process module: open `:memory:`, run `SELECT 1`, close).
- Add `apps/lawbar-desktop/tests/smoke.native-module.electron.test.mjs` — Playwright Electron smoke that loads the probe inside the packaged `.app` and asserts the SELECT returns 1.
- Update `apps/lawbar-desktop/package.json` `build.files` to include rebuilt native binaries.

WI-B's exact file list + acceptance criteria are NOT specified by this plan. WI-B has its own plan-WI when the user authorizes it.

### §3.4 WI-B's predecessors

- WI-A must pass.
- WI-B may NOT be authorized while WI-A is failing or unverified.

### §3.5 Risk-flagged-but-deferred items

- `@gutenye/ocr-node` (OCR engine) is another native module. WI-B may cover ONLY `better-sqlite3` (the more-critical of the two for case-box-persistence integration). OCR-engine packaging is a SEPARATE later WI (likely after first product UI screen that needs OCR).
- The N-API version pin must match across `better-sqlite3` + Electron's Node + `electron-rebuild`. Drift here is exactly the failure mode WI-B exists to surface.

---

## §4 Hard-stop inheritance

All applicable / unresolved brief §20 STOP-AND-ASK items (per `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record"; the exact count is brittle against future brief amendments — per rev-1 reviewer L D2#2) are inherited by reference without modification. Items SPECIFICALLY triggered by THIS plan + WI-A + WI-B:

1. **Brief §20 "New runtime dependencies (each individually)"** — WI-A adds ZERO new deps. WI-B adds `@electron/rebuild` (devDep) + `better-sqlite3` (runtime dep) — each individual STOP-AND-ASK at WI-B authorization.
2. **Brief §20 "Code-signing identity + notarization profile" + "Apple Developer ID acquisition" + "Mac App Store vs direct vs in-firm IT distribution"** — NOT triggered by WI-A or WI-B (both produce unsigned dev-only `.app` for the developer's own machine).
3. **Brief §20 "Public deployment / release / publication"** — NOT triggered.
4. **Brief §20 "Renderer UI framework choice"** — NOT triggered (no UI changes).

Items NOT triggered at all (most of the remaining unresolved §20 items; consult brief §20 + blueprint §4 for the authoritative current list): auth provider, cloud vendor, external document exposure, mini-program publication, sync bridge enablement, LLM enablement, document text-extraction engine, secret material handling, per-document encryption-at-rest, hard-delete retention, tenant boundary widening, any external network surface beyond WI-03, real-data migration, monetization, redaction ADR.

---

## §5 Suggested follow-up WIs

Each requires SEPARATE explicit user authorization. This plan executes none.

| # | Suggested WI | Phase | Risk | Predecessors |
|---|---|---|---|---|
| 1 | **Impl: WI-A** (current-shell packaging smoke per §1.3 + §2) | Impl | Low | THIS plan READY + user authorizes WI-A |
| 2 | Plan: WI-B (native-module rebuild smoke; better-sqlite3) | Plan | **STOP-AND-ASK** (each new dep) | WI 1 |
| 3 | Impl: WI-B per WI 2's spec | Impl | Medium; **STOP-AND-ASK** | WI 2 |
| 4 | Plan: case-box IPC contract (renderer ↔ main) — substrate decision §6 row 4 | Plan | Medium | WIs 1 + 3 |
| 5 | Impl: case-box-aware first screen (e.g., list matters) | Impl | Medium | WI 4 |
| 6 | Plan: dependency-hygiene WI (address electron-builder transitive CVEs) | Plan | Low; **STOP-AND-ASK** if upgrade requires new dep | None |
| 7 | Plan: code-signing + notarization onboarding (substrate decision §6 WI #6) | Plan | **STOP-AND-ASK** (Apple Developer ID) | brief §20 |
| 8 | Plan: distribution channel decision (substrate decision §6 WI #7) | Plan | **STOP-AND-ASK** | brief §20 + WI 7 |

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to RUN `npm run dist` and/or install `@electron/rebuild`. | Top-of-file PLAN-ONLY banner; §2 acceptance criteria split for THIS plan-WI vs WI-A; §3 explicit WI-B-is-separate phrasing. |
| 2 | Medium | WI-A's packaged `.app` writes to the same `~/Library/Application Support/lawbar/` path as dev mode. Cross-contamination between dev tests and packaged tests is possible. | §2.4 mandates cleanup in `t.before` / `t.after`. |
| 3 | Low | `electron-builder` may produce a `.app` that fails Gatekeeper checks (because unsigned). The smoke test launches via `executablePath` which bypasses Gatekeeper. This is intentional for dev but may hide signing issues until WI-7 (signing onboarding). | §"Out of scope" explicitly flags Gatekeeper as outside WI-A; future signing WI exercises Gatekeeper path. |
| 4 | Low | First `npm run dist` downloads electron-builder cache (~50MB) the first time. Slow but one-time. | Documented in WI-A's eventual commit message; not a release-blocker. |
| 5 | Low | The WI-A packaged smoke may be slower than the dev-mode smoke (~30-60s vs ~2s) because electron-builder must run first. | Acceptable for a one-shot packaging gate; not run on every commit. |
| 6 | Low | WI-B's required `electron-rebuild` postinstall hook adds startup cost to every `npm install`. | Accept; the alternative is manual rebuild and easier-to-forget. |

No Critical / High risks.

---

## §7 References

- `dev-memo/plan-ui-substrate-decision-00.md` (rev-3 RATIFIED Electron at `35cd9b6`) §3.6 + §3.7 + §3.8 + §6 row 4.5 + §7 row #7.
- `dev-memo/plan-first-ui-shell-00.md` (READY rev-2 at `f74b2b2`) §1 + §2 + §6.
- `apps/lawbar-desktop/package.json` (at `4a99b25`) — `scripts.dist`, `build.mac`, `build.files`.
- `apps/lawbar-desktop/scripts/manual-evidence.mjs` — Playwright Electron + `executablePath` reusable pattern.
- `dev-memo/plan-night-mode-foundation-00.md` §1 + §3.2 (palette + persistence path).
- `dev-memo/plan-go-live-readiness-00.md` gate #3 + gate #4.
- `docs/product/project-requirements-brief.md` §4 + §20.
- `.claude/rules/autonomy.md` §"Hard-stop list".

---

## §8 Stop condition

This plan is stale or superseded when:
- The user authorizes WI-A (§5 row 1) — the plan becomes "promoted to WI-A; awaiting impl commit".
- WI-A ships and `release/mac-*/lawbar.app/` packaging is proven — the plan becomes "WI-A complete; WI-B awaits separate authorization".
- WI-B ships and native-module rebuild is proven — the plan becomes "superseded by WI-B impl commit; the future case-box screens WI can proceed".
- Substrate decision is amended in a way that invalidates Electron as the substrate.
- First UI shell file layout changes materially (e.g., framework decision lands and renames `electron/` → `tauri-sidecar/`).
