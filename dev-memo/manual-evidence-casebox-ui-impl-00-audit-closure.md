# Audit closure — WI-casebox-ui-impl (G-UI-25 + G-UI-26 + G-UI-28)

**Date**: 2026-05-27.
**Closure HEAD**: `1bc454ece05ef8637a7088a35921fedfdaf11bcf`.
**Lane**: case-box UI implementation (Slices 1-7 + Checkpoints 8-10 + audit
fix).
**Plan reference**: `dev-memo/plan-casebox-ui-plan-00.md` rev-0.1
READY-with-Low §10 G-UI-25, G-UI-26, G-UI-28.
**Manual evidence companion**: `dev-memo/manual-evidence-casebox-ui-impl-00.md`.

## 1. cc-suite 11-field invocation record

Per `.claude/rules/cc-suite.md` §"Required recording".

### 1.1 Audit invocation (initial attempt — FAILED)

| Field | Value |
|---|---|
| 1. Kind | `audit` |
| 2. Target scope | WI-casebox-ui-impl diff `e490686..36936eb`; renderer + tests + scanner + package.json |
| 3. Resolved runner path | `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` |
| 4. Model / effort / sandbox / approval | `gpt-5.5` / `high` / `read-only` / default per `.codex-toolkit.md` |
| 5. Job ID | `audit-mpoo9zwg-m6ccp8` |
| 6. Codex threadId | n/a (job failed before completion) |
| 7. Output / result location | `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/audit-mpoo9zwg-m6ccp8.{json,log}` |
| 8. `/cc-suite:status` / `/cc-suite:result` retrievable? | YES (runner reached terminal state `failed`) |
| 9. Failure classification | **RUNNER_ERROR** — `spawnSync codex ENOBUFS` (Node's spawnSync stdout buffer exceeded by Codex's response payload) |
| 10. Retry attempts | 1 attempt; full prompt; failed |
| 11. Fallback reason | Path 1 retried with COMPACT prompt + hard-cap response 6 KB (next invocation) |

### 1.2 Audit invocation (compact retry — SUCCEEDED)

| Field | Value |
|---|---|
| 1. Kind | `audit` |
| 2. Target scope | same as 1.1; compact prompt |
| 3. Resolved runner path | `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` |
| 4. Model / effort / sandbox / approval | `gpt-5.5` / `high` / `read-only` / default |
| 5. Job ID | `audit-mpoogs5r-akssld` |
| 6. Codex threadId | (preserved in job JSON `threadId` field) |
| 7. Output / result location | `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/audit-mpoogs5r-akssld.{json,log}` |
| 8. retrievable? | YES |
| 9. Failure classification | n/a (success) |
| 10. Retry attempts | n/a |
| 11. Fallback reason | n/a |

**Audit verdict**: `NOT CLEARED (0/0/2/0)` — 2 Mediums.

### 1.3 Verify invocation (post-fix — ALL CLOSED)

| Field | Value |
|---|---|
| 1. Kind | `verify` |
| 2. Target scope | Verify M1 + M2 closed at HEAD `1bc454e` |
| 3. Resolved runner path | `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` |
| 4. Model / effort / sandbox / approval | `gpt-5.5` / `high` / `read-only` / default |
| 5. Job ID | `verify-mpoowacl-gr2x4l` |
| 6. Codex threadId | (preserved in job JSON) |
| 7. Output / result location | `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/verify-mpoowacl-gr2x4l.{json,log}` |
| 8. retrievable? | YES |
| 9. Failure classification | n/a |
| 10. Retry attempts | n/a |
| 11. Fallback reason | n/a |

**Verify verdict**: `ALL CLOSED`.

## 2. Audit findings + resolution

### M1 — ULID regex permits non-Crockford letters

**Reviewer wording** (`audit-mpoogs5r-akssld`):

> `apps/lawbar-desktop/renderer/router.ts:19` — ULID validation uses
> `/^[0-9a-z]{26}$/`, which accepts non-Crockford letters such as `i`, `l`,
> `o`, and `u`; view/archive screens reuse this parser before IPC, so
> malformed route IDs can still reach `getMatter`/`archiveMatter`.

**Resolution** (commit `1bc454e`):

- `renderer/router.ts:21` — `ULID_RE` tightened from `/^[0-9a-z]{26}$/` to
  `/^[0-9a-hjkmnp-tv-z]{26}$/`. Source comment at `:18-20` cites Crockford
  alphabet exclusions.
- Test fixture `NEW_ULID` in `tests/renderer-create-matter.test.mjs:8`
  swapped from `"01jzcreatemattercreatedfix0"` (contained `i`) to
  `"01jznewmatter0123456789abc"` (Crockford-valid; 26 chars).

**Verify confirmation** (`verify-mpoowacl-gr2x4l`):

> M1 closed: `apps/lawbar-desktop/renderer/router.ts:21` uses
> `/^[0-9a-hjkmnp-tv-z]{26}$/`; comment at `:18-20` cites Crockford
> exclusions. `NEW_ULID` is now Crockford-valid at
> `apps/lawbar-desktop/tests/renderer-create-matter.test.mjs:8`.

