# Queue review — WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00 (execution: global overdue-deadline dashboard banner)

Lane: EXECUTION of the governed Type:UI WI `WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00` — implement the global (cross-matter) overdue-deadline dashboard banner (gate-3 residual R2, brief §10) per the committed design artifact `dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md`.
Date: 2026-07-05. Branch: `gate3-r2-overdue-dashboard-banner` (from synced `main` @ `05da986`). Batch: 1/3 since marker `0ad4fe6` — no batch closeout this lane.

## What shipped (6 renderer files + this artifact)
- **NEW `apps/lawbar-desktop/renderer/overdueDashboardBanner.ts`** — `mountOverdueDashboardBanner(container, deps)`. Client-side cross-matter aggregation over the EXISTING channels (`deps.api.listMatters` for active matters + per-matter `deps.api.listDeadlines`), classifying each deadline row with the **directly-imported** `classifyDeadlineUrgency` + `DEADLINE_DUE_SOON_WINDOW_MS` from `./format.js` (no reimplemented urgency rule). **Drains** both channels' pagination (follow `next_cursor` to null via a `drainPages<Row>` helper) with a `MAX_PAGES` cap + repeated-cursor `Set` guard; on any read `!ok` / cap / repeated-cursor / thrown read it renders a non-blocking `role="status"` **degraded** banner and never throws out. States: `role="status"` summary when overdue>0 or due-soon>0; hidden (empty) when both 0; degraded on failure.
- `renderer/screens/listMatters.ts` — a `bannerContainer` mounted at the top of `root` (above the header) + a **fire-and-forget** `void mountOverdueDashboardBanner(...)` so the banner load is INDEPENDENT of the matter-list load (neither failure breaks the other). Two pre-existing `listMatters` call-count assertions adjusted to filter `limit === PAGE_SIZE` (the list's own paged calls) so the banner's independent load does not skew them — same intent, not a weakening.
- `renderer/i18n/catalog.ts` — banner keys (`dashboard.overdue.summary` with `{overdue}`/`{dueSoon}` interpolation, `dashboard.overdue.error`), zh-CN, catalog convention.
- `renderer/i18n/ui-strings-allowlist.json` — pure line-number shift for the pre-existing `§` glyph literal (moved down by the banner-container insertion); NO new allowed literal.
- `renderer/index.css` — `.dashboard-overdue-banner` (+ `--overdue`/`--degraded`) using existing design tokens only (no hard-coded colour).
- `tests/renderer-list-matters.test.mjs` (existing, already-registered) — extended with the banner tests. NOTE: the WI Allowed-files said "a NEW tests/ renderer test", but a genuinely-new test file would require registering it in `apps/lawbar-desktop/package.json` `scripts.test`, and that file is a FORBIDDEN edit for this WI — so the banner tests were added to the already-registered home-screen test file instead (same `tests/` scope, honours the design artifact §8 "peer of renderer-list-matters.test.mjs", and avoids the forbidden package.json touch). Surfaced here rather than silently chosen.
`renderer/format.ts`, `renderer/screens/viewMatterDeadlines.ts` (the per-matter banner), `apps/lawbar-desktop/package.json`, `src/**`, `electron/**`, `services/**`, contracts, schema, and dependencies are ALL untouched. `CURRENT_SCHEMA_VERSION` stays 12. `docs/release/**` untouched (the R2 WI forbids release-doc changes; a future readiness-refresh reassesses gate 3).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
The fix touches renderer product code → the broker audit is REQUIRED. Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`. All diff-based invocations INLINED the unified diff into the prompt (the `apps/lawbar-desktop` tree-walk times codex out — see [[feedback_ccsuite_audit_inline_diff]]).

### /cc-suite:audit (on the fix diff, inlined)
- `audit-mr7x8bsm-xjkstn` · gpt-5.5/medium/read-only · **FINDINGS: C0 H1 M0 L0** · rawOutput sha256 `9e6757270d57aea4519acb1ef8bd48375333cda933fcd0213f04fb805230b673`. PASS on reuse / no-new-IPC / states / no-scope-creep / a11y-i18n-colour / test-quality. **H1**: the banner read only the first bounded page for matters + deadlines, ignoring `next_cursor` → overdue/due-soon deadlines beyond page 1 silently missed (a warning banner must not under-report).

### Fix (in-WI, per cc-suite audit-remediation — a High is fixed, not deferred)
Added `drainPages<Row>` — follows `next_cursor` to null for BOTH `listMatters` and per-matter `listDeadlines`, accumulating all rows; `MAX_PAGES` cap + repeated-cursor `Set` guard; on cap/repeat/read-error it DEGRADES (renders the degraded `role="status"` banner) rather than throws (appropriate for a non-blocking banner — deliberately unlike `t3CatalogSource.ts` which throws for an export). New regression tests (same file): a multi-page test placing the urgent deadline ONLY on page 2 of both channels (fails pre-fix — would count 0/0/hidden), and a repeated-cursor-degrades test.

### /cc-suite:verify (on the fixed diff, inlined)
- `verify-mr7xgtwe-h3u66s` · gpt-5.5/medium/read-only · **VERDICT: ALL CLOSED, C0 H0 M0 L0** · rawOutput sha256 `557036bbe694b5a6d131321a1146d9adf1110f96a470c7cb48c83af91b1bc173`. Confirms H1 CLOSED (drain + cap + repeated-cursor guard + degrade-not-throw + cursor propagation), no regression (reuse/no-new-IPC/states/a11y/i18n preserved), tests have teeth, no new drain bug.

## Gates (this execution lane)
- `npm --prefix apps/lawbar-desktop test` → **PASS 801 / 0 fail** (incl. the extended renderer-list-matters banner tests + the existing renderer-deadline-urgency / i18n-guard / no-hardcoded-color guards). tsc build clean.
- `scripts/workflow/check-queue.sh` PASS · `scripts/workflow/check-contract-integrity.sh` PASS (14 docs) · `CURRENT_SCHEMA_VERSION` 12. Diff confined to the 6 renderer files (banner module + listMatters + i18n catalog/allowlist + index.css + the extended test); no forbidden surface; no `docs/release`/`src`/`electron`/IPC/persistence/contract/dependency change.

## Verdict: READY (R2 global overdue-deadline dashboard banner; audit H1 fixed + verify ALL CLOSED; reuse-not-rebuild; UI-only data; gate 3 stays PARTIAL)

QUEUE_REVIEW_VERDICT=PASS

## Deferred findings
None. The audit's H1 was FIXED in-WI and verify returned ALL CLOSED. Gate 3 remains **PARTIAL**: R2 (this banner) is now implemented, but gate 3 still depends on gate 4 (signing/notarization/public distribution — a user STOP-AND-ASK) + R3 (bounded polish); the readiness report gate-3 row is intentionally NOT edited here (the R2 WI forbids release-doc changes — a future readiness-refresh reassesses gate 3). This does NOT imply go-live — the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops remain the user's.
