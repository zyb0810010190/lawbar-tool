# ADR — Evidence A3 link IPC/API surface (design)

**Status**: DESIGN (design-only; not implementation-authorizing). **Date**: 2026-06-26.
**WI**: WI-A3-LINK-IPC-DESIGN-00 (governed `dev-memo/run/queue.md`). **Type**: design ADR (no product code).
**Author**: Claude Code.

Composes under `AGENTS.md` §"Evidence-Genie M0 workflow composition" and the A3 link chain. The audited link
PERSISTENCE lifecycle is live on `main`: `createLink` (`LINK_CREATED`), resolver/export marker-awareness,
`unlinkLink` (`LINK_UNLINKED`), `relinkLink` (`LINK_RELINKED`); `CURRENT_SCHEMA_VERSION` = 12. This ADR designs the
minimal **IPC/API surface** to expose that lifecycle to the Electron app layer. **It authorizes no code.**

## 0. Problem + baseline

The Mac desktop app (`apps/lawbar-desktop`) exposes case-box persistence over IPC for matters/documents/deadlines/
docket/facts/audit, but **NO link channels exist yet** (the link lifecycle is headless persistence only). This ADR
defines the channels, DTOs, error model, actor/boundary/confidentiality rules, A0.7 posture, and the test plan,
strictly matching the app's EXISTING IPC conventions (see §References for the file map).

Established conventions this design adopts verbatim:
- **Channel names**: `casebox:<entity>:<op>` (`apps/lawbar-desktop/src/caseBox/handlerShared.ts` `CHANNEL`).
- **Envelope**: `IpcEnvelope<T> = { ok: true, value: T } | { ok: false, error: IpcErrorEnvelope }` with
  `IpcErrorEnvelope = { kind: "case_box_persistence_error", code: CaseBoxPersistenceErrorCode, message, details? }`
  (`src/caseBox/dto/shared.ts`).
- **Handler shape**: shape-guard (plain JSON object) → forbidden-field rejection → (optional) contract-schema
  validation → call `provide().persistence.*` → project the response through an allowlist → `mapThrownError` on
  throw (`src/caseBox/matterHandlers.ts`, `errorMap.ts`).
- **Actor/tenant**: the main process INJECTS `tenant_id` (`getActiveTenantId`) and `actor_user_id`
  (`getActiveActorUserId`); the renderer is FORBIDDEN from supplying them (`forbiddenFieldFailure`).
- **Confidentiality**: responses are projected through `*_RESPONSE_FIELDS` allowlists that EXCLUDE authority
  fields (`tenant_id`, `actor_user_id`, custody chains). No raw PDF bytes / OCR text cross the bridge.
- **Wiring**: `getCaseBoxRuntime()` is a singleton wrapping `SqliteCaseBoxPersistence` (+ the open `db`);
  `registerCaseBoxIpcHandlers({ persistenceProvider })` binds it.

## 1. Channels (D1)

| Channel | Op | Persistence call |
|---|---|---|
| `casebox:link:create` | create a link | `persistence.createLink(input)` |
| `casebox:link:unlink` | unlink (break) a link | `persistence.unlinkLink(linkId, opts)` |
| `casebox:link:relink` | relink (restore) a link | `persistence.relinkLink(linkId, opts)` |
| `casebox:link:list` | list + resolve link statuses for a matter | `resolveLinkStatuses(db, scope)` then read rows |
| `casebox:link:export` | export citations for a matter | `buildExportCitations(db, scope)` |

Preload (`electron/preload.mts`) extends `window.lawbar.caseBox` with `createLink` / `unlinkLink` / `relinkLink` /
`listLinks` / `exportLinkCitations`, each `ipcRenderer.invoke("casebox:link:<op>", dto)`.

**Wiring note — concrete SQLite-only provider (review M1).** The link methods `createLink`/`unlinkLink`/
`relinkLink` are CONCRETE `SqliteCaseBoxPersistence` methods — NOT on the shared `CaseBoxPersistence` interface
(links are an A3 SQLite-only feature; `InMemoryCaseBoxPersistence` has no link support). The existing desktop
`PersistenceProvider` is typed `() => { persistence: CaseBoxPersistence }`, which does NOT expose the link methods.
This ADR therefore AUTHORIZES the IPC impl lane to type the link handlers' provider against the CONCRETE
`SqliteCaseBoxPersistence` (the desktop runtime already constructs exactly that via `openSqliteCaseBoxPersistence`)
— OR to expose a typed link surface on the runtime (`runtime.links.*`). Either keeps the SQLite-only posture and
adds NO method to the shared interface / InMemory. Likewise, `resolveLinkStatuses` / `buildExportCitations` are
standalone `(db, scope)` functions; the runtime currently exposes `persistence` + `close` (which captures `db`),
so the impl lane must give the link handlers `db` access — either expose `runtime.db` or add thin read wrappers.
All of this is a SQLite-only read/write wiring decision; it changes no persistence behavior and adds no shared
interface / InMemory method. (The desktop unit tests' mock `PersistenceProvider` simply mocks the concrete link
methods — no interface widening.)

