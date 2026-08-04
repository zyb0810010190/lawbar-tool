# PLAN — WI-PTA-VS2: ClaimTrack IPC (list + create channels)

**Type:** Tier-1 IPC / data-boundary WI under the governed lane `dev-memo/plan-pta-claimtrack-completion-lane-00.md`
(VS-2 row). **Status:** DRAFT — non-authorizing until cc-suite `review-plan` READY. **Branch:**
`feature/pta-claimtrack-vertical-slice`. Local commits only; no push. Grounding: the VS-2 planner pass
(desktop IPC file:line map). Consumes VS-1 persistence (`createClaimTrack`/`getClaimTrack`/`listClaimTracks`,
error codes incl. `unknown_party`) + VS-0 (party ULIDs). Prerequisite `8809a9e` (tarball refresh + desktop
consumer catch-up) already landed — the desktop compiles against the ClaimTrack surface and `errorMap`/renderer
`KNOWN_ERROR_CODES` already carry `unknown_party`/`audit_chain_desync`.

**Review record:** cc-suite `review-plan` `review-plan-msesv6ld-ykw55j` (native `--background`, after a
foreground attempt hit the 10-min wrapper cap — TIMEOUT class) → **READY (Low-risk clarifications):** all 4
review questions confirmed (party-ref defense-in-depth; sort_order pass-through; authority-field boundary +
response allowlist excludes tenant_id/actor_user_id; test plan sufficient); no security-boundary weakening;
`getClaimTrack` non-exposure is not a VS-3 blocker. Clarifications folded into §4.6.

## 1. Scope

Two IPC channels for ClaimTrack, mirroring the fact/matter case-box precedent exactly: a READ
`listClaimTracks` + a single WRITE `createClaimTrack`. No `getClaimTrack` channel (lane asks list+create only);
no update/withdraw/resolve/delete; no renderer UI (VS-3). `status` is server-set to `active`.

### Target files (all inside the lane's VS-2 §2 allowed set)
- `src/caseBox/handlerShared.ts` — `CHANNEL` += `claimTrackCreate: "casebox:claimTrack:create"`,
  `claimTrackList: "casebox:claimTrack:list"` (R9).
- `src/caseBox/dto/claimTrack.ts` — **NEW** (mirror `dto/fact.ts`): `CreateClaimTrackDto` +
  `CREATE_CLAIM_TRACK_DTO_FIELDS` / `_FORBIDDEN_FIELDS` / `_RESPONSE_FIELDS` (`Pick`, not `Omit` — the contract
  type has `[k:string]:unknown`); `RendererCreatedClaimTrack`; `ListClaimTracksDto = {matterId}` +
  `LIST_CLAIM_TRACKS_DTO_FIELDS` / `_FORBIDDEN_FIELDS`; `RendererClaimTrackRow`;
  `ListClaimTracksResult = IpcEnvelope<ReadonlyArray<RendererClaimTrackRow>>` (unpaginated — R4).
- `src/caseBox/dto.ts` — barrel re-export.
- `src/caseBox/claimTrackHandlers.ts` — **NEW**: `createClaimTrackHandler` + `listClaimTracksHandler`.
- `electron/ipc/caseBoxHandlers.ts` — direct import (per fact/docket/link precedent; the `handlers.ts` barrel is
  NOT in scope — do not touch it) + two `ipcMain.handle` + auto `unregister`.
- `electron/preload.mts` — two methods.
- `renderer/api.ts` — two `stripDtoFields`-wrapped wrappers.
- `renderer/types.ts` — `CreateClaimTrackDto` / `ListClaimTracksDto` + the renderer field arrays (drift-guarded).
- `tests/ipc-claim-track-handlers.unit.test.mjs` (**NEW**), `tests/ipc-claim-track-integration.unit.test.mjs`
  (**NEW**, real `InMemoryCaseBoxPersistence`), `tests/renderer-dto-sync.test.mjs` (extend PAIRS +
  RESPONSE_ALLOWLISTS).
