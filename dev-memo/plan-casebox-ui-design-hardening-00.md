# PLAN — `WI-casebox-ui-design-hardening-00` (visual-strengthening lane)

**Status**: PLAN-ONLY rev-0.2 READY (promoted from DRAFT-PENDING-REVIEW after Path 2 MCP re-review verdict `READY` — no findings; H1 + M1 confirmed closed in all operative sections; static `dev-memo/design-evidence/*.html` files are explicitly secondary; token rename remains forbidden-by-default per HS11). Review chain: rev-0 → rev-0.1 (1 H + 1 M + 1 L primary spots) → rev-0.2 (1 H + 1 M residual sweep) → rev-0.2 (final Review-question #4 sweep) → READY. Path 1 runner attempts failed RUNNER_ERROR/ENOBUFS twice (`review-plan-mppnfj57-v6zm6i`, `review-plan-mppnlzpi-d289fi`); load-bearing reviews used Path 2 direct MCP `mcp__codex-cli__codex` (model `gpt-5.3-codex`, effort `high`, sandbox `read-only`). See §17 for the disposition tables.
**Date**: 2026-05-28.
**Author**: Claude Code at user direction (WI-casebox-ui-design-hardening-00 lane).
**Branch**: main.
**Lane**: plan-only visual-strengthening pass over the case-box renderer per the external Claude Design handoff.

**Source-of-truth handoff (load-bearing)**:
- `dev-memo/Lawbar Handoff v1.0 _standalone_.html` (v1.0; 2026-05-28; 14.95 MB; mostly embedded CJK font payload — actual content lives at byte offset ~14.93 MB onward). The handoff's §00 PLAN MEMO FIRST mandates a plan memo before any code edit; THIS FILE satisfies that mandate.

**Parent references (UNCHANGED by this plan)**:
- `dev-memo/plan-casebox-ui-plan-00.md` rev-0.1 READY-with-Low at `1910756` — the case-box UI plan that drove Slices 1-7 + Checkpoints 8-12.
- IPC impl commit `e490686` — 5 v1 channels live; in-memory backing; safe-message allowlist.
- UI impl chain `2565a2d..0b444a5` — list / create / view / archive screens + DOM/router/api/format primitives + shell + smoke + packaged UI flow + audit-fix.
- `docs/product/project-requirements-brief.md` status `READY` — single-lawyer Mac desktop; local-first; v1 `litigation` + `counsel` UI vocabulary; no real auth.

**Project rules referenced**:
- `.claude/rules/client-local-first.md` — Mac primary; no cloud sync default; no public HTTP.
- `.claude/rules/security-boundary.md` — IPC + persistence + auth scope require bounded WI loops.
- `.claude/rules/autonomy.md` §"Hard-stop list".
- `.claude/rules/cc-suite.md` §"High-risk WIs" — design hardening is NOT itself security-boundary work (no IPC / no DTO / no persistence change); review-plan is required by lane discipline, audit + verify are required if any hand-written source file exceeds size thresholds OR if the diff incidentally touches src/caseBox / electron / preload paths (it MUST NOT — see §"Hard stops").
- `.claude/rules/loc-guardian.md` — renderer source files stay under 800 pure LOC; tests under 1200.
- `.claude/rules/execution-discipline.md` — surgical changes only; no drive-by refactors.

This plan does NOT implement anything. It produces the blueprint for a future `WI-casebox-ui-design-hardening-impl` WI. The impl WI is a SEPARATE later authorization.

---

## Review packet (compact)

### Active plan summary

Apply the external Claude Design handoff's visual-strengthening pass to the renderer **without changing routes, IPC, preload, main process, persistence, DTOs, or behavior**. The pass replaces the renderer's color/spacing/typography token surface, ports component-rule CSS (eight named CSS source files referenced by the handoff §02), localizes screen strings to Simplified Chinese per the handoff's term mapping, adds the `lb-mk` Plan C archive-index-mark span at eyebrow positions, introduces a `ledgerCategory(matter_type)` pure formatter (display-only; no DTO change), and mounts a small set of visual-placeholder screens (workbench / todo calendar / archived view / login-register-reset) whose interactions land in `console.log` or local in-memory state with NO IPC / preload / persistence touch. Every "future functional" capability (real upload, real WeChat sync, real auth, OCR, real calendar persistence) is explicitly DEFERRED to later lanes named in §04 of the handoff.

### Exact target files (THIS plan-WI's own commit)

CREATED (single file):

- `dev-memo/plan-casebox-ui-design-hardening-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:

- Any `apps/lawbar-desktop/**` source, renderer, electron, test, script, or asset file.
- Any `package.json`.
- The handoff HTML at `dev-memo/Lawbar Handoff v1.0 _standalone_.html` (treat as input artifact; UNCHANGED).
- Any `dev-memo/plan-casebox-ui-plan-00.md` / `plan-casebox-ipc-impl-*.md` / `plan-first-ui-shell-*.md` / `plan-night-mode-foundation-*.md` (predecessor plans remain READY).
- Any `docs/contracts/**`, `services/**`, `docs/adr/**`, `docs/release/**`, `docs/product/**`.
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.
- `.claude/rules/**`, `.claude/skills/**`.

### Exact target files for the IMPL WI (NOT created by THIS plan-WI's commit)

When the user later authorizes the impl WI, it may touch ONLY the files listed in §3 below ("Candidate files likely affected"). The impl WI explicitly does NOT touch any file outside that list. The impl WI's plan-review packet repeats the §"Hard stops" list verbatim.

### Exact acceptance criteria

**For THIS plan-WI**:

1. Plan committed alone in a single commit (`dev-memo/plan-casebox-ui-design-hardening-00.md` only).
2. §1 enumerates current repo state assumptions to verify before impl begins.
3. §2 enumerates files to inspect before impl begins (sets of CSS source files referenced by the handoff §02 + existing renderer artifacts).
4. §3 enumerates candidate files likely affected (per handoff §05).
5. §4 enumerates the token + CSS migration path (per handoff §03 Task 1 + Task 2 + Appendix Plan C symbol rules).
6. §5 enumerates the Plan C symbol handling strategy (per handoff Appendix).
7. §6 enumerates the visual-placeholder strategy for the future-functional screens (upload / file rows / auth / Mini Program / calendar).
8. §7 enumerates explicit future functional exclusions matching the handoff §04 list verbatim.
9. §8 enumerates the slice plan with small reviewable commits.
10. §9 enumerates tests and verification checklist (per handoff §06A).
11. §10 enumerates manual screenshot / evidence checklist (per handoff §07).
12. §11 enumerates the hard-stop self-check (per handoff §08).
13. §12 enumerates open questions / risks.
14. cc-suite review-plan returns READY or READY-with-Low via Path 1 native `--background`; the 11-field cc-suite recording lands in the eventual impl-WI commit message.

### Exact out-of-scope list (FOR THE IMPL WI; NOT just this plan)

Sourced verbatim from handoff §04 + §08 + §"Constraints":

- Any IPC channel name change; any new IPC channel; any preload bridge change; any main-process file change.
- Any DTO field change in `apps/lawbar-desktop/renderer/types.ts` or `apps/lawbar-desktop/src/caseBox/dto.ts`.
- Any persistence write (`fs.writeFile*` / `better-sqlite3` / `localStorage` / `IndexedDB` / blob / asar pack-time mutation).
- Any real WeChat OAuth integration; any third-party SDK; any external network request.
- Any OCR engine integration; any OCR text rendering; any OCR badge / progress / count display.
- Any file upload / download / preview engine; any signed-bundle export; any watermarking.
- Any real schedule persistence / reminder / system notification.
- Any auth provider choice; any session token implementation; any password hashing.
- Any redefinition of existing color-token names that breaks the palette-sync test.
- Any rewrite of `apps/lawbar-desktop/src/caseBox/*`, `apps/lawbar-desktop/electron/**`, `apps/lawbar-desktop/scripts/**`.
- Any framework / bundler / runtime dependency / devDependency.
- Any CDN-served font, image, icon, or asset (CSP `script-src 'self'` + `default-src 'self'` blocks external sources; fonts must be locally bundled).
- Any push to `origin/main`.

### Essential references (≤3 priority)

1. `dev-memo/Lawbar Handoff v1.0 _standalone_.html` §00–§08 + Appendix — the load-bearing source-of-truth.
2. `dev-memo/plan-casebox-ui-plan-00.md` rev-0.1 READY-with-Low — the predecessor plan whose acceptance criteria are EXTENDED (not replaced) by this lane.
3. `docs/product/project-requirements-brief.md` revision 5 status `READY` — §3 (Mac primary), §6 (local-first default), §12 (LLM/OCR shelved), §20 (STOP-AND-ASK list).

### Review questions (3-5; specific)

1. **CSS source-file availability**: the handoff §02 cites eight named CSS files (`editorial-tokens.css`, `editorial-styles.css`, `desktop-shell.css`, `cn-overlay.css`, `v08-additions.css`, `v11-auth.css`, `v12-typography.css`, `v13-mark.css`). None of these are currently inside the repo working tree. Should the impl WI's first acceptance criterion be "import these eight files into `apps/lawbar-desktop/renderer/design-source/` as commit-only-once frozen references" — or should the impl WI inline their content directly into `renderer/index.css` and discard the per-file boundary?
2. **Token-rename surface**: the handoff §03 Task 1 says "preserve all existing token names (palette-sync test depends on them); new tokens sync to `src/theme/tokens.ts`." The current `src/theme/tokens.ts` exports 12 named tokens. If the handoff's `editorial-tokens.css` introduces a new spacing / typography / radius / shadow surface (per the prior brief expectation), should `src/theme/tokens.ts` be extended with a parallel `SPACING_TOKENS` / `TYPOGRAPHY_TOKENS` export — and does the palette-sync test need extension to enforce these too (a Medium-sized test-rewrite scope), OR does the test stay scoped to colors only?
3. **Localization scope**: the handoff §03 Task 3 says "localize `renderer/screens/*.ts` strings per v0.4 → v0.13 term mapping." The current screen strings are English (`"+ New matter"`, `"Archive…"`, `"Matter not found"`, etc.). Should the impl WI replace them outright with Simplified Chinese, OR introduce a tiny `i18n` map with English fallback (which would be a new architectural surface)? Plan recommendation: outright replacement, no i18n layer; defer multi-language to a future lane.
4. **Visual-placeholder screen mount**: the handoff §03 Task 4 lists workbench / todo calendar / archived / login-register-reset as new mount entries. The current router (`renderer/router.ts`) defines exactly four routes (`list` / `new` / `view` / `archive`). Adding new routes is BANNED by §08 hard stops ("不改路由"). Resolution **(rev-0.2 reconciliation)**: the impl WI mounts the new placeholder screens LIVE via a NON-router mechanism — a `mountDesignPreview(target)` helper in `renderer/index.ts` invocable from devtools (`window.lawbarDesignPreview.show(target)`) AND from a query-string param (`?design-preview=login|register|reset|workbench|todo-calendar`) resolved BEFORE `attachRouter` fires. Workbench-style screens additionally render inline within existing screens (above the list table; in view-matter right-rail). Static `dev-memo/design-evidence/*.html` files MAY be authored as a secondary screenshot surface only. The router (`renderer/router.ts`) stays at the 4 v1 routes — no `RouteName` / `parseHash` / `buildHash` change. Plan recommendation: load-bearing path is the live `mountDesignPreview` helper; static evidence files are secondary.
5. **Plan C `lb-mk` symbol replacement**: the handoff Appendix says "grep `§` in implemented UI source = 0; Claude Code sees `§` ≡ replace with `<span class="lb-mk"></span>`." The current renderer source contains zero literal `§` characters in TypeScript strings (the symbol appears only in plan-document comments). Resolution: the impl WI adds `lb-mk` markup at eyebrow positions (per Appendix size table) where the design specifies an indexed marker; existing source has no `§` to scrub. Plan recommendation: confirm via grep before impl starts.

---

## §1 — Current repo state assumptions to verify

Before the impl WI begins, the following assumptions MUST be verified by running the commands shown. Any mismatch is a STOP-AND-ASK trigger.

| # | Assumption | Verification command | Expected |
|---|---|---|---|
| 1 | HEAD on `main` is at or after `0b444a5` (UI impl + audit closure pushed) | `git rev-parse HEAD` | A commit reachable from `0b444a5..HEAD` on `main` |
| 2 | Working tree state at impl-WI START is tolerable | `git status --short` | EITHER (a) only `?? .claude/scheduled_tasks.lock` IF the plan + handoff are already committed (this WI's plan-WI commit consumes the plan; the handoff is consumed by S0 of the impl WI per §8), OR (b) `?? .claude/scheduled_tasks.lock` + `?? dev-memo/Lawbar Handoff v1.0 _standalone_.html` + `?? dev-memo/plan-casebox-ui-design-hardening-00.md` IF impl is starting before the plan-WI's commit fires. Either state is acceptable; the impl WI MUST NOT modify the handoff input file (see §3 row "NOT touched") regardless of whether it is staged or untracked. Per L1 reconciliation (rev-0.1). |
| 3 | Renderer source tree at the v1 UI impl shape | `ls apps/lawbar-desktop/renderer/` | `index.html`, `index.css`, `index.ts`, `api.ts`, `dom.ts`, `format.ts`, `router.ts`, `types.ts`, `screens/` |
| 4 | Existing screen files | `ls apps/lawbar-desktop/renderer/screens/` | `listMatters.ts`, `createMatter.ts`, `viewMatter.ts`, `archiveMatter.ts` |
| 5 | Theme token source | `cat apps/lawbar-desktop/src/theme/tokens.ts` | 12 exported tokens; `LIGHT_TOKENS` + `DARK_TOKENS` |
| 6 | Palette-sync test alive | `grep -n "palette-sync" apps/lawbar-desktop/tests/main.test.mjs` | Test exists; byte-equality between `:root` CSS blocks and `LIGHT_TOKENS` / `DARK_TOKENS` |
| 7 | Renderer-import lint at current shape | `grep -n FORBIDDEN apps/lawbar-desktop/scripts/check-renderer-imports.mjs` | `FORBIDDEN_PACKAGE_EXACT`, `FORBIDDEN_PACKAGE_PREFIX`, `FORBIDDEN_RELATIVE_RESOLVED_PREFIX`, `VALUE_IMPORT_FORBIDDEN_*` blocks intact |
| 8 | No-real-data scanner SCOPE_HINTS extended to renderer/ | `grep -n SCOPE_HINTS apps/lawbar-desktop/scripts/check-no-real-data.mjs` | Two regex entries (case-insensitive `casebox` + `/apps\/lawbar-desktop\/renderer\//`) |
| 9 | Renderer-color lint with block-level exemption | `grep -n "findCanonicalBlocks" apps/lawbar-desktop/tests/renderer-no-hardcoded-color.test.mjs` | Function present; `:root` and `:root[data-theme="dark"]` block-only exemption |
| 10 | IPC channels stable | `grep -nE "casebox:(matter|audit):" apps/lawbar-desktop/electron/preload.mts` | 5 channels exactly: `:create`, `:get`, `:list`, `:archive`, `:chainHead` |
| 11 | All non-Electron tests green | `cd apps/lawbar-desktop && node --test tests/main.test.mjs tests/ipc-handlers.unit.test.mjs tests/dto-contract.test.mjs tests/check-renderer-imports.test.mjs tests/check-no-real-data.test.mjs tests/renderer-*.test.mjs` | Exit 0; 231 tests pass |
| 12 | Smoke test green against current shell | `cd apps/lawbar-desktop && node --test tests/smoke.electron.test.mjs` | Exit 0; 2 tests pass; title="lawbar"; `<main id="app">` renders; `#/matters` empty-state copy verbatim |
| 13 | Packaged UI flow green | `cd apps/lawbar-desktop && npm run test:ui-packaged` | Wrapper exit 0; UI flow click-through completes |
| 14 | Handoff input file present and unchanged | `wc -c "dev-memo/Lawbar Handoff v1.0 _standalone_.html"` | ~14.95 MB; file UNCHANGED in this WI's diff |

Any FAIL → stop and ask the user before starting impl.

---

## §2 — Files to inspect before implementation

Two classes:

### §2.1 Existing renderer artifacts (read in full to confirm semantics still hold)

- `apps/lawbar-desktop/renderer/index.html` — current shell shape (router-mount + sr-only announce region + CSP meta).
- `apps/lawbar-desktop/renderer/index.css` — current `:root` + `:root[data-theme="dark"]` + ~385 LOC of additive layout rules from Checkpoint 8.
- `apps/lawbar-desktop/renderer/index.ts` — current router bootstrap (4 routes + 404 fallback).
- `apps/lawbar-desktop/renderer/format.ts` — current formatters (`ulidShort`, `hashTruncate`, `formatLocalDateTime`, `matterTypeLabel`, `confidentialityLabel`, `statusLabel`).
- `apps/lawbar-desktop/renderer/screens/listMatters.ts` / `createMatter.ts` / `viewMatter.ts` / `archiveMatter.ts` — current four screens.
- `apps/lawbar-desktop/renderer/router.ts` — current Crockford-tightened `ULID_RE`.
- `apps/lawbar-desktop/renderer/types.ts` — current DTO shapes + `RENDERER_*_DTO_FIELDS` arrays (DO NOT MUTATE).
- `apps/lawbar-desktop/src/theme/tokens.ts` — current 12-token `LIGHT_TOKENS` + `DARK_TOKENS`.
- `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` — current lint policy.
- `apps/lawbar-desktop/scripts/check-no-real-data.mjs` — current SCOPE_HINTS.
- `apps/lawbar-desktop/tests/main.test.mjs` — palette-sync test (test 6).
- `apps/lawbar-desktop/tests/renderer-no-hardcoded-color.test.mjs` — block-level exemption logic.

### §2.2 External design source files (referenced by handoff §02 B; NOT currently in repo)

These are the eight CSS source files the handoff §03 Task 1 + Task 2 names as candidate targets. The impl WI MUST verify they exist (either externally and they're imported, OR the user supplies their content) BEFORE starting:

| # | File (handoff §02 B) | Role | Implementation candidate target |
|---|---|---|---|
| 1 | `editorial-tokens.css` | Palette + size + spacing + radius + shadow tokens | Drives `renderer/index.css` `:root` replacement + extends `src/theme/tokens.ts` |
| 2 | `editorial-styles.css` | Typography + component base | Appended to `renderer/index.css` |
| 3 | `desktop-shell.css` | Main shell (titlebar / sidebar / status-bar) | Appended to `renderer/index.css` |
| 4 | `cn-overlay.css` | CJK font stack + `<em>` → underline emphasis | Appended to `renderer/index.css` |
| 5 | `v08-additions.css` | Three ledgers / details / upload sheet / todo / archive | Appended to `renderer/index.css` |
| 6 | `v11-auth.css` | Login / register / reset / Mini Program login | Appended to `renderer/index.css` |
| 7 | `v12-typography.css` | Title↔body same-column fix | Appended to `renderer/index.css` |
| 8 | `v13-mark.css` | Plan C archive-index-mark `.lb-mk` (REQUIRED) | Appended to `renderer/index.css`; `.lb-mk` becomes a renderer-wide utility class |

Plus the four HTML mockups (handoff §02 A): `Lawbar Case Box (CN).html v0.4`, `v0.8`, `v0.9`, `v0.11 — Auth.html` — read for screen-state semantics; NEVER imported into the build pipeline.

**Verification command before impl**: `ls "dev-memo/"` shows the design-source files placed alongside the handoff HTML; OR the user explicitly authorizes pasting their content inline.

---

## §3 — Candidate files likely affected (per handoff §05)

The impl WI may touch ONLY these files. Any file not on this list = out-of-scope = STOP-AND-ASK.

| # | File | Allowed change shape | LOC budget |
|---|---|---|---|
| 1 | `apps/lawbar-desktop/renderer/index.html` | Add font `<link>` tags to `<head>` (Noto Serif SC / Noto Sans SC / JetBrains Mono — locally bundled per CSP); wrap `<main id="app">` with main-shell scaffold (`.titlebar`, `.sidebar`, `.status-bar`) preserving the `id="app"` mount point + `sr-announce` live region | ≤ 50 LOC |
| 2 | `apps/lawbar-desktop/renderer/index.css` | Replace `:root` + `:root[data-theme="dark"]` blocks with `editorial-tokens.css` + `cn-overlay.css` palette; append `editorial-styles.css`, `desktop-shell.css`, `v08-additions.css`, `v11-auth.css`, `v12-typography.css`, `v13-mark.css` content at file end. Preserve byte-equality between `:root` blocks and `src/theme/tokens.ts` exports. | ≤ 1500 LOC total file (was ~440; target ~900-1400) |
| 3 | `apps/lawbar-desktop/renderer/index.ts` | Add placeholder mount-helper functions for workbench / todo-calendar / archived-view / login-register screens — ALL render inline within the existing four-route surface OR are gated behind a NON-route mount key. Do NOT add new routes to `router.ts`. | ≤ 200 LOC delta |
| 4 | `apps/lawbar-desktop/renderer/screens/listMatters.ts` | Localize string literals to Simplified Chinese per handoff term mapping; add Plan C `lb-mk` spans at eyebrow positions; add filter-chip toolbar surface (display-only; filter state in local closure variable; no IPC change) | ≤ 350 LOC total (was 351) |
| 5 | `apps/lawbar-desktop/renderer/screens/createMatter.ts` | Localize strings; add category-select first step (`litigation` / `counsel` / `non_litigation` radio chip group above existing form); add footer text "创建后可上传材料并归入栏目" | ≤ 700 LOC total (was 616) |
| 6 | `apps/lawbar-desktop/renderer/screens/viewMatter.ts` | Localize strings; tabbed layout for detail-card content; compact right-rail (placeholder "下一期限" / "最近材料" / "上传" / "归档" blocks — all `console.log` on click); preserve existing audit-chain-head disclosure | ≤ 700 LOC total (was 616) |
| 7 | `apps/lawbar-desktop/renderer/screens/archiveMatter.ts` | Localize strings; quote-block treatment of the matter name; summary `<dl>` block above reason textarea; "归档不删除任何文件" yellow tip; live char-count below textarea | ≤ 500 LOC total (was 407) |
| 8 | `apps/lawbar-desktop/renderer/format.ts` | ADD `ledgerCategory(matter_type: MatterType): "litigation" \| "counsel" \| "non_litigation"` pure function per handoff §03 Task 5; ADD `ledgerCategoryLabel(c: LedgerCategory): string` for display | ≤ 120 LOC total (was 66) |
| 9 | `apps/lawbar-desktop/renderer/types.ts` | ADD `LedgerCategory` type alias + supporting display types ONLY. NO change to existing DTO interfaces or `RENDERER_*_DTO_FIELDS` arrays. The DTO sync test (`tests/renderer-dto-sync.test.mjs`) MUST continue passing unchanged. | ≤ 130 LOC total (was 109) |
| 10 | `apps/lawbar-desktop/src/theme/tokens.ts` | Extend `LIGHT_TOKENS` / `DARK_TOKENS` with any new color tokens introduced by `editorial-tokens.css`. Add optional new `*_TOKENS` exports for spacing / typography / radius / shadow IF the impl WI chooses to codify them in TS (the palette-sync test scope decision per review-question #2). | ≤ 200 LOC total (was 47) |
| 11 | `apps/lawbar-desktop/tests/main.test.mjs` | UPDATE palette-sync test to match the new token list; ADD analogous sync tests for the new token categories IF the impl WI codifies them. NO other test removed. NO existing assertions weakened. | ≤ 450 LOC total (was 313) |
| 12 | NEW `apps/lawbar-desktop/renderer/fonts/` directory | Locally-bundled WOFF2 files for Noto Serif SC / Noto Sans SC / JetBrains Mono (CSP requires `font-src 'self'`; CDN is forbidden). Build copies these to `dist/renderer/fonts/` via the existing `build:assets` script extension. | n/a (binary asset; license SIL OFL 1.1 verified before commit) |
| 13 | NEW `apps/lawbar-desktop/tests/renderer-format-ledger.test.mjs` | Pure-Node unit test for `ledgerCategory()` mapping table (6 input enum values × expected output) + `ledgerCategoryLabel()` | ≤ 100 LOC |
| 14 | NEW `apps/lawbar-desktop/tests/renderer-localization-shape.test.mjs` | Pure-Node lint that asserts every screen module's user-facing string is non-empty AND contains at least one CJK codepoint (or is explicitly allowlisted, e.g., ULID short tags). Guards against regressions where a string is accidentally left in English after localization. | ≤ 150 LOC |
| 15 | `apps/lawbar-desktop/package.json` | Extend `pretest` and `test` script lists with the two new test files. NO new runtime dependency. NO new devDependency. The `build:assets` script extended to also `cp -r renderer/fonts dist/renderer/`. | ≤ 80 LOC total |

**Out of scope (re-affirmed)** — the impl WI MUST NOT touch:

- `apps/lawbar-desktop/electron/main.ts`
- `apps/lawbar-desktop/electron/preload.mts`
- `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts`
- `apps/lawbar-desktop/src/caseBox/*.ts`
- `apps/lawbar-desktop/src/security/*.ts`
- `apps/lawbar-desktop/scripts/*.mjs` (lint + scanner + wrapper UNCHANGED; existing renderer-color regex + scope hints remain authoritative)
- Any file under `services/`, `docs/contracts/`, `docs/adr/`, `docs/release/`, `docs/product/`.
- Any `.claude/rules/**`, `.claude/skills/**`.
- AGENTS.md / CLAUDE.md / GEMINI.md.
- The handoff HTML at `dev-memo/Lawbar Handoff v1.0 _standalone_.html`.

---

## §4 — Token + CSS migration path

### §4.1 Token replacement (handoff §03 Task 1)

Step-by-step ordering (each step its own internal phase within the impl-WI's first slice):

1. **Inventory existing tokens** — current `src/theme/tokens.ts` exports 12 named tokens (`background`, `surface`, `surfaceElevated`, `text`, `mutedText`, `border`, `accent`, `textOnAccent`, `danger`, `warning`, `success`, `focusRing`). The `:root` and `:root[data-theme="dark"]` blocks in `renderer/index.css` mirror these.
2. **Read `editorial-tokens.css` + `cn-overlay.css`** — extract the desired light + dark palettes. Identify any new token NAMES (e.g., a new `accent-honey-orange` if the design diverges from the current `accent`).
3. **Decide rename vs. extend (per M1 reconciliation)**:
   - **Token VALUE change** (hex / size / spacing value updates while preserving the existing NAME) — ALLOWED in lockstep with the palette-sync test update. This is the dominant path: the editorial palette likely shifts color values without changing token identifiers.
   - **Purely additive new tokens** (new spacing / radius / typography token NAMES that did not exist before) — ALLOWED additively. Append to both `:root` blocks AND extend `src/theme/tokens.ts`. NO change to existing names.
   - **Token RENAME of an existing name** (e.g., `--color-accent` → `--color-accent-honey`) — **FORBIDDEN by default; this is a STOP-AND-ASK per §11 HS11 (added in rev-0.1)**. The handoff §03 Task 1 mandates "保留所有现有 token 名称" (preserve all existing token names). Renaming without explicit user authorization is a hard-stop. The impl WI MUST NOT auto-alias the old name to suppress the consequence — that defeats the source-of-truth invariant. If a rename is unavoidable, the impl WI stops, presents the rename + reason, and waits for user authorization; only then may the change land (with the palette-sync test updated in the same slice).
4. **Atomic edit**: in a SINGLE commit, replace `:root` + `:root[data-theme="dark"]` blocks in `renderer/index.css` AND `LIGHT_TOKENS` / `DARK_TOKENS` in `src/theme/tokens.ts`. The palette-sync test (`tests/main.test.mjs` test 6) MUST be updated in the SAME commit if its hardcoded property list changes.
5. **Verify**: `npm test` exits 0; `:root` blocks byte-equal `LIGHT_TOKENS`/`DARK_TOKENS`; existing `.button--primary` / `.status-pill--active` / etc. rules continue to resolve their `var(--color-*)` references.

### §4.2 CSS component-rule porting (handoff §03 Task 2)

Step-by-step:

1. **Stage A — Editorial styles**: append `editorial-styles.css` content to `renderer/index.css` AFTER the existing additive layout block. Resolve any selector collisions (e.g., if `editorial-styles.css` defines `.button` and the existing CSS already defines `.button`, take the editorial-styles version; document the override in the commit message).
2. **Stage B — Desktop shell**: append `desktop-shell.css`. This is the load-bearing layout for the new `.titlebar` / `.sidebar` / `.status-bar` wrappers introduced in `renderer/index.html`.
3. **Stage C — CN overlay**: append `cn-overlay.css`. Locks the CJK font stack on `body` and applies the `<em>` underline + honey-orange treatment.
4. **Stage D — v08 additions**: append `v08-additions.css`. Adds three-ledger / detail-tab / upload-sheet / todo / archive component rules.
5. **Stage E — v11 auth**: append `v11-auth.css`. Adds login / register / reset / MP-login styles.
6. **Stage F — v12 typography**: append `v12-typography.css`. Fixes title↔body same-column treatment.
7. **Stage G — v13 mark**: append `v13-mark.css`. Adds the `.lb-mk` mask-image rules + variants (`--accent`, `--reverse`).

Each stage is its OWN slice within the impl-WI's commit chain (per §8 slice plan). The renderer-color lint (`tests/renderer-no-hardcoded-color.test.mjs`) MUST pass after every stage — any raw color literal introduced by an upstream CSS file MUST be migrated to `var(--color-*)` before the stage's commit.

### §4.3 Font bundling (handoff §03 Task 2 last bullet)

CSP currently is `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`. There is NO `font-src` directive, which falls back to `default-src 'self'`. CDN fonts (Google Fonts, jsdelivr, etc.) are FORBIDDEN.

Resolution:

1. Locally bundle Noto Serif SC, Noto Sans SC, JetBrains Mono WOFF2 files under `apps/lawbar-desktop/renderer/fonts/`. SIL OFL 1.1 license (free for desktop bundling). Verify license file is committed alongside.
2. Extend the `build:assets` npm script in `package.json` so the build copies `renderer/fonts/` to `dist/renderer/fonts/`.
3. Reference fonts via `@font-face` rules inside `cn-overlay.css` (or a dedicated `fonts.css` stage; this plan recommends folding into `cn-overlay.css` to keep stage boundaries clean).
4. Verify the smoke test still loads under `LAWBAR_MODE=dev`. Add a smoke assertion that the computed `font-family` of `document.body` includes "Noto Sans SC" OR another CJK fallback (graceful when fonts fail to load).

---

## §5 — Plan C symbol handling strategy

Per handoff Appendix verbatim:

### §5.1 Class definition

- `.lb-mk` is defined in `v13-mark.css` (handoff §02 B file 8).
- Form: pentagonal archive-index mark — rounded top + V-tip bottom + two index lines.
- Render: CSS `mask-image` + inline SVG; monocolor via `currentColor`.

### §5.2 Size + color matrix

| Position | Size | Color |
|---|---|---|
| Page hero eyebrow (login / workbench / case detail) | 20–24px | `.lb-mk--accent` |
| Card card-eyebrow | 16px | honey-orange OR default ink |
| Table toolbar label | 12–14px | default ink |
| Reverse background | — | `.lb-mk--reverse` |

### §5.3 Replacement rules

1. `grep "§"` in `apps/lawbar-desktop/renderer/` source = 0 before commit. Current state: ZERO `§` literals in renderer source (verified via `grep -rn "§" apps/lawbar-desktop/renderer/`); only documentation comments may carry `§`. The impl WI MUST NOT introduce `§` characters in user-facing strings.
2. Wherever the impl WI's localization pass produces a heading or section-marker that the design specifies as indexed, the impl WI inserts `<span class="lb-mk"></span>` rather than `§`.
3. Plan A / B / D variants UNUSED.
4. Never use `.lb-mk` as a logo at sizes > 24px. The CSS does not provide larger sizes.

### §5.4 Insertion sites (initial impl scope)

The impl WI inserts `<span class="lb-mk"></span>` at:

- Each screen's primary `<h1>` (eyebrow before the title text).
- `listMatters.ts` filter-chip toolbar (table-toolbar size 12–14px).
- `viewMatter.ts` tab-bar (card-eyebrow size 16px).
- `archiveMatter.ts` quote block (page-hero size 20–24px, `--accent` variant).
- Future placeholder screens (workbench / login / etc.) at their respective hero positions.

The DOM helper `field()` in `renderer/dom.ts` is NOT extended to add `lb-mk` automatically (would surprise downstream); the impl WI inserts the span explicitly at each call site.

### §5.5 No-op when v13-mark.css is unavailable

If `v13-mark.css` cannot be located, the impl WI STOPS (per §"Hard stops"). The plan does NOT permit synthesizing the `.lb-mk` definition from scratch — the SVG mask path is design-authored and must come from the source file.

---

## §6 — Visual-placeholder strategy

Per handoff §03 Task 4 + §08 hard stops: every "future functional" screen must render as a visual placeholder whose user interactions land in `console.log({event, payload})` OR a local closure-scoped variable. Zero IPC channel calls. Zero persistence writes.

### §6.1 Screens to surface as visual placeholders

| Screen | Placeholder behavior | Mount strategy |
|---|---|---|
| **Workbench** (汇总三类台账派生统计) | Reads existing matter rows from the same `api.listMatters` IPC call the list screen uses; derives counts per `ledgerCategory()` group; displays cards | Renders inline at the top of `#/matters` view (above the table) when the user is on the active-list tab; toggle via local `showWorkbench` state. ALSO reachable as a live `mountDesignPreview("workbench")` overlay per H1 reconciliation. |
| **Todo calendar** (待办日程) | Pure local `let todos: Todo[] = []` closure variable; "add todo" button appends to array; "complete" toggles a boolean; month/week views are pure render functions over the array | Renders as a tab inside `viewMatter.ts` right-rail OR as a sub-section of the workbench. NOT a router route. ALSO reachable as `mountDesignPreview("todo-calendar")` per H1. |
| **Archived view** (已归档) | Already exists as `#/matters` `?status=archived` tab. The placeholder addition is the visual treatment per `v08-additions.css`. No new mount. | Reuses existing `listMatters.ts` archived tab. |
| **Login / register / reset** (登录 / 注册 / 重置) | Submit handler logs `console.log({ event: "login_submit", payload: { username: <value> } })`. No call to any real auth provider. No password persistence. | **Per H1 reconciliation (rev-0.1)**: the handoff §03 Task 4 permits these screens to be ADDED as new mount entries in the renderer (可作为新的 mount 入口加入 renderer); the constraint §01 simultaneously forbids route changes (不改路由). The reconciled strategy is **live in-renderer mount via a NON-router mechanism**: (a) `renderer/index.ts` adds a `mountDesignPreview(target: "login"\|"register"\|"reset"\|"workbench"\|"todo-calendar")` helper that swaps `#app` contents without touching `window.location.hash`; (b) the helper is invocable from the existing screens (e.g., a workbench "Show login preview" button), from devtools (`window.lawbarDesignPreview.show("login")`), or via a query-string param resolved by `index.ts` BEFORE `attachRouter` fires (e.g., `?design-preview=login`). The mount is LIVE — the screen renders in the actual renderer, with the same CSS + tokens — but the router still sees only the 4 v1 routes. **No new entry in `renderer/router.ts`'s `RouteName` / `parseHash` / `buildHash`.** A static `dev-memo/design-evidence/login.html` MAY still be authored for screenshot purposes; that is secondary. The query-string + devtools mount is the load-bearing path. |
| **Upload sheet** | Visual `<dialog>` element opened by an "上传" button click; submit handler logs the file-name string the user typed; NO actual `<input type="file">` browse, NO `FileReader`, NO network. | Renders inside `viewMatter.ts` right-rail "上传" button click handler. |
| **File rows** | Static placeholder rows with synthetic filenames (`document-fixture-A.pdf`) read from a local closure array. NO `fs.readdir`, NO Electron `dialog.showOpenDialog`. | Renders inside `viewMatter.ts` right-rail "最近材料" panel. |
| **Mini Program "最近同步" indicator** | Renders a static "最近同步: —" line. NO ping, NO network. | Renders as a status-bar footer item if the desktop-shell layout introduces a status bar. |
| **Calendar / month-week views** | Pure render over the local `todos` array. NO Electron native menu, NO system notification, NO IPC. | Same surface as todo calendar. |

### §6.2 Placeholder-event log schema

Every placeholder onClick / onSubmit / onChange MUST log via `console.log` in this shape:

```ts
console.log({
  event: "<scope>:<action>",  // e.g., "upload:submit", "login:submit", "todo:complete"
  payload: { /* user-supplied values; NO server-authority fields */ },
});
```

`<scope>` ∈ {`upload`, `file`, `login`, `register`, `reset`, `mp`, `todo`, `calendar`, `workbench`, `audit`}.

### §6.3 Local-state-only stores

All placeholder state lives in closure-scoped TypeScript variables OR per-screen `Map<string, unknown>` instances. NEVER in `window.localStorage`, `window.sessionStorage`, `window.indexedDB`, or any persistent surface.

---

## §7 — Explicit future functional exclusions

Sourced verbatim from handoff §04 + §08. The impl WI's commit message MUST repeat this list.

### §7.1 NOT IN THIS LANE — Future Lane A (file management)

- Real file upload chain (chunking / resumable / multi-file).
- File preview engine (PDF / DOCX / scanned).
- Download authorization / watermarking / signing / trusted timestamps.
- File version chain + original-retention policy.
- File-level confidentiality permissions + `confidentiality_class` inheritance.
- Writing upload / update / download events to the audit chain.

### §7.2 NOT IN THIS LANE — Future Lane B (WeChat mini-program + sync)

- Mini-program engineering (login / session / RPC).
- Desktop ↔ mini-program sync protocol (incremental / conflict resolution / last-write-wins).
- Real "最近同步" pull + timer.
- Mini-program file preview / download implementation.

### §7.3 NOT IN THIS LANE — Future Lane C (todo / calendar persistence)

- Schedule persistence (schema / main-process IPC / SQLite).
- Reminder triggering (local notification / system banner / push).
- Auto-state derivation ("已逾期" computation + periodic refresh).
- Conflict resolution (same schedule edited on two ends).
- Auto-deadline inference from documents.

### §7.4 NOT IN THIS LANE — Future Lane D (auth + account sync)

- WeChat OAuth / OpenID / UnionID.
- Session management (token / refresh / logout).
- "Same WeChat = same lawyer" backend resolution.
- Username / password persistence + hashing.
- Account merge / conflict prevention (one WeChat bound to two accounts).
- Password reset chain + deregistration / unbinding.

### §7.5 NOT IN THIS LANE — Future Lane E (OCR; indefinite)

- OCR engine integration / queue / retry.
- OCR text preview / structured extraction.
- OCR auto-deadline recognition / auto-classification.
- This lane explicitly DOES NOT render ANY OCR-related label, status, or count.

### §7.6 ALSO NOT IN THIS LANE — Architectural lock

- No route change (no new entries in `renderer/router.ts`; no `parseHash` regex change).
- No IPC channel change (no new entry in `electron/preload.mts`; no new `ipcMain.handle` in `electron/main.ts`).
- No preload bridge change.
- No main process change.
- No persistence layer change.
- No DTO change in `renderer/types.ts` OR `src/caseBox/dto.ts`.

---

## §8 — Slice plan (small reviewable commits)

Each slice is one commit. The impl WI runs through them sequentially. Each slice independently rebuilds, lints, and passes all existing tests. No slice introduces a regression that a subsequent slice fixes.

| Slice | Scope | Files | Tests added or updated |
|---|---|---|---|
| **S1** | Local font bundle + CSP-safe font-face declarations | `apps/lawbar-desktop/renderer/fonts/*.woff2` + license files; `package.json` `build:assets`; tiny `@font-face` stub in `index.css` | Smoke: `font-family` computed style on `body` includes a CJK family name |
| **S2** | Token replacement (palette only; no component rules yet) | `apps/lawbar-desktop/renderer/index.css` `:root` blocks; `apps/lawbar-desktop/src/theme/tokens.ts`; `apps/lawbar-desktop/tests/main.test.mjs` palette-sync test | Palette-sync continues passing; existing visual screens look "off-brand" but functional |
| **S3** | `editorial-styles.css` + `desktop-shell.css` ported into `renderer/index.css` end | `renderer/index.css` (append); `renderer/index.html` (add `.titlebar` / `.sidebar` / `.status-bar` scaffold around `<main id="app">`) | Renderer-color lint passes; smoke verifies new shell wrappers are present; existing routes still render |
| **S4** | `cn-overlay.css` + `v12-typography.css` ported | `renderer/index.css` (append) | Renderer-color lint passes; smoke verifies CJK font is applied |
| **S5** | `format.ts` extension: `ledgerCategory` + label helpers | `apps/lawbar-desktop/renderer/format.ts`; `apps/lawbar-desktop/renderer/types.ts` (add `LedgerCategory` type only); NEW `tests/renderer-format-ledger.test.mjs` | New ledger-category mapping unit test (6 inputs × expected outputs) |
| **S6** | `listMatters.ts` localization + Plan C `lb-mk` insertion + category-derived header | `renderer/screens/listMatters.ts` | Existing `tests/renderer-list-matters.test.mjs` assertions updated to match the new Chinese strings (string-equality assertions become CJK); add a Plan C marker presence assertion |
| **S7** | `createMatter.ts` localization + category-select first step | `renderer/screens/createMatter.ts` | `tests/renderer-create-matter.test.mjs` updated; new test asserts a category-select chip group is rendered and submitting without choosing a category fails validation |
| **S8** | `viewMatter.ts` localization + tabbed layout + right-rail placeholders (upload button / 下一期限 / 最近材料 — all `console.log`) | `renderer/screens/viewMatter.ts` | `tests/renderer-view-matter.test.mjs` updated; new tests assert: (a) clicking "上传" logs `{ event: "upload:open", ... }`; (b) right-rail placeholders render without any IPC call beyond `api.getMatter` + `api.chainHead` |
| **S9** | `archiveMatter.ts` localization + quote block + summary `<dl>` + yellow tip + char count | `renderer/screens/archiveMatter.ts` | `tests/renderer-archive-matter.test.mjs` updated |
| **S10** | `v08-additions.css` + `v11-auth.css` ported. Add `mountDesignPreview(target)` live mount helper per §6.1 rev-0.1 H1 reconciliation: `renderer/index.ts` resolves a `?design-preview=login\|register\|reset\|workbench\|todo-calendar` query string BEFORE `attachRouter` fires AND exposes `window.lawbarDesignPreview.show(target)` for devtools invocation. **NO router additions** (router.ts unchanged). Static `dev-memo/design-evidence/*.html` files MAY be authored as a secondary screenshot surface only; the live mount is the load-bearing path. | `renderer/index.css` (append); `renderer/index.ts` (add `mountDesignPreview` helper); OPTIONAL `dev-memo/design-evidence/login.html` etc. | Unit test asserting `mountDesignPreview("login")` mounts the login layout into a mock `#app` without invoking `attachRouter`; renderer-localization-shape lint covers the new screens |
| **S11** | `v13-mark.css` ported + `lb-mk` spans added at all eyebrow positions | `renderer/index.css` (append); minor edits in each `renderer/screens/*.ts` to insert spans | New `tests/renderer-localization-shape.test.mjs`: every screen module exports / renders at least one `<span class="lb-mk">` |
| **S12** | Renderer-internal localization-shape lint + smoke rewrite for new shell | NEW `apps/lawbar-desktop/tests/renderer-localization-shape.test.mjs`; UPDATE `apps/lawbar-desktop/tests/smoke.electron.test.mjs` if shell wrappers change visible structure | Smoke continues passing |
| **S13** | Packaged UI flow update for localized strings + new Plan C markers | UPDATE `apps/lawbar-desktop/tests/casebox-ui.electron.test.mjs` selectors to use `data-test-id` (already in place) and CJK string assertions; repackage app via `npm run dist`; rerun packaged flow | 3 consecutive packaged UI runs pass |
| **S14** | Manual evidence file + audit closure | NEW `dev-memo/manual-evidence-casebox-ui-design-hardening-00.md`; cc-suite audit + verify cycle | cc-suite audit returns CLEARED (or with only acceptable Lows); cc-suite verify returns ALL CLOSED |

LOC sanity check: largest single file delta is `renderer/index.css` (current ~440 → target ~1400, increase ~960 LOC additive). Total impl-WI delta estimate ~3500 LOC including the eight CSS porting stages, screen localizations, type-format extensions, fonts, evidence, and audit-closure docs. Each individual file stays under loc-guardian thresholds.

---

## §9 — Tests and verification checklist

### §9.1 Hard-pass gates (per handoff §06A)

| ID | Test | Command |
|---|---|---|
| T1 | Palette-sync test passes | `node --test apps/lawbar-desktop/tests/main.test.mjs` |
| T2 | Renderer-import lint passes | `npm --prefix apps/lawbar-desktop run lint:renderer-imports` |
| T3 | `tsc --noEmit` passes | `npm --prefix apps/lawbar-desktop run build:ts` |
| T4 | Build no errors | `npm --prefix apps/lawbar-desktop run build` |
| T5 | All existing routes reachable | `node --test apps/lawbar-desktop/tests/renderer-router.test.mjs` (router unchanged) |
| T6 | `:focus-visible` outline rule preserved (honey-orange 2px + 2px offset OR equivalent token name) | Manual smoke + assertion inside `tests/main.test.mjs` palette section |
| T7 | Renderer-color lint passes (no hard-coded color outside canonical `:root` blocks) | `npm --prefix apps/lawbar-desktop run test:ui-color` |
| T8 | `grep "§"` in `apps/lawbar-desktop/renderer/` source = 0 | `grep -rn "§" apps/lawbar-desktop/renderer/ \|\| echo OK` |
| T9 | No-real-data scanner passes | `npm --prefix apps/lawbar-desktop run check:no-real-data` |
| T10 | DTO sync test passes (renderer-side allowlists still match canonical `dto.ts`) | `npm --prefix apps/lawbar-desktop run test:ui-shape-sync` |
| T11 | Renderer-router test passes (Crockford regex unchanged) | `npm --prefix apps/lawbar-desktop run test:ui-router` |
| T12 | All four screen tests pass with localized assertions | `npm --prefix apps/lawbar-desktop run test:ui-list-matters && ...create-matter && ...view-matter && ...archive-matter` |
| T13 | API wrapper + DOM helper tests pass | `...test:ui-api && ...test:ui-dom` |
| T14 | New ledger-category mapping test passes | `node --test apps/lawbar-desktop/tests/renderer-format-ledger.test.mjs` |
| T15 | Localization-shape lint passes (every screen has CJK string + ≥1 `lb-mk` span) | `node --test apps/lawbar-desktop/tests/renderer-localization-shape.test.mjs` |
| T16 | Smoke test passes against new shell | `node --test apps/lawbar-desktop/tests/smoke.electron.test.mjs` |
| T17 | Packaged UI flow passes | `npm --prefix apps/lawbar-desktop run test:ui-packaged` |
| T18 | Default `npm test` exits 0 (full suite including all 15+ test files) | `npm --prefix apps/lawbar-desktop test` |

### §9.2 Out of this lane (per handoff §06B)

- 8 new placeholder screens' functional reachability — documented only.
- Real file upload / download / preview e2e — Future Lane A.
- Real auth / session e2e — Future Lane D.
- Real schedule / reminder e2e — Future Lane C.
- Mini-program tests — Future Lane B.

---

## §10 — Manual screenshot / evidence checklist

Per handoff §07. The impl-WI's manual-evidence file `dev-memo/manual-evidence-casebox-ui-design-hardening-00.md` MUST attach the following nine screenshots (or honestly record which were not captured):

| # | Screenshot | State |
|---|---|---|
| 1 | Login page (default) | Dual entry + sync footer |
| 2 | Workbench | Three ledger cards + today's todo + lawyer calendar preview |
| 3 | Litigation case ledger | List + filter chip + Plan C eyebrow |
| 4 | Litigation case detail | Tabbed + right-rail colophon · 下一期限 · upload button |
| 5 | Create case (category-select first step) | Initial chip group visible |
| 6 | Upload sheet A | In-case · pre-selected |
| 7 | Archive confirmation | Quote + summary + yellow "不删除任何文件" tip |
| 8 | Dark / light contrast | Any screen, both themes |
| 9 | ≤640px collapsed | Any screen at narrow window |

Honest deferral pattern (per prior lane's evidence file): screenshots requiring GUI + VoiceOver MAY be deferred to user workstation. The evidence file documents this honestly.

---

## §11 — Hard-stop self-check

Per handoff §08, the impl WI STOPS immediately at any of the following:

| # | Trigger | Action |
|---|---|---|
| HS1 | A required edit needs a NEW IPC channel, preload bridge, or main process file | STOP + ask user |
| HS2 | A required edit needs a DTO field change in `renderer/types.ts` OR `src/caseBox/dto.ts` | STOP + ask user |
| HS3 | A required edit needs persistence write (`fs` / `sqlite` / `localStorage` / `IndexedDB` / blob) | STOP + ask user |
| HS4 | A required edit needs real WeChat OAuth / third-party SDK / network request | STOP + ask user |
| HS5 | A required edit needs OCR engine / file-parsing / file-preview | STOP + ask user |
| HS6 | Palette-sync test fails because of a token change | Fix `src/theme/tokens.ts` to restore byte-equality; continue |
| HS7 | A required edit crosses "make the button actually work" line — i.e., wires a placeholder onClick to anything beyond `console.log` or local state | STOP + leave `console.log` placeholder + ask user |
| HS8 | OCR is reactivated in ANY form | STOP + ask user |
| HS9 | The eight CSS source files referenced by handoff §02 are not located in the working tree AND the user has not pasted their content inline | STOP + ask user |
| HS10 | The locally-bundled WOFF2 font files are missing AND no fallback is acceptable | STOP + ask user OR fall back to system CJK font with a smoke assertion |
| HS11 | A required edit would RENAME an existing token name (e.g., `--color-accent` → `--color-accent-honey`). Per handoff §03 Task 1 "保留所有现有 token 名称" and §4.1 rev-0.1 reconciliation | **STOP + ask user** — auto-aliasing is forbidden; only explicit user authorization permits a rename, and the palette-sync test MUST be updated in the same slice |

This list is REPEATED verbatim in the impl-WI's commit message template and in `dev-memo/manual-evidence-casebox-ui-design-hardening-00.md` §"Hard-stop self-check".

---

## §12 — Open questions / risks

### §12.1 Open questions (each → STOP-AND-ASK at impl-WI authorization)

1. **CSS source-file location** — see review-question 1. Plan recommendation: place the eight CSS files under `dev-memo/design-source/` as a one-time committed import; impl WI references them directly during the porting stages; AFTER S11 they are kept as historical reference (not deleted) so future audits can re-derive the canonical mapping.
2. **Token-category scope** — see review-question 2. Plan recommendation: extend `src/theme/tokens.ts` with parallel `SPACING_TOKENS` / `TYPOGRAPHY_TOKENS` / `RADIUS_TOKENS` / `SHADOW_TOKENS` exports AND extend the palette-sync test to enforce byte-equality across all four categories. This is a Medium-sized test-rewrite scope but locks the source-of-truth invariant.
3. **Localization completeness** — does the impl WI replace EVERY user-facing English string in the four screens, OR does it leave technical labels (`ULID`, `UTC`, `URL`) untranslated? Plan recommendation: replace all user-facing display labels; leave technical token-style strings in their original form.
4. **Placeholder-screen reach surface** — see review-question 4. Plan recommendation **(updated per H1 reconciliation rev-0.1)**: live in-renderer mount via the NON-router `mountDesignPreview(target)` helper (devtools-invocable + query-string-resolved BEFORE `attachRouter` fires). NO router additions. Static `dev-memo/design-evidence/*.html` files MAY be authored as a secondary screenshot surface but are NOT the load-bearing path.
5. **Visual-placeholder mount-point conflicts** — workbench inside `#/matters`: does it ADD to the existing scaffold or REPLACE the existing list-screen header? Plan recommendation: ADD above the table; behind a local `let showWorkbench = true` toggle defaulting to `true` so screenshots capture the new surface by default.

### §12.2 Risks (severity-marked)

- **High** — CSS-file collision: if the eight source CSS files redefine selectors already in use (`.button`, `.field`, `.status-pill`), the impl WI MUST resolve collisions BEFORE appending; otherwise S3/S4 introduces visual regressions that S6/S7 inherits silently. Mitigation: at each CSS-porting stage, run the renderer-color lint AND a manual visual smoke (open dev mode + walk each screen).
- **High** — Token-rename breakage: if a new `editorial-tokens.css` palette removes or renames an existing token (e.g., `--color-accent` → `--color-accent-honey`), every existing rule referencing the old name breaks. Mitigation **(updated per M1 reconciliation rev-0.1)**: rename of existing token name is **FORBIDDEN by default** — see §4.1 step 3 case (c) and §11 HS11. The impl WI MUST stop and request explicit user authorization before any rename; auto-aliasing is explicitly forbidden. Only the VALUE-change-with-name-preserved path (case a) and additive-new-token path (case b) are allowed without STOP-AND-ASK.
- **Medium** — Font-loading race: if WOFF2 files fail to load (path mismatch, asar packaging issue), CJK characters fall back to system serif which may not have the desired weight. Mitigation: smoke assertion that `getComputedStyle(document.body).fontFamily` includes a known fallback name; manual visual smoke in dev mode.
- **Medium** — Localization regression: existing screen tests assert English string equality. If the impl WI updates one assertion but misses another, CI passes but the UI shows mixed-language output. Mitigation: localization-shape lint (`renderer-localization-shape.test.mjs`) asserts every screen has ≥1 CJK codepoint AND no isolated English word in user-facing positions.
- **Low** — Plan C `.lb-mk` mask-image render gotcha in older Chromium versions. Mitigation: target Electron 34 (current); CSS `mask-image` is supported. Add a smoke assertion that the mask renders at non-zero width.
- **Low** — Placeholder `console.log` noise during normal use. Mitigation: gate the logs behind `if (process.env.NODE_ENV !== "production") { console.log(...) }` per `renderer/index.ts` capability OR a dedicated `placeholderLog()` helper that respects a debug flag.

### §12.3 STOP-AND-ASK items the impl-WI's authorization MUST address

1. **Confirm CSS source files are available** (per HS9) — name the eight files' location OR paste content.
2. **Confirm WOFF2 font bundling decision** — locally bundled with SIL OFL 1.1 license file, OR fall back to system CJK font with a smoke acceptance.
3. **Confirm token-category scope** — colors-only palette-sync, OR extend to spacing/typography/radius/shadow.
4. **Confirm placeholder-screen reach strategy** — live in-renderer mount via `mountDesignPreview(target)` per §6.1 rev-0.1 reconciliation (devtools-invocable + query-string-resolved; NO router change), with optional static `dev-memo/design-evidence/*.html` companion files. User confirms the helper's exact name + invocation surface (query-string param `design-preview` and devtools global `window.lawbarDesignPreview.show(target)`).
5. **Confirm localization replacement scope** — full Chinese rewrite, OR i18n map with English fallback.

---

## §13 — Hard-stop list (inherited from `.claude/rules/autonomy.md`)

In addition to the handoff §08 list above, the impl WI inherits the global hard-stop list:

- `git push` without explicit per-invocation authorization.
- `git push --force` / `git push --force-with-lease` (never autonomous).
- Branch deletion / `git reset --hard` / `git clean` / broad `git restore .` / `git checkout -- .` / `git checkout <other-branch>` from inside an in-flight WI.
- Deploy / release / publication / "go-live" announcement.
- Destructive broad deletes (`rm -rf` on tracked trees).
- Editing `~/.claude` or global machine config outside the repo.
- Real secrets / credentials / billing / external accounts.
- Auth provider choice.
- Cloud vendor / public deployment.
- Exposing legal documents to external services.
- Irreversible migrations on real data.
- Production data operations.
- Final go-live approval — design hardening does NOT imply go-live readiness.
- New runtime dependency.
- Public API / wire-format / schema / CLI breaking change (visual-only lane).

---

## §14 — Out-of-scope (re-affirmed in narrative form)

This WI is visual-only. It touches:

- Renderer CSS (additively).
- Renderer HTML (shell wrappers; no semantic surface change).
- Renderer TypeScript (screen string literals + new `ledgerCategory` formatter + `LedgerCategory` type).
- Renderer tests (assertion-text updates + new category mapping test + localization-shape lint).
- Theme tokens (additive + atomic palette refresh in lockstep with CSS + palette-sync test).
- Locally bundled font assets.
- Manual evidence dev-memo.

This WI does NOT touch:

- IPC channels (5 v1 channels final).
- Preload bridge (`window.lawbar.{theme,caseBox}` surface final).
- Main process (`electron/main.ts`).
- Persistence (`src/caseBox/caseBoxRuntime.ts` + in-memory backing final).
- DTO shapes (`src/caseBox/dto.ts` + `renderer/types.ts` field arrays final; sync test continues passing UNCHANGED).
- Router (`renderer/router.ts` Crockford regex final; four routes final).
- Renderer lint scripts (`scripts/check-renderer-imports.mjs` final).
- No-real-data scanner (`scripts/check-no-real-data.mjs` final).
- WI-2 wrapper (`scripts/test-packaged-wrapper.mjs` final).
- Services / contracts / ADRs / release docs.

---

## §15 — Sequencing and follow-up WIs

1. **THIS plan-WI** — commit `dev-memo/plan-casebox-ui-design-hardening-00.md` alone. User authorizes → cc-suite review-plan → READY-or-Low → user authorizes promotion commit + status flip to `READY`.
2. **`WI-casebox-ui-design-hardening-impl`** — implements §3 file set across the §8 slice plan. Carries the 11-field cc-suite recording (review-plan job ID from step 1 + per-slice review-plan IDs if any major slice requires re-review + final audit + verify).
3. **(Optional) `WI-casebox-design-source-import`** — if the eight CSS source files need to be committed to `dev-memo/design-source/` as a one-time freeze, it MAY be a separate small commit BEFORE S3 starts.
4. **Future lane (per handoff §04)** — each of Lane A / B / C / D / E gets its own plan + impl + audit cycle when authorized.

This plan does NOT pre-authorize steps 2-4. Each requires its own plan + review + audit + verify cycle.

---

## §16 — How this plan relates to existing READY plans

| Plan | Relationship | Conflict? |
|---|---|---|
| `plan-casebox-ipc-impl-01.md` rev-0.3 READY-with-Low | The impl WI MUST NOT change the IPC surface this plan codifies. Visual lane consumes the existing 5 channels unchanged. | No. |
| `plan-casebox-ui-plan-00.md` rev-0.1 READY-with-Low | The impl WI EXTENDS the UI surface this plan defined. The four routes, error-display semantics, accessibility patterns, and in-memory backing posture are preserved. | No. |
| `plan-first-ui-shell-00.md` rev-2 READY | The ZERO-imports rule for renderer/index.ts was already relaxed in the prior UI plan. This lane extends the renderer-internal-import surface but does NOT permit imports out of `renderer/`. The lint enforces this. | No. |
| `plan-night-mode-foundation-00.md` READY | The 12-token foundation is the source of truth. This lane ADDS tokens (palette refresh + new category exports) but does NOT redefine existing token names. Palette-sync test continues passing. | No (with strict adherence to alias/atomic-rename rules in §4.1). |
| `docs/product/project-requirements-brief.md` revision 5 READY | This lane's visual changes do not touch §3 (Mac primary), §6 (local-first), §11 (audit log), §12 (LLM/OCR shelved), §20 (STOP-AND-ASK) directives. | No. |
| `docs/adr/case-box-step-*` | Untouched. | No. |

---

## §17 — Review-item disposition table

### 11-field cc-suite recording per `.claude/rules/cc-suite.md` §"Required recording"

This block is the load-bearing review-plan recording for the plan-WI's commit message. The impl-WI inherits + extends with its own audit + verify recordings.

| Attempt | 1. Kind | 2. Target scope | 3. Resolved runner path | 4. Model / effort / sandbox | 5. Job ID | 6. threadId | 7. Output location | 8. Retrievable? | 9. Failure class | 10. Retries | 11. Fallback reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | review-plan | `dev-memo/plan-casebox-ui-design-hardening-00.md` rev-0 (full prompt) | `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` | gpt-5.5 / high / read-only / per-command default | `review-plan-mppnfj57-v6zm6i` | n/a (failed pre-thread) | `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mppnfj57-v6zm6i.{json,log}` | YES (terminal state `failed` written) | **RUNNER_ERROR** — `spawnSync codex ENOBUFS` (`codex-runner.mjs:70` uses `spawnSync` with Node default `maxBuffer` 1 MB; Codex response exceeded) | 1 | Retry compact prompt → attempt 2 |
| 2 | review-plan | rev-0 (compact prompt + 5 KB cap) | same runner | gpt-5.5 / high / read-only | `review-plan-mppnlzpi-d289fi` | n/a | same state dir | YES | **RUNNER_ERROR** — same ENOBUFS class | 1 | Path 1 exhausted; fall to Path 2 MCP |
| 3 | review-plan | rev-0 (compact; load-bearing) | Path 2 direct MCP `mcp__codex-cli__codex` | gpt-5.3-codex / high / read-only / per-command default | MCP-managed (no Path 1 jobId) | MCP-managed (preserved in MCP session log) | MCP response inline in this conversation transcript | n/a (MCP path; not retrievable via `/cc-suite:status`) | n/a (success) | n/a | Path 1 RUNNER_ERROR repeated; per `.claude/rules/cc-suite.md` §"Failure handling" RUNNER_ERROR → Path 2 acceptable |
| 4 | review-plan | rev-0.1 (re-review) | Path 2 MCP | gpt-5.3-codex / high / read-only | MCP-managed | MCP-managed | inline | n/a | n/a (success; verdict NEEDS-RECONCILIATION) | n/a | n/a |
| 5 | review-plan | rev-0.2 (re-review after §8/§12 sweep) | Path 2 MCP | gpt-5.3-codex / high / read-only | MCP-managed | MCP-managed | inline | n/a | n/a (success; verdict NEEDS-FIX) | n/a | n/a |
| 6 | review-plan | rev-0.2 (final re-review after Review-Q #4 sweep) | Path 2 MCP | gpt-5.3-codex / high / read-only | MCP-managed | MCP-managed | inline | n/a | n/a (success; verdict `READY`) | n/a | n/a |

**Aggregate**: 2 Path 1 RUNNER_ERROR attempts → 4 Path 2 MCP successful re-reviews → final `READY`. No Path 3 (`codex exec` CLI) attempts. No Path 4 (user manual run). No deferred findings.

### Rev-0 → rev-0.1 (review chain; verdict NEEDS-RECONCILIATION; 0 C / 1 H / 1 M / 1 L)

| Finding ID | Severity | Reviewer wording (compressed) | Resolution in rev-0.1 |
|---|---|---|---|
| H1 | High | §6.1 says login/register/reset are docs-only static evidence "NEVER mounted by the live router"; handoff §03 Task 4 permits these as "新的 mount 入口加入 renderer". Plan contradicts source-of-truth intent. | §6.1 Login/register/reset row rewritten: permit LIVE in-renderer mount via NON-router mechanism (`mountDesignPreview(target)` helper, devtools-invocable, query-string `?design-preview=…` resolvable BEFORE `attachRouter` fires); router stays at 4 v1 routes (constraint §01 preserved); static evidence file demoted to secondary screenshot purpose. Workbench + todo-calendar rows also extended to reference `mountDesignPreview()`. |
| M1 | Medium | §4.1 step 3 admits canonical rename in lockstep; handoff §03 Task 1 states "保留所有现有 token 名称". Plan as written permits a path that violates source-of-truth. | §4.1 step 3 rewritten as three explicit cases: (a) VALUE change with name preserved — ALLOWED; (b) purely ADDITIVE new tokens — ALLOWED; (c) RENAME of existing name — FORBIDDEN by default; STOP-AND-ASK per HS11. §11 HS11 added. Auto-aliasing explicitly forbidden. |
| L1 | Low | §1 row 2 expected `?? .claude/scheduled_tasks.lock` only; current state also has untracked handoff + plan files. Causes false STOP at impl entry. | §1 row 2 rewritten: tolerates two states (post-plan-commit clean, OR pre-plan-commit with handoff + plan untracked). Impl WI MUST NOT modify handoff input regardless of staging state. |

All findings closed inline in rev-0.1. Re-review required to confirm closure.

### Rev-0.1 → rev-0.2 (Path 2 MCP re-review; verdict NEEDS-RECONCILIATION; 0 C / 1 H / 1 M / 0 L)

| Finding ID | Severity | Reviewer wording (compressed) | Resolution in rev-0.2 |
|---|---|---|---|
| H1-residual | High | §6.1 fixed but §8 S10 + §12.1(4) + §12.3(4) still recommend "static `dev-memo/design-evidence/*.html`" as load-bearing path; reads as drift back to docs-only. | §8 S10 row rewritten to make `mountDesignPreview(target)` the load-bearing live mount + add the unit test for it; static evidence files now explicitly secondary. §12.1(4) updated to cite the same. §12.3(4) updated to confirm the helper's invocation surface (query-string + devtools global). |
| M1-residual | Medium | §12.2 risk row says "maintain backward-compatible alias OR atomic rename" — contradicts HS11 forbidden-rename rule. | §12.2 token-rename risk row rewritten: rename FORBIDDEN by default per §4.1 step 3 case (c) + HS11; auto-aliasing explicitly forbidden; only VALUE-preserved + additive paths are allowed without STOP-AND-ASK. |

Both findings closed inline in rev-0.2. Re-review required.

### Rev-0.2 → READY (Path 2 MCP final re-review; verdict `READY`; 0 C / 0 H / 0 M / 0 L)

Final re-review confirmed:
- `§6.1(4)`, `§8/S10`, `§12.1(4)`, `§12.3(4)` consistently set `mountDesignPreview(target)` as the load-bearing live mount; static `dev-memo/design-evidence/*.html` files are secondary-only.
- `§4.1(3)`, `§11/HS11`, `§12.2` consistently treat token rename as FORBIDDEN-by-default with STOP-AND-ASK; auto-alias forbidden.
- No new contradiction introduced by the sweep.

Plan promoted to rev-0.2 READY. No deferred findings.

---

## §18 — End-of-plan signature

This plan is plan-only. It does NOT implement any UI design hardening, modify any renderer file, install any font, add any CSS rule, run any test, or commit any product code. The impl WI is a SEPARATE later authorization.

Commit policy for this plan-WI: a single commit of `dev-memo/plan-casebox-ui-design-hardening-00.md` alone. Message convention: `docs(dev-memo): add case-box UI design-hardening plan rev-0 DRAFT-PENDING-REVIEW`. No push.

The handoff input file at `dev-memo/Lawbar Handoff v1.0 _standalone_.html` MUST remain UNCHANGED in this plan-WI's diff. The impl WI MAY add adjacent files under `dev-memo/design-source/` and `dev-memo/design-evidence/` but MUST NOT mutate the handoff itself.