## 2. Request/response DTOs (D2)

Request DTOs carry ONLY renderer-authorable fields, named in **camelCase** — matching the existing renderer DTO
convention (`matterId`/`documentId`/`deadlineId`/`factId`; the document/deadline/fact DTOs explicitly FORBID
snake_case `matter_id`) — review M1. The handler translates the camelCase DTO to the persistence snake_case input
and injects `tenant_id` + `actor_user_id`. A renderer field carrying a server-authority value (e.g. `tenantId`,
`actorUserId`, or any snake_case persistence field) is rejected via the existing `forbiddenFieldFailure`, which
returns **`invalid_payload`** (with `details.schemaPath`), NOT `invalid_argument` — review L1.

| DTO (renderer → main, camelCase) | Fields | Main injects (persistence snake_case) | Forbidden from renderer |
|---|---|---|---|
| `CreateLinkDto` | `matterId`, `sourceType`, `sourceId`, `anchorId` | `tenant_id`, `actor_user_id` | `tenantId`/`tenant_id`, `actorUserId`/`actor_user_id`, `id`, `status`, `createdAt`, `unlinkedAt`, `unlinkReason` |
| `UnlinkLinkDto` | `matterId`, `linkId`, `unlinkReason` | `actor_user_id` | `actorUserId`/`actor_user_id` |
| `RelinkLinkDto` | `matterId`, `linkId` | `actor_user_id` | `actorUserId`/`actor_user_id`, `unlinkReason`/`reason` (relink takes no reason — matches persistence) |
| `ListLinksDto` | `matterId` | `tenant_id` (scope) | `tenantId`/`tenant_id` |
| `ExportLinkCitationsDto` | `matterId` | `tenant_id` (scope) | `tenantId`/`tenant_id` |

