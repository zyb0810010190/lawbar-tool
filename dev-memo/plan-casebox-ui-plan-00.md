# PLAN — `WI-casebox-ui-plan-00` (first case-box product UI)

**Status**: PLAN-ONLY rev-0.1 READY-with-Low (promoted from DRAFT-PENDING-REVIEW after `review-plan-mpo6fp6k-fi88em` returned `READY-with-Low (2 Lows)` with 0 Critical / 0 High / 0 Medium / 2 Low; both Lows applied inline before promotion). Full review chain: rev-0 → rev-0.1 driven by `review-plan-mpo5zby4-ccl8oi` (NEEDS-RECONCILIATION; 4 H + 5 M + 4 L); rev-0.1 promoted by `review-plan-mpo6fp6k-fi88em` (READY-with-Low; 2 L applied). See §17 for the per-finding disposition table.
**Date**: 2026-05-27.
**Author**: Claude Code at user direction (WI-casebox-ui-plan-00 lane).
**Branch**: main.
**Lane**: plan-only first case-box product UI planning (renderer-side; sits atop the just-shipped case-box IPC surface).

**Parent references**:

- `dev-memo/plan-casebox-ipc-impl-01.md` rev-0.3 READY-with-Low at `9b440dc` — the IPC impl plan. SUPERSEDES nothing here; this UI plan **consumes** the existing IPC surface (5 channels) without changing it.
- IPC impl commit `e490686` — 5 v1 channels live, in-memory backing, contextBridge surface `window.lawbar.caseBox.*`, error envelope, safe-message allowlist, renderer-import lint, no-real-data scanner.
- `dev-memo/plan-case-box-ipc-contract-00.md` rev-3 READY at `9f9f79b` — IPC contract (UNCHANGED; UI consumes it).
- `dev-memo/plan-first-ui-shell-00.md` rev-2 READY — the existing renderer is a **12-panel theme-token fixture**, NOT product UI. This UI WI replaces the fixture with the first product screens while preserving the theme-token foundation.
- `dev-memo/plan-night-mode-foundation-00.md` — 12 tokens; no-hard-coded-color rule; palette-sync test (`renderer/index.css` ↔ `src/theme/tokens.ts` byte-equal).
- `dev-memo/plan-client-00.md` §4.1 — Mac desktop, in-process embedding, local-first.
- `docs/product/project-requirements-brief.md` status `READY` (revision 5) — v1 = Mac desktop, single lawyer, local-first, two workflow categories (`litigation` + `counsel` mapping to schema `litigation` + `advisory`), no real auth provider, no real legal data v1.
- WI-tarball-poc-impl commit `e61d7d9` — case-box-* installable via `dist-tarballs/*.tgz`.
- WI-pkg-verify-detection-impl commit `017c560` — fail-closed crash-detection wrapper at `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`.

This plan does NOT implement anything. It produces the blueprint for a future `WI-casebox-ui-impl` impl WI. The impl WI itself is a SEPARATE later authorization.

---

## Review packet (compact)

### Active plan summary

Promote the renderer from token-fixture to FIRST case-box product UI. The product UI exercises the existing 5 v1 IPC channels (`casebox:matter:create`, `:get`, `:list`, `:archive`, `casebox:audit:chainHead`) end-to-end through `window.lawbar.caseBox.*`. The v1 UI flow is:

1. **List matters** (active + archived; small page; cursor-paginated).
2. **Create matter** (form: `matter_type` constrained to `litigation` | `advisory`; required `name` / `jurisdiction.value` / ≥1 `parties[]` / `confidentiality_class`; optional free-text fields).
3. **View matter** (read-only matter detail; shows audit chain head if requested).
4. **Archive matter** (action with required `reason`; navigates back to list).

Backing remains **in-memory only** (per IPC impl rev-0.3 H3). No SQLite. No real legal data. No new dependencies. Theme-token foundation preserved. Renderer-import lint preserved. No-real-data scanner preserved. The packaged renderer→main wrapper test path remains the load-bearing integration gate.

### Exact target files (THIS plan-WI's own commit)

CREATED (single file):

