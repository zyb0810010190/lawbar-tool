# Plan — WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00

**Type**: UI. **Design artifact**: `dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md`.
**Composes under**: `.claude/rules/client-local-first.md` (local-first/offline posture is surfaced, not changed),
`.claude/rules/staging-hygiene.md`, `.claude/rules/loc-guardian.md`, `.claude/rules/cc-suite.md`.

## Review packet (compact)

1. **Summary** — Make the Electron renderer Chinese-first (zh-CN is the locked v1 locale) and add a visible
   设置 sidebar entry + a read-only Settings screen. Burns down the i18n anti-drift allowlist and adds ONE
   additive read-only preload channel (`app:info`) for version / mode / dataDir / FileVault state. Depends on
   the existing `renderer/i18n` catalog+`t()` infrastructure (already present).
2. **Exact target files**
   - Renderer: `renderer/i18n/catalog.ts`, `renderer/i18n/ui-strings-allowlist.json`, `renderer/index.html`,
     `renderer/index.ts`, `renderer/router.ts`, `renderer/nav.ts`, and screens
     `createMatter.ts`, `archiveMatter.ts`, `viewMatter.ts`, `viewMatterAudit.ts`, `viewMatterDeadlines.ts`,
     `viewMatterDocketProposals.ts`, `viewMatterDocuments.ts`, `viewMatterFacts.ts`, `viewMatterLinks.ts`, and
     new `renderer/screens/settings.ts`.
   - Boundary: `electron/preload.mts` (+`window.lawbar.appInfo`), `electron/main.ts` (+`ipcMain.handle("app:info")`).
   - Tests: `tests/renderer-create-matter.test.mjs`, `tests/renderer-archive-matter.test.mjs`,
     `tests/renderer-view-matter.test.mjs`, `tests/renderer-shell.test.mjs`, `tests/renderer-nav.test.mjs`,
     `tests/renderer-format-ledger.test.mjs`, `tests/casebox-ui.electron.test.mjs`, and new
     `tests/renderer-settings.test.mjs`.
3. **Acceptance criteria**
   - No user-facing English remains on the enumerated core surfaces (New matter / Name / Matter type /
     Litigation / Counsel / Archive / Normal / generic validation). Allowlist regenerated; only genuinely-
     exempt occurrences (bare separators/symbols) remain.
   - 设置 entry visible in the shell, routes to `#/settings`, renders version / mode / data location /
     local-first + offline notes / FileVault status / privacy note.
   - `app:info` is read-only and additive; no existing IPC/preload/error surface renamed or removed.
   - `npm --prefix apps/lawbar-desktop test` green; `npm --prefix apps/lawbar-desktop run dist` succeeds.
4. **Out of scope** — signing/notarization/release; legal/compliance conclusions; schema/persistence-contract
   change; archive/document upload; unrelated restyle; runtime i18n switching (v1 is zh-CN only).
5. **Essential refs** — `renderer/i18n/t.ts` (throws on missing key), `renderer/i18n/catalog.ts` (namespaces),
   `.claude/rules/client-local-first.md` (posture surfaced, not changed).