`matterId` is renderer-specified scope (like document register's `matterId`); the handler maps it to the
persistence `matter_id`, and persistence validates it (`unknown_matter` / `tenant_mismatch`).

Response DTOs are projected through a `LINK_RESPONSE_FIELDS` allowlist (authority `tenant_id` + internal
`payload_json` EXCLUDED). Response field names follow the EXISTING response-allowlist convention (the projected
snake_case persistence row fields, e.g. document responses expose `doc_type`/`content_hash`):

- `RendererLink` = the projected row `{ id, matter_id, source_type, source_id, anchor_id, status, created_at,
  unlinked_at, unlink_reason }`. (`matter_id` is scope, exposed like the document response `matter_id`;
  `unlink_reason` is lawyer-entered text, not evidence content.)
- `listLinks` returns `RendererLink[]` AFTER `resolveLinkStatuses` runs, so `status` is the freshly resolved value.
- `exportLinkCitations` returns the existing `buildExportCitations` RESULT verbatim (review M2), exactly as
  `ExportCitationResult` is defined in `exportCitationQueries.ts`:
  `{ citations: ExportCitation[], byFlag: Readonly<Record<"CLEAN" | ExportCitationFlag, number>> }` (the `byFlag`
  counter includes a `"CLEAN"` key for clean citations alongside each `ExportCitationFlag`). Each
  `ExportCitation = { linkId, sourceType, sourceId, documentId: string | null, physicalPageIndex: number | null,
  linkStatus, exportFlag: ExportCitationFlag | null, citation: { citationVolume, citationPageLabel, text } | null }`.
  `sourceType`/`sourceId` are identifiers (e.g. `"evidence"` + the evidence id), not evidence content. The result
  already excludes authority fields (no `tenant_id`) and carries no raw evidence content. (The impl MAY project to
  `citations` only when the client does not need the `byFlag` counters — a NAMED projection decision, not a silent
  drop; the default is to return the full `{ citations, byFlag }` result verbatim.)

## 3. Error taxonomy (D3)

NO new error code. The IPC layer reuses `IpcErrorEnvelope` + the existing frozen `CaseBoxPersistenceErrorCode`
set, mapped to static `SAFE_MESSAGES` by `mapThrownError` (renderer sees only the safe message; the full error is
logged main-side). The link ops surface exactly:

- `createLink` → `invalid_argument` (bad/empty fields, bad source_type, missing anchor, missing evidence),
  `unknown_matter`, `tenant_mismatch`, `duplicate_id`, `invalid_payload`.
- `unlinkLink` → `invalid_argument` (missing link, blank reason), `illegal_transition` (already unlinked).
- `relinkLink` → `invalid_argument` (missing link, a passed reason), `illegal_transition` (already active).

**Scope to LINK-SURFACED codes only (review M3).** The link ops surface ONLY the codes listed above. They do NOT
surface `anchor_referenced` (that is the anchor-DELETE guard's code, a separate A3 surface, not used by
create/unlink/relink) — so the design does NOT depend on `anchor_referenced` being mapped. `SAFE_MESSAGES` already
covers all the LINK-SURFACED codes (`invalid_argument`, `unknown_matter`, `tenant_mismatch`, `duplicate_id`,
`illegal_transition`, `invalid_payload`); confirm that at impl time. If the impl lane chooses to add the missing
`anchor_referenced` safe message as general IPC hygiene, that is an allowed one-line additive `errorMap.ts` edit
(not a new persistence error code) — but it is NOT required by this design.

## 4. A0.7 gating model for mutating IPC ops (D4)

**Key finding: A0.7 is a development/commit-time governance gate, NOT a runtime gate.** There is no A0.7 marker
check anywhere in the running app; A0.7 governs how the code is *built and committed* (the custody-9b flow), not
how it runs. Therefore:

- The **IPC impl lane** (handlers + preload + DTOs + tests) IS A0.7-gated at commit time — it exposes mutating
  operations over court-facing evidence link state, the same posture as the persistence ops it calls (custody 9b).
- At **runtime**, the mutating IPC ops (`create`/`unlink`/`relink`) are NOT guarded by an A0.7 marker (none exists
  at runtime). They rely on the established runtime guarantees: the OS App Sandbox offline entitlement (no
  network), the local-first single-user posture, and **main-process actor/tenant injection** (the renderer cannot
  forge identity). Introducing a runtime A0.7 marker check would be a NEW mechanism requiring its own ADR — it is
  explicitly OUT OF SCOPE for this design and the impl lane MUST NOT invent one.

## 5. Boundaries + actor context (D5)

- **Actor**: `actor_user_id` is main-injected (`getActiveActorUserId`); renderer-supplied = forbidden.
- **Tenant**: `tenant_id` is main-injected (`getActiveTenantId`) — the active local tenant; renderer-supplied =
  forbidden.
- **Matter**: `matterId` is renderer-specified (camelCase scope selection, like document register); the handler
  maps it to the persistence `matter_id`, which persistence validates (`unknown_matter` / `tenant_mismatch`).
- **Evidence / anchor**: existence + tenant/matter scoping are enforced by `createLink` in persistence
  (`invalid_argument` on missing). The IPC layer does NOT re-implement these checks; it delegates and surfaces the
  error envelope.

## 6. Confidentiality (D6)

- Link DTOs expose **identifiers, status, and flags only** — never evidence content. No raw evidence body / PDF
  bytes / OCR text crosses the IPC boundary through any link channel.
- The `LINK_RESPONSE_FIELDS` allowlist EXCLUDES `tenant_id` (authority) and `payload_json` (internal).
- `unlink_reason` (lawyer-entered justification) is exposable — it is the lawyer's own text, not evidence content.
- Fixtures / logs / reports use synthetic ids only; no real evidence content. `mapThrownError` already keeps
  diagnostic detail main-side (the renderer sees only the safe message).

## 7. Idempotence / rejection + status representation (D7)

- **Rejection semantics match persistence exactly** (the IPC layer adds no idempotence of its own): re-unlink /
  re-relink → `illegal_transition`; missing link → `invalid_argument`; create generated-id collision →
  `duplicate_id`; missing matter/anchor/evidence → `unknown_matter` / `invalid_argument`. Each leaves no row and
  no audit event (persistence is transactional; the IPC layer just relays the envelope).
- **Status to clients**: the resolver status `status ∈ { valid, needs_review, broken }` is returned by
  `listLinks`. The export `exportFlag ∈ { NEEDS_REVIEW, BROKEN, NON_CITABLE, AMBIGUOUS, UNLINKED } | null` is
  returned by `exportLinkCitations`. `UNLINKED` is the V12-marker-derived export flag (distinct from a structural
  `BROKEN`); a clean citable link has `status: "valid"` + `exportFlag: null`. Clients render these verbatim; the
  IPC layer invents no new status vocabulary.

## 8. ADR reconciliation note (D8)

`createLink` enforces **evidence existence** for `source_type='evidence'` (the evidence_item must exist in the same
tenant+matter); the non-evidence source types (`note`/`question`/`calcTerm`/`claimElement`) validate a non-empty
`source_id` only because their backing tables do not exist yet. This was authorized for WI-A3-LINK-CREATE-T1 and
EXTENDS `ADR-evidence-a3-link-create-operation.md` §D4 (which required only `source_type` enum + non-empty
`source_id`). **The IPC design PRESERVES this behavior** — it delegates validation to persistence and adds no link
validation of its own. A future DOCS-ONLY ADR cleanup MAY fold the evidence-existence rule into
`ADR-evidence-a3-link-create-operation.md` §D4 for tidiness; the IPC design does NOT require it, and this ADR
records the divergence so it is not lost.

## 9. Test plan for the IPC impl lane (D9)

- **Unit**: a new `apps/lawbar-desktop/tests/ipc-link-handlers.unit.test.mjs` (mock `PersistenceProvider` per the
  `makeProvider` pattern) proving: channel wiring; shape-guard + forbidden-field rejection (a renderer
  `tenantId`/`actorUserId` or `unlinkReason`-on-relink rejected via `forbiddenFieldFailure` → `invalid_payload`);
  camelCase-DTO → persistence-snake_case translation; main-injection of actor/tenant; error-envelope mapping for
  each LINK-SURFACED code (`invalid_argument`, `unknown_matter`, `tenant_mismatch`, `duplicate_id`,
  `illegal_transition`, `invalid_payload` — NOT `anchor_referenced`, which link ops do not surface); response
  projection strips `tenant_id`/`payload_json`; `listLinks` runs the resolver; `exportLinkCitations` returns the
  `{ citations, byFlag }` result.
- **Integration**: extend `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` (the packaged
  `test:ipc-packaged` path) with a create→list→export→unlink→relink round-trip over a real SQLite runtime.
- **Test-wiring NOTE (impl-lane action):** the desktop `test` script in `apps/lawbar-desktop/package.json` is an
  EXPLICIT curated file list (no glob). A NEW unit test file MUST be registered there. UNLIKE the
  case-box-persistence `package.json` (which the persistence lanes kept forbidden), `apps/lawbar-desktop/package.json`
  IS editable by the IPC impl lane FOR THE SOLE PURPOSE of registering the new test file — the impl-lane queue must
  list it as allowed for that one additive edit, or the new test would be orphaned (the WI-A3-UNLINK-T1 lesson).
- `npm --prefix apps/lawbar-desktop test` (610/610 + groups) stays green; `check:no-real-data` enforces synthetic
  fixtures.

## 10. Sequencing + layer separation (D10)

1. **THIS design ADR** (WI-A3-LINK-IPC-DESIGN-00) — design-only, NOT A0.7-gated.
2. **IPC/API impl WI** (the immediate next lane) — handlers (`electron/ipc/caseBoxHandlers.ts` +
   `src/caseBox/linkHandlers.ts`) + the `CHANNEL` entries + preload `CaseBoxApi` + the link DTOs +
   `LINK_RESPONSE_FIELDS` + the runtime `db` wiring + the unit/integration tests. **A0.7-gated, custody 9b**
   (mutating ops over court-facing link state). **IPC/API ONLY — no renderer/UI.**
3. **Renderer/UI impl** — a separate, later lane (the actual link UI).
4. **Export rendering** — a separate, later lane.
5. **(Optional) docs ADR cleanup** — fold the evidence-existence rule into the create ADR §D4 (docs-only).

These are independent governed WIs; higher layers do not collapse into lower ones. The IPC contract design (this
ADR) is settled before the IPC impl; the impl is settled before any UI.

## 11. Stop condition / next lane

"Done" when this ADR + its governance are committed. **The next lane is the IPC/API impl (WI-A3-LINK-IPC-T1),
A0.7-gated, IPC-only — UI deferred.** STOP (do not implement here) if the design proves a schema / audit-contract /
persistence / package-manifest / dependency / InMemory change is required before IPC design can be completed
(none is — the persistence + contract are complete; the only manifest touch is the impl lane's additive test-file
registration in `apps/lawbar-desktop/package.json`).

## References
- IPC map: `apps/lawbar-desktop/src/caseBox/handlerShared.ts` (CHANNEL), `electron/ipc/caseBoxHandlers.ts`
  (registration), `electron/preload.mts` (contextBridge), `src/caseBox/dto/shared.ts` (IpcEnvelope),
  `src/caseBox/matterHandlers.ts` (handler pattern), `src/caseBox/errorMap.ts` (error mapping),
  `src/security/{activeActor,activeTenant}.ts` (injection), `src/caseBox/caseBoxRuntime.ts` (wiring),
  `apps/lawbar-desktop/package.json` (test list).
- Persistence: `services/case-box-persistence/src/sqlite/linkRepoQueries.ts` (createLink/unlink/relink),
  `linkStatusResolverQueries.ts`, `exportCitationQueries.ts`, `errors.ts`.
- ADRs: `docs/adr/ADR-evidence-a3-link-create-operation.md`, `ADR-evidence-a3-unlink-break-link-workflow.md`,
  `audit-event-kind-preservation.md`, `client-local-first` posture (`.claude/rules/client-local-first.md`).