- `dev-memo/plan-casebox-ui-plan-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:

- ANY `apps/lawbar-desktop/**` source, renderer, electron, test, or script file.
- ANY `package.json`.
- ANY `node_modules/`, `dist/`, `dist-tarballs/`.
- ANY `dev-memo/plan-casebox-ipc-impl-*.md` (the IPC plan stays at rev-0.3 READY-with-Low; this plan layers on top).
- ANY `dev-memo/plan-first-ui-shell-*.md` / `plan-night-mode-foundation-*.md` (theme + shell remain READY).
- ANY `docs/contracts/case-box-contract/**` (schemas + validators UNCHANGED).
- ANY `services/case-box-persistence/**` (backing UNCHANGED).
- ANY `docs/adr/**`, `docs/release/**`, `docs/product/**`.
- AGENTS.md, CLAUDE.md, GEMINI.md.
- `.claude/rules/**`, `.claude/skills/**`.

### Exact target files for the IMPL WI (NOT created by THIS plan-WI's commit)

When the user later authorizes the impl WI, it creates/modifies only the files below. Every file is inside `apps/lawbar-desktop/`. No cross-package writes.

**NEW (impl WI)** — every file is inside `apps/lawbar-desktop/` EXCEPT the manual-evidence dev-memo (per High #4):

- `dev-memo/manual-evidence-casebox-ui-impl-XX.md` (~120 LOC; outside `apps/lawbar-desktop/` deliberately; per High #4 enumeration) — manual evidence file referenced by G-UI-24. Records: VoiceOver smoke walkthrough transcript, keyboard-only walkthrough trace, light + dark mode screenshots (referenced by path; PNG files placed at `dev-memo/manual-evidence-casebox-ui-impl-XX/<name>.png`), `npm run dev` console transcript showing no CSP violations. The `XX` placeholder is replaced with the next available 2-digit sequence at impl time (e.g. `00` if no prior file exists). This file is workflow/documentation; per `.claude/rules/staging-hygiene.md` it commits with the impl-WI's product code change.
- `apps/lawbar-desktop/renderer/router.ts` (~110 LOC) — tiny hash-route router (`#/matters`, `#/matters/new`, `#/matters/:id`, `#/matters/:id/archive`). Vanilla TS; no library; declares route handlers as map of path-pattern → render function. No `History.pushState`; hash routing only (Electron file:// + CSP `script-src 'self'` compatible).
- `apps/lawbar-desktop/renderer/api.ts` (~80 LOC) — thin typed wrapper around `window.lawbar.caseBox.*`. Returns `IpcEnvelope<T>` shaped values; surfaces the existing safe-message envelope unchanged to caller. No retry, no caching. Exports one function per channel.
- `apps/lawbar-desktop/renderer/types.ts` (~120 LOC) — RENDERER-LOCAL DTO and envelope type declarations. Mirrors `src/caseBox/dto.ts` field shapes for compile-time form-builder safety. **Renderer cannot `import` from `src/caseBox/dto.ts` per the renderer-import lint** (`FORBIDDEN_RELATIVE_RESOLVED_PREFIX` includes `src/caseBox`), so the renderer holds its own copy of the type shapes. Drift is caught by a sync test (§9.5). The renderer keeps DTO types **structural** (interfaces) plus inline `as const` arrays for field names used in form builders.
- `apps/lawbar-desktop/renderer/dom.ts` (~180 LOC) — DOM helpers: `el(tagName, attrs, children)`, `field(label, input)`, focus management (focus-trap inside dialogs/forms), keyboard handlers (Enter to submit, Esc to cancel), ARIA-attribute helpers. No DOM-purify needed (renderer never injects HTML strings; all user data set via `textContent`).
- `apps/lawbar-desktop/renderer/format.ts` (~80 LOC) — pure formatters: ISO date → display; ULID → short tag; enum value → human label (`litigation` → "Litigation matter"; `advisory` → "Counsel matter" per brief §7 vocabulary alignment); `confidentiality_class` enum → label; archive status pill.
- `apps/lawbar-desktop/renderer/screens/listMatters.ts` (~180 LOC) — list view. Tabs `active` / `archived`. Calls `api.listMatters({ status, limit, cursor })`. Renders a table (matter `name` / `matter_type` label / `confidentiality_class` / `created_at` / status pill). Pagination "Load more" button consumes the next cursor. Empty state copy explicit and dummy-data labelled. Error state shows the safe envelope's `message` (NOT raw `err.message` — renderer never sees raw).
- `apps/lawbar-desktop/renderer/screens/createMatter.ts` (~280 LOC) — create form. Field order: `name` → `matter_type` (radio: Litigation / Counsel) → `jurisdiction.value` (text input) + `jurisdiction.locked` (checkbox) → `parties[]` (repeatable rows: `role` / `display_name` / `party_kind` / `notes?`; minimum 1 row required, "Add party" button) → `confidentiality_class` (radio: Normal / Heightened / Sealed) → optional free-text fields (`retainer_scope`, `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text`). Submit button calls `api.createMatter(...)`. On success: navigate to `#/matters/:id`. On error: display safe-envelope `message` inline at the first invalid field; preserve form state so the lawyer can edit + resubmit.
- `apps/lawbar-desktop/renderer/screens/viewMatter.ts` (~180 LOC) — read-only matter detail. Calls `api.getMatter({ matterId })`. If status === `active`, show an "Archive…" button → navigates to `#/matters/:id/archive`. Show a "Show audit chain head" `<details><summary>` toggle that calls `api.chainHead({ matterId })` on click (lazy; not auto-loaded). Shows ULID short tag (first 8 chars) + full ULID under disclosure. Audit chain head display: `headHash` (`AuditEventHash | null`; rendered per §6.5 hash-truncation rule `first 8 chars + "..." + last 8 chars` when present; full hash inside the `<details>` body; "No audit events recorded yet." copy when `count === 0` or `headHash === null`) + `lastEventId` (ULID short tag + full disclosure) + `count` (integer). Per H2 + L1 reconciliation.
- `apps/lawbar-desktop/renderer/screens/archiveMatter.ts` (~140 LOC) — archive confirmation screen. Shows matter name + a required `reason` textarea (≥10 chars, ≤500 chars renderer-side guard; main-side validation is authoritative). "Archive" button calls `api.archiveMatter({ matterId, reason })`. On success: navigate to `#/matters/:id` (now archived). Cancel returns to `#/matters/:id`.
- `apps/lawbar-desktop/tests/renderer-dto-sync.test.mjs` (~120 LOC) — pure-Node test. Parses `renderer/types.ts` and `src/caseBox/dto.ts` via `node:fs` + a small regex extractor (no TS compiler API needed because both files are well-formed and the test parses only the exported `as const` field arrays + interface field lists). Asserts: (a) every required DTO field name in `src/caseBox/dto.ts` appears in `renderer/types.ts`; (b) every renderer-side field name is also in the canonical DTO; (c) field-name SETS match exactly (no renderer-side typo possible). FAILS the build if drift exists.
- `apps/lawbar-desktop/tests/renderer-no-hardcoded-color.test.mjs` (~80 LOC) — pure-Node test extending the existing palette-sync rule. Scans every `renderer/**/*.ts` file + `renderer/**/*.css` file for raw color literals (`#RRGGBB`, `#RGB`, `rgb(...)`, `rgba(...)`, `hsl(...)`, named CSS colors via a small allowlist set). Exempt: `renderer/index.css` (canonical CSS-custom-property declarations) and `src/theme/tokens.ts` (canonical hex source). FAILS the build on any other occurrence. (The lint complements the existing `tests/main.test.mjs` palette-sync test, which only verifies that the existing two files stay byte-equal.)
- `apps/lawbar-desktop/tests/renderer-router.test.mjs` (~120 LOC; pure-Node; per High #4 enumeration) — unit tests for the hash router. Covers route-parsing table (4 routes), 404 view name, malformed ULID `:id` → 404, navigation simulation. Specified in §9.3.
- `apps/lawbar-desktop/tests/casebox-ui.electron.test.mjs` (~360 LOC) — packaged renderer→main round-trip product-UI test under the WI-2 wrapper. Adapts the existing `tests/casebox-ipc.electron.test.mjs` shape. Launches packaged Electron with `--user-data-dir=${tempRoot}`. Uses Playwright `page.click`, `page.fill`, `page.locator`, `page.waitForSelector` to drive the actual product UI (NOT `page.evaluate(window.lawbar.caseBox.*)` directly). Drives the full v1 flow: load `#/matters` empty → click "New matter" → fill form → submit → assert navigation to `#/matters/:id` and matter detail rendered → click "Archive…" → fill reason → submit → assert matter now shows archived → click "Show audit chain head" `<details>` → assert `count >= 1` integer rendered and `headHash` text-only visible (truncated per §6.5 rule `first 8 + "..." + last 8`). Per H2 reconciliation, the assertions read the canonical `AuditChainHead` fields (`headHash`, `lastEventId`, `count`). Pre/post no-DB-file scan across both `${tempRoot}` and the repo working tree (6-glob set per IPC impl §15.3). Crash count unchanged.

**MODIFIED (impl WI)**:

- `apps/lawbar-desktop/renderer/index.html` — replaces the 12-panel fixture markup. Becomes a router shell: `<main id="app"></main>` plus a screen-reader-only live region for status announcements (`<div role="status" aria-live="polite" id="sr-announce" class="visually-hidden"></div>`). CSP unchanged (`default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`). LOC delta: ~-3 / +6.
- `apps/lawbar-desktop/renderer/index.ts` — replaces the 12-panel render with router bootstrap. Imports renderer-internal modules ONLY (`./router.js`, `./screens/*.js`, `./api.js`, etc.). The "ZERO imports" rule from `plan-first-ui-shell-00.md` §1 rev-2 was specific to the fixture renderer's single-file shape — it is **explicitly relaxed for renderer-internal imports** here because (a) renderer-internal relative imports compile to ESM `import` statements that resolve under `file://` ESM module loading; (b) the renderer-import lint already permits renderer-internal resolved paths (forbidden prefixes are `src/caseBox`, `electron`, `services/case-box-persistence/src` — all OUTSIDE `renderer/`); (c) CSP `script-src 'self'` allows same-origin ESM imports. The relaxation does NOT permit imports of `electron`, `case-box-persistence`, `node:*`, `src/caseBox/**`, or other forbidden paths — the lint catches those. LOC delta: rewrite ~112 → ~80 (router bootstrap is small; per-screen render lives in `screens/`).
- `apps/lawbar-desktop/renderer/index.css` — additive layout rules (`.app-header`, `.app-nav`, `.matter-list`, `.matter-row`, `.matter-form`, `.field`, `.field--error`, `.button`, `.button--primary`, `.button--danger`, `.dialog`, `.visually-hidden`, `.audit-chain-head` etc.). All colors via `var(--color-*)`; no hex / rgb / named. LOC delta: +~180. Palette-sync test (`tests/main.test.mjs` test 6) UNCHANGED — still verifies `:root` and `:root[data-theme="dark"]` blocks byte-equal `LIGHT_TOKENS` / `DARK_TOKENS`.
- `apps/lawbar-desktop/package.json` — `pretest` chain extended to also run the new renderer-color lint. New scripts: `test:ui-shape-sync` (runs `renderer-dto-sync.test.mjs`), `test:ui-color` (runs `renderer-no-hardcoded-color.test.mjs`), `test:ui-router` (runs `renderer-router.test.mjs`; per Medium #1), `test:ui-packaged` (`LAWBAR_TEST_FILES=tests/casebox-ui.electron.test.mjs node scripts/test-packaged-wrapper.mjs`). The default `test` script is extended to include `tests/renderer-router.test.mjs`, `tests/renderer-dto-sync.test.mjs`, and `tests/renderer-no-hardcoded-color.test.mjs` in its node-test file list (so `npm test` exercises the new unit tests). No new dependencies. No `electron-builder` change.

**NOT touched (re-affirmed)**:

- `apps/lawbar-desktop/electron/main.ts` — UNCHANGED. The 5 IPC handlers already register at end of `app.whenReady`; the lazy-singleton + `before-quit` close path is canonical.
- `apps/lawbar-desktop/electron/preload.mts` — UNCHANGED. Exposed surface (`window.lawbar.theme.*` + `window.lawbar.caseBox.*`) is final for v1.
- `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — UNCHANGED. Thin wiring stays.
- `apps/lawbar-desktop/src/caseBox/handlers.ts` — UNCHANGED. Pure handlers + validation pipeline locked.
- `apps/lawbar-desktop/src/caseBox/dto.ts` — UNCHANGED. Canonical DTO source; the renderer holds its own copy + sync-tested.
- `apps/lawbar-desktop/src/caseBox/errorMap.ts` — UNCHANGED. Safe-message allowlist is the authoritative envelope source.
- `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` — UNCHANGED. Lazy in-memory singleton.
- `apps/lawbar-desktop/src/caseBox/ulid.ts` — UNCHANGED.
- `apps/lawbar-desktop/src/security/activeTenant.ts` + `activeActor.ts` — UNCHANGED. v1 uses constants.
- `apps/lawbar-desktop/src/theme/**` — UNCHANGED. Token source of truth.
- `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` — UNCHANGED. The lint already covers renderer-side forbidden imports.
- `apps/lawbar-desktop/scripts/check-no-real-data.mjs` — **MODIFIED in this WI (per Medium #2 reconciliation)** by extending `SCOPE_HINTS` to also match `apps/lawbar-desktop/renderer/` paths. The current regex set is `[/casebox|case-box|caseBox/i]` (case-insensitive `casebox` substring) — paths like `apps/lawbar-desktop/renderer/screens/listMatters.ts` do NOT contain the substring `casebox` and are therefore out of scope today. The impl WI adds a SECOND regex `/apps\/lawbar-desktop\/renderer\//` to `SCOPE_HINTS` so every new renderer file is scanned. The change is additive (existing case-box scoping unchanged); LOC delta on the scanner: ~+3 lines (one regex entry + small comment). The scanner's `EXEMPT_PATHS` set still exempts the scanner itself and its self-test fixture.
- `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` — UNCHANGED. WI-2 wrapper handles the new packaged UI test.
- `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` — UNCHANGED. The new product-UI test is a SIBLING, not a replacement (different surface — direct IPC vs UI-driven IPC).
- `apps/lawbar-desktop/tests/smoke.electron.test.mjs` — **REPLACED in this WI** (per High #3 reconciliation). The current smoke asserts `title === "lawbar (token fixture)"` plus exactly 12 `article.panel` nodes plus theme-switch via `article.panel`. The impl WI removes the 12-panel fixture renderer, so the current smoke cannot pass. The smoke is therefore **rewritten in the same impl WI** to target the new product UI shell: assert `title === "lawbar"` (per `app.setName("lawbar")` in `electron/main.ts`); assert `<main id="app">` renders; assert `#/matters` route renders the empty active-list copy; assert the theme picker still flips `data-theme`. The 12-panel-token assertion migrates into `tests/main.test.mjs` palette-sync test 6 (already covers `:root` block byte-equality) PLUS a smaller renderer-internal assertion that `renderer/index.html` contains `<main id="app">`. The smoke remains a packaged Playwright Electron test under the existing `LAWBAR_MODE=dev` env. LOC delta on `smoke.electron.test.mjs`: rewrite ~120 → ~100 (smaller surface; one fewer paragraph of token assertions).
- `apps/lawbar-desktop/tests/tarball-poc.electron.test.mjs` — UNCHANGED.
- All other services, contracts, ADRs, dev-memos, rules, skills, hooks — UNCHANGED.

### Exact acceptance criteria

**For THIS plan-WI**:

1. Plan committed alone in a single commit (`dev-memo/plan-casebox-ui-plan-00.md` only).
2. §1 (scope + non-goals) enumerates the impl-WI's file set and the in-memory backing constraint.
3. §6 enumerates the UI flow + per-screen behavior.
4. §7 enumerates the form-validation, error-display, accessibility, and keyboard/focus rules.
5. §8 enumerates the theme-token preservation rule + how the renderer-color lint stays load-bearing.
6. §9 enumerates the test plan (renderer-internal unit, packaged renderer→main UI, no-DB-file scan, no-real-data scan, sync test, renderer-color lint, crash-count unchanged).
7. §10 enumerates acceptance gates G-UI-1 through G-UI-N as testable boolean exit conditions.
8. §11 enumerates STOP-AND-ASK items (each separately authorized).
9. §13 enumerates out-of-scope items (each clearly post-v1 or deferred).
10. cc-suite review-plan returns READY or READY-with-Low via Path 1 native `--background`; the 11-field cc-suite recording is captured in the eventual impl-WI commit message.

**For the IMPL WI (when later authorized; this plan does NOT execute)** — see §10 (G-UI-1 … G-UI-N). All must pass before commit.

### Exact out-of-scope list (FOR THE IMPL WI; NOT just this plan)

- **Any case-box-persistence schema or SQLite work.** v1 backing stays in-memory (`InMemoryCaseBoxPersistence`). No `case-box.db` file is created.
- **Any new IPC channel.** The 5 v1 channels are final for this WI. Adding a 6th channel is its own separately-authorized WI.
- **Any document, fact, evidence, deadline, docket-entry, classification, or privilege UI.** Brief §7 sub-entities marked `(v1)` for **eventual** day-one persistence are still POST-V1 for the UI surface. This WI ships matters only.
- **Any LLM / extractor surface in the UI.** Brief §12.
- **Any cloud, sync, network egress, WeChat mini-program seam, auth provider integration, signing, notarization, distribution channel, or telemetry.** Brief §3 / §4 / §5 / §6.
- **Any framework adoption.** Vanilla TS only. React / Vue / Solid / Svelte / lit / etc. are explicitly NOT introduced. Framework choice is `dev-memo/plan-ui-substrate-decision-00.md` §6 WI #2, a separate STOP-AND-ASK.
- **Any bundler adoption.** No esbuild / Vite / Rollup / Webpack. `tsc` per-file emit + Electron file:// ESM module resolution are sufficient for v1 scope.
- **Any new runtime dependency.** Brief §4 STOP-AND-ASK gate.
- **Any new devDependency.** No DOM-testing-library, no jsdom, no @testing-library/*. Existing Playwright Electron + node:test cover both unit + packaged scopes.
- **Any cross-matter UI** (aggregate dashboard, search across matters, global deadline view, etc.). v1 is single-matter-scoped within a flat list.
- **Any real legal data, real client names, real party names, real court names, real bar numbers, real case numbers in any test fixture, demo seed, or copy.** The no-real-data scanner catches the diff.
- **Any signed bundle, export, backup, restore, or migration UI.** Brief §9 export is post-v1; backup is "data directory snapshot via Time Machine".
- **Any custom NSToolbar / NSMenu / NSDock integration.** Default Electron chrome.
- **Any keyboard-shortcut surface beyond Enter-to-submit, Esc-to-cancel, Tab focus order, and standard Electron browser keys.** Global shortcut palette is post-v1.
- **Any drag-and-drop, clipboard, or file-picker surface.** No file ingestion in this WI.
- **Any high-contrast or accessibility mode beyond focus rings, semantic HTML, ARIA roles where needed, and the screen-reader live region for status updates.** Automated WCAG / aXe audit deferred per `plan-first-ui-shell-00.md` §3.
- **Any localization, i18n, or RTL support.** English-only v1 UI strings. (Brief is English-with-Chinese-vocab-mappings; UI copy is English; the underlying schema accepts Chinese characters in `name` / `parties[].display_name` etc., but UI labels and pickers remain English.)
- **Any `git push`** of the impl WI commit — that is a SEPARATE explicit authorization.

### Essential references (≤3 priority)

1. `dev-memo/plan-casebox-ipc-impl-01.md` rev-0.3 READY-with-Low — the IPC contract this UI consumes; defines the 5 channels, the safe-message allowlist, the in-memory backing, the renderer-import lint, the no-real-data scanner.
2. `docs/product/project-requirements-brief.md` revision 5 status `READY` — §3 (Mac primary), §6 (local-first default), §7 (matter-type vocabulary; v1 = `litigation` + `counsel`; create-time required fields), §11 (audit/privilege/confidentiality), §20 (STOP-AND-ASK list).
3. `dev-memo/plan-night-mode-foundation-00.md` + `plan-first-ui-shell-00.md` — 12-token foundation; no-hard-coded-color; palette-sync; renderer-side CSS custom properties as the only renderer palette source.

### Review questions (3-5; specific)

1. **Renderer module split**: this plan permits renderer-internal relative imports (`renderer/screens/*.ts` etc.) while keeping the existing `check-renderer-imports.mjs` ban on imports OUT of `renderer/` (no `src/caseBox`, `electron`, `node:*`, `case-box-persistence`, etc.). Does this relaxation introduce any CSP / file:// ESM / packaging risk the reviewer can name? If yes — list the exact path and the proposed mitigation.
2. **DTO drift**: the renderer holds its own copy of the DTO type shapes (because the renderer-import lint forbids importing from `src/caseBox/dto.ts`). A sync test (`tests/renderer-dto-sync.test.mjs`) catches field-name drift between the two files. Is the sync test's pure-regex parser robust enough, OR should it parse via the TS compiler API (like `check-renderer-imports.mjs` does)?
3. **Backing volatility UX**: v1 backing is in-memory. App relaunch drops every matter. Should the UI surface this fact explicitly (banner / first-load tooltip / empty-state message), and if so — what is the exact wording that avoids implying SQLite work is queued?
4. **Audit chain head display**: §6.3 makes `chainHead` a lazy/click-to-load UI element on the view-matter screen. Is that the right UX, or should the head be shown auto-loaded under matter detail (richer UX) — and if auto-loaded, does that risk leaking chain-head implementation detail into routine view-matter cost (extra IPC call per page-load)?
5. **No-DB-file scan + no-real-data scan in the UI test path**: the existing scanners already cover the diff + the packaged temp root. The new packaged UI test (`casebox-ui.electron.test.mjs`) inherits both. Is the inherited coverage sufficient, or does the reviewer want an extra explicit assertion (e.g., "after every UI action, both scans pass") in the test body?

---

## §1 — Scope + non-goals

### In scope (plan-only)

- An implementation blueprint for the first case-box product UI.
- Renderer transitions from 12-panel theme-token fixture to a 4-screen product UI driven by the existing IPC surface.
- v1 UI is matter-only (per brief §7 `litigation` + `counsel`); sub-entities are POST-V1 UI.
- In-memory backing posture inherited from IPC impl rev-0.3 H3; no SQLite work.
- Theme-token + no-hard-coded-color preservation rules carried forward and extended with a renderer-side lint.
- Test strategy across unit (renderer-internal shape, DTO sync, color lint) + packaged renderer→main (Playwright Electron UI flow under WI-2 wrapper).
- Acceptance gates `G-UI-1` through `G-UI-N` as testable boolean exit conditions for the impl WI.
- STOP-AND-ASK items the impl WI's authorization MUST address.

### Out of scope (deferred or forbidden by user authorization for THIS plan-WI)

- Any code implementation.
- Any package.json mutation (the impl WI may extend `pretest` + add `test:ui-*` scripts; THIS plan-WI's commit changes no scripts).
- Any new runtime or devDependency.
- Any SQLite, real-data, real-legal-data, signing, notarization, distribution, telemetry, cloud sync, auth provider, or LLM surface.
- Any framework, bundler, CSS preprocessor, or test runner adoption.
- Any `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash-dialog suppression.
- Any cross-matter or document UI surface.
- Any push.

---

## §2 — Existing context used

- `dev-memo/plan-casebox-ipc-impl-01.md` rev-0.3 READY-with-Low at `9b440dc` — IPC plan. §6 (file enumeration), §7 (channels + DTOs), §8 (in-memory backing), §9 (validation pipeline + envelope), §12 (renderer-side prohibitions), §14 (test strategy), §15 (no-DB-file + no-real-data scanners), §17 (STOP-AND-ASK list).
- IPC impl commit `e490686` — verified-shipped surface; the renderer can now invoke `window.lawbar.caseBox.{createMatter,getMatter,listMatters,archiveMatter,chainHead}` and receive `IpcEnvelope<T>`.
- `apps/lawbar-desktop/electron/preload.mts` — final v1 contextBridge surface (50 LOC).
- `apps/lawbar-desktop/src/caseBox/dto.ts` — final v1 DTO shapes + `as const` field arrays (138 LOC).
- `apps/lawbar-desktop/src/caseBox/errorMap.ts` — final v1 safe-message allowlist (63 LOC).
- `apps/lawbar-desktop/renderer/index.ts` — current 12-panel fixture (112 LOC); replaced by router bootstrap.
- `apps/lawbar-desktop/renderer/index.css` — current 12-panel CSS + canonical `:root` token declarations (132 LOC); extended additively.
- `apps/lawbar-desktop/renderer/index.html` — current minimal shell (15 LOC); replaced shell stays minimal.
- `apps/lawbar-desktop/tests/main.test.mjs` — current palette-sync + productName + theme-pref tests (313 LOC); UNCHANGED.
- `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` — final v1 renderer-import lint; covers 5 import forms × multiple forbidden specifier sets; renderer-internal relative imports already permitted.
- `apps/lawbar-desktop/scripts/check-no-real-data.mjs` — final v1 no-real-data scanner; scope filter matches `casebox|case-box|caseBox`.
- `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` — WI-2 crash-detection wrapper; canonical packaged-test entry point.
- `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` — IPC packaged test pattern (page.evaluate via `window.lawbar.caseBox.*`); the UI test adopts the same launchPackaged + temp-root + no-DB-file scan pattern but drives the IPC through clicks/forms instead of `page.evaluate`.
- `docs/product/project-requirements-brief.md` revision 5 — §7 v1 matter-type vocabulary, §11 audit/privilege, §17 form-input rules (`name` ≤200 chars; `jurisdiction.value` non-empty; `parties[]` ≥1 with `role` + `display_name` non-empty; `confidentiality_class` ∈ {normal, heightened, sealed}).
- `.claude/rules/cc-suite.md` §"High-risk WIs" — UI on a security-boundary IPC surface IS high-risk; cc-suite review-plan + audit + verify chain REQUIRED for impl.
- `.claude/rules/security-boundary.md` §"In-scope work" — UI calls into IPC handlers that ARE security-boundary code; the cc-suite audit MUST inspect for: unintended renderer authority escalation, raw err.message leakage past the safe-message allowlist, tenant-mismatch defense bypass via UI-supplied fields, forbidden-field injection via form data.
- `.claude/rules/client-local-first.md` — Mac desktop, local-only default. UI must not introduce network, cloud, or sync surfaces.
- `.claude/rules/autonomy.md` §"Hard-stop list" — UI work itself does not trigger a hard-stop, but the impl WI inherits the broader hard-stops (no push, no auth provider, no real data, no irreversible migrations, no new deps).
- `.claude/rules/loc-guardian.md` — UI files keep individual files under fail threshold (800 LOC pure source; 1200 LOC test). The largest planned file is `screens/createMatter.ts` at ~280 LOC.

---

## §3 — What this UI WI inherits and what it does NOT change

| Aspect | Already shipped (IPC impl `e490686`) | UI WI behavior |
|---|---|---|
| Channels | 5: `casebox:matter:{create,get,list,archive}` + `casebox:audit:chainHead` | Consumes via `window.lawbar.caseBox.*`. Adds zero channels. |
| Backing | `InMemoryCaseBoxPersistence` (lazy singleton) | UNCHANGED. UI surfaces the volatility implication (§7.4). |
| DTO shapes | Defined in `src/caseBox/dto.ts` + frozen field arrays | UNCHANGED. Renderer holds parallel type shapes; sync-tested (§9.5). |
| Server-authority injection | Main injects `id` / `tenant_id` / `actor_user_id` / `created_at` / opt-in booleans | UNCHANGED. UI MUST NOT include any forbidden field in form submissions. The renderer's `api.ts` strips any field outside the DTO whitelist before invoking IPC (defense-in-depth; main also rejects, but stripping at the boundary avoids 1-trip-to-main on a typo). |
| Validation pipeline | Shape guard → forbidden+unknown field scan → bounds → schema → persistence → wrap | UNCHANGED. UI displays the safe-envelope `message` on rejection. |
| Error envelope | `IpcErrorEnvelope { kind, code, message, details? }` with safe-messages | UNCHANGED. UI consumes `message` as the only renderer-visible string. NEVER calls `err.message`. NEVER inspects `error.details.schemaPath` for user display (debug-only). |
| Tenant isolation | Defense-in-depth via pre-call `persistence.getMatter()` for archive/chainHead | UNCHANGED. UI cannot influence tenant; tenant constant `"default-tenant"`. |
| Test wrapper | WI-2 crash-detection wrapper (`scripts/test-packaged-wrapper.mjs`); packaged test entrypoint | UNCHANGED. New `casebox-ui.electron.test.mjs` runs under the same wrapper. |
| Renderer-import lint | `check-renderer-imports.mjs` covers 5 import forms × forbidden specifiers | UNCHANGED. UI files are inside `renderer/`; the lint already scans them. |
| No-real-data scanner | `check-no-real-data.mjs` scans staged + unstaged + untracked files matching `casebox|case-box|caseBox` | **EXTENDED in this WI** (Medium #2 fix): adds a second regex `/apps\/lawbar-desktop\/renderer\//` to `SCOPE_HINTS` so renderer paths without the `casebox` substring (e.g. `renderer/screens/listMatters.ts`) are also scanned. |
| Theme tokens | 12 tokens; `LIGHT_TOKENS` + `DARK_TOKENS` in `src/theme/tokens.ts`; CSS custom properties in `renderer/index.css` | UNCHANGED. UI adds layout CSS but every color is `var(--color-*)`. |
| Palette sync test | `tests/main.test.mjs` test 6 verifies `renderer/index.css` `:root` blocks byte-equal `LIGHT_TOKENS` / `DARK_TOKENS` | UNCHANGED. UI adds CSS rules but does NOT touch `:root` or `:root[data-theme="dark"]` blocks. |
| FileVault gate | Production launches require FileVault enabled (`probeFileVault` at app.whenReady) | UNCHANGED. UI cannot influence this. |
| Crash detection | WI-2 wrapper's crash-count snapshot pre/post test run | UNCHANGED. UI impl MUST not introduce a new crash class; the wrapper catches it if it does. |

---

## §4 — v1 UI scope cut

Brief §7 names two v1 matter categories (`litigation` + `counsel`) with rich sub-entities (claims, defenses, evidence, deadlines, etc.). The IPC surface today exposes only matter create/get/list/archive + audit chainHead. **The v1 UI is therefore matter-only**: sub-entity UIs are POST-V1, gated by future per-entity IPC channels (each its own STOP-AND-ASK + plan-review + audit cycle).

**Inside scope**:

| Surface | Why in v1 |
|---|---|
| List matters (active + archived, paginated) | Exercises `casebox:matter:list` pagination + status-filter. Proves the renderer can render a multi-row response and consume cursors. |
| Create matter form | Exercises `casebox:matter:create` end-to-end including 5 required fields + 5 optional free-text + repeatable `parties[]` array. Largest renderer surface in v1; exposes form-validation + error-display patterns reusable for future entities. |
| View matter (read-only) | Exercises `casebox:matter:get`. Tests the `null`-return path (matter not found). |
| Archive matter | Exercises `casebox:matter:archive` state-transition. Tests reversible-archive boundary (matter still readable post-archive; status pill changes). |
| Audit chain head (lazy display) | Exercises `casebox:audit:chainHead`. Confirms audit-chain integrity is observable from the UI without exposing raw chain bytes. |

**Outside scope** (each its own future WI):

- Document upload / view / OCR / page-by-page review.
- Fact extraction / review / acceptance (manual entry v1; LLM POST-V1).
- Evidence list / tagging.
- Deadline list / overdue banner.
- Privilege markers / confidentiality reclassification.
- Cross-matter search / dashboard.
- Settings / preferences UI (theme picker stays in the existing header but is the only "settings" surface).

---

## §5 — Renderer module layout + ZERO-imports relaxation rationale

The existing `renderer/index.ts` is single-file with `export {}` and zero `import` statements (per `plan-first-ui-shell-00.md` §1 rev-2 fix M D3#1). That rule existed for the **token-fixture renderer**: a 100-LOC file that read tokens via CSS custom properties and rendered 12 panels. Splitting it would have been over-engineering for that scope.

The product UI is materially different: 4 screens, a router, a form-builder, IPC wrappers, formatters, DOM helpers. Keeping all of that in `renderer/index.ts` would push the single file beyond the LOC fail threshold (800) and make the renderer-import lint unable to give per-screen diagnostics.

**Decision**: relax the "ZERO imports" rule to permit **renderer-internal relative imports only**. The relaxation:

- Permits: `renderer/index.ts` importing `./router.js`, `./screens/listMatters.js`, etc.
- Permits: `renderer/screens/listMatters.ts` importing `../api.js`, `../format.js`, etc.
- DOES NOT permit: any import OUT of `renderer/`. The renderer-import lint (`check-renderer-imports.mjs`) already enforces this with `FORBIDDEN_RELATIVE_RESOLVED_PREFIX = [src/caseBox, electron, services/case-box-persistence/src]` plus the package allowlist. **The lint is the authority; this plan does not change it.**

**Why this is safe**:

1. **CSP**: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` — same-origin `file://` ESM imports satisfy `'self'`.
2. **File:// ESM**: Electron's renderer Chromium resolves `import "./screens/createMatter.js"` to a sibling file under the same `dist/renderer/` directory. `tsc` emits per-file `.js` with explicit `.js` extension in imports (NodeNext requirement) — Chromium follows the explicit extension.
3. **No bundler needed**: Chromium's native ESM module loader handles the static import graph at page load. Performance is acceptable for v1 (≤10 small files; cold parse ~tens of ms).
4. **Lint coverage**: `check-renderer-imports.mjs` collects all `.ts` files in `renderer/` (recursively, per `collectFiles`), checks each import declaration / export-from / side-effect / dynamic / non-type-only against the forbidden lists. Renderer-internal imports resolve to paths INSIDE `renderer/`, outside every forbidden prefix → pass.
5. **No exfiltration risk**: the renderer cannot reach `src/caseBox`, `electron`, `node:*`, `case-box-persistence` because those paths fail `classify`. A renderer-internal import that accidentally points to `../src/caseBox/dto.js` would resolve to `src/caseBox/dto.ts` and trip the `relative-internal-forbidden` rule → lint fails → CI blocks → no silent regression.

**Risk mitigation**: the renderer-import lint runs as part of `pretest` (already wired). Any future contributor adding a forbidden import is blocked at lint, not at runtime.

---

## §6 — UI flow per screen

All screens render into `<main id="app">` via the router. Each screen exports `async render(params): Promise<void>`.

### §6.1 List matters (`#/matters`)

**Render**:

- Header: app title "lawbar — case-box" + theme picker (existing System/Light/Dark buttons preserved).
- Sub-header: status tabs `Active` / `Archived` (default `Active`). Tab change re-renders with new `status` parameter.
- Action button: `+ New matter` → navigates to `#/matters/new`.
- Body: matter table OR empty-state copy OR error message.
  - Table columns: `Name` (clickable; navigates to `#/matters/:id`) / `Matter type` (label via `format.matterTypeLabel`) / `Confidentiality` / `Created` / `Status` (pill: Active / Archived).
  - Empty state (active): "No matters yet. Click **New matter** to create the first one. Data is held in memory only — relaunching the app clears it." (Brief §7 + IPC impl rev-0.3 H3 backing volatility surfaced explicitly per §7.4.)
  - Empty state (archived): "No archived matters."
  - Error state: shows safe-envelope `message` inline.
- Pagination: `Load more` button when cursor present; clicking calls `listMatters({ status, cursor: next, limit: PAGE_SIZE })` and appends rows.

**IPC**:

```
const env = await api.listMatters({ status: "active" | "archived", limit: PAGE_SIZE, cursor: nextCursor });
if (!env.ok) renderError(env.error.message);
else renderRows(env.value.rows, env.value.next_cursor);
```

**ListMattersPage shape (canonical; per `services/case-box-persistence/src/types.ts` line 203)**: `{ readonly rows: ReadonlyArray<CaseBoxMatter>; readonly next_cursor: string | null; }`. UI MUST read `.rows` (NOT `.items`). The existing `tests/casebox-ipc.electron.test.mjs` already asserts `listRes.value.rows` — the UI test follows the same shape.

**Constants**: `PAGE_SIZE = 20` (well under `MAX_LIST_LIMIT = 200`).

### §6.2 Create matter (`#/matters/new`)

**Render**:

- Header: "New matter".
- Form (semantic `<form>` with `noValidate` because main does authoritative validation):

  | Field | Element | Required? | Notes |
  |---|---|---|---|
  | Name | `<input type="text" maxlength="200">` | yes | Trim on submit. |
  | Matter type | `<fieldset>` + 2 `<input type="radio">` | yes | Litigation / Counsel; maps to `litigation` / `advisory`. |
  | Jurisdiction value | `<input type="text">` | yes | Free text per schema. |
  | Jurisdiction locked | `<input type="checkbox">` | no | Default unchecked. |
  | Parties[] | repeatable rows | ≥1 row | Each row: `role` (text) / `display_name` (text) / `party_kind` (text) / `notes` (textarea). "Add party" / "Remove party" buttons. First row never removable. |
  | Confidentiality | `<fieldset>` + 3 `<input type="radio">` | yes | Normal / Heightened / Sealed; maps to `normal` / `heightened` / `sealed`. |

Parties[] repeatable behavior (per Low #4): "Add party" appends an empty row at the bottom with focus moved to the new row's first input. "Remove party" appears on every row EXCEPT the first; clicking it removes that row in place and preserves every remaining row's field values (no DOM rebuild; per-row identity is held by a small monotonic counter). Validation does NOT run on add/remove; it runs only on submit (per Medium #5). The first row never renders a Remove button.
  | Retainer scope | `<textarea>` | no | Optional. |
  | Case type text | `<input type="text">` | no | Optional. |
  | Case progress text | `<textarea>` | no | Optional. |
  | Court contact text | `<input type="text">` | no | Optional. |
  | Contention summary text | `<textarea>` | no | Optional. |

- Submit button: `Create matter`.
- Cancel button: returns to `#/matters`.
- Status region: `<div role="status" aria-live="polite">` for "Creating…" / "Error: <safe-message>" announcements.

**IPC**:

```
const dto = collectFormFields(formEl);  // strips empty optionals; never includes server-authority fields
const env = await api.createMatter(dto);
if (!env.ok) renderInlineError(env.error.message);
else navigate(`#/matters/${env.value.id}`);
```

**Defense-in-depth**: `api.createMatter` re-validates the keys of `dto` against `RENDERER_CREATE_MATTER_DTO_FIELDS` (the renderer-side allowlist) and drops any extra key with a console.warn. Main-side then enforces authoritatively.

### §6.3 View matter (`#/matters/:id`)

**Render**:

- Header: matter name + status pill.
- IPC: `api.getMatter({ matterId: id })`.
- If envelope error → render error message.
- If `env.value === null` → "Matter not found. It may have been created in a previous session (data is in-memory only)." + link to `#/matters`.
- Else render detail card:
  - `Name` / `Matter type label` / `Jurisdiction` (`value` + locked indicator) / `Confidentiality` / `Created at` (formatted ISO) / `Status`.
  - Optional free-text fields rendered only when non-empty.
  - Parties list (read-only).
  - If `status === "active"`: `Archive…` button → navigates to `#/matters/:id/archive`.
  - If `status === "archived"`: `archived_at` timestamp (rendered with the §6.5 date formatter) + a "Reason recorded in audit log" line. **The plan does NOT imply `archive_reason` is exposed on the matter row** — `CaseBoxMatter` returns `archived_at` (per existing schema) but the archive reason is captured by the audit-event payload, not the matter row. UI does NOT call any extra IPC to fetch the reason; the literal copy is fixed ("Reason recorded in audit log.") to make the absence explicit. If the contract is later extended to expose the reason on the matter row, a follow-up WI threads it through; this WI does NOT.
  - "Show audit chain head" disclosure (collapsed by default; uses native `<details><summary>` per Low #2). Click expands and lazily calls `api.chainHead({ matterId })`. Displays the canonical `AuditChainHead` shape (per `services/case-box-persistence/src/types.ts` line 70): `headHash` (`AuditEventHash | null`; rendered as text-only with a copy button — copy to clipboard via `navigator.clipboard.writeText` permitted by CSP; if `clipboard-write` permission unavailable, button is disabled with tooltip), `lastEventId` (`string | null`; ULID rendered short-tag + full-disclosure), `count` (`number`; rendered as integer). When `count === 0` (no events yet for the matter), the disclosure expands to copy "No audit events recorded yet." without invoking any formatter that would crash on a `null` `headHash`.

### §6.4 Archive matter (`#/matters/:id/archive`)

**Render**:

- Header: "Archive matter — `<matter-name>`".
- Warning text: "Archiving moves the matter to the Archived tab. The matter remains readable. The action records an audit event."
- Form:
  - `Reason` `<textarea>` — required; renderer-side minimum length 10 chars, maximum 500 chars (client guard; main-side authoritative).
- Submit button: `Archive`.
- Cancel button: returns to `#/matters/:id`.

**IPC**:

```
const env = await api.archiveMatter({ matterId: id, reason });
if (!env.ok) renderInlineError(env.error.message);
else navigate(`#/matters/${id}`);  // viewMatter now shows archived status
```

### §6.5 Formatters (per Low #3 reconciliation)

- **ULID short tag**: first **8 characters** (Crockford base32 lowercase). Full ULID rendered inside a native `<details><summary>` disclosure (per Low #2).
- **Hash truncation (audit `headHash` display)**: `first 8 chars` + `"..."` + `last 8 chars` (e.g. `a1b2c3d4...e5f6a7b8`). Applied only to non-`null` `headHash`. The `<details>` disclosure body offers the full hash for copy. Per L1 reconciliation (rev-0.1 review-plan-mpo6fp6k-fi88em). All hash bytes rendered via `textContent` only; never as HTML.
- **Date format**: `YYYY-MM-DD HH:mm` in local time. ISO input → `new Date(iso)` → 5 string slots padded to widths (4, 2, 2, 2, 2) joined by `-` / space / `:`. No locale string; no relative time ("3 days ago"); no time-zone label.
- **Matter-type label**: `litigation` → "Litigation matter"; `advisory` → "Counsel matter" (per brief §7 vocabulary).
- **Confidentiality label**: `normal` → "Normal"; `heightened` → "Heightened"; `sealed` → "Sealed".
- **Status pill**: `<span class="status-pill status-pill--active">Active</span>` or `<span class="status-pill status-pill--archived">Archived</span>`. CSS rules use only `var(--color-*)` tokens.

---

## §7 — Renderer validation, error display, accessibility, keyboard/focus, no-real-data gates

### §7.1 Renderer-side validation (advisory; main is authoritative; **submit-time only**)

**When validation runs (per Medium #5 fix)**: renderer-side guards run **on form submit only** — never on blur, never on change. Reasons: (a) submit-time guards are deterministic and easy to test; (b) the guards are advisory (main is authoritative), so per-keystroke noise adds no real value; (c) blur-time validation would create user-visible flicker patterns that are out of scope for a v1 minimal UI. Two implementers would otherwise produce divergent behavior; the rule above closes that gap.


| Field | Renderer guard | Main authoritative source |
|---|---|---|
| `name` | non-empty after trim; ≤200 chars | `validateMatter` JSON Schema |
| `matter_type` | radio = one of `litigation`/`advisory` | enum check in `validateMatter` |
| `jurisdiction.value` | non-empty | schema |
| `jurisdiction.locked` | boolean | schema |
| `parties[]` | ≥1 row; each row's `role`/`display_name`/`party_kind` non-empty | schema |
| `confidentiality_class` | radio = one of `normal`/`heightened`/`sealed` | enum check |
| optional free-text fields | trim; drop empty strings before submit (do NOT send `""`) | schema accepts absence |
| `reason` (archive) | trim; ≥10 chars; ≤500 chars | main-side validation |

The renderer NEVER forwards a known-forbidden field (server-authority field). The `api.ts` wrapper explicitly whitelists keys against `RENDERER_CREATE_MATTER_DTO_FIELDS` before invoking IPC.

### §7.2 Error display

- **Envelope error**: every renderer rejection branch reads `env.error.message` only. NEVER `err.message` from a thrown Error. The safe-message allowlist (per IPC impl `errorMap.ts`) is the authoritative renderer-visible string source.
- **Inline display**: form errors render directly below the failing field group (or at the top of the form when the failure is global). The status `<div role="status" aria-live="polite">` announces the error to screen readers.
- **Focus**: on error, focus moves to the first invalid field (renderer-guard) OR the form's submit button (envelope error from main without a field hint).

### §7.3 Accessibility (a11y)

- Every `<input>` paired with a `<label>` (explicit `for=`/`id=` association, no implicit label nesting only).
- Radio groups inside `<fieldset>` + `<legend>`.
- Buttons use `<button type="button">` or `<button type="submit">` explicitly (never `<div onclick>`).
- Status region: `<div role="status" aria-live="polite">` for non-error announcements; `<div role="alert">` for error announcements when focus does not move (rare; default is move-focus).
- Color contrast: every text color × background color combination uses tokens that meet WCAG 2.2 AA (per `plan-night-mode-foundation-00.md` §6 hand-computed; the UI does NOT introduce new color pairings beyond what tokens.ts already guarantees).
- Tab order matches visual order (no `tabindex > 0`; only `tabindex="0"` for non-focusable elements that must be focusable, and `tabindex="-1"` for programmatically focusable).
- VoiceOver smoke test (manual; documented in impl-WI's manual evidence file): screen reader can navigate the list, fill the create form, submit, navigate to detail, archive.

### §7.4 Keyboard / focus

- Enter inside a form input submits the form (browser default; not prevented).
- Esc inside a form cancels (navigates back). Implemented via a top-level keydown listener registered per screen.
- Tab moves through fields in DOM order.
- Focus visible: existing `:focus-visible { outline: 2px solid var(--color-focus-ring); }` rule covers all interactive elements.
- Initial focus on screen entry:
  - List: skip to first matter row OR the `+ New matter` button.
  - Create: first field (`name`).
  - View: archive button if active OR back-to-list link if archived.
  - Archive: reason textarea.

### §7.5 In-memory backing volatility surfacing

Empty-state copy in the active list (§6.1) explicitly mentions "Data is held in memory only — relaunching the app clears it." This is a v1 transparency requirement (not a marketing tagline; not promising future SQLite). The wording is intentionally factual.

### §7.6 No-real-data gates

- All UI copy in `renderer/screens/*.ts` and `renderer/format.ts` uses synthetic placeholder text or empty strings. NO real lawyer/firm/case/court/party names anywhere.
- All test fixtures + manual-evidence transcripts use Crockford-base32 ULIDs + synthetic `matter-fixture-A` / `matter-fixture-B` names.
- The `check-no-real-data.mjs` scanner is extended in this WI (Medium #2 fix) so its `SCOPE_HINTS` also matches `apps/lawbar-desktop/renderer/` paths; the existing `casebox|case-box|caseBox` regex is retained. All new renderer files (including `renderer/screens/listMatters.ts` etc. whose paths do NOT contain `casebox`) are therefore in scope.
- The new packaged UI test pre/post-scans both the temp `--user-data-dir` root and the repo working tree for the 6-glob no-DB-file set (`*.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, `case-box.db*`).

---

## §8 — Theme-token preservation + extended renderer-color lint

### §8.1 Existing guarantees (carried forward UNCHANGED)

- `LIGHT_TOKENS` / `DARK_TOKENS` in `src/theme/tokens.ts` is the canonical hex source.
- `renderer/index.css` `:root` and `:root[data-theme="dark"]` blocks declare the same 12 hex values as CSS custom properties.
- `tests/main.test.mjs` test 6 (palette-sync) asserts byte-equality between the two sources.
- All renderer styling references `var(--color-<token>)`.

### §8.2 Why a new lint is needed

`tests/main.test.mjs` test 6 only checks the **canonical** `:root` blocks. It does NOT scan the rest of `renderer/index.css` or any new renderer `.ts` / `.css` for raw color literals. A contributor could write `color: #FF0000;` in a new CSS rule and it would pass test 6.

### §8.3 Specification of `tests/renderer-no-hardcoded-color.test.mjs`

Pure-Node test; runs under `pretest` (added to `package.json`).

**Scope**: every file under `renderer/` (recursively) matching `*.ts` OR `*.css`.

**Exemption is block-level, not file-level (per Medium #3 reconciliation)**:

- Inside `renderer/index.css`, the lint exempts ONLY the canonical `:root { ... }` and `:root[data-theme="dark"] { ... }` blocks (the two blocks already verified byte-equal by `tests/main.test.mjs` test 6). Raw color literals OUTSIDE those two blocks — anywhere else in `index.css` — are flagged.
- The lint identifies the canonical blocks by an exact pattern (whole-line match) for the opening selectors `:root {` and `:root[data-theme="dark"] {` and pairs them with the matching closing `}` via brace counting (the CSS is well-formed and the lint stops at the first unmatched `}` after the opener).
- All other `.css` files under `renderer/` (the impl WI does not add any, but the lint defends against future additions) are scanned with NO exempt blocks.
- All `.ts` files under `renderer/` are scanned with NO exempt blocks (the renderer must NEVER contain a raw color literal in TypeScript).

**Color literal patterns flagged**:

- `#[0-9A-Fa-f]{3,8}\b` (hex; 3, 4, 6, or 8 digits — covers `#FFF`, `#FFFF`, `#FFFFFF`, `#FFFFFFFF` cases).
- `\brgba?\s*\(` (rgb / rgba function calls).
- `\bhsla?\s*\(` (hsl / hsla).
- Named CSS colors (small allowlist of common offenders: `red`, `blue`, `green`, `black`, `white`, `transparent` — and `transparent` is explicitly PERMITTED).

**Permitted (NOT flagged)**:

- `var(--color-*)` — the canonical reference form.
- `currentColor` — inherits.
- `transparent` — fully transparent.
- `inherit` / `initial` / `unset` — keywords.
- Color literals inside comments (e.g. `/* #FF0000 was the old accent */`) — the lint strips comments before scanning.

**Failure shape**: file path + line + character + literal that triggered. Exit code 1 on any hit.

**Hand-edited exemption mechanism**: if a future legitimate use case needs a raw color (e.g. SVG `fill="#000"` for a static icon), the lint MAY support `/* lawbar-no-hardcoded-color: allow */` comment on the preceding line. This plan does NOT introduce such a need; the impl WI MUST NOT add the bypass mechanism unless an actual exempt case arises in the impl WI's own diff.

### §8.4 Why this matters

Without the new lint, the theme system regresses silently: a screen looks "right" because it happens to use the same color as a token, but the link is broken — the next palette tweak in `tokens.ts` does not propagate.

---

## §9 — Test strategy

All test commands stay under `apps/lawbar-desktop/`. Existing test names UNCHANGED. New test names:

| Test | File | Layer | What it asserts | Required to pass before commit? |
|---|---|---|---|---|
| Renderer-internal unit | `tests/renderer-router.test.mjs` (~120 LOC) | pure-Node | Router parses `#/matters` / `#/matters/new` / `#/matters/:id` / `#/matters/:id/archive`; unknown path renders 404 view; invalid `:id` (non-ULID) renders 404. | yes |
| DTO sync | `tests/renderer-dto-sync.test.mjs` (~120 LOC) | pure-Node | Renderer-side DTO field-name sets ⊆/⊇ canonical `src/caseBox/dto.ts` field-name sets for each of 5 channels. | yes |
| Renderer-color lint | `tests/renderer-no-hardcoded-color.test.mjs` (~80 LOC) | pure-Node | No raw color literal in renderer files outside `renderer/index.css` canonical block. | yes |
| Existing palette sync | `tests/main.test.mjs` test 6 | pure-Node | `:root` blocks byte-equal `LIGHT_TOKENS`/`DARK_TOKENS`. | yes (UNCHANGED) |
| Existing renderer-import lint | `scripts/check-renderer-imports.mjs` (`lint:renderer-imports`) | pure-Node | No forbidden import in `renderer/**/*.ts`. | yes (UNCHANGED) |
| Existing no-real-data scanner | `scripts/check-no-real-data.mjs` (`check:no-real-data`) | pure-Node | No real-legal markers in diff. | yes (UNCHANGED) |
| Existing IPC unit | `tests/ipc-handlers.unit.test.mjs` | pure-Node | IPC handlers behave correctly with mocked persistence. | yes (UNCHANGED) |
| Existing IPC contract | `tests/dto-contract.test.mjs` | pure-Node | DTO field allowlists match schema. | yes (UNCHANGED) |
| Packaged UI flow | `tests/casebox-ui.electron.test.mjs` (~360 LOC) | Playwright Electron under WI-2 wrapper | Drives the full v1 flow click-by-click; verifies envelope round-trip; pre/post no-DB-file scan; pre/post no-real-data scan via the existing scanner invocation; crash-count unchanged. | yes |
| Existing IPC packaged | `tests/casebox-ipc.electron.test.mjs` | Playwright Electron under WI-2 wrapper | Direct-IPC round-trip. | yes (UNCHANGED) |
| Existing tarball PoC | `tests/tarball-poc.electron.test.mjs` | Playwright Electron under WI-2 wrapper | Tarball install path. | yes (UNCHANGED) |
| Product-UI smoke (REWRITTEN) | `tests/smoke.electron.test.mjs` | Playwright Electron | Rewritten per High #3: assert title === "lawbar"; assert `<main id="app">` renders; assert empty `#/matters` route copy renders; assert theme picker still flips `data-theme`. Token-resolution coverage moves to `tests/main.test.mjs` test 6 (palette-sync UNCHANGED) PLUS a tiny HTML-shape check that `renderer/index.html` contains `<main id="app">`. | yes (REWRITTEN in same impl WI) |
| Existing wrapper tests | `tests/wrapper.test.mjs` + all `_wrapper-seeder-*.test.mjs` | varied | WI-2 wrapper crash-detection self-tests. | yes (UNCHANGED) |
| Existing main-process unit | `tests/main.test.mjs` | pure-Node | Theme-pref + resolveSystemMode + FileVault probe + productName + palette-sync. | yes (UNCHANGED) |

### §9.1 Why no jsdom / DOM-testing-library

- Renderer logic is screen-by-screen straightforward DOM construction. Most rendering is via `el(tag, attrs, children)` returning real DOM nodes wrapped around `document.createElement`. A jsdom unit test would mock the boundary that Playwright Electron tests for real, doubling maintenance.
- Playwright Electron tests run against the actual packaged renderer, catching the full ESM / CSP / file:// / contextBridge chain.
- Renderer-internal logic (router, formatters, validation helpers) is pure-function-shaped and unit-tested with `node:test` directly — these tests do not need a DOM at all because the helpers take plain inputs and return plain outputs.

### §9.2 What `tests/casebox-ui.electron.test.mjs` covers (per acceptance gate)

Listed in §10.

### §9.3 What `tests/renderer-router.test.mjs` covers

- Hash path → route-name + params extraction (table-driven).
- Unknown hash → 404 route name.
- Malformed `:id` → 404 route name. (`:id` must match `^[0-9a-z]{26}$` per IPC contract.)
- Round-trip: `navigate("#/matters/01abc...")` updates `location.hash` (using a `URL` mock since Node tests have no real `location`); router subscribers fire on `hashchange` (simulated).

### §9.4 What `tests/renderer-dto-sync.test.mjs` covers

Two parallel arrays per DTO:

- `renderer/types.ts` exports `as const` arrays: `RENDERER_CREATE_MATTER_DTO_FIELDS`, `RENDERER_GET_MATTER_DTO_FIELDS`, `RENDERER_LIST_MATTERS_DTO_FIELDS`, `RENDERER_ARCHIVE_MATTER_DTO_FIELDS`, `RENDERER_CHAIN_HEAD_DTO_FIELDS`.
- `src/caseBox/dto.ts` exports the canonical `CREATE_MATTER_DTO_FIELDS`, etc.

Test asserts: for each pair, `new Set(renderer) === new Set(canonical)` (extensional equality on Set).

**Parser robustness**: the test uses `node:fs` + a regex extractor that finds `export const NAME = Object.freeze([\n  "x",\n  ...\n] as const);` blocks. Reviewer Q2 in the review packet asks whether this should use TS compiler API instead. The plan's default position: regex is sufficient because both files are author-controlled and follow a strict format; if the format changes, the test fails loudly and gets fixed in the same WI. (Reviewer may override.)

### §9.5 What `tests/renderer-no-hardcoded-color.test.mjs` covers

Specified in §8.3.

### §9.6 Packaged-test no-DB + no-real-data assertion locations

In `tests/casebox-ui.electron.test.mjs`:

- **Before launch**: snapshot the temp `--user-data-dir` root (newly created — should be empty) and the repo working tree (should not contain any `case-box.db*` etc.).
- **After test body completes** (success or failure): re-snapshot both locations; assert no new DB-file matches.
- **After test body completes**: invoke `scripts/check-no-real-data.mjs` programmatically against the working tree; assert exit 0.

### §9.7 Crash-count invariant

Before launch and after teardown: read crash-count via the WI-2 wrapper's `getCrashCount()` helper (`scripts/test-packaged-wrapper.mjs` exports). Assert pre === post. (This is the same pattern `casebox-ipc.electron.test.mjs` uses.)

---

## §10 — Acceptance gates (G-UI-1 … G-UI-N)

Each is a testable boolean exit condition for the impl WI. All must pass before commit. `STATUS` column is `gate` (required) or `evidence` (manual / documentation).

| ID | What it asserts | How verified | Status |
|---|---|---|---|
| G-UI-1 | `npm --prefix apps/lawbar-desktop run build` exits 0. | Subprocess exit 0. | gate |
| G-UI-2 | `npm --prefix apps/lawbar-desktop run lint:renderer-imports` exits 0; no forbidden import in any renderer `.ts`. | Subprocess exit 0. | gate |
| G-UI-3 | `npm --prefix apps/lawbar-desktop run check:no-real-data` exits 0 against the impl diff. | Subprocess exit 0. | gate |
| G-UI-4 | `npm --prefix apps/lawbar-desktop run test:ui-shape-sync` exits 0; renderer DTO field sets match canonical. | Subprocess exit 0. | gate |
| G-UI-5 | `npm --prefix apps/lawbar-desktop run test:ui-color` exits 0. The lint applies **block-level** exemption (only the two canonical `:root { ... }` and `:root[data-theme="dark"] { ... }` blocks inside `renderer/index.css` are exempt); raw colors outside those blocks (anywhere else in any renderer `.css` or any renderer `.ts`) fail the gate. Per Medium #3 reconciliation. | Subprocess exit 0. | gate |
| G-UI-5a | `npm --prefix apps/lawbar-desktop run test:ui-router` exits 0; router parses all 4 routes; unknown / malformed-ULID paths yield the 404 view name. Per Medium #1 reconciliation. | Subprocess exit 0. | gate |
| G-UI-6 | Existing `palette-sync` test (`tests/main.test.mjs` test 6) passes; `renderer/index.css` `:root` blocks byte-equal `LIGHT_TOKENS`/`DARK_TOKENS`. | `node --test tests/main.test.mjs` exit 0. | gate |
| G-UI-7 | `npm --prefix apps/lawbar-desktop run test:ipc-unit` exits 0 (regression check). | Subprocess exit 0. | gate |
| G-UI-8 | `npm --prefix apps/lawbar-desktop run test:ipc-contract` exits 0 (regression check). | Subprocess exit 0. | gate |
| G-UI-9 | `npm --prefix apps/lawbar-desktop run test:ipc-packaged` exits 0 (regression check; existing direct-IPC packaged test still passes). | Subprocess exit 0. | gate |
| G-UI-10 | `npm --prefix apps/lawbar-desktop run test:ui-packaged` exits 0. The UI test drives the full create → view → archive → chainHead flow via Playwright clicks/fills (NOT page.evaluate). | Subprocess exit 0. | gate |
| G-UI-11 | Inside `casebox-ui.electron.test.mjs`: pre/post snapshot of `--user-data-dir` temp root AND repo working tree finds zero matches for `*.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, `case-box.db*`. | Assertion inside test. | gate |
| G-UI-12 | Inside `casebox-ui.electron.test.mjs`: programmatic invocation of `check-no-real-data.mjs` exits 0 after test body. | Assertion inside test. | gate |
| G-UI-13 | Inside `casebox-ui.electron.test.mjs`: WI-2 wrapper crash-count pre === post. | Assertion inside test. | gate |
| G-UI-14 | `npm --prefix apps/lawbar-desktop run test:tarball-poc` exits 0 (regression check; tarball install path unaffected). | Subprocess exit 0. | gate |
| G-UI-15 | `npm --prefix apps/lawbar-desktop test` exits 0 (full default test suite; covers all `node --test` tests). | Subprocess exit 0. | gate |
| G-UI-16 | All `services/**` and `docs/contracts/**` test commands still pass (no cross-package regression). | `npm --prefix docs/contracts test`, `npm --prefix docs/contracts/case-box-contract test`, `npm --prefix services/case-box-persistence test`, `npm --prefix services/ocr-persistence test`, `npm --prefix services/ocr-worker test`, `npm --prefix services/ocr-ingestion test`, `npm --prefix services/ocr-review test` — all exit 0. | gate |
| G-UI-17 | No new runtime or devDependency added. `package.json` `dependencies` + `devDependencies` byte-equal between pre-impl HEAD and post-impl HEAD (only `scripts` block changed). | `git diff HEAD~1 -- apps/lawbar-desktop/package.json` shows only `scripts` block changes. | gate |
| G-UI-18 | No SQLite path activated. `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` UNCHANGED; no `openSqliteCaseBoxPersistence` reference appears anywhere in the impl diff. | `git diff HEAD~1` content scan. | gate |
| G-UI-19 | `apps/lawbar-desktop/electron/main.ts` UNCHANGED (no new IPC registration; UI consumes only the 5 v1 channels). | `git diff HEAD~1 -- apps/lawbar-desktop/electron/main.ts` empty. | gate |
| G-UI-20 | `apps/lawbar-desktop/electron/preload.mts` UNCHANGED (no new contextBridge surface). | `git diff HEAD~1 -- apps/lawbar-desktop/electron/preload.mts` empty. | gate |
| G-UI-21 | `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` UNCHANGED. | `git diff HEAD~1` empty. | gate |
| G-UI-22 | `apps/lawbar-desktop/src/caseBox/*.ts` UNCHANGED. | `git diff HEAD~1` empty. | gate |
| G-UI-23 | `services/**` and `docs/contracts/**` UNCHANGED. | `git diff HEAD~1` empty for both directory trees. | gate |
| G-UI-24 | Manual evidence file at `dev-memo/manual-evidence-casebox-ui-impl-XX.md` records: VoiceOver smoke walkthrough (one screen of the create flow read aloud accurately); keyboard-only walkthrough (full v1 flow without mouse); screenshots of light + dark modes; copies of `npm run dev` console output showing no CSP violations and no `electron.security` warnings. | File present + content reviewed by user before promote. | evidence |
| G-UI-25 | cc-suite audit on impl scope returns CLEARED (0 Critical / 0 High / 0 Medium open). Audit MUST inspect: form-builder injection paths (do any DTO fields end up rendered as innerHTML?); error-display safe-message bypass paths (does any renderer code log `err.message` directly?); router parameter injection (can a crafted `#/matters/<evil>` route trigger a DOM XSS?); IPC envelope unwrapping (is `env.value.id` used only after `env.ok === true` check?); audit-chain head display (is the canonical `headHash` rendered as text only, never as HTML, per H2 reconciliation?). | cc-suite audit jobId in commit recording. | gate |
| G-UI-26 | cc-suite verify against the audit report returns ALL CLOSED. | cc-suite verify jobId in commit recording. | gate |
| G-UI-27 | LOC guardian: no hand-written source file in the impl WI exceeds 800 pure LOC; no test file exceeds 1200 raw LOC. The largest planned file (`screens/createMatter.ts` ~280 LOC) is well below threshold. | `/loc-guardian:scan` exit verdict before commit. | gate |
| G-UI-28 | Commit message carries the 11-field cc-suite recording (kind / scope / runner path / model / job IDs / threadId / output location / retrievable? / failure classification / retry attempts / fallback reason) per `.claude/rules/cc-suite.md` §"Required recording". | Commit message inspection. | gate |
| G-UI-29 | `.claude/scheduled_tasks.lock` remains untracked / gitignored; not staged in the impl commit. | `git ls-files --error-unmatch` fails with "did not match". | gate |
| G-UI-30 | Working tree clean after commit; no untracked clutter from the impl pass. | `git status --short` empty (or only contains the still-gitignored lock file). | gate |

**Rationale for the gate count**: 31 gates (G-UI-1 through G-UI-30 + G-UI-5a inserted between G-UI-5 and G-UI-6 per Medium #1 reconciliation; per L2 reconciliation the count is corrected from the rev-0.1 stale "30"). Parallels the IPC impl's 24 G-IPC-* gates plus 7 UI-specific additions (theme-token preservation, sync test, color lint, router robustness, accessibility evidence, no-renderer-bundler, router-test enforcement). Lower gate counts risk under-specifying the boundary; higher counts risk gate-noise. 31 is the smallest set that covers every load-bearing axis for this WI's risk surface. The `5a` suffix is intentional — renumbering the entire table to G-UI-31 would break the sectional clustering (G-UI-5 + G-UI-5a are both color/router lint gates and grouped together).

---

## §11 — Decisions captured in this plan + STOP-AND-ASK items the impl WI's authorization MUST address

**Per Medium #4 reconciliation**: most prior §11 items were product UX/parser-choice decisions that two implementers could materially diverge on. Each is now resolved in this plan with a **default chosen** + the user's explicit option to override at impl-WI authorization. The four items below are real STOP-AND-ASK gates (impl cannot proceed without an explicit answer); the rest are plan-decisions.

### §11.A Decisions captured in this plan (default values; impl writes these unless user overrides)

| # | Decision | Default chosen |
|---|---|---|
| D1 | In-memory backing volatility surfacing copy | "Data is held in memory only — relaunching the app clears it." — appears in active-list empty state only (NOT a persistent banner; NOT auto-injected on every screen). |
| D2 | Audit chain head UX | Lazy: collapsed `<details><summary>Show audit chain head</summary>` on view-matter; expanding triggers the `api.chainHead` call. Auto-load is REJECTED — adds an IPC call to every view-matter page that most lawyers will never need. |
| D3 | DTO sync test parser choice | Pure regex extractor over the `Object.freeze([...] as const)` blocks. TS compiler API is REJECTED for this test — it would pull `typescript` as a `tests/` dependency (the existing `check-renderer-imports.mjs` is a script, not a test) and is overkill for matching two well-formed author-controlled files. If the format drifts, the test fails loudly and the impl WI updates both files together. |
| D4 | ULID short-tag length | First **8 characters** (Crockford base32 lowercase). Full ULID under disclosure. |
| D5 | Date display format | `YYYY-MM-DD HH:mm` in local time. ISO inputs (e.g. `created_at`) → `new Date(iso)` → formatted via 5 string slots. No locale string; no relative time ("3 days ago"); no time zone label. |
| D6 | Status-pill visual | `<span class="status-pill status-pill--active">Active</span>` or `--archived`. CSS: small padding, rounded corners (border-radius via existing `--color-border`), color from `--color-success` (active) or `--color-muted-text` (archived). No new tokens. |
| D7 | 404 view content | `<main>` body: `<h1>Not found</h1>` + `<p>The requested screen does not exist or the matter ID is malformed.</p>` + `<a href="#/matters">Back to matters</a>`. No back-button JS; pure anchor. |
| D8 | Copy-to-clipboard fallback | If `navigator.clipboard.writeText` throws or the permission is denied, the copy button shows `disabled` + a tooltip `"Copy unavailable in this context."`. The button never silently fails. |
| D9 | Renderer-color lint exempt-comment mechanism | NOT introduced in this WI. If the impl WI encounters a legitimate raw-color need (e.g. inline SVG `fill="#000"`), that surfaces as a STOP-AND-ASK at impl time (S4 below). |
| D10 | Form validation timing | Submit-time only (per §7.1; also called out per Medium #5). |

### §11.B Real STOP-AND-ASK items (impl cannot proceed without explicit user authorization at impl-WI authorization)

| ID | What requires user authorization |
|---|---|
| S1 | **Renderer module split relaxation.** The "ZERO imports" rule from `plan-first-ui-shell-00.md` §1 rev-2 is relaxed to permit renderer-internal relative imports. User must explicitly authorize the relaxation at impl-WI start. (Reasons + lint safety in §5.) |
| S2 | **`smoke.electron.test.mjs` rewrite.** The existing token-fixture smoke is rewritten to product-UI smoke (per High #3 reconciliation). User must explicitly authorize the rewrite (the existing smoke is a load-bearing test reference; replacement is not a routine refactor). |
| S3 | **Per-WI manual evidence file path.** The G-UI-24 manual-evidence file `dev-memo/manual-evidence-casebox-ui-impl-XX.md` lives OUTSIDE `apps/lawbar-desktop/`. User must explicitly authorize the cross-directory artifact (per `.claude/rules/staging-hygiene.md` explicit-staging discipline). |
| S4 | **Bypass mechanism for renderer-color lint** (if ever needed). The plan defers introducing `/* lawbar-no-hardcoded-color: allow */`; if the impl WI discovers a real exempt case, the user authorizes a sub-WI for the bypass. Without an authorized bypass, no raw color literal lands in the impl WI's diff. |

None of S1-S4 trigger an autonomy-level hard-stop (no push, no deploy, no auth provider, no real data, no new runtime dep, no SQLite). They are scope-confirmation gates.

---

## §12 — Hard-stops the impl WI inherits (NOT re-litigated here)

Per `.claude/rules/autonomy.md` §"Hard-stop list" + the brief's §20 STOP-AND-ASK list:

- No push without separate authorization.
- No deploy / release / publication.
- No real secrets / credentials / billing / external accounts.
- No auth provider choice.
- No cloud vendor / public deployment choice.
- No exposing legal docs to external/cloud services.
- No irreversible migrations on real data.
- No new runtime dependency.
- No public API / wire-format / schema / CLI breaking changes.
- No SQLite persistence in this WI (separate plan + impl + audit cycle).
- No Tier 2 SQLCipher / Keychain.
- No `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash-dialog suppression.
- No signing, notarization, telemetry, distribution channel choice.
- No LLM execution.
- No real legal data.

---

## §13 — Out of scope (re-affirmed in narrative form)

This WI implements **only** the matter-list / matter-create / matter-view / matter-archive / audit-chain-head display surfaces inside the renderer. Everything else listed in the brief — documents, claims, defenses, evidence, deadlines, docket entries, classifications, privilege markers, facts, OCR review, document upload, file picker, cross-matter search, dashboard, settings (beyond the existing theme picker), import/export, backup/restore, sync, mini-program seam — is OUT.

The renderer remains vanilla TS. No framework. No bundler. No new dependency.

The IPC surface remains 5 channels. No new channel. No new contextBridge method.

The backing remains `InMemoryCaseBoxPersistence`. No SQLite. No `case-box.db` file. No migration.

The package.json remains free of new runtime / devDependencies; only `scripts` may expand (per G-UI-17).

---

## §14 — LOC budget (planning estimate; not a hard cap; loc-guardian is authoritative)

| File | Estimated LOC | LOC threshold | Headroom |
|---|---|---|---|
| `renderer/router.ts` | ~110 | 800 | 690 |
| `renderer/api.ts` | ~80 | 800 | 720 |
| `renderer/types.ts` | ~120 | 800 | 680 |
| `renderer/dom.ts` | ~180 | 800 | 620 |
| `renderer/format.ts` | ~80 | 800 | 720 |
| `renderer/screens/listMatters.ts` | ~180 | 800 | 620 |
| `renderer/screens/createMatter.ts` | ~280 | 800 | 520 |
| `renderer/screens/viewMatter.ts` | ~180 | 800 | 620 |
| `renderer/screens/archiveMatter.ts` | ~140 | 800 | 660 |
| `renderer/index.ts` (rewritten) | ~80 | 800 | 720 |
| `renderer/index.css` (additive) | ~180+132=312 (overall file) | n/a (CSS not bounded) | n/a |
| `tests/renderer-router.test.mjs` | ~120 | 1200 | 1080 |
| `tests/renderer-dto-sync.test.mjs` | ~120 | 1200 | 1080 |
| `tests/renderer-no-hardcoded-color.test.mjs` | ~80 | 1200 | 1120 |
| `tests/casebox-ui.electron.test.mjs` | ~360 | 1200 | 840 |

Total renderer source ≈ 1430 LOC across 10 files (no single file near the threshold). Total new test ≈ 680 LOC across 4 files (no single file near the threshold). The largest hand-written source file (`screens/createMatter.ts`) is well below 800; the largest test (`casebox-ui.electron.test.mjs`) is well below 1200.

---

## §15 — Sequencing and follow-up WIs (each separately authorized)

1. **THIS plan-WI** — commit `dev-memo/plan-casebox-ui-plan-00.md` alone. User authorizes → cc-suite review-plan → READY or READY-with-Low → user authorizes promotion commit (status flip in body banner).
2. **`WI-casebox-ui-impl`** — implements the file set in §"Exact target files for the IMPL WI". Carries the 11-field cc-suite recording (review-plan job ID(s) from step 1 + audit job ID + verify job ID).
3. ~~`WI-casebox-ui-smoke-cleanup`~~ — **removed per High #3 reconciliation**. The smoke migration is folded into the impl WI (this plan, §"NOT touched (re-affirmed)" → `smoke.electron.test.mjs` row). No separate later WI.
4. **`WI-casebox-document-ipc`** (later; separately authorized) — adds the first document-entity IPC channel (`casebox:document:register` or similar). Required before any UI surface for documents.
5. **`WI-casebox-document-ui`** (later) — UI for the document surface; reuses the form-builder + error-display patterns from this WI.
6. **`WI-persistence-sqlite-real`** (much later; large; multi-step; STOP-AND-ASK heavy) — switches the backing from `InMemoryCaseBoxPersistence` to SQLite. Until that WI lands, every product-UI matter is in-memory.

This plan does NOT pre-authorize any of steps 3-6. Each requires its own plan + review + audit + verify cycle.

---

## §16 — How this plan relates to existing READY plans

| Plan | Relationship | Conflict? |
|---|---|---|
| `plan-casebox-ipc-impl-01.md` rev-0.3 READY-with-Low | This plan consumes its IPC surface unchanged. | No. |
| `plan-first-ui-shell-00.md` rev-2 READY | Supersedes the 12-panel-fixture renderer scope by replacing it with product UI. The "ZERO-imports" rule is relaxed for renderer-internal relative imports (rationale §5). | Minor — the relaxation is explicit and lint-enforced; no semantic regression. |
| `plan-night-mode-foundation-00.md` READY | Carried forward UNCHANGED. Theme tokens, palette-sync, no-hard-coded-color rule all preserved; the new color lint EXTENDS rather than supersedes the existing palette-sync test. | No. |
| `plan-ui-substrate-decision-00.md` rev-3 RATIFIED | Honored: vanilla TS, no framework, no bundler. | No. |
| `plan-client-00.md` (historical reconciliation; superseded by ADRs) | Honored: Mac-only v1, local-first, in-process embedding, no cloud sync, no mini-program seam. | No. |
| `docs/product/project-requirements-brief.md` revision 5 READY | Honored: matter-only v1 UI; vocabulary `litigation` + `counsel`; create-time required fields; confidentiality enum; in-memory backing fits the v1 posture. | No. |
| `docs/adr/case-box-step-0-boundary.md` | Honored: matter create + archive flow respects the boundary contract; UI does not bypass any handler. | No. |
| `docs/adr/case-box-step-4-audit-log-shape.md` | Honored: chain head display is read-only; chain bytes never exposed in UI. | No. |

---

## §17 — Review-item disposition table

### Rev-0 → rev-0.1 (review-plan-mpo5zby4-ccl8oi; verdict NEEDS-RECONCILIATION; 0 C / 4 H / 5 M / 4 L)

| Finding ID | Severity | Reviewer wording (compressed) | Resolution in rev-0.1 |
|---|---|---|---|
| H1 | High | §6.1 / §9.4 / G-UI-10 use `env.value.items`; canonical `ListMattersPage` is `{ rows, next_cursor }` per `services/case-box-persistence/src/types.ts` line 203; existing IPC test asserts `listRes.value.rows`. | §6.1 IPC snippet updated to `env.value.rows`; canonical-shape note added inline citing the source line. §9.4 implicitly inherits. G-UI-10 wording is shape-agnostic and stays. |
| H2 | High | §6.3 / G-UI-25 specify audit-chain fields (`sequence`, `head_hash`, `head_authored_at`) that do not exist; actual `AuditChainHead` is `{ headHash, lastEventId, count }` per `services/case-box-persistence/src/types.ts` line 70. | §6.3 audit-chain display section rewritten against the real shape (`headHash`, `lastEventId`, `count`) including the `null`-`headHash`/`count===0` case. G-UI-25 wording does NOT enumerate field names; it requires the audit to inspect the audit-chain head display path — still valid. |
| H3 | High | `tests/smoke.electron.test.mjs` asserts title "lawbar (token fixture)" + 12 `article.panel`; impl WI removes the fixture; G-UI-15 (`npm test`) will fail. Smoke migration MUST land in this WI. | "NOT touched" row for `smoke.electron.test.mjs` reversed → "REPLACED in this WI". New smoke target spec written inline. §15.3 follow-up WI struck. |
| H4 | High | "Exact target files" omits `tests/renderer-router.test.mjs` (referenced in §9) and `dev-memo/manual-evidence-casebox-ui-impl-XX.md` (required by G-UI-24). | Both files enumerated in §"Exact target files for the IMPL WI"; manual-evidence file marked as deliberately outside `apps/lawbar-desktop/` with explicit-staging note. |
| M1 | Medium | §9 lists `tests/renderer-router.test.mjs` but no `test:ui-router` script and no router-test gate. | `test:ui-router` script added to package.json change list; G-UI-5a gate added between G-UI-5 and G-UI-6 (kept the numbering by suffixing `a`). Default `npm test` extended to include the router test in its file list. |
| M2 | Medium | `check-no-real-data.mjs` `SCOPE_HINTS = [/casebox|case-box|caseBox/i]` does NOT match `renderer/screens/listMatters.ts` etc. | Scanner marked as MODIFIED in this WI; adds second regex `/apps\/lawbar-desktop\/renderer\//` to `SCOPE_HINTS`. ~+3 LOC on the scanner. Three plan locations corrected. |
| M3 | Medium | Renderer-color lint says `renderer/index.css` is path-exempt; G-UI-5 says "outside canonical `:root` blocks". Path-level exemption would allow raw colors anywhere in `index.css`. | §8.3 rewritten as block-level exemption. Lint exempts ONLY the two canonical `:root { ... }` and `:root[data-theme="dark"] { ... }` blocks; raw colors anywhere else in `index.css` are flagged. G-UI-5 wording updated to match. |
| M4 | Medium | §11 items framed as "small confirmations; none is a hard-stop" — conflicts with no-choice autonomous default; either decide now or mark as actual stop-and-ask gates. | §11 split into §11.A (10 plan-decisions with explicit defaults, including ULID-short / date format / 404-view / clipboard fallback) and §11.B (4 real STOP-AND-ASK items requiring user authorization at impl-WI start: module-split relaxation, smoke rewrite, cross-directory evidence file, color-lint bypass mechanism). |
| M5 | Medium | §7.1 says renderer validation is advisory but never states when it runs. | §7.1 prefaced with "submit-time only" clause; reasons stated. D10 entry in §11.A locks the decision. |
| L1 | Low | §6.3 "archived-at timestamp + reason (if returned ... v1 may omit reason)" too loose. | §6.3 specifies `archived_at` rendered with §6.5 date formatter + fixed copy "Reason recorded in audit log." (the reason is in the audit event, not on the matter row; UI does NOT fetch it via extra IPC). |
| L2 | Low | §6.3 says "disclosure" but not the element pattern. | §6.3 + §6.5 explicitly use native `<details><summary>`. |
| L3 | Low | §6 / §14 leave formatter specifics open (ULID short length, date format). | New §6.5 fixes: ULID short = 8 chars (Crockford base32 lowercase); date = `YYYY-MM-DD HH:mm` local time. D4 + D5 in §11.A duplicate the decision for cross-section visibility. |
| L4 | Low | §6.2 parties repeatable behavior needs exact behavior (first row no remove; later rows remove + preserve siblings; validation on submit). | §6.2 table extended with explicit "Parties[] repeatable behavior" paragraph after the field-table. |

All H + M + L findings closed inline in rev-0.1; no item deferred. Re-review required.

### Rev-0.1 → READY-with-Low (review-plan-mpo6fp6k-fi88em; verdict READY-with-Low (2 Lows); 0 C / 0 H / 0 M / 2 L)

| Finding ID | Severity | Reviewer wording (compressed) | Resolution before promotion |
|---|---|---|---|
| L1 | Low | §6.3 / line 76 say `headHash` is "truncated middle" when present; no truncation rule defined; §6.5 only covers ULID short tags, not hash display. | §6.5 extended with explicit hash-truncation rule: `first 8 chars + "..." + last 8 chars`. Lines 76 + 362 reference §6.5 rule by citation. Full hash remains available inside the `<details>` body. |
| L2 | Low | §10 "30 gates" rationale text disagrees with the table (now 31 rows after G-UI-5a insertion). | §10 rationale rewritten to state "31 gates"; explains the `5a` suffix is intentional clustering with G-UI-5; cites L2 reconciliation. |

Both Lows applied inline before promotion. Plan promoted to rev-0.1 READY-with-Low.

---

## §18 — End-of-plan signature

This plan is plan-only. It does NOT implement any UI, modify any package.json, install any dependency, choose any framework, write any test, run any test, or commit any product code. The impl WI is a SEPARATE later authorization.

Commit policy for this plan-WI: a single commit of `dev-memo/plan-casebox-ui-plan-00.md` alone. Message: `docs(dev-memo): add case-box UI plan rev-0 DRAFT-PENDING-REVIEW`. No push.
