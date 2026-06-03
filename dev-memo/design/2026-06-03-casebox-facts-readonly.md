# Design artifact — Matter facts (read-only list)

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface matter facts read-only` (B6 fact read surface).
**Type**: UI (read-only). Manual-merge (UI + IPC surface).
**Surface**: a new Facts section on the matter view (`renderer/screens/viewMatter.ts`), rendered by a new sibling `renderer/screens/viewMatterFacts.ts`. New handler module `src/caseBox/factHandlers.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/factsRepoQueries.ts` (`listFacts`, already implemented, seek-paginated); schema `case-box-fact.schema.json`; brief §7.A litigation day-one vertical (facts = claims/defenses/timeline).

## Problem

A matter's facts are persisted (`listFacts`) but have no IPC channel and no UI. This slice surfaces the **read path** only — the last big litigation-vertical read surface (matters → documents → deadlines → **facts** → evidence).

## Scope (this WI)

- **Read-only.** No fact creation, editing, deletion, OCR extraction, document/evidence linking, privilege, or confidentiality changes.
- One channel `casebox:fact:list` (seek-paginated). `getFact` is **deferred / not added** — the list rows already carry the full `CaseBoxFact`, so a per-fact `get` is redundant for this read surface.
- Tenant/matter scoping preserved.

## IPC contract (new channel)

```
casebox:fact:list   ListFactsDto { matterId: string; limit?: number; cursor?: string }
                    -> IpcEnvelope<ListFactsPage>   // { rows: CaseBoxFact[]; next_cursor: string|null }
```

`listFactsHandler` (new `factHandlers.ts`, mirrors `deadlineHandlers.ts`): forbidden (`tenant_id`/`actor_user_id`) + unknown-field rejection, `matterId`/`limit`/`cursor` validation, matter-existence + active-tenant check **before** the read, server-side `tenant_id`+`matter_id` injection. The per-entity handler split (prior WI) means this is a small self-contained module.

## UI

A lazy "Show facts" disclosure on the matter view. Each row renders the human-relevant `CaseBoxFact` subset: `statement_text` (the fact), `status · source_type`, the date (`as_of_date` if present else `created_at`, local-formatted), and `extraction_confidence` when present. Empty → "No facts recorded for this matter." Error → inline `role="alert"`. "Show more" pagination via `next_cursor`. `el()` sets `textContent` (no `innerHTML`) — statement text is rendered as text only.

## Out of scope / deferred

`getFact`, status/source_type filters, fact creation/edit/delete, document/evidence linking, supersession chains, OCR extraction. Deferred.

## Acceptance (testable)

1. Facts disclosure does not call `list` until opened; opening renders the rows.
2. Empty matter → "No facts recorded for this matter."
3. Populated rows show `statement_text`, `status · source_type`, and `extraction_confidence` when present.
4. Error → inline `role="alert"`.
5. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
6. IPC handler: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; non-int limit → `invalid_payload`; absent matter → `unknown_matter` (read not called); tenant mismatch → `tenant_mismatch` (read not called).
