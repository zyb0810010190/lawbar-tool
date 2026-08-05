# PLAN — Matter-details edit, Phase D: renderer edit screen (`#/matters/:id/edit`)

**Type:** UI (renderer screen). **Status:** DRAFT. **Branch:** `feature/pta-claimtrack-vertical-slice` (local; no
push). **Parent (READY):** `dev-memo/plan-matter-details-edit-00.md`. **Design artifact:**
`dev-memo/design/2026-08-05-matter-details-edit-screen.md` (required for a UI WI per UI-GATES.md). **Depends on:**
Phase C IPC (`99c5517`) — the `casebox:matter:updateDetails` channel + `api.updateMatterDetails` + DTO types are
already wired. **Precedent:** `renderer/screens/archiveMatter.ts` (form + required reason + audited IPC).

## 1. Scope — the last edit-case-vertical WI
Add the renderer edit SCREEN that lets a lawyer edit the 6 free-text matter fields with a required court-facing
reason, calling the already-wired IPC. Design + UX are locked in the design artifact (Codex UX consult
`review-plan-msfyrorm-0qavjf`, evaluated + accepted). No backend/IPC/contract change — this is renderer-only.

### Target files
- `renderer/router.ts` — add `"edit"` to `RouteName`; a 3-segment `edit` branch in `parseHash`; an `edit` case in
  `buildHash` (mirror the `archive` route exactly).
- `renderer/index.ts` — the DUPLICATE route table: `parseRouteName` + `parseParams` + the `renderRoute` switch case
  (`mountEditMatter`), + the import (mirror `archive`).
- `renderer/screens/editMatter.ts` (NEW) — the screen, mirroring `archiveMatter.ts`: mount signature,
  `getMatter` seed, 6 fields (name `input` required + 5 descriptor `textarea`s clearable), live dirty-tracking
  (submit disabled until ≥1 change AND name non-empty), "Changes to be recorded" summary, required reason textarea
  (min 10 / max 500), `api.updateMatterDetails({matterId, patch, reason})`, `errorMessage()` zh-CN mapping,
  navigate-to-view on success, archived → read-only + banner. Keep the file well under the loc-guardian 800 fail
  threshold (split a helper file if it approaches it).
- `renderer/screens/viewMatter.ts` — add the `view-edit` button (`button--primary`, `data-test-id="view-edit"`),
  rendered ONLY when `row.status === "active"`, navigating to `buildHash("edit", {id})`.
- `renderer/i18n/catalog.ts` — add the `matterEdit.*` block + `detail.editButton` (all zh-CN; see design artifact
  §Copy). catalog.ts is scanner-exempt.
- `renderer/i18n/ui-strings-allowlist.json` — REGENERATE with the scanner one-liner AFTER the source is final
  (LINE-INDEXED guard; regen is the LAST step before the gate).
- `tests/renderer-edit-matter.test.mjs` (NEW) + extend `tests/renderer-view-matter.test.mjs` (view-edit button
  present-active / absent-archived) + register the new test in `package.json`'s `test` script.

**NOT touched:** any `services/**`, `docs/contracts/**`, `electron/**` (preload channel already exists), or the DTO
types (already present). No parties/confidentiality/jurisdiction editing; no audit-history view (removed per user).

## 2. Acceptance criteria
1. `#/matters/:id/edit` routes to the screen (both route tables); invalid ULID → invalid-id view with NO IPC.
2. Screen seeds all 6 fields from `getMatter`; Submit is disabled until ≥1 field differs AND `name.trim()` is
   non-empty (pre-empts `no_editable_change`); the "Changes to be recorded" summary lists the changed fields live.
3. Empty-name submit blocked inline (no IPC); the 5 descriptors may be cleared to `""`; reason min/max enforced
   inline; on submit the screen calls `updateMatterDetails` with exactly `{matterId, patch(6 fields), reason}`.
4. Each persistence error (`matter_archived`/`no_editable_change`/`invalid_payload`/`unknown_matter`/
   `tenant_mismatch`/`audit_chain_desync`) surfaces the zh-CN safe message via `errorMessage()`; success navigates
   to `#/matters/:id`.
5. Archived matter: the `view-edit` button is HIDDEN on viewMatter; the direct `/edit` route renders a read-only
   disabled variant + archived banner (no submit).
6. No hardcoded hex (`test:ui-color` green); i18n guard green (allowlist regenerated, no stale/unallowlisted
   literal, no user-facing English); `npm --prefix apps/lawbar-desktop test` green except the pre-existing
   environmental `smoke.electron.test.mjs:21`. loc-guardian clean (new screen < 800 LOC). One local commit; no push.

## 3. Governance + discipline
UI WI with a concrete design artifact. Implement → REGEN allowlist → FULL desktop gate → `/cc-suite:audit` on the
diff → `/cc-suite:verify` (if findings). **Fully-green-before-commit** (all suites incl. i18n guard + color guard +
dto-sync, audit clean, exact-path staging). Re-run the FULL gate after the allowlist regen (the line-indexed-guard
lesson — comment/line shifts break the allowlist). This commit becomes window 3/3 → batch closeout follows.

## 4. Stop condition
Superseded when Phase D is committed + verified + batch-closed — completing the edit-case vertical (issue #2) end to
end. Hard-stop if the screen would send a server/lifecycle field in the patch, bypass the reason requirement, or
allow editing an archived matter.
