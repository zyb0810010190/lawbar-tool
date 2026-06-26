# BATCH-CASEBOX-EVIDENCE-A3-LINK-IPC-T1-00 (WI-A3-LINK-IPC-T1 — audited link IPC/API implementation)

**Status**: plan for the A0.7-gated IPC/API implementation (custody mode 9b). The governed
`dev-memo/run/queue.md` WI-A3-LINK-IPC-T1 block is the execution authority. **Date**: 2026-06-26.
**Type**: IMPL (apps/lawbar-desktop IPC; A0.7-gated; HIGH-RISK — court-facing mutating IPC over the audited
link lifecycle). **Authority**: `docs/adr/ADR-evidence-a3-link-ipc-surface.md` (D1-D11, on main). **IPC/API ONLY —
no renderer UI.**

## Review packet (compact)

1. **Active plan summary.** Implement the 5 link IPC channels from the ADR (`casebox:link:create/unlink/relink/
   list/export`) as trusted main-process handlers delegating to the live persistence lifecycle
   (`createLink`/`unlinkLink`/`relinkLink` + `resolveLinkStatuses`/`buildExportCitations`), with camelCase request
   DTOs, main-injected actor/tenant (renderer-forbidden), and `LINK_RESPONSE_FIELDS`-projected responses. Mirrors
   the `factHandlers.ts` pattern exactly. A0.7-gated, custody 9b.