- `package.json` — register the two new test files in the `test` script (R2: test-wiring only, no dependency
  change — confirmed in-scope).

**NOT touched:** `errorMap.ts`/`errorMessage.ts`/`catalog.ts` (the `unknown_party`/`audit_chain_desync`
messages already landed in `8809a9e`); any `services/case-box-persistence/**` or `docs/contracts/**`; the
`handlers.ts` barrel; renderer UI screens/router/i18n (VS-3).

## 2. Resolved design decisions (planner R2–R9)

- **R2 — `package.json` in scope:** YES (test-script registration only; no dependency change).
- **R3 — errorMap codes:** already present (prerequisite `8809a9e`); VS-2 only *uses*
  `makeBoundaryError("unknown_party")`.
- **R4 — list argument:** `listClaimTracks({matterId})`; handler validates `matterId` non-empty, runs the
  matter+tenant preflight, calls persistence with the injected `tenant_id`; **unpaginated** (no cursor/limit).
- **R5 — party-ref preflight:** the create handler reads+parses the loaded matter, builds the party-id set
  from `matter.parties[].id` (skipping absent ids), and rejects a `claimant_party_id`/`respondent_party_id`
  not in the set with `unknown_party` BEFORE persistence — defense-in-depth over VS-1's source-of-truth check.
- **R6 — `sort_order`:** the **renderer supplies** `sort_order` (validated integer ≥ 0); the handler passes it
  through (pure plumbing — no server-side ordering policy). The append/importance logic lives in VS-3 (per the
  `dev-memo/design/2026-08-03-claimtrack-screen.md` §4 "auto-append" decision). VS-2 introduces NO read-before-write.
- **R7 — refusal envelope:** `unknown_party` (and unknown_matter / tenant_mismatch) surface as the standard
  `{ok:false, error:{kind:"case_box_persistence_error", code, message:<safe>}}` via `makeBoundaryError` —
  consistent with the sibling boundary errors.
- **R8 — validate-before-persist:** the handler `validateClaimTrack(fullRow)` → `invalid_payload` before the
  write (mirror the `createMatter` precedent; ClaimTrack has many required fields). Persistence remains source
  of truth.
- **R9 — channel names:** `casebox:claimTrack:create` / `casebox:claimTrack:list`.

## 3. Handler behavior (both impls; every rejection has parity)

**createClaimTrackHandler(payload, provide, now, idFactory):** shape guard → forbidden-field loop
(`CREATE_CLAIM_TRACK_FORBIDDEN_FIELDS` = `id`/`tenant_id`/`actor_user_id`/`matter_id`/`status`/`created_at`/
`updated_at`) → unknown-field loop → field-type validation (track_type/our_role/title non-empty/sort_order int
≥0/`updated_at`-absent) → **matter+tenant preflight** (unknown → `unknown_matter`; foreign tenant →
`tenant_mismatch`; persistence not reached) → **party-ref preflight** (R5 → `unknown_party`) → build the full
row injecting server authority (`id`=idFactory, `tenant_id`=activeTenant, `actor_user_id`=activeActor,
`status`="active", `created_at`=`updated_at`=now) → `validateClaimTrack` (R8) → `persistence.createClaimTrack`
→ project through `CREATE_CLAIM_TRACK_RESPONSE_FIELDS` (excludes tenant_id/actor_user_id) → `mapThrownError` catch.

**listClaimTracksHandler(payload, provide):** shape/`matterId` guard → matter+tenant preflight →
`persistence.listClaimTracks({tenant_id, matter_id})` → `rows.map(projectRow)` (authority stripped; **not**
`projectPage`).

## 4. Acceptance criteria
1. `CHANNEL` gains the two entries; both `ipcMain.handle`-registered and removed by `unregisterCaseBoxIpcHandlers`.
2. Create injects id/tenant/actor/status="active"/created_at===updated_at; the response carries no
   `tenant_id`/`actor_user_id`; every server-authority field in the renderer payload is rejected `invalid_payload`.
