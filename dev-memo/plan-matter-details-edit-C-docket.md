# PLAN — Matter-details edit, Phase C: IPC `casebox:matter:updateDetails` (+ tarball refresh + consumer catch-up)

**Type:** IMPL (Tier-1 IPC / data boundary) + build-plumbing (tarball refresh). **Status:** DRAFT. **Branch:**
`feature/pta-claimtrack-vertical-slice` (local; no push). **Parent (READY):** `dev-memo/plan-matter-details-edit-00.md`.
**Depends on:** Phase A (`a1b55f0` contract) + Phase B (`8b591cf` persistence). Precedents: the `archiveMatter`
IPC handler (`src/caseBox/matterHandlers.ts:199`), the VS-2 ClaimTrack IPC (`9b1e0e2`), and the VS-2 tarball-refresh
prerequisite (`8809a9e`, DESKTOP-DEPS-00).

## 1. Scope
Expose `updateMatterDetails` to the renderer via one IPC channel, refreshing the internal tarballs so the desktop
sees Phase A+B, and satisfying the exhaustive consumers that refresh forces. One coherent commit (the IPC cannot
compile without the refreshed tarball + the catch-up).

### (a) Tarball refresh (DESKTOP-DEPS-00)
Run `npm --prefix apps/lawbar-desktop run bootstrap` (builds `case-box-contract` + `case-box-persistence`, packs,
`refresh:internal-tarballs`, `npm install`). This brings `MATTER_DETAILS_UPDATED`, `updateMatterDetails`, and the
`matter_archived`/`no_editable_change` error codes into the desktop's installed deps + refreshes the tarballs +
`package-lock.json`. Gated by `check:internal-tarballs` (content drift) + `check:internal-lock`.

### (b) Exhaustive-consumer catch-up (FORCED by the refresh — TS won't compile otherwise)
- `apps/lawbar-desktop/src/caseBox/errorMap.ts` — `SAFE_MESSAGES: Record<CaseBoxPersistenceErrorCode, string>` is
  exhaustive → add safe zh-CN messages for `matter_archived` + `no_editable_change`.
- `apps/lawbar-desktop/renderer/i18n/errorMessage.ts` — `KNOWN_ERROR_CODES` += the 2 codes.
- `apps/lawbar-desktop/renderer/i18n/labels.ts` — `EVENT_KIND_ID: Record<CaseBoxAuditEventKind, CatalogId>` is
  exhaustive → add `MATTER_DETAILS_UPDATED`.
- `apps/lawbar-desktop/renderer/i18n/catalog.ts` — zh-CN: `error.matter_archived`, `error.no_editable_change`,
  `eventKind.MATTER_DETAILS_UPDATED`; regenerate `ui-strings-allowlist.json` ONLY if a screen string changed (it
  won't — these are catalog/facade entries, catalog.ts is scanner-exempt).

### (c) IPC layer (mirror `archiveMatter` + VS-2)
- `src/caseBox/handlerShared.ts` — `CHANNEL += matterUpdateDetails: "casebox:matter:updateDetails"`.
- `src/caseBox/dto/matter.ts` (+ `dto.ts` barrel) — `UpdateMatterDetailsDto = { matterId, patch, reason }` where
  `patch` is a partial of the 6 editable fields; `_DTO_FIELDS` / `_FORBIDDEN_FIELDS` (forbid every
  server/lifecycle/frozen key — id/tenant/actor/status/matter_type/parties/confidentiality/jurisdiction/flags/
  successor/created_at/archived_at); response projection reuses `MATTER_RESPONSE_FIELDS`.
- `src/caseBox/matterHandlers.ts` — `updateMatterDetailsHandler`: shape guard (isPlainJsonObject) → forbidden-field
  loop → unknown-field loop → validate `matterId` + non-empty `reason` + `patch` is a plain object of only editable
  keys → server injects `actor_user_id = getActiveActorUserId()` (NEVER renderer); `getActiveTenantId()` for the
  scope → `persistence.updateMatterDetails(matterId, { patch, actor_user_id, reason })` → project via
  `MATTER_RESPONSE_FIELDS` (strip authority) → `mapThrownError` (surfaces `invalid_payload`/`unknown_matter`/
  `matter_archived`/`no_editable_change`/`audit_chain_desync` via `makeBoundaryError`). Own-keys null-prototype view
  for the patch (prototype-pollution defense, as VS-2 did).
- `electron/ipc/caseBoxHandlers.ts` — direct import + `ipcMain.handle` + auto-unregister.
- `electron/preload.mts` — `updateMatterDetails(dto)` method.
- `renderer/api.ts` + `renderer/types.ts` — `updateMatterDetails` wrapper (stripDtoFields) + DTO types + the
  renderer field arrays (drift-guarded by `renderer-dto-sync`).
- `apps/lawbar-desktop/package.json` — register the new IPC unit test in the `test` script.
- Tests: NEW `tests/ipc-matter-update-details.unit.test.mjs` (validation; forbidden/unknown-field reject; server
  authority injected + stripped; patch prototype-pollution rejected; each persistence error surfaced;
  no-op/archived → mapped error; persistence spy called with the injected authority) + extend
  `renderer-dto-sync.test.mjs` + the errorMap/label exhaustiveness tests already cover the new entries.

**NOT touched:** any `services/**` or `docs/contracts/**` SOURCE (Phase A/B landed; the refresh only re-packs);
the renderer edit SCREEN (Phase D); parties/confidentiality/jurisdiction editing.

## 2. Acceptance criteria
1. Tarballs refreshed (`check:internal-tarballs` PASS, `check:internal-lock` current); the desktop compiles against
   `updateMatterDetails` + the new kind + error codes.
2. `casebox:matter:updateDetails` registered + auto-unregistered; the handler injects server authority (never from
   the renderer), forbids every server/lifecycle/frozen key (`invalid_payload`), and projects the response without
   `tenant_id`/`actor_user_id`.
3. Each persistence outcome surfaces the right boundary error (`unknown_matter`/`matter_archived`/
   `no_editable_change`/`invalid_payload`/`audit_chain_desync`) with a safe message; no raw message crosses the wire.
4. Renderer preload/api/types wired; `renderer-dto-sync` parity holds; errorMap + EVENT_KIND_ID exhaustiveness green.
5. `npm --prefix apps/lawbar-desktop test` green (except the pre-existing environmental `smoke.electron.test.mjs:21`
   launch timeout); `npm --prefix docs/contracts/case-box-contract test` + `npm --prefix services/case-box-persistence
   test` unchanged-green. loc-guardian clean; one revertable local commit; no push.

## 3. Governance + discipline
Tier-1 IPC. Design review-plan'd (parent READY). Phase C = implement → `/cc-suite:audit` on the diff → `/cc-suite:verify`.
**Fully-green-before-commit mandatory** (all suites + the tarball drift/lock gates + audit/verify + exact-path
staging). The refreshed binary tarballs + lockfile are verified by the DESKTOP-DEPS-00 drift gate, not the text
audit. No push.

## 4. Stop condition
Superseded when Phase C is committed + verified. Phase D (renderer edit screen + `#/matters/:id/edit` + design
artifact) opens next. Hard-stop if the handler would accept a server/lifecycle field or leak a raw persistence
message.