2. **Exact target files** (allowed):
   - NEW `apps/lawbar-desktop/src/caseBox/linkHandlers.ts` — `createLinkHandler`/`unlinkLinkHandler`/
     `relinkLinkHandler`/`listLinksHandler`/`exportLinkCitationsHandler`, following `factHandlers.ts`
     (shape-guard → forbidden-field → unknown-field → DTO validation → matter+tenant preflight → concrete link
     call → projected response → `mapThrownError`).
   - NEW `apps/lawbar-desktop/src/caseBox/dto/link.ts` — `CreateLinkDto { matterId, sourceType, sourceId, anchorId }`,
     `UnlinkLinkDto { matterId, linkId, unlinkReason }`, `RelinkLinkDto { matterId, linkId }`, `ListLinksDto`/
     `ExportLinkCitationsDto { matterId }` + `*_DTO_FIELDS` + `*_FORBIDDEN_FIELDS` + `LINK_RESPONSE_FIELDS` +
     `RendererLink`/result types (camelCase request; response = projected snake_case row). **review High#1**:
     unlink/relink carry `matterId` (the persistence ops are unscoped) for the scoped preflight.
   - EDIT `apps/lawbar-desktop/src/caseBox/dto.ts` — barrel `export * from "./dto/link.js"`.
   - EDIT `apps/lawbar-desktop/src/caseBox/handlerShared.ts` — add `CHANNEL.linkCreate/linkUnlink/linkRelink/
     linkList/linkExport`; add a `LinkPersistenceProvider = () => { persistence: SqliteCaseBoxPersistence; db }`
     type (concrete; NOT the shared `CaseBoxPersistence` — ADR M1).
   - EDIT `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` — expose the concrete `sqlite: SqliteCaseBoxPersistence
     | null` + `db: Database | null` on `Runtime` (set from `opened.persistence`/`opened.db`; null in the InMemory
     fallback) so the link provider can reach the link methods + the resolver/export `db`.
   - EDIT `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — register the 5 link channels with a
     link-provider derived from the runtime; the InMemory fallback (no link support) returns a safe boundary error
     (mirrors the document-register misconfiguration safeguard).
   - EDIT `apps/lawbar-desktop/electron/preload.mts` — add the 5 link methods to `CaseBoxApi` + `caseBoxApi`.
   - (Q1 RESOLVED — review High#2) **renderer/api.ts + renderer/types.ts are NOT touched.** The
     `renderer-dto-sync` gate uses a HARD-CODED `PAIRS` list and does NOT iterate new canonical DTOs, so new link
     DTOs/preload methods force no renderer parity; the renderer typed wrapper is the future UI lane. IPC + preload
     only.
   - NEW `apps/lawbar-desktop/tests/ipc-link-handlers.unit.test.mjs` — the link handler unit tests (mock provider).
   - EDIT `apps/lawbar-desktop/package.json` — register the new test file in the `test` (+ `test:unit`/
     `test:ipc-unit`) `node --test` file list (the curated-list requirement; explicitly allowed for this lane).
   - EDIT this plan dev-memo + governance files.

3. **Exact acceptance criteria.**
   - `createLink`/`unlinkLink`/`relinkLink` IPC calls reach the audited persistence ops and return the ADR DTO
     (`RendererLink` projected, `tenant_id`/`payload_json` excluded).
   - `listLinks` runs `resolveLinkStatuses` then returns `RendererLink[]` (status/flags, no evidence content);
     `exportLinkCitations` returns the verbatim `{ citations, byFlag }` result.
   - camelCase DTOs; forbidden/extra fields rejected with `invalid_payload` (`forbiddenFieldFailure`/unknown-field);
     renderer-supplied `tenantId`/`actorUserId` rejected, the trusted `getActiveActorUserId`/`getActiveTenantId`
     used; tenant/matter mismatch → `unknown_matter`/`tenant_mismatch`; missing evidence/anchor →
     `invalid_argument`; re-unlink/re-relink → `illegal_transition`.
   - A0.7-gated `check-gates.sh` → GATES OK (human custody 9b). No private evidence content in fixtures/logs/DTO
     snapshots. No schema bump. Existing desktop/persistence/contract tests green.

4. **Exact out-of-scope.** No renderer UI components/views; no persistence semantic change (only the runtime
   adapter exposing the concrete sqlite+db); no schema/`CURRENT_SCHEMA_VERSION` change; no audit-contract change;
   no native/dependency change; no export rendering; no new error code.

5. **Essential references.** ADR `docs/adr/ADR-evidence-a3-link-ipc-surface.md`; the pattern `factHandlers.ts` +
   `handlerShared.ts` + `errorMap.ts` + `dto/fact.ts`; persistence `linkRepoQueries.ts` (the link methods).

6. **Review questions.**
   1. **`renderer/api.ts` scope (Q1).** Does the `renderer-dto-sync` / `renderer-api` gate require the renderer-side
      `CaseBoxApi` type to gain the 5 link method signatures (preload↔renderer parity)? If yes, editing
      `renderer/api.ts` (the IPC API TYPE, not a UI component) is REQUIRED for the gates to pass and is in-scope for
      "IPC/API"; confirm this is not "renderer UI". If the gate does NOT require it, drop `renderer/api.ts` from the
      allowed files.
   2. **Concrete provider (Q2).** Is exposing `sqlite`+`db` on the runtime + a concrete `LinkPersistenceProvider`
      (per ADR M1) the right wiring, with the InMemory fallback returning a safe boundary error for link channels?
   3. **A0.7 runtime (Q3).** Confirm the mutating link IPC handlers add NO runtime A0.7 marker check (ADR D4 — A0.7
      is dev/commit-time; the lane is A0.7-gated at commit time only). The "A0.7-gated mutating calls fail closed
      without a valid marker" requirement (user test 10) is satisfied at the DEV/COMMIT gate, not at runtime — flag
      if the reviewer reads it as a runtime requirement (that would be a new-mechanism STOP).

## A0.7 custody (mode 9b)
Court-facing mutating IPC over the audited link lifecycle → A0.7-gated. `Requires-A07: yes`, custody 9b: the human
mints the marker + runs `check-gates.sh` with the HMAC key; the agent never receives the key; the impl commit is
blocked until the human reports gated PASS.

## Stop conditions
STOP if the impl requires renderer UI / schema / audit-contract / native / dependency / export-rendering scope, or
if a new test file would be orphaned without the `package.json` edit (it is in allowed files — proceed), or if Q1
resolves that `renderer/api.ts` is forbidden UI yet the gate requires it (re-scope + re-review). STOP before the
human A0.7 gate (report the command). STOP before commit on any Critical/High/Medium. After a clean impl commit,
STOP and report; no push/PR/merge/UI/follow-on without separate authorization.

## References
- `docs/adr/ADR-evidence-a3-link-ipc-surface.md`; `apps/lawbar-desktop/src/caseBox/{factHandlers,handlerShared,
  errorMap,caseBoxRuntime}.ts` + `dto/fact.ts`; `electron/ipc/caseBoxHandlers.ts`; `electron/preload.mts`;
  `services/case-box-persistence/src/sqlite/linkRepoQueries.ts`.
