# Manual evidence — WI-casebox-ui-impl (G-UI-24)

**Date**: 2026-05-27.
**HEAD at recording**: `9e715cc58574990dff6812c414945f4d2337b31a`.
**Plan reference**: `dev-memo/plan-casebox-ui-plan-00.md` rev-0.1 READY-with-Low §10 G-UI-24.
**Scope**: case-box UI implementation lane (Slices 1-7 + Checkpoints 8-10).

This file records the manual evidence required by G-UI-24 of the UI plan. It
also records honestly which manual gates were and were NOT performed in the
implementation session, so the user can complete the remaining manual gates
on a workstation with the necessary tooling.

## 1. Automated evidence — captured in this session

### 1.1 Build

```
$ npm --prefix apps/lawbar-desktop run build
> npm run build:ts && npm run build:assets
> tsc -p tsconfig.json
> mkdir -p dist/renderer && cp renderer/index.html renderer/index.css dist/renderer/
```
Exit 0. TypeScript compiled cleanly, no warnings.

### 1.2 Renderer-import lint

```
$ npm --prefix apps/lawbar-desktop run lint:renderer-imports
[check-renderer-imports] OK — 10 renderer file(s) scanned; no offenders
```
Exit 0. Renderer-internal imports are permitted; no imports out of
`renderer/` resolve to forbidden paths (`src/caseBox`, `electron`,
`node:*`, `case-box-persistence`, etc.).

### 1.3 No-real-data scanner

```
$ npm --prefix apps/lawbar-desktop run check:no-real-data
[check-no-real-data] OK — N file(s) in case-box scope; no markers
```
Exit 0. Scope filter extended (per M2 reconciliation) to cover
`apps/lawbar-desktop/renderer/` paths in addition to the original
`casebox|case-box|caseBox` regex.

### 1.4 Renderer-color lint (G-UI-5)

```
$ npm --prefix apps/lawbar-desktop run test:ui-color
ℹ tests 4
ℹ pass 4
```
All 4 tests pass. Block-level `:root` exemption verified per M3.

### 1.5 Renderer-internal unit tests (Slices 1-7)

```
$ node --test \
  tests/main.test.mjs \
  tests/ipc-handlers.unit.test.mjs \
  tests/dto-contract.test.mjs \
  tests/check-renderer-imports.test.mjs \
  tests/check-no-real-data.test.mjs \
  tests/renderer-router.test.mjs \
  tests/renderer-dto-sync.test.mjs \
  tests/renderer-no-hardcoded-color.test.mjs \
  tests/renderer-api.test.mjs \
  tests/renderer-dom.test.mjs \
  tests/renderer-list-matters.test.mjs \
  tests/renderer-create-matter.test.mjs \
  tests/renderer-view-matter.test.mjs \
  tests/renderer-archive-matter.test.mjs
ℹ tests 229
ℹ pass 229
```
Includes:
- Router: 22 tests
- DTO sync: 7 tests
- Color lint: 4 tests
- API wrapper: 14 tests
- DOM helpers: 28 tests
- listMatters screen: 13 tests
- createMatter screen: 15 tests
- viewMatter screen: 19 tests
- archiveMatter screen: 15 tests
- Plus existing main / IPC / contract / scanner / lint tests (already
  passing before this WI).

### 1.6 Electron smoke (rewritten per H3)

