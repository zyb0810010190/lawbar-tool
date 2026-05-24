# Plan: First UI Shell — Minimal Electron App + Theme Foundation (PLAN-ONLY)

> **PLAN ONLY.** This document specifies the FIRST UI implementation WI ("first-ui-shell"). It does NOT implement anything: no UI file is created, no `package.json` modified, no dependency installed, no signing / notarization / distribution channel chosen, no telemetry, no cloud sync, no case-box-persistence integration. Each runtime dep introduced by the implementation WI (`electron`, `electron-builder`, etc.) is its own SEPARATE STOP-AND-ASK per brief §20 + `.claude/rules/autonomy.md` §"Hard-stop list" + `dev-memo/plan-ui-substrate-decision-00.md` §5 — the user authorizes each individually at impl-WI authorization.

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned NEEDS-FIX with 3 Mediums + 7 Lows; rev-2 applied all: M D1#1 file count corrected 13 → 15; M D1#2 `playwright` + `@playwright/test` split into 2 separate STOP-AND-ASK deps (total 6 deps; was 5); M D3#1 renderer/index.ts hardened to ZERO imports + applyTheme.ts reframed as main-process-only (CSS custom properties are the single renderer-side palette source); §3.1 NEW palette-sync test + productName test (L D3#2); §6 substrate decision row #7 vs row 4.5 wording reconciliation (L D1#3); §7 renderer-compile risk raised to Medium (M D5#1); §3.3 manual evidence requirement added (L D2#2); §3.4 coverage map added (L D2#1).).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only first UI shell / theme-token implementation planning.
**Predecessors**: Electron substrate ratification at `35cd9b6`; UI substrate decision plan rev-2 at `b655b5f`; night-mode foundation at `7ad57ed`; legacy reconciliation amendments at `b5c7d9f`; blueprint at `1b92c58`; Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

This plan specifies the **first-ui-shell** WI — the minimum Electron application that proves the substrate works AND implements the night-mode token foundation from line 1, without touching case-box-persistence, the OCR pipeline, signing, notarization, or any product feature. It exists to:

1. Validate that Electron successfully hosts a Mac `.app` bundle on the developer's machine.
2. Demonstrate the token-module shape (`dev-memo/plan-night-mode-foundation-00.md` §1) compiled into both renderer-time CSS custom properties and main-process TS values.
3. Validate System / Light / Dark switching against the OS appearance (`nativeTheme`).
4. Persist the theme preference to disk (`dev-memo/plan-night-mode-foundation-00.md` §3.2).
5. Render ONE token-compliance fixture screen (NOT product UI) showing all 12 tokens.
6. Run a main-process smoke test + a Playwright Electron smoke test.

It does NOT integrate `case-box-persistence` (the SQLite native-module packaging risk is handled by a SEPARATE WI per `dev-memo/plan-ui-substrate-decision-00.md` §6 row 4.5).