3. Both handlers matter+tenant-preflight BEFORE persistence: unknown matter → `unknown_matter`, foreign tenant →
   `tenant_mismatch`, persistence not reached.
4. Create party-ref preflight: a claimant/respondent id absent from the loaded matter → `unknown_party`,
   persistence not reached (atomic — no row, no event).
5. `listClaimTracks` returns a matter-scoped projected array (authority stripped, no page wrapper).
6. In-memory handler unit tests (validation, authority-strip table-driven, both preflights fail-closed, envelope
   shapes) + a persistence-backed integration test (create through real `InMemoryCaseBoxPersistence`, readback via
   `listClaimTracks` from the same source) both green. **(review-plan clarifications):** the fail-closed tests
   MUST assert the persistence spy's `createClaimTrack`/`listClaimTracks` was NOT called after `unknown_matter`
   / `tenant_mismatch` / `unknown_party`; and at least one projection test MUST feed a stub row carrying EXTRA
   open-index keys + the server-authority fields (`tenant_id`/`actor_user_id`) and assert they are ABSENT from
   the projected response — proving the allowlist projection at runtime, not only via types.
7. Renderer preload/api/types wired; `renderer-dto-sync` parity holds (create+list DTO field arrays; response
   allowlist excludes tenant_id/actor_user_id).
8. Gates: `npm --prefix apps/lawbar-desktop test` green; `npm --prefix docs/contracts/case-box-contract test`
   unchanged-green; cc-suite `audit` no open C/H/M; `verify` closes; loc-guardian clean; one revertable local
   commit; `dev-memo/deferred-audit-findings.md` `VS0-TENANT-1` marked closed. No push.

## 5. Governance
Tier-1 → full cc-suite `review-plan` + `audit` + `verify` (broker). Built via the implementer subagent from
this docket; I verify scope + gates + drive the broker chain. Closes deferred `VS0-TENANT-1` (handler-side
caller-tenant enforcement, mirroring `archiveMatter`). No persistence/contract/schema change; no new dependency;
no FK; no push. Reserved gates (lane §5) untouched.

## 6. Review packet (compact)
- **Active plan summary:** Expose ClaimTrack via two IPC channels (list + create) on the existing case-box IPC
  pattern, with matter+tenant preflight before persistence (closes VS0-TENANT-1), server-authority injection +
  strip, a handler party-ref preflight (`unknown_party`, defense-in-depth over VS-1), and preload/renderer
  wiring. Consumes VS-1 persistence unchanged; no UI.
- **Exact target files:** §1.
- **Acceptance criteria:** §4.
- **Out of scope:** getClaimTrack channel; update/delete; UI; any persistence/contract edit; the handlers.ts barrel.
- **Essential references:** `dev-memo/plan-pta-claimtrack-completion-lane-00.md` (VS-2 row + gates);
  `dev-memo/plan-pta-vs1-claimtrack-persistence-00.md` (the surface consumed); `src/caseBox/factHandlers.ts` +
  `matterHandlers.ts` (precedents); `dev-memo/deferred-audit-findings.md` VS0-TENANT-1.
- **Review questions:**
  1. Is the R5 party-ref preflight correctly defense-in-depth (handler enriches, VS-1 persistence remains
     source-of-truth), and are the error-code semantics (`unknown_party`) consistent across both?
  2. Is R6 (renderer supplies `sort_order`, handler pass-through) the right boundary — no server-side ordering
     policy leaking into VS-2?
  3. Does the create path inject ALL server-authority fields (id/tenant/actor/status/timestamps) and reject them
     from the renderer, with the response allowlist excluding tenant_id/actor_user_id?
  4. Any parity or fail-closed gap between the unit tests and the persistence-backed integration test versus the
     fact/matter precedent?

## 7. Stop condition
Superseded when review-plan is READY and implementation opens; revised if review-plan flags the party-ref
boundary or the sort_order plumbing. Completes the ClaimTrack IPC layer; VS-3 (UI, design artifact ready) follows.