```
$ node --test tests/smoke.electron.test.mjs
ℹ tests 2
ℹ pass 2
```
- Window opens; title=`lawbar`; `<main id="app">` renders; `#/matters`
  route shows case-box list-shell header + empty-state copy ("Data is
  held in memory only — relaunching the app clears it.").
- `nativeTheme.themeSource` flip propagates to `<html data-theme>`.

### 1.7 Packaged case-box UI flow (G-UI-10/11/12/13)

```
$ npm --prefix apps/lawbar-desktop run test:ui-packaged
[test-packaged-wrapper] SUCCESS (exit 0)
ℹ tests 1
ℹ pass 1
```
Flow exercised end-to-end via Playwright clicks/fills against the packaged
`.app`:
- Load `#/matters` → empty active list state.
- Click `+ New matter` → fill form (name / matter_type=Litigation /
  jurisdiction / parties[0] / confidentiality=Normal) → submit.
- Auto-navigation to `#/matters/:id` → matter detail rendered → status pill
  `--active`.
- Click `Archive…` → fill reason → submit.
- Navigation back to view → status pill `--archived` → "Reason recorded in
  audit log." line visible → Archive button absent.
- Click chain head `<details>` → `headHash` truncated per §6.5 rule
  (contains `...`) → `count >= 1`.

Pre/post no-DB-file scan: zero `*.db` / `*.sqlite` / `*.sqlite3` /
`*.db-wal` / `*.db-shm` / `case-box.db*` matches in either the temp
`--user-data-dir` root or the repo working tree.

Programmatic no-real-data scanner invocation post-test: exit 0.

Wrapper crash-detection report: `0 HIGH-CONFIDENCE / 0 HELPER-PROCESS /
0 UNATTRIBUTED-PARENT / 0 ATTRIBUTION_UNKNOWN / 0 SUSPICIOUS-PID-REUSE`.

### 1.8 Existing IPC packaged regression

```
$ npm --prefix apps/lawbar-desktop run test:ipc-packaged
ℹ tests 1
ℹ pass 1
```
Pre-existing direct-IPC packaged test still green; no regression.

### 1.9 Tarball PoC regression

```
$ npm --prefix apps/lawbar-desktop run test:tarball-poc
```
Not re-run in this session (no diff against tarball PoC scope). The tarball
PoC last passed at commit `e61d7d9`.

## 2. Manual gates NOT performed in this session

Per project rule "Do not claim manual evidence or audit completion unless
actually performed": the following gates were NOT performed in this
implementation session. They remain open and should be completed by the
user on a workstation with the necessary tooling before final go-live.

### 2.1 VoiceOver smoke walkthrough (G-UI-24 evidence)

NOT performed. Required tooling: macOS VoiceOver (Cmd-F5 to enable). Manual
steps recommended:

1. Launch the packaged `.app` interactively (`open dist/mac-arm64/lawbar.app`).
2. Enable VoiceOver (Cmd-F5).
3. Navigate the empty list view via VO+Right Arrow.
4. Open Create matter, fill the form using only VO + keyboard.
5. Submit; navigate to view.
6. Open Archive…, fill reason, submit.
7. Verify VO reads:
   - The `<h1>` per screen.
   - Field labels via the explicit `for=`/`id=` association.
   - Live-region announcements ("Creating…", "Archiving…", error messages).
   - Status pill text.
   - Audit chain head expansion (`<details><summary>`).

Acceptance: each screen reads correctly with no announced rendering errors
or duplicate focus traps.

### 2.2 Keyboard-only walkthrough (G-UI-24 evidence)

NOT performed in this session as an interactive trace. Automated unit tests
cover the equivalent state transitions (focus moves, Enter to submit, Esc
to cancel, Tab order). Manual steps recommended:

1. Launch packaged `.app` interactively.
2. Disable mouse input or actively avoid it.
3. Walk the full flow: list → New matter → fill → submit → view → Archive →
   fill → submit.
4. Verify Tab order matches visual order on every screen.
5. Verify Esc cancels modal-style states (parties Add/Remove without losing
   form state).
6. Verify focus-visible outline is present on every interactive element.

Acceptance: full flow completable without a mouse.

### 2.3 Light + dark mode screenshots (G-UI-24 evidence)

NOT performed. PNG capture requires a GUI session. Manual steps:

1. Launch `.app` interactively.
2. macOS → System Settings → Appearance → Light. Capture each screen.
3. Switch to Dark. Capture each screen.
4. Place PNGs at `dev-memo/manual-evidence-casebox-ui-impl-00/<screen>-<mode>.png`.

Note: theme-token foundation is verified by the existing palette-sync test
(`tests/main.test.mjs` test 6, UNCHANGED) and by the smoke test's
`nativeTheme.themeSource` flip assertion (§1.6 above).

### 2.4 `npm run dev` console transcript

NOT captured in this session. `npm run dev` is interactive (Electron opens
a window and blocks the terminal). Manual steps:

1. `npm --prefix apps/lawbar-desktop run dev`.
2. Open Electron DevTools.
3. Drive the v1 flow once.
4. Save the Console pane transcript.

Acceptance: no CSP violations; no `electron.security` warnings; no thrown
exceptions during the v1 flow.

## 3. Limitations

- The packaged UI flow test uses a synthetic ULID, synthetic matter name
  `matter-fixture-A`, synthetic party `syn-party-A`, and synthetic archive
  reason `synthetic-archive-reason-fixture`. No real lawyer / firm / case /
  party data has been entered into the in-memory backing at any point.
- The renderer-color lint exempts only the canonical `:root` and
  `:root[data-theme="dark"]` blocks in `renderer/index.css`. Block-level
  exemption is implemented by brace-counting after comment stripping. Robust
  on the current hand-formatted CSS; could drift if a future CSS minifier
  is introduced. Re-evaluate at that time.
- The packaged UI flow test required a deterministic `waitForLoadState("load")`
  instead of `"domcontentloaded"` because Playwright Electron can race the
  renderer's deferred module-script bootstrap inside the asar archive.
  Documented in the test source.

## 4. Disposition

| Gate | Status |
|---|---|
| G-UI-1 build | PASSED (§1.1) |
| G-UI-2 lint:renderer-imports | PASSED (§1.2) |
| G-UI-3 check:no-real-data | PASSED (§1.3) |
| G-UI-4 test:ui-shape-sync | PASSED (within §1.5) |
| G-UI-5 test:ui-color (block-level :root exemption) | PASSED (§1.4) |
| G-UI-5a test:ui-router | PASSED (within §1.5) |
| G-UI-6 palette-sync | PASSED (within §1.5) |
| G-UI-7 test:ipc-unit | PASSED (within §1.5) |
| G-UI-8 test:ipc-contract | PASSED (within §1.5) |
| G-UI-9 test:ipc-packaged | PASSED (§1.8) |
| G-UI-10 test:ui-packaged | PASSED (§1.7) |
| G-UI-11 no-DB-file scan pre/post | PASSED (§1.7) |
| G-UI-12 check-no-real-data post-test | PASSED (§1.7) |
| G-UI-13 wrapper crash-count invariant | PASSED (§1.7) |
| G-UI-14 test:tarball-poc | NOT RE-RUN (§1.9 — no diff in tarball scope) |
| G-UI-15 npm test default | INHERITED from §1.5 + §1.6 (covers all node:test files) |
| G-UI-16 cross-package no-regression | NOT RE-RUN this session (out-of-scope; impl WI doesn't touch services/** or docs/contracts/**) |
| G-UI-17 no new runtime/devDependency | VERIFIED via `package.json` diff: only `scripts` block changed |
| G-UI-18 no SQLite path activated | VERIFIED via `git diff` content scan; backing unchanged |
| G-UI-19 main.ts UNCHANGED | VERIFIED via `git diff -- apps/lawbar-desktop/electron/main.ts` (empty) |
| G-UI-20 preload.mts UNCHANGED | VERIFIED (empty diff) |
| G-UI-21 ipc/caseBoxHandlers.ts UNCHANGED | VERIFIED (empty diff) |
| G-UI-22 src/caseBox/* UNCHANGED | VERIFIED (empty diff) |
| G-UI-23 services/** + docs/contracts/** UNCHANGED | VERIFIED (empty diff) |
| G-UI-24 manual evidence (VoiceOver / keyboard / screenshots / dev console) | THIS FILE — automated portions captured; §2 manual portions DEFERRED |
| G-UI-25 cc-suite audit CLEARED | OPEN (Checkpoint 12 of this run) |
| G-UI-26 cc-suite verify ALL CLOSED | OPEN (Checkpoint 12) |
| G-UI-27 loc-guardian | NOT RE-RUN this session; largest hand-written file (createMatter.ts) is 616 LOC, well under 800 fail threshold; largest test file (renderer-create-matter.test.mjs) is 527 LOC, well under 1200 |
| G-UI-28 cc-suite recording in commit | DEFERRED to Checkpoint 12 |
| G-UI-29 `.claude/scheduled_tasks.lock` untracked | VERIFIED |
| G-UI-30 working tree clean post-commit | VERIFIED after each slice/checkpoint commit |

## 5. Commit chain in this lane

```
$ git log --oneline -10
9e715cc test(apps/lawbar-desktop): add packaged case-box UI flow
2152359 test(apps/lawbar-desktop): update smoke test for case-box UI
8afb2eb feat(apps/lawbar-desktop): wire case-box renderer shell
415e5db feat(apps/lawbar-desktop): add case-box archive matter screen
713b647 feat(apps/lawbar-desktop): add case-box view matter screen
124984e feat(apps/lawbar-desktop): add case-box create matter screen
2e5a368 feat(apps/lawbar-desktop): add case-box list matters screen
14cfda2 feat(apps/lawbar-desktop): add renderer DOM helpers
078ffe3 feat(apps/lawbar-desktop): add case-box renderer API wrapper
2565a2d feat(apps/lawbar-desktop): add case-box renderer UI primitives
```

Plan commit (predecessor) at `1910756`; IPC impl commit (predecessor) at
`e490686`.

## 6. Next steps

1. User completes §2 manual gates on a workstation with VoiceOver + a GUI session.
2. Run cc-suite audit on the impl WI scope (Checkpoint 12 of the autonomous run).
3. Run cc-suite verify against the audit findings.
4. User authorizes push.
