# Queue review 096 — WI-A3-LINK-UI-T1 (renderer UI impl for audited evidence links; A0.7 commit-gated)

**Date**: 2026-06-26.
**WI**: WI-A3-LINK-UI-T1 — renderer UI implementation for the audited link lifecycle (view/create/unlink/relink/export), consuming the merged `casebox:link:*` IPC. Type: UI; Design artifact: `dev-memo/design/2026-06-26-audited-evidence-links-ui.md`.
**Classification under review**: IMPL (Type: UI), A0.7 commit-gated (custody 9b). Broker review-plan + audit + verify REQUIRED.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed (round-5, READY) queue.md sha256**: `2eeaf40d654824cd5d8439f2f46aeff80ee8f9ba5a095a0048a4a96e360ecd9f` (rounds 3 + 5 both READY; round 3 bound `fe32dd19…` before the two bounded post-round-3 amendments — the `ui-strings-allowlist.json` allowed-file add + the corrected scope (4b) — were re-reviewed READY in round 5).

## Round 1 — review-plan → NEEDS-FIX
- **Kind**: review-plan (broker). **Path / runner**: Path 1 `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (native `--background`). **Model/effort/sandbox**: gpt-5.5/high/read-only.
- **Job ID**: `review-plan-mqv45rjm-g9d2h6`. **threadId**: none. **rawOutput sha256**: `d23f3077dced8644975cc013c5129621ecf1b932ae18c4348dc7ae229ea2f7d6`. **Retrievable?**: YES. **Failure class**: none. **Attempts**: 1.
- **Verdict**: NEEDS-FIX. A-D confirmed (consume-only; RendererLink-only contract; renderer-not-security-boundary; keep Requires-A07:yes). **High (E)**: D1 (real-db Electron `casebox:link:*` round-trip) cannot seed its prerequisite — `createLink` needs a scoped `case_box_anchors` row (`linkRepoQueries.ts:211`), there is NO `casebox:anchor:*` IPC, and a direct test-DB seed is Electron-ABI-blocked → closing D1 needs forbidden scope/new infra. **Low (C)**: an optional error-code→catalog map needs a tested mandatory fallback to the server safe message.

## Round 2 — review-plan (after D1-deferral amendment) → NEEDS-FIX
- **Job ID**: `review-plan-mqvl07zq-8z04iw`. **rawOutput sha256**: `301db1aafbd223b667f720e9bdf5034f3768eac06d76848247bdf238059fad08`. **Retrievable?**: YES. **Attempts**: 1.
- **Verdict**: NEEDS-FIX (three D1-deferral-completeness findings; A-D substance all confirmed). **High#1**: the Gates line still demanded "the D1 Electron integration round-trip GREEN". **High#2**: the `deferred-audit-findings.md` LINK-IPC-T1-D1 row still targeted D1 as "naturally bundled with the renderer/UI lane". **Medium**: the design artifact §11-12 still recommends folding D1 into the UI lane while the queue cites it as "THE design".

## Round 3 — review-plan (after the three round-2 fixes) → READY (Low items only)
- **Job ID**: `review-plan-mqvl4h6u-fxuvsq`. **rawOutput sha256**: `99832c885616734f6f6333c5f8e4f2f7f09d97a337f0f1144c4b57ea85bcf68c`. **Retrievable?**: YES. **Failure class**: none. **Attempts**: 1.
- **Verdict**: **READY with only Low items.** A-E all confirmed: the Gates line no longer demands D1; the deferred-findings row retargets D1 to a separate future WI (not bundleable into UI-T1); the queue explicitly supersedes the design §11-12 D1-fold wording without editing that artifact here; the renderer lane is coherent + verifiable with NO IPC/persistence/schema/contract change (canonical `*_LINK_DTO_FIELDS` + `RendererLink` already exist; no `src/caseBox` edit); RendererLink-only rows + export-flags-only-in-panel + renderer-not-security-boundary sound; keep `Requires-A07: yes`; D1/D2/D3/D4 deferred; `package.json` additive test-list is the right/only mechanism; the Design-artifact gate is satisfied; loc-guardian budget feasible if `viewMatterLinks.ts` stays under 800.

### Round-3 Lows (all folded before govern)
- **Low 1 → applied**: this review file now records rounds 1-3 + the READY verdict (round 2's "pending" trail is superseded).
- **Low 2 → applied (queue Commit boundary)**: "deferred-findings (D1 closure)" reworded to "the D1 carry-forward/deferral record — NOT a D1 closure".
- **Low 3 → applied (queue Scope)**: the renderer MUST use renderer-LOCAL export-citation types in `renderer/types.ts` and MUST NOT import `ExportCitationResult`/`ExportCitation` (or any type) from `case-box-persistence`/`src/caseBox` in renderer code (`check-renderer-imports` forbids it).

## Round 4 — review-plan (after the ui-strings-allowlist.json allowed-file amendment) → NEEDS-FIX
- **Job ID**: `review-plan-mqvlu0m6-sluzff`. **rawOutput sha256**: `54ee5ff2968b2d4fd55bcf174df4c0b73ec0438e6ab66c14a10208e2412e1f32`. **Retrievable?**: YES. **Attempts**: 1.
- **Context**: implementation discovered that wiring the new disclosure into `viewMatter.ts` shifts 3 PRE-EXISTING literals' line numbers; the i18n drift-guard keys its allowlist by exact `{file,line,text}`, so `ui-strings-allowlist.json` (NOT in the round-3 allowed-files) must change. The user authorized adding it to allowed-files for a bounded regeneration.
- **Verdict**: NEEDS-FIX (two High). The amendment wording claimed "line-number-only / zero new entries", but the lexical drift-guard flags EVERY array-position string literal — so the new `viewMatterLinks.ts` also contributes 20 scanner candidates (sourceType enum constants, export-flag iteration constants, separators, dynamic interpolated templates). Updating only the 3 line numbers would NOT make the guard green, and (4b)'s "zero new entries" claim was factually wrong. A/B/C confirmed otherwise (no hardcoded prose; consume-only; RendererLink-only; Requires-A07:yes).

## Round 5 — review-plan (after correcting (4b) + regenerating the allowlist) → READY
- **Job ID**: `review-plan-mqvm0y3l-z08xih`. **rawOutput sha256**: `6dedef12c1e964319e1a297810ce45e3165444e1c09ca57d91f46b4aef13292c`. **Retrievable?**: YES. **Failure class**: none. **Attempts**: 1.
- **Fixes**: (4b) rewritten to accurately describe the regeneration — 3 shifted `viewMatter.ts` line numbers + the 20 new `viewMatterLinks.ts` NON-PROSE scanner artifacts (5 sourceType enum values, 6 export-flag constants, 3 separators, 6 interpolated `t()`/field templates), the SAME class already allowlisted for facts/deadlines/docket; NO fixed prose literal allowlisted. `ui-strings-allowlist.json` regenerated via `scanAll()` (197 entries).
- **Verdict**: **READY** — Critical/High/Medium: none. One Low: the reviewer's read-only sandbox could not run `npm test` (`tsc` EPERM on `dist/**`); independently confirmed locally `npm --prefix apps/lawbar-desktop test` → **664/664**, `renderer-i18n-guard` 5/5, `check-contract-integrity.sh` PASS. A: (4b) accurate, not a drift-guard weakening. B: all prose via `t()`/catalog. C: consume-only / RendererLink-only / no `LINK_RESPONSE_FIELDS` change / export-flags-panel-only / renderer-not-security-boundary / Requires-A07:yes all hold. D: ready to govern; the complete implementation is in scope (exact-path staging; exclude untracked residue).

## Disposition
READY (no Critical/High/Medium) → eligible to govern. The three round-3 Lows + the round-4/5 D1-deferral-completeness + allowlist-amendment-accuracy fixes are all folded into the queue + this record. Proceeding to mark-reviewed + govern (standalone, content-bound to the round-5 sha `2eeaf40d…`), then the A0.7 custody-9b commit. D1/D2/D3/D4 stay deferred; NO IPC/persistence/schema/contract change; `ui-strings-allowlist.json` is a mechanical scanner-artifact regeneration only.

QUEUE_REVIEW_VERDICT=PASS