It does NOT choose a renderer UI framework (per `dev-memo/plan-ui-substrate-decision-00.md` §3.1 + brief §20 — vanilla TS for this WI; framework decision is `dev-memo/plan-ui-substrate-decision-00.md` §6 WI #2, separately authorized).

Plan-only file: `dev-memo/plan-first-ui-shell-00.md` (THIS FILE). The impl WI itself is a SEPARATE future commit.

### Exact target files (THIS plan-WI's own commit)

CREATED (single file):
- `dev-memo/plan-first-ui-shell-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- ANY `apps/**` (doesn't exist yet; would be created by the impl WI).
- ANY `package.json` — root or sub-package.
- ANY `node_modules/`.
- `dev-memo/plan-night-mode-foundation-00.md`.
- `dev-memo/plan-ui-substrate-decision-00.md`.
- `dev-memo/plan-client-00.md`.
- `docs/product/project-requirements-brief.md`.
- `docs/adr/**`, `docs/ui/**`, `docs/release/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

### Exact target files for the IMPL WI (NOT created by THIS plan-WI's commit)

When the user later authorizes the impl WI, it would create exactly this file set under `apps/lawbar-desktop/`:

- `apps/lawbar-desktop/package.json` — private; `type: "module"`; lists `electron` + `electron-builder` as devDependencies (each STOP-AND-ASK at impl-WI authorization); `engines.node` matches AGENTS.md repo brief pin (Node 22.x or 24.x); `scripts.test` runs `node --test` + Playwright Electron smoke; `scripts.build` invokes electron-builder; no runtime dependencies in this WI.
- `apps/lawbar-desktop/tsconfig.json` — extends a future repo-root or local config; `target: "es2022"`; `module: "node-next"`; `strict: true`.
- `apps/lawbar-desktop/electron/main.ts` — main process. Spawns ONE BrowserWindow; loads the renderer's `index.html`; wires up `nativeTheme` listener; persists + reads theme preference; registers the narrow IPC surface (`getTheme`, `setTheme`); quits on all-windows-closed (macOS app keep-alive opt-in is OUT of scope for this WI).
- `apps/lawbar-desktop/electron/preload.ts` — preload script. Uses `contextBridge.exposeInMainWorld` to expose exactly `lawbar.theme.get()` and `lawbar.theme.set(mode)`. No other APIs exposed.
- `apps/lawbar-desktop/renderer/index.html` — single HTML file. `<html lang="en">`, `<head>` with `<meta charset>` + `<title>lawbar (token fixture)</title>` + link to `index.css`; `<body>` with one `<main>` containing 12 small panels (one per token).
- `apps/lawbar-desktop/renderer/index.ts` — vanilla TS, **ZERO imports** (per rev-1 reviewer M D3#1 fix — eliminates the bundler question). On `DOMContentLoaded`: reads current theme via `window.lawbar.theme.get()`; toggles `<html data-theme>` to `"light"` or `"dark"`; listens for `window.lawbar.theme.onSystemChange((mode) => ...)` callbacks for live OS appearance updates; renders the 12 token panels by reading their definitions from a small inline array. NO `import` statement from `src/theme/**` — palette values live in `index.css` as CSS custom properties; renderer never sees raw hex.
- `apps/lawbar-desktop/renderer/index.css` — declares CSS custom properties for all 12 tokens at `:root` (Light palette default) and `:root[data-theme="dark"]` (Dark palette). Component styles reference `var(--color-<token>)` only. **This file is the SINGLE source of palette values in the renderer process**; `src/theme/tokens.ts` is the SINGLE source for the main process. Both must stay in sync (verified by `tests/main.test.mjs` — see §3.1).
- `apps/lawbar-desktop/src/theme/tokens.ts` — exports `ThemeTokens` interface + `Theme` interface + `LIGHT_TOKENS` + `DARK_TOKENS` constants per `dev-memo/plan-night-mode-foundation-00.md` §1 + §2. Single source of truth for hex values.
- `apps/lawbar-desktop/src/theme/applyTheme.ts` — **MAIN-PROCESS-ONLY helper** (per rev-1 reviewer M D3#1 fix — renderer does NOT import this). Exports `resolveAndPersist(preference: "system" | "light" | "dark", systemDark: boolean): "light" | "dark"` — composes `resolveSystemMode` + `saveThemePreference`. Used by main process to handle `setTheme` IPC calls.
- `apps/lawbar-desktop/src/theme/resolveSystemMode.ts` — exports `resolveSystemMode(preference: "system" | "light" | "dark", systemDark: boolean): "light" | "dark"` — pure function; implements the precedence rules from `dev-memo/plan-night-mode-foundation-00.md` §3.3.
- `apps/lawbar-desktop/src/persistence/themePreference.ts` — exports `loadThemePreference()` + `saveThemePreference(mode)` reading/writing `~/Library/Application Support/lawbar/theme-preference.json` per `dev-memo/plan-night-mode-foundation-00.md` §3.2 (suggested location pattern).
- `apps/lawbar-desktop/tests/main.test.mjs` — main-process unit test using `node:test`. Tests `loadThemePreference` round-trip (write → read → identical) + `resolveSystemMode` truth table (3 preferences × 2 systemDark = 6 cases).
- `apps/lawbar-desktop/tests/smoke.electron.test.mjs` — Playwright Electron smoke test using `_electron.launch()`. Asserts: window opens; title is "lawbar (token fixture)"; demo renders 12 panels; `setTheme("dark")` swaps `<html data-theme>` to "dark"; `setTheme("light")` swaps back; close cleanly.
- `apps/lawbar-desktop/.gitignore` — ignores `node_modules/`, `dist/`, `release/`.
- `apps/lawbar-desktop/README.md` — minimal: what this app is (token fixture; NOT product UI); how to dev-run (`npm install && npm run dev`); how to test (`npm test`); explicit "NOT signed; NOT notarized; NOT for distribution".

Note: each of these files is **a SEPARATE STOP-AND-ASK risk surface** at impl-WI authorization time. The user may want to slim the list further; reviewer can push back.

### Exact acceptance criteria

#### For THIS plan-WI:

1. Plan committed alone (one file).
2. §1 enumerates the impl-WI's package layout + each file's role.
3. §2 enumerates the runtime dep additions and explicitly flags each as STOP-AND-ASK.
4. §3 enumerates the test plan (main-process + Playwright Electron).
5. §4 enumerates the no-hard-coded-color enforcement approach for this WI (lint OR manual audit per `dev-memo/plan-night-mode-foundation-00.md` §5 fix).
6. §5 enumerates the contrast verification approach for this WI (hand-computed sufficient; CI contrast deferred).
7. §6 explicitly carries forward the Electron native-module packaging risk (`better-sqlite3`, OCR engine) WITHOUT solving it — that's `dev-memo/plan-ui-substrate-decision-00.md` §6 row 4.5.
8. §7 hard-stop inheritance accurate.
9. §8 suggested follow-up WIs listed (each separately authorized).
10. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

#### For the IMPL WI (when later authorized; this plan does NOT execute):

1. `npm --prefix apps/lawbar-desktop install` succeeds with the explicitly-authorized dep set.
2. `npm --prefix apps/lawbar-desktop run dev` opens an Electron BrowserWindow showing the 12-panel token fixture.
3. OS appearance change (System Preferences → Appearance toggle) flips the fixture's palette live when `mode === "system"`.
4. Toggling `window.lawbar.theme.set("dark")` flips `data-theme` and persists.
5. Re-launching the app loads the persisted preference correctly.
6. `npm --prefix apps/lawbar-desktop test` exits 0 (main-process + Playwright Electron smoke).
7. `npm --prefix apps/lawbar-desktop run build` produces a `.app` artifact under `release/` — unsigned; dev-only.
8. No raw color literals outside `src/theme/` (lint enforced OR manual audit recorded per `dev-memo/plan-night-mode-foundation-00.md` §5).
9. VoiceOver reads each of the 12 fixture panels correctly (manual gate; no CI automation in v1 day-one).
10. All `services/**` tests still pass; no regression introduced (impl WI does NOT touch `services/**`).

### Exact out-of-scope list (FOR THE IMPL WI; NOT just this plan)

- **Any case-box-persistence integration.** No `import { ... } from "case-box-persistence"` in main process. The native-module packaging risk is solved by `dev-memo/plan-ui-substrate-decision-00.md` §6 row 4.5, a SEPARATE WI that runs BEFORE case-box screens (§6 row 5).
- **Any OCR pipeline integration.** Same separation.
- **Any product UI screen.** The 12-panel fixture is the ONLY screen.
- **Renderer UI framework choice.** Vanilla TS only (per substrate decision §3.1). Framework choice is `dev-memo/plan-ui-substrate-decision-00.md` §6 WI #2.
- **macOS app keep-alive on all-windows-closed.** Standard pattern; out of scope for the first WI (single-window app exits cleanly).
- **Custom NSToolbar / NSMenu / NSDock integration.** Out of scope; default Electron chrome only.
- **Code signing, notarization, Apple Developer ID, Mac App Store / direct / in-firm IT distribution.** All STOP-AND-ASK per brief §4 + §20; the impl WI ships an unsigned dev-only `.app` for the developer's machine.
- **Auto-update mechanism.** Brief §4 manual download v1 only; auto-update is post-v1.
- **Crash reporting, telemetry, analytics.** Brief §4 OFF default.
- **Cloud sync, network egress (except WI-03-hardened outbound HTTPS for OCR — and even that is OUT of this WI because no OCR integration).**
- **Any external network surface from the Electron app.** No HTTP server in main; no remote URL loaded in BrowserWindow; only the local `file://` URL of the bundled `index.html`.
- **High-contrast / accessibility mode** beyond focus rings + semantic HTML + manual VoiceOver gate. Automated audit deferred per `dev-memo/plan-night-mode-foundation-00.md` §8 WI #7.
- **CI / GitHub Actions workflow for the new app.** Local `npm test` only in this WI.
- **The other 9 STOP-AND-ASK items from brief §20 that don't apply to UI** (auth provider, cloud vendor, etc.).
- **`git push`** of the impl WI commits (separate explicit authorization).

### Essential references

- `dev-memo/plan-ui-substrate-decision-00.md` (rev-3 RATIFIED at `35cd9b6`) §3.1 (renderer = vanilla TS for WI #3), §3.2 (runtime deps STOP-AND-ASK), §4 (minimal first UI WI scope), §6 row 3 (this WI's slot in the follow-up list), §6 row 4.5 (native-module packaging smoke as SEPARATE later WI), §7 row #7 (Medium risk — Electron native-module ABI).
- `dev-memo/plan-night-mode-foundation-00.md` (READY at `7ad57ed`) §1 (12 tokens), §2 (Light + Dark palettes), §3 (System / Light / Dark behavior), §3.2 (persistence location pattern), §4 (no-hard-coded-color rule), §5 (zero-migration: first UI WI builds on tokens from line 1; lint OR manual audit before merge), §6 (contrast verification approach).
- `dev-memo/plan-client-00.md` §4.1 (suggested `apps/lawbar-desktop/` layout).
- `docs/product/project-requirements-brief.md` (READY revision 5) §4 (Mac app expectations), §20 (hard-stop list).
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #3 (Mac-client surface — this WI OPENS gate #3 partially but does NOT close it; case-box integration is needed to close).
- `AGENTS.md` §"Repo Brief" (Node 22+ ABI pinning).
- `.claude/rules/autonomy.md` §"Hard-stop list".

### Review questions for the reviewer

1. **Plan-WI vs impl-WI separation**: this file is the PLANNING WI for the implementation WI. It does NOT execute. Is the separation explicit enough?

2. **File list completeness**: §1 enumerates 13 files the impl WI would create. Is this minimal, or could any be deferred (e.g., is `resolveSystemMode.ts` necessary as a separate file vs inline in `main.ts`)? Plan picks: separate file because §3 unit-tests it as a pure function — easier to test in isolation. Reviewer may push to inline.

3. **Renderer-side TS toolchain**: the renderer's `index.ts` needs to be compiled to JS before Electron loads it. Plan picks: TypeScript compiler (`tsc`) only — no bundler (`webpack`/`vite`/`esbuild`). Rationale: minimum dep surface; vanilla TS in this WI; no module imports between renderer files (everything in one `index.ts`). Reviewer may push to add a bundler (another STOP-AND-ASK).

4. **Playwright Electron dep**: §3 names Playwright as the smoke test tool. Playwright is a SEPARATE runtime dep (devDependency). Plan picks: Playwright is in the dep set for this WI. Reviewer may push to use `electron`'s built-in `Electron.Spectron` (deprecated) OR a custom IPC-based smoke instead.

5. **No-hard-coded-color enforcement**: §4 picks "manual audit before merge" because lint setup adds another STOP-AND-ASK (and an eslint config is yet another dep). Reviewer may push to add eslint + a stylelint analog now; each is its own STOP-AND-ASK.

6. **Native-module packaging**: §6 explicitly carries forward the risk WITHOUT solving it. Is this defensible? Plan picks: yes — first UI WI must NOT block on packaging the native modules because it doesn't USE any native modules. The packaging-smoke WI (`dev-memo/plan-ui-substrate-decision-00.md` §6 row 4.5) is the right place to solve it.

7. **App data path**: §1 names `~/Library/Application Support/lawbar/theme-preference.json` per night-mode foundation §3.2. Electron's `app.getPath("userData")` returns `~/Library/Application Support/lawbar/` once `app.setName("lawbar")` (or the `productName` in package.json) is configured. Plan picks: rely on `app.getPath("userData")` to produce the correct path; the literal `~/Library/Application Support/lawbar/` is the resulting path on macOS.

8. **macOS-only assumption**: the BrowserWindow uses default Electron defaults; the Quit behavior on Cmd-W vs Cmd-Q is the Electron default. Plan picks: explicit macOS-only assumption — the impl WI's `package.json` `engines` does NOT exclude Linux/Windows, but the QA matrix is Mac only. Reviewer may push to add explicit `process.platform === "darwin"` assertions.

---

## §1 Impl-WI package layout

Per §"Exact target files for the IMPL WI" above:

```
apps/lawbar-desktop/
├── package.json                    NEW (priv; type:module; engines node)
├── tsconfig.json                   NEW
├── .gitignore                      NEW
├── README.md                       NEW (dev-only; NOT signed; NOT for distribution)
├── electron/
│   ├── main.ts                     NEW (BrowserWindow; nativeTheme; IPC; persistence)
│   └── preload.ts                  NEW (contextBridge; narrow API surface)
├── renderer/
│   ├── index.html                  NEW (12-panel token fixture)
│   ├── index.ts                    NEW (vanilla TS; reads theme; renders 12 panels)
│   └── index.css                   NEW (CSS custom properties: :root + :root[data-theme="dark"])
├── src/
│   ├── theme/
│   │   ├── tokens.ts               NEW (ThemeTokens + LIGHT_TOKENS + DARK_TOKENS)
│   │   ├── applyTheme.ts           NEW (applyTheme(mode))
│   │   └── resolveSystemMode.ts    NEW (pure fn; tested in main.test.mjs)
│   └── persistence/
│       └── themePreference.ts      NEW (load/save ~/Library/.../theme-preference.json)
└── tests/
    ├── main.test.mjs               NEW (node:test; round-trip + truth table)
    └── smoke.electron.test.mjs     NEW (Playwright Electron smoke)
```

**15 files total** (per rev-1 reviewer M D1#1 count fix — package.json + tsconfig + .gitignore + README + 2 electron + 3 renderer + 4 src + 2 tests = 15). Each is BOUNDED to its single responsibility. None imports from `services/**` or `docs/contracts/**`. Renderer files do NOT import from `src/theme/**` (per rev-1 reviewer M D3#1 — keeps the renderer no-bundler).

## §2 Runtime dependencies introduced by the impl WI

Each is a SEPARATE STOP-AND-ASK at impl-WI authorization. The impl-WI plan must list each, with a one-sentence justification, in its commit message:

| # | Dep | Type | Justification | STOP-AND-ASK |
|---|---|---|---|---|
| 1 | `electron` | devDependency | The substrate itself, ratified at `35cd9b6`. | ✓ brief §20 framework-dep (RATIFIED but install still requires STOP-AND-ASK at impl-WI) + brief §20 "new runtime dependencies (each individually)". |
| 2 | `electron-builder` | devDependency | Mac `.app` + `.dmg` packaging path; standard in Electron ecosystem. | ✓ brief §20 "new runtime dependencies". |
| 3 | `playwright` | devDependency | Electron smoke testing via `_electron.launch()`. Per §3.2 below. | ✓ brief §20 "new runtime dependencies". |
| 4 | `@playwright/test` | devDependency | Test runner for Playwright (per rev-1 reviewer M D1#2 — separated from `playwright` itself for individual STOP-AND-ASK). | ✓ brief §20 "new runtime dependencies" (each individual). |
| 5 | `typescript` | devDependency | Already in other packages; same version pin (5.6.x per existing services). | ✓ brief §20 "new runtime dependencies" (each individual; even if same version as elsewhere). |
| 6 | `@types/node` | devDependency | TS types for Node-native main process. Same version as existing services. | ✓ same. |

**This plan does NOT install any of these.** The impl WI does, with the user's per-dep authorization at impl-WI authorization time.

No runtime (non-dev) dependencies. The shell has zero `dependencies` block.

## §3 Test plan for the impl WI

### §3.1 Main-process tests (`tests/main.test.mjs`)

Pure-Node tests using `node:test`. Test the pure functions; mock the filesystem with a temp dir.

- **`loadThemePreference` round-trip**: write a preference, read it back, deep-equal.
- **`loadThemePreference` defaults**: if the file doesn't exist, return `{ mode: "system", version: 1 }`.
- **`loadThemePreference` malformed JSON**: if the file exists but parses fail, return defaults + log a warning.
- **`loadThemePreference` schema mismatch**: if `mode` is not in `"system" | "light" | "dark"`, return defaults.
- **`resolveSystemMode` truth table**: 3 preferences × 2 systemDark = 6 cases:
  - `("light", true) → "light"` (explicit override wins)
  - `("light", false) → "light"`
  - `("dark", true) → "dark"`
  - `("dark", false) → "dark"`
  - `("system", true) → "dark"`
  - `("system", false) → "light"`
- **Palette-sync test** (NEW per rev-1 reviewer M D3#1 follow-up): parse `renderer/index.css` for `--color-*` declarations under `:root` (Light) and `:root[data-theme="dark"]` (Dark); assert every value matches the corresponding `LIGHT_TOKENS` / `DARK_TOKENS` entry in `src/theme/tokens.ts` byte-for-byte. Prevents the two sources from drifting silently.
- **`productName: "lawbar"` test** (per rev-1 reviewer L D3#2): assert `package.json` has `productName: "lawbar"` and that `app.getPath("userData")` (mocked or executed in a child Electron process) resolves to a path ending in `lawbar/`. Confirms the theme-preference path is computed correctly.

### §3.2 Renderer smoke test (`tests/smoke.electron.test.mjs`)

Playwright Electron via `_electron.launch()`. Tests the full bootstrap:

- App launches; window opens; title is `"lawbar (token fixture)"`.
- DOM has 12 panels with `data-token` attributes matching the 12 token names.
- Default mode is `"system"`; the current OS appearance is reflected.
- `await window.evaluate(() => window.lawbar.theme.set("dark"))` flips `<html data-theme>` to `"dark"` AND persists to disk (verified by reading the file in a `t.after` hook).
- `await window.evaluate(() => window.lawbar.theme.set("light"))` flips back.
- App closes cleanly on `window.close()`.

### §3.3 What is NOT tested at this WI

- VoiceOver accessibility (manual gate; impl-WI acceptance criterion #9).
- Live OS appearance change (requires user to toggle System Preferences mid-test; CI cannot do this reliably; verified manually — per rev-1 reviewer L D2#2, impl-WI commit message MUST record the manual evidence: "macOS System Preferences → Appearance toggle observed; with `mode === \"system\"`, the fixture's `<html data-theme>` transitioned to the new value within one frame").
- Contrast ratios at runtime (deferred to `dev-memo/plan-night-mode-foundation-00.md` §8 WI #5 CI contrast check).
- Bundle size / memory cost (out of scope for first WI).
- Cross-platform behavior (macOS only).

### §3.4 Coverage map (per rev-1 reviewer L D2#1)

The 11 user-requested scope items from the lane authorization → where each is handled:

| User-requested scope item | Handled in |
|---|---|
| Plan the first UI WI only | THIS plan-WI (entire file) |
| Minimal Electron shell + theme-token foundation + System/Light/Dark plumbing | §1 file layout + §3.1 main-process tests |
| Define exactly which package(s) and files | §1 + §"Exact target files for the IMPL WI" |
| Decide whether this WI adds `electron` + `electron-builder` (without installing) | §2 (YES; each STOP-AND-ASK) |
| Token-compliance fixture only; not product UI | §1 renderer/index.html + README + §"Out of scope" |
| Local theme preference persistence | §1 src/persistence/themePreference.ts + §3.1 round-trip test |
| Live OS appearance handling for System mode | §1 electron/main.ts (nativeTheme listener) + §3.3 manual gate |
| No-hard-coded-color enforcement approach | §4 (manual audit; lint deferred) |
| Contrast verification approach | §5 (hand-verified; CI deferred) |
| Smoke tests for Electron launch and theme switching | §3.2 Playwright Electron smoke |
| Native-module packaging risk acknowledged but not solved here | §6 (carried forward to substrate decision §6 row 4.5) |

## §4 No-hard-coded-color enforcement

Per `dev-memo/plan-night-mode-foundation-00.md` §5 rev-2 fix ("lint OR manual audit at first UI WI before merge"):

Plan picks: **manual audit before merge** for THIS WI. Rationale:
- Adding a lint tool (eslint or Biome) is another STOP-AND-ASK + another dep.
- The 13-file scope is small enough to grep manually for hex / rgb / hsl literals outside `src/theme/`.
- The impl-WI's commit message MUST include the audit result: `grep -REn "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(" apps/lawbar-desktop --include="*.{ts,html,css}" --exclude-dir=src/theme` returns ONLY whitelist matches (CSS custom-property references like `var(--color-background)` are fine; raw colors outside `src/theme/` are NOT).
- A future lint WI per `dev-memo/plan-night-mode-foundation-00.md` §8 WI #4 (separately authorized) automates this.

Reviewer may push to add eslint in this WI; that's a legitimate STOP-AND-ASK item at impl-WI authorization.

## §5 Contrast verification approach

Per `dev-memo/plan-night-mode-foundation-00.md` §6 rev-1 fix ("hand values are sanity-check guidance; CI contrast check is authoritative; deferred to §8 WI #5"):

Plan picks: **hand-verified at impl-WI** — the impl-WI's commit message MUST cite the contrast ratios from `dev-memo/plan-night-mode-foundation-00.md` §6.1 + §6.2 and confirm that the LIGHT_TOKENS + DARK_TOKENS values in `src/theme/tokens.ts` match the §2 hex values exactly. CI contrast check is deferred.

The two known WCAG failures (`border` on `background` < 3:1; `focus-ring` on `accent` < 3:1) are MITIGATED by the standard macOS patterns documented in night-mode foundation §6.3 — but the impl WI does NOT implement those mitigations in code (the fixture doesn't have invalid inputs or focused buttons-with-fill yet — those land in future product-feature WIs).

## §6 Electron native-module packaging risk (CARRIED FORWARD; NOT solved here)

Per `dev-memo/plan-ui-substrate-decision-00.md` §7 row #7 + §6 row 4.5. **Wording reconciliation per rev-1 reviewer L D1#3**: substrate decision §7 row #7 says first-UI-WI acceptance "MUST include" native rebuild smoke; substrate decision §6 row 4.5 sequences the packaging smoke as a SEPARATE WI. The conflict resolves in favor of row 4.5's sequencing: the first UI shell **does NOT load any native module** (the shell has zero `dependencies` per §2), so native rebuild is NOT necessary for THIS WI to ship. The packaging smoke WI (substrate decision §6 row 4.5) runs BEFORE case-box screens land — that's where `electron-rebuild` + `better-sqlite3` packaging is exercised. Substrate decision §7 row #7's "MUST include" phrasing refers to the FIRST WI THAT LOADS A NATIVE MODULE, which is row 4.5, NOT this first-shell WI.

- Electron uses its own Node/V8 build; native N-API modules (`better-sqlite3`, `@gutenye/ocr-node`) must be rebuilt against Electron's Node ABI before they load in main process.
- Failure mode: working in dev (CLI Node) but crashing in the packaged Electron `.app`.

**THIS WI does NOT exercise any native module.** The shell has zero `dependencies`. The fixture screen reads only from disk (preference JSON). So native-module ABI is not tested HERE.

The native-module packaging smoke WI (`dev-memo/plan-ui-substrate-decision-00.md` §6 row 4.5) is the right place to solve this:
- That WI adds `@electron/rebuild` (or `electron-rebuild`) as a devDependency.
- It builds `case-box-persistence` against Electron's Node ABI.
- It runs a smoke test that opens a SQLite DB in the packaged `.app`.
- It runs BEFORE case-box-aware screens (§6 row 5).

This separation is INTENTIONAL: it ensures the first UI WI ships even if native-module packaging is the harder problem; the user can authorize the packaging-smoke WI independently when ready.

## §7 Hard-stop inheritance

All 20 unresolved brief §20 STOP-AND-ASK items (per `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record") are inherited by reference without modification. Items SPECIFICALLY triggered by the IMPL WI (each requires explicit user authorization at impl-WI authorization):

1. **Brief §20 "New runtime dependencies (each individually)"** — 5 deps per §2 above (each individual).
2. **Brief §20 "Renderer UI framework choice"** — NOT triggered here because vanilla TS is used; the framework decision is a SEPARATE STOP-AND-ASK at substrate-decision §6 WI #2.
3. **Brief §20 "Code-signing identity + notarization profile"** — NOT triggered here because the WI ships unsigned dev-only `.app`.
4. **Brief §20 "Apple Developer ID acquisition"** — NOT triggered here for the same reason.
5. **Brief §20 "Mac App Store vs direct vs in-firm IT distribution"** — NOT triggered here (no distribution).
6. **Brief §20 "Public deployment / release / publication"** — NOT triggered (dev-only).

Items NOT triggered at all (all other 14 of the 20 unresolved §20 items):
- Auth provider, cloud vendor, external document exposure, mini-program publication, sync bridge enablement, LLM enablement, document text-extraction engine, secret material handling, per-document encryption-at-rest, hard-delete retention, tenant boundary widening, any external network surface beyond WI-03, real-data migration, monetization, redaction ADR.

## §8 Suggested follow-up WIs

Each requires SEPARATE explicit user authorization. This plan executes none.

| # | Suggested WI (impl OR plan as marked) | Closes / addresses | Risk | Predecessors |
|---|---|---|---|---|
| 1 | **Impl: the first-ui-shell WI** specified by THIS plan | substrate-decision §6 row 3 | Medium; **STOP-AND-ASK** on each of the 5 deps in §2 | THIS plan READY + user ratifies the dep set |
| 2 | Plan: renderer UI framework decision (React / Solid / Vue / Svelte / Lit) | substrate-decision §6 WI #2 | **STOP-AND-ASK** | None |
| 3 | Impl: native-module packaging smoke (Electron + `better-sqlite3` + OCR engine) per substrate-decision §6 row 4.5 | substrate-decision §6 row 4.5 + §7 row #7 | Medium | WI 1 above |
| 4 | Plan: case-box IPC contract (renderer ↔ main; narrow surface for `listMatters`, `getMatterSummary`, etc.) | substrate-decision §6 row 4 | Medium | WI 1 above + (renderer framework if §8 WI 2 lands) |
| 5 | Impl: case-box-aware screens (list matters; matter summary; etc.) | substrate-decision §6 row 5 | Medium | WIs 1 + 3 + 4 |
| 6 | Plan: lint rule for no-raw-color-literals | night-mode foundation §8 WI #4 | Low | WI 1 above |
| 7 | Plan: CI contrast check (computes ratios from token module + fails build below target) | night-mode foundation §8 WI #5 | Low; STOP-AND-ASK if new dep needed | WI 1 above |
| 8 | Plan: VoiceOver accessibility audit + manual test plan | night-mode foundation §8 WI #6 (implicit) | Low | WI 1 above |
| 9 | Plan: code-signing + notarization onboarding | substrate-decision §6 WI #6 | **STOP-AND-ASK** | brief §20 |
| 10 | Plan: distribution channel decision (Mac App Store / direct / in-firm IT) | substrate-decision §6 WI #7 | **STOP-AND-ASK** | brief §20 + WI 9 |

---

## §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to implement the first UI WI. | Header banner explicit "PLAN ONLY"; §"Exact acceptance criteria" split into "this plan-WI" vs "the IMPL WI when later authorized"; each dep in §2 flagged STOP-AND-ASK. |
| 2 | Medium | The 13-file impl scope is bigger than the absolute minimum (e.g., `resolveSystemMode.ts` could inline into `main.ts`). | Review question 2 invites pushback; user decides at impl-WI authorization whether to slim further. |
| 3 | Low | Playwright as a smoke-test dep is bigger than strictly necessary (e.g., a custom IPC-based smoke could work). | Review question 4 invites pushback; user decides. |
| 4 | Low | Manual no-color-literal audit may miss instances if `apps/` grows past the first WI. | §4 explicitly defers lint to a SEPARATE WI; first WI scope is small enough for manual grep. |
| 5 | **Medium** (raised from Low per rev-1 reviewer M D5#1) | Renderer-side TS without a bundler is impossible if `renderer/index.ts` has any `import` statement. The plan resolves this by requiring renderer/index.ts to have ZERO imports (per rev-1 reviewer M D3#1 fix); palette values live in `renderer/index.css` as CSS custom properties; main process handles theme via `src/theme/applyTheme.ts` and pushes resolved mode to renderer via IPC. Implementation must NOT add `import` to renderer/index.ts. Palette-sync test (§3.1) prevents drift between `src/theme/tokens.ts` and `renderer/index.css`. | Strict "no imports in renderer/index.ts" acceptance criterion at impl-WI authorization; palette-sync test enforced; if a future product-feature WI needs renderer-side imports, that WI also introduces a bundler (another STOP-AND-ASK). |
| 6 | Low | The 12 fixture panels show every token; this is intentionally verbose UI for a "compliance fixture", but reviewer may think it's product-shaped. | §"Exact target files" + impl README explicitly call this a TOKEN-COMPLIANCE FIXTURE, not product UI. |
| 7 | Low | Native-module packaging risk (§6) deferred to a separate WI; if the deferral order is wrong, case-box-aware screens could be blocked. | §8 row 3 sequences packaging-smoke BEFORE case-box screens (row 5); user authorizes individually. |

No Critical / High risks.

---

## §10 References

- `dev-memo/plan-ui-substrate-decision-00.md` (rev-3 RATIFIED at `35cd9b6`).
- `dev-memo/plan-night-mode-foundation-00.md` (READY at `7ad57ed`).
- `dev-memo/plan-client-00.md` §4.1.
- `docs/product/project-requirements-brief.md` (READY revision 5) §4, §20.
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #3, gate #4.
- `AGENTS.md` §"Repo Brief" (Node 22+ ABI pinning).
- `.claude/rules/autonomy.md` §"Hard-stop list".

---

## §11 Stop condition

This plan is stale or superseded when:
- The user authorizes the impl WI (§8 row 1) — the plan becomes "promoted to impl WI; awaiting commit".
- The impl WI ships an `apps/lawbar-desktop/` — the plan becomes "superseded by `<impl WI commit hash>`".
- Substrate decision (`dev-memo/plan-ui-substrate-decision-00.md`) is amended in a way that invalidates the Electron baseline.
- Night-mode foundation is amended in a way that changes the token module shape, palettes, or System / Light / Dark behavior.
- Brief §3 or §4 is amended in a way that invalidates the Mac-desktop posture.
