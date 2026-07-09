# Plan — WI-DESKTOP-PRODUCTION-LAUNCH-READINESS-09

**Type**: RELEASE (verification + docs). **No product source change.** Follows the release-readiness lane
(PRs #241–#244). **`main` @** `7d96a7b`.

## Goal

Verify + document the **production** launch path (no `LAWBAR_MODE=dev`): FileVault enforcement, first-run,
local data location, and Chinese UI — honestly noting what this machine can/can't exercise.

## What was done

1. Confirmed clean state (`git status --short`; HEAD `7d96a7b`).
2. Ran gates: `npm test` (819 pass), `test:smoke-matrix` (M1–M9 pass), `npm run dist` (success).
3. Checked this machine's FileVault: **OFF** (`fdesetup status`).
4. **Empirical production launch** (no `LAWBAR_MODE=dev`, temp `--user-data-dir`): the app **blocked at the
   FileVault-required dialog**, never reached the UI, and created **no** `case-box.sqlite`/documents — the
   Tier-1 enforcement + no-data-before-block behavior confirmed. Process killed cleanly; no repo-tree data.
5. Confirmed the enforcement logic is unit-tested (`main.test.mjs`: `decideAction` matrix, `resolveMode`
   fail-closed to production, `parseFdesetupStatus`).
6. Documented the data path (`~/Library/Application Support/lawbar/` → `case-box.sqlite` + `case-box-documents/`),
   the launch/open commands per arch, first-run behavior, the zh-CN launch checklist, unsigned + FileVault
   caveats, and a **manual FileVault-ON checklist** (this machine is OFF, so the proceed-path is untested here).

## Deliverables (docs only)

`dev-memo/desktop-production-launch-readiness.md` + this plan.

## Honest limitation

This build machine has **FileVault OFF**, so the FileVault-**ON** production proceed-path (and thus production
Chinese-UI) could not be exercised directly. It is covered by (a) the unit-tested `decideAction` full matrix and
(b) the §7 manual checklist. The FileVault-OFF **block** path was verified empirically.

## Governance

Doc/verification-only, low-risk; no product/schema/backend/i18n-guard/signing-config/UI change; FileVault
enforcement NOT weakened (verified it fires); user-facing English still 0; self-review recorded (the launch +
gate output ARE the evidence). Batch-audit closeout handled per the standard cadence.

## Guard conditions (satisfied)

`.mcp.json` untouched · clutter untouched · no generated `release/**` committed · FileVault enforcement not
weakened · dev-mode command documented separately (not used to bypass the production check) · no schema /
backend / i18n / signing-config / UI-design change.

## Acceptance (met)

`test` 819 pass · smoke M1–M9 pass · `dist` success · production launch (no dev) → FileVault block on this
OFF machine (no UI, no data) · data path confirmed · no repo-tree data · Chinese UI confirmed (dev + doc) ·
no product behavior changed.

## Out of scope

Turning FileVault on/off, signing execution, auto-update, `.dmg` cosmetics, version bump, backend, schema, UI.