### M2 — Forms missing `submit` event handler

**Reviewer wording**:

> `apps/lawbar-desktop/renderer/screens/createMatter.ts:536`,
> `apps/lawbar-desktop/renderer/screens/archiveMatter.ts:369` — Both forms
> attach submit behavior only to the submit button's `click`; there is no
> `submit` event handler on the form, so Enter-to-submit/browser-default
> keyboard flow from plan §7.4 is not implemented or covered.

**Resolution** (commit `1bc454e`):

- `screens/createMatter.ts:581-584` — Added `form.addEventListener("submit", ...)`
  that calls `preventDefault()` then `handleSubmit()`. Source comment cites
  audit M2 + plan §7.4 Enter-to-submit.
- `screens/archiveMatter.ts:401-404` — Same pattern.
- Test coverage added: `tests/renderer-create-matter.test.mjs:506-530`
  dispatches `submit` event on the form and asserts (a) `preventDefault` was
  called and (b) `api.createMatter` was issued once. Parallel test at
  `tests/renderer-archive-matter.test.mjs:427-453`.

**Verify confirmation**:

> M2 closed: `createMatter.ts:581-584` and `archiveMatter.ts:401-404` both
> wire `form.addEventListener("submit", ...)`, call `preventDefault`, then
> `handleSubmit`. Tests cover submit-event path at
> `renderer-create-matter.test.mjs:506-530` and
> `renderer-archive-matter.test.mjs:427-453`.

**Verifier-run regression**: `54/54 pass` on router + create-matter +
archive-matter tests.

## 3. No deferred findings

Both Mediums fixed inline in the same lane (per `.claude/rules/cc-suite.md`
§"Audit remediation policy" §2: "Critical / High / Medium findings: each
MUST be either FIXED in the same WI..."). Nothing appended to
`dev-memo/deferred-audit-findings.md`.

## 4. Full test-suite verification after fix (HEAD `1bc454e`)

```
$ npm --prefix apps/lawbar-desktop run build
exit 0

$ npm --prefix apps/lawbar-desktop run lint:renderer-imports
[check-renderer-imports] OK — 10 renderer file(s) scanned; no offenders

$ npm --prefix apps/lawbar-desktop run check:no-real-data
[check-no-real-data] OK — 3 file(s) in case-box scope; no markers

$ npm --prefix apps/lawbar-desktop run test:ui-color
ℹ tests 4 / pass 4

$ node --test (all 14 non-Electron test files)
ℹ tests 231 / pass 231

$ node --test tests/smoke.electron.test.mjs
ℹ tests 2 / pass 2

$ npm --prefix apps/lawbar-desktop run test:ui-packaged
[test-packaged-wrapper] SUCCESS (exit 0)  -- 3 consecutive runs
```

## 5. Disposition summary

| Gate | Status |
|---|---|
| G-UI-1..G-UI-23 | PASSED (per `dev-memo/manual-evidence-casebox-ui-impl-00.md` §1 + §4) |
| G-UI-24 manual evidence | THIS WI's automated portions captured; manual-only portions (VoiceOver / GUI screenshots / dev-console interactive walkthrough) DEFERRED to user workstation per evidence file §2 |
| G-UI-25 cc-suite audit CLEARED | CLOSED via `audit-mpoogs5r-akssld` → fix `1bc454e` |
| G-UI-26 cc-suite verify ALL CLOSED | CLOSED via `verify-mpoowacl-gr2x4l` |
| G-UI-27 loc-guardian thresholds | Largest hand-written source `viewMatter.ts` = 616 LOC (< 800 fail); largest test `renderer-create-matter.test.mjs` ≈ 556 LOC (< 1200 fail) |
| G-UI-28 cc-suite recording | THIS FILE §1 captures 11-field block for audit×2 + verify×1 |
| G-UI-29 `.claude/scheduled_tasks.lock` untracked | VERIFIED (gitignored; never staged across 12 commits in lane) |
| G-UI-30 working tree clean post-commit | VERIFIED after every slice + checkpoint + fix commit |

## 6. Outstanding items for user before push / go-live

1. Complete §2 manual gates in `manual-evidence-casebox-ui-impl-00.md`
   (VoiceOver / keyboard-only walkthrough / light+dark screenshots /
   `npm run dev` console transcript) on a workstation with macOS GUI +
   VoiceOver access.
2. Authorize push of the lane commits to `origin/main` (push is a global
   hard-stop per `.claude/rules/autonomy.md`).
3. Final go-live readiness review per `docs/release/go-live-plan.md`
   (out-of-scope for this lane).

## 7. Commit chain in this lane

```
$ git log --oneline -13
1bc454e fix(apps/lawbar-desktop): tighten ULID regex + wire form submit handlers
36936eb docs: record case-box UI manual evidence
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
1910756 docs: add case-box UI plan
```

Plan ↑ at `1910756`; IPC impl predecessor at `e490686`.