6. **Review questions** — (a) Is `app:info` the minimal safe boundary addition (read-only, no PII beyond the
   app's own data-dir path)? (b) Does surfacing the data-dir path / FileVault state weaken any security or
   offline invariant? (c) Is the allowlist burn-down complete and are the remaining exempt entries justified?
   (d) Any English validation message still reachable by a user? (e) Is the Settings route/nav wiring
   consistent with the existing `applySidebarCurrent` / router idiom?

## Phases

- **P1 (no boundary)** — i18n burn-down of core surfaces (index.ts not-found, createMatter, archiveMatter,
  viewMatter field labels) + shell 设置 nav + router/nav `settings` route. Catalog keys + `t()` wiring.
- **P2 (boundary)** — `app:info` preload+IPC (read-only) and `settings.ts` screen consuming it. This is the
  high-risk slice; cc-suite review-plan/audit applies here per `.claude/rules/cc-suite.md`.
- **P3** — i18n burn-down of the deep view sub-screens (audit/deadlines/docket/documents/facts/links).
- **P4** — regenerate allowlist; update English-asserting tests; add `renderer-settings.test.mjs`;
  `npm test`; `npm run dist`; manual launch.

## cc-suite review-plan record + resolutions

- **Kind**: review-plan. **Scope**: `dev-memo/plan-desktop-zh-cn-settings-entry-00.md` (+ design artifact).
- **Runner**: `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1, foreground).
- **Model/effort/sandbox**: `gpt-5.5` / `high` / `read-only`. **Job ID**: `review-plan-mrcsgfnl-sji7iy`.
  Retrievable via `/cc-suite:status` / `/cc-suite:result`: YES (runner `status:"completed"`). Failure class: none.
- **Verdict**: NEEDS-FIX (no High). Resolutions folded here:
  - **M1 (FileVault re-probe)** → `app:info` returns the **launch-captured** FileVault probe state (cached at
    `app.whenReady()`), never re-spawns `fdesetup` per call; exposes only the `fileVaultState` enum — never
    `raw` / `error`.
  - **M2 (test coverage)** → also update `tests/renderer-router.test.mjs` (currently asserts `#/settings` →
    `not-found`) with parse/build `settings` cases; add boundary coverage for `app:info` (main IPC handler +
    `window.lawbar.appInfo` preload shape).
  - **M3 (sequencing)** → Settings is ONE atomic slice: shell nav + route + screen + `appInfo` + tests land
    together (no visible route without a screen). P1 = i18n-only.
  - **M4 (English error paths)** → **client-side validation messages are translated** (primary path). The
    main-process `errorMap.ts` safe messages ("invalid payload", "unknown matter", …) are reachable only on an
    IPC failure and are **declared OUT OF SCOPE** for this WI (a separate error-catalog WI). Recorded, not silently skipped.
  - **L2 (打开数据文件夹)** → out of scope; the data-dir path is displayed as read-only text only.
  - **L3 (locale)** → `index.html` `lang="en"` → `lang="zh-CN"`. `viewMatterT3Catalog.ts` verified: it renders
    via the existing `viewT3.*` catalog keys (already zh-CN) — no new English literals; included in the P4 allowlist check.

## cc-suite audit record (P2 boundary)

- **Kind**: audit. **Scope**: `electron/preload.mts` + `electron/main.ts` (`app:info`) + `renderer/screens/settings.ts` (inlined diff).
- **Runner**: `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1, foreground).
- **Model/effort/sandbox**: `gpt-5.5` / `high` / `read-only`. **Job ID**: `audit-mrcte7sp-25tagp`. Retrievable: YES. Failure class: none.
- **Verdict**: PASS, no blocking findings. Confirmed: FileVault cached (no per-call `fdesetup`), no injection (`el()` text nodes, not innerHTML), no privilege/network/write, offline invariant intact, existing preload/error surfaces unchanged (additive only).
- **Low (accepted)**: intentional `userData` path disclosure to the app's OWN trusted renderer. No document contents / secrets / raw probe output exposed. Reason: `out-of-scope-to-hide` — it is the Settings screen's purpose to show the data location; revisit only if renderer content ever becomes remotely sourced. Target: no follow-up. Safe-to-proceed: YES.
- **Non-security cleanup applied**: refreshed the stale `main.ts` preload-surface comment to include `appInfo`.

## Notes

- `t()` throws on any missing key → a missed wiring fails loudly in build/tests (safety net for the burn-down).
- `renderer/i18n/**` is exempt from the anti-drift scan; the catalog is the single zh-CN source of truth.
- Commit boundary: P1+P3+P4 (i18n + tests) may commit together; P2 (boundary) is the slice that most needs
  independent review and is called out separately in the PR body.
